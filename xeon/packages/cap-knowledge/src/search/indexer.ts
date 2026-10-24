import { attemptAsync, eachAsync, err, ok, parse, type Logger, type Result } from "@xeon/contracts";
import {
  ItemRecordedPayloadSchema,
  type CommitBatch,
  type DurableEventEnvelope,
  type StoreDb,
} from "@xeon/contracts/records";
import { failure, fromStoreError, type KnowledgeFailure } from "../errors.ts";
import type { KnowledgeSessionPort } from "../ports/session.ts";

// L2.knowledge.spec §4.8.1 색인 소비자 `cap.knowledge.fts`. 세션의 내구 이벤트 가운데 사용자·어시스턴트 메시지(`item.recorded`)의 텍스트를
// NFC로 바꿔 `cap_knowledge_sessiondocs`와 `cap_knowledge_sessionfts`에 넣는다. 도구 결과, 사고(thinking), 도구 호출, 이미지는 넣지 않는다.
//
// - 처리 단위는 배치(최대 500 이벤트)다. 배치마다 텍스트를 뽑는 일(detached 필드 복원 포함)은 트랜잭션 밖에서 하고, 행과 커서를
//   `StoreDb.write` 하나에 넣는다(TX-01). 커서는 투영 표(`cap_knowledge_sessioncursor`)라 투영을 다시 만들면 0이 되고 색인도 처음부터 쌓인다.
// - 중복 방지: 커서보다 작거나 같은 `seq`는 건너뛰고 `event_id`가 이미 있으면 넣지 않는다. 같은 배치를 두 번 받아도 행이 늘지 않는다.
// - session-core의 투영(`p_*`)을 읽지 않는다. 필요한 값은 이벤트에서 받아 자기 표에 둔다(CM-02).
// - `seq`는 세션 안 메시지 번호(1부터)다. 이벤트 `seq`(전역)와 다르고 같은 이벤트 순서면 다시 만들어도 같다.

const CONSUMER = "fts";
const BATCH_EVENTS = 500;

export interface IndexerDeps {
  readonly session: KnowledgeSessionPort;
  readonly db: StoreDb;
  readonly logger: Logger;
}

export interface Indexer {
  stop(): void;
  /** 지금까지 받은 배치의 처리가 끝나기를 기다린다(시험과 종료 정리용) */
  settled(): Promise<void>;
}

interface MessageRow {
  readonly eventId: string;
  readonly threadId: string;
  readonly eventSeq: number;
  readonly role: "user" | "assistant";
  readonly recordedAt: number;
  readonly text: string;
}

/** 사용자·어시스턴트 메시지의 텍스트 파트만 이어 붙인 NFC 텍스트. 없으면 undefined */
function textOf(
  event: DurableEventEnvelope,
): { role: "user" | "assistant"; text: string } | undefined {
  const parsed = parse(ItemRecordedPayloadSchema, event.payload);
  if (!parsed.ok) return undefined;
  const { item } = parsed.value;
  let text: string;
  if (item.kind === "user") {
    const { content } = item.message;
    text =
      typeof content === "string"
        ? content
        : content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
  } else if (item.kind === "assistant") {
    text = item.message.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");
  } else {
    return undefined;
  }
  const normalized = text.normalize("NFC").trim();
  if (normalized === "") return undefined;
  return { role: item.kind, text: normalized };
}

function cursorOf(db: StoreDb): Result<number, KnowledgeFailure> {
  const read = db.read((tx) =>
    tx.get("SELECT event_seq FROM cap_knowledge_sessioncursor WHERE consumer = ?", [CONSUMER]),
  );
  if (!read.ok) return err(fromStoreError(read.error, "index cursor"));
  const value = read.value?.["event_seq"];
  return ok(typeof value === "number" ? value : typeof value === "bigint" ? Number(value) : 0);
}

/** 이벤트 한 덩어리를 한 트랜잭션으로 색인한다. 커서는 `upTo`까지 올린다 */
function writeRows(
  db: StoreDb,
  rows: readonly MessageRow[],
  upTo: number,
): Result<{ readonly inserted: number }, KnowledgeFailure> {
  const written = db.write((tx) => {
    const cursorRow = tx.get(
      "SELECT event_seq FROM cap_knowledge_sessioncursor WHERE consumer = ?",
      [CONSUMER],
    );
    const cursorValue = cursorRow?.["event_seq"];
    const cursor =
      typeof cursorValue === "number"
        ? cursorValue
        : typeof cursorValue === "bigint"
          ? Number(cursorValue)
          : 0;
    let inserted = 0;
    for (const row of rows) {
      if (row.eventSeq <= cursor) continue;
      const next = tx.get(
        "SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM cap_knowledge_sessiondocs WHERE thread_id = ?",
        [row.threadId],
      );
      const nextValue = next?.["next"];
      const seq = typeof nextValue === "number" ? nextValue : Number(nextValue ?? 1);
      const added = tx.run(
        `INSERT INTO cap_knowledge_sessiondocs
           (event_id, thread_id, seq, event_seq, role, recorded_at, chars)
         VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (event_id) DO NOTHING`,
        [
          row.eventId,
          row.threadId,
          seq,
          row.eventSeq,
          row.role,
          row.recordedAt,
          Array.from(row.text).length,
        ],
      );
      if (added.changes === 0) continue;
      const doc = tx.get("SELECT doc_id FROM cap_knowledge_sessiondocs WHERE event_id = ?", [
        row.eventId,
      ]);
      tx.run("INSERT INTO cap_knowledge_sessionfts (rowid, thread_id, text) VALUES (?, ?, ?)", [
        doc?.["doc_id"] ?? null,
        row.threadId,
        row.text,
      ]);
      inserted += 1;
    }
    if (upTo > cursor) {
      tx.run(
        `INSERT INTO cap_knowledge_sessioncursor (consumer, event_seq) VALUES (?, ?)
         ON CONFLICT (consumer) DO UPDATE SET event_seq = excluded.event_seq`,
        [CONSUMER, upTo],
      );
    }
    return { inserted };
  });
  return written.ok ? ok(written.value) : err(fromStoreError(written.error, "session index"));
}

