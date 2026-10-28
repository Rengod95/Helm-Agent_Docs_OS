import { assertNever, Bug, detach, err, ok, parse, rethrow, type Result } from "@xeon/contracts";
import {
  EventIdSchema,
  type EventId,
  type IdFactory,
  type ThreadId,
} from "@xeon/contracts/conversation";
import {
  RecordKindSchema,
  type EnqueueRequest,
  type EnqueueError,
  type EnqueueResult,
} from "@xeon/contracts/extensions";
import {
  InputPlacedPayloadSchema,
  InputQueuedPayloadSchema,
  type CommitRequest,
  type DurableEventEnvelope,
  type SessionService,
  type StoreError,
} from "@xeon/contracts/records";
import type {
  AbortReason,
  AbortTicket,
  EnqueueReceipt,
  InputDraft,
  InputMode,
  InputQueue,
  InputQueueError,
  Limiter,
  PlacementSelection,
  PoolName,
  QueuedInput,
  ScopeOutcome,
  Slot,
  TaskScope,
  TaskScopeKind,
  TaskScopeSpec,
  TaskService,
} from "@xeon/contracts/services";

// 테스트 대역: core-tasks의 범위 트리·취소·내구 입력 큐 중 루프가 쓰는 부분만 흉내 낸다.

interface FakeScope extends TaskScope {
  readonly spec: TaskScopeSpec | null;
  readonly kids: FakeScope[];
  readonly controller: AbortController;
  readonly tracked: Set<Promise<unknown>>;
  settledState: TaskScope["state"];
}

function sourceKeyOf(draft: InputDraft): string {
  switch (draft.source.type) {
    case "user":
      return "user";
    case "extension":
      return draft.source.scopeId.replaceAll("/", ":");
    case "delegation":
      return "deleg";
    case "schedule":
      return "timer";
    default:
      return assertNever(draft.source, "InputDraft.source");
  }
}

function isAbortReason(value: unknown): value is AbortReason {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string" &&
    "message" in value
  );
}

export interface FakeTasksOptions {
  readonly session: SessionService;
  readonly ids: IdFactory;
  /** modelCalls 풀 상한. 기본은 무제한 */
  readonly modelCallsCapacity?: number;
  /** 재시작을 흉내 낼 때 큐 상태를 되살릴 이벤트 */
  readonly history?: readonly DurableEventEnvelope[];
}

export interface FakeTasks {
  readonly service: TaskService;
  /** 지금까지 연 범위 노드 */
  readonly opened: readonly { readonly kind: TaskScopeKind; readonly id: string }[];
  /** 풀 슬롯 획득 수 */
  slotAcquisitions(pool: PoolName): number;
}

type QueueRow = QueuedInput & { state: "queued" | "placed" | "withdrawn" };

