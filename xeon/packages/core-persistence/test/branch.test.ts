import { describe, expect, test } from "bun:test";
import type { EventId } from "@xeon/contracts/conversation";
import { expectProjectionsRebuildable } from "../src/testing/index.ts";
import { branchItemsOf, completeTurn, itemAt, leafOfThread } from "./support/branching.ts";
import { expectOk, newThread, openHarness, startTurn, reopenHarness } from "./support/harness.ts";
import { recordingPoints } from "./support/points.ts";
import { TEST_HOLDER_A } from "./support/sqlite-store.ts";

const TOOL = { toolCallId: "tc1", toolName: "read", replay: "safe" } as const;

function kindsFrom(h: Awaited<ReturnType<typeof openHarness>>, threadId: string): string[] {
  return h.store.raw
    .query<{ kind: string }, [string]>("SELECT kind FROM events WHERE thread_id = ? ORDER BY seq")
    .all(threadId)
    .map((row) => row.kind);
}

describe("moveLeaf", () => {
  // spec plan leaf_move_keeps_old_branch
  test("leaf_move_keeps_old_branch: readFrom keeps the old branch, readBranch follows the new leaf", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    completeTurn(h, threadId);
    completeTurn(h, threadId);
    const items = branchItemsOf(h, threadId);
    expect(items.map((item) => item.kind)).toEqual(["user", "assistant", "user", "assistant"]);
    const target = itemAt(h, threadId, 1).eventId;
    const moved = expectOk(
      await h.service.threads.moveLeaf(threadId, target, { reason: "branch", requestKey: "mv1" }),
    );
    // 요약이 없으면 leaf는 target 자신이다
    expect(moved.leaf).toBe(target);
    expect(leafOfThread(h, threadId)).toBe(target);
    // 옛 가지는 readFrom에 그대로 있다
    const all: string[] = [];
    for await (const read of h.service.readFrom(0, { threadId })) all.push(expectOk(read).kind);
    expect(all.filter((kind) => kind === "item.recorded")).toHaveLength(4);
    // 활성 가지는 target까지다
    const branch: EventId[] = [];
    for await (const read of h.service.readBranch(threadId)) branch.push(expectOk(read).id);
    expect(branch.at(-1)).toBe(target);
    expect(branchItemsOf(h, threadId)).toHaveLength(2);
    // 새 이벤트는 target에 붙는다
    completeTurn(h, threadId);
    expect(branchItemsOf(h, threadId).map((item) => item.kind)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expectProjectionsRebuildable(h.store.db);
  });

  // spec plan branch_summary_committed_with_leaf_move
  test("branch_summary_committed_with_leaf_move: the summary is in the same commit, after leaf_moved", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    completeTurn(h, threadId);
    completeTurn(h, threadId);
    const oldLeaf = leafOfThread(h, threadId);
    const target = itemAt(h, threadId, 1).eventId;
    const before = kindsFrom(h, threadId).length;
    const moved = expectOk(
      await h.service.threads.moveLeaf(threadId, target, {
        reason: "branch",
        requestKey: "mv1",
        summary: { summary: "left branch", details: null, usage: null },
      }),
    );
    expect(kindsFrom(h, threadId).slice(before)).toEqual([
      "thread.leaf_moved",
      "thread.branch_summarized",
    ]);
    const summary = h.store.raw
      .query<{ id: string; parent_id: string; envelope: string }, []>(
        "SELECT id, parent_id, envelope FROM events WHERE kind = 'thread.branch_summarized'",
      )
      .get();
    expect(summary?.parent_id).toBe(target);
    expect(JSON.parse(summary?.envelope ?? "{}").payload).toMatchObject({
      fromEventId: oldLeaf,
      summary: "left branch",
    });
    expect(String(moved.leaf)).toBe(summary?.id ?? "");
    expectProjectionsRebuildable(h.store.db);
  });

  test("a retry with the same key replays; a target outside the thread is invalid", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    completeTurn(h, threadId);
    completeTurn(h, threadId);
    const target = itemAt(h, threadId, 1).eventId;
    const first = expectOk(
      await h.service.threads.moveLeaf(threadId, target, { reason: "restore", requestKey: "mv1" }),
    );
    const again = expectOk(
      await h.service.threads.moveLeaf(threadId, target, { reason: "restore", requestKey: "mv1" }),
    );
    expect(again.leaf).toBe(first.leaf);
    const stranger = h.ids.next("evt");
    expect(
      await h.service.threads.moveLeaf(threadId, stranger, { reason: "branch", requestKey: "mv2" }),
    ).toEqual({ ok: false, error: { kind: "invalid_target", reason: "item_not_found" } });
  });

  test("keys outside the commit key alphabet are hashed; reusing a key for another target is key_reused", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    completeTurn(h, threadId);
    completeTurn(h, threadId);
    const first = itemAt(h, threadId, 0).eventId;
    const second = itemAt(h, threadId, 1).eventId;
    const key = "이동 키 with spaces";
    expectOk(
      await h.service.threads.moveLeaf(threadId, first, { reason: "restore", requestKey: key }),
    );
    expect(
      await h.service.threads.moveLeaf(threadId, second, { reason: "restore", requestKey: key }),
    ).toEqual({ ok: false, error: { kind: "key_reused", requestKey: key } });
  });

  test("revert accepts a long non-ASCII request key", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    completeTurn(h, threadId);
    completeTurn(h, threadId);
    expectOk(
      await h.service.threads.revert(
        threadId,
        itemAt(h, threadId, 1).itemId,
        "되감기 키 ".repeat(40),
      ),
    );
  });

  test("an open turn refuses the move, a closed thread too, a non-owner is not_owner", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    completeTurn(h, threadId);
    const target = itemAt(h, threadId, 0).eventId;
    const turn = startTurn(h, threadId);
    expect(
      await h.service.threads.moveLeaf(threadId, target, { reason: "branch", requestKey: "mv1" }),
    ).toEqual({ ok: false, error: { kind: "turn_running", turnId: turn.turnId } });
    const observer = await reopenHarness(h);
    expectOk(observer.service.openForRead(threadId));
    expect(
      await observer.service.threads.moveLeaf(threadId, target, {
        reason: "branch",
        requestKey: "mv1",
      }),
    ).toEqual({ ok: false, error: { kind: "not_owner", threadId } });
  });

  test("session_before_tree cancels without a commit; a decision summary is adopted", async () => {
    const cancelled = recordingPoints({ cancel: { session_before_tree: "no" } });
    const h = await openHarness({ points: cancelled.points });
    const { threadId } = newThread(h);
    completeTurn(h, threadId);
    completeTurn(h, threadId);
    const target = itemAt(h, threadId, 1).eventId;
    const before = h.store.rowCounts();
    expect(
      await h.service.threads.moveLeaf(threadId, target, { reason: "branch", requestKey: "mv1" }),
    ).toEqual({
      ok: false,
      error: { kind: "cancelled_by_extension", point: "session_before_tree", reason: "no" },
    });
    expect(h.store.rowCounts()).toEqual(before);

    const summarized = recordingPoints({ treeSummary: { summary: "by extension" } });
    const g = await openHarness({ points: summarized.points });
    const thread = newThread(g);
    completeTurn(g, thread.threadId);
    completeTurn(g, thread.threadId);
    expectOk(
      await g.service.threads.moveLeaf(thread.threadId, itemAt(g, thread.threadId, 1).eventId, {
        reason: "branch",
        requestKey: "mv1",
      }),
    );
    expect(kindsFrom(g, thread.threadId).slice(-2)).toEqual([
      "thread.leaf_moved",
      "thread.branch_summarized",
    ]);
  });
});

