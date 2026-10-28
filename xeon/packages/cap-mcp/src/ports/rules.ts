import type { PolicyRule } from "@xeon/contracts/services";

/**
 * 승인 모드를 L1.tools 권한 규칙으로 공급하는 포트(L2.mcp.spec §4.4). `ToolService.registerRules`는 `core:` 출처만
 * 받으므로 L2가 확장 티어 규칙을 공급하는 API는 L1A 레인에 요청한다. 이 포트는 그때까지의 자리다.
 * 같은 포트로 다시 부르면 이전 규칙 전체를 바꾼다.
 */
export interface McpRulesSink {
  set(rules: readonly PolicyRule[]): void;
}
