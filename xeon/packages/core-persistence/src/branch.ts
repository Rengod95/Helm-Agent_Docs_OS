// 활성 가지 질의(L1.persistence.spec §3.4, §4.10, X.primitives.spec §4.6.1 활성 가지 규칙).
// 활성 가지는 thread의 현재 leaf에서 parent_id를 따라 올라간 사슬이다. 버려진 가지의 이벤트는 들어가지 않는다.
// 이 파일의 함수는 모두 읽기 전용이고 SqlTx 하나 안에서 같은 스냅숏을 본다.
import { err, ok, type Result } from "@xeon/contracts";
import {
  ItemKindSchema,
  ItemStatusSchema,
  type EventId,
  type ItemId,
  type JsonValue,
  type ThreadId,
} from "@xeon/contracts/conversation";
import type {
  DurableEventEnvelope,
  ItemRow,
  SqlRow,
  SqlTx,
  SqlValue,
} from "@xeon/contracts/records";
import { envelopeOfRow } from "./events.ts";
import { columns, rowInvalid, type RowFault } from "./rows.ts";
import { readThread } from "./views.ts";

/** 후보 이벤트를 새 것부터 한 번에 읽는 수 */
const CANDIDATE_PAGE = 64;

/** 한 thread의 현재 leaf. thread가 없으면 undefined */
function leafOf(tx: SqlTx, threadId: ThreadId): Result<EventId | null | undefined, RowFault> {
  const thread = readThread(tx, threadId);
  if (!thread.ok) return thread;
  return ok(thread.value === undefined ? undefined : thread.value.leafEventId);
}

/**
 * candidate가 leaf에서 parent_id를 따라 올라간 사슬 위에 있는가. candidate보다 seq가 작아지면 더 올라가지 않는다
 * (부모는 항상 자식보다 seq가 작다)
 */
function isOnBranch(
  tx: SqlTx,
  leaf: EventId | null,
  candidate: { readonly id: string; readonly seq: number },
): boolean {
  if (leaf === null) return false;
  const row = tx.get(
    `WITH RECURSIVE chain(id, parent_id, seq) AS (
       SELECT id, parent_id, seq FROM events WHERE id = ?
       UNION ALL
       SELECT e.id, e.parent_id, e.seq FROM events e JOIN chain c ON e.id = c.parent_id
       WHERE c.seq > ?
     )
     SELECT 1 AS hit FROM chain WHERE id = ? LIMIT 1`,
    [leaf, candidate.seq, candidate.id],
  );
  return row !== undefined;
}

/** kind 조건. sql은 `kind`만 참조하는 조건식이다 */
export interface KindFilter {
  readonly sql: string;
  readonly params: readonly SqlValue[];
}

export const kindIn = (kinds: readonly string[]): KindFilter => ({
  sql: `kind IN (${kinds.map(() => "?").join(", ")})`,
  params: kinds,
});

/** RFC 6901 포인터로 payload 값을 찾는다. 위치가 없으면 undefined */
function valueAt(root: unknown, pointer: string): unknown {
  if (pointer === "") return root;
  let current: unknown = root;
  for (const raw of pointer.slice(1).split("/")) {
    const token = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else if (typeof current === "object" && current !== null) {
      current = new Map(Object.entries(current)).get(token);
    } else {
      return undefined;
    }
  }
  return current;
}

