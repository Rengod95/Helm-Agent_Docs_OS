import { err, ok, parse, type Result } from "@xeon/contracts";
import type { ItemId, ItemRecord, ThreadId } from "@xeon/contracts/conversation";
import {
  ItemRecordedPayloadSchema,
  type DurableEventEnvelope,
  type ReadFailure,
  type SessionService,
  type SqlRow,
  type StoreDb,
} from "@xeon/contracts/records";
import { envelopeOfRow, headSeqOf } from "./events.ts";
import type { Reader } from "./read.ts";
import { columns, readResult, rowInvalid, type RowFault } from "./rows.ts";
import { upcastStored, type KindCatalog } from "./upcast.ts";
import { readThread } from "./views.ts";

// 활성 가지의 item을 `before`·`limit` 쪽으로 읽는 질의(M2 마감 G2-11, F.wire-settings.spec §3.4.6 3항).
// `thread.read`가 쪽 하나를 위해 가지 전체의 이벤트를 읽고 detached 본문을 모두 되살리던 것을, 쪽에 든 item의 이벤트만
// 읽고 되살리게 한다. fork한 thread의 가지는 출처 thread의 fork 지점까지 이어지므로(첫 이벤트의 parentId) 질의는 사슬을 따라
// 가기만 하면 출처의 item도 같은 방식으로 돌려준다(F wire §3.4.6 3.1).
// F의 `ProjectionQuery`에 없는 질의라서 서비스 객체에 붙이지 않고 `itemPagesOf(session)`으로 꺼낸다. 이 서비스가 만든 객체가 아니면 undefined다.

export interface ItemPageRequest {
  readonly threadId: ThreadId;
  /** 이 item 바로 앞부터. 없으면 가장 새 item부터 */
  readonly before?: ItemId;
  /** 1 이상 */
  readonly limit: number;
}

export interface ItemPage {
  /** 오래된 것부터 */
  readonly items: readonly ItemRecord[];
  /** items와 같은 읽기 트랜잭션에서 잰 저장소 head */
  readonly headSeq: number;
  /** items[0]보다 앞선 item이 더 있다(출처 thread의 item 포함) */
  readonly hasMore: boolean;
}

export type ItemPageFailure =
  | ReadFailure
  | { readonly kind: "thread_not_found"; readonly threadId: ThreadId }
  | {
      readonly kind: "invalid_target";
      readonly reason: "item_not_found" | "not_on_branch";
    };

export interface ItemPages {
  branchItemRecords(request: ItemPageRequest): Promise<Result<ItemPage, ItemPageFailure>>;
}

/** 한 읽기 트랜잭션의 결과: 쪽의 원본 행, 또는 요청을 받아들일 수 없는 이유 */
type RawOutcome =
  | {
      readonly status: "page";
      readonly headSeq: number;
      readonly rows: readonly SqlRow[];
      readonly hasMore: boolean;
    }
  | { readonly status: "refused"; readonly failure: ItemPageFailure };

const CHAIN = `WITH RECURSIVE chain(id) AS (
       SELECT id FROM events WHERE id = ?
       UNION ALL
       SELECT e.parent_id FROM chain c JOIN events e ON e.id = c.id WHERE e.parent_id IS NOT NULL
     )`;

