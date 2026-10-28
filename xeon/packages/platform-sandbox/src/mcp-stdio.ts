import type { SandboxPolicy, SandboxService, Shell } from "@xeon/contracts/services";

// L0.sandbox.spec §4.8. MCP stdio 서버를 띄울 때 샌드박스를 적용할지 출처별로 정한다(M3-REQ-57, D-M3-19 행 1).

/** 서버 정의 출처가 사용자 설정이면 끔, 프로젝트·확장·알 수 없는 출처면 켬이다 */
const UNSANDBOXED_BY_DEFAULT = ["settings:user"] as const;

export interface McpStdioSandboxDecision {
  readonly sandboxed: boolean;
  /** 서버별 설정이 정했는가, 출처 기본값이 정했는가 */
  readonly decidedBy: "server_setting" | "origin_default";
}

/**
 * source는 `L2.mcp.spec` 정의 출처 문자열이다(`settings:user`, `settings:project`, `mcpjson:project`, `mcpjson:xeon`, `ext:<이름>`).
 * serverSetting은 서버별 설정(참·거짓)이고, 있으면 출처 기본값보다 우선한다.
 * 알 수 없는 출처는 격리하는 쪽으로 해석한다(저장소가 가져온 정의를 격리 없이 돌리지 않는다).
 */
export function decideMcpStdioSandbox(
  source: string,
  serverSetting: boolean | undefined,
): McpStdioSandboxDecision {
  if (serverSetting !== undefined) return { sandboxed: serverSetting, decidedBy: "server_setting" };
  return {
    sandboxed: !UNSANDBOXED_BY_DEFAULT.some((origin) => origin === source),
    decidedBy: "origin_default",
  };
}

/**
 * 서버 프로세스 실행에 쓸 Shell을 고른다. 켬이면 `wrapShell`을 거친 Shell이고 끔이면 받은 Shell 그대로다.
 * 격리를 쓸 수 없는 상태의 처리는 wrapShell이 `onUnavailable`로 정한다(§4.5).
 */
export function shellForMcpStdio(
  sandbox: Pick<SandboxService, "wrapShell">,
  shell: Shell,
  policy: SandboxPolicy,
  decision: McpStdioSandboxDecision,
): Shell {
  return decision.sandboxed ? sandbox.wrapShell(shell, policy) : shell;
}