/** 이벤트 목록에서 색인할 메시지를 뽑는다. 이벤트 순서를 지킨다 */
async function rowsOf(
  deps: IndexerDeps,
  events: readonly DurableEventEnvelope[],
): Promise<Result<MessageRow[], KnowledgeFailure>> {
  const rows: MessageRow[] = [];
  const stopped = await eachAsync(events, async (event) => {
    // detached 필드(큰 텍스트)는 blob에서 되돌린 사본으로 읽는다
    const hydrated =
      (event.detached?.length ?? 0) > 0
        ? await attemptAsync(() => deps.session.hydrate(event))
        : ok(event);
    if (!hydrated.ok) {
      return {
        value: failure("unavailable", "an event could not be restored from its blobs", {
          cause: hydrated.error,
        }),
      };
    }
    const message = textOf(hydrated.value);
    if (message !== undefined) {
      rows.push({
        eventId: event.id,
        threadId: event.threadId,
        eventSeq: event.seq,
        role: message.role,
        recordedAt: event.recordedAt,
        text: message.text,
      });
    }
    return undefined;
  });
  return stopped === undefined ? ok(rows) : err(stopped.value);
}

/** 배치 하나를 최대 500 이벤트씩 나누어 색인한다. 이벤트가 없는 배치도 커서는 올린다 */
async function indexBatch(
  deps: IndexerDeps,
  batch: CommitBatch,
): Promise<Result<void, KnowledgeFailure>> {
  const slices: DurableEventEnvelope[][] = [];
  for (let start = 0; start < batch.events.length; start += BATCH_EVENTS) {
    slices.push(batch.events.slice(start, start + BATCH_EVENTS));
  }
  if (slices.length === 0) slices.push([]);
  const stopped = await eachAsync(slices.entries(), async ([index, slice]) => {
    const rows = await rowsOf(deps, slice);
    if (!rows.ok) return { value: rows.error };
    const upTo = index === slices.length - 1 ? batch.lastSeq : (slice.at(-1)?.seq ?? batch.lastSeq);
    const written = writeRows(deps.db, rows.value, upTo);
    return written.ok ? undefined : { value: written.error };
  });
  return stopped === undefined ? ok(undefined) : err(stopped.value);
}

export function startIndexer(deps: IndexerDeps): Result<Indexer, KnowledgeFailure> {
  const cursor = cursorOf(deps.db);
  if (!cursor.ok) return cursor;
  let chain: Promise<void> = Promise.resolve();
  let failed = false;

  /** 배치 하나를 처리한다. 쓰기 도중 던진 예외(저장소 장애 주입 등)도 값으로 바꿔 체인이 끊기지 않게 하고 던진 원인은 기록한다 */
  async function processBatch(batch: CommitBatch): Promise<void> {
    if (failed) return;
    const attempted = await attemptAsync(() => indexBatch(deps, batch));
    const done: Result<void, KnowledgeFailure> = attempted.ok
      ? attempted.value
      : err(failure("internal", "the session index write threw", { cause: attempted.error }));
    if (done.ok) return;
    // 커서를 올리지 않았으므로 다음 시작에서 같은 배치부터 다시 받는다. 뒤 배치는 건너뛰지 않도록 멈춘다
    failed = true;
    deps.logger.error("knowledge.indexer.failed", {
      kind: done.error.kind,
      message: done.error.message,
      fromSeq: batch.firstSeq,
    });
  }

  const subscribed = deps.session.subscribe(
    cursor.value,
    (batch) => {
      // 구독자는 동기로 돌려줘야 한다. 처리는 앞 배치가 끝난 뒤에 이어 한다
      chain = chain.then(() => processBatch(batch));
    },
    { kindPrefixes: ["item.recorded"] },
  );
  if (!subscribed.ok) {
    return err(failure("unavailable", `the session feed is unavailable: ${subscribed.error.kind}`));
  }
  const unsubscribe = subscribed.value;
  return ok({
    stop: unsubscribe,
    settled: () => chain,
  });
}
