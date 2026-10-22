import { Bug, err, ok, type Result } from "@xeon/contracts";
import type {
  AgentMessage,
  AssistantMessage,
  EventId,
  ItemId,
  PartRecord,
  StepId,
  ThreadId,
  TurnId,
} from "@xeon/contracts/conversation";
import {
  STEP_CHECKPOINT_SCHEMA_VERSION,
  type CommitRequest,
  type DurableEventDraft,
  type StepCheckpoint,
} from "@xeon/contracts/records";
import type {
  AbortReason,
  ModelBinding,
  ResolvedModel,
  TaskScope,
  ToolRunContext,
  ToolRunDrafts,
} from "@xeon/contracts/services";
import type { BoundarySignal } from "@xeon/ext-host";
import { commitWithRetry, describeCommitFailure, type CommitOutcome } from "../commit.ts";
import type { PreludeItem, StepRef } from "../commits.ts";
import { createAgentEventMapper, type BoundAgentEventMapper } from "../event-mapper.ts";
import type { LoopContext, RunningTurn, ThreadRuntime } from "../types.ts";
import {
  createVolatileEmitter,
  isVolatileNotification,
  type VolatileEmitter,
} from "../volatile.ts";
import type { LoopFailure, TurnRunSpec } from "./types.ts";

// 한 turn 실행이 단계 함수들 사이에서 나눠 쓰는 상태와 도우미. 단계 함수는 이 값을 받아 순서대로 부른다(adr.0009 §3.3).

/** turn을 열어 둔 채 멈추는 이유, 또는 한도 도달로 끝나는 이유(T6 status 결정에 쓴다) */
type EndReason = "step_limit" | "external" | "stopped" | "deferred";

interface RunState {
  stepIndex: number;
  binding: ModelBinding | null;
  pinned: ModelBinding | null;
  /** 응답과 같은 커밋(T3)에 넣을 system·custom item */
  prelude: PreludeItem[];
  assistant: AssistantMessage | null;
  assistantItemId: ItemId | null;
  assistantParts: readonly PartRecord[];
  consumedSeq: number;
  leaseRefs: readonly EventId[];
  scopeRef: EventId | null;
  gateContinues: number;
  endReason: EndReason | null;
  /** 재개로 같은 단계의 요청을 다시 보낸다: 그 단계의 `step.started`는 이미 기록됨 */
  adoptFirstStep: boolean;
  /** 이 실행이 낸 메시지(`agent_end` tap의 messages) */
  readonly newMessages: AgentMessage[];
  maxSteps: number;
  /** `before_agent_start`가 바꾼 기본 프롬프트(없으면 서비스 기본값). 접두가 기록된 뒤에는 조립이 기록본을 쓴다 */
  basePrompt: string;
  /** 단계 안에서 같은 지점이 여러 번 불릴 때 dispatchKey를 구별하는 순번 */
  pointSeq: number;
  /** 첫 단계를 열 때 `agent_start`를 낸다 */
  agentStarted: boolean;
}

export interface TurnRun {
  readonly ctx: LoopContext;
  readonly spec: TurnRunSpec;
  readonly thread: ThreadRuntime;
  readonly running: RunningTurn;
  readonly scope: TaskScope;
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly mapper: BoundAgentEventMapper;
  readonly emitter: VolatileEmitter;
  readonly state: RunState;
}

export function createTurnRun(ctx: LoopContext, spec: TurnRunSpec): TurnRun {
  const { thread, turnId, scope } = spec;
  const threadId = thread.threadId;
  if (thread.running === null) throw new Bug("loop.not_running");
  const running: RunningTurn = thread.running;
  const firstStepIndex =
    spec.entry.kind === "request"
      ? spec.entry.stepIndex
      : spec.entry.kind === "tools"
        ? spec.entry.resume.stepIndex + 1
        : spec.priorStepCount;
  const mapper = createAgentEventMapper(
    { threadId, turnId, startStepIndex: firstStepIndex, ids: ctx.ids },
    {
      ...(spec.entry.kind === "request" && spec.entry.adoptStepId !== null
        ? { adoptStepId: spec.entry.adoptStepId }
        : {}),
      priorStepCount: spec.priorStepCount,
      priorUsage: spec.priorUsage,
      priorLastStopReason: spec.priorLastStop,
      priorLastErrorMessage: spec.priorLastError,
      priorLastAssistantItemId: spec.priorFinalItemId,
    },
  );
  const emitter = createVolatileEmitter({
    session: ctx.session,
    clock: ctx.clock,
    ids: ctx.ids,
    threadId,
    turnId,
    logger: ctx.logger,
  });
  const state: RunState = {
    stepIndex: firstStepIndex,
    binding: null,
    pinned:
      spec.entry.kind === "request"
        ? spec.entry.binding
        : spec.entry.kind === "tools"
          ? spec.entry.resume.binding
          : null,
    prelude: [],
    assistant: null,
    assistantItemId: null,
    assistantParts: [],
    consumedSeq: spec.consumedSeq,
    leaseRefs: spec.leaseRefs,
    scopeRef: spec.scopeRef,
    gateContinues: 0,
    endReason: null,
    adoptFirstStep: spec.entry.kind === "request" && spec.entry.adoptStepId !== null,
    newMessages: [],
    maxSteps: ctx.settings.maxSteps(threadId),
    basePrompt: ctx.basePrompt,
    pointSeq: 0,
    agentStarted: false,
  };
  return { ctx, spec, thread, running, scope, threadId, turnId, mapper, emitter, state };
}

