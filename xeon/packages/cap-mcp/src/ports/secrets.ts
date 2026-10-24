import type { Result } from "@xeon/contracts";

// HTTP·SSE 서버 헤더의 `secret://` 참조를 요청 직전에 푸는 포트(L2.mcp.spec §4.3).
// 값은 요청 헤더에만 들어가고 이 패키지의 로그, 이벤트, 오류 메시지, 상태 표에 나타나지 않는다.

export type McpSecretError =
  | { readonly kind: "secret_missing"; readonly ref: string }
  | { readonly kind: "secret_denied"; readonly ref: string }
  | { readonly kind: "secret_unavailable"; readonly ref: string };

export interface McpHeaderRequest {
  readonly server: string;
  /** 헤더 이름 → `secret://` 참조 */
  readonly refs: Readonly<Record<string, string>>;
  readonly target: { readonly host: string; readonly port: number | null };
  readonly signal: AbortSignal;
}

export interface McpHeaderSecrets {
  /** 헤더 이름 → 값. 호출마다 새로 푼다(캐시하지 않는다) */
  resolveHeaders(
    request: McpHeaderRequest,
  ): Promise<Result<Readonly<Record<string, string>>, McpSecretError>>;
}

/** 저장 전 마스킹. `Redactor.mask`의 부분형이다 */
export interface McpMasker {
  mask(text: string): string;
}
