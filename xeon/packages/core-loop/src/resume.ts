import { parse } from "@xeon/contracts";
import {
  StepCompletedPayloadSchema,
  StepStartedPayloadSchema,
  TurnCompletedPayloadSchema,
  TurnStartedPayloadSchema,
  type AssistantMessage,
  type ImageContent,
  type ItemId,
  type StepId,
  type ToolCall,
  type ToolResultMessage,
  type TurnId,
  type TurnOrigin,
  type Usage,
} from "@xeon/contracts/conversation";
import {
  ItemRecordedPayloadSchema,
  TurnAbortRequestedPayloadSchema,
  type DurableEventEnvelope,
  type EffectIntent,
  type ResumePlan,
  type StepCheckpoint,
} from "@xeon/contracts/records";
import type { ModelBinding, ResumeFrom } from "@xeon/contracts/services";
import type { ToolCallResume, TurnEntry } from "./loop/types.ts";
import { textAndImages } from "./turn-start.ts";

// L1.loop.spec §4.5 `next` 판별자별 재진입, §4.6 재개 진입. 이벤트로 열린 turn의 상태를 다시 만든다(순수 함수).

interface OpenStep {
  readonly stepId: StepId;
  readonly stepIndex: number;
  readonly completed: boolean;
  readonly assistant: {
    readonly itemId: ItemId;
    readonly message: AssistantMessage;
  } | null;
  /** 기록된 toolResult item (toolCallId → item) */
  readonly toolResults: ReadonlyMap<
    string,
    { readonly itemId: ItemId; readonly message: ToolResultMessage }
  >;
}

export interface OpenTurnReduction {
  readonly turnId: TurnId;
  readonly scopeId: string | null;
  /** `turn.started`에 기록된 입력 출처. 없으면(옛 기록) `user`다 */
  readonly origin: TurnOrigin;
  readonly requestId: string | null;
  readonly prompt: string;
  readonly images: readonly ImageContent[];
  /** `input.agent.before`가 추가한 item이 이미 기록됐다 */
  readonly hasPrestart: boolean;
  readonly stepCount: number;
  readonly usage: Usage | null;
  readonly lastAssistantItemId: ItemId | null;
  readonly abortCode: string | null;
  readonly completed: boolean;
  /** 마지막으로 시작한 단계 */
  readonly step: OpenStep | null;
}

function addUsage(a: Usage | null, b: Usage): Usage {
  if (a === null) return structuredClone(b);
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    ...(a.cacheWrite1h === undefined && b.cacheWrite1h === undefined
      ? {}
      : { cacheWrite1h: (a.cacheWrite1h ?? 0) + (b.cacheWrite1h ?? 0) }),
    ...(a.reasoning === undefined && b.reasoning === undefined
      ? {}
      : { reasoning: (a.reasoning ?? 0) + (b.reasoning ?? 0) }),
    totalTokens: a.totalTokens + b.totalTokens,
    cost: {
      input: a.cost.input + b.cost.input,
      output: a.cost.output + b.cost.output,
      cacheRead: a.cost.cacheRead + b.cost.cacheRead,
      cacheWrite: a.cost.cacheWrite + b.cost.cacheWrite,
      total: a.cost.total + b.cost.total,
    },
  };
}

interface MutableStep {
  stepId: StepId;
  stepIndex: number;
  completed: boolean;
  assistant: { itemId: ItemId; message: AssistantMessage } | null;
  toolResults: Map<string, { itemId: ItemId; message: ToolResultMessage }>;
}

/** 열린 turn의 내구 이벤트(활성 가지, 루트 → leaf 순서)를 읽어 재진입에 필요한 상태를 만든다 */
export function reduceOpenTurn(
  events: readonly DurableEventEnvelope[],
  turnId: TurnId,
): OpenTurnReduction | undefined {
  let started = false;
  let scopeId: string | null = null;
  let origin: TurnOrigin = "user";
  let requestId: string | null = null;
  let prompt = "";
  let images: readonly ImageContent[] = [];
  let hasPrestart = false;
  let stepCount = 0;
  let usage: Usage | null = null;
  let lastAssistantItemId: ItemId | null = null;
  let abortCode: string | null = null;
  let completed = false;
  let step: MutableStep | null = null;
  let sawInput = false;

  for (const event of events) {
    if (event.turnId !== turnId) continue;
    if (event.kind === "item.recorded") {
      const payload = parse(ItemRecordedPayloadSchema, event.payload);
      if (!payload.ok) continue;
      const item = payload.value.item;
      if (!started) {
        // turn.started보다 앞선 item은 turn 입력이다
        if (!sawInput && (item.kind === "user" || item.kind === "custom")) {
          const flat = textAndImages(item.message.content);
          prompt = flat.text;
          images = flat.images;
          sawInput = true;
        }
        continue;
      }
      if (step === null) {
        if (item.kind === "custom") hasPrestart = true;
        continue;
      }
      if (item.kind === "assistant") {
        step.assistant = { itemId: item.itemId, message: item.message };
        lastAssistantItemId = item.itemId;
        usage = addUsage(usage, item.message.usage);
      } else if (item.kind === "toolResult") {
        step.toolResults.set(item.message.toolCallId, {
          itemId: item.itemId,
          message: item.message,
        });
      }
    } else if (event.kind === "turn.started") {
      const payload = parse(TurnStartedPayloadSchema, event.payload);
      started = true;
      if (payload.ok) {
        scopeId = payload.value.scopeId;
        requestId = payload.value.requestId;
        origin = payload.value.origin ?? "user";
      }
    } else if (event.kind === "step.started") {
      const payload = parse(StepStartedPayloadSchema, event.payload);
      if (payload.ok && event.stepId !== null) {
        step = {
          stepId: event.stepId,
          stepIndex: payload.value.stepIndex,
          completed: false,
          assistant: null,
          toolResults: new Map(),
        };
      }
    } else if (event.kind === "step.completed") {
      const payload = parse(StepCompletedPayloadSchema, event.payload);
      if (payload.ok && step !== null) {
        step.completed = true;
        stepCount += 1;
      }
    } else if (event.kind === "turn.abort_requested") {
      const payload = parse(TurnAbortRequestedPayloadSchema, event.payload);
      abortCode = payload.ok ? payload.value.reason.code : "aborted";
    } else if (event.kind === "turn.completed") {
      const payload = parse(TurnCompletedPayloadSchema, event.payload);
      completed = payload.ok;
    }
  }
  if (!started) return undefined;
  const lastStep: OpenStep | null =
    step === null
      ? null
      : {
          stepId: step.stepId,
          stepIndex: step.stepIndex,
          completed: step.completed,
          assistant: step.assistant,
          toolResults: step.toolResults,
        };
  return {
    turnId,
    scopeId,
    origin,
    requestId,
    prompt,
    images,
    hasPrestart,
    stepCount,
    usage,
    lastAssistantItemId,
    abortCode,
    completed,
    step: lastStep,
  };
}

