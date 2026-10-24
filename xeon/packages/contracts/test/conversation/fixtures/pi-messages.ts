import type {
  AssistantMessage,
  Message,
  SystemMessage,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "../../../src/conversation/index.ts";

export const usage: Usage = {
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 15,
  cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
};

export const systemMessage: SystemMessage = {
  role: "system",
  content: "You are helpful.",
  sections: { rules: "be brief", old: null },
  timestamp: 1_700_000_000_000,
};

const systemBlocks: SystemMessage = {
  role: "system",
  content: [{ type: "text", text: "more" }],
  toolsRemoved: [{ name: "x" }],
  timestamp: 1_700_000_000_001,
};

export const userText: UserMessage = {
  role: "user",
  content: "hello",
  timestamp: 1_700_000_000_002,
};

const userBlocks: UserMessage = {
  role: "user",
  content: [
    { type: "text", text: "look" },
    { type: "image", data: "aGk=", mimeType: "image/png" },
  ],
  timestamp: 1_700_000_000_003,
};

export const assistantStop: AssistantMessage = {
  role: "assistant",
  content: [
    { type: "thinking", thinking: "hmm" },
    { type: "text", text: "answer" },
  ],
  api: "anthropic-messages",
  provider: "anthropic",
  model: "claude-x",
  usage,
  stopReason: "stop",
  timestamp: 1_700_000_000_004,
};

const assistantToolUse: AssistantMessage = {
  ...assistantStop,
  content: [{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "a.txt" } }],
  stopReason: "toolUse",
};

export const assistantArgumentsError: AssistantMessage = {
  ...assistantStop,
  content: [
    {
      type: "toolCall",
      id: "call_2",
      name: "read",
      arguments: {},
      argumentsError: "arguments were not a JSON object: [1,2]",
    },
  ],
  stopReason: "toolUse",
};

export const assistantAborted: AssistantMessage = {
  ...assistantStop,
  content: [{ type: "text", text: "partial" }],
  stopReason: "aborted",
  errorMessage: "aborted by user",
};

const assistantDeferred: AssistantMessage = {
  ...assistantStop,
  content: [],
  stopReason: "deferred",
  deferred: { provider: "p", modelId: "m", api: "a", id: "resp_1" },
};

export const toolResult: ToolResultMessage = {
  role: "toolResult",
  toolCallId: "call_1",
  toolName: "read",
  content: [{ type: "text", text: "file body" }],
  details: { lines: 3 },
  isError: false,
  timestamp: 1_700_000_000_005,
};

const toolResultError: ToolResultMessage = {
  role: "toolResult",
  toolCallId: "call_2",
  toolName: "read",
  content: [{ type: "text", text: "boom" }],
  isError: true,
  timestamp: 1_700_000_000_006,
};

export const ALL_MESSAGE_FIXTURES: readonly Message[] = [
  systemMessage,
  systemBlocks,
  userText,
  userBlocks,
  assistantStop,
  assistantToolUse,
  assistantArgumentsError,
  assistantAborted,
  assistantDeferred,
  toolResult,
  toolResultError,
];
