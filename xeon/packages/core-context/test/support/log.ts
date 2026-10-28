import { Bug, canonicalJson, err, ok, type Result } from "@xeon/contracts";
import type { EventId, IdFactory, StepId, ThreadId, TurnId } from "@xeon/contracts/conversation";
import {
  ownerOfKind,
  type CommitRequest,
  type CommitResult,
  type DetachedField,
  type DraftInput,
  type DurableEventDraft,
  type DurableEventEnvelope,
  type EventKind,
  type ProducerHandle,
  type ProducerId,
  type ReadFailure,
  type SessionService,
  type StampedDraft,
  type StoreError,
  type TxView,
} from "@xeon/contracts/records";
import { fixedIdFactory } from "@xeon/ext-host/testing";

/** 서비스가 쓰는 SessionService 부분형 */
export type BranchReader = Pick<SessionService, "readBranch" | "hydrate" | "commit" | "producer">;

/** 이 대역이 낙인한 초안. 브랜드 심볼은 선언뿐이라 실제 저장소처럼 WeakSet 등록으로 가드한다 */
const stampRegistry = new WeakSet<object>();

function isStamped(value: object): value is StampedDraft {
  return stampRegistry.has(value);
}

/** 컴팩션 커밋의 새 접두 system item은 core.context만 낸다(core-persistence `producers.ts`의 같은 예외, 9b0300b) */
function mayDraft(producer: ProducerId, kind: EventKind): boolean {
  if (ownerOfKind(kind) === producer) return true;
  return producer === "core.context" && kind === "item.recorded";
}

function stamp(producer: ProducerId, input: DraftInput): StampedDraft {
  if (!mayDraft(producer, input.kind)) {
    throw new Bug(`store.prefix_not_owned: ${producer} cannot draft ${input.kind}`);
  }
  const draft: DurableEventDraft = { ...input, version: input.version ?? 1, durable: true };
  const candidate = { draft, producer };
  stampRegistry.add(candidate);
  if (!isStamped(candidate)) throw new Bug("memoryLog: stamp registry lost a draft");
  return candidate;
}

/** 커밋 하나의 기록. 시험이 커밋 키와 초안 kind를 확인한다 */
interface CommitRecord {
  readonly requestId: string;
  readonly kinds: readonly EventKind[];
  readonly fingerprint: string;
}

/** 다음 커밋에 주입할 장애 */
type CommitFault =
  | { readonly kind: "store"; readonly error: StoreError }
  | { readonly kind: "reject"; readonly code: string };

interface AppendOptions {
  readonly id?: EventId;
  readonly turnId?: TurnId | null;
  readonly stepId?: StepId | null;
  /** 지정하면 이전 leaf가 아니라 이 이벤트 뒤에 붙는다(분기) */
  readonly parentId?: EventId | null;
  readonly detached?: readonly DetachedField[];
}

/** 메모리 이벤트 로그. 한 thread의 분기 트리를 흉내 낸다 */
export interface MemoryLog extends BranchReader {
  readonly ids: IdFactory;
  readonly threadId: ThreadId;
  readonly events: readonly DurableEventEnvelope[];
  /** 마지막으로 붙인 이벤트 */
  leaf(): EventId;
  append(kind: EventKind, payload: unknown, options?: AppendOptions): DurableEventEnvelope;
  /** readBranch 호출 수 */
  readonly reads: { count: number };
  /** hydrate에 넘어온 이벤트 id */
  readonly hydrated: EventId[];
  /** 값이 있으면 readBranch가 앞쪽 이벤트를 준 뒤 이 읽기 실패로 끝난다 */
  readonly readFault: { current: ReadFailure | undefined };
  /** 적용된 커밋(재생은 빼고) */
  readonly commits: CommitRecord[];
  /** 값이 있으면 다음 commit 한 번이 이 장애로 끝난다 */
  readonly commitFault: { current: CommitFault | undefined };
}

