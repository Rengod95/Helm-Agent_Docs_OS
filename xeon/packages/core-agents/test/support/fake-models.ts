// xeon.models의 resolve·complete 대역(DR-02: core-models를 import하지 않는다). 대본의 응답을 차례로 돌려주고 호출 요청을 기록한다.
import { assertNever, err, ok } from "@xeon/contracts";
import type { AssistantMessage, Usage } from "@xeon/contracts/conversation";
import type { ModelCallRequest, ResolvedModel } from "@xeon/contracts/services";
import type { StructuredModels } from "../../src/index.ts";

export const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export const FAKE_RESOLVED: ResolvedModel = {
  binding: { role: "judge", provider: "test", modelId: "judge-tape", thinkingLevel: "off" },
  source: "role",
  trace: [],
  model: {
    id: "judge-tape",
    name: "Judge tape",
    api: "test",
    provider: "test",
    baseUrl: "http://localhost",
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    contextWindow: 8000,
    maxTokens: 1000,
  },
  thinkingBudgetTokens: null,
  cachePolicy: {
    retention: "none",
    sessionKey: null,
    sites: [],
    maxBreakpoints: 0,
    midConversationSystem: false,
    midConversationToolChanges: false,
  },
};

export type FakeReply =
  | { readonly kind: "tool"; readonly arguments: Record<string, string | string[]> }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "error"; readonly message: string };

export interface FakeModels extends StructuredModels {
  readonly calls: readonly ModelCallRequest[];
}

function messageOf(reply: FakeReply): AssistantMessage {
  const base = {
    role: "assistant",
    api: "test",
    provider: "test",
    model: "judge-tape",
    usage: { ...ZERO_USAGE, input: 10, output: 5, totalTokens: 15 },
    timestamp: 1,
  } as const;
  switch (reply.kind) {
    case "tool":
      return {
        ...base,
        content: [
          { type: "toolCall", id: "call-1", name: "final_answer", arguments: reply.arguments },
        ],
        stopReason: "toolUse",
      };
    case "text":
      return { ...base, content: [{ type: "text", text: reply.text }], stopReason: "stop" };
    case "error":
      return { ...base, content: [], stopReason: "error", errorMessage: reply.message };
    default:
      return assertNever(reply, "fakeModels");
  }
}

/** 응답이 모자라면 마지막 응답을 되풀이하지 않고 오류 응답으로 끝낸다 */
export function fakeModels(
  replies: readonly FakeReply[],
  options: { noModel?: boolean } = {},
): FakeModels {
  const calls: ModelCallRequest[] = [];
  return {
    calls,
    resolve: () =>
      options.noModel === true
        ? err({ kind: "no_model_for_role", message: "no model", role: "judge" })
        : ok(FAKE_RESOLVED),
    complete(request) {
      calls.push(request);
      const reply = replies[calls.length - 1] ?? { kind: "error", message: "tape exhausted" };
      return Promise.resolve(messageOf(reply));
    },
  };
}
