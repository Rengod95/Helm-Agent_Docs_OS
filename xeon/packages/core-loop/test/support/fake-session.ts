import { Bug, canonicalJson, err, ok, parse, type Clock } from "@xeon/contracts";
import {
  EventIdSchema,
  type EffectId,
  type EventId,
  type IdFactory,
  type ThreadId,
  type TurnId,
} from "@xeon/contracts/conversation";
import {
  decideEffectRecovery,
  EffectExecSchema,
  EffectIntentSchema,
  EVENT_CATALOG,
  ItemRecordedPayloadSchema,
  ownerOfKind,
  StepCheckpointSchema,
  type CommitBatch,
  type CommitListener,
  type CommitRequest,
  type CommitResult,
  type DraftInput,
  type DurableEventDraft,
  type DurableEventEnvelope,
  type EffectIntent,
  type InputView,
  type ProducerHandle,
  type ProducerId,
  type ResumePlan,
  type SessionService,
  type StampedDraft,
  type StepCheckpoint,
  type StoreError,
  type TurnView,
  type TxView,
  type VolatileEventEnvelope,
} from "@xeon/contracts/records";
import { memoryRecordStore } from "@xeon/ext-host/testing";

// 테스트 대역: core-persistence의 커밋 의미(커밋 키 멱등, build 동기 호출, 낙인 검사, 피드 방출)만 흉내 낸다.
// 실제 SQLite를 쓰지 않는다(core-loop는 platform-store·core-persistence를 import할 수 없다, DR-14).

/** 프로세스가 죽는 지점을 흉내 내는 예외 */
class CrashError extends Error {
  override readonly name: string = "CrashError";
}

export interface FakeSessionOptions {
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly maxResumeAttempts?: number;
}

type Rec = Readonly<Record<string, unknown>>;

