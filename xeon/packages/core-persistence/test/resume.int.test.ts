import { afterEach, describe, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import type { LeaseToken, RecoverDeps } from "@xeon/contracts/records";
import { DEFAULT_PERSISTENCE_SETTINGS } from "../src/index.ts";
import { expectProjectionsRebuildable } from "../src/testing/index.ts";
import {
  commitExec,
  commitOrThrow,
  draftOf,
  endTurn,
  expectOk,
  fullStep,
  newThread,
  openHarness,
  reopenHarness,
  startTurn,
  stepUntilIntents,
  tempDbPath,
  type Harness,
  type HarnessOptions,
} from "./support/harness.ts";
import { TEST_HOLDER_A, TEST_HOLDER_B } from "./support/sqlite-store.ts";

// 이 파일은 int 태그다(TS-01): 실제 SQLite 파일을 쓴다
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function fileHarness(options: HarnessOptions = {}): Promise<Harness> {
  const db = tempDbPath();
  cleanups.push(db.cleanup);
  return await openHarness({ ...options, path: db.path });
}

const DEPS: RecoverDeps = {
  toolReplay: () => "safe",
  cancelledByOwner: () => false,
  hostMode: "in-process",
};

function tokenOf(h: Harness, threadId: string): LeaseToken {
  const info = h.store.leases.inspect(`session:${threadId}`);
  if (!info.ok || info.value === null) throw new Bug("no lease");
  return {
    resource: `session:${threadId}`,
    holderId: info.value.holderId,
    epoch: info.value.epoch,
  };
}

describe("openForWrite", () => {
  test("opens with the thread head, the marker and the owner display info", async () => {
    const h = await fileHarness();
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    const restarted = await reopenHarness(h);
    const report = expectOk(restarted.service.openForWrite(threadId, tokenOf(h, threadId)));
    expect(report.role).toBe("owner");
    expect(report.readOnly).toBeNull();
    expect(report.headSeq).toBe(expectOk(restarted.service.feed.headSeq()));
    expect(report.marker?.turnId).toBe(turn.turnId);
    expect(report.owner?.holderId).toBe(TEST_HOLDER_A.holderId);
  });

  test("guard_mismatch for a token of another resource, a stale epoch or a released lease", async () => {
    const h = await fileHarness();
    const { threadId, token } = newThread(h);
    const other = newThread(h, "other");
    const restarted = await reopenHarness(h);
    const wrongResource = restarted.service.openForWrite(threadId, other.token);
    expect(wrongResource).toEqual({ ok: false, error: { kind: "guard_mismatch", threadId } });
    h.store.leases.takeover(token.resource, TEST_HOLDER_B);
    const stale = restarted.service.openForWrite(threadId, token);
    expect(stale).toEqual({ ok: false, error: { kind: "guard_mismatch", threadId } });
  });

  test("thread_not_found for an unknown thread", async () => {
    const h = await fileHarness();
    const ghost = h.ids.next("thr");
    const lease = expectOk(h.store.leases.acquire(`session:${ghost}`, TEST_HOLDER_A));
    expect(h.service.openForWrite(ghost, lease)).toEqual({
      ok: false,
      error: { kind: "thread_not_found", threadId: ghost },
    });
    expect(h.service.openForRead(ghost)).toEqual({
      ok: false,
      error: { kind: "thread_not_found", threadId: ghost },
    });
  });
});

describe("openForRead", () => {
  // spec §9.12 (L1 몫)
  test("lock_conflict_offers_observe: an observer sees the owner and cannot commit", async () => {
    const h = await fileHarness();
    const { threadId } = newThread(h);
    startTurn(h, threadId);
    const observer = await reopenHarness(h);
    const report = expectOk(observer.service.openForRead(threadId));
    expect(report).toMatchObject({ role: "observer", readOnly: "observer", rebuilt: [] });
    expect(report.owner?.holderId).toBe(TEST_HOLDER_A.holderId);
    expect(report.marker).not.toBeNull();
    const rows = observer.store.tableHashes();
    expect(() => startTurn(observer, threadId)).toThrow("read_only");
    expect(observer.store.tableHashes()).toEqual(rows);
  });
});

describe("resume marker and attempts", () => {
  // plan resume_marker_comes_from_events
  test("resume_marker_comes_from_events", async () => {
    const h = await fileHarness();
    const { threadId } = newThread(h);
    expect(expectOk(h.service.query.thread(threadId))?.marker).toBeNull();
    const turn = startTurn(h, threadId);
    expect(expectOk(h.service.query.thread(threadId))?.marker?.resumeAttempts).toBe(0);
    expect(expectOk(h.service.beginResume(threadId, "manual"))).toEqual({ attempt: 1 });
    expect(expectOk(h.service.beginResume(threadId, "auto"))).toEqual({ attempt: 2 });
    expect(expectOk(h.service.query.thread(threadId))?.marker?.resumeAttempts).toBe(2);
    const resumed = h.store.raw
      .query<{ request_id: string; payload: string }, []>(
        "SELECT request_id, json_extract(envelope, '$.payload') AS payload FROM events WHERE kind = 'thread.resumed' ORDER BY seq",
      )
      .all();
    expect(resumed.map((row) => row.request_id)).toEqual([
      `resume:${turn.turnId}:1`,
      `resume:${turn.turnId}:2`,
    ]);
    expect(JSON.parse(resumed[1]?.payload ?? "{}")).toMatchObject({
      turnId: turn.turnId,
      attempt: 2,
      mode: "auto",
    });
    endTurn(h, turn, "interrupted");
    expect(expectOk(h.service.query.thread(threadId))?.marker).toBeNull();
    // 새 turn은 시도 수를 0에서 센다
    startTurn(h, threadId);
    expect(expectOk(h.service.query.thread(threadId))?.marker?.resumeAttempts).toBe(0);
    expectProjectionsRebuildable(h.store.db);
  });

  // plan resume_attempts_capped
  test("resume_attempts_capped", async () => {
    const h = await fileHarness({
      settings: () => ({
        ...DEFAULT_PERSISTENCE_SETTINGS,
        autoResume: false,
        maxResumeAttempts: 2,
      }),
    });
    const { threadId } = newThread(h);
    startTurn(h, threadId);
    expectOk(h.service.beginResume(threadId, "manual"));
    expectOk(h.service.beginResume(threadId, "manual"));
    expect(h.service.beginResume(threadId, "manual")).toEqual({
      ok: false,
      error: { kind: "attempts_exhausted", attempts: 2, max: 2 },
    });
  });

  test("beginResume needs an open turn and write ownership", async () => {
    const h = await fileHarness();
    const { threadId } = newThread(h);
    expect(h.service.beginResume(threadId, "manual")).toEqual({
      ok: false,
      error: { kind: "no_open_turn", threadId },
    });
    const restarted = await reopenHarness(h);
    const unopened = restarted.service.beginResume(threadId, "manual");
    expect(unopened.ok).toBe(false);
    if (!unopened.ok) expect(unopened.error.kind).toBe("ownership_lost");
  });

  test("the attempt count survives a restart because it comes from thread.resumed", async () => {
    const h = await fileHarness();
    const { threadId } = newThread(h);
    startTurn(h, threadId);
    expectOk(h.service.beginResume(threadId, "manual"));
    const restarted = await reopenHarness(h);
    const report = expectOk(restarted.service.openForWrite(threadId, tokenOf(h, threadId)));
    expect(report.marker?.resumeAttempts).toBe(1);
    expect(expectOk(restarted.service.beginResume(threadId, "manual"))).toEqual({ attempt: 2 });
  });
});

describe("restart invariants", () => {
  // spec §9.15
  test("abort_requested_turn_not_resumed", async () => {
    const h = await fileHarness();
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    const stepId = h.ids.next("stp");
    const [effect] = stepUntilIntents(h, turn, 0, stepId, [
      { toolCallId: "tc1", toolName: "read", replay: "safe" },
    ]).effects;
    if (effect === undefined) throw new Bug("missing effect");
    commitExec(h, turn, stepId, effect.effectId, "tc1");
    commitOrThrow(h, threadId, `abort:${turn.turnId}`, () => ({
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
    const restarted = await reopenHarness(h);
    expectOk(restarted.service.openForWrite(threadId, tokenOf(h, threadId)));
    const plan = expectOk(restarted.service.recover(threadId, { ...DEPS, hostMode: "service" }));
    // 취소 의도가 있으면 safe 효과도 다시 실행하지 않고 닫는다. 재개 대상이 아니다
    expect(plan.reruns).toEqual([]);
    expect(plan.synthesized.map((entry) => entry.code)).toEqual(["outcome_unknown"]);
    expect(plan.abortRequestedTurn).toBe(turn.turnId);
    expect(plan.autoResume).toEqual({ allowed: false, reason: "abort_requested" });
  });

  // spec §9.14
  test("resume_restores_input_queue in seq order", async () => {
    const h = await fileHarness();
    const { threadId } = newThread(h);
    const queue = (requestId: string) =>
      commitOrThrow(h, threadId, `in:user:${requestId}`, () => ({
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
              item: { kind: "user", content: requestId },
              requestId,
              source: { type: "user", via: "interactive" },
            },
          ),
        ],
        checkpoint: null,
      }));
    const first = queue("r1");
    const second = queue("r2");
    const restarted = await reopenHarness(h);
    expectOk(restarted.service.openForWrite(threadId, tokenOf(h, threadId)));
    const plan = expectOk(restarted.service.recover(threadId, DEPS));
    expect(plan.queuedInputs.map((input) => [input.requestId, input.seq])).toEqual([
      ["r1", first.firstSeq],
      ["r2", second.firstSeq],
    ]);
  });

  // spec §9.19
  test("seq continues without gaps across restarts", async () => {
    const h = await fileHarness();
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    fullStep(h, turn, 0, [{ toolCallId: "tc1", toolName: "read", replay: "safe" }]);
    const maxBefore = expectOk(h.service.feed.headSeq());
    const restarted = await reopenHarness(h);
    expectOk(restarted.service.openForWrite(threadId, tokenOf(h, threadId)));
    expectOk(restarted.service.recover(threadId, DEPS));
    endTurn(restarted, turn);
    const seqs = restarted.store.raw
      .query<{ seq: number }, []>("SELECT seq FROM events ORDER BY seq")
      .all()
      .map((row) => row.seq);
    expect(seqs).toEqual(seqs.map((_, index) => index + 1));
    expect(seqs.at(-1)).toBe(maxBefore + 1);
  });
});

describe("release", () => {
  test("release forgets the thread: commits are refused until it is opened again", async () => {
    const h = await fileHarness();
    const { threadId, token } = newThread(h);
    await h.service.release(threadId, "quit");
    expect(() => startTurn(h, threadId)).toThrow("ownership_lost");
    expectOk(h.service.openForWrite(threadId, token));
    expect(startTurn(h, threadId).threadId).toBe(threadId);
  });
});