function toolCallsOf(message: AssistantMessage): ToolCall[] {
  return message.content.filter((block): block is ToolCall => block.type === "toolCall");
}

function bindingOf(checkpoint: StepCheckpoint | null): ModelBinding | null {
  if (checkpoint === null) return null;
  return {
    role: "main",
    provider: checkpoint.model.provider,
    modelId: checkpoint.model.modelId,
    thinkingLevel: checkpoint.model.thinkingLevel,
  };
}

/** 도구 호출마다 기록된 결과 → 재실행 → 파이프라인 새로 실행 순으로 분류한다 */
function classifyCalls(
  step: OpenStep,
  reruns: readonly { readonly intent: EffectIntent }[],
): readonly ToolCallResume[] {
  if (step.assistant === null) return [];
  const rerunByCall = new Map(reruns.map((rerun) => [rerun.intent.toolCallId, rerun.intent]));
  return toolCallsOf(step.assistant.message).map((call): ToolCallResume => {
    const recorded = step.toolResults.get(call.id);
    if (recorded !== undefined) {
      return {
        kind: "recorded",
        toolCallId: call.id,
        itemId: recorded.itemId,
        message: recorded.message,
      };
    }
    const intent = rerunByCall.get(call.id);
    if (intent !== undefined) return { kind: "rerun", toolCallId: call.id, intent };
    return { kind: "run", toolCall: call };
  });
}

export type ReentryPlan =
  | { readonly kind: "nothing" }
  | { readonly kind: "close"; readonly reason: "abort_requested" | "owner_cancelled" }
  | { readonly kind: "enter"; readonly entry: TurnEntry; readonly from: ResumeFrom };

/** 마지막 체크포인트와 그 뒤 이벤트로 어디서 이어갈지 정한다 (L1.loop.spec §4.5 표) */
export function planReentry(input: {
  readonly reduction: OpenTurnReduction;
  readonly plan: Pick<ResumePlan, "checkpoint" | "reruns" | "abortRequestedTurn">;
  readonly cancelledByOwner: boolean;
}): ReentryPlan {
  const { reduction, plan } = input;
  if (reduction.completed) return { kind: "nothing" };
  if (plan.abortRequestedTurn === reduction.turnId || reduction.abortCode !== null) {
    return { kind: "close", reason: "abort_requested" };
  }
  if (input.cancelledByOwner) return { kind: "close", reason: "owner_cancelled" };

  const checkpoint =
    plan.checkpoint !== null && plan.checkpoint.turnId === reduction.turnId
      ? plan.checkpoint
      : null;
  const step = reduction.step;
  if (step === null) {
    return {
      kind: "enter",
      from: "turn_start",
      entry: {
        kind: "fresh",
        prompt: reduction.prompt,
        images: reduction.images,
        skipBeforeStart: reduction.hasPrestart,
      },
    };
  }
  if (!step.completed) {
    if (step.assistant === null) {
      return {
        kind: "enter",
        from: "request",
        entry: {
          kind: "request",
          stepIndex: step.stepIndex,
          adoptStepId: step.stepId,
          binding: bindingOf(checkpoint),
        },
      };
    }
    const awaitInput =
      checkpoint !== null && checkpoint.stepId === step.stepId && checkpoint.next === "await_input";
    return {
      kind: "enter",
      from: awaitInput ? "await_input" : "tools",
      entry: {
        kind: "tools",
        resume: {
          stepIndex: step.stepIndex,
          stepId: step.stepId,
          assistantItemId: step.assistant.itemId,
          assistant: step.assistant.message,
          calls: classifyCalls(step, plan.reruns),
          binding: bindingOf(checkpoint),
          awaitInput,
        },
      },
    };
  }
  // 단계가 끝났다: 체크포인트의 next로 이어간다
  const next =
    checkpoint !== null && checkpoint.stepId === step.stepId ? checkpoint.next : "request";
  if (next === "turn_end")
    return { kind: "enter", from: "turn_end", entry: { kind: "turn_end", closing: null } };
  return {
    kind: "enter",
    from: "request",
    entry: {
      kind: "request",
      stepIndex: step.stepIndex + 1,
      adoptStepId: null,
      binding: bindingOf(checkpoint),
    },
  };
}
