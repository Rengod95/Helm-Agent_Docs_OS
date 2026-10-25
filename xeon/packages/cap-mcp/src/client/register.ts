import { err, ok, type Result } from "@xeon/contracts";
import type { AgentTool, JsonValue } from "@xeon/contracts/conversation";
import type {
  ScopeId,
  ToolRegisterError,
  ToolResourceDef,
  ToolsPort,
} from "@xeon/contracts/extensions";
import type { ToolRegistration, Unregister } from "@xeon/contracts/services";
import { asJsonObject } from "../json.ts";
import type { McpRegisterError, McpToolRegistrar } from "../ports/tools.ts";
import type { McpDynamicTool } from "./dynamic-tools.ts";

// 동적 도구를 도구 표에 올리는 어댑터(L2.mcp.spec §3.3). 조립(HOST.6)이 둘 중 하나를 고른다.
// - ToolService.register(DirectToolRegistration): 순서 키 `mcp.<서버>`, 힌트, 정책 메타(mcpServer)를 싣는다. 권장.
// - ToolsPort.register(ToolResourceDef): X 리소스 등록 경로. 순서 키가 `ext.<확장>`이 되고 힌트를 싣지 못한다.
//
// 서버 주도 요청(MCP.4)의 두 번째 라운드는 연속 정보(`continuation`)가 필요한데 `AgentTool.execute`와 `ToolResourceDef.execute`에는 자리가 없다.
// 직접 등록 경로는 `executeWithContinuation`으로 이를 받고, L1.tools가 `input_required`를 질문 승인으로 올려 같은 호출을 다시 부른다(결정 D5 (a)).
// 리소스 등록 경로에는 이 자리가 없어 서버 주도 요청이 오는 서버에는 직접 등록 경로를 써야 한다.

export interface DirectToolHost {
  register(registration: ToolRegistration): Result<Unregister, ToolRegisterError>;
}

function conflict(error: ToolRegisterError): McpRegisterError {
  return { kind: "name_conflict", toolName: error.toolName };
}

/** `ToolService`의 직접 등록 경로 */
export function createToolServiceRegistrar(host: DirectToolHost): McpToolRegistrar {
  return {
    register(tool: McpDynamicTool) {
      const agentTool: AgentTool = {
        name: tool.wire.name,
        description: tool.wire.description,
        parameters: tool.wire.parameters,
        label: tool.label,
        replay: "never",
        executionMode: tool.executionMode,
        execute: (toolCallId, params, signal) =>
          tool.execute(asJsonObject(params) ?? {}, { signal, requestId: toolCallId }),
      };
      const executeWithContinuation: NonNullable<
        Extract<ToolRegistration, { kind: "direct" }>["executeWithContinuation"]
      > = (call) =>
        tool.execute(asJsonObject(call.params) ?? {}, {
          signal: call.signal,
          requestId: call.toolCallId,
          threadId: call.threadId,
          ...(call.continuation === undefined ? {} : { continuation: call.continuation }),
        });
      const registered = host.register({
        kind: "direct",
        orderKey: tool.orderKey,
        tool: agentTool,
        hints: tool.hints,
        policy: { mcpServer: tool.server },
        executeWithContinuation,
      });
      return registered.ok ? ok(registered.value) : err(conflict(registered.error));
    },
  };
}

/** X `ToolsPort`의 리소스 등록 경로 */
export function createToolsPortRegistrar(port: ToolsPort, owner: ScopeId): McpToolRegistrar {
  return {
    register(tool: McpDynamicTool) {
      const def: ToolResourceDef = {
        name: tool.wire.name,
        description: tool.wire.description,
        parameters: tool.wire.parameters,
        replay: "unsafe",
        execute: (args: JsonValue, context) =>
          tool.execute(asJsonObject(args) ?? {}, {
            signal: context.signal,
            requestId: `${tool.server}:${tool.wire.name}`,
            threadId: context.threadId,
          }),
      };
      const registered = port.register(owner, def);
      return registered.ok ? ok(registered.value) : err(conflict(registered.error));
    },
  };
}
