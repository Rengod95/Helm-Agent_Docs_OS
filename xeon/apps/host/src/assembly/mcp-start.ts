import { isId } from "@xeon/contracts/conversation";
import { parseSecretRef, type SecretHandle } from "@xeon/contracts/capabilities";
import type { Clock, Logger } from "@xeon/contracts";
import type { ApprovalService, SecretService } from "@xeon/contracts/services";
import type { McpStartGate as McpStartPort } from "@xeon/cap-mcp";
import { createMcpStartGate, type McpStartDefinition } from "@xeon/core-tools";
import { mcpDefinitionHash } from "@xeon/platform-secrets";

// M3-05, M3-REQ-75. 비밀 env stdio MCP 서버의 기동 승인 게이트를 잇는다. 승인 흐름과 승인 레코드(정의 해시)는 core-tools의
// `createMcpStartGate`가, 정의 해시 계산은 platform-secrets의 `mcpDefinitionHash`가 맡는다. cap-mcp는 둘 다 import하지 않아
// 같은 모양의 포트(`McpStartGate`)를 자기 쪽에 선언해 두었고, 이 파일이 둘을 맞춘다. 조립 루트 코드(DR-14 예외 2).

export interface HostMcpStartDeps {
  readonly approvals: Pick<ApprovalService, "open" | "wait">;
  readonly secrets: Pick<SecretService, "check"> | undefined;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** 정의 해시. 참조 형식이 아닌 비밀 env 값이 있으면 같은 정의가 같은 해시를 갖도록 원문 그대로 쓴다 */
function hashOf(definition: McpStartDefinition): string {
  const secretEnv: Record<string, SecretHandle> = {};
  for (const [name, ref] of Object.entries(definition.secretEnv)) {
    const parsed = parseSecretRef(ref);
    if (parsed.ok) secretEnv[name] = parsed.value.handle;
  }
  return mcpDefinitionHash({
    serverId: definition.server,
    source: definition.source,
    command: definition.command,
    args: definition.args,
    cwd: definition.cwd,
    env: definition.env,
    secretEnv,
  });
}

export interface HostMcpStart {
  readonly gate: McpStartPort;
  dispose(): void;
}

export function createHostMcpStart(deps: HostMcpStartDeps): HostMcpStart {
  const inner = createMcpStartGate({
    approvals: deps.approvals,
    secrets: deps.secrets,
    hash: hashOf,
    clock: deps.clock,
    logger: deps.logger,
  });
  const gate: McpStartPort = {
    check(definition, context) {
      const threadId = context.threadId;
      return inner.check(definition, {
        threadId: threadId !== undefined && isId("thr", threadId) ? threadId : undefined,
      });
    },
    onResolved: (listener) => inner.onResolved(listener),
  };
  return { gate, dispose: () => inner.dispose() };
}
