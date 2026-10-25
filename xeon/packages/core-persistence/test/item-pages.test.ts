import { describe, expect, test } from "bun:test";
import { Bug, parse } from "@xeon/contracts";
import type { ItemId, ItemRecord, ThreadId } from "@xeon/contracts/conversation";
import { ItemRecordedPayloadSchema } from "@xeon/contracts/records";
import { itemPagesOf, type ItemPage } from "../src/index.ts";
import { branchItemsOf, completeTurn, itemAt } from "./support/branching.ts";
import {
  commitOrThrow,
  draftOf,
  expectOk,
  memoryBlobs,
  newThread,
  openHarness,
  type Harness,
} from "./support/harness.ts";
import { TEST_HOLDER_A } from "./support/sqlite-store.ts";

// M2 마감 G2-11. `thread.read`의 쪽 질의: 가지 전체를 읽지 않고 `before`·`limit`으로 쪽에 든 item만 읽는다.

function pagesOf(h: Harness) {
  const pages = itemPagesOf(h.service);
  if (pages === undefined) throw new Bug("the service has no item pages");
  return pages;
}

async function page(
  h: Harness,
  threadId: ThreadId,
  limit: number,
  before?: ItemId,
): Promise<ItemPage> {
  const result = await pagesOf(h).branchItemRecords({
    threadId,
    limit,
    ...(before === undefined ? {} : { before }),
  });
  return expectOk(result);
}

/** readBranch로 읽은 활성 가지의 ItemRecord 전부 */
async function allItems(h: Harness, threadId: ThreadId): Promise<ItemRecord[]> {
  const items: ItemRecord[] = [];
  for await (const read of h.service.readBranch(threadId)) {
    const event = expectOk(read);
    if (event.kind !== "item.recorded") continue;
    const payload = parse(ItemRecordedPayloadSchema, (await h.service.hydrate(event)).payload);
    if (payload.ok) items.push(payload.value.item);
  }
  return items;
}

function openForked(h: Harness, threadId: ThreadId): void {
  const token = h.store.leases.acquire(`session:${threadId}`, TEST_HOLDER_A);
  if (!token.ok) throw new Bug("lease failed", { cause: token.error });
  const opened = h.service.openForWrite(threadId, token.value);
  if (!opened.ok) throw new Bug("open failed", { cause: opened.error });
}

