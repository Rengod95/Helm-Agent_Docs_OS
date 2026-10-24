import { Bug, err, ok, type Result } from "@xeon/contracts";
import type {
  AgentMessage,
  AssistantMessage,
  LifecycleEvent,
  ToolResultMessage,
} from "@xeon/contracts/conversation";
import type {
  AgentBeforeSettlePayload,
  BoundaryValue,
  PostItem,
  TurnEndPayload,
} from "@xeon/contracts/extensions";
import type { DurableEventDraft, PendingToolCall } from "@xeon/contracts/records";
import type { ToolCallOutcome } from "@xeon/contracts/services";
import { canContinue, stepLimitReached } from "../budget.ts";
import { finalizeBoundary } from "../checkpoint.ts";
import { commitWithRetry } from "../commit.ts";
import { stepEndRequest, type PlacedInput } from "../commits.ts";
import {
  boundarySignal,
  commitFailure,
  currentStep,
  dispatchKey,
  nextBinding,
  type TurnRun,
} from "./turn-run.ts";
import type { LoopFailure, StepNext } from "./types.ts";

// L1.loop.spec §3.2 단계 6 `endStep`, §4.2 규칙 4. `turn_end` chain → 정착 후보 판정 → `agent_before_settle` chain →
// `finalizeBoundary` → 계속 판정 → C5(T4) 커밋(배치 포함) → `StepNext`.
// 원본의 `finishTurn`·`getSteeringMessages` 콜백 자리다. 배치된 입력은 반환값(`StepNext.placed`)으로 돌아온다. 콜백은 없다.

type StepCompletedNote = Extract<LifecycleEvent, { readonly type: "step.completed" }>;

function stepCompletedOf(notes: readonly LifecycleEvent[]): StepCompletedNote | undefined {
  for (const note of notes) if (note.type === "step.completed") return note;
  return undefined;
}

/** 대기 중 steer 입력을 BoundaryContextPreview.pendingMessages 모양으로 보인다 */
function placedPreview(item: PostItem, timestamp: number): AgentMessage {
  if (item.kind === "user") {
    return {
      role: "user",
      content: typeof item.content === "string" ? item.content : [...item.content],
      timestamp,
    };
  }
  return {
    role: "custom",
    customType: item.customType,
    content: typeof item.content === "string" ? item.content : [...item.content],
    display: item.display,
    details: item.details ?? null,
    timestamp,
  };
}

function hardStopped(message: AssistantMessage): boolean {
  return message.stopReason === "error" || message.stopReason === "aborted";
}

export interface StepEndInput {
  readonly message: AssistantMessage;
  /** 이 단계의 도구 결과(호출 순서). 도구 호출이 없으면 빈 배열 */
  readonly outcomes: readonly ToolCallOutcome[];
  /** 배치의 모든 결과가 terminate였다 */
  readonly terminate: boolean;
  /** 훅 payload의 컨텍스트 미리보기에 쓰는 메시지(요청에 쓴 컨텍스트 + 이 단계의 메시지) */
  readonly contextMessages: readonly AgentMessage[];
}

