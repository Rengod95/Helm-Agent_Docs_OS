import { describe, expect, test } from "bun:test";
import type { CommitPlan, TxView } from "@xeon/contracts/records";
import { TEST_HOLDER_B } from "./support/sqlite-store.ts";
import { CORE_PROJECTOR_VERSION } from "../src/index.ts";
import { checkProjectionsRebuildable, expectProjectionsRebuildable } from "../src/testing/index.ts";
import {
  commitExec,
  commitOrThrow,
  commitResult,
  draftOf,
  endStep,
  endTurn,
  expectOk,
  fullStep,
  newThread,
  openHarness,
  reopenHarness,
  startTurn,
  stepUntilIntents,
} from "./support/harness.ts";

function threadRow(h: ReturnType<typeof openHarness>, threadId: string) {
  return h.store.raw
    .query<Record<string, string | number | null>, [string]>(
      "SELECT * FROM p_threads WHERE thread_id = ?",
    )
    .get(threadId);
}

describe("p_threads", () => {
  test("thread.started creates an idle row whose head and leaf follow every event", () => {
    const h = openHarness();
    const { threadId } = newThread(h, "hello");
    const first = threadRow(h, threadId);
    expect(first).toMatchObject({
      title: "hello",
      status: "idle",
      first_seq: 1,
      head_seq: 1,
      forked_from_thread: null,
      open_turn_id: null,
      running_since: null,
      resume_attempts: 0,
    });
    const turn = startTurn(h, threadId);
    const afterStart = threadRow(h, threadId);
    expect(afterStart?.["head_seq"]).toBe(3);
    expect(afterStart?.["status"]).toBe("running");
    expect(afterStart?.["open_turn_id"]).toBe(turn.turnId);
    expect(afterStart?.["running_since"]).toBe(h.clock.now());
    const lastEvent = h.store.raw
      .query<{ id: string }, []>("SELECT id FROM events ORDER BY seq DESC LIMIT 1")
      .get();
    expect(afterStart?.["leaf_event_id"]).toBe(lastEvent?.id ?? "");
  });

  test("the recovery marker is set by turn.started and cleared by turn.completed", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    expect(expectOk(h.service.query.thread(threadId))?.marker).toBeNull();
    const turn = startTurn(h, threadId);
    expect(expectOk(h.service.query.thread(threadId))?.marker).toEqual({
      turnId: turn.turnId,
      runningSince: h.clock.now(),
      resumeAttempts: 0,
    });
    endTurn(h, turn, "interrupted");
    const done = expectOk(h.service.query.thread(threadId));
    expect(done?.marker).toBeNull();
    expect(done?.status).toBe("idle");
    expect(done?.updatedAt).toBe(h.clock.now());
  });

  test("thread.closed marks the thread closed and keeps the reason", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    // thread.closed는 core.persistence 소유라 threads.close(M2)로 낸다. 여기서는 투영만 본다
    const row = h.store.raw
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM p_threads WHERE status = 'closed'")
      .get();
    expect(row?.n).toBe(0);
    expect(() => h.service.threads.close(threadId, "done")).toThrow("not_implemented");
  });
});

describe("p_turns", () => {
  test("turn.started and turn.completed drive status, seqs and step_count", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId, { requestId: "r1" });
    const running = expectOk(h.service.query.turn(threadId, turn.turnId));
    expect(running).toEqual({
      turnId: turn.turnId,
      status: "running",
      abortRequested: false,
      stepCount: 0,
    });
    fullStep(h, turn, 0, []);
    expect(expectOk(h.service.query.openTurn(threadId))?.stepCount).toBe(1);
    endTurn(h, turn, "failed");
    expect(expectOk(h.service.query.turn(threadId, turn.turnId))?.status).toBe("failed");
    expect(expectOk(h.service.query.openTurn(threadId))).toBeUndefined();
    const row = h.store.raw
      .query<{ started_seq: number; completed_seq: number; request_id: string }, [string]>(
        "SELECT started_seq, completed_seq, request_id FROM p_turns WHERE turn_id = ?",
      )
      .get(turn.turnId);
    expect(row?.request_id).toBe("r1");
    expect(row?.completed_seq).toBeGreaterThan(row?.started_seq ?? 0);
  });

  // spec §9.26
  test("turnByRequestId separates scope turns from scope-less turns", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const plain = startTurn(h, threadId, { requestId: "r" });
    const scoped = startTurn(h, threadId, { requestId: "r", scopeId: "helm/review" });
    let seen: TxView | undefined;
    commitResult(h, threadId, "probe:1", (view) => {
      seen = view;
      return { kind: "reject", code: "probe", detail: null };
    });
    expect(seen?.turnByRequestId(threadId, null, "r")?.turnId).toBe(plain.turnId);
    expect(seen?.turnByRequestId(threadId, "helm/review", "r")?.turnId).toBe(scoped.turnId);
    expect(seen?.turnByRequestId(threadId, "other", "r")).toBeUndefined();
    expect(expectOk(h.service.query.turnByRequestId(threadId, null, "r"))?.turnId).toBe(
      plain.turnId,
    );
    expect(expectOk(h.service.query.turnByRequestId(threadId, "helm/review", "r"))?.turnId).toBe(
      scoped.turnId,
    );
  });

  test("a duplicate (thread, scope, requestId) turn breaks the projection and rolls the commit back", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    startTurn(h, threadId, { requestId: "dup" });
    const before = h.store.tableHashes();
    expect(() => startTurn(h, threadId, { requestId: "dup" })).toThrow("store.projection_failed");
    expect(h.store.tableHashes()).toEqual(before);
  });

  test("turn.abort_requested sets abortRequested once", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    for (const key of ["abort:one", "abort:two"]) {
      commitOrThrow(h, threadId, key, () => ({
        kind: "append",
        drafts: [
          draftOf(
            h,
            h.loop,
            "turn.abort_requested",
            threadId,
            { turnId: turn.turnId, stepId: null },
            {
              reason: { code: "user", message: null },
              cause: "direct",
              background: false,
            },
          ),
        ],
        checkpoint: null,
      }));
    }
    expect(expectOk(h.service.query.turn(threadId, turn.turnId))?.abortRequested).toBe(true);
    const seqs = h.store.raw
      .query<{ abort_requested_seq: number }, [string]>(
        "SELECT abort_requested_seq FROM p_turns WHERE turn_id = ?",
      )
      .get(turn.turnId);
    const firstAbort = h.store.raw
      .query<{ seq: number }, []>(
        "SELECT MIN(seq) AS seq FROM events WHERE kind = 'turn.abort_requested'",
      )
      .get();
    expect(seqs?.abort_requested_seq).toBe(firstAbort?.seq ?? -1);
  });
});