export function memoryLog(ids: IdFactory = fixedIdFactory()): MemoryLog {
  const threadId = ids.next("thr");
  const events: DurableEventEnvelope[] = [];
  const reads = { count: 0 };
  const hydrated: EventId[] = [];
  const readFault: { current: ReadFailure | undefined } = { current: undefined };
  const commits: CommitRecord[] = [];
  const commitFault: { current: CommitFault | undefined } = { current: undefined };
  const results = new Map<string, { fingerprint: string; result: CommitResult }>();

  function byId(id: EventId): DurableEventEnvelope | undefined {
    return events.find((event) => event.id === id);
  }

  function append(
    kind: EventKind,
    payload: unknown,
    options: AppendOptions = {},
  ): DurableEventEnvelope {
    const seq = events.length + 1;
    const parentId =
      options.parentId !== undefined ? options.parentId : (events.at(-1)?.id ?? null);
    const event: DurableEventEnvelope = {
      id: options.id ?? ids.next("evt"),
      kind,
      version: 1,
      threadId,
      turnId: options.turnId ?? null,
      stepId: options.stepId ?? null,
      recordedAt: 1_000 + seq,
      causationId: null,
      correlationId: null,
      payload,
      durable: true,
      seq,
      parentId,
      ...(options.detached === undefined ? {} : { detached: [...options.detached] }),
    };
    events.push(event);
    return event;
  }

  function viewOf(): TxView {
    return {
      threadId,
      headSeq: events.length,
      leaf: events.at(-1)?.id ?? null,
      threadStatus: events.length === 0 ? "absent" : "idle",
      turn: () => undefined,
      turnAbortRequested: () => false,
      effect: () => undefined,
      effectByToolCall: () => undefined,
      turnByRequestId: () => undefined,
      scopeLeaseEpoch: () => 0,
      inputByRequestId: () => undefined,
      queuedInputs: () => [],
      approval: () => undefined,
      agentByRequestId: () => undefined,
      scopeStateRev: () => 0,
      lastCheckpoint: () => null,
    };
  }

  const claimed = new Set<ProducerId>();

  return {
    ids,
    threadId,
    events,
    reads,
    hydrated,
    readFault,
    commits,
    commitFault,
    producer(id): ProducerHandle {
      if (claimed.has(id)) throw new Bug("store.producer_claimed");
      claimed.add(id);
      return { producer: id, draft: (input) => stamp(id, input) };
    },
    commit(request: CommitRequest): Result<CommitResult, StoreError> {
      const fingerprint = canonicalJson(request.fingerprintSource);
      const known = results.get(request.requestId);
      if (known !== undefined) {
        return known.fingerprint === fingerprint
          ? ok({ ...known.result, replayed: true })
          : ok({ status: "key_reused", requestId: request.requestId });
      }
      const fault = commitFault.current;
      commitFault.current = undefined;
      if (fault?.kind === "store") return err(fault.error);
      if (fault?.kind === "reject") {
        return ok({ status: "rejected", code: fault.code, detail: null, replayed: false });
      }
      const leafId = events.at(-1)?.id ?? null;
      if (request.expectedLeaf !== undefined && request.expectedLeaf !== leafId) {
        return ok({ status: "rejected", code: "leaf_conflict", detail: null, replayed: false });
      }
      const plan = request.build(viewOf());
      if (plan.kind === "abort") return err(plan.error);
      if (plan.kind === "reject") {
        return ok({ status: "rejected", code: plan.code, detail: plan.detail, replayed: false });
      }
      const appended = plan.drafts.map((stamped) =>
        append(stamped.draft.kind, stamped.draft.payload, {
          id: stamped.draft.id,
          stepId: stamped.draft.stepId,
          turnId: stamped.draft.turnId,
        }),
      );
      commits.push({
        requestId: request.requestId,
        kinds: appended.map((event) => event.kind),
        fingerprint,
      });
      const last = appended.at(-1);
      const result: CommitResult = {
        status: "committed",
        firstSeq: appended[0]?.seq ?? 0,
        lastSeq: last?.seq ?? 0,
        leaf: last?.id ?? leafId,
        eventIds: appended.map((event) => event.id),
        replayed: false,
      };
      results.set(request.requestId, { fingerprint, result });
      return ok(result);
    },
    leaf() {
      const last = events.at(-1);
      if (last === undefined) throw new Bug("test.empty_log");
      return last.id;
    },
    append,
    async *readBranch(_threadId, leaf) {
      reads.count += 1;
      const chain: DurableEventEnvelope[] = [];
      let cursor = leaf === undefined ? events.at(-1) : byId(leaf);
      while (cursor !== undefined) {
        chain.push(cursor);
        cursor = cursor.parentId === null ? undefined : byId(cursor.parentId);
      }
      for (const event of chain.toReversed()) yield ok(event);
      if (readFault.current !== undefined) yield err(readFault.current);
    },
    hydrate(event) {
      hydrated.push(event.id);
      return Promise.resolve(event);
    },
  };
}
