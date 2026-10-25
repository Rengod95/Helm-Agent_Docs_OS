import { describe, expect, test } from "bun:test";
import type { EventId, ThreadId } from "@xeon/contracts/conversation";
import { expectProjectionsRebuildable } from "../src/testing/index.ts";
import { branchItemsOf, completeTurn, itemAt } from "./support/branching.ts";
import { Bug } from "@xeon/contracts";
import { expectOk, newThread, openHarness, type Harness } from "./support/harness.ts";
import { TEST_HOLDER_A } from "./support/sqlite-store.ts";

// M2 마감 G2-11, F.wire-settings.spec §3.4.6 3.1. fork한 thread의 활성 가지는 출처 thread의 fork 지점까지의 기록을 잇는다.
// 원본 이벤트를 복사하지 않고 fork의 첫 이벤트(thread.started)가 출처 이벤트에 이어 붙는 것으로 만든다.

async function branchIds(h: Harness, threadId: ThreadId): Promise<EventId[]> {
  const ids: EventId[] = [];
  for await (const read of h.service.readBranch(threadId)) ids.push(expectOk(read).id);
  return ids;
}

/** fork한 thread를 쓰기용으로 연다 */
function openForked(h: Harness, threadId: ThreadId): void {
  const token = h.store.leases.acquire(`session:${threadId}`, TEST_HOLDER_A);
  if (!token.ok) throw new Bug("openForked: lease failed", { cause: token.error });
  const opened = h.service.openForWrite(threadId, token.value);
  if (!opened.ok) throw new Bug("openForked: open failed", { cause: opened.error });
}

async function forkAt(h: Harness, origin: ThreadId, index: number): Promise<ThreadId> {
  const forkId = h.ids.next("thr");
  expectOk(await h.service.threads.fork(origin, itemAt(h, origin, index).itemId, forkId));
  return forkId;
}

describe("fork continuity", () => {
  test("a fork starts with the origin's items up to the fork point, under their own item ids", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h, "origin");
    completeTurn(h, threadId);
    completeTurn(h, threadId);
    const originItems = branchItemsOf(h, threadId);
    const forkId = await forkAt(h, threadId, 1);

    const forkItems = branchItemsOf(h, forkId);
    expect(forkItems.map((item) => item.itemId)).toEqual(
      originItems.slice(0, 2).map((item) => item.itemId),
    );
    expect(forkItems.map((item) => item.kind)).toEqual(["user", "assistant"]);

    // 활성 가지는 출처의 기록 뒤에 fork의 첫 이벤트가 온다
    const ids = await branchIds(h, forkId);
    const originEvent = itemAt(h, threadId, 1).eventId;
    const atOrigin = ids.indexOf(originEvent);
    expect(atOrigin).toBeGreaterThan(-1);
    expect(ids.length - atOrigin - 1).toBe(1);
    expectProjectionsRebuildable(h.store.db);
  });

  test("new items of the fork follow the inherited ones, and later writes to the origin do not reach the fork", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h, "origin");
    completeTurn(h, threadId);
    completeTurn(h, threadId);
    const forkId = await forkAt(h, threadId, 1);
    openForked(h, forkId);
    completeTurn(h, forkId);
    // 출처는 fork 뒤에도 계속 자란다
    completeTurn(h, threadId);

    const forkItems = branchItemsOf(h, forkId);
    expect(forkItems.map((item) => item.kind)).toEqual(["user", "assistant", "user", "assistant"]);
    const originItems = branchItemsOf(h, threadId);
    expect(originItems).toHaveLength(6);
    // 상속한 둘은 출처의 처음 둘이고, 뒤 둘은 fork가 쓴 것이다
    expect(forkItems.slice(0, 2).map((item) => item.itemId)).toEqual(
      originItems.slice(0, 2).map((item) => item.itemId),
    );
    const originIds = new Set(originItems.map((item) => item.itemId));
    expect(forkItems.slice(2).every((item) => !originIds.has(item.itemId))).toBe(true);
    // 이벤트 읽기는 이 thread의 이벤트만이다
    const own: ThreadId[] = [];
    for await (const read of h.service.readFrom(0, { threadId: forkId })) {
      own.push(expectOk(read).threadId);
    }
    expect(new Set(own)).toEqual(new Set([forkId]));
    expectProjectionsRebuildable(h.store.db);
  });

  test("a fork of a fork walks the whole chain", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h, "origin");
    completeTurn(h, threadId);
    completeTurn(h, threadId);
    const first = await forkAt(h, threadId, 1);
    openForked(h, first);
    completeTurn(h, first);
    const second = await forkAt(h, first, 3);
    const items = branchItemsOf(h, second);
    expect(items.map((item) => item.itemId)).toEqual(
      branchItemsOf(h, first).map((item) => item.itemId),
    );
    expect(items).toHaveLength(4);
  });

  test("a fork of the current leaf inherits the whole active branch", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h, "origin");
    completeTurn(h, threadId);
    const forkId = h.ids.next("thr");
    expectOk(await h.service.threads.fork(threadId, undefined, forkId));
    expect(branchItemsOf(h, forkId).map((item) => item.itemId)).toEqual(
      branchItemsOf(h, threadId).map((item) => item.itemId),
    );
  });

  test("inherited items are not the fork's own: the fork cannot revert into them", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h, "origin");
    completeTurn(h, threadId);
    completeTurn(h, threadId);
    const forkId = await forkAt(h, threadId, 1);
    openForked(h, forkId);
    completeTurn(h, forkId);
    const inherited = itemAt(h, forkId, 0);
    const outcome = await h.service.threads.revert(forkId, inherited.itemId, "rv-inherited");
    expect(outcome.ok).toBe(false);
    // 되감기는 일어나지 않아 활성 가지가 그대로다
    expect(branchItemsOf(h, forkId)).toHaveLength(4);
  });
});