export async function endStep(
  run: TurnRun,
  input: StepEndInput,
): Promise<Result<StepNext, LoopFailure>> {
  const { ctx, state, mapper, thread, spec, scope, running, threadId, turnId } = run;
  const step = currentStep(run);
  running.phase = "settling";
  const message = state.assistant ?? input.message;
  const calls = message.content.filter((block) => block.type === "toolCall");

  // (a) 결과 없는 호출이 없어야 한다. 배치가 취소·절단 호출까지 닫았다(L1.loop.spec §3.3 규칙 4)
  const answered = new Set(input.outcomes.map((outcome) => outcome.toolCall.id));
  const missing = calls.filter((call) => !answered.has(call.id));
  // error·aborted 응답은 도구를 부르지 않고 끝난다. 그 응답의 호출에는 결과 item을 만들지 않는다
  if (!hardStopped(message) && missing.length > 0) {
    throw new Bug(`loop.unanswered_tool_calls: ${missing.map((call) => call.id).join(",")}`);
  }
  const toolResults: ToolResultMessage[] = input.outcomes.map((outcome) => outcome.message);

  // 매퍼를 단계 끝으로 진행시켜 step.completed 값을 얻는다
  const notes = mapper.map({ type: "turn_end", message, toolResults });
  const completed = stepCompletedOf(notes);
  if (completed === undefined) throw new Bug("loop.mapper_gave_no_step_completed");

  const stopReason = message.stopReason;
  const hardStop = stopReason === "error" || stopReason === "aborted";
  const deferred = stopReason === "deferred";
  const totals = mapper.totals();
  const abortRequested = scope.signal.aborted;
  const stepLimit = stepLimitReached({ maxSteps: state.maxSteps }, totals.stepCount);
  const externalStop = spec.driveSignal?.aborted === true;
  // 자식 turn의 입력 토큰 한도: 이 turn이 보낸 입력 토큰 합이 한도에 이르면 다음 요청 대신 끝낸다(L1.loop.spec §4.13 6단계)
  const childTokenLimit =
    state.childMaxInputTokens !== null && (totals.usage?.input ?? 0) >= state.childMaxInputTokens;
  const stopping = thread.stopRequested;
  const steerRead = ctx.tasks.inputs.peek(threadId, ["steer"]);
  if (!steerRead.ok) {
    // 대기 중인 steer를 읽지 못하면 이 단계 끝을 정할 수 없다. 단계 끝 커밋 전이라 turn은 열린 채 실패로 알린다
    return err({ kind: "read_failed", detail: `steer queue: ${steerRead.error.kind}` });
  }
  const steerQueued = steerRead.value;
  const hasMore = calls.length > 0 && !input.terminate;
  const steerPending = steerQueued.length > 0;
  const candidate = hardStop || deferred || (!hasMore && !steerPending);
  const gateExhausted = state.gateContinues >= state.gateMaxContinues;
  const canContinueNow = canContinue({
    hardStop: hardStop || deferred,
    abortRequested,
    stepLimit: stepLimit || childTokenLimit,
    externalStop,
    stopping,
    gateExhausted,
  });

  const preview = {
    contextMessages: structuredClone([...input.contextMessages]),
    llmMessages: structuredClone(ctx.context.convertToLlm(input.contextMessages)),
    pendingMessages: structuredClone(
      steerQueued.map((queued) => placedPreview(queued.item, ctx.clock.now())),
    ),
    canContinue: canContinueNow,
  };
  const verdictContext = {
    threadId,
    turnId,
    stepId: step.stepId,
    lookup: ctx.kindLookup,
    committed: () => false,
    canContinue: canContinueNow,
  };
  const finalize = (value: BoundaryValue): BoundaryValue => {
    const verdict = finalizeBoundary(value, verdictContext);
    if (!verdict.ok) {
      ctx.logger.warn("loop.boundary_invalid", { threadId, turnId, issues: [...verdict.issues] });
    }
    return verdict.ok ? verdict.value : { entries: [], continue: false };
  };

  // (b) turn_end chain
  const turnEndPayload: TurnEndPayload = {
    stepIndex: step.stepIndex,
    stepId: step.stepId,
    message: structuredClone(message),
    toolResults: structuredClone(toolResults),
    messageItemId: state.assistantItemId ?? completed.assistantItemId ?? ctx.ids.next("itm"),
    toolResultItemIds: [...completed.toolResultItemIds],
    context: preview,
  };
  const turnEnd = await ctx.ext.dispatch("turn_end", turnEndPayload, {
    threadId,
    dispatchKey: dispatchKey(run, step.stepId, "turn_end"),
    initial: { entries: [], continue: false },
    finalize,
    signal: scope.signal,
  });

  // (c)(d) 정착 후보면 agent_before_settle chain
  let settleEntries: readonly DurableEventDraft[] = [];
  let settleContinue = false;
  if (candidate) {
    const outcome: AgentBeforeSettlePayload["outcome"] =
      stopReason === "aborted" ? "aborted" : stopReason === "error" ? "error" : "completed";
    const settle = await ctx.ext.dispatch(
      "agent_before_settle",
      { turnId, context: preview, outcome },
      {
        threadId,
        dispatchKey: dispatchKey(run, step.stepId, "agent_before_settle"),
        initial: { entries: [], continue: false },
        finalize,
        signal: scope.signal,
      },
    );
    settleEntries = settle.value.entries;
    settleContinue = settle.value.continue;
  }

  // (e)(f) 계속 여부
  const entries = [...turnEnd.value.entries, ...settleEntries];
  const gateWant =
    candidate && !hardStop && !deferred && (turnEnd.value.continue || settleContinue);
  const gateContinue = gateWant && canContinueNow;
  const continuing = hasMore || gateContinue;
  const wouldContinue = continuing || steerPending;
  const forcedEnd = hardStop || abortRequested || deferred;
  const limitEnd = wouldContinue && (stepLimit || childTokenLimit || externalStop);
  const leaveOpen = !forcedEnd && !limitEnd && wouldContinue && stopping;
  const endNow = forcedEnd || limitEnd || leaveOpen || deferred;
  if (deferred) {
    state.endReason = "deferred";
    run.emitter.emit({ type: "turn.updated", threadId, turnId, stepId: null, status: "waiting" });
  } else if (limitEnd) {
    state.endReason = childTokenLimit
      ? "child_limit"
      : stepLimit
        ? state.stepLimitReason
        : "external";
  } else if (leaveOpen) state.endReason = "stopped";

  // (g) T4: 경계 기여를 받아 한 커밋에 넣는다
  const signal = boundarySignal(run, "step_end", step.stepId);
  const contribution = await ctx.ext.boundary.prepare(signal);
  const binding = nextBinding(run);
  if (!binding.ok) {
    await ctx.ext.boundary.settle(signal, "failed");
    return err(binding.error);
  }
  const pending: PendingToolCall[] = [];
  const planned = stepEndRequest(ctx.drafter, {
    step,
    clock: ctx.clock,
    ids: ctx.ids,
    tasks: ctx.tasks,
    stepCompleted: {
      stepIndex: completed.stepIndex,
      status: completed.status,
      stopReason: completed.stopReason,
      assistantItemId: completed.assistantItemId,
      toolResultItemIds: [...completed.toolResultItemIds],
    },
    entries,
    contributions: contribution.drafts,
    drain: !endNow,
    continuing,
    endNow,
    endNext: deferred ? "await_input" : leaveOpen ? "request" : "turn_end",
    priorConsumedSeq: state.consumedSeq,
    model: {
      provider: binding.value.provider,
      modelId: binding.value.modelId,
      thinkingLevel: binding.value.thinkingLevel,
    },
    pendingToolCalls: pending,
  });
  run.emitter.flush();
  const committed = commitWithRetry(ctx.session, planned.request);
  if (!committed.ok) {
    await ctx.ext.boundary.settle(signal, "failed");
    return err(commitFailure(committed));
  }
  await ctx.ext.boundary.settle(signal, "committed");
  const outcome = planned.outcome();
  if (outcome === undefined) throw new Bug("loop.step_end_not_built");
  state.consumedSeq = outcome.consumedSeq;
  state.leaseRefs = outcome.leaseRefs;
  state.scopeRef = outcome.scopeRef;
  state.pinned = binding.value;
  const placed = outcome.placed.map((entry: PlacedInput) => {
    mapper.bindItem({ message: entry.message }, entry.itemId);
    return { itemId: entry.itemId, message: entry.message };
  });
  if (gateContinue && !hasMore && placed.length === 0) state.gateContinues += 1;

  // 다음 단계 준비
  state.assistant = null;
  state.assistantItemId = null;
  state.assistantParts = [];
  state.pointSeq = 0;
  running.stepIndex = step.stepIndex;

  if (deferred) return ok({ kind: "stop", reason: "deferred" });
  if (leaveOpen) return ok({ kind: "stop", reason: "stopped" });
  if (endNow) return ok({ kind: "settle" });
  return ok(outcome.next === "request" ? { kind: "request", placed } : { kind: "settle" });
}
