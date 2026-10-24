import { describe, expect, test } from "bun:test";
import type { CommitPlan, ReadFailure } from "@xeon/contracts/records";
import type { Result } from "@xeon/contracts";
import {
  commitResult,
  expectOk,
  fullStep,
  newThread,
  openHarness,
  startTurn,
  type Harness,
} from "./support/harness.ts";

// 저장된 행이 모양과 다를 때(손상, 수동 편집) 읽기 API와 커밋은 Bug를 던지지 않고 row_invalid 값을 돌려준다(TY-24).
// 제약(STRICT, CHECK)을 건너뛰는 같은 연결의 PRAGMA로 손상된 파일을 흉내 낸다.

function damage(h: Harness, sql: string, params: readonly (string | number)[] = []): void {
  h.store.raw.run("PRAGMA ignore_check_constraints = ON");
  // 이벤트 불변 트리거도 손상된 파일에는 없던 것처럼 건너뛴다
  h.store.raw.run("DROP TRIGGER IF EXISTS events_no_update");
  try {
    h.store.raw.run(sql, [...params]);
  } finally {
    h.store.raw.run("PRAGMA ignore_check_constraints = OFF");
  }
}

function faultOf<T>(result: Result<T, ReadFailure>): ReadFailure {
  if (result.ok) throw new Error("expected a read failure");
  return result.error;
}

describe("projection reads", () => {
  test("a damaged p_threads status is row_invalid from query.thread and openForRead", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    damage(h, "UPDATE p_threads SET status = 'bogus' WHERE thread_id = ?", [threadId]);
    expect(h.service.query.thread(threadId)).toEqual({
      ok: false,
      error: { kind: "row_invalid", where: "p_threads.status" },
    });
    expect(h.service.openForRead(threadId)).toEqual({
      ok: false,
      error: { kind: "row_invalid", where: "p_threads.status" },
    });
  });

  test("a damaged p_turns status is row_invalid from query.turn", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    damage(h, "UPDATE p_turns SET status = 'bogus' WHERE turn_id = ?", [turn.turnId]);
    expect(h.service.query.turn(threadId, turn.turnId)).toEqual({
      ok: false,
      error: { kind: "row_invalid", where: "p_turns.status" },
    });
    expect(faultOf(h.service.query.openTurn(threadId)).kind).toBe("row_invalid");
  });

  test("a damaged input row is row_invalid from query.queuedInputs", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const sample = h.store.raw.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM p_inputs").get();
    expect(sample?.n).toBe(0);
    // 큐에 든 입력 하나를 직접 넣고 mode를 망가뜨린다
    damage(
      h,
      `INSERT INTO p_inputs (thread_id, input_id, seq, mode, state, source_key, request_id)
       VALUES (?, 'evt_01HZZZZZZZZZZZZZZZZZZZZZZZ', 1, 'sideways', 'queued', 'user', 'r1')`,
      [threadId],
    );
    expect(h.service.query.queuedInputs(threadId)).toEqual({
      ok: false,
      error: { kind: "row_invalid", where: "p_inputs.mode" },
    });
  });
});