describe("branchItemRecords", () => {
  test("pages walk back from the newest item and join up to the whole branch", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    completeTurn(h, threadId);
    completeTurn(h, threadId);
    completeTurn(h, threadId);
    const everything = await allItems(h, threadId);
    expect(everything).toHaveLength(6);

    const newest = await page(h, threadId, 4);
    expect(newest.items.map((item) => item.itemId)).toEqual(
      everything.slice(2).map((item) => item.itemId),
    );
    expect(newest.hasMore).toBe(true);
    expect(newest.headSeq).toBe(expectOk(h.service.feed.headSeq()));
    // 쪽의 내용은 readBranch로 읽은 item과 같다
    expect(newest.items).toEqual(everything.slice(2));

    const first = newest.items[0];
    if (first === undefined) throw new Error("empty page");
    const older = await page(h, threadId, 4, first.itemId);
    expect(older.items).toEqual(everything.slice(0, 2));
    // 첫 item까지 돌려주면 더 없다. 남은 수가 limit과 같을 때도 hasMore는 거짓이다
    expect(older.hasMore).toBe(false);
    const exact = await page(h, threadId, 2, first.itemId);
    expect(exact.items).toEqual(everything.slice(0, 2));
    expect(exact.hasMore).toBe(false);
    const short = await page(h, threadId, 1, first.itemId);
    expect(short.items).toEqual(everything.slice(1, 2));
    expect(short.hasMore).toBe(true);
  });

  test("an empty thread gives an empty page and the whole branch fits in a large limit", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    expect(await page(h, threadId, 10)).toMatchObject({ items: [], hasMore: false });
    completeTurn(h, threadId);
    const all = await page(h, threadId, 500);
    expect(all.items).toHaveLength(2);
    expect(all.hasMore).toBe(false);
  });

  test("an unknown thread, an unknown item and an abandoned-branch item are refused with the reason", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    completeTurn(h, threadId);
    completeTurn(h, threadId);
    const abandoned = itemAt(h, threadId, 3);
    expectOk(await h.service.threads.revert(threadId, itemAt(h, threadId, 1).itemId, "rv1"));
    const pages = pagesOf(h);
    expect(await pages.branchItemRecords({ threadId, limit: 5, before: abandoned.itemId })).toEqual(
      {
        ok: false,
        error: { kind: "invalid_target", reason: "not_on_branch" },
      },
    );
    expect(
      await pages.branchItemRecords({ threadId, limit: 5, before: h.ids.next("itm") }),
    ).toEqual({ ok: false, error: { kind: "invalid_target", reason: "item_not_found" } });
    const ghost = h.ids.next("thr");
    expect(await pages.branchItemRecords({ threadId: ghost, limit: 5 })).toEqual({
      ok: false,
      error: { kind: "thread_not_found", threadId: ghost },
    });
    // 다른 thread의 item은 이 thread에 없는 item이다
    const other = newThread(h, "other");
    completeTurn(h, other.threadId);
    expect(
      await pages.branchItemRecords({
        threadId,
        limit: 5,
        before: itemAt(h, other.threadId, 0).itemId,
      }),
    ).toEqual({ ok: false, error: { kind: "invalid_target", reason: "item_not_found" } });
  });

  test("a fork's pages continue into the origin's items and stop at the origin's first item", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h, "origin");
    completeTurn(h, threadId);
    completeTurn(h, threadId);
    const forkId = h.ids.next("thr");
    expectOk(await h.service.threads.fork(threadId, itemAt(h, threadId, 1).itemId, forkId));
    openForked(h, forkId);
    completeTurn(h, forkId);
    completeTurn(h, forkId);
    // 출처에 fork 뒤 쓰기가 있어도 fork의 쪽에는 들어오지 않는다
    completeTurn(h, threadId);

    const ids = branchItemsOf(h, forkId).map((item) => item.itemId);
    expect(ids).toHaveLength(6);
    const collected: ItemId[] = [];
    let before: ItemId | undefined;
    let sawMore = true;
    let pagesRead = 0;
    while (sawMore) {
      // oxlint-disable-next-line no-await-in-loop -- 쪽은 앞 쪽의 첫 item을 이어서 읽는다 (L1.persistence.spec 쪽 질의)
      const next = await page(h, forkId, 4, before);
      pagesRead += 1;
      collected.unshift(...next.items.map((item) => item.itemId));
      sawMore = next.hasMore;
      before = next.items[0]?.itemId;
      if (pagesRead > 5) throw new Error("paging does not end");
    }
    expect(collected).toEqual(ids);
    expect(pagesRead).toBe(2);
  });

  test("only the items of the page are restored from their blobs", async () => {
    const blobs = memoryBlobs();
    let reads = 0;
    const h = await openHarness({
      putBlob: blobs.putBlob,
      readBlob: (ref) => {
        reads += 1;
        return blobs.readBlob(ref);
      },
    });
    const { threadId } = newThread(h);
    const big = "큰".repeat(100_000);
    const scope = { turnId: h.ids.next("trn"), stepId: null };
    commitOrThrow(h, threadId, "blob:big", () => ({
      kind: "append",
      drafts: [
        draftOf(h, h.loop, "item.recorded", threadId, scope, {
          item: {
            itemId: h.ids.next("itm"),
            status: "completed",
            kind: "user",
            message: { role: "user", content: big, timestamp: 1 },
            requestId: null,
          },
        }),
      ],
      checkpoint: null,
    }));
    completeTurn(h, threadId);
    completeTurn(h, threadId);
    reads = 0;
    const recent = await page(h, threadId, 4);
    expect(recent.hasMore).toBe(true);
    expect(reads).toBe(0);
    const all = await page(h, threadId, 5);
    expect(reads).toBe(1);
    const head = all.items[0];
    expect(head?.kind === "user" && head.message.content).toBe(big);
  });
});
