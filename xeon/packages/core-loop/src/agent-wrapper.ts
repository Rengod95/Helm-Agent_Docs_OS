import {
  runAgentLoop,
  runToolCall,
  type AgentEvent as PiAgentEvent,
  type AgentLoopConfig,
  type AgentTurnContext,
  type AgentTurnDecision,
} from "@earendil-works/pi-agent-core";
import { assertNever, Bug } from "@xeon/contracts";
import type {
  AgentMessage,
  AgentToolHooks,
  AssistantMessage,
  EventId,
  ImageContent,
  StopReason,
  ItemId,
  LifecycleEvent,
  ModelThinkingLevel,
  PartRecord,
  StepId,
  ThreadId,
  StreamFn,
  ToolCall,
  ToolResultMessage,
  TurnCompletedPayload,
  TurnId,
  Usage,
} from "@xeon/contracts/conversation";
import type {
  AgentBeforeSettlePayload,
  BeforeAgentStartPayload,
  BoundaryValue,
  PostItem,
  TurnEndPayload,
} from "@xeon/contracts/extensions";
import {
  STEP_CHECKPOINT_SCHEMA_VERSION,
  type DurableEventDraft,
  type EffectIntent,
  type PendingToolCall,
  type StepCheckpoint,
} from "@xeon/contracts/records";
import type { ToolName } from "@xeon/contracts/capabilities";
import type {
  AbortReason,
  ModelBinding,
  ResolvedModel,
  TaskScope,
  ToolRunContext,
  ToolRunDrafts,
} from "@xeon/contracts/services";
import type { BoundarySignal } from "@xeon/ext-host";
import { canContinue, GATE_CONTINUES_SAFETY_CAP, stepLimitReached } from "./budget.ts";
import { finalizeBoundary } from "./checkpoint.ts";
import {
  customItemOf,
  responseRequest,
  stepEndRequest,
  stepStartRequest,
  strayItemRequest,
  toolResultItemRequest,
  turnEndRequest,
  type PlacedInput,
  type PreludeItem,
  type StepRef,
} from "./commits.ts";
import { commitWithRetry, describeCommitFailure, type CommitOutcome } from "./commit.ts";
import { RunFailure } from "./errors.ts";
import { forEachSequential } from "./sequence.ts";
import { createAgentEventMapper, type BoundAgentEventMapper } from "./event-mapper.ts";
import {
  fromPiMessage,
  fromPiMessages,
  toPiAssistant,
  toPiLlmMessages,
  toPiMessages,
  toPiStreamFn,
  toPiToolCall,
  toPiTools,
} from "./pi-bridge.ts";
import { abortedStream, jsonOrUndefined } from "./streams.ts";
import { prestartRequest } from "./turn-start.ts";
import type { LoopContext, RunningTurn, ThreadRuntime } from "./types.ts";
import { createVolatileEmitter, isVolatileNotification } from "./volatile.ts";

// L1.loop.spec §3.2 래퍼 구조, §4.2 turn 하나의 순서, §4.3 status 결정, §4.5 재진입.
// turn 하나는 `runAgentLoop([], context, …)` 호출 하나다. 입력 item은 T1에서 미리 기록했다.

/** turn을 어디서부터 실행하는가 */
export type TurnEntry =
  /** T1 직후. before_agent_start를 발화하고 첫 단계부터 */
  | {
      readonly kind: "fresh";
      readonly prompt: string;
      readonly images: readonly ImageContent[];
      /** 재개 때 `before_agent_start`가 추가한 item이 이미 있으면 다시 발화하지 않는다 */
      readonly skipBeforeStart: boolean;
    }
  /** 다음(또는 끊긴) 단계의 모델 요청부터. `adoptStepId`가 있으면 그 단계의 `step.started`는 이미 기록됨 */
  | {
      readonly kind: "request";
      readonly stepIndex: number;
      readonly adoptStepId: StepId | null;
      readonly binding: ModelBinding | null;
    }
  /** T3 뒤 도구 단계 중간부터. 남은 호출을 래퍼가 돌린다 */
  | { readonly kind: "tools"; readonly resume: ToolsResume }
  /** 요청 없이 T6부터. `closing`이 있으면 결과 없이 남은 호출을 먼저 닫는다 */
  | {
      readonly kind: "turn_end";
      readonly closing: {
        readonly step: StepRef;
        readonly toolCallIds: readonly string[];
      } | null;
    };

export type ToolCallResume =
  | {
      readonly kind: "recorded";
      readonly toolCallId: string;
      readonly itemId: ItemId;
      readonly message: ToolResultMessage;
    }
  | { readonly kind: "rerun"; readonly toolCallId: string; readonly intent: EffectIntent }
  | { readonly kind: "run"; readonly toolCall: ToolCall };

interface ToolsResume {
  readonly stepIndex: number;
  readonly stepId: StepId;
  readonly assistantItemId: ItemId;
  readonly assistant: AssistantMessage;
  readonly calls: readonly ToolCallResume[];
  readonly binding: ModelBinding | null;
  /** 승인 대기 호출을 이어 기다리는 재진입(await_input)이면 true */
  readonly awaitInput: boolean;
}