// ── 단계와 커밋 ──────────────────────────────────────────────────────

/** 열린 단계. 단계가 열리지 않았으면 루프 불변식 위반이다 */
export function currentStep(run: TurnRun): StepRef {
  const snapshot = run.mapper.snapshot();
  if (snapshot.stepId === null) throw new Bug("loop.no_open_step");
  return {
    threadId: run.threadId,
    turnId: run.turnId,
    stepId: snapshot.stepId,
    stepIndex: snapshot.stepIndex,
  };
}

export function commitFailure(outcome: Extract<CommitOutcome, { ok: false }>): LoopFailure {
  return { kind: "commit_failed", detail: describeCommitFailure(outcome.error) };
}

/** 묶어 둔 휘발 델타를 먼저 내고 커밋한다. 실패는 값으로 돌려준다 */
export function commitStep(run: TurnRun, request: CommitRequest): Result<void, LoopFailure> {
  run.emitter.flush();
  const outcome = commitWithRetry(run.ctx.session, request);
  return outcome.ok ? ok(undefined) : err(commitFailure(outcome));
}

export function dispatchKey(run: TurnRun, stepId: StepId | null, suffix: string): string {
  return `${stepId ?? run.turnId}:${suffix}`;
}

/** 같은 지점이 한 단계에서 여러 번 불려도 dispatchKey가 겹치지 않게 한다(재개 때 같은 자리는 같은 키) */
export function nextPointSeq(run: TurnRun): number {
  run.state.pointSeq += 1;
  return run.state.pointSeq;
}

/** 메시지의 안정된 이름: 어시스턴트는 하나, 도구 결과는 toolCallId, 그 밖은 역할과 순번 */
export function messageIdentity(run: TurnRun, message: AgentMessage): string {
  if (message.role === "assistant") return "assistant";
  if (message.role === "toolResult") return message.toolCallId;
  return `${message.role}:${nextPointSeq(run)}`;
}

export function overrides(run: TurnRun): { readonly scopeId?: string } {
  return run.spec.scopeId === null ? {} : { scopeId: run.spec.scopeId };
}

export function tapOptions(
  run: TurnRun,
  key: string,
): { readonly threadId: ThreadId; readonly dispatchKey: string; readonly signal: AbortSignal } {
  return { threadId: run.threadId, dispatchKey: key, signal: run.scope.signal };
}

export function boundarySignal(
  run: TurnRun,
  kind: BoundarySignal["kind"],
  stepId: StepId | undefined,
): BoundarySignal {
  return {
    threadId: run.threadId,
    kind,
    turnId: run.turnId,
    ...(stepId === undefined ? {} : { stepId }),
    ...(run.spec.leaseId === null ? {} : { drivenBy: run.spec.leaseId }),
  };
}

export function emitNotifications(
  run: TurnRun,
  notes: ReturnType<BoundAgentEventMapper["map"]>,
): void {
  for (const note of notes) {
    if (isVolatileNotification(note)) run.emitter.emit(note);
  }
}

/** 활성 가지의 마지막 이벤트. 피드가 알려 준 값이 없으면 가지를 읽는다 */
export async function currentLeaf(run: TurnRun): Promise<Result<EventId, LoopFailure>> {
  const { thread, ctx, threadId } = run;
  if (thread.leaf !== null) return ok(thread.leaf);
  let last: EventId | null = null;
  for await (const read of ctx.session.readBranch(threadId)) {
    if (!read.ok) return err({ kind: "read_failed", detail: `active branch: ${read.error.kind}` });
    last = read.value.id;
  }
  if (last === null) throw new Bug("loop.thread_has_no_events");
  thread.leaf = last;
  return ok(last);
}

// ── 모델 ─────────────────────────────────────────────────────────────

