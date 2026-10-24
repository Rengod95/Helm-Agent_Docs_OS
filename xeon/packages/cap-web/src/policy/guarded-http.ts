import { Bug, err, ok, type Result } from "@xeon/contracts";
import type {
  GuardedHttp,
  GuardedHttpRequest,
  GuardedHttpResponse,
  WebProviderManifest,
} from "@xeon/contracts/capabilities";
import { deniedFailure, type WebFailure } from "../errors.ts";
import type { DnsResolver } from "../ports/resolver.ts";
import type { HeaderSecretResolver, OutboundSecretGuard } from "../ports/secrets.ts";
import type { HttpTransport, TransportMode } from "../ports/transport.ts";
import { resolvedVerdict, checkUrlSyntax } from "./ssrf.ts";
import { transportFailureToWeb } from "./transport-errors.ts";

// L2.web.spec §3.6, §4.6.5. 플러그인과 내장 provider가 쓰는 HTTP. 요청 호스트가 그 provider의 manifest.endpoints에
// 있을 때만 보내고, 비밀 헤더는 전송 직전에 치환한다. 사용자 도메인 정책은 적용하지 않는다(콘텐츠 URL 규칙과 다르다).
// 리다이렉트는 따르지 않는다(3xx 응답을 그대로 돌려준다).

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const HARD_MAX_BYTES = 16 * 1024 * 1024;

/** provider가 정할 수 없는 헤더. 전송 계층이 정하거나 요청 출처를 속이는 헤더다 */
const DROPPED_HEADERS: ReadonlySet<string> = new Set([
  "host",
  "cookie",
  "set-cookie",
  "connection",
  "keep-alive",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "via",
  "proxy-authorization",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
]);

/** `GuardedHttp.request`가 거부할 때 던지는 오류. 인터페이스가 Promise 거부로 알리게 정해져 있어 값을 감싸 던진다 */
export class WebHttpError extends Error {
  override readonly name: string = "WebHttpError";
  readonly failure: WebFailure;

  constructor(failure: WebFailure) {
    super(failure.message);
    this.failure = failure;
  }
}

export interface ProviderHttpDeps {
  readonly resolver: DnsResolver;
  readonly transport: HttpTransport;
  /** 없으면 manifest.auth.secrets가 있는 provider의 요청은 no-key로 거부한다 */
  readonly secrets: HeaderSecretResolver | undefined;
  readonly guard: OutboundSecretGuard | undefined;
}

export interface ProviderHttpOptions {
  /** 사용자가 설정한 로컬 endpoint(`host[:port]`). 루프백·사설 주소를 허용하되 메타데이터는 거부한다(§4.6.5) */
  readonly localEndpoints?: readonly string[];
}

export interface BoundProviderHttp {
  readonly http: GuardedHttp;
  /** provider 생성 뒤 manifest를 묶는다. 묶기 전 요청은 provider 결함이다 */
  bind(manifest: WebProviderManifest): void;
  request(
    req: GuardedHttpRequest,
    signal: AbortSignal,
  ): Promise<Result<GuardedHttpResponse, WebFailure>>;
}

function endpointMatches(endpoint: string, host: string, port: string): boolean {
  const lowered = endpoint.toLowerCase();
  const cut = lowered.lastIndexOf(":");
  const hasPort = cut !== -1 && !lowered.endsWith("]");
  const endpointHost = hasPort ? lowered.slice(0, cut) : lowered;
  const endpointPort = hasPort ? lowered.slice(cut + 1) : "";
  return endpointHost === host && endpointPort === port;
}

function lowerHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const lower = name.toLowerCase();
    if (!DROPPED_HEADERS.has(lower)) out[lower] = value;
  }
  return out;
}

function bodyText(body: string | Uint8Array | undefined): string {
  if (body === undefined) return "";
  return typeof body === "string" ? body : "";
}

function noKey(name: string, setting?: string): WebFailure {
  return {
    code: "unavailable",
    message: `${name} has no usable key.`,
    retryable: false,
    detail: setting === undefined ? { reason: "no-key" } : { reason: "no-key", setting },
  };
}

