import { assertNever, detach, err, ok, type Result, type Scheduler } from "@xeon/contracts";
import type {
  AgentToolCall,
  EventId,
  ItemId,
  StopReason,
  ThreadId,
  TurnId,
  Usage,
} from "@xeon/contracts/conversation";
import type { LoopTurnRequest, LoopTurnResult, PostItem } from "@xeon/contracts/extensions";
import type { DurableEventEnvelope, ReadFailure } from "@xeon/contracts/records";
import type {
  AdmitRequest,
  AdmitResult,
  ChildTurnRequest,
  InputMode,
  LoopError,
  LoopService,
  ResumeResult,
  TaskScope,
  ThreadLoopStatus,
} from "@xeon/contracts/services";
import { abortIntentRequest } from "./commits.ts";
import { commitWithRetry, describeCommitFailure, type CommitFailure } from "./commit.ts";
import { createDrafter } from "./drafts.ts";
import { LoopRejection } from "./errors.ts";
import { forEachSequential } from "./sequence.ts";
import { planReentry, reduceOpenTurn, type OpenTurnReduction } from "./resume.ts";
import { runTurn as runLoopTurn } from "./loop/run-turn.ts";
import type { TurnEntry, TurnRunResult } from "./loop/types.ts";
import { createThreadGate } from "./thread-gate.ts";
import { createUserBash } from "./user-bash.ts";
import { textAndImages, turnStartRequest, type TurnStartSource } from "./turn-start.ts";
import type { LoopContext, LoopDeps, StartOutcome, ThreadRuntime } from "./types.ts";

// L1.loop.spec §3.1 LoopService. thread 구동기(§2), admit(§4.1), drive 연동(§4.8), 재개(§4.5, §4.6).

export interface LoopServiceDeps extends LoopDeps {
  /** `stopAtSafeBoundary` 시한 타이머 */
  readonly scheduler: Scheduler;
}

export interface LoopServiceHandle extends LoopService {
  /** 이벤트 구독을 풀고 thread 상태를 비운다. 실행 중인 turn은 건드리지 않는다 */
  dispose(): void;
}

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function outcomeStatus(status: TurnRunResult["status"]): "completed" | "aborted" | "error" {
  switch (status) {
    case "completed":
      return "completed";
    case "interrupted":
    case "open":
      return "aborted";
    case "failed":
      return "error";
    default:
      return assertNever(status, "TurnRunResult.status");
  }
}

function settledNow(): Promise<void> {
  return Promise.resolve();
}

function beginRunning(thread: ThreadRuntime, turnId: TurnId, scope: TaskScope): void {
  thread.running = { turnId, scope, stepIndex: null, phase: "requesting" };
}

/** settle이 drive 재호출을 시작하려면 thread가 유휴로 보여야 한다 */
async function finishRun(thread: ThreadRuntime, result: TurnRunResult): Promise<void> {
  if (thread.running !== null) {
    const turnId = thread.running.turnId;
    for (const [inputId, placedTurn] of thread.placed) {
      if (placedTurn === turnId) thread.placed.delete(inputId);
    }
  }
  thread.running = null;
  thread.stopRequested = false;
  await result.afterIdle();
}

interface Prior {
  readonly priorStepCount: number;
  readonly priorUsage: Usage | null;
  readonly priorFinalItemId: ItemId | null;
  readonly priorLastStop: StopReason | null;
  readonly priorLastError: string | null;
}

function priorOf(reduction: OpenTurnReduction): Prior {
  const message = reduction.step?.assistant?.message;
  return {
    priorStepCount: reduction.stepCount,
    priorUsage: reduction.usage,
    priorFinalItemId: reduction.lastAssistantItemId,
    priorLastStop: message === undefined ? null : message.stopReason,
    priorLastError: message?.errorMessage ?? null,
  };
}

/** 결과 없이 남은 호출: 마지막 단계의 어시스턴트가 낸 호출 중 기록된 결과가 없는 것 */
function unansweredCalls(reduction: OpenTurnReduction): AgentToolCall[] {
  const step = reduction.step;
  if (step === null || step.assistant === null) return [];
  return step.assistant.message.content.flatMap((block) =>
    block.type === "toolCall" && !step.toolResults.has(block.id) ? [block] : [],
  );
}

