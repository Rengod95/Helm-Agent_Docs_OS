import { test } from "bun:test";
import type {
  AgentContext,
  AgentEvent,
  AgentMessage,
  AgentTool,
  AgentToolCall,
  AgentToolResult,
  AgentToolUpdateCallback,
  AssistantMessage,
  JsonObject,
  JsonValue,
  Message,
  ToolCall,
  ToolExecutionMode,
  XeonCustomMessage,
} from "../../src/conversation/index.ts";
import type { Assignable, Equal, Expect } from "../types/expect.ts";

// F.conversation.spec §3.1.1. 이 파일의 단언은 tsc -b가 판정한다(컴파일 시점). 아래 테스트는 파일이 bun test와 knip 진입점에 들게 한다.

type IsAny<T> = 0 extends 1 & T ? true : false;

/** AgentMessage는 Message와 XeonCustomMessage의 닫힌 유니온이다(선언 병합 없음) */
export type MessageUnion = Expect<Equal<AgentMessage, Message | XeonCustomMessage>>;
export type CustomIsAgentMessage = Expect<Assignable<XeonCustomMessage, AgentMessage>>;
export type CustomIsNotMessage = Expect<Equal<Assignable<XeonCustomMessage, Message>, false>>;
export type RolesAreClosed = Expect<
  Equal<AgentMessage["role"], "system" | "user" | "assistant" | "toolResult" | "custom">
>;

/** 이벤트 변형은 10종이다 */
export type EventTypes = Expect<
  Equal<
    AgentEvent["type"],
    | "agent_start"
    | "agent_end"
    | "turn_start"
    | "turn_end"
    | "message_start"
    | "message_update"
    | "message_end"
    | "tool_execution_start"
    | "tool_execution_update"
    | "tool_execution_end"
  >
>;

/** 도구 호출 블록은 어시스턴트 메시지의 toolCall 블록과 같다 */
export type CallIsToolCall = Expect<Equal<AgentToolCall, ToolCall>>;
export type CallFromAssistant = Expect<
  Equal<AgentToolCall, Extract<AssistantMessage["content"][number], { type: "toolCall" }>>
>;

export type ExecutionModes = Expect<Equal<ToolExecutionMode, "sequential" | "parallel">>;

/** any가 없다 */
type EventOf<T extends AgentEvent["type"]> = Extract<AgentEvent, { type: T }>;
export type NoAnyInEvents = [
  Expect<Equal<IsAny<EventOf<"tool_execution_start">["args"]>, false>>,
  Expect<Equal<IsAny<EventOf<"tool_execution_update">["args"]>, false>>,
  Expect<Equal<IsAny<EventOf<"tool_execution_update">["partialResult"]>, false>>,
  Expect<Equal<IsAny<EventOf<"tool_execution_end">["result"]>, false>>,
  Expect<Equal<IsAny<EventOf<"turn_end">["message"]>, false>>,
  Expect<Equal<IsAny<EventOf<"message_update">["message"]>, false>>,
];
export type ArgsAreJsonObjects = Expect<Equal<EventOf<"tool_execution_start">["args"], JsonObject>>;
export type NoAnyInTools = [
  Expect<Equal<IsAny<AgentToolResult["details"]>, false>>,
  Expect<Equal<AgentToolResult["details"], JsonValue | undefined>>,
  Expect<Equal<IsAny<Parameters<AgentToolUpdateCallback>[0]>, false>>,
  Expect<Equal<IsAny<ReturnType<AgentTool["execute"]>>, false>>,
  Expect<Equal<IsAny<AgentContext["messages"]>, false>>,
];

/** 실행 함수는 취소 신호와 갱신 콜백을 항상 받는다 */
export type ExecuteSignature = Expect<
  Equal<
    Parameters<AgentTool["execute"]>,
    [toolCallId: string, params: unknown, signal: AbortSignal, onUpdate: AgentToolUpdateCallback]
  >
>;

test("agent type assertions compile", () => {});