describe("revert", () => {
  test("revert moves the leaf to the item's event with reason rewind", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    completeTurn(h, threadId);
    completeTurn(h, threadId);
    const keep = itemAt(h, threadId, 1);
    const reverted = expectOk(await h.service.threads.revert(threadId, keep.itemId, "rv1"));
    expect(reverted.leaf).toBe(keep.eventId);
    expect(branchItemsOf(h, threadId)).toHaveLength(2);
    const moved = h.store.raw
      .query<{ envelope: string }, []>(
        "SELECT envelope FROM events WHERE kind = 'thread.leaf_moved'",
      )
      .get();
    expect(JSON.parse(moved?.envelope ?? "{}").payload).toEqual({
      leafEventId: keep.eventId,
      reason: "rewind",
    });
    // 이미 그 leaf면 커밋하지 않는다
    const count = kindsFrom(h, threadId).length;
    expectOk(await h.service.threads.revert(threadId, keep.itemId, "rv2"));
    expect(kindsFrom(h, threadId)).toHaveLength(count);
  });

  // spec plan revert_rejects_target_inside_turn
  test("revert_rejects_target_inside_turn: a toolCall assistant item and its result are not valid targets", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    completeTurn(h, threadId, [TOOL]);
    const items = branchItemsOf(h, threadId);
    expect(items.map((item) => item.kind)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
    ]);
    const toolUse = itemAt(h, threadId, 1);
    expect(await h.service.threads.revert(threadId, toolUse.itemId, "rv1")).toEqual({
      ok: false,
      error: { kind: "invalid_target", reason: "inside_turn" },
    });
    const result = itemAt(h, threadId, 2);
    expect(await h.service.threads.revert(threadId, result.itemId, "rv2")).toEqual({
      ok: false,
      error: { kind: "invalid_target", reason: "inside_turn" },
    });
    // 마지막 assistant item과 user item은 된다
    expectOk(await h.service.threads.revert(threadId, itemAt(h, threadId, 0).itemId, "rv3"));
  });

  test("unknown item, an item on an abandoned branch, a running turn, an open tool call", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    completeTurn(h, threadId);
    completeTurn(h, threadId);
    const unknown = h.ids.next("itm");
    expect(await h.service.threads.revert(threadId, unknown, "rv1")).toEqual({
      ok: false,
      error: { kind: "invalid_target", reason: "item_not_found" },
    });
    const abandoned = itemAt(h, threadId, 3);
    expectOk(await h.service.threads.revert(threadId, itemAt(h, threadId, 1).itemId, "rv2"));
    expect(await h.service.threads.revert(threadId, abandoned.itemId, "rv3")).toEqual({
      ok: false,
      error: { kind: "invalid_target", reason: "not_on_branch" },
    });
    const turn = startTurn(h, threadId);
    expect(await h.service.threads.revert(threadId, itemAt(h, threadId, 0).itemId, "rv4")).toEqual({
      ok: false,
      error: { kind: "turn_running", turnId: turn.turnId },
    });
  });

  test("session_before_tree refuses a revert and session_tree fires after a commit", async () => {
    const refused = recordingPoints({ cancel: { session_before_tree: "keep" } });
    const h = await openHarness({ points: refused.points });
    const { threadId } = newThread(h);
    completeTurn(h, threadId);
    completeTurn(h, threadId);
    const result = await h.service.threads.revert(threadId, itemAt(h, threadId, 1).itemId, "rv1");
    expect(result.ok).toBe(false);
    expect(
      refused.calls.map((call) => call.point).filter((point) => point !== "session_start"),
    ).toEqual(["session_before_tree"]);
  });
});