describe("event reads", () => {
  test("a damaged envelope ends the stream with row_invalid after the readable events", async () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    startTurn(h, threadId);
    damage(h, "UPDATE events SET envelope = '{not json' WHERE seq = 2");
    const items = await Array.fromAsync(h.service.readFrom(0, { threadId }));
    expect(items.map((item) => item.ok)).toEqual([true, false]);
    const last = items.at(-1);
    expect(last).toEqual({
      ok: false,
      error: { kind: "row_invalid", where: "events.envelope" },
    });
    const branch = await Array.fromAsync(h.service.readBranch(threadId));
    expect(branch.some((item) => !item.ok)).toBe(true);
  });

  test("feed.read and subscribe report the damaged event instead of throwing", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    startTurn(h, threadId);
    damage(h, "UPDATE events SET envelope = '[]' WHERE seq = 2");
    const head = expectOk(h.service.feed.headSeq());
    expect(faultOf(h.service.feed.read(0, head, undefined, 10, 100))).toEqual({
      kind: "row_invalid",
      where: "events.envelope",
    });
    const heard: number[] = [];
    const subscribed = h.service.subscribe(0, (batch) => {
      heard.push(batch.lastSeq);
    });
    expect(subscribed).toEqual({
      ok: false,
      error: { kind: "row_invalid", where: "events.envelope" },
    });
  });

  test("a stored event of an unknown kind is row_invalid, not a Bug", async () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    startTurn(h, threadId);
    const stored = h.store.raw
      .query<{ envelope: string }, []>("SELECT envelope FROM events WHERE seq = 2")
      .get();
    const changed = JSON.stringify({ ...JSON.parse(stored?.envelope ?? "{}"), version: 99 });
    damage(h, "UPDATE events SET envelope = ? WHERE seq = 2", [changed]);
    const items = await Array.fromAsync(h.service.readFrom(0, { threadId }));
    expect(items.at(-1)).toMatchObject({ ok: false, error: { kind: "row_invalid" } });
  });

  test("a damaged checkpoint record is row_invalid from loadCheckpoint", async () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    fullStep(h, turn, 0, []);
    expect(expectOk(await h.service.loadCheckpoint(threadId))).not.toBeNull();
    damage(h, "UPDATE step_checkpoints SET record = '{}' WHERE thread_id = ?", [threadId]);
    expect(await h.service.loadCheckpoint(threadId)).toEqual({
      ok: false,
      error: { kind: "row_invalid", where: "step_checkpoints.record" },
    });
  });
});

describe("commit and recovery", () => {
  const empty: CommitPlan = { kind: "append", drafts: [], checkpoint: null };

  test("a damaged stored request makes the replayed commit fail with row_invalid", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    const key = `turn:${turn.turnId}:start`;
    damage(h, "UPDATE requests SET result = 'nope' WHERE request_id = ?", [key]);
    const before = h.store.raw.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM events").get();
    const again = commitResult(h, threadId, key, () => empty);
    expect(again).toEqual({
      ok: false,
      error: { kind: "row_invalid", where: "requests.result is not JSON" },
    });
    const after = h.store.raw.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM events").get();
    expect(after?.n).toBe(before?.n);
  });

  test("a damaged projection row seen through TxView aborts the commit with row_invalid", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    damage(h, "UPDATE p_turns SET status = 'bogus' WHERE turn_id = ?", [turn.turnId]);
    const before = h.store.raw.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM events").get();
    const result = commitResult(h, threadId, "inspect:1", (view) => {
      view.turn(turn.turnId);
      return empty;
    });
    expect(result).toEqual({
      ok: false,
      error: { kind: "row_invalid", where: "p_turns.status" },
    });
    const after = h.store.raw.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM events").get();
    expect(after?.n).toBe(before?.n);
  });

  test("recover reports a damaged effect.intent payload as row_invalid", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    // 도구 호출 하나의 의도까지 커밋하고 멈춘 상태를 만든다
    fullStep(h, turn, 0, [{ toolCallId: "tc1", toolName: "read", replay: "safe" }]);
    const intent = h.store.raw
      .query<{ seq: number; envelope: string }, []>(
        "SELECT seq, envelope FROM events WHERE kind = 'effect.intent'",
      )
      .get();
    expect(intent).not.toBeNull();
    // 열린 효과로 만들려면 결과가 없어야 한다. p_effects의 결과 열을 비워 되돌린다
    damage(h, "UPDATE p_effects SET result_seq = NULL, result_status = NULL");
    const damaged = JSON.stringify({
      ...JSON.parse(intent?.envelope ?? "{}"),
      payload: { effectId: 1 },
    });
    damage(h, "UPDATE events SET envelope = ? WHERE seq = ?", [damaged, intent?.seq ?? 0]);
    const recovered = h.service.recover(threadId, {
      toolReplay: () => "safe",
      cancelledByOwner: () => false,
      hostMode: "in-process",
    });
    expect(recovered.ok).toBe(false);
    if (!recovered.ok) expect(recovered.error.kind).toBe("row_invalid");
  });
});
