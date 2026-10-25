import { expect, test } from "bun:test";
import { Bug, ok, parse, type Result } from "@xeon/contracts";
import type { EventId, ItemId } from "@xeon/contracts/conversation";
import type {
  DurableEventEnvelope,
  ReadFailure,
  SessionService,
  ThreadSummaryRow,
} from "@xeon/contracts/records";
import { StoreIdSchema, type StoreId } from "@xeon/contracts/wire";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { readThread } from "../../src/assembly/thread-read.ts";
import { partial } from "../fixtures/unsafe.ts";

// thread.read는 돌려줄 쪽의 이벤트만 blob에서 되돌린다(review M4). 가짜 세션이 hydrate 호출을 센다.

const ids = fixedIdFactory(700);
const THREAD = ids.next("thr");
const parsedStore = parse(StoreIdSchema, "sto_01ARZ3NDEKTSV4RRFFQ69G5FAV");
if (!parsedStore.ok) throw new Bug("the test store id must be valid");
const STORE_ID: StoreId = parsedStore.value;

interface Recorded {
  readonly event: DurableEventEnvelope;
  readonly itemId: ItemId;
}

function recordedItems(count: number): readonly Recorded[] {
  const out: Recorded[] = [];
  for (let index = 0; index < count; index += 1) {
    const itemId = ids.next("itm");
    const eventId = ids.next("evt");
    const event = partial<DurableEventEnvelope>({
      id: eventId,
      seq: index + 1,
      kind: "item.recorded",
      payload: {
        item: {
          itemId,
          status: "completed",
          kind: "custom",
          message: {
            role: "custom",
            customType: "test.item",
            content: `item ${String(index)}`,
            display: false,
            details: null,
            timestamp: index,
          },
        },
      },
    });
    out.push({ event, itemId });
  }
  return out;
}

function fakeSession(recorded: readonly Recorded[]): {
  readonly session: SessionService;
  readonly hydrated: EventId[];
} {
  const hydrated: EventId[] = [];
  const session = partial<SessionService>({
    feed: partial<SessionService["feed"]>({ headSeq: () => ok(recorded.length) }),
    // 가지 사이에 다른 종류의 이벤트가 끼어 있어도 item.recorded만 센다
    async *readBranch() {
      for (const entry of recorded) {
        yield ok(
          partial<DurableEventEnvelope>({
            id: ids.next("evt"),
            seq: 0,
            kind: "turn.started",
            payload: {},
          }),
        );
        yield ok(entry.event);
      }
    },
    hydrate: (event) => {
      hydrated.push(event.id);
      return Promise.resolve(event);
    },
    query: partial<SessionService["query"]>({
      thread: () => ok(partial<ThreadSummaryRow>({})),
      itemEvent: (_threadId, itemId): Result<EventId | undefined, ReadFailure> =>
        ok(recorded.find((entry) => entry.itemId === itemId)?.event.id),
    }),
  });
  return { session, hydrated };
}

test("only the returned page is hydrated, and hasMore counts what was left out", async () => {
  const recorded = recordedItems(30);
  const { session, hydrated } = fakeSession(recorded);
  const read = await readThread(session, STORE_ID, { threadId: THREAD, limit: 5 });
  if (!read.ok) throw new Error("expected a page");
  expect(read.value.items.map((item) => item.itemId)).toEqual(
    recorded.slice(25).map((entry) => entry.itemId),
  );
  expect(read.value.hasMore).toBe(true);
  expect(hydrated).toEqual(recorded.slice(25).map((entry) => entry.event.id));
});

test("a page before an item hydrates only the slice in front of it", async () => {
  const recorded = recordedItems(30);
  const { session, hydrated } = fakeSession(recorded);
  const anchor = recorded[10];
  if (anchor === undefined) throw new Error("expected an item");
  const read = await readThread(session, STORE_ID, {
    threadId: THREAD,
    limit: 4,
    before: anchor.itemId,
  });
  if (!read.ok) throw new Error("expected a page");
  expect(read.value.items.map((item) => item.itemId)).toEqual(
    recorded.slice(6, 10).map((entry) => entry.itemId),
  );
  expect(read.value.hasMore).toBe(true);
  expect(hydrated).toHaveLength(4);
});

test("the oldest page has no more, and an item that is not recorded is item_not_found", async () => {
  const recorded = recordedItems(3);
  const { session } = fakeSession(recorded);
  const all = await readThread(session, STORE_ID, { threadId: THREAD });
  if (!all.ok) throw new Error("expected a page");
  expect(all.value.items).toHaveLength(3);
  expect(all.value.hasMore).toBe(false);
  const missing = await readThread(session, STORE_ID, {
    threadId: THREAD,
    before: ids.next("itm"),
  });
  expect(missing.ok).toBe(false);
  if (!missing.ok) {
    expect(missing.error).toMatchObject({ kind: "invalid_target", reason: "item_not_found" });
  }
});