describe("fork", () => {
  // spec plan fork_creates_new_thread_with_forked_from
  test("fork_creates_new_thread_with_forked_from: the origin is untouched", async () => {
    const recording = recordingPoints();
    const h = await openHarness({ points: recording.points });
    const { threadId } = newThread(h, "origin");
    completeTurn(h, threadId);
    completeTurn(h, threadId);
    const at = itemAt(h, threadId, 1);
    const originEvents = kindsFrom(h, threadId).length;
    const newId = h.ids.next("thr");
    const forked = expectOk(await h.service.threads.fork(threadId, at.itemId, newId));
    expect(forked).toMatchObject({ threadId: newId, replayed: false, token: null });
    expect(kindsFrom(h, threadId)).toHaveLength(originEvents);
    const row = expectOk(h.service.query.thread(newId));
    expect(row).toMatchObject({
      title: "origin",
      forkedFrom: { threadId, eventId: at.eventId },
    });
    expect(kindsFrom(h, newId)).toEqual(["thread.started"]);
    const forkCalls = recording.calls.filter(
      (call) => call.threadId === newId || call.point === "session_before_fork",
    );
    expect(forkCalls.map((call) => call.point)).toEqual(["session_before_fork", "session_start"]);
    expect(forkCalls[1]?.payload).toEqual({
      reason: "fork",
      threadId: newId,
      previousThreadId: threadId,
    });
    expectProjectionsRebuildable(h.store.db);
  });

  test("without an item the fork starts at the current leaf; the workspace is copied", async () => {
    const h = await openHarness();
    const threadId = h.ids.next("thr");
    expectOk(h.service.threads.create({ threadId, title: "w", workspace: "/proj" }));
    const token = h.store.leases.acquire(`session:${threadId}`, TEST_HOLDER_A);
    if (!token.ok) throw new Error("lease");
    expectOk(h.service.openForWrite(threadId, token.value));
    completeTurn(h, threadId);
    const newId = h.ids.next("thr");
    expectOk(await h.service.threads.fork(threadId, undefined, newId));
    expect(expectOk(h.service.query.thread(newId))).toMatchObject({
      workspace: "/proj",
      forkedFrom: { threadId, eventId: leafOfThread(h, threadId) },
    });
  });

  test("an extension refusing session_before_fork leaves no new thread", async () => {
    const recording = recordingPoints({ cancel: { session_before_fork: "nope" } });
    const h = await openHarness({ points: recording.points });
    const { threadId } = newThread(h);
    completeTurn(h, threadId);
    const before = h.store.rowCounts();
    expect(
      await h.service.threads.fork(threadId, itemAt(h, threadId, 0).itemId, h.ids.next("thr")),
    ).toEqual({
      ok: false,
      error: { kind: "cancelled_by_extension", point: "session_before_fork", reason: "nope" },
    });
    expect(h.store.rowCounts()).toEqual(before);
  });

  test("an unknown item, an abandoned-branch item and an unknown thread are refused", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    completeTurn(h, threadId);
    completeTurn(h, threadId);
    const abandoned = itemAt(h, threadId, 3);
    expectOk(await h.service.threads.revert(threadId, itemAt(h, threadId, 1).itemId, "rv1"));
    expect(await h.service.threads.fork(threadId, abandoned.itemId, h.ids.next("thr"))).toEqual({
      ok: false,
      error: { kind: "invalid_target", reason: "not_on_branch" },
    });
    expect(await h.service.threads.fork(threadId, h.ids.next("itm"), h.ids.next("thr"))).toEqual({
      ok: false,
      error: { kind: "invalid_target", reason: "item_not_found" },
    });
    const ghost = h.ids.next("thr");
    expect(await h.service.threads.fork(ghost, undefined, h.ids.next("thr"))).toEqual({
      ok: false,
      error: { kind: "thread_not_found", threadId: ghost },
    });
  });

  test("an observer of a locked thread can still fork it (lock_conflict_offers_delegate_observe_fork)", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    completeTurn(h, threadId);
    const observer = await reopenHarness(h);
    expect(expectOk(observer.service.openForRead(threadId)).role).toBe("observer");
    const newId = observer.ids.next("thr");
    expectOk(await observer.service.threads.fork(threadId, itemAt(h, threadId, 0).itemId, newId));
    expect(expectOk(observer.service.query.thread(newId))?.forkedFrom?.threadId).toBe(threadId);
  });
});