function isRec(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recOf(event: DurableEventEnvelope): Rec {
  return isRec(event.payload) ? event.payload : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function eventIdOf(value: unknown): EventId | undefined {
  const parsed = parse(EventIdSchema, value);
  return parsed.ok ? parsed.value : undefined;
}

function notImplemented(name: string): never {
  throw new Bug(`fake-session: ${name} is not implemented`);
}

function stamp(producer: ProducerId, input: DraftInput): StampedDraft {
  const owner = ownerOfKind(input.kind);
  const allowed =
    owner === producer ||
    (producer === "core.tools" && input.kind === "item.recorded") ||
    (producer === "core.persistence" &&
      (input.kind === "effect.result" || input.kind === "item.recorded"));
  if (!allowed) {
    throw new Bug(`store.prefix_not_owned: ${producer} cannot draft ${input.kind}`);
  }
  const draft: DurableEventDraft = { ...input, version: input.version ?? 1, durable: true };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 테스트 대역: 낙인 브랜드는 저장소 구현만 붙인다
  return { draft, producer } as unknown as StampedDraft;
}

function validate(draft: DurableEventDraft): void {
  const entry = EVENT_CATALOG.find((candidate) => candidate.kind === draft.kind);
  if (entry === undefined) return;
  const parsed = parse(entry.payload, draft.payload);
  if (!parsed.ok) {
    throw new Bug(
      `fake-session.schema_invalid: ${draft.kind} ${JSON.stringify(parsed.error.issues.slice(0, 3))}`,
    );
  }
}

type TurnRow = TurnView & { readonly requestId: string | null; readonly scopeId: string | null };

export interface FakeSession {
  readonly session: SessionService;
  events(threadId?: ThreadId): readonly DurableEventEnvelope[];
  kinds(threadId: ThreadId): readonly string[];
  volatile(): readonly VolatileEventEnvelope[];
  commitKeys(threadId: ThreadId): readonly string[];
  /** thread.started를 커밋한다 */
  startThread(threadId?: ThreadId): ThreadId;
  /** 조건에 맞는 다음 커밋을 적용하기 전에 CrashError를 던진다(커밋 전 장애) */
  crashBefore(predicate: (requestId: string) => boolean): void;
  /** 조건에 맞는 다음 커밋을 적용한 뒤 알림 없이 CrashError를 던진다(after_commit) */
  crashAfter(predicate: (requestId: string) => boolean): void;
  clearCrash(): void;
  /** 다음 commit 몇 번을 busy로 거부한다 */
  failNextWithBusy(count?: number): void;
  /** 조건에 맞는 커밋을 몇 번 busy로 거부한다(같은 커밋 키 재시도 시험) */
  failBusyFor(predicate: (requestId: string) => boolean, times: number): void;
  setLeaseEpoch(threadId: ThreadId, scopeId: string, epoch: number): void;
  /** 프로세스 재시작을 흉내 낸다: 구독과 생산자 점유와 장애 설정을 비우고 기록은 그대로 둔다 */
  restartProcess(): void;
  readonly commitCalls: number;
}

export function createFakeSession(options: FakeSessionOptions): FakeSession {
  const { clock, ids } = options;
  const log: DurableEventEnvelope[] = [];
  const keysByEvent = new Map<EventId, string>();
  const requests = new Map<
    string,
    { readonly fingerprint: string; readonly result: CommitResult }
  >();
  const claimed = new Set<ProducerId>();
  const listeners = new Set<CommitListener>();
  const volatileListeners = new Set<(event: VolatileEventEnvelope) => void>();
  const volatileLog: VolatileEventEnvelope[] = [];
  const epochOverrides = new Map<string, number>();
  const resumeAttempts = new Map<TurnId, number>();
  const crash: {
    before: ((key: string) => boolean) | null;
    after: ((key: string) => boolean) | null;
    busy: number;
    dead: boolean;
    busyFor: { predicate: (key: string) => boolean; left: number } | null;
  } = { before: null, after: null, busy: 0, dead: false, busyFor: null };
  const counters = { seq: 0, calls: 0 };
  const recordStore = memoryRecordStore();

  const eventsOf = (threadId: ThreadId): DurableEventEnvelope[] =>
    log.filter((event) => event.threadId === threadId);

  // ── 이벤트 읽기 도우미 ────────────────────────────────────────────

  function turnsOf(threadId: ThreadId): Map<TurnId, TurnRow> {
    const out = new Map<TurnId, TurnRow>();
    for (const event of eventsOf(threadId)) {
      const turnId = event.turnId;
      if (turnId === null) continue;
      const payload = recOf(event);
      const known = out.get(turnId);
      if (event.kind === "turn.started") {
        out.set(turnId, {
          turnId,
          status: "running",
          abortRequested: false,
          stepCount: 0,
          requestId: str(payload["requestId"]) ?? null,
          scopeId: str(payload["scopeId"]) ?? null,
        });
      } else if (known !== undefined && event.kind === "turn.completed") {
        const status = str(payload["status"]);
        out.set(turnId, {
          ...known,
          status: status === "interrupted" || status === "failed" ? status : "completed",
        });
      } else if (known !== undefined && event.kind === "turn.abort_requested") {
        out.set(turnId, { ...known, abortRequested: true });
      } else if (known !== undefined && event.kind === "step.completed") {
        out.set(turnId, { ...known, stepCount: known.stepCount + 1 });
      }
    }
    return out;
  }

  function openTurnOf(threadId: ThreadId): TurnRow | undefined {
    return [...turnsOf(threadId).values()].find(
      (turn) => turn.status === "running" || turn.status === "waiting",
    );
  }

  function inputsOf(threadId: ThreadId): InputView[] {
    const out = new Map<EventId, InputView>();
    for (const event of eventsOf(threadId)) {
      const payload = recOf(event);
      if (event.kind === "input.queued") {
        const source = isRec(payload["source"]) ? payload["source"] : {};
        const sourceType = str(source["type"]) ?? "user";
        const scopeId = str(source["scopeId"]);
        const mode = str(payload["mode"]);
        out.set(event.id, {
          inputId: event.id,
          seq: event.seq,
          mode: mode === "steer" || mode === "next" || mode === "aside" ? mode : "followUp",
          state: "queued",
          sourceKey:
            sourceType === "extension" && scopeId !== undefined
              ? scopeId.replaceAll("/", ":")
              : sourceType,
          requestId: str(payload["requestId"]) ?? "",
        });
      } else if (event.kind === "input.placed" || event.kind === "input.withdrawn") {
        const inputId = eventIdOf(payload["inputId"]);
        const known = inputId === undefined ? undefined : out.get(inputId);
        if (known !== undefined) {
          out.set(known.inputId, {
            ...known,
            state: event.kind === "input.placed" ? "placed" : "withdrawn",
          });
        }
      }
    }
    return [...out.values()];
  }

  function checkpointOf(threadId: ThreadId): StepCheckpoint | null {
    const found = eventsOf(threadId).findLast((event) => event.kind === "checkpoint.step");
    if (found === undefined) return null;
    const parsed = parse(StepCheckpointSchema, found.payload);
    return parsed.ok ? parsed.value : null;
  }

  function viewOf(threadId: ThreadId): TxView {
    const mine = eventsOf(threadId);
    return {
      threadId,
      headSeq: counters.seq,
      leaf: mine.at(-1)?.id ?? null,
      threadStatus:
        mine.length === 0 ? "absent" : openTurnOf(threadId) === undefined ? "idle" : "running",
      turn: (turnId) => turnsOf(threadId).get(turnId),
      turnAbortRequested: (turnId) => turnsOf(threadId).get(turnId)?.abortRequested === true,
      effect: () => undefined,
      effectByToolCall: () => undefined,
      turnByRequestId: (_thread, scopeId, requestId) =>
        [...turnsOf(threadId).values()].find(
          (turn) => turn.requestId === requestId && turn.scopeId === scopeId,
        ),
      scopeLeaseEpoch: (_thread, scopeId) =>
        epochOverrides.get(`${threadId}|${scopeId}`) ??
        mine.filter(
          (event) => event.kind === "lease.acquired" && recOf(event)["scopeId"] === scopeId,
        ).length,
      inputByRequestId: (_thread, sourceKey, requestId) =>
        inputsOf(threadId).find(
          (input) => input.sourceKey === sourceKey && input.requestId === requestId,
        ),
      queuedInputs: () => inputsOf(threadId).filter((input) => input.state === "queued"),
      approval: () => undefined,
      agentByRequestId: () => undefined,
      scopeStateRev: () => 0,
      lastCheckpoint: () => checkpointOf(threadId),
    };
  }

  // ── 커밋 ─────────────────────────────────────────────────────────

  function applyDrafts(
    threadId: ThreadId,
    key: string,
    drafts: readonly DurableEventDraft[],
    checkpoint: Omit<
      StepCheckpoint,
      "checkpointId" | "schemaVersion" | "threadId" | "leafEventId"
    > | null,
  ): { readonly result: CommitResult; readonly appended: readonly DurableEventEnvelope[] } {
    const appended: DurableEventEnvelope[] = [];
    let leaf: EventId | null = eventsOf(threadId).at(-1)?.id ?? null;
    const first = counters.seq + 1;
    const push = (draft: DurableEventDraft): void => {
      counters.seq += 1;
      const envelope: DurableEventEnvelope = {
        id: draft.id,
        kind: draft.kind,
        version: draft.version,
        threadId: draft.threadId,
        turnId: draft.turnId,
        stepId: draft.stepId,
        recordedAt: clock.now(),
        causationId: draft.causationId,
        correlationId: draft.correlationId,
        payload: draft.payload,
        durable: true,
        seq: counters.seq,
        parentId: draft.parentId === undefined ? leaf : draft.parentId,
      };
      log.push(envelope);
      keysByEvent.set(envelope.id, key);
      appended.push(envelope);
      leaf = envelope.id;
    };
    for (const draft of drafts) {
      validate(draft);
      push(draft);
    }
    if (checkpoint !== null) {
      const completed = appended.find((event) => event.kind === "step.completed");
      if (completed === undefined && checkpoint.next !== "await_input") {
        throw new Bug("store.checkpoint_without_step");
      }
      const leafEventId = appended.at(-1)?.id ?? leaf;
      if (leafEventId === null) throw new Bug("fake-session: checkpoint without a leaf");
      const payload: StepCheckpoint = {
        checkpointId: ids.next("ckp"),
        schemaVersion: 1,
        threadId,
        ...checkpoint,
        leafEventId,
      };
      const draft: DurableEventDraft = {
        id: ids.next("evt"),
        kind: "checkpoint.step",
        version: 1,
        threadId,
        turnId: checkpoint.turnId,
        stepId: checkpoint.stepId,
        causationId: null,
        correlationId: null,
        payload,
        durable: true,
      };
      validate(draft);
      push(draft);
    }
    return {
      result: {
        status: "committed",
        firstSeq: first,
        lastSeq: counters.seq,
        leaf,
        eventIds: appended.map((event) => event.id),
        replayed: false,
      },
      appended,
    };
  }

  function commit(request: CommitRequest): ReturnType<SessionService["commit"]> {
    counters.calls += 1;
    // 프로세스가 죽은 뒤에는 어떤 커밋도 일어나지 않는다
    if (crash.dead) throw new CrashError(`process is dead (${request.requestId})`);
    if (crash.busy > 0) {
      crash.busy -= 1;
      const error: StoreError = { kind: "busy" };
      return err(error);
    }
    if (crash.busyFor !== null && crash.busyFor.predicate(request.requestId)) {
      crash.busyFor.left -= 1;
      if (crash.busyFor.left <= 0) crash.busyFor = null;
      const error: StoreError = { kind: "busy" };
      return err(error);
    }
    const key = `${request.threadId}|${request.requestId}`;
    const fingerprint = canonicalJson(request.fingerprintSource);
    const prior = requests.get(key);
    if (prior !== undefined) {
      if (prior.fingerprint !== fingerprint) {
        return ok({ status: "key_reused", requestId: request.requestId });
      }
      return ok(
        prior.result.status === "key_reused" ? prior.result : { ...prior.result, replayed: true },
      );
    }
    if (crash.before?.(request.requestId) === true) {
      crash.before = null;
      crash.dead = true;
      throw new CrashError(`crash before ${request.requestId}`);
    }
    const plan = request.build(viewOf(request.threadId));
    if (plan.kind === "reject") {
      const result: CommitResult = {
        status: "rejected",
        code: plan.code,
        detail: plan.detail,
        replayed: false,
      };
      requests.set(key, { fingerprint, result });
      return ok(result);
    }
    const { result, appended } = applyDrafts(
      request.threadId,
      request.requestId,
      plan.drafts.map((stamped) => stamped.draft),
      plan.checkpoint,
    );
    requests.set(key, { fingerprint, result });
    if (crash.after?.(request.requestId) === true) {
      crash.after = null;
      crash.dead = true;
      throw new CrashError(`crash after ${request.requestId}`);
    }
    if (result.status === "committed") {
      const batch: CommitBatch = {
        firstSeq: result.firstSeq,
        lastSeq: result.lastSeq,
        events: appended,
      };
      for (const listener of listeners) listener(batch);
    }
    return ok(result);
  }

  /** 합성 결과 등 저장소 자신이 쓰는 커밋 */
  function internalCommit(
    threadId: ThreadId,
    requestId: string,
    drafts: readonly DurableEventDraft[],
  ): void {
    const stamped = drafts.map((draft) => stamp("core.persistence", { ...draft }));
    commit({
      threadId,
      requestId,
      fingerprintSource: { requestId },
      build: () => ({ kind: "append", drafts: stamped, checkpoint: null }),
    });
  }

  // ── 재개 ─────────────────────────────────────────────────────────

  function recover(
    threadId: ThreadId,
    deps: Parameters<SessionService["recover"]>[1],
  ): ReturnType<SessionService["recover"]> {
    const open = openTurnOf(threadId);
    const checkpoint = checkpointOf(threadId);
    const reruns: { intent: EffectIntent; attempt: number }[] = [];
    const synthesized: {
      effectId: EffectId;
      toolCallId: string;
      code: "not_started" | "outcome_unknown";
    }[] = [];
    const pendingToolCalls: ResumePlan["pendingToolCalls"][number][] = [];
    if (open !== undefined) {
      const mine = eventsOf(threadId).filter((event) => event.turnId === open.turnId);
      const intents = mine.flatMap((event) => {
        if (event.kind !== "effect.intent") return [];
        const parsed = parse(EffectIntentSchema, event.payload);
        return parsed.ok ? [{ event, intent: parsed.value }] : [];
      });
      for (const { event: intentEvent, intent } of intents) {
        const hasResult = mine.some(
          (event) => event.kind === "effect.result" && recOf(event)["effectId"] === intent.effectId,
        );
        if (hasResult) continue;
        const execEvent = mine.find(
          (event) => event.kind === "effect.exec" && recOf(event)["effectId"] === intent.effectId,
        );
        const execParsed =
          execEvent === undefined ? null : parse(EffectExecSchema, execEvent.payload);
        const decision = decideEffectRecovery({
          intent,
          exec: execParsed?.ok === true ? execParsed.value : null,
          result: null,
          currentReplay: deps.toolReplay(intent.toolName),
        });
        if (decision.action === "rerun") {
          reruns.push({ intent: decision.intent, attempt: 1 });
        } else if (decision.action === "synthesize") {
          const itemId = ids.next("itm");
          internalCommit(threadId, `tool:${intent.toolCallId}:result`, [
            {
              id: ids.next("evt"),
              kind: "effect.result",
              version: 1,
              threadId,
              turnId: open.turnId,
              stepId: intentEvent.stepId,
              causationId: null,
              correlationId: null,
              payload: { ...decision.result, resultItemId: itemId },
              durable: true,
            },
            {
              id: ids.next("evt"),
              kind: "item.recorded",
              version: 1,
              threadId,
              turnId: open.turnId,
              stepId: intentEvent.stepId,
              causationId: null,
              correlationId: null,
              payload: {
                item: {
                  itemId,
                  status: "completed",
                  kind: "toolResult",
                  message: {
                    role: "toolResult",
                    toolCallId: intent.toolCallId,
                    toolName: intent.toolName,
                    content: [{ type: "text", text: decision.content }],
                    isError: true,
                    timestamp: clock.now(),
                  },
                  effectId: intent.effectId,
                },
              },
              durable: true,
            },
          ]);
          synthesized.push({
            effectId: intent.effectId,
            toolCallId: intent.toolCallId,
            code: decision.code,
          });
        }
      }
      // 의도가 없는 도구 호출: 마지막 단계의 어시스턴트가 낸 호출 중 의도도 결과도 없는 것
      const lastStarted = mine.findLast((event) => event.kind === "step.started");
      const afterStep = mine.filter(
        (event) => lastStarted !== undefined && event.seq > lastStarted.seq,
      );
      const stepDone = afterStep.some((event) => event.kind === "step.completed");
      const assistant = afterStep.flatMap((event) => {
        if (event.kind !== "item.recorded") return [];
        const parsed = parse(ItemRecordedPayloadSchema, event.payload);
        return parsed.ok && parsed.value.item.kind === "assistant" ? [parsed.value.item] : [];
      })[0];
      if (assistant !== undefined && !stepDone) {
        for (const block of assistant.message.content) {
          if (block.type !== "toolCall") continue;
          const hasIntent = intents.some(({ intent }) => intent.toolCallId === block.id);
          const hasResult = afterStep.some((event) => {
            if (event.kind !== "item.recorded") return false;
            const parsed = parse(ItemRecordedPayloadSchema, event.payload);
            return (
              parsed.ok &&
              parsed.value.item.kind === "toolResult" &&
              parsed.value.item.message.toolCallId === block.id
            );
          });
          if (!hasIntent && !hasResult) {
            pendingToolCalls.push({ toolCallId: block.id, effectId: null, waiting: null });
          }
        }
      }
    }
    const plan: ResumePlan = {
      threadId,
      checkpoint,
      marker:
        open === undefined
          ? null
          : {
              turnId: open.turnId,
              runningSince: 0,
              resumeAttempts: resumeAttempts.get(open.turnId) ?? 0,
            },
      synthesized,
      reruns,
      pendingToolCalls,
      pendingApprovals: [],
      queuedInputs: inputsOf(threadId).filter((input) => input.state === "queued"),
      openChildren: [],
      abortRequestedTurn: open?.abortRequested === true ? open.turnId : null,
      next: open === undefined ? "idle" : (checkpoint?.next ?? "request"),
      autoResume: { allowed: false, reason: "setting_off" },
    };
    return ok(plan);
  }

  const feed: SessionService["feed"] = {
    headSeq: () => counters.seq,
    oldestReplayableSeq: () => 0,
    read: (after, upto, _filter, limit) => ({
      events: log.filter((event) => event.seq > after && event.seq <= upto).slice(0, limit),
      scannedTo: Math.min(upto, counters.seq),
    }),
    onCommit(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onVolatile(listener) {
      volatileListeners.add(listener);
      return () => {
        volatileListeners.delete(listener);
      };
    },
  };

  const session: SessionService = {
    commit,
    producer(id) {
      if (claimed.has(id)) throw new Bug(`store.producer_claimed: ${id}`);
      claimed.add(id);
      const handle: ProducerHandle = { producer: id, draft: (input) => stamp(id, input) };
      return handle;
    },
    projectors: {
      register: () => notImplemented("projectors.register"),
      list: () => [],
      onFailure: () => () => {},
    },
    query: {
      thread: () => undefined,
      turn: (threadId, turnId) => turnsOf(threadId).get(turnId),
      openTurn: (threadId) => openTurnOf(threadId),
      turnByRequestId: (threadId, scopeId, requestId) =>
        [...turnsOf(threadId).values()].find(
          (turn) => turn.requestId === requestId && turn.scopeId === scopeId,
        ),
      openEffects: () => [],
      queuedInputs: (threadId) => inputsOf(threadId).filter((input) => input.state === "queued"),
      pendingApprovals: () => [],
      childAgents: () => [],
      branchItems: () => [],
      itemEvent: () => undefined,
      latestEvent: () => undefined,
      liveBlobRefs: () => [],
    },
    readFrom: (afterSeq, readOptions) =>
      (async function* () {
        await Promise.resolve();
        for (const event of log) {
          if (event.seq <= afterSeq) continue;
          if (readOptions?.threadId !== undefined && event.threadId !== readOptions.threadId)
            continue;
          yield event;
        }
      })(),
    readBranch: (threadId) =>
      (async function* () {
        await Promise.resolve();
        for (const event of eventsOf(threadId)) yield event;
      })(),
    loadCheckpoint: (threadId) => Promise.resolve(checkpointOf(threadId)),
    subscribe: (_afterSeq, listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    feed,
    hydrate: (event) => Promise.resolve(event),
    emitVolatile(event) {
      volatileLog.push(event);
      for (const listener of volatileListeners) listener(event);
    },
    openForWrite: () => notImplemented("openForWrite"),
    openForRead: () => notImplemented("openForRead"),
    recover,
    beginResume(threadId, mode) {
      const open = openTurnOf(threadId);
      if (open === undefined) return err({ kind: "no_open_turn", threadId });
      const attempts = resumeAttempts.get(open.turnId) ?? 0;
      const max = options.maxResumeAttempts ?? 3;
      if (attempts >= max) return err({ kind: "attempts_exhausted", attempts, max });
      resumeAttempts.set(open.turnId, attempts + 1);
      internalCommit(threadId, `resume:${open.turnId}:${attempts + 1}`, [
        {
          id: ids.next("evt"),
          kind: "thread.resumed",
          version: 1,
          threadId,
          turnId: open.turnId,
          stepId: null,
          causationId: null,
          correlationId: null,
          payload: {
            turnId: open.turnId,
            attempt: attempts + 1,
            mode,
            fromCheckpointId: checkpointOf(threadId)?.checkpointId ?? null,
          },
          durable: true,
        },
      ]);
      return ok({ attempt: attempts + 1 });
    },
    release: () => Promise.resolve(),
    threads: {
      create: () => notImplemented("threads.create"),
      list: () => notImplemented("threads.list"),
      close: () => notImplemented("threads.close"),
      remove: () => notImplemented("threads.remove"),
      fork: () => notImplemented("threads.fork"),
      revert: () => notImplemented("threads.revert"),
      moveLeaf: () => notImplemented("threads.moveLeaf"),
      setTitle: () => notImplemented("threads.setTitle"),
      prepareSwitch: () => notImplemented("threads.prepareSwitch"),
    },
    sessionSettings: {
      layer: () => notImplemented("sessionSettings.layer"),
      set: () => notImplemented("sessionSettings.set"),
      reset: () => notImplemented("sessionSettings.reset"),
    },
    ext: recordStore,
  };

  return {
    session,
    events: (threadId) => (threadId === undefined ? log : eventsOf(threadId)),
    kinds: (threadId) => eventsOf(threadId).map((event) => event.kind),
    volatile: () => volatileLog,
    commitKeys: (threadId) => eventsOf(threadId).map((event) => keysByEvent.get(event.id) ?? ""),
    startThread(threadId = ids.next("thr")) {
      internalCommit(threadId, `thread:${threadId}:start`, [
        {
          id: ids.next("evt"),
          kind: "thread.started",
          version: 1,
          threadId,
          turnId: null,
          stepId: null,
          causationId: null,
          correlationId: null,
          payload: { title: null, forkedFrom: null },
          durable: true,
        },
      ]);
      return threadId;
    },
    crashBefore(predicate) {
      crash.before = predicate;
    },
    crashAfter(predicate) {
      crash.after = predicate;
    },
    clearCrash() {
      crash.before = null;
      crash.after = null;
      crash.dead = false;
    },
    failNextWithBusy(count = 1) {
      crash.busy = count;
    },
    failBusyFor(predicate, times) {
      crash.busyFor = { predicate, left: times };
    },
    setLeaseEpoch(threadId, scopeId, epoch) {
      epochOverrides.set(`${threadId}|${scopeId}`, epoch);
    },
    restartProcess() {
      claimed.clear();
      listeners.clear();
      volatileListeners.clear();
      crash.before = null;
      crash.after = null;
      crash.busy = 0;
      crash.busyFor = null;
      crash.dead = false;
    },
    get commitCalls() {
      return counters.calls;
    },
  };
}
