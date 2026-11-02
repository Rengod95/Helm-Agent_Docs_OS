import { expect, test } from "bun:test";
import { Bug, err, ok, parse } from "@fresnel/contracts";
import type { ItemId, ItemRecord } from "@fresnel/contracts/conversation";
import type {
  ItemPage,
  ItemPageFailure,
  ItemPageRequest,
  ItemPages,
} from "@fresnel/core-persistence";
import { StoreIdSchema, WIRE_LIMITS, type StoreId } from "@fresnel/contracts/wire";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { readThread } from "../../src/assembly/thread-read.ts";

// thread.read는 쪽 질의(L1.persistence `branchItemRecords`)에 before·limit을 그대로 넘기고, 응답 크기 예산만 호스트가 맞춘다(G2-11).
// 가짜 쪽 질의가 요청을 기록한다. 쪽 읽기 자체(가지, fork 연속, blob)는 core-persistence의 시험이다.

const ids = fixedIdFactory(700);
const THREAD = ids.next("thr");
const parsedStore = parse(StoreIdSchema, "sto_01ARZ3NDEKTSV4RRFFQ69G5FAV");
if (!parsedStore.ok) throw new Bug("the test store id must be valid");
const STORE_ID: StoreId = parsedStore.value;

function customItem(index: number, content = `item ${String(index)}`): ItemRecord {
  return {
    itemId: ids.next("itm"),
    status: "completed",
    kind: "custom",
    message: {
      role: "custom",
      customType: "test.item",
      content,
      display: false,
      details: null,
      timestamp: index,
    },
  };
}

function fakePages(answer: (request: ItemPageRequest) => ItemPage | ItemPageFailure): {
  readonly pages: ItemPages;
  readonly requests: ItemPageRequest[];
} {
  const requests: ItemPageRequest[] = [];
  const pages: ItemPages = {
    branchItemRecords(request) {
      requests.push(request);
      const answered = answer(request);
      return Promise.resolve("kind" in answered ? err(answered) : ok(answered));
    },
  };
  return { pages, requests };
}

test("the page query gets before and limit unchanged, and its head becomes the position", async () => {
  const items = [customItem(0), customItem(1), customItem(2)];
  const anchor: ItemId = ids.next("itm");
  const { pages, requests } = fakePages(() => ({ items, headSeq: 41, hasMore: true }));
  const read = await readThread(pages, STORE_ID, { threadId: THREAD, limit: 3, before: anchor });
  if (!read.ok) throw new Error("expected a page");
  expect(requests).toEqual([{ threadId: THREAD, limit: 3, before: anchor }]);
  expect(read.value.items).toEqual(items);
  expect(read.value.position).toEqual({ storeId: STORE_ID, seq: 41 });
  expect(read.value.hasMore).toBe(true);
});

test("without a limit the default page size is asked for, and no before is sent", async () => {
  const { pages, requests } = fakePages(() => ({ items: [], headSeq: 0, hasMore: false }));
  const read = await readThread(pages, STORE_ID, { threadId: THREAD });
  if (!read.ok) throw new Error("expected a page");
  expect(requests).toEqual([{ threadId: THREAD, limit: 200 }]);
  expect(read.value.items).toEqual([]);
  expect(read.value.hasMore).toBe(false);
});

test("items over the frame budget are dropped from the old end and hasMore turns true", async () => {
  const big = "x".repeat(Math.floor(WIRE_LIMITS.maxFrameBytes / 3));
  const items = [customItem(0, big), customItem(1, big), customItem(2, big), customItem(3, big)];
  const { pages } = fakePages(() => ({ items, headSeq: 9, hasMore: false }));
  const read = await readThread(pages, STORE_ID, { threadId: THREAD, limit: 4 });
  if (!read.ok) throw new Error("expected a page");
  expect(read.value.items.length).toBeLessThan(4);
  expect(read.value.items.length).toBeGreaterThan(0);
  // 남은 것은 가장 새 item부터 이어진 꼬리다
  expect(read.value.items).toEqual(items.slice(4 - read.value.items.length));
  expect(read.value.hasMore).toBe(true);
});

test("a single item over the budget is still returned alone", async () => {
  const huge = customItem(0, "y".repeat(WIRE_LIMITS.maxFrameBytes));
  const { pages } = fakePages(() => ({ items: [huge], headSeq: 1, hasMore: false }));
  const read = await readThread(pages, STORE_ID, { threadId: THREAD });
  if (!read.ok) throw new Error("expected a page");
  expect(read.value.items).toEqual([huge]);
  expect(read.value.hasMore).toBe(false);
});

test("the query's refusals reach the handler as they are", async () => {
  const missing = fakePages(() => ({ kind: "invalid_target", reason: "item_not_found" }));
  const refused = await readThread(missing.pages, STORE_ID, {
    threadId: THREAD,
    before: ids.next("itm"),
  });
  expect(refused.ok).toBe(false);
  if (!refused.ok) {
    expect(refused.error).toEqual({ kind: "invalid_target", reason: "item_not_found" });
  }
  const unknown = fakePages(() => ({ kind: "thread_not_found", threadId: THREAD }));
  const notFound = await readThread(unknown.pages, STORE_ID, { threadId: THREAD });
  expect(notFound.ok).toBe(false);
  if (!notFound.ok) expect(notFound.error).toEqual({ kind: "thread_not_found", threadId: THREAD });
});

