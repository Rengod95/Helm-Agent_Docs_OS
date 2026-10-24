import { attempt, attemptAsync, err, ok, type Result } from "@xeon/contracts";
import { guardedFetch, isGuardedFetchError } from "guarded-fetch";
import type { DnsResolver } from "../ports/resolver.ts";
import type {
  HttpTransport,
  TransportFailure,
  TransportRequest,
  TransportResponse,
} from "../ports/transport.ts";
import { classifyAddress } from "../policy/address.ts";
import { resolvedVerdict } from "../policy/ssrf.ts";
import { createSystemResolver } from "./system-resolver.ts";

// L2.web.plan B3, L2.web.spec §4.6.3. 운영 전송: public 모드는 guarded-fetch 0.1.6(연결 시점에 해석된 모든 IP를
// 다시 검사하고 검사를 통과한 주소로 연결, 리다이렉트는 따르지 않음). direct 모드는 IP 리터럴이 아닌 호스트 이름을
// 다시 풀어 모든 주소를 `addressPolicy`로 검사한 뒤, 검사를 통과한 주소 하나로 전역 fetch를 보낸다(Host 헤더와 TLS
// 서버 이름은 원래 호스트, 리다이렉트는 따르지 않음). 전역 fetch가 이름을 다시 풀 때 앞단 검사와 다른 주소(메타데이터)가
// 나오는 틈이 없다. guarded-fetch 소스 확인 결과는 L2.web.plan §7에 적었다.

interface BoundedBody {
  readonly bytes: Uint8Array;
}

async function readBounded(
  response: Response,
  maxBytes: number,
): Promise<Result<BoundedBody, TransportFailure>> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  const encoded = response.headers.get("content-encoding");
  // 내용 인코딩이 없으면 선언 길이가 곧 본문 길이다. 인코딩이 있으면 푼 뒤 길이는 스트림에서 센다
  if (encoded === null && Number.isFinite(declared) && declared > maxBytes) {
    return err({ kind: "too_large", maxBytes });
  }
  const stream = response.body;
  if (stream === null) return ok({ bytes: new Uint8Array(0) });
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let overflow = false;
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- 스트림은 앞 조각을 읽어야 다음을 읽는다 (eng.typescript.guide TY-22)
    const step = await attemptAsync(() => reader.read());
    if (!step.ok) {
      return err({
        kind: "network",
        message: "reading the response body failed",
        cause: step.error.cause,
      });
    }
    if (step.value.done) break;
    const chunk: unknown = step.value.value;
    if (!(chunk instanceof Uint8Array)) {
      return err({ kind: "network", message: "the response body held a non-binary chunk" });
    }
    total += chunk.byteLength;
    if (total > maxBytes) {
      overflow = true;
      break;
    }
    chunks.push(chunk);
  }
  if (overflow) {
    // 남은 본문을 버린다. 취소가 실패하면 그 원인을 too_large의 cause로 싣는다
    const cancelled = await attemptAsync(() => reader.cancel());
    return err({
      kind: "too_large",
      maxBytes,
      ...(cancelled.ok ? {} : { cause: cancelled.error.cause }),
    });
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return ok({ bytes });
}

function lowerCaseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    out[name.toLowerCase()] = value;
  });
  return out;
}

function describe(caught: unknown): string {
  return caught instanceof Error ? caught.message : "unknown error";
}

function failureOf(caught: unknown, timedOut: boolean, aborted: boolean): TransportFailure {
  if (timedOut) return { kind: "timeout" };
  if (isGuardedFetchError(caught)) {
    if (caught.code === "timeout") return { kind: "timeout" };
    if (caught.code === "network_error") {
      return { kind: "network", message: caught.message, cause: caught };
    }
    // invalid_url, protocol_not_allowed, host_not_allowed, hostname_unsafe, redirect_*: 연결 전·연결 시점 검사가 거부했다
    return { kind: "blocked", message: caught.message, cause: caught };
  }
  if (aborted) return { kind: "aborted" };
  return { kind: "network", message: describe(caught), cause: caught };
}

// Uint8Array<ArrayBufferLike>는 BodyInit이 아니다(SharedArrayBuffer 가능성). 복사해 ArrayBuffer 기반으로 만든다
function bodyInitOf(body: string | Uint8Array): string | Uint8Array<ArrayBuffer> {
  return typeof body === "string" ? body : new Uint8Array(body);
}

