import { describe, expect, test } from "bun:test";
import { expectProjectionsRebuildable } from "../src/testing/index.ts";
import { expectOk, newThread, openHarness, reopenHarness, startTurn } from "./support/harness.ts";
import { TEST_HOLDER_A, TEST_HOLDER_B } from "./support/sqlite-store.ts";

function startedEvents(h: ReturnType<typeof openHarness>): number {
  return (
    h.store.raw
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM events WHERE kind = 'thread.started'")
      .get()?.n ?? -1
  );
}

describe("threads.create", () => {
  test("thread.started is the first event: parent null, key thread:<id>:start, title kept", () => {
    const h = openHarness();
    const threadId = h.ids.next("thr");
    const created = expectOk(h.service.threads.create({ threadId, title: "plan" }));
    expect(created).toEqual({ threadId, headSeq: 1, replayed: false, token: null });
    const row = h.store.raw
      .query<{ parent_id: string | null; request_id: string; kind: string }, []>(
        "SELECT parent_id, request_id, kind FROM events",
      )
      .get();
    expect(row).toEqual({
      parent_id: null,
      request_id: `thread:${threadId}:start`,
      kind: "thread.started",
    });
    expect(h.service.query.thread(threadId)).toMatchObject({
      title: "plan",
      status: "idle",
      forkedFrom: null,
    });
  });

  test("create of the same thread id again replays the first result for the owner", () => {
    const h = openHarness();
    const { threadId } = newThread(h, "a");
    const again = expectOk(h.service.threads.create({ threadId, title: "a" }));
    expect(again.replayed).toBe(true);
    expect(startedEvents(h)).toBe(1);
    // 소유 증표가 없는 쪽은 이미 있는 thread에 쓸 수 없다. 멱등 재시도는 creationKey로 한다
    const stranger = reopenHarness(h);
    const refused = stranger.service.threads.create({ threadId, title: "a" });
    expect(refused).toEqual({ ok: false, error: { kind: "ownership_lost", threadId } });
  });

  // spec §9.25
  test("creation_key_is_idempotent_across_thread_ids", () => {
    const h = openHarness();
    const first = expectOk(
      h.service.threads.create({
        threadId: h.ids.next("thr"),
        creationKey: "timer:t1:2026-01-05:create",
      }),
    );
    const second = expectOk(
      h.service.threads.create({
        threadId: h.ids.next("thr"),
        creationKey: "timer:t1:2026-01-05:create",
      }),
    );
    expect(startedEvents(h)).toBe(1);
    expect(second.replayed).toBe(true);
    expect(second.threadId).toBe(first.threadId);
    expect(second.headSeq).toBe(first.headSeq);
    const keys = h.store.raw
      .query<{ key: string; thread_id: string }, []>(
        "SELECT key, thread_id FROM thread_creation_keys",
      )
      .all();
    expect(keys).toEqual([{ key: "timer:t1:2026-01-05:create", thread_id: first.threadId }]);
    // 다른 키는 다른 thread다
    const third = expectOk(
      h.service.threads.create({
        threadId: h.ids.next("thr"),
        creationKey: "timer:t2:2026-01-05:create",
      }),
    );
    expect(third.replayed).toBe(false);
    expect(startedEvents(h)).toBe(2);
    expectProjectionsRebuildable(h.store.db);
  });

  test("the creation key survives a restart (a new service instance)", () => {
    const h = openHarness();
    const first = expectOk(
      h.service.threads.create({ threadId: h.ids.next("thr"), creationKey: "k:1" }),
    );
    const restarted = reopenHarness(h);
    const again = expectOk(
      restarted.service.threads.create({ threadId: restarted.ids.next("thr"), creationKey: "k:1" }),
    );
    expect(again).toMatchObject({ threadId: first.threadId, replayed: true });
    expect(startedEvents(restarted)).toBe(1);
  });

  test("a creation key and thread.started are one transaction: a failed create leaves no key", () => {
    const h = openHarness();
    const threadId = h.ids.next("thr");
    // title은 200자 상한이라 payload 검사가 Bug로 롤백한다
    expect(() =>
      h.service.threads.create({ threadId, title: "x".repeat(201), creationKey: "k:fail" }),
    ).toThrow("store.schema_invalid");
    expect(h.store.rowCounts()["thread_creation_keys"]).toBe(0);
    expect(startedEvents(h)).toBe(0);
  });

  test("a creationKey outside 1..200 characters is a Bug", () => {
    const h = openHarness();
    expect(() =>
      h.service.threads.create({ threadId: h.ids.next("thr"), creationKey: "" }),
    ).toThrow("creationKey");
  });

  test("create is the only commit that may skip the ownership check, and only for thread.started", () => {
    const h = openHarness();
    // 임대 없이 만들 수 있다. 하지만 만든 뒤 같은 thread에 쓰려면 소유 증표가 있어야 한다
    const threadId = h.ids.next("thr");
    expectOk(h.service.threads.create({ threadId }));
    expect(() => startTurn(h, threadId)).toThrow("ownership_lost");
  });
});

