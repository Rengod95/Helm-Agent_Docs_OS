import { Bug, type Logger, type Result } from "@xeon/contracts";
import type { EventId, ThreadId } from "@xeon/contracts/conversation";
import type {
  DetachedField,
  DurableEventEnvelope,
  ReadFailure,
  SqlRow,
  StepCheckpoint,
  StoreDb,
  StoreService,
} from "@xeon/contracts/records";
import { readCheckpoint } from "./checkpoint.ts";
import { envelopeOfRow } from "./events.ts";
import { readResult } from "./rows.ts";
import { upcastStored, type KindCatalog } from "./upcast.ts";
import { readThread } from "./views.ts";

const PAGE = 500;

/** 읽기 실패는 스트림의 마지막 원소(err)로 알리고 스트림을 닫는다 */
type EventStream = AsyncIterable<Result<DurableEventEnvelope, ReadFailure>>;

export interface Reader {
  readFrom(
    afterSeq: number,
    options?: { readonly threadId?: ThreadId; readonly limit?: number },
  ): EventStream;
  readBranch(threadId: ThreadId, leaf?: EventId): EventStream;
  loadCheckpoint(threadId: ThreadId): Promise<Result<StepCheckpoint | null, ReadFailure>>;
  hydrate(event: DurableEventEnvelope): Promise<DurableEventEnvelope>;
}

export interface ReaderDeps {
  readonly db: StoreDb;
  readonly catalog: KindCatalog;
  readonly readBlob: StoreService["readBlob"] | undefined;
  readonly logger: Logger | undefined;
}

/** RFC 6901 포인터 토큰 해석 */
function pointerTokens(pointer: string): readonly string[] {
  if (pointer === "") return [];
  return pointer
    .slice(1)
    .split("/")
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
}

/** 포인터 위치의 값을 바꾼 새 값을 돌려준다(원본을 바꾸지 않는다). 위치가 없으면 원본 그대로다 */
function replaceAt(root: unknown, tokens: readonly string[], value: string): unknown {
  const [head, ...rest] = tokens;
  if (head === undefined) return value;
  if (Array.isArray(root)) {
    const items: readonly unknown[] = root;
    const index = Number(head);
    if (!Number.isInteger(index) || index < 0 || index >= items.length) return root;
    return items.map((item, position) =>
      position === index ? replaceAt(item, rest, value) : item,
    );
  }
  if (typeof root === "object" && root !== null && head in root) {
    const entries = Object.entries(root).map(([key, member]): [string, unknown] => [
      key,
      key === head ? replaceAt(member, rest, value) : member,
    ]);
    return Object.fromEntries(entries);
  }
  return root;
}

/** 동기 제너레이터를 AsyncIterable로 감싼다. 읽기는 모두 동기 SQLite 호출이라 기다릴 일이 없다 */
function fromSync<T>(source: Iterable<T>): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      const iterator = source[Symbol.iterator]();
      return { next: () => Promise.resolve(iterator.next()) };
    },
  };
}

/** 저장된 행 하나를 현재 버전의 envelope로 되돌린다 */
function decodeStored(
  catalog: KindCatalog,
  row: SqlRow,
): Result<DurableEventEnvelope, ReadFailure> {
  const envelope = envelopeOfRow(row);
  return envelope.ok ? upcastStored(catalog, envelope.value) : envelope;
}

export function createReader(deps: ReaderDeps): Reader {
  const { db, catalog } = deps;

  const page = (
    afterSeq: number,
    threadId: ThreadId | undefined,
    limit: number,
  ): Result<readonly SqlRow[], ReadFailure> =>
    db.read((tx) =>
      threadId === undefined
        ? tx.all("SELECT envelope FROM events WHERE seq > ? ORDER BY seq LIMIT ?", [
            afterSeq,
            limit,
          ])
        : tx.all(
            "SELECT envelope FROM events WHERE thread_id = ? AND seq > ? ORDER BY seq LIMIT ?",
            [threadId, afterSeq, limit],
          ),
    );

  function* readFromSync(
    afterSeq: number,
    options: { readonly threadId?: ThreadId; readonly limit?: number } | undefined,
  ): Generator<Result<DurableEventEnvelope, ReadFailure>> {
    let cursor = afterSeq;
    let remaining = options?.limit ?? Number.POSITIVE_INFINITY;
    while (remaining > 0) {
      const rows = page(cursor, options?.threadId, Math.min(PAGE, remaining));
      if (!rows.ok) {
        yield rows;
        return;
      }
      if (rows.value.length === 0) return;
      for (const row of rows.value) {
        const event = decodeStored(catalog, row);
        yield event;
        if (!event.ok) return;
        cursor = event.value.seq;
        remaining -= 1;
      }
    }
  }

  function* readBranchSync(
    threadId: ThreadId,
    leaf: EventId | undefined,
  ): Generator<Result<DurableEventEnvelope, ReadFailure>> {
    // 루트→leaf 순서. leaf에서 parent_id를 따라 올라간 사슬(활성 가지, F.records.spec §4.6)
    let start = leaf;
    if (start === undefined) {
      const thread = readResult(db, (tx) => readThread(tx, threadId));
      if (!thread.ok) {
        yield thread;
        return;
      }
      start = thread.value?.leafEventId ?? undefined;
    }
    if (start === undefined) return;
    const rows = db.read((tx) =>
      tx.all(
        `WITH RECURSIVE chain(id, depth) AS (
           SELECT id, 0 FROM events WHERE id = ? AND thread_id = ?
           UNION ALL
           SELECT e.parent_id, c.depth + 1 FROM chain c JOIN events e ON e.id = c.id
           WHERE e.parent_id IS NOT NULL
         )
         SELECT e.envelope FROM chain c JOIN events e ON e.id = c.id ORDER BY c.depth DESC`,
        [start, threadId],
      ),
    );
    if (!rows.ok) {
      yield rows;
      return;
    }
    for (const row of rows.value) {
      const event = decodeStored(catalog, row);
      yield event;
      if (!event.ok) return;
    }
  }

  return {
    readFrom: (afterSeq, options) => fromSync(readFromSync(afterSeq, options)),
    readBranch: (threadId, leaf) => fromSync(readBranchSync(threadId, leaf)),
    loadCheckpoint(threadId): Promise<Result<StepCheckpoint | null, ReadFailure>> {
      return Promise.resolve(readResult(db, (tx) => readCheckpoint(tx, threadId)));
    },
    hydrate(event): Promise<DurableEventEnvelope> {
      const detached: readonly DetachedField[] = event.detached ?? [];
      if (detached.length === 0) return Promise.resolve(event);
      const { readBlob, logger } = deps;
      if (readBlob === undefined) {
        return Promise.reject(new Bug("store.blob_unavailable: hydrate needs readBlob"));
      }
      let payload: unknown = event.payload;
      for (const field of detached) {
        const blob = readBlob(field.ref);
        if (!blob.ok) {
          // blob 파일이 없으면 자리표시를 남긴다. 처리 정책은 L0.store.spec이 정한다(F.records.spec §5)
          logger?.warn("session.hydrate_missing_blob", {
            pointer: field.pointer,
            sha256: field.ref.sha256,
            reason: blob.error.kind,
          });
          continue;
        }
        payload = replaceAt(
          payload,
          pointerTokens(field.pointer),
          new TextDecoder().decode(blob.value),
        );
      }
      return Promise.resolve({ ...event, payload });
    },
  };
}