function remember(run: TurnRun, resolved: ResolvedModel): ResolvedModel {
  run.state.binding = resolved.binding;
  run.state.pinned = resolved.binding;
  return resolved;
}

/** 단계에 쓸 모델. 고정된 바인딩이 있으면 다시 묶고, 못 묶으면 역할 표로 해석한다 */
export function resolveModel(run: TurnRun): Result<ResolvedModel, LoopFailure> {
  const { ctx } = run;
  const pinned = run.state.pinned;
  if (pinned !== null) {
    const rebound = ctx.models.rebind(pinned);
    if (rebound.ok) return ok(remember(run, rebound.value));
    ctx.logger.warn("loop.rebind_failed", {
      threadId: run.threadId,
      turnId: run.turnId,
      kind: rebound.error.kind,
    });
  }
  const resolved = ctx.models.resolve("main", overrides(run));
  if (!resolved.ok) return err({ kind: "model_unavailable", detail: resolved.error.kind });
  return ok(remember(run, resolved.value));
}

/** 다음 단계에 쓸 바인딩(체크포인트 `model` 필드). 해석에 실패하면 지금 값을 이어 쓴다 */
export function nextBinding(run: TurnRun): Result<ModelBinding, LoopFailure> {
  const resolved = run.ctx.models.resolve("main", overrides(run));
  if (resolved.ok) return ok(resolved.value.binding);
  const current = run.state.binding;
  if (current === null) return err({ kind: "model_unavailable", detail: resolved.error.kind });
  return ok(current);
}

// ── 도구 실행 맥락 ───────────────────────────────────────────────────

function rawDraft(
  run: TurnRun,
  kind: DurableEventDraft["kind"],
  step: StepRef,
  payload: unknown,
): DurableEventDraft {
  return {
    id: run.ctx.ids.next("evt"),
    kind,
    version: 1,
    threadId: run.threadId,
    turnId: run.turnId,
    stepId: step.stepId,
    causationId: null,
    correlationId: run.turnId,
    payload,
    durable: true,
  };
}

/** core-tools에 넘기는 실행 맥락. 단계마다 새로 만든다 */
export function toolRunContext(run: TurnRun, step: StepRef): ToolRunContext {
  const { ctx, thread, threadId, turnId, state } = run;
  const drafts: ToolRunDrafts = {
    // core-tools가 effect.result와 같은 커밋에 넣으므로 낙인된 초안을 그대로 낸다(F ToolRunDrafts). 낙인은 객체 정체성이다.
    // 낙인이 없으면 도구는 effect.result만 커밋하고 item을 기록하지 못한다(ToolCallOutcome.itemId가 null)
    toolResultItem: (input) =>
      ctx.drafter.stamp(
        rawDraft(run, "item.recorded", step, {
          item: {
            itemId: input.itemId,
            status: "completed",
            kind: "toolResult",
            message: input.message,
            effectId: input.effectId,
          },
        }),
      ),
    waitingCheckpoint: (pending) => {
      if (thread.leaf === null) throw new Bug("loop.waiting_checkpoint_without_leaf");
      const binding = state.binding;
      const checkpoint: StepCheckpoint = {
        checkpointId: ctx.ids.next("ckp"),
        schemaVersion: STEP_CHECKPOINT_SCHEMA_VERSION,
        threadId,
        turnId,
        stepId: step.stepId,
        stepIndex: step.stepIndex,
        leafEventId: thread.leaf,
        next: "await_input",
        pendingToolCalls: [...pending],
        inputCursor: { consumedSeq: state.consumedSeq },
        model:
          binding === null
            ? { provider: "", modelId: "", thinkingLevel: "off" }
            : {
                provider: binding.provider,
                modelId: binding.modelId,
                thinkingLevel: binding.thinkingLevel,
              },
        leaseRefs: [...state.leaseRefs],
        scopeRef: state.scopeRef,
      };
      return rawDraft(run, "checkpoint.step", step, checkpoint);
    },
  };
  return {
    threadId,
    turnId,
    stepId: step.stepId,
    caller: "main",
    depth: 0,
    interactive: run.spec.interactive,
    surfaceThreadId: threadId,
    signal: run.scope.signal,
    drafts,
  };
}

// ── 취소 사유 ────────────────────────────────────────────────────────

function isAbortReason(value: unknown): value is AbortReason {
  // DOMException(AbortError)도 code·message를 가진다. code가 문자열인 것만 AbortReason으로 본다
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string" &&
    "message" in value
  );
}

export function abortCodeOf(signal: AbortSignal | null): string | null {
  if (signal === null || !signal.aborted) return null;
  const reason: unknown = signal.reason;
  return isAbortReason(reason) ? reason.code : "aborted";
}

export function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
