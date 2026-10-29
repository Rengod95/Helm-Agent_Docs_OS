import { Bug, err, ok, type Result } from "@xeon/contracts";
import type {
  GuardedHttp,
  GuardedHttpRequest,
  GuardedHttpResponse,
  WebProviderManifest,
} from "@xeon/contracts/capabilities";
import { deniedFailure, type WebFailure } from "../errors.ts";
import type { DnsResolver } from "../ports/resolver.ts";
import type {
  HeaderSendResponse,
  HeaderSecretSender,
  OutboundSecretGuard,
  SecretHeader,
} from "../ports/secrets.ts";
import type {
  HttpTransport,
  TransportFailure,
  TransportMode,
  TransportResponse,
} from "../ports/transport.ts";
import { resolvedVerdict, checkUrlSyntax } from "./ssrf.ts";
import { transportFailureToWeb } from "./transport-errors.ts";

// L2.web.spec §3.6, §3.6.1, §4.6.5. 플러그인과 내장 provider가 쓰는 HTTP. 요청 호스트가 그 provider의 manifest.endpoints에
// 있을 때만 보낸다. 비밀 헤더(header, bearer)는 `HeaderSecretSender.send`의 콜백 안에서만 값이 붙고, 값은 provider에 돌아가지
// 않는다. 응답 에코가 감지되면 본문과 헤더를 버린다. 사용자 도메인 정책은 적용하지 않는다(콘텐츠 URL 규칙과 다르다).
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
  /** 없으면 비밀 헤더가 있는 provider의 요청은 no-key로 거부한다. 조립 쪽 어댑터가 L0 `withHttp` 경로로 채운다 */
  readonly secrets: HeaderSecretSender | undefined;
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

/** `host[:port]` 형태의 endpoint를 나눈다. IPv6는 대괄호로 감싼 `[::1]:8888` 형태만 포트를 갖는다 */
function splitEndpoint(endpoint: string): { readonly host: string; readonly port: string } {
  const lowered = endpoint.toLowerCase();
  if (lowered.startsWith("[")) {
    const close = lowered.indexOf("]");
    if (close === -1) return { host: lowered, port: "" };
    const rest = lowered.slice(close + 1);
    return { host: lowered.slice(1, close), port: rest.startsWith(":") ? rest.slice(1) : "" };
  }
  const first = lowered.indexOf(":");
  // 콜론이 둘 이상이면 대괄호 없는 IPv6 주소이고 포트는 없다
  if (first === -1 || first !== lowered.lastIndexOf(":")) return { host: lowered, port: "" };
  return { host: lowered.slice(0, first), port: lowered.slice(first + 1) };
}

function endpointMatches(endpoint: string, host: string, port: string): boolean {
  const parts = splitEndpoint(endpoint);
  return parts.host === host && parts.port === port;
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

/** 전송 한 번의 결과를 `send` 콜백의 반환값으로 싣는다. 전송이 실패하면 상태 0과 빈 헤더, 본문 null로 채운다 */
interface SecretAttempt extends HeaderSendResponse {
  readonly sent: Result<TransportResponse, TransportFailure>;
}

/**
 * manifest 인증 선언을 비밀 헤더 목록으로 바꾼다. `none`은 빈 목록이다. `query`는 지원하지 않으므로 undefined이고,
 * 헤더 이름이 없는 `header`도 undefined다. 레지스트리가 둘 다 등록 때 거부하므로 여기에 오면 조립 결함이다.
 */
function secretHeadersOf(auth: WebProviderManifest["auth"]): readonly SecretHeader[] | undefined {
  if (auth.kind === "none") return [];
  if (auth.kind === "query") return undefined;
  const headers: SecretHeader[] = [];
  for (const secret of auth.secrets) {
    if (auth.kind === "bearer") {
      headers.push({ header: "authorization", setting: secret.setting, scheme: "Bearer" });
    } else {
      if (secret.header === undefined) return undefined;
      headers.push({ header: secret.header, setting: secret.setting });
    }
  }
  return headers;
}

/** 텍스트 본문(text/*, JSON, XML)만 UTF-8로 풀어 에코 검사에 준다. 그 밖의 본문은 null이다 */
function textBodyOf(sent: TransportResponse): string | null {
  const type = (sent.headers["content-type"] ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const textual = type.startsWith("text/") || type.includes("json") || type.includes("xml");
  return textual ? new TextDecoder().decode(sent.body) : null;
}

/** provider가 준 헤더에 비밀 헤더를 덮어 쓴다. 같은 이름의 provider 헤더는 버려진다 */
function withSecretHeaders(
  headers: Readonly<Record<string, string>>,
  secretValues: Readonly<Record<string, string>>,
): Record<string, string> {
  const merged: Record<string, string> = { ...headers };
  for (const [name, value] of Object.entries(secretValues)) merged[name.toLowerCase()] = value;
  return merged;
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
    const secretHeaders = secretHeadersOf(bound.auth);
    if (secretHeaders === undefined) return err(noKey(bound.name));
    const maxBytes = Math.min(req.maxBytes ?? DEFAULT_MAX_BYTES, HARD_MAX_BYTES);
    const transmit = (
      secretValues: Readonly<Record<string, string>>,
    ): Promise<Result<TransportResponse, TransportFailure>> =>
      deps.transport.send({
        method: req.method,
        url: url.href,
        headers: withSecretHeaders(headers, secretValues),
        ...(req.body === undefined ? {} : { body: req.body }),
        mode,
        addressPolicy,
        timeoutMs: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBytes,
        signal,
      });

    if (secretHeaders.length === 0) {
      const sent = await transmit({});
      if (!sent.ok) return err(transportFailureToWeb(sent.error, host));
      return ok({
        status: sent.value.status,
        url: url.href,
        headers: sent.value.headers,
        body: sent.value.body,
      });
    }

    const secrets = deps.secrets;
    if (secrets === undefined) return err(noKey(bound.name));
    // 비밀 값은 `send` 콜백 안에서만 헤더에 붙는다. 콜백은 전송 결과를 값으로 돌려주고, 실패한 전송도 값으로 싣는다
    const outcome = await secrets.send(
      secretHeaders,
      { method: req.method, url: url.href, body: req.body ?? null },
      signal,
      async (secretValues): Promise<SecretAttempt> => {
        const sent = await transmit(secretValues);
        if (!sent.ok) return { status: 0, headers: {}, bodyText: null, sent };
        return {
          status: sent.value.status,
          headers: sent.value.headers,
          bodyText: textBodyOf(sent.value),
          sent,
        };
      },
    );
    if (!outcome.ok) return err(noKey(bound.name, outcome.error.setting));
    const { response, echoed } = outcome.value;
    // 응답이 비밀 값을 되돌렸다. 본문과 헤더는 provider에 돌려주지 않는다(L2.web.spec §5)
    if (echoed) {
      return err({
        code: "upstream_error",
        message: "The provider response echoed a secret and was dropped.",
        detail: { reason: "secret_echoed" },
      });
    }
    if (!response.sent.ok) return err(transportFailureToWeb(response.sent.error, host));
    // 응답 URL에는 질의 비밀이 들어갈 수 없다(질의 인증은 지원하지 않는다). 요청 URL 그대로 돌려준다
    return ok({
      status: response.sent.value.status,
      url: url.href,
      headers: response.sent.value.headers,
      body: response.sent.value.body,
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
