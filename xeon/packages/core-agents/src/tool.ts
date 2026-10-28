// 모델 도구 `agent`(L1.agents.spec §3.3, AG-10). 순서 키 `core.agents`, risk exec, classes ["spawn"], replay safe.
// 재실행해도 같은 requestId(`tool:<toolCallId>:spawn:0`)라 기존 자식을 돌려받는다(§4.5)이므로 safe다.
import { Type, type TBoolean, type TObject, type TOptional, type TString } from "typebox";
import {
  isId,
  type AgentTool,
  type AgentToolResult,
  type JsonValue,
  type ThreadId,
  type TurnId,
} from "@xeon/contracts/conversation";
import {
  AGENT_REPORT_TYPE,
  type DirectToolRegistration,
  type SpawnResult,
  type TaskScope,
} from "@xeon/contracts/services";
import { sha256Hex } from "./hash.ts";
import type { AgentsTasks, AgentsTools } from "./deps.ts";
import { derivedRequestId } from "./request-id.ts";
import type { AgentServiceImpl } from "./service.ts";

export const AGENT_TOOL_NAME = "agent";

const AgentToolParameters: TObject<{
  agent: TString;
  task: TString;
  background: TOptional<TBoolean>;
}> = Type.Object(
  {
    agent: Type.String({
      minLength: 1,
      maxLength: 48,
      description: "Name of the subagent definition.",
    }),
    task: Type.String({ minLength: 1, description: "What the subagent should do." }),
    background: Type.Optional(
      Type.Boolean({ description: "Run in the background and report back later." }),
    ),
  },
  { additionalProperties: false },
);

/** 도구 노드에서 올라가 부모 turn과 대화를 찾는다: tool > turn > (thread | subagent) */
function ownerOfToolCall(
  tasks: AgentsTasks,
  toolCallId: string,
): { readonly threadId: ThreadId; readonly turnId: TurnId; readonly node: TaskScope } | undefined {
  const node = tasks.find("tool", toolCallId);
  const turn = node?.parent;
  const owner = turn?.parent;
  if (node === undefined || turn?.kind !== "turn" || owner === null || owner === undefined) {
    return undefined;
  }
  if (owner.kind !== "thread" && owner.kind !== "subagent") return undefined;
  if (!isId("thr", owner.id) || !isId("trn", turn.id)) return undefined;
  return { threadId: owner.id, turnId: turn.id, node };
}

/** 위임 requestId는 48자 이하다(보고 입력 키 `<requestId>:report`가 64자 안에 들어야 한다). 넘으면 해시로 줄인다 */
function delegateRequestId(derived: string): string {
  return derived.length <= 48 ? derived : `spawn:${sha256Hex(derived).slice(0, 40)}`;
}

function toResult(outcome: SpawnResult): AgentToolResult {
  const flags: JsonValue = outcome.report === null ? [] : [...outcome.report.flags];
  const details: JsonValue = {
    childThreadId: outcome.childThreadId,
    status: outcome.status,
    truncated: outcome.report?.truncated ?? false,
    flags,
    reused: outcome.reused,
  };
  return {
    content: [{ type: "text", text: outcome.answer ?? "" }],
    details,
    structuredContent: details,
    isError: outcome.status !== "completed",
  };
}

function failed(message: string): AgentToolResult {
  return {
    content: [{ type: "text", text: `[xeon:subagent_error] ${message}` }],
    details: null,
    isError: true,
  };
}

function createAgentTool(
  service: AgentServiceImpl,
  tasks: AgentsTasks,
  tools: Pick<AgentsTools, "suspendWhile">,
): AgentTool<typeof AgentToolParameters> {
  return {
    name: AGENT_TOOL_NAME,
    label: "Subagent",
    description:
      "Run a subagent in its own conversation and get its final report. Use it for self-contained research or exploration whose intermediate steps you do not need.",
    parameters: AgentToolParameters,
    replay: "safe",
    async execute(toolCallId, params, signal): Promise<AgentToolResult> {
      const owner = ownerOfToolCall(tasks, toolCallId);
      if (owner === undefined)
        return failed("agents.unavailable: this tool call has no task scope");
      const parent = service.contextOf(owner.threadId);
      const ownerRequestId = `tool:${toolCallId}`;
      if (params.background === true) {
        // 백그라운드: 접수하고 바로 돌아온다. 완료 보고는 부모 inbox로 들어간다(§4.2, §4.7)
        const receipt = await service.delegate(
          {
            agent: params.agent,
            task: params.task,
            requestId: delegateRequestId(derivedRequestId(ownerRequestId, 0)),
            report: { customType: AGENT_REPORT_TYPE, display: true, when: "followUp" },
          },
          {
            parentThreadId: owner.threadId,
            owner: { kind: "tool", turnId: owner.turnId, toolCallId },
            caller: parent.caller,
            depth: parent.depth,
            ownerRequestId,
            signal,
          },
        );
        if (!receipt.ok) return failed(`${receipt.error.kind}: ${receipt.error.message}`);
        const details: JsonValue = {
          childThreadId: receipt.receipt.childThreadId,
          status: receipt.receipt.status,
        };
        return {
          content: [
            {
              type: "text",
              text: `Subagent "${params.agent}" started in the background (thread ${receipt.receipt.childThreadId}). Its report will arrive as a later message.`,
            },
          ],
          details,
          structuredContent: details,
        };
      }
      // 자식의 도구 호출도 `tools` 슬롯이 필요하다. 이 호출이 슬롯을 쥔 채 자식을 기다리면 슬롯 수만큼의 `agent` 호출이 교착한다
      // (규칙 C2). 기다리는 동안 슬롯을 내려놓는다
      const outcome = await tools.suspendWhile(
        owner.threadId,
        toolCallId,
        service.spawn(
          {
            agent: params.agent,
            task: params.task,
            requestId: derivedRequestId(ownerRequestId, 0),
          },
          {
            parentThreadId: owner.threadId,
            owner: { kind: "tool", turnId: owner.turnId, toolCallId },
            caller: parent.caller,
            depth: parent.depth,
            ownerRequestId,
            signal,
          },
        ),
      );
      return toResult(outcome);
    },
  };
}

/** xeon.tools 등록 값. 도구 부류 `spawn`은 차단 규칙(no-spawn)이 쓴다 */
export function agentToolRegistration(
  service: AgentServiceImpl,
  tasks: AgentsTasks,
  tools: Pick<AgentsTools, "suspendWhile">,
): DirectToolRegistration {
  return {
    kind: "direct",
    orderKey: "core.agents",
    tool: createAgentTool(service, tasks, tools),
    policy: { risk: "exec", classes: ["spawn"] },
  };
}
