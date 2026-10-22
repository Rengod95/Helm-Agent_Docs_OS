// 메모리 세션 대역. core-persistence(SessionService.commit)가 아직 없어 core-tasks의 시험이 쓴다.
// L0·L1을 import하지 않고 F 인터페이스로만 만든다(review.decisions-2 D-05). 저장소 흉내라서 TS-07의 "실제 SQLite"를
// 대신하지 못한다. 커밋 키 멱등, 지문 비교, 롤백, 커밋 후 알림, p_inputs 투영만 같은 규칙으로 흉내 낸다.
import { Bug, canonicalJson, err, ok, parse, type Result } from "@xeon/contracts";
import type { EventId, IdFactory, ThreadId, ThreadStatus } from "@xeon/contracts/conversation";
import {
  COMMIT_KEY_PATTERN,
  EVENT_CATALOG,
  InputPlacedPayloadSchema,
  InputQueuedPayloadSchema,
  InputWithdrawnPayloadSchema,
  ownerOfKind,
  type CommitListener,
  type CommitPlan,
  type CommitRequest,
  type CommitResult,
  type DraftInput,
  type DurableEventDraft,
  type DurableEventEnvelope,
  type FaultInjector,
  type FaultPoint,
  type FeedFilter,
  type InputView,
  type ProducerHandle,
  type ProducerId,
  type StampedDraft,
  type StepCheckpoint,
  type StoreError,
  type ThreadSummaryRow,
  type TxView,
} from "@xeon/contracts/records";
import type { TasksSession } from "../session-port.ts";
import { sourceKeyOf } from "../source-key.ts";

const COMMIT_KEY_REGEX = new RegExp(COMMIT_KEY_PATTERN);
/** 2026-01-05T00:00:00Z. 이벤트마다 1ms씩 늘린다 */
const START_AT = 1_767_571_200_000;

interface InputRow {
  readonly threadId: ThreadId;
  readonly inputId: EventId;
  readonly seq: number;
  readonly mode: InputView["mode"];
  state: InputView["state"];
  readonly sourceKey: string;
  readonly requestId: string;
}

interface ThreadRow {
  status: ThreadStatus;
  leaf: EventId | null;
  readonly createdAt: number;
}

interface StoredRequest {
  readonly fingerprint: string;
  readonly result: CommitResult;
}

export interface MemorySessionOptions {
  readonly ids: IdFactory;
  /** 쓰기 경로가 지점마다 hit(point)를 부른다. 예외를 던지면 그 커밋은 롤백된다 */
  readonly faults?: FaultInjector;
}

export interface MemorySession extends TasksSession {
  /** 플러그인 setup에서 한 번 받는 생산자. kind 소유와 payload 스키마를 카탈로그로 검사한다 */
  producer(id: ProducerId): ProducerHandle;
  /** 커밋된 내구 이벤트(커밋 순서) */
  readonly events: readonly DurableEventEnvelope[];
  /** commit 호출 수(재생과 실패 포함) */
  readonly commitCalls: number;
  /** thread를 만든다. 없는 thread에 쓰면 threadStatus가 "absent"다 */
  openThread(threadId: ThreadId, status?: ThreadStatus): void;
  setThreadStatus(threadId: ThreadId, status: ThreadStatus): void;
  /** 마지막 step 체크포인트의 소비 위치를 정한다(lastCheckpoint가 이 값으로 답한다) */
  setConsumedSeq(threadId: ThreadId, consumedSeq: number): void;
  /** 다음 commit n번을 StoreError로 실패시킨다 */
  failNext(error: StoreError, times?: number): void;
  /** 커밋 후 알림에서 리스너가 던진 값 */
  readonly listenerErrors: readonly unknown[];
}

function stamp(draft: DurableEventDraft, producer: ProducerId): StampedDraft {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- StampedDraft의 브랜드는 선언만 있는 unique symbol이라 대역이 만들 방법이 이것뿐이다 (ext-host 대역과 같다)
  return { draft, producer } as StampedDraft;
}

function matchesFilter(event: DurableEventEnvelope, filter: FeedFilter | undefined): boolean {
  if (filter === undefined) return true;
  if (filter.threadIds !== undefined && !filter.threadIds.includes(event.threadId)) return false;
  if (
    filter.kindPrefixes !== undefined &&
    !filter.kindPrefixes.some((prefix) => event.kind.startsWith(prefix))
  ) {
    return false;
  }
  return !(filter.excludeKindPrefixes ?? []).some((prefix) => event.kind.startsWith(prefix));
}

