import type { Result } from "@xeon/contracts";

// 요청 하나를 보내고 응답 바이트를 상한까지 읽는다. 리다이렉트는 따르지 않는다(응답 3xx를 그대로 돌려준다).
// 정책 검사(도메인, SSRF 사전 검사, robots)는 이 포트 앞에서 끝나 있다.

/**
 * public: 연결 시점에 해석된 모든 주소를 다시 검사하고 검사를 통과한 주소로 직접 연결한다(DNS 리바인딩 방어).
 * direct: 앞단이 이미 주소를 검사한 요청이다. 사용자가 설정한 provider endpoint(SearXNG의 루프백 주소)와
 * 사설망 허용 설정에서만 쓴다. 연결 시점 재검증이 없다.
 */
export type TransportMode = "public" | "direct";

export interface TransportRequest {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
  readonly mode: TransportMode;
  readonly timeoutMs: number;
  /** 내용 인코딩을 푼 뒤 본문 바이트 상한 */
  readonly maxBytes: number;
  readonly signal: AbortSignal;
}

export interface TransportResponse {
  readonly status: number;
  /** 응답을 낸 URL */
  readonly url: string;
  /** 이름은 소문자 */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export type TransportFailure =
  /** 연결 시점 검사가 주소를 거부함 */
  | { readonly kind: "blocked"; readonly message: string; readonly cause?: unknown }
  | { readonly kind: "timeout" }
  | { readonly kind: "aborted" }
  | { readonly kind: "too_large"; readonly maxBytes: number; readonly cause?: unknown }
  | { readonly kind: "network"; readonly message: string; readonly cause?: unknown };

export interface HttpTransport {
  send(request: TransportRequest): Promise<Result<TransportResponse, TransportFailure>>;
}
