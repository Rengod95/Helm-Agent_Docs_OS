import { err, ok, type Result } from "@xeon/contracts";
import type { AssistantMessage, Usage } from "@xeon/contracts/conversation";
import type {
  CachePolicy,
  ModelBinding,
  ModelCallRequest,
  ModelError,
  ModelRole,
  ModelService,
  ResolvedModel,
  TokenEstimator,
} from "@xeon/contracts/services";
import { tokenEstimator } from "./builders.ts";

// core-context 시험용 xeon.models 대역. 요약 호출(complete)을 차례대로 준비한 응답으로 대신한다.
// 같은 층 패키지(core-models)는 import할 수 없어서(DR-14) 테이프 가짜 대신 이 파일의 대역을 쓴다. 호출 기록으로
// 역할(summary)과 cacheRetention(none)을 확인한다.

type FakeReply =
  | { readonly kind: "text"; readonly text: string; readonly usage?: Partial<Usage> }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "aborted" }
  | { readonly kind: "length"; readonly text: string }
  | { readonly kind: "toolCall" };

interface SummaryCall {
  readonly role: ModelRole;
  readonly stepId: string | null;
  readonly cacheRetention: string | undefined;
  readonly maxTokens: number | undefined;
  readonly system: string;
  readonly prompt: string;
}

export interface FakeModelsOptions {
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly estimator?: TokenEstimator;
}

export interface FakeModels {
  readonly models: Pick<ModelService, "tokens" | "complete" | "resolve" | "rebind">;
  readonly calls: SummaryCall[];
  /** 다음 요약 호출들의 응답. 비어 있으면 호출이 Bug다 */
  readonly replies: FakeReply[];
  /** 값이 있으면 resolve가 이 오류로 실패한다 */
  readonly resolveFailure: { current: ModelError | undefined };
  /** 값이 있으면 rebind가 이 오류로 실패한다 */
  readonly rebindFailure: { current: ModelError | undefined };
  /** 요약 응답을 꺼낸 직후 부르는 훅. 요약하는 동안 가지가 자라는 상황을 만든다 */
  readonly hooks: { afterComplete: (() => void) | undefined };
}

function usageOf(partial: Partial<Usage> | undefined): Usage {
  return {
    input: partial?.input ?? 1000,
    output: partial?.output ?? 200,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: partial?.totalTokens ?? 1200,
    cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
  };
}

function textBlocks(value: string): AssistantMessage["content"] {
  return [{ type: "text", text: value }];
}

/** 준비한 응답을 pi-ai 종결 메시지 모양으로 바꾼다 */
function messageOf(reply: FakeReply, modelId: string): AssistantMessage {
  const base = {
    role: "assistant" as const,
    api: "tape-messages",
    provider: "fake",
    model: modelId,
    timestamp: 0,
  };
  if (reply.kind === "text") {
    return {
      ...base,
      content: textBlocks(reply.text),
      usage: usageOf(reply.usage),
      stopReason: "stop",
    };
  }
  if (reply.kind === "length") {
    return {
      ...base,
      content: textBlocks(reply.text),
      usage: usageOf(undefined),
      stopReason: "length",
    };
  }
  if (reply.kind === "error") {
    return {
      ...base,
      content: [],
      usage: usageOf(undefined),
      stopReason: "error",
      errorMessage: reply.message,
    };
  }
  if (reply.kind === "aborted") {
    return { ...base, content: [], usage: usageOf(undefined), stopReason: "aborted" };
  }
  return {
    ...base,
    content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "x" } }],
    usage: usageOf(undefined),
    stopReason: "toolUse",
  };
}

export function fakeModels(options: FakeModelsOptions = {}): FakeModels {
  const calls: SummaryCall[] = [];
  const replies: FakeReply[] = [];
  const resolveFailure: { current: ModelError | undefined } = { current: undefined };
  const rebindFailure: { current: ModelError | undefined } = { current: undefined };
  const hooks: { afterComplete: (() => void) | undefined } = { afterComplete: undefined };
  const cachePolicy: CachePolicy = {
    retention: "none",
    sessionKey: null,
    sites: [],
    maxBreakpoints: 4,
    midConversationSystem: true,
    midConversationToolChanges: true,
  };

  function resolved(binding: ModelBinding): ResolvedModel {
    return {
      binding,
      source: "role",
      trace: [{ step: "role", ref: `${binding.provider}/${binding.modelId}` }],
      model: {
        id: binding.modelId,
        name: binding.modelId,
        api: "tape-messages",
        provider: binding.provider,
        baseUrl: "http://127.0.0.1:9/fake",
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        reasoning: false,
        contextWindow: options.contextWindow ?? 200_000,
        maxTokens: options.maxTokens ?? 8192,
      },
      thinkingBudgetTokens: null,
      cachePolicy,
    };
  }

  const models: FakeModels["models"] = {
    tokens: options.estimator ?? tokenEstimator,
    resolve(role): Result<ResolvedModel, ModelError> {
      if (resolveFailure.current !== undefined) return err(resolveFailure.current);
      return ok(
        resolved({ role, provider: "fake", modelId: `${role}-model`, thinkingLevel: "off" }),
      );
    },
    rebind(binding): Result<ResolvedModel, ModelError> {
      if (rebindFailure.current !== undefined) return err(rebindFailure.current);
      return ok(resolved(binding));
    },
    complete(request: ModelCallRequest): Promise<AssistantMessage> {
      const system = request.context.systemPrompt ?? "";
      const first = request.context.messages[0];
      const prompt =
        first?.role === "user" && typeof first.content !== "string"
          ? first.content.map((block) => (block.type === "text" ? block.text : "")).join("")
          : "";
      calls.push({
        role: request.role,
        stepId: request.stepId,
        cacheRetention: request.options?.cacheRetention,
        maxTokens: request.options?.maxTokens,
        system,
        prompt,
      });
      const reply = replies.shift();
      if (reply === undefined) return Promise.reject(new Error("fakeModels: no reply prepared"));
      hooks.afterComplete?.();
      return Promise.resolve(messageOf(reply, request.resolved.binding.modelId));
    },
  };
  return { models, calls, replies, resolveFailure, rebindFailure, hooks };
}
