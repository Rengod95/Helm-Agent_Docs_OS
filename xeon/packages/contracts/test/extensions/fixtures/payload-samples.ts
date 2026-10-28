import { rawId } from "../../helpers/ids.ts";
import { PAYLOAD_FIXTURES } from "../../records/fixtures/payloads.ts";
import {
  assistantStop,
  toolResult,
  usage,
  userText,
} from "../../conversation/fixtures/pi-messages.ts";

const THREAD = rawId("thr", 1);
const TURN = rawId("trn", 1);
const STEP = rawId("stp", 1);
const ITEM = rawId("itm", 1);
const EVENT = rawId("evt", 1);
const EVENT2 = rawId("evt", 2);

const context = {
  contextMessages: [userText, assistantStop],
  llmMessages: [userText],
  pendingMessages: [],
  canContinue: true,
};

const binding = {
  role: "main",
  provider: "anthropic",
  modelId: "claude-x",
  thinkingLevel: "medium",
};

const toolCall = {
  toolCallId: "call_1",
  toolName: "read",
  input: { path: "a.txt" },
  capability: { id: "workspace.files", method: "read" },
};

/** 지점마다 payload 스키마를 통과해야 하는 표본. 스키마와 타입이 어긋나면 이 표본이 먼저 깨진다 */
export const PAYLOAD_SAMPLES: Readonly<Record<string, unknown>> = {
  "input.user.before": { text: "hi", source: "interactive" },
  "input.bash.before": { command: "ls", excludeFromContext: false, cwd: "/work" },
  "input.agent.before": { prompt: "hi", systemPrompt: "sys", systemPromptOptions: {} },
  "request.context.before": { messages: [userText] },
  "request.system.before": { messages: [userText] },
  "request.cache.before": {
    warmCost: 0.01,
    missCost: 0.2,
    continuationProbability: 0.5,
    action: "warm",
  },
  "request.provider.before": {
    provider: "anthropic",
    modelId: "claude-x",
    role: "main",
    payload: { model: "x" },
  },
  "request.headers.before": {
    provider: "anthropic",
    modelId: "claude-x",
    role: "main",
    headers: { authorization: "[secret]", "x-trace": null },
  },
  "request.provider.after": {
    provider: "anthropic",
    modelId: "claude-x",
    role: "main",
    status: 200,
    headers: { "content-type": "application/json" },
  },
  "request.stream": { provider: "anthropic", api: "anthropic-messages", model: "x", data: 1 },
  "request.model.after": { binding, previous: null, source: "set" },
  "request.thinking.after": { role: "main", level: "high", previousLevel: "medium" },
  "tool.call.before": toolCall,
  "tool.result": toolCall,
  "tool.execution.before": { toolCallId: "call_1", toolName: "read", args: { path: "a" } },
  "tool.execution.update": {
    toolCallId: "call_1",
    toolName: "read",
    args: { path: "a" },
    partialResult: "x",
  },
  "tool.execution.after": { toolCallId: "call_1", toolName: "read", result: "ok", isError: false },
  "boundary.turn.before": { turnId: TURN },
  "boundary.step.before": { stepIndex: 0, stepId: STEP, timestamp: 1_700_000_000_000 },
  "boundary.message.before": { message: userText },
  "boundary.message.update": {
    message: assistantStop,
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 0,
      delta: "a",
      partial: assistantStop,
    },
  },
  "boundary.message.after": { message: assistantStop },
  "boundary.step.after": {
    stepIndex: 0,
    stepId: STEP,
    message: assistantStop,
    toolResults: [toolResult],
    messageItemId: ITEM,
    toolResultItemIds: [rawId("itm", 2)],
    context,
  },
  "boundary.settle.before": { turnId: TURN, context, outcome: "completed" },
  "boundary.turn.after": { turnId: TURN, messages: [userText, assistantStop] },
  "boundary.settle.after": { turnId: TURN, aborted: false },
  "session.trust.before": { cwd: "/work" },
  "session.resources": { cwd: "/work", reason: "startup" },
  "session.mcp.after": {
    servers: [{ id: "fs", status: "connected" }],
    toolsAdded: ["fs__read"],
    toolsRemoved: [],
  },
  "session.start": { reason: "startup", threadId: THREAD },
  "session.info.after": { threadId: THREAD, name: null },
  "session.switch.before": { reason: "new" },
  "session.fork.before": { threadId: THREAD, itemId: ITEM, position: "at" },
  "session.compact.before": {
    threadId: THREAD,
    reason: "threshold",
    willRetry: false,
    preparation: {
      firstKeptEventId: EVENT,
      tokensBefore: 1000,
      isSplitTurn: false,
      previousSummary: null,
      messagesToSummarize: 12,
    },
    instructions: null,
  },
  "session.compact.after": {
    threadId: THREAD,
    eventId: EVENT2,
    reason: "manual",
    willRetry: false,
    fromExtension: null,
    tokensBefore: 1000,
  },
  "session.compact.failed": { threadId: THREAD, reason: "overflow", errorMessage: null },
  "session.tree.before": {
    threadId: THREAD,
    targetEventId: EVENT,
    oldLeafEventId: EVENT2,
    commonAncestorEventId: null,
    entriesToSummarize: 3,
    userWantsSummary: true,
  },
  "session.tree.after": {
    threadId: THREAD,
    newLeafEventId: EVENT,
    oldLeafEventId: null,
    fromExtension: null,
  },
  "session.shutdown": { reason: "quit" },
  "session.prompt.before": { reason: "ui_prompt", kind: "confirm", title: "ok?" },
  "session.prompt.after": { reason: "ui_prompt", kind: "confirm" },
  "guard.model.before": {
    provider: "anthropic",
    modelId: "claude-x",
    role: "main",
    payload: { model: "x" },
  },
  "guard.tool.before": toolCall,
  "guard.output.before": { threadId: THREAD, turnId: TURN, target: "display", content: "text" },
  "lifecycle.agent.settled": PAYLOAD_FIXTURES["agent.settled"],
  "lifecycle.lease.rejected": PAYLOAD_FIXTURES["lease.rejected"],
};

/** first·chain 지점의 결정·패치 표본 */
export const RESULT_SAMPLES: Readonly<Record<string, unknown>> = {
  "input.user.before": { action: "transform", text: "hello" },
  "input.bash.before": { type: "deny", reason: "no" },
  "input.agent.before": {
    message: { customType: "grp.helm.hint.added", content: "x", display: true },
  },
  "request.context.before": { messages: [userText] },
  "request.system.before": { messages: [userText] },
  "request.cache.before": { action: "stop" },
  "request.provider.before": { payload: { model: "y" } },
  "request.headers.before": { set: { "x-trace": "1", authorization: null } },
  "tool.call.before": { block: true, reason: "denied" },
  "tool.result": { content: [{ type: "text", text: "redacted" }], isError: false, usage },
  "boundary.message.after": { message: assistantStop },
  "boundary.step.after": { continue: true },
  "boundary.settle.before": { entries: [], continue: false },
  "session.trust.before": { trusted: "yes", remember: true },
  "session.resources": { skillPaths: ["/skills"] },
  "session.switch.before": { cancel: true, reason: "busy" },
  "session.fork.before": { cancel: false },
  "session.compact.before": {
    cancel: false,
    compaction: { summary: "s", firstKeptEventId: EVENT, details: null },
  },
  "session.tree.before": { cancel: false, label: "branch" },
  "guard.model.before": { block: true, reason: "blocked" },
  "guard.tool.before": { block: true, reason: "blocked" },
  "guard.output.before": { block: true, reason: "blocked" },
};
