import { describe, expect, test } from "bun:test";
import type { ThreadId } from "@xeon/contracts/conversation";
import { threadSummaryOf } from "@xeon/contracts/wire";
import { expectProjectionsRebuildable } from "../src/testing/index.ts";
import { branchItemsOf, completeTurn, itemAt } from "./support/branching.ts";
import { expectOk, newThread, openHarness, reopenHarness, startTurn } from "./support/harness.ts";
import { recordingPoints } from "./support/points.ts";
import { TEST_HOLDER_A } from "./support/sqlite-store.ts";

function titles(page: { threads: readonly { title: string | null }[] }): (string | null)[] {
  return page.threads.map((thread) => thread.title);
}

function countOf(h: Awaited<ReturnType<typeof openHarness>>, sql: string): number {
  return h.store.raw.query<{ n: number }, []>(sql).get()?.n ?? -1;
}

describe("threads.list", () => {
  test("orders by updatedAt then id, filters workspace and closed, and pages with a cursor", async () => {
    const h = await openHarness();
    const mk = (title: string, workspace?: string): ThreadId => {
      const threadId = h.ids.next("thr");
      expectOk(
        h.service.threads.create({
          threadId,
          title,
          ...(workspace === undefined ? {} : { workspace }),
        }),
      );
      h.clock.advance(1000);
      return threadId;
    };
    mk("a", "/w1");
    const b = mk("b", "/w2");
    mk("c", "/w1");
    expect(titles(h.service.threads.list({}))).toEqual(["c", "b", "a"]);
    expect(titles(h.service.threads.list({ workspace: "/w1" }))).toEqual(["c", "a"]);
    const first = h.service.threads.list({ limit: 2 });
    expect(titles(first)).toEqual(["c", "b"]);
    expect(first.nextCursor).not.toBeNull();
    const second = h.service.threads.list({
      limit: 2,
      ...(first.nextCursor === null ? {} : { cursor: first.nextCursor }),
    });
    expect(titles(second)).toEqual(["a"]);
    expect(second.nextCursor).toBeNull();
    expect(h.service.threads.list({ cursor: "garbage" }).threads).toEqual([]);

    // 닫힌 thread는 기본에서 빠진다
    const token = h.store.leases.acquire(`session:${b}`, TEST_HOLDER_A);
    if (!token.ok) throw new Error("lease");
    expectOk(h.service.openForWrite(b, token.value));
    expectOk(h.service.threads.close(b, "done"));
    expect(titles(h.service.threads.list({}))).toEqual(["c", "a"]);
    expect(titles(h.service.threads.list({ includeClosed: true }))).toEqual(["b", "c", "a"]);
  });

  test("rows carry the marker and the counts, and map through threadSummaryOf", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h, "listed");
    startTurn(h, threadId);
    const page = h.service.threads.list({});
    const row = page.threads[0];
    expect(row?.marker).not.toBeNull();
    expect(row?.workspace).toBeNull();
    const summary = row === undefined ? undefined : threadSummaryOf(row);
    expect(summary?.ok).toBe(true);
    if (summary?.ok === true) {
      expect(summary.value.resumable?.turnId).toBe(row?.marker?.turnId);
    }
  });
});

describe("threads.close", () => {
  test("close commits thread.closed once, refuses a running turn and a second close", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    expect(h.service.threads.close(threadId, "done")).toEqual({
      ok: false,
      error: { kind: "turn_running", turnId: turn.turnId },
    });
    const idle = newThread(h, "idle");
    expectOk(h.service.threads.close(idle.threadId, "bye"));
    expect(countOf(h, "SELECT COUNT(*) AS n FROM events WHERE kind = 'thread.closed'")).toBe(1);
    // 두 번째 종결은 처음 결과를 돌려주고 이벤트를 더하지 않는다
    expectOk(h.service.threads.close(idle.threadId, "again"));
    expect(countOf(h, "SELECT COUNT(*) AS n FROM events WHERE kind = 'thread.closed'")).toBe(1);
    expect(expectOk(h.service.query.thread(idle.threadId))).toMatchObject({ status: "closed" });
  });

  test("only the write owner may close, remove or retitle", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    const other = await reopenHarness(h);
    expectOk(other.service.openForRead(threadId));
    for (const result of [
      other.service.threads.close(threadId, null),
      other.service.threads.remove(threadId),
      other.service.threads.setTitle(threadId, "x", "k1"),
    ]) {
      expect(result).toEqual({ ok: false, error: { kind: "not_owner", threadId } });
    }
  });
});