export interface TurnRunSpec {
  readonly thread: ThreadRuntime;
  readonly turnId: TurnId;
  readonly scope: TaskScope;
  readonly entry: TurnEntry;
  readonly interactive: boolean;
  /** drive turn이면 임대 scope id(모델 해석의 그룹 덮어쓰기 키) */
  readonly scopeId: string | null;
  /** drive turn이면 임대 id(경계 신호의 drivenBy) */
  readonly leaseId: string | null;
  /** drive turn 취소 신호: 켜지면 다음 단계 경계에서 결정 end */
  readonly driveSignal: AbortSignal | null;
  readonly consumedSeq: number;
  readonly leaseRefs: readonly EventId[];
  readonly scopeRef: EventId | null;
  /** 재개 전에 이미 끝난 단계 수와 사용량 */
  readonly priorStepCount: number;
  readonly priorUsage: Usage | null;
  readonly priorFinalItemId: ItemId | null;
  /** 재개 전 마지막 어시스턴트 응답의 stopReason과 오류 문장 */
  readonly priorLastStop: StopReason | null;
  readonly priorLastError: string | null;
}

export interface TurnRunResult {
  readonly status: "completed" | "interrupted" | "failed" | "open";
  readonly usage: Usage | null;
  readonly finalItemId: ItemId | null;
  readonly error: string | null;
  /** 호출자가 thread를 유휴로 표시한 뒤 부른다: 경계 `turn_settled`를 알리고 `agent_settled`를 발화한다 */
  readonly afterIdle: () => Promise<void>;
}

type EndReason = "step_limit" | "external" | "stopped" | "deferred";

interface RunState {
  stepIndex: number;
  binding: ModelBinding | null;
  pinned: ModelBinding | null;
  prelude: PreludeItem[];
  assistant: AssistantMessage | null;
  assistantItemId: ItemId | null;
  assistantParts: readonly PartRecord[];
  toolResultItems: Map<string, ItemId>;
  terminate: Map<string, boolean>;
  hooks: AgentToolHooks | null;
  placedSteer: AgentMessage[];
  consumedSeq: number;
  leaseRefs: readonly EventId[];
  scopeRef: EventId | null;
  gateContinues: number;
  endReason: EndReason | null;
  stray: number;
  adoptFirstStep: boolean;
  newMessages: readonly AgentMessage[];
  maxSteps: number;
  /** `before_agent_start`가 바꾼 기본 프롬프트(없으면 서비스 기본값). 접두가 기록된 뒤에는 조립이 기록본을 쓴다 */
  basePrompt: string;
  /** 단계 안에서 같은 지점이 여러 번 불릴 때 dispatchKey를 구별하는 순번 */
  pointSeq: number;
}

function requireRunning(thread: ThreadRuntime): RunningTurn {
  if (thread.running === null) throw new Bug("agent-wrapper.not_running");
  return thread.running;
}

function toolCallsOf(message: AssistantMessage): ToolCall[] {
  return message.content.filter((block): block is ToolCall => block.type === "toolCall");
}

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

function abortCodeOf(signal: AbortSignal | null): string | null {
  if (signal === null || !signal.aborted) return null;
  const reason: unknown = signal.reason;
  return isAbortReason(reason) ? reason.code : "aborted";
}

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type StepCompletedNote = Extract<LifecycleEvent, { readonly type: "step.completed" }>;
type ItemCompletedNote = Extract<LifecycleEvent, { readonly type: "item.completed" }>;

function stepCompletedOf(notes: readonly LifecycleEvent[]): StepCompletedNote | undefined {
  for (const note of notes) if (note.type === "step.completed") return note;
  return undefined;
}

