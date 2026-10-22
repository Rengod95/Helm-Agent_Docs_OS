import { Bug, err, ok } from "@xeon/contracts";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Message,
  Model,
  StepId,
  StopReason,
  TextContent,
  ThinkingContent,
  ToolCall,
  Usage,
} from "@xeon/contracts/conversation";
import type { ModelBinding, ModelService, ResolvedModel } from "@xeon/contracts/services";
import type { Clock } from "@xeon/contracts";

// 테스트 대역: core-models의 `resolve`·`rebind`·`streamFn`만 흉내 낸다. 모델 호출은 대본(테이프) 순서로 응답한다
// (eng.testing.guide TS-04 role-queue). `@xeon/core-models/testing`을 import할 수 없어 같은 모양을 여기 둔다.

type ScriptedBlock = TextContent | ThinkingContent | ToolCall;

export type ScriptedResponse =
  | {
      readonly kind: "message";
      readonly content: readonly ScriptedBlock[];
      readonly stopReason: Extract<StopReason, "stop" | "toolUse" | "length" | "deferred">;
      readonly totalTokens?: number;
    }
  | { readonly kind: "error"; readonly message: string }
  /** 신호가 켜질 때까지 응답이 없다. 켜지면 부분 응답을 aborted로 낸다 */
  | { readonly kind: "stall"; readonly partialText?: string };

interface ModelRequest {
  readonly stepId: StepId | null;
  readonly messages: readonly Message[];
  readonly signal: AbortSignal | undefined;
}

export interface FakeModels {
  readonly service: ModelService;
  readonly requests: readonly ModelRequest[];
  remaining(): number;
  push(...responses: readonly ScriptedResponse[]): void;
  /** resolve가 돌려줄 바인딩을 바꾼다(모델 전환 시험) */
  setBinding(binding: ModelBinding): void;
}

const FAKE_MODEL: Model<Api> = {
  id: "fake-1",
  name: "Fake model",
  api: "fake-api",
  provider: "fake",
  baseUrl: "http://localhost",
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  reasoning: false,
  contextWindow: 100_000,
  maxTokens: 4096,
};

function usageOf(totalTokens: number): Usage {
  return {
    input: totalTokens,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function messageOf(
  response: ScriptedResponse & { kind: "message" },
  clock: Clock,
): AssistantMessage {
  return {
    role: "assistant",
    content: structuredClone([...response.content]),
    api: FAKE_MODEL.api,
    provider: FAKE_MODEL.provider,
    model: FAKE_MODEL.id,
    usage: usageOf(response.totalTokens ?? 10),
    stopReason: response.stopReason,
    timestamp: clock.now(),
  };
}

function eventsOf(
  response: ScriptedResponse & { kind: "message" },
  clock: Clock,
): AssistantMessageEvent[] {
  const final = messageOf(response, clock);
  const start: AssistantMessage = { ...final, content: [], stopReason: "stop", usage: usageOf(0) };
  const events: AssistantMessageEvent[] = [{ type: "start", partial: structuredClone(start) }];
  const partialContent: ScriptedBlock[] = [];
  for (const [contentIndex, block] of final.content.entries()) {
    const partial = (): AssistantMessage => ({
      ...start,
      content: structuredClone(partialContent),
    });
    if (block.type === "text") {
      partialContent.push({ type: "text", text: "" });
      events.push({ type: "text_start", contentIndex, partial: partial() });
      partialContent[contentIndex] = { type: "text", text: block.text };
      events.push({ type: "text_delta", contentIndex, delta: block.text, partial: partial() });
      events.push({ type: "text_end", contentIndex, content: block.text, partial: partial() });
    } else if (block.type === "thinking") {
      partialContent.push({ type: "thinking", thinking: "" });
      events.push({ type: "thinking_start", contentIndex, partial: partial() });
      partialContent[contentIndex] = { type: "thinking", thinking: block.thinking };
      events.push({
        type: "thinking_delta",
        contentIndex,
        delta: block.thinking,
        partial: partial(),
      });
      events.push({
        type: "thinking_end",
        contentIndex,
        content: block.thinking,
        partial: partial(),
      });
    } else {
      partialContent.push({ ...block, arguments: {} });
      events.push({ type: "toolcall_start", contentIndex, partial: partial() });
      partialContent[contentIndex] = block;
      events.push({
        type: "toolcall_delta",
        contentIndex,
        delta: JSON.stringify(block.arguments),
        partial: partial(),
      });
      events.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: partial() });
    }
  }
  events.push({ type: "done", reason: response.stopReason, message: final });
  return events;
}

