import { rawId } from "../../helpers/ids.ts";
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
  input: { text: "hi", source: "interactive" },
  user_bash: { command: "ls", excludeFromContext: false, cwd: "/work" },
  before_agent_start: { prompt: "hi", systemPrompt: "sys", systemPromptOptions: {} },
  context: { messages: [userText] },
  context_with_system: { messages: [userText] },
  cache_warming_decision: {
    warmCost: 0.01,
    missCost: 0.2,
    continuationProbability: 0.5,
    action: "warm",
  },
  before_provider_request: {
    provider: "anthropic",
    modelId: "claude-x",
    role: "main",
    payload: { model: "x" },
  },
  before_provider_headers: {
    provider: "anthropic",
    modelId: "claude-x",
    role: "main",
    headers: { authorization: "[secret]", "x-trace": null },
  },
  after_provider_response: {
    provider: "anthropic",
    modelId: "claude-x",
    role: "main",
    status: 200,
    headers: { "content-type": "application/json" },
  },
  provider_stream_event: { provider: "anthropic", api: "anthropic-messages", model: "x", data: 1 },
  model_select: { binding, previous: null, source: "set" },
  thinking_level_select: { role: "main", level: "high", previousLevel: "medium" },
  tool_call: toolCall,
  tool_result: toolCall,
  tool_execution_start: { toolCallId: "call_1", toolName: "read", args: { path: "a" } },
  tool_execution_update: {
    toolCallId: "call_1",
    toolName: "read",
    args: { path: "a" },
    partialResult: "x",
  },
  tool_execution_end: { toolCallId: "call_1", toolName: "read", result: "ok", isError: false },
  agent_start: { turnId: TURN },
  turn_start: { stepIndex: 0, stepId: STEP, timestamp: 1_700_000_000_000 },
  message_start: { message: userText },
  message_update: {
    message: assistantStop,
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 0,
      delta: "a",
      partial: assistantStop,
    },
  },
  message_end: { message: assistantStop },
  turn_end: {
    stepIndex: 0,
    stepId: STEP,
    message: assistantStop,
    toolResults: [toolResult],
    messageItemId: ITEM,
    toolResultItemIds: [rawId("itm", 2)],
    context,
  },
  agent_before_settle: { turnId: TURN, context, outcome: "completed" },
  agent_end: { turnId: TURN, messages: [userText, assistantStop] },
  agent_settled: { turnId: TURN, aborted: false },
  project_trust: { cwd: "/work" },
  resources_discover: { cwd: "/work", reason: "startup" },
  mcp_servers_change: {
    servers: [{ id: "fs", status: "connected" }],
    toolsAdded: ["fs__read"],
    toolsRemoved: [],
  },
  session_start: { reason: "startup", threadId: THREAD },
  session_info_changed: { threadId: THREAD, name: null },
  session_before_switch: { reason: "new" },
  session_before_fork: { threadId: THREAD, itemId: ITEM, position: "at" },
  session_before_compact: {
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
  session_compact: {
    threadId: THREAD,
    eventId: EVENT2,
    reason: "manual",
    willRetry: false,
    fromExtension: null,
    tokensBefore: 1000,
  },
  session_compact_failed: { threadId: THREAD, reason: "overflow", errorMessage: null },
  session_before_tree: {
    threadId: THREAD,
    targetEventId: EVENT,
    oldLeafEventId: EVENT2,
    commonAncestorEventId: null,
    entriesToSummarize: 3,
    userWantsSummary: true,
  },
  session_tree: {
    threadId: THREAD,
    newLeafEventId: EVENT,
    oldLeafEventId: null,
    fromExtension: null,
  },
  session_shutdown: { reason: "quit" },
  ui_prompt_start: { reason: "ui_prompt", kind: "confirm", title: "ok?" },
  ui_prompt_end: { reason: "ui_prompt", kind: "confirm" },
};

/** first·chain 지점의 결정·패치 표본 */
export const RESULT_SAMPLES: Readonly<Record<string, unknown>> = {
  input: { action: "transform", text: "hello" },
  user_bash: { type: "deny", reason: "no" },
  before_agent_start: {
    message: { customType: "grp.helm.hint.added", content: "x", display: true },
  },
  context: { messages: [userText] },
  context_with_system: { messages: [userText] },
  cache_warming_decision: { action: "stop" },
  before_provider_request: { payload: { model: "y" } },
  before_provider_headers: { set: { "x-trace": "1", authorization: null } },
  tool_call: { block: true, reason: "denied" },
  tool_result: { content: [{ type: "text", text: "redacted" }], isError: false, usage },
  message_end: { message: assistantStop },
  turn_end: { continue: true },
  agent_before_settle: { entries: [], continue: false },
  project_trust: { trusted: "yes", remember: true },
  resources_discover: { skillPaths: ["/skills"] },
  session_before_switch: { cancel: true, reason: "busy" },
  session_before_fork: { cancel: false },
  session_before_compact: {
    cancel: false,
    compaction: { summary: "s", firstKeptEventId: EVENT, details: null },
  },
  session_before_tree: { cancel: false, label: "branch" },
};