function itemCompletedOf(notes: readonly LifecycleEvent[]): ItemCompletedNote | undefined {
  for (const note of notes) if (note.type === "item.completed") return note;
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

const NO_ACTIVATED_TOOLS: ReadonlySet<ToolName> = new Set();

function noop(): Promise<void> {
  return Promise.resolve();
}

/** turn 하나를 끝까지 실행한다. T1은 호출자가 이미 커밋했다. 마지막에 T6(또는 열어 둔 채 반환)까지 한다 */
export async function executeTurn(ctx: LoopContext, spec: TurnRunSpec): Promise<TurnRunResult> {
  const { thread, turnId, scope } = spec;
  const threadId = thread.threadId;
  const running: RunningTurn = requireRunning(thread);

  const firstStepIndex =
    spec.entry.kind === "request"
      ? spec.entry.stepIndex
      : spec.entry.kind === "tools"
        ? spec.entry.resume.stepIndex + 1
        : spec.priorStepCount;
  const mapper: BoundAgentEventMapper = createAgentEventMapper(
    {
      threadId,
      turnId,
      startStepIndex: firstStepIndex,
      ids: ctx.ids,
    },
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
  });
  const state: RunState = {
    stepIndex: firstStepIndex,
    binding: null,
    pinned: spec.entry.kind === "request" ? spec.entry.binding : null,
    prelude: [],
    assistant: null,
    assistantItemId: null,
    assistantParts: [],
    toolResultItems: new Map(),
    terminate: new Map(),
    hooks: null,
    placedSteer: [],
    consumedSeq: spec.consumedSeq,
    leaseRefs: spec.leaseRefs,
    scopeRef: spec.scopeRef,
    gateContinues: 0,
    endReason: null,
    stray: 0,
    adoptFirstStep: spec.entry.kind === "request" && spec.entry.adoptStepId !== null,
    newMessages: [],
    maxSteps: ctx.settings.maxSteps(threadId),
    basePrompt: ctx.basePrompt,
    pointSeq: 0,
  };
  if (spec.entry.kind === "tools") {
    state.pinned = spec.entry.resume.binding;
  }

  // T4가 배치한 입력 메시지. agent-core가 message_start·message_end를 내도 다시 기록하지 않는다
  const placedObjects = new WeakSet<object>();

  // ── 공통 도우미 ────────────────────────────────────────────────────

  function currentStep(): StepRef {
    const snapshot = mapper.snapshot();
    if (snapshot.stepId === null) throw new RunFailure("invariant", "no open step");
    return { threadId, turnId, stepId: snapshot.stepId, stepIndex: snapshot.stepIndex };
  }

  function commitOrThrow(request: Parameters<typeof commitWithRetry>[1]): void {
    const outcome = commitWithRetry(ctx.session, request);
    if (!outcome.ok) {
      const failure = new RunFailure("commit_failed", describeCommitFailure(outcome.error));
      // 싱크·훅에서 던져 run을 멈춘다(L1.loop.spec §3.3 "리스너 예외", eng.typescript.guide TY-11 허용 3)
      throw failure;
    }
  }

  function flushThenCommit(request: Parameters<typeof commitWithRetry>[1]): void {
    emitter.flush();
    commitOrThrow(request);
  }

  function dispatchKey(stepId: StepId | null, suffix: string): string {
    return `${stepId ?? turnId}:${suffix}`;
  }

  /** 같은 지점이 한 단계에서 여러 번 불려도 dispatchKey가 겹치지 않게 한다(재개 때 같은 자리는 같은 키) */
  function nextPointSeq(): number {
    state.pointSeq += 1;
    return state.pointSeq;
  }

  /** 메시지의 안정된 이름: 어시스턴트는 하나, 도구 결과는 toolCallId, 그 밖은 역할과 순번 */
  function messageIdentity(message: AgentMessage): string {
    if (message.role === "assistant") return "assistant";
    if (message.role === "toolResult") return message.toolCallId;
    return `${message.role}:${nextPointSeq()}`;
  }

  function overrides(): { readonly scopeId?: string } {
    return spec.scopeId === null ? {} : { scopeId: spec.scopeId };
  }

  async function currentLeaf(): Promise<EventId> {
    if (thread.leaf !== null) return thread.leaf;
    let last: EventId | null = null;
    for await (const event of ctx.session.readBranch(threadId)) last = event.id;
    if (last === null) throw new RunFailure("invariant", "thread has no events");
    thread.leaf = last;
    return last;
  }

  function resolveModel(): ResolvedModel {
    const pinned = state.pinned;
    if (pinned !== null) {
      const rebound = ctx.models.rebind(pinned);
      if (rebound.ok) return remember(rebound.value);
      ctx.logger.warn("loop.rebind_failed", { threadId, turnId, kind: rebound.error.kind });
    }
    const resolved = ctx.models.resolve("main", overrides());
    if (!resolved.ok) {
      throw new RunFailure("model_unavailable", resolved.error.kind);
    }
    return remember(resolved.value);
  }

  function remember(resolved: ResolvedModel): ResolvedModel {
    state.binding = resolved.binding;
    state.pinned = resolved.binding;
    return resolved;
  }

  function makeRun(step: StepRef): ToolRunContext {
    const drafts: ToolRunDrafts = {
      // core-tools가 effect.result와 같은 커밋에 넣으므로 낙인된 초안을 그대로 낸다(F ToolRunDrafts). 낙인은 객체 정체성이다.
      // 낙인이 없으면 도구는 effect.result만 커밋하고 루프가 같은 키(tool:<id>:result)로 item을 다시 커밋해 key_reused가 된다
      toolResultItem: (input) =>
        ctx.drafter.stamp(
          rawDraft("item.recorded", step, {
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
        if (thread.leaf === null) throw new Bug("agent-wrapper.waiting_checkpoint_without_leaf");
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
        return rawDraft("checkpoint.step", step, checkpoint);
      },
    };
    return {
      threadId,
      turnId,
      stepId: step.stepId,
      caller: "main",
      depth: 0,
      interactive: spec.interactive,
      surfaceThreadId: threadId,
      signal: scope.signal,
      drafts,
    };
  }

  function rawDraft(
    kind: DurableEventDraft["kind"],
    step: StepRef,
    payload: unknown,
  ): DurableEventDraft {
    return {
      id: ctx.ids.next("evt"),
      kind,
      version: 1,
      threadId,
      turnId,
      stepId: step.stepId,
      causationId: null,
      correlationId: turnId,
      payload,
      durable: true,
    };
  }

  function boundarySignal(
    kind: BoundarySignal["kind"],
    stepId: StepId | undefined,
  ): BoundarySignal {
    return {
      threadId,
      kind,
      turnId,
      ...(stepId === undefined ? {} : { stepId }),
      ...(spec.leaseId === null ? {} : { drivenBy: spec.leaseId }),
    };
  }

  function tapOptions(key: string): {
    readonly threadId: ThreadId;
    readonly dispatchKey: string;
    readonly signal: AbortSignal;
  } {
    return { threadId, dispatchKey: key, signal: scope.signal };
  }

  function emitNotifications(notes: ReturnType<BoundAgentEventMapper["map"]>): void {
    for (const note of notes) {
      if (isVolatileNotification(note)) emitter.emit(note);
    }
  }

  // ── 지점 발화 도우미 ───────────────────────────────────────────────

  // ── 모델 요청 준비 ─────────────────────────────────────────────────

  async function prepareRequest(): Promise<{
    readonly context: {
      readonly messages: ReturnType<typeof toPiMessages>;
      readonly tools: ReturnType<typeof toPiTools>;
    };
    readonly model: ResolvedModel["model"];
    readonly thinkingLevel: ModelThinkingLevel;
  }> {
    const step = currentStep();
    running.phase = "requesting";
    running.stepIndex = step.stepIndex;
    const resolved = resolveModel();
    const run = makeRun(step);
    let toolset;
    try {
      toolset = await ctx.tools.advertise({
        run: { threadId, caller: "main", depth: 0 },
        activated: NO_ACTIVATED_TOOLS,
      });
    } catch (error) {
      throw new RunFailure("tools_unavailable", failureText(error));
    }
    const leaf = await currentLeaf();
    const assembled = await ctx.context.assemble(threadId, leaf, {
      binding: resolved.binding,
      contextWindow: resolved.model.contextWindow,
      cachePolicy: resolved.cachePolicy,
      tools: toolset.tools,
      basePrompt: state.basePrompt,
      sections: {},
      volatile: {},
      turnId,
      stepId: step.stepId,
      signal: scope.signal,
    });
    if (!assembled.ok) throw new RunFailure("context_unavailable", assembled.error.kind);
    for (const warning of assembled.value.warnings) {
      ctx.logger.debug("loop.context_warning", { threadId, turnId, code: warning.code });
    }
    for (const pending of assembled.value.pendingItems) {
      state.prelude.push({
        itemId: ctx.ids.next("itm"),
        status: "completed",
        kind: "system",
        message: pending.message,
      });
    }
    state.hooks = ctx.tools.hooks(run);
    const tools = ctx.tools.toAgentTools(toolset, run);
    return {
      context: { messages: toPiMessages(assembled.value.messages), tools: toPiTools(tools) },
      model: resolved.model,
      thinkingLevel: resolved.binding.thinkingLevel,
    };
  }

  // ── 단계 끝 (finishTurn 훅의 본체, 재개의 도구 단계도 이 함수로 끝낸다) ──

  interface StepEnd {
    readonly message: AssistantMessage;
    readonly toolResults: readonly ToolResultMessage[];
    readonly contextMessages: readonly AgentMessage[];
  }

  interface StepFinish {
    /** agent-core `finishTurn`이 돌려줄 결정 */
    readonly decision: AgentTurnDecision | undefined;
    /** 이 단계 뒤에 모델 요청이 이어지는가(재개의 도구 단계가 agent-core 스케줄링을 대신할 때 쓴다) */
    readonly continues: boolean;
  }

  async function finishStep(input: StepEnd): Promise<StepFinish> {
    const step = currentStep();
    const run = makeRun(step);
    running.phase = "settling";
    const message = state.assistant ?? input.message;
    const calls = toolCallsOf(message);

    // (a) 중단으로 결과 없이 남은 호출을 닫는다 (§3.3 A3)
    const answered = new Set(input.toolResults.map((result) => result.toolCallId));
    const missing = calls.map((call) => call.id).filter((id) => !answered.has(id));
    if (missing.length > 0) {
      await ctx.tools.closeUnexecuted(run, missing);
      for (const id of missing) {
        const settled = ctx.tools.settledItem(id);
        if (settled !== undefined) {
          mapper.bindItem({ toolCallId: id }, settled);
          state.toolResultItems.set(id, settled);
        }
      }
    }

    // 매퍼를 단계 끝으로 진행시켜 step.completed 값을 얻는다
    const notes = mapper.map({ type: "turn_end", message, toolResults: [...input.toolResults] });
    const completed = stepCompletedOf(notes);
    if (completed === undefined) throw new RunFailure("invariant", "mapper gave no step.completed");

    const stopReason = message.stopReason;
    const hardStop = stopReason === "error" || stopReason === "aborted";
    const deferred = stopReason === "deferred";
    const totals = mapper.totals();
    const abortRequested = scope.signal.aborted;
    const stepLimit = stepLimitReached({ maxSteps: state.maxSteps }, totals.stepCount);
    const externalStop = spec.driveSignal?.aborted === true;
    const stopping = thread.stopRequested;
    const steerQueued = ctx.tasks.inputs.peek(threadId, ["steer"]);
    const allTerminate =
      calls.length > 0 && calls.every((call) => state.terminate.get(call.id) === true);
    const hasMore = calls.length > 0 && !allTerminate;
    const steerPending = steerQueued.length > 0;
    const candidate = hardStop || deferred || (!hasMore && !steerPending);
    const gateExhausted = state.gateContinues >= GATE_CONTINUES_SAFETY_CAP;
    const canContinueNow = canContinue({
      hardStop: hardStop || deferred,
      abortRequested,
      stepLimit,
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
        ctx.logger.warn("loop.boundary_invalid", {
          threadId,
          turnId,
          issues: [...verdict.issues],
        });
      }
      return verdict.ok ? verdict.value : { entries: [], continue: false };
    };

    // (b) turn_end chain
    const turnEndPayload: TurnEndPayload = {
      stepIndex: step.stepIndex,
      stepId: step.stepId,
      message: structuredClone(message),
      toolResults: structuredClone([...input.toolResults]),
      messageItemId: state.assistantItemId ?? completed.assistantItemId ?? ctx.ids.next("itm"),
      toolResultItemIds: [...completed.toolResultItemIds],
      context: preview,
    };
    const turnEnd = await ctx.ext.dispatch("turn_end", turnEndPayload, {
      threadId,
      dispatchKey: dispatchKey(step.stepId, "turn_end"),
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
          dispatchKey: dispatchKey(step.stepId, "agent_before_settle"),
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
    const limitEnd = wouldContinue && (stepLimit || externalStop);
    const leaveOpen = !forcedEnd && !limitEnd && wouldContinue && stopping;
    const endNow = forcedEnd || limitEnd || leaveOpen || deferred;
    if (deferred) {
      state.endReason = "deferred";
      emitter.emit({ type: "turn.updated", threadId, turnId, stepId: null, status: "waiting" });
    } else if (limitEnd) state.endReason = stepLimit ? "step_limit" : "external";
    else if (leaveOpen) state.endReason = "stopped";

    // (g) T4: 경계 기여를 받아 한 커밋에 넣는다
    const signal = boundarySignal("step_end", step.stepId);
    const contribution = await ctx.ext.boundary.prepare(signal);
    const binding = nextBinding();
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
        provider: binding.provider,
        modelId: binding.modelId,
        thinkingLevel: binding.thinkingLevel,
      },
      pendingToolCalls: pending,
    });
    emitter.flush();
    const committed: CommitOutcome = commitWithRetry(ctx.session, planned.request);
    if (!committed.ok) {
      await ctx.ext.boundary.settle(signal, "failed");
      const failure = new RunFailure("commit_failed", describeCommitFailure(committed.error));
      throw failure;
    }
    await ctx.ext.boundary.settle(signal, "committed");
    const outcome = planned.outcome();
    if (outcome === undefined) throw new RunFailure("invariant", "step end was not built");
    state.consumedSeq = outcome.consumedSeq;
    state.leaseRefs = outcome.leaseRefs;
    state.scopeRef = outcome.scopeRef;
    state.pinned = binding;
    state.placedSteer = outcome.placed.map((placed: PlacedInput) => {
      mapper.bindItem({ message: placed.message }, placed.itemId);
      placedObjects.add(placed.message);
      return placed.message;
    });
    if (gateContinue && !hasMore && outcome.placed.length === 0) state.gateContinues += 1;

    // 다음 단계 준비
    state.assistant = null;
    state.assistantItemId = null;
    state.assistantParts = [];
    state.terminate.clear();
    state.pointSeq = 0;
    running.stepIndex = step.stepIndex;

    if (endNow) return { decision: { action: "end" }, continues: false };
    const gateOnly = gateContinue && !hasMore && outcome.placed.length === 0;
    return {
      decision: gateOnly ? { action: "continue" } : undefined,
      continues: outcome.next === "request",
    };
  }

  function nextBinding(): ModelBinding {
    const resolved = ctx.models.resolve("main", overrides());
    if (resolved.ok) return resolved.value.binding;
    const current = state.binding;
    if (current === null) throw new RunFailure("model_unavailable", resolved.error.kind);
    return current;
  }

  // ── agent-core 싱크 ────────────────────────────────────────────────

  async function onMessageEnd(
    event: Extract<PiAgentEvent, { type: "message_end" }>,
  ): Promise<void> {
    const original = fromPiMessage(event.message);
    const step = currentStep();
    if (original.role === "assistant") {
      const patched = await ctx.ext.dispatch(
        "message_end",
        { message: structuredClone(original) },
        {
          threadId,
          dispatchKey: dispatchKey(step.stepId, `message_end:${messageIdentity(original)}`),
          initial: { message: structuredClone(original) },
          signal: scope.signal,
        },
      );
      const finalMessage =
        patched.value.message.role === "assistant" ? patched.value.message : original;
      const notes = mapper.map({ type: "message_end", message: finalMessage });
      const completed = itemCompletedOf(notes);
      if (completed === undefined || completed.item.kind !== "assistant") {
        throw new RunFailure("invariant", "mapper gave no assistant item");
      }
      state.assistant = finalMessage;
      state.assistantItemId = completed.item.itemId;
      state.assistantParts = mapper.partsOf(completed.item.itemId);
      emitNotifications(notes);
      const prelude = state.prelude;
      state.prelude = [];
      flushThenCommit(
        responseRequest(ctx.drafter, {
          step,
          prelude,
          assistant: completed.item,
          parts: state.assistantParts,
        }),
      );
      running.phase = toolCallsOf(finalMessage).length > 0 ? "tools" : "requesting";
      return;
    }

    const notes = mapper.map(event);
    emitNotifications(notes);
    const completed = itemCompletedOf(notes);
    if (completed === undefined) return;
    const item = completed.item;
    switch (original.role) {
      case "system":
        if (item.kind === "system") state.prelude.push(item);
        return;
      case "toolResult": {
        const settled = ctx.tools.settledItem(original.toolCallId);
        if (settled !== undefined) {
          mapper.bindItem({ toolCallId: original.toolCallId }, settled);
          state.toolResultItems.set(original.toolCallId, settled);
          return;
        }
        if (item.kind !== "toolResult") return;
        state.toolResultItems.set(original.toolCallId, item.itemId);
        // pi가 전역 시계와 실행 시간으로 채운 값은 기록하지 않는다(TX-06 결정성)
        const { durationMs: _elapsed, ...rest } = original;
        flushThenCommit(
          toolResultItemRequest(ctx.drafter, step, item.itemId, {
            ...rest,
            timestamp: ctx.clock.now(),
          }),
        );
        return;
      }
      case "user":
      case "custom": {
        // T1·T4가 이미 기록한 입력이면 매퍼가 알고 있는 item이다. 모르는 메시지만 따로 기록한다
        if (placedObjects.has(original)) return;
        if (item.kind === "user" || item.kind === "custom") {
          state.stray += 1;
          flushThenCommit(strayItemRequest(ctx.drafter, step, state.stray, item));
        }
        return;
      }
      default:
        return;
    }
  }

  async function emit(event: PiAgentEvent): Promise<void> {
    switch (event.type) {
      case "agent_start": {
        emitNotifications(mapper.map(event));
        await ctx.ext.dispatch("agent_start", { turnId }, tapOptions(`${turnId}:agent_start`));
        return;
      }
      case "turn_start": {
        const notes = mapper.map(event);
        const step = currentStep();
        running.stepIndex = step.stepIndex;
        if (state.adoptFirstStep) {
          // 같은 단계의 요청을 다시 보낸다: step.started는 이미 기록됐다
          state.adoptFirstStep = false;
          return;
        }
        flushThenCommit(stepStartRequest(ctx.drafter, step));
        emitNotifications(notes.filter((note) => note.type !== "step.started"));
        await ctx.ext.dispatch(
          "turn_start",
          { stepIndex: step.stepIndex, stepId: step.stepId, timestamp: ctx.clock.now() },
          tapOptions(dispatchKey(step.stepId, "turn_start")),
        );
        return;
      }
      case "message_start": {
        if (event.message.role === "toolResult") {
          // L1.tools가 이미 결과 item을 기록했으면 그 id를 쓴다. 새 id를 만들지 않는다
          const settled = ctx.tools.settledItem(event.message.toolCallId);
          if (settled !== undefined)
            mapper.bindItem({ toolCallId: event.message.toolCallId }, settled);
        }
        emitNotifications(mapper.map(event));
        await ctx.ext.dispatch(
          "message_start",
          { message: structuredClone(event.message) },
          tapOptions(
            dispatchKey(
              mapper.snapshot().stepId,
              `message_start:${messageIdentity(event.message)}`,
            ),
          ),
        );
        return;
      }
      case "message_update": {
        emitNotifications(mapper.map(event));
        await ctx.ext.dispatch(
          "message_update",
          {
            message: structuredClone(event.message),
            assistantMessageEvent: structuredClone(event.assistantMessageEvent),
          },
          tapOptions(dispatchKey(mapper.snapshot().stepId, `message_update:${nextPointSeq()}`)),
        );
        return;
      }
      case "message_end":
        await onMessageEnd(event);
        return;
      case "tool_execution_start":
      case "tool_execution_update":
      case "tool_execution_end": {
        if (event.type === "tool_execution_end") {
          const result: unknown = event.result;
          state.terminate.set(
            event.toolCallId,
            typeof result === "object" &&
              result !== null &&
              "terminate" in result &&
              result.terminate === true,
          );
        }
        emitNotifications(mapper.map(event));
        await ctx.tools.observe(event, makeRun(currentStep()));
        return;
      }
      case "turn_end":
        // 단계 끝은 finishTurn에서 이미 처리했다(step.completed 커밋 포함)
        return;
      case "agent_end":
        state.newMessages = fromPiMessages(event.messages);
        return;
      default:
        return assertNever(event, "PiAgentEvent");
    }
  }

  // ── 스트림 함수: modelCalls 슬롯 감싸기 (L1.tasks.spec §4.5 C1) ─────

  function streamFn(): StreamFn {
    return async (model, transcript, options) => {
      const step = mapper.snapshot();
      const inner = ctx.models.streamFn({
        threadId,
        turnId,
        stepId: step.stepId,
        role: "main",
        ...(spec.scopeId === null ? {} : { scopeId: spec.scopeId }),
        signal: scope.signal,
      });
      let slot;
      try {
        slot = await ctx.tasks.limiter("modelCalls").acquire(scope);
      } catch {
        return abortedStream(model.api, model.provider, model.id, ctx.clock.now());
      }
      let stream;
      try {
        stream = await inner(model, transcript, options);
      } catch (error) {
        slot.release();
        throw error;
      }
      const release = (): void => {
        slot.release();
      };
      return {
        async *[Symbol.asyncIterator]() {
          try {
            for await (const event of stream) yield event;
          } finally {
            release();
          }
        },
        async result() {
          try {
            return await stream.result();
          } finally {
            release();
          }
        },
      };
    };
  }

  // ── before_agent_start (T1 뒤, C2b) ─────────────────────────────────

  async function beforeAgentStart(entry: Extract<TurnEntry, { kind: "fresh" }>): Promise<void> {
    const payload: BeforeAgentStartPayload = {
      prompt: entry.prompt,
      ...(entry.images.length === 0 ? {} : { images: [...entry.images] }),
      systemPrompt: ctx.basePrompt,
      systemPromptOptions: {},
    };
    const outcome = await ctx.ext.dispatch("before_agent_start", payload, {
      threadId,
      dispatchKey: `${turnId}:before_agent_start`,
      initial: { messages: [], systemPrompt: ctx.basePrompt },
      signal: scope.signal,
    });
    state.basePrompt = outcome.value.systemPrompt;
    const records = outcome.value.messages.map((draft) =>
      customItemOf(ctx.ids.next("itm"), draft, ctx.clock.now()),
    );
    if (records.length > 0) {
      commitOrThrow(prestartRequest(ctx.drafter, { threadId, turnId }, records));
    }
  }

  // ── agent-core 실행 ────────────────────────────────────────────────

  async function agentLoop(): Promise<void> {
    const resolved = resolveModel();
    const config: AgentLoopConfig = {
      model: resolved.model,
      ...(resolved.binding.thinkingLevel === "off"
        ? {}
        : { reasoning: resolved.binding.thinkingLevel }),
      convertToLlm: (messages) =>
        toPiLlmMessages(ctx.context.convertToLlm(fromPiMessages(messages))),
      prepareRequest: () => prepareRequest(),
      finishTurn: async (turn: AgentTurnContext) =>
        (
          await finishStep({
            message: turn.message,
            toolResults: turn.toolResults,
            contextMessages: fromPiMessages(turn.context.messages),
          })
        ).decision,
      getSteeringMessages: () => {
        const messages = state.placedSteer;
        state.placedSteer = [];
        return Promise.resolve(toPiMessages(messages));
      },
      getFollowUpMessages: () => Promise.resolve([]),
      toolExecution: "parallel",
      beforeToolCall: (callContext, signal) => hooks().beforeToolCall(callContext, signal),
      afterToolCall: (callContext, signal) => hooks().afterToolCall(callContext, signal),
    };
    await runAgentLoop(
      [],
      { messages: [], tools: [] },
      config,
      emit,
      scope.signal,
      toPiStreamFn(streamFn()),
    );
  }

  function hooks(): AgentToolHooks {
    if (state.hooks === null) throw new RunFailure("invariant", "tool hooks are not ready");
    return state.hooks;
  }

  // ── 재개: 도구 단계 중간부터 (L1.loop.spec §4.5 tools 행) ─────────────

  async function replayTools(resume: ToolsResume): Promise<boolean> {
    mapper.restoreStep({
      stepId: resume.stepId,
      stepIndex: resume.stepIndex,
      assistantItemId: resume.assistantItemId,
    });
    state.assistant = resume.assistant;
    state.assistantItemId = resume.assistantItemId;
    const step = currentStep();
    running.phase = "tools";
    const run = makeRun(step);
    resolveModel();
    const toolset = await ctx.tools.advertise({
      run: { threadId, caller: "main", depth: 0 },
      activated: NO_ACTIVATED_TOOLS,
    });
    const agentTools = ctx.tools.toAgentTools(toolset, run);
    state.hooks = ctx.tools.hooks(run);
    const results: ToolResultMessage[] = [];
    await forEachSequential(resume.calls, async (call) => {
      switch (call.kind) {
        case "recorded": {
          mapper.bindItem({ toolCallId: call.toolCallId }, call.itemId);
          state.toolResultItems.set(call.toolCallId, call.itemId);
          results.push(call.message);
          return;
        }
        case "rerun": {
          const record = await ctx.tools.rerun(call.intent, run);
          const message: ToolResultMessage = {
            role: "toolResult",
            toolCallId: call.toolCallId,
            toolName: call.intent.toolName,
            content: record.content,
            ...(record.details === null ? {} : { details: record.details }),
            isError: record.isError,
            timestamp: ctx.clock.now(),
          };
          const settled = ctx.tools.settledItem(call.toolCallId);
          if (settled !== undefined) {
            mapper.bindItem({ toolCallId: call.toolCallId }, settled);
            state.toolResultItems.set(call.toolCallId, settled);
          } else {
            const itemId = ctx.ids.next("itm");
            mapper.bindItem({ toolCallId: call.toolCallId }, itemId);
            flushThenCommit(toolResultItemRequest(ctx.drafter, step, itemId, message));
          }
          state.terminate.set(call.toolCallId, record.terminate);
          results.push(message);
          return;
        }
        case "run": {
          const message = await runPendingCall(
            call.toolCall,
            resume.assistant,
            agentTools,
            step,
            run,
          );
          results.push(message);
          return;
        }
        default:
          assertNever(call, "ToolCallResume");
      }
    });
    const finished = await finishStep({
      message: resume.assistant,
      toolResults: results,
      contextMessages: [],
    });
    return finished.continues;
  }

  async function runPendingCall(
    toolCall: ToolCall,
    assistant: AssistantMessage,
    agentTools: ReturnType<typeof ctx.tools.toAgentTools>,
    step: StepRef,
    run: ToolRunContext,
  ): Promise<ToolResultMessage> {
    const startEvent: PiAgentEvent = {
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments,
    };
    emitNotifications(mapper.map(startEvent));
    await ctx.tools.observe(
      {
        type: "tool_execution_start",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        args: toolCall.arguments,
      },
      run,
    );
    const outcome = await runToolCall(toPiToolCall(toolCall), {
      tools: toPiTools(agentTools),
      assistantMessage: toPiAssistant(assistant),
      context: { messages: [], tools: toPiTools(agentTools) },
      signal: scope.signal,
      beforeToolCall: (callContext, signal) => hooks().beforeToolCall(callContext, signal),
      afterToolCall: (callContext, signal) => hooks().afterToolCall(callContext, signal),
    });
    const details = jsonOrUndefined(outcome.result.details);
    const message: ToolResultMessage = {
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [...outcome.result.content],
      ...(details === undefined ? {} : { details }),
      isError: outcome.isError,
      timestamp: ctx.clock.now(),
    };
    state.terminate.set(toolCall.id, outcome.result.terminate === true);
    const settled = ctx.tools.settledItem(toolCall.id);
    if (settled !== undefined) {
      mapper.bindItem({ toolCallId: toolCall.id }, settled);
      state.toolResultItems.set(toolCall.id, settled);
    } else {
      const itemId = ctx.ids.next("itm");
      mapper.bindItem({ toolCallId: toolCall.id }, itemId);
      flushThenCommit(toolResultItemRequest(ctx.drafter, step, itemId, message));
    }
    emitNotifications(
      mapper.map({
        type: "tool_execution_end",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: outcome.result,
        isError: outcome.isError,
      }),
    );
    await ctx.tools.observe(
      {
        type: "tool_execution_end",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: outcome.result,
        isError: outcome.isError,
      },
      run,
    );
    return message;
  }

  // ── 본체 ───────────────────────────────────────────────────────────

  let rejected: unknown = null;
  try {
    await scope.track(
      (async () => {
        const entry = spec.entry;
        switch (entry.kind) {
          case "fresh":
            if (!entry.skipBeforeStart) await beforeAgentStart(entry);
            await agentLoop();
            return;
          case "request":
            await agentLoop();
            return;
          case "tools": {
            const next = await replayTools(entry.resume);
            if (next && state.endReason === null) await agentLoop();
            return;
          }
          case "turn_end":
            if (entry.closing !== null && entry.closing.toolCallIds.length > 0) {
              await ctx.tools.closeUnexecuted(
                makeRun(entry.closing.step),
                entry.closing.toolCallIds,
              );
            }
            return;
          default:
            assertNever(entry, "TurnEntry");
        }
      })(),
    );
  } catch (error) {
    rejected = error;
    ctx.logger.error("loop.run_rejected", {
      threadId,
      turnId,
      reason: failureText(error),
    });
  }

  return finishTurnRun();

  // ── T6 ─────────────────────────────────────────────────────────────

  async function finishTurnRun(): Promise<TurnRunResult> {
    emitter.flush();
    if (state.endReason === "stopped" || state.endReason === "deferred") {
      // 안전 경계 정지·지연 응답: turn을 열어 둔다(T6 없음). 재개 후보로 남는다
      await scope.settle();
      const totals = mapper.totals();
      return {
        status: "open",
        usage: totals.usage,
        finalItemId: totals.lastAssistantItemId ?? spec.priorFinalItemId,
        error: null,
        afterIdle: noop,
      };
    }
    if (rejected !== null && !scope.signal.aborted) {
      // 래퍼 run 거부: 남은 소유 작업을 멈추고 정착을 기다린다
      await ctx.tasks.abort(scope, { code: "error", message: failureText(rejected) });
    }
    await scope.settle();
    const totals = mapper.totals();
    const abortCode = abortCodeOf(scope.signal);
    const lastStop = totals.lastStopReason;
    const finalItemId = totals.lastAssistantItemId ?? spec.priorFinalItemId;

    let status: TurnCompletedPayload["status"];
    let error: string | null;
    if (rejected !== null && abortCode === "error") {
      status = "failed";
      error = "loop_rejected";
    } else if (state.endReason === "step_limit") {
      status = "interrupted";
      error = "step_limit";
    } else if (state.endReason === "external") {
      status = "interrupted";
      error = abortCodeOf(spec.driveSignal) ?? "aborted";
    } else if (abortCode !== null) {
      status = "interrupted";
      error = abortCode;
    } else if (lastStop === "aborted") {
      status = "interrupted";
      error = totals.lastErrorMessage;
    } else if (lastStop === "error") {
      status = "failed";
      error = totals.lastErrorMessage ?? "error";
    } else if (rejected !== null) {
      status = "failed";
      error = "loop_rejected";
    } else {
      status = "completed";
      error = null;
    }

    const turnScope = { threadId, turnId, stepId: null } as const;
    const signal = boundarySignal("turn_settled", undefined);
    const open = (): TurnRunResult => ({
      status: "open",
      usage: totals.usage,
      finalItemId,
      error,
      afterIdle: noop,
    });
    try {
      const contribution = await ctx.ext.boundary.prepare(signal);
      const payload: TurnCompletedPayload = {
        status,
        stepCount: totals.stepCount,
        usage: totals.usage,
        error: error === null ? null : error.slice(0, 4000),
      };
      const outcome = commitWithRetry(
        ctx.session,
        turnEndRequest(ctx.drafter, turnScope, payload, contribution.drafts),
      );
      if (!outcome.ok) {
        ctx.logger.error("loop.turn_end_commit_failed", {
          threadId,
          turnId,
          failure: describeCommitFailure(outcome.error),
        });
        // 같은 turn이 열려 있는 채로 남으면 재개 후보가 된다(L1.loop.spec §5 "T3 커밋 실패")
        await ctx.ext.boundary.settle(signal, "failed");
        return open();
      }
    } catch (failure) {
      ctx.logger.error("loop.turn_end_failed", { threadId, turnId, reason: failureText(failure) });
      await ctx.ext.boundary.settle(signal, "failed").catch(() => {});
      return open();
    }

    // agent_end tap은 T6 커밋 뒤(L1.loop.spec §7)
    await ctx.ext.dispatch(
      "agent_end",
      { turnId, messages: structuredClone([...state.newMessages]) },
      tapOptions(`${turnId}:agent_end`),
    );

    return {
      status,
      usage: totals.usage,
      finalItemId,
      error,
      afterIdle: async () => {
        // settle은 thread가 유휴로 보일 때 불러야 drive 재호출이 시작된다
        await ctx.ext.boundary.settle(signal, "committed");
        await ctx.ext.dispatch(
          "agent_settled",
          { turnId, aborted: status === "interrupted" },
          tapOptions(`${turnId}:agent_settled`),
        );
      },
    };
  }
}