// ── around(W-16). 가짜 가지: 오래된 것부터 `branch`, 쪽 질의는 가장 새 item에서 거슬러 올라간다 ──

function branchPages(branch: readonly ItemRecord[], headSeq = 77): ReturnType<typeof fakePages> {
  return fakePages((request) => {
    const end =
      request.before === undefined
        ? branch.length
        : branch.findIndex((item) => item.itemId === request.before);
    if (end < 0) return { kind: "invalid_target", reason: "item_not_found" };
    const start = Math.max(0, end - request.limit);
    return { items: branch.slice(start, end), headSeq, hasMore: start > 0 };
  });
}

function idsOf(items: readonly ItemRecord[]): readonly ItemId[] {
  return items.map((item) => item.itemId);
}

const BRANCH = Array.from({ length: 20 }, (_, index) => customItem(index));

test("around a middle item returns half the limit before it, the item, and the rest after it", async () => {
  const anchor = BRANCH[10];
  if (anchor === undefined) throw new Error("fixture");
  const { pages } = branchPages(BRANCH);
  const read = await readThread(pages, STORE_ID, {
    threadId: THREAD,
    limit: 5,
    around: anchor.itemId,
  });
  if (!read.ok) throw new Error("expected a window");
  expect(idsOf(read.value.items)).toEqual(idsOf(BRANCH.slice(8, 13)));
  expect(read.value.hasMore).toBe(true);
  expect(read.value.position).toEqual({ storeId: STORE_ID, seq: 77 });
});

test("around an item near the start has nothing older, and hasMore is false", async () => {
  const anchor = BRANCH[1];
  if (anchor === undefined) throw new Error("fixture");
  const { pages } = branchPages(BRANCH);
  const read = await readThread(pages, STORE_ID, {
    threadId: THREAD,
    limit: 6,
    around: anchor.itemId,
  });
  if (!read.ok) throw new Error("expected a window");
  expect(idsOf(read.value.items)).toEqual(idsOf(BRANCH.slice(0, 6)));
  expect(read.value.hasMore).toBe(false);
});

test("around an item near the end fills the window from the older side", async () => {
  const anchor = BRANCH[18];
  if (anchor === undefined) throw new Error("fixture");
  const { pages } = branchPages(BRANCH);
  const read = await readThread(pages, STORE_ID, {
    threadId: THREAD,
    limit: 6,
    around: anchor.itemId,
  });
  if (!read.ok) throw new Error("expected a window");
  expect(idsOf(read.value.items)).toEqual(idsOf(BRANCH.slice(14, 20)));
  expect(read.value.hasMore).toBe(true);
});

test("around finds an item that is far from the newest end by reading several pages", async () => {
  const long = Array.from({ length: 1300 }, (_, index) => customItem(index));
  const anchor = long[100];
  if (anchor === undefined) throw new Error("fixture");
  const { pages, requests } = branchPages(long);
  const read = await readThread(pages, STORE_ID, {
    threadId: THREAD,
    limit: 4,
    around: anchor.itemId,
  });
  if (!read.ok) throw new Error("expected a window");
  expect(idsOf(read.value.items)).toEqual(idsOf(long.slice(98, 102)));
  // 가지 확인 1번, 가장 새 쪽부터 500개씩 3쪽, 앞쪽 채우기 1번
  expect(requests.length).toBe(5);
});

test("around an unknown item returns an empty window with the head position", async () => {
  const { pages } = branchPages(BRANCH);
  const read = await readThread(pages, STORE_ID, {
    threadId: THREAD,
    around: ids.next("itm"),
  });
  if (!read.ok) throw new Error("expected an empty window");
  expect(read.value.items).toEqual([]);
  expect(read.value.hasMore).toBe(false);
  expect(read.value.position).toEqual({ storeId: STORE_ID, seq: 77 });
});

test("around over the frame budget drops items from the side farther from the anchor", async () => {
  const big = "x".repeat(Math.floor(WIRE_LIMITS.maxFrameBytes / 3));
  const branch = [0, 1, 2, 3, 4].map((index) => customItem(index, big));
  const anchor = branch[1];
  if (anchor === undefined) throw new Error("fixture");
  const { pages } = branchPages(branch);
  const read = await readThread(pages, STORE_ID, {
    threadId: THREAD,
    limit: 5,
    around: anchor.itemId,
  });
  if (!read.ok) throw new Error("expected a window");
  // 큰 item은 둘만 들어간다. 앵커(1) 앞쪽이 뒤쪽보다 적으므로 가장 새 쪽부터 덜어 낸다
  expect(idsOf(read.value.items)).toEqual(idsOf(branch.slice(0, 2)));
  expect(read.value.hasMore).toBe(false);
});