export function createBoundProviderHttp(
  deps: ProviderHttpDeps,
  options: ProviderHttpOptions = {},
): BoundProviderHttp {
  let manifest: WebProviderManifest | undefined;

  async function request(
    req: GuardedHttpRequest,
    signal: AbortSignal,
  ): Promise<Result<GuardedHttpResponse, WebFailure>> {
    if (manifest === undefined) {
      throw new Bug(
        "web.provider_http_unbound: the provider called http before its manifest was bound",
      );
    }
    const bound = manifest;
    const locals = options.localEndpoints ?? [];
    const syntax = checkUrlSyntax(req.url, { localEndpoint: locals.length > 0 });
    if (!syntax.ok) {
      return err(
        syntax.error.kind === "invalid_url"
          ? { code: "invalid_input", message: "The provider URL could not be parsed." }
          : deniedFailure(syntax.error.reason, "The provider URL is not allowed.", {
              host: syntax.error.host,
            }),
      );
    }
    const { url, host, port } = syntax.value;
    const isLocal = locals.some((endpoint) => endpointMatches(endpoint, host, port));
    const isPublicEndpoint = bound.endpoints.some((endpoint) =>
      endpointMatches(endpoint, host, port),
    );
    if (!isLocal && !isPublicEndpoint) {
      return err(
        deniedFailure("endpoint_not_allowed", `${host} is not an endpoint of ${bound.name}.`, {
          host,
        }),
      );
    }
    if (!isLocal && url.protocol !== "https:") {
      return err(
        deniedFailure("endpoint_not_https", "Provider endpoints must use https.", { host }),
      );
    }
    // 이름 규칙(localhost, 점 없는 이름)은 로컬 endpoint에만 풀어 준다. 공개 endpoint가 그런 이름이면 거부한다
    if (!isLocal) {
      const strict = checkUrlSyntax(req.url);
      if (!strict.ok) {
        return err(
          strict.error.kind === "denied"
            ? deniedFailure(strict.error.reason, "The provider URL is not allowed.", { host })
            : { code: "invalid_input", message: "The provider URL could not be parsed." },
        );
      }
    }
    if (
      deps.guard?.containsKnown(req.url) === true ||
      deps.guard?.containsKnown(bodyText(req.body)) === true
    ) {
      return err(
        deniedFailure(
          "secret_in_query",
          "The request contains a registered secret value and was not sent.",
        ),
      );
    }

    const literal = syntax.value.literal;
    const addresses =
      literal !== undefined ? ok([literal]) : await deps.resolver.resolve(host, signal);
    if (!addresses.ok) {
      return err({
        code: "upstream_error",
        message: `The provider host could not be resolved: ${host}`,
        detail: { reason: "dns_unresolvable", host },
      });
    }
    const addressPolicy = { allowPrivateNetwork: false, localEndpoint: isLocal } as const;
    const verdict = resolvedVerdict(addresses.value, addressPolicy);
    if (!verdict.ok) {
      return err(
        deniedFailure(verdict.reason, "The provider host resolves to a blocked address.", {
          host,
          address: verdict.address,
        }),
      );
    }
    const mode: TransportMode = verdict.mode;

    const headers = lowerHeaders(req.headers);
    const target = new URL(url.href);
    const resolver = deps.secrets;
    if (bound.auth.secrets.length > 0 && resolver === undefined) {
      return err(noKey(bound.name));
    }
    if (resolver !== undefined) {
      const values = await Promise.all(
        bound.auth.secrets.map((secret) => resolver.valueOf(secret.setting, signal)),
      );
      for (const [index, secret] of bound.auth.secrets.entries()) {
        const value = values[index];
        if (value === undefined || !value.ok) return err(noKey(bound.name, secret.setting));
        if (bound.auth.kind === "bearer") headers["authorization"] = `Bearer ${value.value}`;
        else if (bound.auth.kind === "header" && secret.header !== undefined) {
          headers[secret.header.toLowerCase()] = value.value;
        } else if (bound.auth.kind === "query" && secret.query !== undefined) {
          target.searchParams.set(secret.query, value.value);
        }
      }
    }

    const maxBytes = Math.min(req.maxBytes ?? DEFAULT_MAX_BYTES, HARD_MAX_BYTES);
    const sent = await deps.transport.send({
      method: req.method,
      url: target.href,
      headers,
      ...(req.body === undefined ? {} : { body: req.body }),
      mode,
      addressPolicy,
      timeoutMs: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBytes,
      signal,
    });
    if (!sent.ok) return err(transportFailureToWeb(sent.error, host));
    // 응답 URL에는 질의 비밀(auth.kind "query")이 들어갈 수 있어 요청 URL 그대로 돌려주지 않는다
    return ok({
      status: sent.value.status,
      url: url.href,
      headers: sent.value.headers,
      body: sent.value.body,
    });
  }

  const http: GuardedHttp = {
    async request(req, signal) {
      const outcome = await request(req, signal);
      if (!outcome.ok) throw new WebHttpError(outcome.error);
      return outcome.value;
    },
  };
  return {
    http,
    bind(next) {
      manifest = next;
    },
    request,
  };
}