interface PinnedTarget {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly tlsServerName: string | undefined;
}

/**
 * direct 모드 대상. IP 리터럴이면 앞단이 이미 검사했으므로 그대로 보낸다. 이름이면 다시 풀어 전부 검사하고(메타데이터는 항상 거부)
 * 통과한 첫 주소로 연결하도록 URL을 바꾼다
 */
async function pinDirect(
  request: TransportRequest,
  resolver: DnsResolver,
): Promise<Result<PinnedTarget, TransportFailure>> {
  const parsed = attempt(() => new URL(request.url));
  if (!parsed.ok) {
    return err({ kind: "blocked", message: "the request URL could not be parsed" });
  }
  const url = parsed.value;
  const bareHost = url.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (classifyAddress(bareHost) !== undefined) {
    return ok({ url: request.url, headers: { ...request.headers }, tlsServerName: undefined });
  }
  const resolved = await resolver.resolve(bareHost, request.signal);
  if (!resolved.ok) {
    return err(
      request.signal.aborted
        ? { kind: "aborted" }
        : { kind: "network", message: `the host could not be resolved: ${resolved.error.message}` },
    );
  }
  const verdict = resolvedVerdict(
    resolved.value,
    request.addressPolicy ?? { allowPrivateNetwork: false, localEndpoint: false },
  );
  const first = resolved.value[0];
  if (!verdict.ok || first === undefined) {
    return err({
      kind: "blocked",
      message: `the host resolves to a blocked address at connect time (${verdict.ok ? "no address" : verdict.reason})`,
    });
  }
  const pinned = new URL(url.href);
  pinned.hostname = first.includes(":") && !first.startsWith("[") ? `[${first}]` : first;
  return ok({
    url: pinned.href,
    headers: { ...request.headers, host: url.host },
    tlsServerName: url.protocol === "https:" ? bareHost : undefined,
  });
}

export interface HttpTransportOptions {
  /** direct 모드가 호스트 이름을 다시 풀 때 쓴다. 기본은 OS 해석기 */
  readonly resolver?: DnsResolver;
}

export function createHttpTransport(options: HttpTransportOptions = {}): HttpTransport {
  const resolver = options.resolver ?? createSystemResolver();
  return {
    async send(request: TransportRequest) {
      const controller = new AbortController();
      const state = { timedOut: false };
      const timer = setTimeout(() => {
        state.timedOut = true;
        controller.abort();
      }, request.timeoutMs);
      const onAbort = (): void => {
        controller.abort();
      };
      if (request.signal.aborted) onAbort();
      else request.signal.addEventListener("abort", onAbort, { once: true });
      try {
        let target: PinnedTarget = {
          url: request.url,
          headers: { ...request.headers },
          tlsServerName: undefined,
        };
        if (request.mode === "direct") {
          const pinned = await pinDirect(request, resolver);
          if (!pinned.ok) {
            return err(state.timedOut ? { kind: "timeout" } : pinned.error);
          }
          target = pinned.value;
        }
        const init = {
          method: request.method,
          headers: target.headers,
          ...(request.body === undefined ? {} : { body: bodyInitOf(request.body) }),
          signal: controller.signal,
        };
        const sent = await attemptAsync(() =>
          request.mode === "public"
            ? guardedFetch(request.url, {
                ...init,
                followRedirects: false,
                timeoutMs: request.timeoutMs,
              })
            : fetch(target.url, {
                ...init,
                redirect: "manual",
                ...(target.tlsServerName === undefined
                  ? {}
                  : { tls: { serverName: target.tlsServerName } }),
              }),
        );
        if (!sent.ok)
          return err(failureOf(sent.error.cause, state.timedOut, request.signal.aborted));
        const response = sent.value;
        const body = await readBounded(response, request.maxBytes);
        if (!body.ok) {
          return err(
            state.timedOut
              ? { kind: "timeout" }
              : request.signal.aborted
                ? { kind: "aborted" }
                : body.error,
          );
        }
        const result: TransportResponse = {
          status: response.status,
          // direct 모드는 주소로 바꾼 URL로 보냈으므로 응답 URL도 요청 URL로 돌려준다
          url: request.mode === "direct" || response.url === "" ? request.url : response.url,
          headers: lowerCaseHeaders(response.headers),
          body: body.value.bytes,
        };
        return ok(result);
      } finally {
        clearTimeout(timer);
        request.signal.removeEventListener("abort", onAbort);
      }
    },
  };
}
