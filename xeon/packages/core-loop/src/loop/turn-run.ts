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
  type ItemRecordedPayload,
  type StepCheckpoint,
} from "@xeon/contracts/records";
import {
  MODEL_ROLES,
  type AbortReason,
  type ModelBinding,
  type ModelRole,
  type ResolvedModel,
  type RoleOverrides,
  type TaskScope,
  type ToolRunContext,
  type ToolRunDrafts,
} from "@xeon/contracts/services";
import type { BoundarySignal } from "@xeon/ext-host";
import type { ToolName } from "@xeon/contracts/capabilities";
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
type EndReason = "step_limit" | "child_limit" | "external" | "stopped" | "deferred";

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
  /** 이 turn의 `l1.loop.gate.maxContinues`. turn 시작 때 한 번 읽는다 */
  gateMaxContinues: number;
  endReason: EndReason | null;
  /** 재개로 같은 단계의 요청을 다시 보낸다: 그 단계의 `step.started`는 이미 기록됨 */
  adoptFirstStep: boolean;
  /** 이 실행이 낸 메시지(`agent_end` tap의 messages) */
  readonly newMessages: AgentMessage[];
  maxSteps: number;
  /** 단계 상한에 이르렀을 때의 턴 종료 사유. 자식 한도가 정한 상한이면 `child_limit`다 */
  stepLimitReason: "step_limit" | "child_limit";
  /** 자식 turn의 입력 토큰 상한(`ChildTurnRequest.limits.maxInputTokens`). 없으면 null */
  childMaxInputTokens: number | null;
  /** 접두의 기본 프롬프트(자식 turn은 요청의 `systemPrompt`, 아니면 서비스 기본값). turn 안에서 바뀌지 않는다 */
  readonly basePrompt: string;
  /** `before_agent_start` 체인이 기본 프롬프트에 더한 부분. 이 turn의 모든 요청에 volatile로 붙는다(재개 진입은 비어 있다) */
  promptAddition: string;
  /** 단계 안에서 같은 지점이 여러 번 불릴 때 dispatchKey를 구별하는 순번 */
  pointSeq: number;
  /** 첫 단계를 열 때 `agent_start`를 낸다 */
  agentStarted: boolean;
  /** `tool_search`가 활성화한 지연 도구. 처음 필요할 때 활성 가지에서 읽는다(`loop/activation.ts`) */
  activated: Set<ToolName> | null;
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

/** 설정 상한과 자식 한도 중 더 작은 양수가 단계 상한이다. 0이나 없음은 상한 없음이다 */
function stepLimitOf(
  configured: number,
  childLimit: number | undefined,
): { readonly maxSteps: number; readonly stepLimitReason: "step_limit" | "child_limit" } {
  const child = childLimit !== undefined && childLimit > 0 ? childLimit : null;
  if (child !== null && (configured <= 0 || child <= configured)) {
    return { maxSteps: child, stepLimitReason: "child_limit" };
  }
  return { maxSteps: configured, stepLimitReason: "step_limit" };
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
    gateMaxContinues: ctx.settings.gateMaxContinues(threadId),
    endReason: null,
    adoptFirstStep: spec.entry.kind === "request" && spec.entry.adoptStepId !== null,
    newMessages: [],
    ...stepLimitOf(ctx.settings.maxSteps(threadId), spec.child?.limits?.maxSteps),
    childMaxInputTokens: spec.child?.limits?.maxInputTokens ?? null,
    basePrompt: spec.child?.systemPrompt ?? ctx.basePrompt,
    promptAddition: "",
    pointSeq: 0,
    agentStarted: false,
    activated: null,
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

/**
 * 이 turn이 모델을 해석할 역할과 덮어쓰기. 주 대화와 drive turn은 역할 `main`이다. 자식 turn은 요청의 `model`이
 * 역할 이름이면 그 역할로, 아니면 모델 참조(`provider/id[:레벨]`)로 `main` 역할을 덮어쓴다(L1.loop.spec §4.13 4단계)
 */
function roleOf(run: TurnRun): { readonly role: ModelRole; readonly overrides: RoleOverrides } {
  const child = run.spec.child;
  const base = overrides(run);
  if (child === null) return { role: "main", overrides: base };
  const named = MODEL_ROLES.find((role) => role === child.model);
  if (named !== undefined) return { role: named, overrides: base };
  return { role: "main", overrides: { ...base, ref: child.model } };
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
  const { role, overrides: roleOverrides } = roleOf(run);
  const resolved = ctx.models.resolve(role, roleOverrides);
  if (!resolved.ok) return err({ kind: "model_unavailable", detail: resolved.error.kind });
  return ok(remember(run, resolved.value));
}

/** 다음 단계에 쓸 바인딩(체크포인트 `model` 필드). 해석에 실패하면 지금 값을 이어 쓴다 */
export function nextBinding(run: TurnRun): Result<ModelBinding, LoopFailure> {
  const { role, overrides: roleOverrides } = roleOf(run);
  const resolved = run.ctx.models.resolve(role, roleOverrides);
  if (resolved.ok) return ok(resolved.value.binding);
  const current = run.state.binding;
  if (current === null) return err({ kind: "model_unavailable", detail: resolved.error.kind });
  return ok(current);
}

// ── 도구 실행 맥락 ───────────────────────────────────────────────────

/** 이 파일이 낙인 없이 만드는 초안의 kind별 payload. kind와 payload가 어긋나면 컴파일 오류다 */
interface RawDraftPayloads {
  readonly "item.recorded": ItemRecordedPayload;
  readonly "checkpoint.step": StepCheckpoint;
}

function rawDraft<K extends keyof RawDraftPayloads>(
  run: TurnRun,
  kind: K,
  step: StepRef,
  payload: RawDraftPayloads[K],
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
      // 도구 배치는 요청 단계(모델 해석)나 도구 단계 재개(resolveModel) 뒤에만 시작한다. 바인딩이 없으면 루프 불변식 위반이고,
      // 내구 체크포인트에 빈 provider·modelId 같은 자리표시를 쓰지 않는다
      const binding = state.binding;
      if (binding === null) throw new Bug("loop.waiting_checkpoint_without_binding");
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
        model: {
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
  const child = run.spec.child;
  return {
    threadId,
    turnId,
    stepId: step.stepId,
    caller: child === null ? "main" : child.tools.caller,
    depth: child === null ? 0 : child.tools.depth,
    interactive: run.spec.interactive,
    surfaceThreadId: child === null ? threadId : child.tools.surfaceThreadId,
    ...(child === null ? {} : { ceiling: child.tools.ceiling }),
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