export function createItemPages(deps: {
  readonly db: Pick<StoreDb, "read">;
  readonly catalog: KindCatalog;
  readonly reader: Pick<Reader, "hydrate">;
}): ItemPages {
  const { db, catalog, reader } = deps;

  function readRaw(request: ItemPageRequest): Result<RawOutcome, ReadFailure> {
    return readResult(db, (tx): Result<RawOutcome, RowFault> => {
      const head = headSeqOf(tx);
      if (!head.ok) return head;
      const thread = readThread(tx, request.threadId);
      if (!thread.ok) return thread;
      if (thread.value === undefined) {
        return ok({
          status: "refused",
          failure: { kind: "thread_not_found", threadId: request.threadId },
        });
      }
      const leaf = thread.value.leafEventId;
      if (leaf === null)
        return ok({ status: "page", headSeq: head.value, rows: [], hasMore: false });

      let ceiling = Number.MAX_SAFE_INTEGER;
      if (request.before !== undefined) {
        const target = tx.get("SELECT thread_id, event_id, seq FROM p_items WHERE item_id = ?", [
          request.before,
        ]);
        if (target === undefined) {
          return ok({
            status: "refused",
            failure: { kind: "invalid_target", reason: "item_not_found" },
          });
        }
        const c = columns(target, "p_items");
        const owner = c.string("thread_id");
        const eventId = c.string("event_id");
        const seq = c.int("seq");
        if (!owner.ok) return owner;
        if (!eventId.ok) return eventId;
        if (!seq.ok) return seq;
        const onBranch = tx.get(`${CHAIN} SELECT 1 AS found FROM chain WHERE id = ?`, [
          leaf,
          eventId.value,
        ]);
        if (onBranch === undefined) {
          // 이 thread의 item이 현재 가지에 없는 경우만 not_on_branch다. 남의 thread item은 이 thread에 없는 item이다
          return ok({
            status: "refused",
            failure: {
              kind: "invalid_target",
              reason: owner.value === request.threadId ? "not_on_branch" : "item_not_found",
            },
          });
        }
        ceiling = seq.value;
      }
      const rows = tx.all(
        `${CHAIN}
         SELECT e.envelope AS envelope
         FROM chain c JOIN p_items i ON i.event_id = c.id JOIN events e ON e.id = c.id
         WHERE i.seq < ? ORDER BY i.seq DESC LIMIT ?`,
        [leaf, ceiling, request.limit + 1],
      );
      return ok({
        status: "page",
        headSeq: head.value,
        rows: rows.slice(0, request.limit),
        hasMore: rows.length > request.limit,
      });
    });
  }

  return {
    async branchItemRecords(request) {
      if (!Number.isInteger(request.limit) || request.limit < 1) {
        return err({ kind: "row_invalid", where: "item page limit" });
      }
      const raw = readRaw(request);
      if (!raw.ok) return raw;
      if (raw.value.status === "refused") return err(raw.value.failure);
      const decoded: DurableEventEnvelope[] = [];
      for (const row of raw.value.rows) {
        const envelope = envelopeOfRow(row);
        if (!envelope.ok) return envelope;
        const upcast = upcastStored(catalog, envelope.value);
        if (!upcast.ok) return upcast;
        decoded.push(upcast.value);
      }
      // detached 본문은 쪽에 든 이벤트만 blob에서 되돌린다
      const hydrated = await Promise.all(decoded.map((event) => reader.hydrate(event)));
      const items: ItemRecord[] = [];
      // 새 것부터 읽었으므로 뒤집어 오래된 것부터 담는다
      for (const event of hydrated.toReversed()) {
        const payload = parse(ItemRecordedPayloadSchema, event.payload);
        if (!payload.ok) return err(rowInvalid("events.payload(item.recorded)"));
        items.push(payload.value.item);
      }
      return ok({ items, headSeq: raw.value.headSeq, hasMore: raw.value.hasMore });
    },
  };
}

// 서비스 객체를 펼쳐 복사하는 래퍼(계측, 시험)가 있어도 `query` 객체는 같은 참조라 이것을 열쇠로 쓴다
const registry = new WeakMap<SessionService["query"], ItemPages>();

/** `createSessionService`가 만든 서비스에 딸린 item 쪽 질의. 다른 구현(시험 대역)이면 undefined */
export function itemPagesOf(session: SessionService): ItemPages | undefined {
  return registry.get(session.query);
}

export function registerItemPages(session: SessionService, pages: ItemPages): void {
  registry.set(session.query, pages);
}
