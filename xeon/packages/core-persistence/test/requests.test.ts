import { describe, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import type { CommitPlan, CommitRequest } from "@xeon/contracts/records";
import { expectProjectionsRebuildable } from "../src/testing/index.ts";
import { draftOf, expectOk, newThread, openHarness, startTurn } from "./support/harness.ts";

function turnStartRequest(
  h: ReturnType<typeof openHarness>,
  threadId: ReturnType<typeof newThread>["threadId"],
  key: string,
  source: string,
  onBuild?: () => void,
): CommitRequest {
  const turnId = h.ids.next("trn");
  const draft = draftOf(
    h,
    h.loop,
    "turn.started",
    threadId,
    { turnId, stepId: null },
    {
      inputItemIds: [],
      requestId: null,
      scopeId: null,
    },
  );
  return {
    threadId,
    requestId: key,
    fingerprintSource: { source },
    build(): CommitPlan {
      onBuild?.();
      return { kind: "append", drafts: [draft], checkpoint: null };
    },
  };
}

describe("idempotent commits", () => {
  // spec §9.3
  test("commit_idempotent_same_request_id", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const request = turnStartRequest(h, threadId, "turn:t1:start", "a");
    const first = expectOk(h.service.commit(request));
    const rows = h.store.rowCounts();
    const second = expectOk(h.service.commit(request));
    expect(first.status).toBe("committed");
    expect(second.status).toBe("committed");
    if (first.status === "committed" && second.status === "committed") {
      expect(first.replayed).toBe(false);
      expect(second.replayed).toBe(true);
      expect(second.eventIds).toEqual(first.eventIds);
      expect(second.firstSeq).toBe(first.firstSeq);
      expect(second.lastSeq).toBe(first.lastSeq);
      expect(second.leaf).toBe(first.leaf);
    }
    expect(h.store.rowCounts()).toEqual(rows);
  });

  // spec §9.4
  test("commit_key_reused_with_different_fingerprint_rejected", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    expectOk(h.service.commit(turnStartRequest(h, threadId, "turn:t1:start", "a")));
    const before = h.store.tableHashes();
    const reused = expectOk(h.service.commit(turnStartRequest(h, threadId, "turn:t1:start", "b")));
    expect(reused).toEqual({ status: "key_reused", requestId: "turn:t1:start" });
    expect(h.store.tableHashes()).toEqual(before);
  });

  // spec §9.5
  test("commit_rejected_plan_is_replayed_without_build", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    let builds = 0;
    const request: CommitRequest = {
      threadId,
      requestId: "tool:tc1:result",
      fingerprintSource: { k: 1 },
      build(): CommitPlan {
        builds += 1;
        return { kind: "reject", code: "already_settled", detail: "tc1" };
      },
    };
    const first = expectOk(h.service.commit(request));
    const second = expectOk(h.service.commit(request));
    expect(first).toEqual({
      status: "rejected",
      code: "already_settled",
      detail: "tc1",
      replayed: false,
    });
    expect(second).toEqual({
      status: "rejected",
      code: "already_settled",
      detail: "tc1",
      replayed: true,
    });
    expect(builds).toBe(1);
  });

  test("a key is scoped to its thread", () => {
    const h = openHarness();
    const a = newThread(h, "a");
    const b = newThread(h, "b");
    const first = expectOk(h.service.commit(turnStartRequest(h, a.threadId, "same:key", "x")));
    const second = expectOk(h.service.commit(turnStartRequest(h, b.threadId, "same:key", "x")));
    expect(first.status === "committed" && !first.replayed).toBe(true);
    expect(second.status === "committed" && !second.replayed).toBe(true);
  });

  test("expectedLeaf mismatch is a stored leaf_conflict rejection", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    startTurn(h, threadId);
    const request: CommitRequest = {
      ...turnStartRequest(h, threadId, "turn:conflict:start", "z"),
      expectedLeaf: null,
    };
    const result = expectOk(h.service.commit(request));
    expect(result).toEqual({
      status: "rejected",
      code: "leaf_conflict",
      detail: null,
      replayed: false,
    });
    expectProjectionsRebuildable(h.store.db);
  });

  test("storage failures are not recorded: the same key is processed again from scratch", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    // 롤백된 시도(예: 장애 주입)는 requests에 남지 않는다. build가 던진 Bug도 같다
    let attempts = 0;
    const request: CommitRequest = {
      threadId,
      requestId: "retry:1",
      fingerprintSource: { k: 1 },
      build(): CommitPlan {
        attempts += 1;
        if (attempts === 1) throw new Bug("transient");
        return { kind: "reject", code: "x", detail: null };
      },
    };
    expect(() => h.service.commit(request)).toThrow("transient");
    expect(expectOk(h.service.commit(request)).status).toBe("rejected");
    expect(attempts).toBe(2);
  });
});
