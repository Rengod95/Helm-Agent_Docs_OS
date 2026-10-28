import type { Result } from "@xeon/contracts";
import type { McpContinuation } from "@xeon/contracts/capabilities";
import type { McpDynamicTool } from "../client/dynamic-tools.ts";

// 동적 도구를 도구 표에 올리는 포트(L2.mcp.spec §3.3). 실제 연결은 HOST.6 조립에서 `ToolService.register`
// (`DirectToolRegistration`, 순서 키 `mcp.<서버>`)로 한다. 어댑터는 `client/register.ts`에 있다.

export type McpRegisterError = { readonly kind: "name_conflict"; readonly toolName: string };

export interface McpToolRegistrar {
  /** 이름이 겹치면 등록은 통째로 실패한다. 성공하면 해제 함수를 돌려준다 */
  register(tool: McpDynamicTool): Result<() => void, McpRegisterError>;
}

/** 도구 호출 하나가 다음 라운드에 쓸 연속 정보를 찾는 길. 연속 정보 전달 경로(F 요청)가 생기기 전에는 비어 있다 */
export interface McpContinuationSource {
  take(requestId: string): McpContinuation | undefined;
}