function streamOf(
  events: readonly AssistantMessageEvent[],
  result: AssistantMessage,
): AssistantMessageEventStream {
  return {
    async *[Symbol.asyncIterator]() {
      await Promise.resolve();
      for (const event of events) yield structuredClone(event);
    },
    result: () => Promise.resolve(result),
  };
}

function notImplemented(name: string): never {
  throw new Bug(`fake-models: ${name} is not implemented`);
}

export function createFakeModels(options: {
  readonly clock: Clock;
  readonly script?: readonly ScriptedResponse[];
}): FakeModels {
  const { clock } = options;
  const script: ScriptedResponse[] = [...(options.script ?? [])];
  const requests: ModelRequest[] = [];
  let binding: ModelBinding = {
    role: "main",
    provider: FAKE_MODEL.provider,
    modelId: FAKE_MODEL.id,
    thinkingLevel: "off",
  };

  const resolved = (): ResolvedModel => ({
    binding,
    source: "default",
    trace: [],
    model: FAKE_MODEL,
    thinkingBudgetTokens: null,
    cachePolicy: {
      retention: "none",
      sessionKey: null,
      sites: [],
      maxBreakpoints: 4,
      midConversationSystem: true,
      midConversationToolChanges: true,
    },
  });

  const service: ModelService = {
    resolve: () => ok(resolved()),
    rebind(next) {
      binding = next;
      return ok(resolved());
    },
    stream: () => notImplemented("stream"),
    complete: () => notImplemented("complete"),
    streamFn: (ctx) => (_model, transcript, streamOptions) => {
      requests.push({
        stepId: ctx.stepId,
        messages: structuredClone(transcript.messages),
        signal: streamOptions?.signal,
      });
      const response = script.shift();
      if (response === undefined) {
        throw new Bug("fake-models: the script ran out of responses");
      }
      if (response.kind === "message") {
        return streamOf(eventsOf(response, clock), messageOf(response, clock));
      }
      const base: AssistantMessage = {
        role: "assistant",
        content: [],
        api: FAKE_MODEL.api,
        provider: FAKE_MODEL.provider,
        model: FAKE_MODEL.id,
        usage: usageOf(0),
        stopReason: "error",
        timestamp: clock.now(),
      };
      if (response.kind === "error") {
        const failed: AssistantMessage = {
          ...base,
          stopReason: "error",
          errorMessage: response.message,
        };
        return streamOf([{ type: "error", reason: "error", error: failed }], failed);
      }
      // stall: 신호가 켜질 때까지 기다린 뒤 부분 응답을 aborted로 낸다
      const partialText = response.partialText;
      const aborted: AssistantMessage = {
        ...base,
        content: partialText === undefined ? [] : [{ type: "text", text: partialText }],
        stopReason: "aborted",
        errorMessage: "aborted",
      };
      const signal = streamOptions?.signal;
      const waitAbort = new Promise<void>((resolve) => {
        if (signal === undefined || signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener("abort", () => {
          resolve();
        });
      });
      return {
        async *[Symbol.asyncIterator]() {
          yield {
            type: "start",
            partial: structuredClone({ ...base, stopReason: "stop" }),
          } satisfies AssistantMessageEvent;
          await waitAbort;
          yield {
            type: "error",
            reason: "aborted",
            error: structuredClone(aborted),
          } satisfies AssistantMessageEvent;
        },
        result: async () => {
          await waitAbort;
          return aborted;
        },
      };
    },
    list: () => [],
    addProvider: () => err({ kind: "provider_unavailable", message: "fake" }),
    registerProvider: () => () => {},
    usage: {
      totals: () => ({
        calls: 0,
        abortedCalls: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        totalTokens: 0,
        costTotal: 0,
      }),
      subscribe: () => () => {},
    },
    tokens: {
      estimateMessage: () => 0,
      estimateContext: () => ({
        tokens: 0,
        usageTokens: 0,
        trailingTokens: 0,
        lastUsageIndex: null,
      }),
      fromUsage: (usage) => usage.totalTokens,
    },
    classify: () => null,
  };

  return {
    service,
    requests,
    remaining: () => script.length,
    push: (...responses) => {
      script.push(...responses);
    },
    setBinding: (next) => {
      binding = next;
    },
  };
}
