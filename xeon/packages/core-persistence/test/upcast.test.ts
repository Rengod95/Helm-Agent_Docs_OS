import { describe, expect, test } from "bun:test";
import { canonicalJson } from "@xeon/contracts";
import type { LeaseToken } from "@xeon/contracts/records";
import { expectProjectionsRebuildable } from "../src/testing/index.ts";
import { expectOk, newThread, openHarness, reopenHarness, startTurn } from "./support/harness.ts";

/** 더 새 Xeon이 같은 DB에 쓴 행을 흉내 낸다. events의 UPDATE·DELETE는 막혀 있지만 INSERT는 된다 */
function foreignEvent(
  h: ReturnType<typeof openHarness>,
  threadId: string,
  kind: string,
  version: number,
): void {
  const seq = expectOk(h.service.feed.headSeq()) + 1;
  const id = h.ids.next("evt");
  const envelope = {
    id,
    kind,
    version,
    threadId,
    turnId: null,
    stepId: null,
    recordedAt: h.clock.now(),
    causationId: null,
    correlationId: null,
    payload: { from: "the future" },
    durable: true,
    seq,
    parentId: null,
  };
  h.store.raw.run(
    `INSERT INTO events (seq, id, thread_id, parent_id, kind, version, turn_id, step_id, recorded_at, request_id, private_owner, envelope)
     VALUES (?, ?, ?, NULL, ?, ?, NULL, NULL, ?, 'foreign:1', NULL, ?)`,
    [seq, id, threadId, kind, version, h.clock.now(), canonicalJson(envelope)],
  );
  h.store.raw.run("UPDATE event_seq SET next_seq = ? WHERE singleton = 1", [seq + 1]);
}

function tokenOf(h: ReturnType<typeof openHarness>, threadId: string): LeaseToken {
  const info = h.store.leases.inspect(`session:${threadId}`);
  if (!info.ok || info.value === null) throw new Error("no lease");
  return {
    resource: `session:${threadId}`,
    holderId: info.value.holderId,
    epoch: info.value.epoch,
  };
}

describe("upcast_on_read_and_read_only_on_future_version", () => {
  test("a core kind this build does not know opens the thread read-only; other threads are unaffected", () => {
    const h = openHarness();
    const stale = newThread(h, "stale");
    const fine = newThread(h, "fine");
    foreignEvent(h, stale.threadId, "thread.hologram", 1);
    const restarted = reopenHarness(h);
    const report = expectOk(
      restarted.service.openForWrite(stale.threadId, tokenOf(h, stale.threadId)),
    );
    expect(report.readOnly).toBe("unknown_event_kind");
    expect(report.rebuilt).toEqual([]);
    expect(() => startTurn(restarted, stale.threadId)).toThrow("read_only");
    const other = expectOk(
      restarted.service.openForWrite(fine.threadId, tokenOf(h, fine.threadId)),
    );
    expect(other.readOnly).toBeNull();
    expect(startTurn(restarted, fine.threadId).threadId).toBe(fine.threadId);
    // 쓰기를 거부한 thread도 읽을 수 있다
    const reader = reopenHarness(h);
    expect(expectOk(reader.service.openForRead(stale.threadId))).toMatchObject({
      role: "observer",
      readOnly: "observer",
    });
    // 이미 쓰기 소유로 연 서비스는 읽기 전용 이유를 그대로 돌려준다
    expect(expectOk(restarted.service.openForRead(stale.threadId))).toMatchObject({
      role: "owner",
      readOnly: "unknown_event_kind",
    });
  });

  test("a version above the catalog opens the thread read-only", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    foreignEvent(h, threadId, "turn.started", 9);
    const restarted = reopenHarness(h);
    const report = expectOk(restarted.service.openForWrite(threadId, tokenOf(h, threadId)));
    expect(report.readOnly).toBe("newer_event_version");
    const recovered = restarted.service.recover(threadId, {
      toolReplay: () => null,
      cancelledByOwner: () => false,
      hostMode: "in-process",
    });
    expect(recovered).toEqual({
      ok: false,
      error: { kind: "read_only", reason: "newer_event_version" },
    });
  });

  test("an unregistered extension kind keeps the thread writable and only moves head and leaf", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    startTurn(h, threadId);
    foreignEvent(h, threadId, "x.alpha.note.added", 1);
    const restarted = reopenHarness(h);
    const report = expectOk(restarted.service.openForWrite(threadId, tokenOf(h, threadId)));
    expect(report.readOnly).toBeNull();
    const head = expectOk(restarted.service.feed.headSeq());
    expect(expectOk(restarted.service.query.thread(threadId))?.headSeq).toBe(head);
    expectProjectionsRebuildable(restarted.store.db);
  });

  test("readFrom hands out the stored envelope upcast to the current version (identity for v1 kinds)", async () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const events: number[] = [];
    for await (const event of h.service.readFrom(0, { threadId })) {
      events.push(expectOk(event).version);
    }
    expect(events).toEqual([1]);
  });
});
