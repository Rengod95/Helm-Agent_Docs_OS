import { Bug } from "@xeon/contracts";
import type { EventId, IdFactory, ThreadId } from "@xeon/contracts/conversation";
import type {
  DetachedField,
  DurableEventEnvelope,
  EventKind,
  SessionService,
} from "@xeon/contracts/records";
import { fixedIdFactory } from "@xeon/ext-host/testing";

/** assemble이 쓰는 SessionService 부분형 */
export type BranchReader = Pick<SessionService, "readBranch" | "hydrate">;

interface AppendOptions {
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
}

export function memoryLog(ids: IdFactory = fixedIdFactory()): MemoryLog {
  const threadId = ids.next("thr");
  const events: DurableEventEnvelope[] = [];
  const reads = { count: 0 };
  const hydrated: EventId[] = [];

  function byId(id: EventId): DurableEventEnvelope | undefined {
    return events.find((event) => event.id === id);
  }

  return {
    ids,
    threadId,
    events,
    reads,
    hydrated,
    leaf() {
      const last = events.at(-1);
      if (last === undefined) throw new Bug("test.empty_log");
      return last.id;
    },
    append(kind, payload, options = {}) {
      const seq = events.length + 1;
      const parentId =
        options.parentId !== undefined ? options.parentId : (events.at(-1)?.id ?? null);
      const event: DurableEventEnvelope = {
        id: ids.next("evt"),
        kind,
        version: 1,
        threadId,
        turnId: null,
        stepId: null,
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
    },
    async *readBranch(_threadId, leaf) {
      reads.count += 1;
      const chain: DurableEventEnvelope[] = [];
      let cursor = leaf === undefined ? events.at(-1) : byId(leaf);
      while (cursor !== undefined) {
        chain.push(cursor);
        cursor = cursor.parentId === null ? undefined : byId(cursor.parentId);
      }
      for (const event of chain.toReversed()) yield event;
    },
    hydrate(event) {
      hydrated.push(event.id);
      return Promise.resolve(event);
    },
  };
}