describe("p_effects and p_inputs", () => {
  test("effect rows follow intent, exec and result; open effects are the ones without a result", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    const stepId = h.ids.next("stp");
    const progress = stepUntilIntents(h, turn, 0, stepId, [
      { toolCallId: "tc1", toolName: "read", replay: "safe" },
      { toolCallId: "tc2", toolName: "bash", replay: "unsafe" },
    ]);
    expect(
      expectOk(h.service.query.openEffects(threadId)).map((effect) => effect.toolCallId),
    ).toEqual(["tc1", "tc2"]);
    const [first] = progress.effects;
    if (first === undefined) throw new Error("missing effect");
    commitExec(h, turn, stepId, first.effectId, "tc1");
    commitExec(h, turn, stepId, first.effectId, "tc1", 1);
    const open = expectOk(h.service.query.openEffects(threadId))[0];
    expect(open).toMatchObject({ toolCallId: "tc1", replay: "safe", execCount: 2, result: null });
    endStep(h, turn, 0, stepId, "tools");
    expectProjectionsRebuildable(h.store.db);
  });

  test("input.queued, placed and withdrawn keep the queue in seq order", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const queue = (key: string, requestId: string, scopeId: string | null) =>
      commitOrThrow(h, threadId, key, () => ({
        kind: "append",
        drafts: [
          draftOf(
            h,
            h.tasks,
            "input.queued",
            threadId,
            { turnId: null, stepId: null },
            {
              mode: "next",
              item: { kind: "user", content: "hello" },
              requestId,
              source:
                scopeId === null
                  ? { type: "user", via: "interactive" }
                  : { type: "extension", scopeId },
            },
          ),
        ],
        checkpoint: null,
      }));
    const a = queue("in:user:r1", "r1", null);
    const b = queue("in:helm:review:r2", "r2", "helm/review");
    const queued = expectOk(h.service.query.queuedInputs(threadId));
    expect(queued.map((input) => input.sourceKey)).toEqual(["user", "helm:review"]);
    expect(queued.map((input) => input.seq)).toEqual([a.firstSeq, b.firstSeq]);
    let probe: TxView | undefined;
    commitResult(h, threadId, "probe:in", (view) => {
      probe = view;
      return { kind: "reject", code: "probe", detail: null };
    });
    expect(probe?.inputByRequestId(threadId, "helm:review", "r2")?.inputId).toBe(b.eventIds[0]);
    // 하나는 turn에 놓이고 하나는 거두어진다
    const turn = startTurn(h, threadId);
    commitOrThrow(h, threadId, "place:1", () => ({
      kind: "append",
      drafts: [
        draftOf(
          h,
          h.tasks,
          "input.placed",
          threadId,
          { turnId: turn.turnId, stepId: null },
          {
            inputId: a.eventIds[0],
            itemId: h.ids.next("itm"),
          },
        ),
        draftOf(
          h,
          h.tasks,
          "input.withdrawn",
          threadId,
          { turnId: turn.turnId, stepId: null },
          {
            inputId: b.eventIds[0],
            reason: "user",
          },
        ),
      ],
      checkpoint: null,
    }));
    expect(expectOk(h.service.query.queuedInputs(threadId))).toEqual([]);
    expect(expectOk(h.service.query.thread(threadId))?.queuedInputs).toBe(0);
    expectProjectionsRebuildable(h.store.db);
  });
});