export function memorySession(options: MemorySessionOptions): MemorySession {
  const { ids, faults } = options;
  const events: DurableEventEnvelope[] = [];
  const requests = new Map<string, StoredRequest>();
  const threads = new Map<ThreadId, ThreadRow>();
  const inputs = new Map<EventId, InputRow>();
  const consumed = new Map<ThreadId, number>();
  const listeners = new Set<CommitListener>();
  const failures: StoreError[] = [];
  const listenerErrors: unknown[] = [];
  let headSeq = 0;
  let calls = 0;

  function hit(point: FaultPoint): void {
    faults?.hit(point);
  }

  function queuedViews(threadId: ThreadId): readonly InputView[] {
    return [...inputs.values()]
      .filter((row) => row.threadId === threadId && row.state === "queued")
      .toSorted((a, b) => a.seq - b.seq)
      .map(viewOf);
  }

  function viewOf(row: InputRow): InputView {
    return {
      inputId: row.inputId,
      seq: row.seq,
      mode: row.mode,
      state: row.state,
      sourceKey: row.sourceKey,
      requestId: row.requestId,
    };
  }

  function checkpointOf(threadId: ThreadId): StepCheckpoint | null {
    const consumedSeq = consumed.get(threadId);
    if (consumedSeq === undefined) return null;
    return {
      checkpointId: ids.next("ckp"),
      schemaVersion: 1,
      threadId,
      turnId: ids.next("trn"),
      stepId: ids.next("stp"),
      stepIndex: 0,
      leafEventId: ids.next("evt"),
      next: "request",
      pendingToolCalls: [],
      inputCursor: { consumedSeq },
      model: { provider: "test", modelId: "test", thinkingLevel: "off" },
      leaseRefs: [],
      scopeRef: null,
    };
  }

  function viewFor(threadId: ThreadId): TxView {
    return {
      threadId,
      headSeq,
      leaf: threads.get(threadId)?.leaf ?? null,
      threadStatus: threads.get(threadId)?.status ?? "absent",
      turn: () => undefined,
      turnAbortRequested: () => false,
      effect: () => undefined,
      effectByToolCall: () => undefined,
      turnByRequestId: () => undefined,
      scopeLeaseEpoch: () => 0,
      inputByRequestId(target, sourceKey, requestId) {
        const row = [...inputs.values()].find(
          (candidate) =>
            candidate.threadId === target &&
            candidate.sourceKey === sourceKey &&
            candidate.requestId === requestId,
        );
        return row === undefined ? undefined : viewOf(row);
      },
      queuedInputs: queuedViews,
      approval: () => undefined,
      agentByRequestId: () => undefined,
      scopeStateRev: () => 0,
      lastCheckpoint: checkpointOf,
    };
  }

  /** 커밋이 확정된 뒤에만 부른다. input.* 이벤트를 p_inputs 행으로 투영한다 */
  function project(event: DurableEventEnvelope): void {
    if (event.kind === "input.queued") {
      const payload = parse(InputQueuedPayloadSchema, event.payload);
      if (!payload.ok) throw new Bug("store.projection_failed: input.queued payload");
      inputs.set(event.id, {
        threadId: event.threadId,
        inputId: event.id,
        seq: event.seq,
        mode: payload.value.mode,
        state: "queued",
        sourceKey: sourceKeyOf(payload.value.source),
        requestId: payload.value.requestId,
      });
    } else if (event.kind === "input.placed") {
      const payload = parse(InputPlacedPayloadSchema, event.payload);
      const row = payload.ok ? inputs.get(payload.value.inputId) : undefined;
      if (row !== undefined) row.state = "placed";
    } else if (event.kind === "input.withdrawn") {
      const payload = parse(InputWithdrawnPayloadSchema, event.payload);
      const row = payload.ok ? inputs.get(payload.value.inputId) : undefined;
      if (row !== undefined) row.state = "withdrawn";
    }
  }

  function applyPlan(
    request: CommitRequest,
    plan: Extract<CommitPlan, { kind: "append" }>,
  ): { readonly result: CommitResult; readonly batch: readonly DurableEventEnvelope[] } {
    if (plan.checkpoint !== null) throw new Bug("memory session does not store checkpoints");
    const staged: DurableEventEnvelope[] = [];
    let leaf = threads.get(request.threadId)?.leaf ?? null;
    plan.drafts.forEach((stamped, index) => {
      const seq = headSeq + staged.length + 1;
      const envelope: DurableEventEnvelope = {
        ...stamped.draft,
        seq,
        recordedAt: START_AT + seq,
        parentId: leaf,
      };
      leaf = envelope.id;
      staged.push(envelope);
      hit(`after_event_insert:${index}`);
      hit(`after_projection:${index}`);
      hit(`after_ext_projection:${index}`);
    });
    const result: CommitResult = {
      status: "committed",
      firstSeq: headSeq + 1,
      lastSeq: headSeq + staged.length,
      leaf,
      eventIds: staged.map((event) => event.id),
      replayed: false,
    };
    hit("before_request_insert");
    hit("before_commit");
    // 여기부터는 던지지 않는다(커밋 확정)
    for (const event of staged) {
      events.push(event);
      project(event);
    }
    headSeq += staged.length;
    const row = threads.get(request.threadId);
    if (row !== undefined) row.leaf = leaf;
    return { result, batch: staged };
  }

  function commit(request: CommitRequest): Result<CommitResult, StoreError> {
    calls += 1;
    const injected = failures.shift();
    if (injected !== undefined) return err(injected);
    if (!COMMIT_KEY_REGEX.test(request.requestId)) {
      throw new Bug(`store.invalid_commit_key: ${request.requestId}`);
    }
    hit("after_begin");
    hit("after_lease_check");
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
    hit("after_request_check");
    const plan = request.build(viewFor(request.threadId));
    if (plan.kind === "reject") {
      const rejected: CommitResult = {
        status: "rejected",
        code: plan.code,
        detail: plan.detail,
        replayed: false,
      };
      requests.set(key, { fingerprint, result: rejected });
      return ok(rejected);
    }
    const { result, batch } = applyPlan(request, plan);
    requests.set(key, { fingerprint, result });
    hit("after_commit");
    const first = batch[0];
    const last = batch.at(-1);
    if (first !== undefined && last !== undefined) {
      for (const listener of listeners) {
        try {
          listener({ firstSeq: first.seq, lastSeq: last.seq, events: batch });
        } catch (cause) {
          listenerErrors.push(cause);
        }
      }
    }
    return ok(result);
  }

  return {
    commit,
    events,
    get commitCalls() {
      return calls;
    },
    listenerErrors,
    producer(id) {
      return {
        producer: id,
        draft(input: DraftInput): StampedDraft {
          if (ownerOfKind(input.kind) !== id) {
            throw new Bug(`store.prefix_not_owned: ${input.kind} is not owned by ${id}`);
          }
          const entry = EVENT_CATALOG.find((candidate) => candidate.kind === input.kind);
          if (entry === undefined) throw new Bug(`store.kind_unregistered: ${input.kind}`);
          if (entry.retired === true) throw new Bug(`store.kind_retired: ${input.kind}`);
          const verdict = parse(entry.payload, input.payload);
          if (!verdict.ok) {
            throw new Bug(`store.schema_invalid: ${input.kind}`, { cause: verdict.error });
          }
          const { version, ...rest } = input;
          return stamp({ ...rest, version: version ?? entry.version, durable: true }, id);
        },
      };
    },
    openThread(threadId, status = "idle") {
      threads.set(threadId, { status, leaf: null, createdAt: START_AT });
    },
    setThreadStatus(threadId, status) {
      const row = threads.get(threadId);
      if (row === undefined) throw new Bug(`memory session: thread ${threadId} is not open`);
      row.status = status;
    },
    setConsumedSeq(threadId, consumedSeq) {
      consumed.set(threadId, consumedSeq);
    },
    failNext(error, times = 1) {
      for (let count = 0; count < times; count += 1) failures.push(error);
    },
    query: { queuedInputs: queuedViews },
    feed: {
      headSeq: () => headSeq,
      read(after, upto, filter, limit, scanLimit) {
        const out: DurableEventEnvelope[] = [];
        const end = Math.min(upto, headSeq, after + scanLimit);
        let scannedTo = after;
        for (const event of events) {
          if (event.seq <= after) continue;
          if (event.seq > end) break;
          scannedTo = event.seq;
          if (matchesFilter(event, filter)) out.push(event);
          if (out.length >= limit) return { events: out, scannedTo };
        }
        return { events: out, scannedTo: Math.max(scannedTo, end) };
      },
      onCommit(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    threads: {
      list(query) {
        const open = [...threads.entries()].filter(
          ([, row]) => query.includeClosed === true || row.status !== "closed",
        );
        const start = query.cursor === undefined ? 0 : Number(query.cursor);
        const limit = query.limit ?? 50;
        const page = open.slice(start, start + limit);
        const rows: ThreadSummaryRow[] = page.map(([threadId, row]) => ({
          threadId,
          title: null,
          status: row.status,
          workspace: null,
          createdAt: row.createdAt,
          updatedAt: row.createdAt,
          headSeq,
          forkedFrom: null,
          marker: null,
          queuedInputs: queuedViews(threadId).length,
          pendingApprovals: 0,
        }));
        return {
          threads: rows,
          nextCursor: start + limit < open.length ? String(start + limit) : null,
        };
      },
    },
  };
}