describe("prepareSwitch", () => {
  test("session_before_switch fires without a commit and its refusal is cancelled_by_extension", async () => {
    const allowed = recordingPoints();
    const h = await openHarness({ points: allowed.points });
    const { threadId } = newThread(h);
    const before = h.store.rowCounts();
    expectOk(await h.service.threads.prepareSwitch(threadId, null));
    expect(allowed.calls.at(-1)).toMatchObject({
      point: "session_before_switch",
      payload: { reason: "new" },
    });
    const target = h.ids.next("thr");
    expectOk(await h.service.threads.prepareSwitch(threadId, target));
    expect(allowed.calls.at(-1)?.payload).toEqual({ reason: "resume", targetThreadId: target });
    expect(h.store.rowCounts()).toEqual(before);

    const refused = recordingPoints({ cancel: { session_before_switch: "busy" } });
    const g = await openHarness({ points: refused.points });
    const other = newThread(g);
    expect(await g.service.threads.prepareSwitch(other.threadId, null)).toEqual({
      ok: false,
      error: { kind: "cancelled_by_extension", point: "session_before_switch", reason: "busy" },
    });
  });
});

describe("active branch queries", () => {
  test("latestEvent follows the active branch only when asked", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    completeTurn(h, threadId);
    completeTurn(h, threadId);
    expectOk(await h.service.threads.revert(threadId, itemAt(h, threadId, 1).itemId, "rv1"));
    const anywhere = expectOk(h.service.query.latestEvent(threadId, "turn.completed"));
    const onBranch = expectOk(
      h.service.query.latestEvent(threadId, "turn.completed", undefined, { onActiveBranch: true }),
    );
    expect(anywhere?.seq).toBeGreaterThan(onBranch?.seq ?? 0);
    const itemIds = branchItemsOf(h, threadId).map((item) => item.itemId);
    const firstItem = itemIds[0];
    expect(
      firstItem === undefined
        ? undefined
        : expectOk(h.service.query.itemEvent(threadId, firstItem)),
    ).toBe(itemAt(h, threadId, 0).eventId);
    const matched = expectOk(
      h.service.query.latestEvent(
        threadId,
        "thread.leaf_moved",
        { pointer: "/reason", equals: "rewind" },
        { onActiveBranch: false },
      ),
    );
    expect(matched?.kind).toBe("thread.leaf_moved");
    const afterFirst = expectOk(
      h.service.query.branchItems(threadId, {
        afterItemId: itemAt(h, threadId, 0).itemId,
        limit: 1,
      }),
    );
    expect(afterFirst.map((item) => item.kind)).toEqual(["assistant"]);
  });
});
