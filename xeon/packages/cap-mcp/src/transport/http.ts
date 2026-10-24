import {
  SSEClientTransport,
  StreamableHTTPClientTransport,
  type FetchLike,
} from "@modelcontextprotocol/client";
import type { TransportHandle } from "../adapter.ts";
import type { McpHeaderSecrets } from "../ports/secrets.ts";

// Streamable HTTP와 SSE 전송(L2.mcp.spec §4.3). 헤더의 `secret://` 값은 요청 직전에만 풀어 붙이는 fetch 감싸기로
// 넘기고, 풀린 값은 이 파일에서 보관하거나 오류 메시지에 쓰지 않는다.

export interface HttpTransportInput {
  readonly server: string;
  readonly kind: "http" | "sse";
  readonly url: string;
  /** 헤더 이름 → `secret://` 참조 */
  readonly headerRefs: Readonly<Record<string, string>>;
  readonly secrets: McpHeaderSecrets | undefined;
  /** 시험에서 가짜 서버로 바꾼다. 없으면 전역 fetch */
  readonly fetch: FetchLike | undefined;
}

/** 비밀 해석 실패. 메시지에는 참조 이름만 있고 값은 없다 */
class HeaderSecretFailure extends Error {
  readonly reason: "secret_missing" | "secret_denied" | "secret_unavailable";

  constructor(reason: "secret_missing" | "secret_denied" | "secret_unavailable", ref: string) {
    super(`${reason}: ${ref}`);
    this.reason = reason;
  }
}

function secretFetch(input: HttpTransportInput, signalOf: () => AbortSignal): FetchLike {
  const base: FetchLike = input.fetch ?? ((url, init) => fetch(url, init));
  const refs = input.headerRefs;
  if (Object.keys(refs).length === 0) return base;
  return async (url, init) => {
    const secrets = input.secrets;
    if (secrets === undefined) throw new HeaderSecretFailure("secret_unavailable", "headers");
    const target = new URL(typeof url === "string" ? url : url.href);
    const resolved = await secrets.resolveHeaders({
      server: input.server,
      refs,
      target: { host: target.hostname, port: target.port === "" ? null : Number(target.port) },
      signal: init?.signal ?? signalOf(),
    });
    if (!resolved.ok) throw new HeaderSecretFailure(resolved.error.kind, resolved.error.ref);
    const headers = new Headers(init?.headers);
    for (const [name, value] of Object.entries(resolved.value)) headers.set(name, value);
    return base(url, { ...init, headers });
  };
}

export function createHttpTransport(input: HttpTransportInput): TransportHandle {
  const never = new AbortController().signal;
  const fetchImpl = secretFetch(input, () => never);
  const url = new URL(input.url);
  if (input.kind === "http") return new StreamableHTTPClientTransport(url, { fetch: fetchImpl });
  // oxlint-disable-next-line typescript/no-deprecated -- 2025 이전 SSE 전용 서버를 위한 호환 전송이다. 서버 정의 type "sse"가 이 경로의 유일한 사용처다 (L2.mcp.spec §3.1, §4.3)
  return new SSEClientTransport(url, { fetch: fetchImpl });
}
