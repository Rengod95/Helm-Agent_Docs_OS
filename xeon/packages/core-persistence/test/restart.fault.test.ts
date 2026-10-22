import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bug } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import { NOT_STARTED_TEXT, OUTCOME_UNKNOWN_TEXT, type RecoverDeps } from "@xeon/contracts/records";
import { expectProjectionsRebuildable } from "../src/testing/index.ts";
import { fixedIdFactory, manualClock } from "./support/clock.ts";
import { endTurn, expectOk, openHarness, type Harness } from "./support/harness.ts";
import { openTestStore, TEST_HOLDER_B } from "./support/sqlite-store.ts";

const CHILD = join(import.meta.dir, "support", "crash-child.ts");

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function crashAt(
  point: string,
): Promise<{ readonly dbPath: string; readonly threadId: ThreadId }> {
  const directory = mkdtempSync(join(tmpdir(), "xeon-persistence-"));
  directories.push(directory);
  const dbPath = join(directory, "session.db");
  const child = Bun.spawn([process.execPath, CHILD, dbPath, point], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await child.exited;
  if (child.signalCode !== "SIGKILL") {
    const stderr = await new Response(child.stderr).text();
    throw new Bug(
      `child did not die by SIGKILL at ${point}: ${String(child.signalCode)} ${stderr}`,
    );
  }
  // 자식의 첫 thread id: 같은 seed·같은 호출 순서의 ID 발급기가 같은 값을 낸다
  return { dbPath, threadId: fixedIdFactory(1).next("thr") };
}

/** 죽은 프로세스의 DB 파일을 새 프로세스(새 서비스, 새 시계, 다른 seed의 ID 발급기)로 다시 연다 */
function restart(dbPath: string, threadId: ThreadId): Harness {
  const clock = manualClock(1_767_571_300_000);
  const store = openTestStore({ path: dbPath, now: () => clock.now() });
  const h = openHarness({ store, clock, ids: fixedIdFactory(2) });
  // OS 잠금은 프로세스가 죽으면 풀린다. 새 소유자가 임대를 인수한다(epoch + 1)
  const token = store.leases.takeover(`session:${threadId}`, TEST_HOLDER_B);
  expectOk(h.service.openForWrite(threadId, token));
  return h;
}

const DEPS = (replay: "safe" | "unsafe"): RecoverDeps => ({
  toolReplay: () => replay,
  cancelledByOwner: () => false,
  hostMode: "in-process",
});

/** 어느 지점에서 죽었든 성립해야 하는 불변식(스펙 §9.6) */
function assertCommonInvariants(h: Harness): void {
  const seqs = h.store.raw
    .query<{ seq: number }, []>("SELECT seq FROM events ORDER BY seq")
    .all()
    .map((row) => row.seq);
  expect(seqs).toEqual(seqs.map((_, index) => index + 1));
  const results = h.store.raw
    .query<{ effect: string; n: number }, []>(
      `SELECT json_extract(envelope, '$.payload.effectId') AS effect, COUNT(*) AS n
       FROM events WHERE kind = 'effect.result' GROUP BY effect`,
    )
    .all();
  expect(results.every((row) => row.n === 1)).toBe(true);
  expectProjectionsRebuildable(h.store.db);
}

function synthesizedTexts(h: Harness): string[] {
  return h.store.raw
    .query<{ text: string }, []>(
      `SELECT json_extract(envelope, '$.payload.item.message.content[0].text') AS text FROM events
       WHERE kind = 'item.recorded' AND json_extract(envelope, '$.payload.item.message.isError') = 1 ORDER BY seq`,
    )
    .all()
    .map((row) => row.text);
}

// spec §9.6
describe("restart_invariants_k1_to_k6 (SIGKILL of a child process)", () => {
  test("K1: killed while streaming (before C3) leaves no assistant item; the step request is sent again", async () => {
    const { dbPath, threadId } = await crashAt("K1");
    const h = restart(dbPath, threadId);
    const plan = expectOk(h.service.recover(threadId, DEPS("unsafe")));
    expect(plan).toMatchObject({
      next: "request",
      synthesized: [],
      reruns: [],
      pendingToolCalls: [],
    });
    expect(plan.marker).not.toBeNull();
    expect(h.store.rowCounts()["p_items"]).toBe(1);
    const maxSeq = expectOk(h.service.feed.headSeq());
    const turnId = plan.marker?.turnId;
    if (turnId === undefined) throw new Bug("no marker");
    expectOk(h.service.beginResume(threadId, "manual"));
    endTurn(h, { threadId, turnId }, "interrupted");
    expect(expectOk(h.service.feed.headSeq())).toBeGreaterThan(maxSeq);
    assertCommonInvariants(h);
  });

  test("K2: killed after E1 (intent only): unsafe is closed as not_started", async () => {
    const { dbPath, threadId } = await crashAt("K2:unsafe");
    const h = restart(dbPath, threadId);
    const plan = expectOk(h.service.recover(threadId, DEPS("unsafe")));
    expect(plan.synthesized.map((entry) => entry.code)).toEqual(["not_started"]);
    expect(plan.reruns).toEqual([]);
    expect(synthesizedTexts(h)).toEqual([NOT_STARTED_TEXT]);
    const status = h.store.raw
      .query<{ status: string }, []>(
        "SELECT json_extract(envelope, '$.payload.status') AS status FROM events WHERE kind = 'effect.result'",
      )
      .get();
    expect(status?.status).toBe("abandoned");
    assertCommonInvariants(h);
  });

  test("K2: killed after E1: a safe tool is planned for a rerun, nothing is written", async () => {
    const { dbPath, threadId } = await crashAt("K2:safe");
    const h = restart(dbPath, threadId);
    const before = h.store.rowCounts();
    const plan = expectOk(h.service.recover(threadId, DEPS("safe")));
    expect(plan.reruns.map((rerun) => rerun.attempt)).toEqual([1]);
    expect(plan.synthesized).toEqual([]);
    expect(h.store.rowCounts()).toEqual(before);
    assertCommonInvariants(h);
  });

  for (const point of ["K3:unsafe", "K4:unsafe"]) {
    test(`${point.slice(0, 2)}: killed while the tool ran (intent + exec): unsafe is closed as outcome_unknown`, async () => {
      const { dbPath, threadId } = await crashAt(point);
      const h = restart(dbPath, threadId);
      const plan = expectOk(h.service.recover(threadId, DEPS("unsafe")));
      expect(plan.synthesized.map((entry) => entry.code)).toEqual(["outcome_unknown"]);
      expect(synthesizedTexts(h)).toEqual([OUTCOME_UNKNOWN_TEXT]);
      assertCommonInvariants(h);
    });
  }

  test("K3: killed while a safe tool ran: the rerun is planned as attempt 1", async () => {
    const { dbPath, threadId } = await crashAt("K3:safe");
    const h = restart(dbPath, threadId);
    const plan = expectOk(h.service.recover(threadId, DEPS("safe")));
    expect(plan.reruns.map((rerun) => rerun.attempt)).toEqual([1]);
    expect(plan.synthesized).toEqual([]);
    assertCommonInvariants(h);
  });

  test("K5: killed after E3 was committed but before the listeners finished", async () => {
    const { dbPath, threadId } = await crashAt("K5");
    const h = restart(dbPath, threadId);
    const plan = expectOk(h.service.recover(threadId, DEPS("unsafe")));
    expect(plan.synthesized).toEqual([]);
    expect(plan.reruns).toEqual([]);
    expect(expectOk(h.service.query.openEffects(threadId))).toEqual([]);
    // 구독자는 readFrom으로 따라잡는다
    const seen: string[] = [];
    for await (const event of h.service.readFrom(0, { threadId })) seen.push(expectOk(event).kind);
    expect(seen).toContain("effect.result");
    assertCommonInvariants(h);
  });

  test("K6: killed after every effect closed but before C6: marker stays, seq continues", async () => {
    const { dbPath, threadId } = await crashAt("K6");
    const h = restart(dbPath, threadId);
    const maxSeq = expectOk(h.service.feed.headSeq());
    const plan = expectOk(h.service.recover(threadId, DEPS("unsafe")));
    expect(plan.marker).not.toBeNull();
    expect(plan.next).toBe("request");
    expect(plan.synthesized).toEqual([]);
    expect(plan.checkpoint?.stepIndex).toBe(0);
    const turnId = plan.marker?.turnId;
    if (turnId === undefined) throw new Bug("no marker");
    expectOk(h.service.beginResume(threadId, "manual"));
    endTurn(h, { threadId, turnId });
    expect(expectOk(h.service.feed.headSeq())).toBeGreaterThan(maxSeq);
    assertCommonInvariants(h);
    expect(expectOk(h.service.query.thread(threadId))?.marker).toBeNull();
  });
});

describe("a kill inside a commit leaves no trace of that commit", () => {
  for (const point of [
    "after_begin",
    "after_lease_check",
    "after_request_check",
    "after_event_insert:0",
    "after_projection:1",
    "before_checkpoint",
    "before_request_insert",
    "before_commit",
  ]) {
    test(point, async () => {
      const { dbPath, threadId } = await crashAt(`TX:${point}`);
      const h = restart(dbPath, threadId);
      const kinds = h.store.raw
        .query<{ kind: string }, []>("SELECT kind FROM events ORDER BY seq")
        .all()
        .map((row) => row.kind);
      expect(kinds).not.toContain("step.completed");
      expect(kinds).not.toContain("checkpoint.step");
      expect(h.store.rowCounts()["step_checkpoints"]).toBe(0);
      assertCommonInvariants(h);
      // 같은 커밋 키로 처음부터 다시 처리할 수 있다(TX-05)
      const plan = expectOk(h.service.recover(threadId, DEPS("unsafe")));
      expect(plan.synthesized).toEqual([]);
    });
  }

  test("after_commit: the commit survived, the retry is a replay", async () => {
    const { dbPath, threadId } = await crashAt("TX:after_commit");
    const h = restart(dbPath, threadId);
    const kinds = h.store.raw
      .query<{ kind: string }, []>("SELECT kind FROM events ORDER BY seq")
      .all()
      .map((row) => row.kind);
    expect(kinds.slice(-2)).toEqual(["step.completed", "checkpoint.step"]);
    assertCommonInvariants(h);
    const plan = expectOk(h.service.recover(threadId, DEPS("unsafe")));
    expect(plan.checkpoint?.stepIndex).toBe(0);
  });
});