function sameJson(left: unknown, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export interface BranchMatch {
  readonly pointer: string;
  readonly equals: JsonValue;
}

/**
 * 활성 가지 위(onActiveBranch가 거짓이면 thread 전체)에서 kind 조건과 payload 일치를 만족하는 가장 새 이벤트.
 * 후보를 새 것부터 읽고 가지 소속은 후보마다 짧은 사슬 걷기로 본다: 가지가 갈라지지 않은 보통 경우 첫 후보에서 끝난다
 */
export function latestEvent(
  tx: SqlTx,
  threadId: ThreadId,
  filter: KindFilter,
  options: { readonly match?: BranchMatch; readonly onActiveBranch: boolean },
): Result<DurableEventEnvelope | undefined, RowFault> {
  let leaf: EventId | null = null;
  if (options.onActiveBranch) {
    const found = leafOf(tx, threadId);
    if (!found.ok) return found;
    if (found.value === undefined) return ok(undefined);
    leaf = found.value;
  }
  let before = Number.MAX_SAFE_INTEGER;
  for (;;) {
    const rows: readonly SqlRow[] = tx.all(
      `SELECT seq, id, envelope FROM events WHERE thread_id = ? AND (${filter.sql}) AND seq < ?
       ORDER BY seq DESC LIMIT ?`,
      [threadId, ...filter.params, before, CANDIDATE_PAGE],
    );
    for (const row of rows) {
      const c = columns(row, "events");
      const seq = c.int("seq");
      if (!seq.ok) return seq;
      const id = c.string("id");
      if (!id.ok) return id;
      before = seq.value;
      if (options.onActiveBranch && !isOnBranch(tx, leaf, { id: id.value, seq: seq.value })) {
        continue;
      }
      const envelope = envelopeOfRow(row);
      if (!envelope.ok) return envelope;
      const match = options.match;
      if (
        match !== undefined &&
        !sameJson(valueAt(envelope.value.payload, match.pointer), match.equals)
      ) {
        continue;
      }
      return ok(envelope.value);
    }
    if (rows.length < CANDIDATE_PAGE) return ok(undefined);
  }
}

/** 활성 가지 위 이벤트와 비공개 소유 확장(공개면 null) */
export interface BranchEvent {
  readonly envelope: DurableEventEnvelope;
  readonly privateOwner: string | null;
}

/** 활성 가지 위 이벤트 중 조건에 맞는 것, seq 오름차순. 가지 전체를 한 번 훑는다 */
export function branchEventsWithOwner(
  tx: SqlTx,
  threadId: ThreadId,
  filter: KindFilter,
): Result<readonly BranchEvent[], RowFault> {
  const found = leafOf(tx, threadId);
  if (!found.ok) return found;
  const leaf = found.value ?? null;
  if (leaf === null) return ok([]);
  const rows = tx.all(
    `WITH RECURSIVE chain(id) AS (
       SELECT id FROM events WHERE id = ?
       UNION ALL
       SELECT e.parent_id FROM chain c JOIN events e ON e.id = c.id WHERE e.parent_id IS NOT NULL
     )
     SELECT e.envelope, e.private_owner FROM chain c JOIN events e ON e.id = c.id
     WHERE ${filter.sql} ORDER BY e.seq`,
    [leaf, ...filter.params],
  );
  const out: BranchEvent[] = [];
  for (const row of rows) {
    const envelope = envelopeOfRow(row);
    if (!envelope.ok) return envelope;
    const owner = columns(row, "events").nullableString("private_owner");
    if (!owner.ok) return owner;
    out.push({ envelope: envelope.value, privateOwner: owner.value });
  }
  return ok(out);
}

/** 활성 가지 위 이벤트 중 kind 조건에 맞는 것, seq 오름차순 */
export function branchEvents(
  tx: SqlTx,
  threadId: ThreadId,
  filter: KindFilter,
): Result<readonly DurableEventEnvelope[], RowFault> {
  const events = branchEventsWithOwner(tx, threadId, filter);
  return events.ok ? ok(events.value.map((entry) => entry.envelope)) : events;
}

function itemRowOf(row: SqlRow): Result<ItemRow, RowFault> {
  const c = columns(row, "p_items");
  const itemId = c.id("itm", "item_id");
  if (!itemId.ok) return itemId;
  const eventId = c.id("evt", "event_id");
  if (!eventId.ok) return eventId;
  const seq = c.int("seq");
  if (!seq.ok) return seq;
  const kind = c.parsed(ItemKindSchema, "kind");
  if (!kind.ok) return kind;
  if (kind.value === "toolCall") return err(rowInvalid("p_items.kind"));
  const turnId = c.nullableId("trn", "turn_id");
  if (!turnId.ok) return turnId;
  const status = c.parsed(ItemStatusSchema, "status");
  if (!status.ok) return status;
  return ok({
    itemId: itemId.value,
    eventId: eventId.value,
    seq: seq.value,
    kind: kind.value,
    turnId: turnId.value,
    status: status.value,
  });
}

/** 활성 가지의 item, 오름차순. afterItemId가 활성 가지에 없으면 빈 목록이다 */
export function branchItems(
  tx: SqlTx,
  threadId: ThreadId,
  options: { readonly afterItemId?: ItemId; readonly limit?: number } | undefined,
): Result<readonly ItemRow[], RowFault> {
  const found = leafOf(tx, threadId);
  if (!found.ok) return found;
  const leaf = found.value ?? null;
  if (leaf === null) return ok([]);
  let floor = 0;
  if (options?.afterItemId !== undefined) {
    const after = tx.get("SELECT seq FROM p_items WHERE item_id = ? AND thread_id = ?", [
      options.afterItemId,
      threadId,
    ]);
    if (after === undefined) return ok([]);
    const seq = columns(after, "p_items").int("seq");
    if (!seq.ok) return seq;
    floor = seq.value;
  }
  const rows = tx.all(
    `WITH RECURSIVE chain(id) AS (
       SELECT id FROM events WHERE id = ?
       UNION ALL
       SELECT e.parent_id FROM chain c JOIN events e ON e.id = c.id WHERE e.parent_id IS NOT NULL
     )
     SELECT i.item_id, i.event_id, i.seq, i.kind, i.turn_id, i.status
     FROM chain c JOIN p_items i ON i.event_id = c.id
     WHERE i.seq > ? ORDER BY i.seq LIMIT ?`,
    [leaf, floor, options?.limit ?? Number.MAX_SAFE_INTEGER],
  );
  const out: ItemRow[] = [];
  for (const row of rows) {
    const item = itemRowOf(row);
    if (!item.ok) return item;
    out.push(item.value);
  }
  return ok(out);
}

/** item을 기록한 이벤트 id(모든 가지에서 찾는다) */
export function itemEvent(
  tx: SqlTx,
  threadId: ThreadId,
  itemId: ItemId,
): Result<EventId | undefined, RowFault> {
  const row = tx.get("SELECT event_id FROM p_items WHERE item_id = ? AND thread_id = ?", [
    itemId,
    threadId,
  ]);
  if (row === undefined) return ok(undefined);
  return columns(row, "p_items").id("evt", "event_id");
}