export function createFakeTasks(options: FakeTasksOptions): FakeTasks {
  const { session, ids } = options;
  const producer = session.producer("core.tasks");
  const queued = new Map<EventId, QueueRow>();
  const queuedListeners = new Set<(threadId: ThreadId) => void>();
  const opened: { kind: TaskScopeKind; id: string }[] = [];
  const live = new Map<string, FakeScope>();
  const byScope = new WeakMap<object, FakeScope>();
  const acquisitions = new Map<PoolName, number>();

  function fakeOf(scope: TaskScope): FakeScope {
    const found = byScope.get(scope);
    if (found === undefined) throw new Bug("fake-tasks: unknown scope");
    return found;
  }

  function applyEvent(event: DurableEventEnvelope, notify: boolean): void {
    if (event.kind === "input.queued") {
      const payload = parse(InputQueuedPayloadSchema, event.payload);
      if (!payload.ok) return;
      const recorded = payload.value.item;
      const customType =
        recorded.kind === "context" ? parse(RecordKindSchema, recorded.customType) : null;
      if (customType !== null && !customType.ok) return;
      queued.set(event.id, {
        threadId: event.threadId,
        mode: payload.value.mode,
        item:
          recorded.kind === "user" || customType === null
            ? { kind: "user", content: recorded.content }
            : {
                kind: "context",
                customType: customType.value,
                content: recorded.content,
                display: recorded.display,
                details: recorded.details,
              },
        requestId: payload.value.requestId,
        source: payload.value.source,
        inputId: event.id,
        seq: event.seq,
        state: "queued",
      });
      if (notify) for (const listener of queuedListeners) listener(event.threadId);
    } else if (event.kind === "input.placed" || event.kind === "input.withdrawn") {
      const payload = parse(InputPlacedPayloadSchema, event.payload);
      const known = payload.ok ? queued.get(payload.value.inputId) : undefined;
      if (known !== undefined) {
        known.state = event.kind === "input.placed" ? "placed" : "withdrawn";
      }
    }
  }

  // 피드로 큐 상태를 따라간다: 커밋된 사실만 본다
  for (const event of options.history ?? []) applyEvent(event, false);
  session.feed.onCommit((batch) => {
    for (const event of batch.events) applyEvent(event, true);
  });

  function newScope(
    parent: FakeScope | null,
    spec: TaskScopeSpec | null,
    kind: TaskScopeKind,
    id: string,
  ): FakeScope {
    const controller = new AbortController();
    const signal =
      parent === null ? controller.signal : AbortSignal.any([parent.signal, controller.signal]);
    const children: FakeScope[] = [];
    const tracked = new Set<Promise<unknown>>();
    const memo: { settle: Promise<ScopeOutcome> | null } = { settle: null };
    const scope: FakeScope = {
      kind,
      id,
      parent,
      background: false,
      signal,
      get state() {
        return scope.settledState;
      },
      get abortReason() {
        const reason: unknown = signal.reason;
        return signal.aborted && isAbortReason(reason) ? reason : null;
      },
      children: () => children,
      track<T>(work: Promise<T>): Promise<T> {
        // 실제 core-tasks와 같다: 정착한 노드에는 작업을 더하지 못한다(N-03)
        if (scope.settledState === "settled") {
          throw new Bug(`tasks.scope_settled: ${kind} ${id} is settled`);
        }
        const finished = work.then(
          () => undefined,
          () => undefined,
        );
        tracked.add(finished);
        // finished는 거부하지 않는다. 정리 중 예기치 않은 오류는 그대로 다시 던져 시험이 실패하게 한다
        detach(
          finished.then(() => tracked.delete(finished)),
          rethrow,
        );
        return work;
      },
      settle() {
        const drain = async (): Promise<void> => {
          if (tracked.size === 0 && children.every((child) => child.settledState === "settled"))
            return;
          await Promise.allSettled([...tracked, ...children.map((child) => child.settle())]);
          await drain();
        };
        memo.settle ??= drain().then((): ScopeOutcome => {
          scope.settledState = "settled";
          live.delete(`${kind}:${id}`);
          return { aborted: signal.aborted, reason: scope.abortReason };
        });
        return memo.settle;
      },
      spec,
      kids: children,
      controller,
      tracked,
      settledState: "live",
    };
    byScope.set(scope, scope);
    if (parent !== null) parent.kids.push(scope);
    return scope;
  }

  const root = newScope(null, null, "app", "app");

  function limiterOf(pool: PoolName): Limiter {
    const capacity =
      pool === "modelCalls"
        ? (options.modelCallsCapacity ?? Number.POSITIVE_INFINITY)
        : Number.POSITIVE_INFINITY;
    const counts = { inUse: 0 };
    const waiting: (() => void)[] = [];
    const take = async (): Promise<void> => {
      if (counts.inUse < capacity) {
        counts.inUse += 1;
        return;
      }
      await new Promise<void>((resolve) => waiting.push(resolve));
      await take();
    };
    return {
      pool,
      capacity: () => capacity,
      inUse: () => counts.inUse,
      waiting: () => waiting.length,
      async acquire(owner): Promise<Slot> {
        acquisitions.set(pool, (acquisitions.get(pool) ?? 0) + 1);
        await take();
        const flags = { released: false };
        return {
          pool,
          owner,
          release() {
            if (flags.released) return;
            flags.released = true;
            counts.inUse -= 1;
            waiting.shift()?.();
          },
          suspendWhile: (wait) => wait,
        };
      },
    };
  }
  const limiters = new Map<PoolName, Limiter>();

  function selectionOf(
    threadId: ThreadId,
    at: "turnStart" | "stepEnd",
    continuing: boolean,
  ): PlacementSelection {
    const waiting = [...queued.values()]
      .filter((input) => input.threadId === threadId && input.state === "queued")
      .toSorted((a, b) => a.seq - b.seq);
    let picked: QueuedInput[] = [];
    if (at === "turnStart") {
      const first = waiting.find((input) => input.mode === "steer" || input.mode === "followUp");
      picked = first === undefined ? [] : [first];
    } else {
      picked = waiting.filter((input) => input.mode === "steer");
      if (continuing || picked.length > 0) {
        picked = [
          ...picked,
          ...waiting.filter((input) => input.mode === "next" || input.mode === "aside"),
        ].toSorted((a, b) => a.seq - b.seq);
      }
    }
    const consumedSeq = picked.reduce((max, input) => Math.max(max, input.seq), 0);
    return {
      inputs: picked,
      consumedSeq,
      drafts: (placements) =>
        placements.map((placement) =>
          producer.draft({
            id: ids.next("evt"),
            kind: "input.placed",
            threadId,
            turnId: placement.turnId,
            stepId: null,
            causationId: placement.inputId,
            correlationId: placement.turnId,
            payload: { inputId: placement.inputId, itemId: placement.itemId },
          }),
        ),
    };
  }

  const inputs: InputQueue = {
    async enqueue(draft): Promise<Result<EnqueueReceipt, InputQueueError>> {
      await Promise.resolve();
      if (draft.requestId.length < 1 || draft.requestId.length > 64) {
        return err({ kind: "invalid_request_id", requestId: draft.requestId });
      }
      if (draft.mode === "next" || draft.mode === "aside") {
        return err({ kind: "mode_not_supported", mode: draft.mode });
      }
      const sourceKey = sourceKeyOf(draft);
      const request: CommitRequest = {
        threadId: draft.threadId,
        requestId: `in:${sourceKey}:${draft.requestId}`,
        fingerprintSource: { threadId: draft.threadId, sourceKey, requestId: draft.requestId },
        build: (view) => {
          const existing = view.inputByRequestId(draft.threadId, sourceKey, draft.requestId);
          if (existing !== undefined) {
            return { kind: "reject", code: "duplicate_input", detail: existing.inputId };
          }
          return {
            kind: "append",
            drafts: [
              producer.draft({
                id: ids.next("evt"),
                kind: "input.queued",
                threadId: draft.threadId,
                turnId: null,
                stepId: null,
                causationId: null,
                correlationId: null,
                payload: {
                  mode: draft.mode,
                  item:
                    draft.item.kind === "user"
                      ? { kind: "user", content: draft.item.content }
                      : {
                          kind: "context",
                          customType: draft.item.customType,
                          content: draft.item.content,
                          display: draft.item.display,
                          details: draft.item.details ?? null,
                        },
                  requestId: draft.requestId,
                  source: draft.source,
                },
              }),
            ],
            checkpoint: null,
          };
        },
      };
      const result = session.commit(request);
      if (!result.ok) return err(result.error satisfies StoreError);
      const value = result.value;
      if (value.status === "committed") {
        const inputId = value.eventIds[0];
        if (inputId === undefined) throw new Bug("fake-tasks: no input event");
        return ok({
          requestId: draft.requestId,
          duplicate: value.replayed,
          inputId,
          state: "queued",
        });
      }
      if (value.status === "rejected") {
        const known = [...queued.values()].find(
          (input) => input.threadId === draft.threadId && input.requestId === draft.requestId,
        );
        const detail = parse(EventIdSchema, value.detail);
        const inputId = known?.inputId ?? (detail.ok ? detail.value : undefined);
        if (inputId === undefined) throw new Bug("fake-tasks: duplicate input without an id");
        return ok({
          requestId: draft.requestId,
          duplicate: true,
          inputId,
          state: known?.state ?? "queued",
        });
      }
      return err({ kind: "busy" });
    },
    draftQueued: () => {
      throw new Bug("fake-tasks: draftQueued is not implemented");
    },
    peek: (threadId, modes) =>
      ok(
        [...queued.values()]
          .filter(
            (input) =>
              input.threadId === threadId &&
              input.state === "queued" &&
              (modes === undefined || modes.includes(input.mode)),
          )
          .toSorted((a, b) => a.seq - b.seq),
      ),
    drain: (_view, threadId, at, drainOptions) =>
      ok(selectionOf(threadId, at, drainOptions.continuing)),
    withdraw: () => Promise.resolve(ok(0)),
    onQueued(listener) {
      queuedListeners.add(listener);
      return () => {
        queuedListeners.delete(listener);
      };
    },
  };

  const service: TaskService = {
    root,
    openScope(parent, spec) {
      const scope = newScope(fakeOf(parent), spec, spec.kind, spec.id);
      opened.push({ kind: spec.kind, id: spec.id });
      live.set(`${spec.kind}:${spec.id}`, scope);
      return scope;
    },
    find: (kind, id) => live.get(`${kind}:${id}`),
    async abort(target, reason): Promise<Result<AbortTicket, StoreError>> {
      const scope = fakeOf(target);
      if (scope.settledState === "settled") return ok({ status: "already_settled" });
      if (scope.signal.aborted) return ok({ status: "already_aborting", settled: scope.settle() });
      const intent = scope.spec?.abortIntent?.(reason, "direct") ?? null;
      if (intent !== null) {
        const committed = session.commit(intent);
        if (!committed.ok) return err(committed.error);
      }
      await Promise.resolve();
      scope.settledState = "aborting";
      scope.controller.abort(reason);
      return ok({ status: "signalled", settled: scope.settle() });
    },
    limiter(pool) {
      const known = limiters.get(pool);
      if (known !== undefined) return known;
      const created = limiterOf(pool);
      limiters.set(pool, created);
      return created;
    },
    locks: {
      run: (_locks, _owner, fn) => fn(),
      pending: () => 0,
    },
    inputs,
    activity: () => ({ liveTurns: 0, liveTasks: 0, queuedInputs: 0 }),
    onActivity: () => () => {},
    close: () => Promise.resolve(),
    async enqueue(request: EnqueueRequest): Promise<Result<EnqueueResult, EnqueueError>> {
      const mode: InputMode = request.when === "next" ? "followUp" : request.when;
      const result = await inputs.enqueue({
        threadId: request.threadId,
        mode,
        item: request.item,
        requestId: request.requestId,
        source: { type: "extension", scopeId: request.scopeId },
      });
      return result.ok ? ok({ duplicate: result.value.duplicate }) : err(result.error);
    },
  };

  return {
    service,
    opened,
    slotAcquisitions: (pool) => acquisitions.get(pool) ?? 0,
  };
}