export function createLoopService(deps: LoopServiceDeps): LoopServiceHandle {
  const ctx: LoopContext = {
    ...deps,
    drafter: createDrafter({ session: deps.session, ids: deps.ids }),
  };
  const userBash = createUserBash(ctx);
  const threads = new Map<ThreadId, ThreadRuntime>();
  const leaves = new Map<ThreadId, EventId>();

  // 커밋한 쪽과 무관하게 활성 가지의 마지막 이벤트를 따라간다(도구 커밋 포함)
  const unsubscribeCommits = deps.session.feed.onCommit((batch) => {
    for (const event of batch.events) {
      leaves.set(event.threadId, event.id);
      const thread = threads.get(event.threadId);
      if (thread !== undefined) thread.leaf = event.id;
    }
  });
  const unsubscribeQueue = deps.tasks.inputs.onQueued((threadId) => {
    // onQueued 안에서 동기로 쓰지 않는다(TX-09). 마이크로태스크로 미룬다
    queueMicrotask(() => {
      const thread = threads.get(threadId);
      if (thread === undefined) return;
      track(thread, startFromQueue(thread), "queue_start");
    });
  });

  function runtimeOf(threadId: ThreadId): ThreadRuntime {
    const known = threads.get(threadId);
    if (known !== undefined) return known;
    const created: ThreadRuntime = {
      threadId,
      gate: createThreadGate(),
      scope: deps.tasks.openScope(deps.tasks.root, { kind: "thread", id: threadId }),
      running: null,
      starting: null,
      leaf: leaves.get(threadId) ?? null,
      stopRequested: false,
      placed: new Map(),
    };
    threads.set(threadId, created);
    return created;
  }

  /** 기다리지 않는 작업을 thread 범위 노드에 등록한다(TY-22). 거부는 기록하고 삼킨다 */
  function track(thread: ThreadRuntime, work: Promise<unknown>, label: string): void {
    thread.scope.track(work).catch((error: unknown) => {
      deps.logger.error("loop.background_failed", {
        threadId: thread.threadId,
        label,
        reason: failureText(error),
      });
    });
  }

  async function readBranchEvents(
    threadId: ThreadId,
  ): Promise<Result<DurableEventEnvelope[], ReadFailure>> {
    const events: DurableEventEnvelope[] = [];
    for await (const read of deps.session.readBranch(threadId)) {
      if (!read.ok) return read;
      events.push(read.value);
    }
    return ok(events);
  }

  // ── turn 하나 (T1 → 실행 → T6) ──────────────────────────────────────

  function openTurnScope(
    thread: ThreadRuntime,
    turnId: TurnId,
    parent: TaskScope = thread.scope,
  ): TaskScope {
    return deps.tasks.openScope(parent, {
      kind: "turn",
      id: turnId,
      abortIntent: (reason, cause) =>
        abortIntentRequest(ctx.drafter, { threadId: thread.threadId, turnId }, reason, cause),
    });
  }

  /**
   * 게이트를 쥔 채로 호출한다. T1을 커밋하고(`onStarted`로 알림) turn을 끝까지 실행한다.
   * T1이 거부되면 `undefined`를 돌려준다.
   */
  async function runNewTurn(
    thread: ThreadRuntime,
    source: TurnStartSource,
    onStarted: (outcome: StartOutcome) => void,
  ): Promise<TurnRunResult | undefined> {
    const turnId = deps.ids.next("trn");
    // 자식 turn 노드는 호출자(core-agents)가 넘긴 subagent 노드 아래에 열린다(L1.tasks.spec §4.1)
    const child = source.kind === "child" ? source.request : null;
    const scope = openTurnScope(thread, turnId, child?.scope);
    const start = turnStartRequest(
      { drafter: ctx.drafter, clock: deps.clock, ids: deps.ids, tasks: deps.tasks },
      { threadId: thread.threadId, turnId, source },
    );
    const committed = commitWithRetry(deps.session, start.request);
    const planned = start.planned();
    if (!committed.ok || planned === undefined) {
      await scope.settle();
      onStarted(
        committed.ok
          ? { status: "failed", reason: "turn start was not planned" }
          : { status: "rejected", failure: committed.error },
      );
      return undefined;
    }
    beginRunning(thread, turnId, scope);
    for (const input of planned.inputs) thread.placed.set(input.inputId, turnId);
    onStarted({ status: "started", turnId, planned });
    const unlink = child === null ? null : linkRequestSignal(child.signal, scope);
    try {
      const result = await runLoopTurn(ctx, {
        thread,
        turnId,
        scope,
        entry: {
          kind: "fresh",
          prompt: planned.prompt,
          images: planned.images,
          skipBeforeStart: false,
        },
        interactive: planned.interactive,
        scopeId: planned.scopeId,
        leaseId: source.kind === "drive" ? source.request.leaseId : null,
        driveSignal: source.kind === "drive" ? source.request.signal : null,
        consumedSeq: planned.consumedSeq,
        leaseRefs: planned.leaseRefs,
        scopeRef: planned.scopeRef,
        priorStepCount: 0,
        priorUsage: null,
        priorFinalItemId: null,
        priorLastStop: null,
        priorLastError: null,
        child,
      });
      await finishRun(thread, result);
      return result;
    } catch (error) {
      thread.running = null;
      throw error;
    } finally {
      unlink?.();
    }
  }

  /** 호출자의 취소 신호가 켜지면 turn 노드를 취소한다(부모 노드의 신호는 소유 사슬이 이미 전한다). 돌려주는 함수가 연결을 푼다 */
  function linkRequestSignal(signal: AbortSignal, scope: TaskScope): () => void {
    const cancel = (): void => {
      detach(
        deps.tasks.abort(scope, { code: "parent", message: "child turn request aborted" }),
        (cause) => {
          deps.logger.warn("loop.child_abort_failed", { reason: failureText(cause) });
        },
      );
    };
    if (signal.aborted) {
      cancel();
      return () => {};
    }
    signal.addEventListener("abort", cancel, { once: true });
    return () => {
      signal.removeEventListener("abort", cancel);
    };
  }

  // ── 큐 입력으로 시작 ────────────────────────────────────────────────

  /** 유휴 thread의 큐 입력으로 turn을 연다. 같은 thread의 중복 시작은 하나로 합친다 */
  function startFromQueue(thread: ThreadRuntime): Promise<StartOutcome | undefined> {
    if (thread.starting !== null) return thread.starting;
    if (thread.running !== null) return Promise.resolve(undefined);
    const queued = deps.tasks.inputs.peek(thread.threadId, ["steer", "followUp"]);
    if (!queued.ok) {
      // 큐를 읽지 못하면 시작하지 않는다. 입력은 큐에 남아 있고 다음 알림이나 재개 때 다시 본다
      deps.logger.warn("loop.start_failed", {
        threadId: thread.threadId,
        reason: queued.error.kind,
      });
      return Promise.resolve(undefined);
    }
    if (queued.value.length === 0) return Promise.resolve(undefined);
    const started = Promise.withResolvers<StartOutcome | undefined>();
    thread.starting = started.promise;
    const flags = { announced: false };
    const finished = thread.gate.run(0, async () => {
      try {
        const closed = await closeStaleOpenTurn(thread);
        if (!closed.ok) {
          deps.logger.warn("loop.start_failed", {
            threadId: thread.threadId,
            reason: closed.error.kind,
          });
          return;
        }
        await runNewTurn(thread, { kind: "queue" }, (outcome) => {
          flags.announced = true;
          thread.starting = null;
          started.resolve(outcome);
        });
      } finally {
        thread.starting = null;
        if (!flags.announced) started.resolve(undefined);
      }
    });
    // turn이 끝난 뒤 큐에 남은 followUp·steer로 다음 turn을 연다(L1.loop.spec §4.4)
    track(
      thread,
      finished.then(() => startFromQueue(thread)),
      "queue_turn",
    );
    return started.promise;
  }

  /** 이전 프로세스가 남긴 열린 turn이 있으면 interrupted로 닫는다(새 입력이 오면 후보를 대신한다, L1.persistence.spec §4.8.3) */
  async function closeStaleOpenTurn(thread: ThreadRuntime): Promise<Result<void, LoopError>> {
    const open = deps.session.query.openTurn(thread.threadId);
    if (!open.ok) return open;
    if (open.value === undefined || thread.running !== null) return ok(undefined);
    return await closeOpenTurn(thread, open.value.turnId, "owner_cancelled");
  }

  // ── 재개 ────────────────────────────────────────────────────────────

  /** 열린 turn을 interrupted로 닫는다: 결과 없는 호출을 닫고 T6를 쓴다 */
  /** 닫는 turn이 올린 미해결 승인 요청을 취소로 닫는다. 읽기나 취소가 실패해도 turn 닫기는 계속한다 */
  async function cancelTurnApprovals(
    threadId: ThreadId,
    turnId: TurnId,
    reason: string,
  ): Promise<void> {
    const approvals = deps.approvals;
    if (approvals === undefined) return;
    const restored = await approvals.restore(threadId);
    if (!restored.ok) {
      deps.logger.warn("loop.approvals_restore_failed", { threadId, reason: restored.error.kind });
      return;
    }
    const stale = restored.value.filter(
      (request) => request.origin.threadId === threadId && request.origin.turnId === turnId,
    );
    await forEachSequential(stale, async (request) => {
      const closed = await approvals.cancel(request.approvalId, `turn closed: ${reason}`);
      if (!closed.applied) {
        deps.logger.warn("loop.approval_cancel_not_applied", {
          threadId,
          approvalId: request.approvalId,
        });
      }
    });
  }

  async function closeOpenTurn(
    thread: ThreadRuntime,
    turnId: TurnId,
    reason: "abort_requested" | "owner_cancelled",
  ): Promise<Result<void, LoopError>> {
    const before = await readBranchEvents(thread.threadId);
    if (!before.ok) return before;
    const opened = reduceOpenTurn(before.value, turnId);
    if (opened === undefined || opened.completed) return ok(undefined);
    // 이 turn이 남긴 미해결 승인 요청은 답을 받을 호출이 없다. 닫는 turn에 커밋이 막히기 전에 취소로 닫는다(L1.tools.spec §4.7 8번)
    await cancelTurnApprovals(thread.threadId, turnId, reason);
    const scope = openTurnScope(thread, turnId);
    beginRunning(thread, turnId, scope);
    // 취소 신호를 켠다. 의도 커밋은 같은 키라 이미 있으면 다시 쓰지 않는다
    await deps.tasks.abort(scope, {
      code: opened.abortCode === "user" ? "user" : "parent",
      message: reason,
    });
    // 이전 프로세스가 남긴 결과 불명 효과(intent만, 또는 intent+exec만)를 합성 결과로 닫는다. 메모리 호출 표에는 그 호출이 없어
    // 아래 turn_end의 closeUnexecuted가 닫지 못한다(L1.persistence.spec §4.8.1 6단계). 취소 의도가 이미 커밋돼 재실행 없이 합성된다
    const recovered = deps.session.recover(thread.threadId, {
      toolReplay: (name) => deps.tools.meta(name)?.replay ?? null,
      cancelledByOwner: deps.cancelledByOwner,
      hostMode: deps.hostMode,
    });
    if (!recovered.ok) {
      thread.running = null;
      return recovered;
    }
    // 합성 결과가 들어갔으므로 다시 읽는다: 아직 결과가 없는 호출은 의도조차 없던 호출뿐이다
    const after = await readBranchEvents(thread.threadId);
    if (!after.ok) {
      thread.running = null;
      return after;
    }
    const reduction = reduceOpenTurn(after.value, turnId);
    if (reduction === undefined || reduction.completed) {
      thread.running = null;
      return ok(undefined);
    }
    const step = reduction.step;
    const unanswered = unansweredCalls(reduction);
    const result = await runLoopTurn(ctx, {
      thread,
      turnId,
      scope,
      entry: {
        kind: "turn_end",
        closing:
          step === null || unanswered.length === 0
            ? null
            : {
                step: {
                  threadId: thread.threadId,
                  turnId,
                  stepId: step.stepId,
                  stepIndex: step.stepIndex,
                },
                calls: unanswered,
              },
      },
      ...priorOf(reduction),
      interactive: false,
      scopeId: reduction.scopeId,
      leaseId: null,
      driveSignal: null,
      consumedSeq: 0,
      leaseRefs: [],
      scopeRef: null,
      child: null,
    });
    await finishRun(thread, result);
    return ok(undefined);
  }

  /**
   * 게이트를 쥔 채로 열린 turn을 이어 끝낸다. `onBegin`은 재진입을 시작하기 직전에 한 번 부른다.
   * 돌려주는 값은 turn을 끝까지 실행한 결과다(이어갈 것이 없거나 닫기만 했으면 undefined).
   */
  async function resumeInGate(
    thread: ThreadRuntime,
    onBegin: (result: Result<ResumeResult, LoopError>) => void,
    child: ChildTurnRequest | null = null,
  ): Promise<TurnRunResult | undefined> {
    const threadId = thread.threadId;
    const recovered = deps.session.recover(threadId, {
      toolReplay: (name) => deps.tools.meta(name)?.replay ?? null,
      cancelledByOwner: deps.cancelledByOwner,
      hostMode: deps.hostMode,
    });
    if (!recovered.ok) {
      onBegin(err(recovered.error));
      return undefined;
    }
    const plan = recovered.value;
    const openRead = deps.session.query.openTurn(threadId);
    if (!openRead.ok) {
      onBegin(err(openRead.error));
      return undefined;
    }
    const open = openRead.value;
    if (open === undefined) {
      onBegin(ok({ status: "nothing" }));
      return undefined;
    }
    const events = await readBranchEvents(threadId);
    if (!events.ok) {
      onBegin(err(events.error));
      return undefined;
    }
    const reduction = reduceOpenTurn(events.value, open.turnId);
    if (reduction === undefined) {
      onBegin(ok({ status: "nothing" }));
      return undefined;
    }
    const reentry = planReentry({
      reduction,
      plan,
      cancelledByOwner: deps.cancelledByOwner(threadId, open.turnId),
    });
    if (reentry.kind === "nothing") {
      onBegin(ok({ status: "nothing" }));
      return undefined;
    }
    if (reentry.kind === "close") {
      onBegin(ok({ status: "closed", turnId: open.turnId, reason: reentry.reason }));
      const closed = await closeOpenTurn(thread, open.turnId, reentry.reason);
      // 닫는 중 읽기·복구가 실패하면 turn은 열린 채 남아 다음 재개나 새 입력이 다시 닫는다
      if (!closed.ok) {
        deps.logger.warn("loop.close_failed", { threadId, reason: closed.error.kind });
      }
      return undefined;
    }
    // 미해결 승인 요청을 메모리 대기로 되살린다. 읽지 못하면 재개를 시작하지 않는다(thread.resumed를 남기지 않는다)
    if (reentry.from === "await_input" && deps.approvals !== undefined) {
      const restored = await deps.approvals.restore(threadId);
      if (!restored.ok) {
        onBegin(err(restored.error));
        return undefined;
      }
    }
    const begun = deps.session.beginResume(threadId, "manual");
    if (!begun.ok) {
      // 재개 횟수 상한에 이른 thread는 후보에서 뺀다(L1.loop.spec §4.6)
      onBegin(
        begun.error.kind === "attempts_exhausted" || begun.error.kind === "no_open_turn"
          ? ok({ status: "nothing" })
          : err(begun.error),
      );
      return undefined;
    }
    onBegin(ok({ status: "resumed", turnId: open.turnId, from: reentry.from }));

    const scope = openTurnScope(thread, open.turnId, child?.scope);
    beginRunning(thread, open.turnId, scope);
    const entry: TurnEntry = reentry.entry;
    const checkpoint =
      plan.checkpoint !== null && plan.checkpoint.turnId === open.turnId ? plan.checkpoint : null;
    const result = await runLoopTurn(ctx, {
      thread,
      turnId: open.turnId,
      scope,
      entry,
      interactive: child === null ? reduction.scopeId === null : child.tools.interactive,
      scopeId: reduction.scopeId,
      leaseId: null,
      driveSignal: null,
      consumedSeq: checkpoint?.inputCursor.consumedSeq ?? 0,
      leaseRefs: checkpoint?.leaseRefs ?? [],
      scopeRef: checkpoint?.scopeRef ?? null,
      ...priorOf(reduction),
      child,
    });
    await finishRun(thread, result);
    return result;
  }

  // ── LoopService ─────────────────────────────────────────────────────

  async function admit(request: AdmitRequest): Promise<Result<AdmitResult, LoopError>> {
    const requestId = request.requestId ?? deps.ids.next("evt");
    if (requestId.length < 1 || requestId.length > 64) {
      return err({ kind: "input_invalid", message: "requestId must be 1-64 characters" });
    }
    const thread = runtimeOf(request.threadId);
    const wasBusy = thread.running !== null || thread.starting !== null;
    const mode: InputMode = wasBusy ? (request.whenBusy ?? "followUp") : "followUp";

    // input 지점(chain): 확장이 바꾸거나 처리 끝(handled)을 낸다. handled면 아무것도 기록하지 않는다
    const flat =
      typeof request.content === "string"
        ? { text: request.content, images: [] }
        : textAndImages(request.content);
    const streamingBehavior = wasBusy
      ? mode === "steer"
        ? ("steer" as const)
        : mode === "followUp"
          ? ("followUp" as const)
          : undefined
      : undefined;
    const imageField = flat.images.length === 0 ? {} : { images: [...flat.images] };
    const chain = await deps.ext.dispatch(
      "input.user.before",
      {
        text: flat.text,
        ...imageField,
        source: request.via,
        ...(streamingBehavior === undefined ? {} : { streamingBehavior }),
      },
      {
        threadId: request.threadId,
        dispatchKey: `input:${requestId}`,
        initial: { text: flat.text, ...imageField, handled: false },
      },
    );
    if (chain.value.handled) return ok({ status: "handled" });

    const images = chain.value.images ?? [];
    const item: PostItem = {
      kind: "user",
      content:
        images.length === 0
          ? chain.value.text
          : [{ type: "text", text: chain.value.text }, ...images],
    };
    const enqueued = await deps.tasks.inputs.enqueue({
      threadId: request.threadId,
      mode,
      item,
      requestId,
      source: { type: "user", via: request.via },
    });
    if (!enqueued.ok) {
      const error = enqueued.error;
      switch (error.kind) {
        case "invalid_request_id":
          return err({ kind: "input_invalid", message: `invalid requestId: ${error.requestId}` });
        case "mode_not_supported":
          return err({ kind: "input_invalid", message: `mode is not supported: ${error.mode}` });
        case "thread_closed":
          return err({ kind: "input_invalid", message: "thread is closed" });
        case "busy":
        case "disk_full":
        case "io":
        case "ownership_lost":
        case "read_only":
        case "thread_not_found":
        case "row_invalid":
          return err(error);
        default:
          return assertNever(error, "InputQueueError");
      }
    }
    const receipt = enqueued.value;
    if (receipt.duplicate) {
      // 같은 requestId의 재제출(F wire turn.start, TX-05). turn이 이미 시작됐으면 그 turn을 돌려준다.
      // 입력만 접수되고 T1 전이면(진행 중 재시도, C1~C2 사이 크래시) 새 입력처럼 이어서 시작한다
      const existing = deps.session.query.turnByRequestId(request.threadId, null, requestId);
      if (!existing.ok) return err(existing.error);
      if (existing.value !== undefined) {
        return ok({
          status: "duplicate",
          inputId: receipt.inputId,
          turnId: existing.value.turnId,
        });
      }
    }
    if (wasBusy) {
      return ok({
        status: "queued",
        inputId: receipt.inputId,
        mode,
        runningTurnId: thread.running?.turnId ?? null,
      });
    }
    // 유휴 thread: 구동기가 T1을 커밋할 때까지 기다린다. onQueued가 이미 시작했으면 배치 표시로 알아본다
    const alreadyPlaced = thread.placed.get(receipt.inputId);
    if (alreadyPlaced !== undefined) {
      return ok({ status: "started", inputId: receipt.inputId, turnId: alreadyPlaced });
    }
    const started = await startFromQueue(thread);
    if (started !== undefined && started.status === "started") {
      const placed = started.planned.inputs.some((input) => input.inputId === receipt.inputId);
      if (placed) {
        return ok({ status: "started", inputId: receipt.inputId, turnId: started.turnId });
      }
    }
    const placedLater = thread.placed.get(receipt.inputId);
    if (placedLater !== undefined) {
      return ok({ status: "started", inputId: receipt.inputId, turnId: placedLater });
    }
    return ok({
      status: "queued",
      inputId: receipt.inputId,
      mode,
      runningTurnId: thread.running?.turnId ?? null,
    });
  }

  async function runTurn(request: LoopTurnRequest): Promise<LoopTurnResult> {
    const thread = runtimeOf(request.threadId);
    return await thread.gate.run(1, async () => {
      const started = Promise.withResolvers<StartOutcome>();
      const result = await runNewTurn(thread, { kind: "drive", request }, started.resolve);
      const outcome = await started.promise;
      if (outcome.status === "started") {
        if (result === undefined) {
          throw new LoopRejection({ kind: "thread_not_found", threadId: request.threadId });
        }
        return {
          outcome: {
            turnId: outcome.turnId,
            status: outcomeStatus(result.status),
            ...(result.finalItemId === null ? {} : { finalItemId: result.finalItemId }),
          },
          replayed: false,
          usage: result.usage,
        };
      }
      if (outcome.status === "failed") {
        throw new LoopRejection({ kind: "input_invalid", message: outcome.reason });
      }
      return await handleStartRejection(thread, request, outcome.failure);
    });
  }

  /**
   * 자식 thread turn(L1.loop.spec §4.13). 주 대화와 같은 루프로 돌되 시스템 프롬프트, 모델, 도구 맥락, 한도를 요청에서 받는다.
   * 같은 `requestId`의 turn이 이미 있으면 새로 열지 않고 기록된 결과를 돌려주거나(`replayed: true`) 열린 turn을 이어 끝낸다.
   */
  async function runChildTurn(
    request: ChildTurnRequest,
  ): Promise<Result<LoopTurnResult, LoopError>> {
    const thread = runtimeOf(request.threadId);
    try {
      const result = await thread.gate.run(1, async (): Promise<LoopTurnResult> => {
        const started = Promise.withResolvers<StartOutcome>();
        const finished = await runNewTurn(thread, { kind: "child", request }, started.resolve);
        const outcome = await started.promise;
        if (outcome.status === "started") {
          if (finished === undefined) {
            throw new LoopRejection({ kind: "thread_not_found", threadId: request.threadId });
          }
          return {
            outcome: {
              turnId: outcome.turnId,
              status: outcomeStatus(finished.status),
              ...(finished.finalItemId === null ? {} : { finalItemId: finished.finalItemId }),
            },
            replayed: false,
            usage: finished.usage,
          };
        }
        if (outcome.status === "failed") {
          throw new LoopRejection({ kind: "input_invalid", message: outcome.reason });
        }
        return await handleStartRejection(thread, request, outcome.failure);
      });
      return ok(result);
    } catch (error) {
      if (error instanceof LoopRejection) return err(error.loopError);
      throw error;
    }
  }

  /**
   * T1 거부를 호출자에게 돌려준다. drive turn(`LoopTurnRequest`)과 자식 turn(`ChildTurnRequest`)이 같은 규칙을 쓴다:
   * 같은 신원(drive는 `(scopeId, requestId)`, 자식은 `(자식 thread, 범위 없음, requestId)`)의 turn이 있으면 기록된 결과나 이어 끝낸 결과다
   */
  async function handleStartRejection(
    thread: ThreadRuntime,
    request: LoopTurnRequest | ChildTurnRequest,
    failure: CommitFailure,
  ): Promise<LoopTurnResult> {
    if (failure.kind === "store") throw new LoopRejection(failure.error);
    if (failure.kind === "key_reused") {
      throw new LoopRejection({ kind: "input_invalid", message: describeCommitFailure(failure) });
    }
    switch (failure.code) {
      case "stale_lease":
        if (!("leaseEpoch" in request)) {
          throw new LoopRejection({
            kind: "input_invalid",
            message: describeCommitFailure(failure),
          });
        }
        throw new LoopRejection({
          kind: "stale_lease",
          scopeId: request.scopeId,
          leaseEpoch: request.leaseEpoch,
        });
      case "thread_absent":
        throw new LoopRejection({ kind: "thread_not_found", threadId: request.threadId });
      case "turn_exists": {
        const existing = deps.session.query.turnByRequestId(
          request.threadId,
          "leaseEpoch" in request ? request.scopeId : null,
          request.requestId,
        );
        if (!existing.ok) throw new LoopRejection(existing.error);
        if (existing.value === undefined) {
          throw new LoopRejection({ kind: "input_invalid", message: "recorded turn is missing" });
        }
        return await replayedResult(
          thread,
          existing.value.turnId,
          existing.value.status,
          "leaseEpoch" in request ? null : request,
        );
      }
      // xeon-disable-next-line xeon/switch-default-never -- 거부 코드(CommitFailure.code)는 문자열이라 열린 값이다. 모르는 코드는 예상 가능한 실패로 돌려준다 (eng.typescript.guide TY-14)
      default:
        throw new LoopRejection({ kind: "input_invalid", message: describeCommitFailure(failure) });
    }
  }

  /** 이미 기록된 turn의 결과를 돌려준다. 열린 turn이면 이어서 끝낸 뒤 돌려준다(`replayed: true`) */
  async function replayedResult(
    thread: ThreadRuntime,
    turnId: TurnId,
    status: "running" | "waiting" | "completed" | "interrupted" | "failed",
    child: ChildTurnRequest | null = null,
  ): Promise<LoopTurnResult> {
    if (status === "running" || status === "waiting") {
      const result = await resumeInGate(thread, () => {}, child);
      if (result !== undefined) {
        return {
          outcome: {
            turnId,
            status: outcomeStatus(result.status),
            ...(result.finalItemId === null ? {} : { finalItemId: result.finalItemId }),
          },
          replayed: true,
          usage: result.usage,
        };
      }
    }
    const events = await readBranchEvents(thread.threadId);
    if (!events.ok) throw new LoopRejection(events.error);
    const reduction = reduceOpenTurn(events.value, turnId);
    const finalItemId = reduction?.lastAssistantItemId;
    return {
      outcome: {
        turnId,
        status: status === "completed" ? "completed" : status === "failed" ? "error" : "aborted",
        ...(finalItemId === undefined || finalItemId === null ? {} : { finalItemId }),
      },
      replayed: true,
      usage: reduction?.usage ?? null,
    };
  }

  const service: LoopServiceHandle = {
    status: (threadId) =>
      (threads.get(threadId)?.running?.phase ?? "idle") === "idle" ? "idle" : "running",
    runTurn,
    spawn: () =>
      Promise.reject(
        new LoopRejection({
          kind: "input_invalid",
          message: "loop.spawn is available from M2 (xeon.agents)",
        }),
      ),
    whenIdle: (threadId, fn) => runtimeOf(threadId).gate.run(1, fn),
    // user_bash 지점 발화, xeon.tools.runUserShell 실행, 컨텍스트 기록(L1.loop.spec §3.1, LP12)
    runUserBash: (request) => userBash.run(request),
    admit,
    runChildTurn,
    async interrupt(threadId, turnId) {
      const running = threads.get(threadId)?.running;
      if (running === null || running === undefined) return false;
      if (turnId !== undefined && running.turnId !== turnId) return false;
      const ticket = await deps.tasks.abort(running.scope, { code: "user", message: null });
      return ticket.ok && ticket.value.status !== "already_settled";
    },
    async resume(threadId) {
      const thread = runtimeOf(threadId);
      if (thread.running !== null) return ok({ status: "nothing" });
      const begun = Promise.withResolvers<Result<ResumeResult, LoopError>>();
      const flags = { called: false };
      const finished = thread.gate.run(0, async () => {
        try {
          await resumeInGate(thread, (result) => {
            flags.called = true;
            begun.resolve(result);
          });
        } finally {
          if (!flags.called) begun.resolve(ok({ status: "nothing" }));
        }
      });
      track(
        thread,
        finished.then(() => startFromQueue(thread)),
        "resume",
      );
      return await begun.promise;
    },
    async stopAtSafeBoundary(deadlineMs) {
      const active = [...threads.values()].filter((thread) => thread.running !== null);
      for (const thread of active) thread.stopRequested = true;
      const stopped = Promise.all(active.map((thread) => thread.gate.run(1, settledNow))).then(
        () => true,
      );
      const timer: { handle: ReturnType<Scheduler["setTimeout"]> | null } = { handle: null };
      const timeout = new Promise<boolean>((resolve) => {
        timer.handle = deps.scheduler.setTimeout(() => {
          resolve(false);
        }, deadlineMs);
      });
      const done = await Promise.race([stopped, timeout]);
      if (timer.handle !== null) deps.scheduler.clearTimeout(timer.handle);
      for (const thread of active) thread.stopRequested = false;
      return done;
    },
    threadStatus(threadId): ThreadLoopStatus {
      const running = threads.get(threadId)?.running;
      return {
        threadId,
        runningTurnId: running?.turnId ?? null,
        stepIndex: running?.stepIndex ?? null,
        phase: running?.phase ?? "idle",
      };
    },
    dispose() {
      unsubscribeCommits();
      unsubscribeQueue();
      threads.clear();
    },
  };
  return service;
}