describe("threads.remove", () => {
  // spec plan remove_deletes_thread_rows_and_blocks_other_deletes
  test("remove_deletes_thread_rows_and_blocks_other_deletes", async () => {
    const h = await openHarness();
    const keep = newThread(h, "keep");
    completeTurn(h, keep.threadId);
    const gone = newThread(h, "gone");
    completeTurn(h, gone.threadId);
    const headBefore = expectOk(h.service.feed.headSeq());
    expectOk(h.service.threads.remove(gone.threadId));
    for (const table of ["events", "requests", "p_threads", "p_items", "p_turns", "p_effects"]) {
      expect(
        countOf(h, `SELECT COUNT(*) AS n FROM ${table} WHERE thread_id = '${gone.threadId}'`),
      ).toBe(0);
    }
    expect(
      countOf(h, `SELECT COUNT(*) AS n FROM events WHERE thread_id = '${keep.threadId}'`),
    ).toBeGreaterThan(0);
    expect(countOf(h, "SELECT COUNT(*) AS n FROM thread_delete_guard")).toBe(0);
    // 지운 seq는 다시 쓰지 않는다
    expect(expectOk(h.service.feed.headSeq())).toBe(headBefore);
    completeTurn(h, keep.threadId);
    expect(expectOk(h.service.feed.headSeq())).toBeGreaterThan(headBefore);
    // 열린 상태는 놓였다: 지운 thread에 커밋하면 소유가 없다
    expect(h.service.threads.close(gone.threadId, null).ok).toBe(false);
    // 삭제 경로 밖의 삭제는 트리거가 막는다
    expect(() =>
      h.store.raw.run("DELETE FROM events WHERE thread_id = ?", [keep.threadId]),
    ).toThrow("events are immutable");
    expectProjectionsRebuildable(h.store.db);
  });

  test("a thread that other threads forked from is has_forks", async () => {
    const h = await openHarness();
    const origin = newThread(h, "origin");
    completeTurn(h, origin.threadId);
    const forkId = h.ids.next("thr");
    expectOk(
      await h.service.threads.fork(origin.threadId, itemAt(h, origin.threadId, 0).itemId, forkId),
    );
    expect(h.service.threads.remove(origin.threadId)).toEqual({
      ok: false,
      error: { kind: "has_forks", forks: [forkId] },
    });
    expect(
      countOf(h, `SELECT COUNT(*) AS n FROM events WHERE thread_id = '${origin.threadId}'`),
    ).toBeGreaterThan(0);
  });
});

describe("threads.setTitle", () => {
  // spec plan set_title_writes_thread_updated_and_fires_info_changed
  test("set_title_writes_thread_updated_and_fires_info_changed", async () => {
    const recording = recordingPoints();
    const h = await openHarness({ points: recording.points });
    const { threadId } = newThread(h, "before");
    expectOk(h.service.threads.setTitle(threadId, "after", "t1"));
    expect(expectOk(h.service.query.thread(threadId))?.title).toBe("after");
    await Promise.resolve();
    const fired = recording.calls.filter((call) => call.point === "session.info.after");
    expect(fired.map((call) => call.payload)).toEqual([{ threadId, name: "after" }]);
    // 같은 키 재시도는 다시 알리지 않는다
    expectOk(h.service.threads.setTitle(threadId, "after", "t1"));
    await Promise.resolve();
    expect(recording.calls.filter((call) => call.point === "session.info.after")).toHaveLength(1);
    expectOk(h.service.threads.setTitle(threadId, null, "t2"));
    expect(expectOk(h.service.query.thread(threadId))?.title).toBeNull();
    expect(branchItemsOf(h, threadId)).toEqual([]);
  });

  // U-13: 밖에서 온 requestKey는 commitKeyPart를 거쳐 커밋 키가 된다
  test("a request key with spaces, non-ASCII or a long length still commits and replays", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h, "before");
    for (const key of ["has space", "한글 키", "x".repeat(400), "h_looks-like-a-hash"]) {
      expectOk(h.service.threads.setTitle(threadId, `t-${key.length}`, key));
      expectOk(h.service.threads.setTitle(threadId, `t-${key.length}`, key));
    }
    expect(expectOk(h.service.query.thread(threadId))?.title).toBe("t-19");
  });

  test("the same key with another title is a typed key_reused error, not a Bug", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h, "before");
    expectOk(h.service.threads.setTitle(threadId, "one", "same"));
    expect(h.service.threads.setTitle(threadId, "two", "same")).toEqual({
      ok: false,
      error: { kind: "key_reused", requestKey: "same" },
    });
  });
});
