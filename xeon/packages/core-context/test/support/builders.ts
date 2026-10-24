import type { OrderedTool } from "@xeon/contracts/capabilities";
import type {
  AssistantMessage,
  EventId,
  ItemRecord,
  Message,
  SystemMessage,
  Usage,
  XeonCustomMessage,
} from "@xeon/contracts/conversation";
import type {
  AssembleOptions,
  CachePolicy,
  ContextUsageEstimate,
  ModelBinding,
  TokenEstimator,
} from "@xeon/contracts/services";
import type { MemoryLog } from "./log.ts";

const usage: Usage = {
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 15,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export const binding: ModelBinding = {
  role: "main",
  provider: "anthropic",
  modelId: "claude-x",
  thinkingLevel: "off",
};

const cachePolicy: CachePolicy = {
  retention: "short",
  sessionKey: "thread",
  sites: ["system", "tools", "summary", "tail"],
  maxBreakpoints: 4,
  midConversationSystem: true,
  midConversationToolChanges: true,
};

function tool(capability: string, name: string): OrderedTool {
  return {
    capability,
    name,
    wire: {
      name,
      description: `${name} tool`,
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
    },
  };
}

/** 정렬된 순서(능력 ID, 이름)로 적은 도구 세 개 */
export const sortedTools: readonly OrderedTool[] = [
  tool("workspace.bash", "bash"),
  tool("workspace.list", "ls"),
  tool("workspace.read", "read"),
];

export function assembleOptions(
  ids: MemoryLog["ids"],
  overrides: Partial<AssembleOptions> = {},
): AssembleOptions {
  return {
    binding,
    contextWindow: 200_000,
    cachePolicy,
    tools: sortedTools,
    basePrompt: "You are Xeon.",
    sections: { project: "Project notes", memory: "Memory notes" },
    volatile: {},
    turnId: ids.next("trn"),
    stepId: ids.next("stp"),
    ...overrides,
  };
}

// ── item 레코드 ─────────────────────────────────────────────────────────

export function userItem(log: MemoryLog, text: string, timestamp = 1): { item: ItemRecord } {
  return {
    item: {
      itemId: log.ids.next("itm"),
      status: "completed",
      kind: "user",
      message: { role: "user", content: text, timestamp },
      requestId: null,
    },
  };
}

export function assistantItem(log: MemoryLog, text: string, timestamp = 2): { item: ItemRecord } {
  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-x",
    usage,
    stopReason: "stop",
    timestamp,
  };
  return {
    item: {
      itemId: log.ids.next("itm"),
      status: "completed",
      kind: "assistant",
      message,
      partIds: [],
    },
  };
}

export function systemItem(log: MemoryLog, message: SystemMessage): { item: ItemRecord } {
  return { item: { itemId: log.ids.next("itm"), status: "completed", kind: "system", message } };
}

export function customItem(
  log: MemoryLog,
  message: Partial<XeonCustomMessage> = {},
): { item: ItemRecord } {
  return {
    item: {
      itemId: log.ids.next("itm"),
      status: "completed",
      kind: "custom",
      message: {
        role: "custom",
        customType: "x.notes.context.hint",
        content: "remember this",
        display: false,
        details: { secret: "not for the model" },
        timestamp: 3,
        ...message,
      },
    },
  };
}

export function compactedPayload(
  firstKeptEventId: EventId,
  summary = "earlier work summary",
): Record<string, unknown> {
  return {
    summary,
    firstKeptEventId,
    tokensBefore: 1234,
    details: { xeon: { reason: "threshold", stepId: "stp_x" } },
    usage: null,
    fromExtension: null,
  };
}

// ── 토큰 추정 대역 ──────────────────────────────────────────────────────

/** 플러그인이 조회하는 xeon.models 중 core-context가 쓰는 부분 */
export interface TokenOnlyModels {
  readonly tokens: TokenEstimator;
}

/** 메시지 JSON 길이 / 4. 결정적이다 */
export const tokenEstimator: TokenEstimator = {
  estimateMessage: (message: Message) => Math.ceil(JSON.stringify(message).length / 4),
  estimateContext(messages: readonly Message[]): ContextUsageEstimate {
    const tokens = messages.reduce((sum, m) => sum + Math.ceil(JSON.stringify(m).length / 4), 0);
    return { tokens, usageTokens: 0, trailingTokens: tokens, lastUsageIndex: null };
  },
  fromUsage: (u: Usage) => u.totalTokens,
};