describe("rebuild", () => {
  // spec §9.10
  test("projection_rebuild_equals_live", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    fullStep(h, turn, 0, [
      { toolCallId: "tc1", toolName: "read", replay: "safe" },
      { toolCallId: "tc2", toolName: "ls", replay: "safe" },
    ]);
    fullStep(h, turn, 1, []);
    endTurn(h, turn);
    const other = newThread(h, "other");
    startTurn(h, other.threadId);
    expect(checkProjectionsRebuildable(h.store.db).ok).toBe(true);
  });

  test("a diverged live projection is reported with the table name", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    startTurn(h, threadId);
    h.store.raw.run("UPDATE p_threads SET title = 'tampered'");
    const checked = checkProjectionsRebuildable(h.store.db);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.error.map((mismatch) => mismatch.table)).toEqual(["p_threads"]);
    expect(() => expectProjectionsRebuildable(h.store.db)).toThrow("p_threads");
    // 검사는 데이터를 바꾸지 않는다
    expect(
      h.store.raw.query<{ title: string }, []>("SELECT title FROM p_threads").get()?.title,
    ).toBe("tampered");
  });

  // plan projection_version_bump_rebuilds_only_that_projector (이 패키지는 코어 투영기 하나다)
  test("a stale projector_state version rebuilds the core projection on the next start", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    fullStep(h, turn, 0, []);
    const before = h.store.tableHashes();
    h.store.raw.run("UPDATE projector_state SET version = 0 WHERE name = 'core'");
    h.store.raw.run("DELETE FROM p_items");
    h.store.raw.run("UPDATE p_turns SET step_count = 99");
    const restarted = reopenHarness(h);
    expect(restarted.store.tableHashes()).toEqual({
      ...before,
      projector_state: expect.any(String),
    });
    // 다시 만든 투영기는 처음 여는 thread의 열기 보고에 한 번 실린다
    const token = restarted.store.leases.takeover(`session:${threadId}`, TEST_HOLDER_B);
    expect(expectOk(restarted.service.openForWrite(threadId, token)).rebuilt).toEqual(["core"]);
    expect(expectOk(restarted.service.openForWrite(threadId, token)).rebuilt).toEqual([]);
    const state = restarted.store.raw
      .query<{ version: number; last_seq: number }, []>(
        "SELECT version, last_seq FROM projector_state WHERE name = 'core'",
      )
      .get();
    expect(state?.version).toBe(CORE_PROJECTOR_VERSION);
    expect(state?.last_seq).toBe(expectOk(restarted.service.feed.headSeq()));
  });

  test("a projector_state behind the head rebuilds as well", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    startTurn(h, threadId);
    h.store.raw.run("UPDATE projector_state SET last_seq = 1 WHERE name = 'core'");
    h.store.raw.run("DELETE FROM p_turns");
    const restarted = reopenHarness(h);
    expect(
      restarted.store.raw.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM p_turns").get()?.n,
    ).toBe(1);
  });

  // plan projector_has_no_io: 같은 이벤트 열을 두 번 재생한 결과가 바이트 동일하다(D0)
  test("projector_has_no_io: replaying twice gives identical bytes", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    fullStep(h, turn, 0, [{ toolCallId: "tc1", toolName: "read", replay: "safe" }]);
    const force = (): Readonly<Record<string, string>> => {
      h.store.raw.run("UPDATE projector_state SET version = 0 WHERE name = 'core'");
      const restarted = reopenHarness(h);
      return restarted.store.tableHashes();
    };
    expect(force()).toEqual(force());
  });

  test("an empty database rebuilds to empty tables", () => {
    const h = openHarness();
    expect(h.store.rowCounts()["p_threads"]).toBe(0);
    expect(checkProjectionsRebuildable(h.store.db).ok).toBe(true);
  });
});

describe("TxView", () => {
  test("exposes thread status, leaf, effects and the last checkpoint at build time", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    fullStep(h, turn, 0, [{ toolCallId: "tc9", toolName: "read", replay: "safe" }]);
    let seen: TxView | undefined;
    const result = commitResult(h, threadId, "probe:view", (view): CommitPlan => {
      seen = view;
      return { kind: "reject", code: "probe", detail: null };
    });
    expectOk(result);
    expect(seen?.threadStatus).toBe("running");
    expect(seen?.headSeq).toBe(expectOk(h.service.feed.headSeq()));
    expect(seen?.effectByToolCall(threadId, "tc9")?.result).toEqual({
      status: "ok",
      synthesized: false,
    });
    expect(seen?.turn(turn.turnId)?.stepCount).toBe(1);
    expect(seen?.turnAbortRequested(turn.turnId)).toBe(false);
    expect(seen?.lastCheckpoint(threadId)?.stepIndex).toBe(0);
    expect(seen?.scopeLeaseEpoch(threadId, "s")).toBe(0);
    expect(seen?.scopeStateRev(threadId, "s")).toBe(0);
  });
});
