import type { Result } from "@xeon/contracts";

// L2.web.spec §4.10.4a. 기본 브라우저 경로인 MCP stdio 서버(Playwright MCP)를 cap-web이 아는 최소 모양으로 줄인 포트.
// cap-web은 cap-mcp를 import하지 않는다. 실제 연결(서버 기동, 도구 목록, 호출 전달)은 조립 쪽이 `McpService`로 맞춘다.

export interface BrowserMcpImage {
  readonly mediaType: string;
  /** base64 */
  readonly data: string;
}

export interface BrowserMcpResult {
  /** 도구 응답의 텍스트 부분(Markdown) */
  readonly text: string;
  readonly images: readonly BrowserMcpImage[];
  /** true면 도구가 실패를 알린 것이다. `text`에 사유가 있다 */
  readonly isError: boolean;
}

/** 포트 수준 실패. 서버가 없거나 연결이 끊긴 것(`unavailable`)과 호출 취소(`aborted`)뿐이다 */
export type BrowserMcpError =
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "aborted" };

export interface BrowserMcpPort {
  /** the MCP server is configured and connected */
  available(
    signal: AbortSignal,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly detail: string }>;
  callTool(
    tool: string,
    args: Readonly<Record<string, string | number | boolean | readonly string[]>>,
    signal: AbortSignal,
  ): Promise<Result<BrowserMcpResult, BrowserMcpError>>;
}
