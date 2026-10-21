import type {
  AgentEvent,
  AssistantMessage,
  AssistantMessageEvent,
  ToolCall,
  ToolResultMessage,
  Usage,
} from "@xeon/contracts/conversation";

function usage(totalTokens = 10): Usage {
  return {
    input: totalTokens,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function assistant(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "stop",
  timestamp = 1_767_571_200_000,
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "fake-api",
    provider: "fake",
    model: "fake-1",
    usage: usage(),
    stopReason,
    timestamp,
  };
}

export function toolCall(id: string, name: string, args: Record<string, string> = {}): ToolCall {
  return { type: "toolCall", id, name, arguments: args };
}

export function toolResult(
  call: ToolCall,
  text: string,
  timestamp = 1_767_571_200_000,
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: call.id,
    toolName: call.name,
    content: [{ type: "text", text }],
    isError: false,
    timestamp,
  };
}

/** 텍스트 하나를 스트림으로 내는 pi 이벤트 열(message_start … message_end) */
function textMessageEvents(text: string): AgentEvent[] {
  const final = assistant([{ type: "text", text }]);
  const partial = assistant([]);
  const events: AssistantMessageEvent[] = [
    { type: "start", partial },
    { type: "text_start", contentIndex: 0, partial: assistant([{ type: "text", text: "" }]) },
    { type: "text_delta", contentIndex: 0, delta: text, partial: final },
    { type: "text_end", contentIndex: 0, content: text, partial: final },
    { type: "done", reason: "stop", message: final },
  ];
  return [
    { type: "message_start", message: partial },
    ...events
      .filter((event) => event.type !== "start" && event.type !== "done")
      .map((assistantMessageEvent): AgentEvent => ({
        type: "message_update",
        message: final,
        assistantMessageEvent,
      })),
    { type: "message_end", message: final },
  ];
}

/** 도구 호출 둘이 있는 turn 하나(단계 둘)의 pi 이벤트 열 */
export function twoToolCallTurn(): AgentEvent[] {
  const a = toolCall("call_a", "read", { path: "a.txt" });
  const b = toolCall("call_b", "ls", { path: "." });
  const first = assistant([a, b], "toolUse");
  const resultA = toolResult(a, "A");
  const resultB = toolResult(b, "B");
  const second = assistant([{ type: "text", text: "done" }]);
  return [
    { type: "agent_start" },
    { type: "turn_start" },
    { type: "message_start", message: assistant([]) },
    {
      type: "message_update",
      message: first,
      assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial: first },
    },
    {
      type: "message_update",
      message: first,
      assistantMessageEvent: { type: "toolcall_end", contentIndex: 0, toolCall: a, partial: first },
    },
    {
      type: "message_update",
      message: first,
      assistantMessageEvent: { type: "toolcall_start", contentIndex: 1, partial: first },
    },
    {
      type: "message_update",
      message: first,
      assistantMessageEvent: { type: "toolcall_end", contentIndex: 1, toolCall: b, partial: first },
    },
    { type: "message_end", message: first },
    { type: "tool_execution_start", toolCallId: a.id, toolName: a.name, args: a.arguments },
    { type: "tool_execution_start", toolCallId: b.id, toolName: b.name, args: b.arguments },
    {
      type: "tool_execution_update",
      toolCallId: a.id,
      toolName: a.name,
      args: a.arguments,
      partialResult: { content: [{ type: "text", text: "..." }], details: {} },
    },
    {
      type: "tool_execution_end",
      toolCallId: a.id,
      toolName: a.name,
      result: { content: [{ type: "text", text: "A" }], details: {} },
      isError: false,
    },
    {
      type: "tool_execution_end",
      toolCallId: b.id,
      toolName: b.name,
      result: { content: [{ type: "text", text: "B" }], details: {} },
      isError: false,
    },
    { type: "message_start", message: resultA },
    { type: "message_end", message: resultA },
    { type: "message_start", message: resultB },
    { type: "message_end", message: resultB },
    { type: "turn_end", message: first, toolResults: [resultA, resultB] },
    { type: "turn_start" },
    ...textMessageEvents("done").slice(0, 1),
    { type: "message_end", message: second },
    { type: "turn_end", message: second, toolResults: [] },
    { type: "agent_end", messages: [first, resultA, resultB, second] },
  ];
}