describe("child threads (inheritOwnerFrom)", () => {
  test("acquires session:<child> for the same holder, keeps the token and writes with it", () => {
    const h = openHarness();
    const parent = newThread(h, "parent");
    const childId = h.ids.next("thr");
    const created = expectOk(
      h.service.threads.create({ threadId: childId, inheritOwnerFrom: parent.token }),
    );
    expect(created.token).toEqual({
      resource: `session:${childId}`,
      holderId: TEST_HOLDER_A.holderId,
      epoch: 1,
    });
    // 부모와 같은 holder가 자식 임대를 쥐고 있어 바로 쓸 수 있다
    expect(startTurn(h, childId).threadId).toBe(childId);
    expect(h.store.leases.inspect(`session:${childId}`)).toMatchObject({ ok: true });
    expectProjectionsRebuildable(h.store.db);
  });

  test("release gives the self-acquired lease back; a host-supplied lease is left to the host", async () => {
    const h = openHarness();
    const parent = newThread(h, "parent");
    const childId = h.ids.next("thr");
    const created = expectOk(
      h.service.threads.create({ threadId: childId, inheritOwnerFrom: parent.token }),
    );
    await h.service.release(childId, "quit");
    expect(expectOk(h.store.leases.inspect(`session:${childId}`))).toBeNull();
    await h.service.release(parent.threadId, "quit");
    expect(expectOk(h.store.leases.inspect(parent.token.resource))).not.toBeNull();
    expect(created.token).not.toBeNull();
  });

  test("the child's heartbeat loss drops the thread and tells the caller", () => {
    const lost: string[] = [];
    const h = openHarness({ onLeaseLost: (threadId) => lost.push(threadId) });
    const parent = newThread(h, "parent");
    const childId = h.ids.next("thr");
    expectOk(h.service.threads.create({ threadId: childId, inheritOwnerFrom: parent.token }));
    h.store.leases.loseLease(`session:${childId}`);
    expect(lost).toEqual([childId]);
    expect(() => startTurn(h, childId)).toThrow("ownership_lost");
  });

  test("a failed child create gives the lease back", () => {
    const h = openHarness();
    const parent = newThread(h, "parent");
    const childId = h.ids.next("thr");
    expect(() =>
      h.service.threads.create({
        threadId: childId,
        title: "x".repeat(201),
        inheritOwnerFrom: parent.token,
      }),
    ).toThrow("store.schema_invalid");
    expect(expectOk(h.store.leases.inspect(`session:${childId}`))).toBeNull();
    // 반납했으므로 다시 얻으면 epoch가 오른다(펜싱 토큰의 단조성)
    const retried = expectOk(
      h.service.threads.create({ threadId: childId, inheritOwnerFrom: parent.token }),
    );
    expect(retried.token?.epoch).toBe(2);
  });

  test("a token of another holder is a Bug", () => {
    const h = openHarness();
    const parent = newThread(h, "parent");
    const foreign = { ...parent.token, holderId: TEST_HOLDER_B.holderId };
    expect(() =>
      h.service.threads.create({ threadId: h.ids.next("thr"), inheritOwnerFrom: foreign }),
    ).toThrow("different holder");
  });

  test("inheritOwnerFrom without an engine holder is a Bug", () => {
    const base = openHarness();
    const parent = newThread(base, "parent");
    const noHolder = reopenHarness(base, { withHolder: false });
    expect(() =>
      noHolder.service.threads.create({
        threadId: noHolder.ids.next("thr"),
        inheritOwnerFrom: parent.token,
      }),
    ).toThrow("LeaseHolder");
  });
});

describe("M2 lifecycle members", () => {
  test("they say so instead of pretending", async () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    expect(() => h.service.threads.list({})).toThrow("session.not_implemented");
    expect(() => h.service.threads.remove(threadId)).toThrow("session.not_implemented");
    expect(() => h.service.threads.setTitle(threadId, "x", "k")).toThrow("session.not_implemented");
    let rejected = "";
    await h.service.threads
      .fork(threadId, undefined, h.ids.next("thr"))
      .catch((caught: unknown) => {
        rejected = caught instanceof Error ? caught.message : "";
      });
    expect(rejected).toContain("session.not_implemented");
  });
});
