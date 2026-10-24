import { describe, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import type { CommitPlan, StepCheckpointInput } from "@xeon/contracts/records";
import { expectProjectionsRebuildable } from "../src/testing/index.ts";
import {
  checkpointInput,
  commitOrThrow,
  commitResult,
  draftOf,
  fullStep,
  newThread,
  openHarness,
  reopenHarness,
  startTurn,
  endTurn,
  expectOk,
} from "./support/harness.ts";
import { TEST_HOLDER_B } from "./support/sqlite-store.ts";

const emptyPlan = (): CommitPlan => ({ kind: "append", drafts: [], checkpoint: null });

// plan commit_seq_is_global_and_gapless
test("commit_seq_is_global_and_gapless", () => {
  const h = openHarness();
  const a = newThread(h, "a");
  const b = newThread(h, "b");
  startTurn(h, a.threadId);
  startTurn(h, b.threadId);
  startTurn(h, a.threadId);
  const seqs = h.store.raw
    .query<{ seq: number }, []>("SELECT seq FROM events ORDER BY seq")
    .all()
    .map((row) => row.seq);
  expect(seqs).toEqual(seqs.map((_, index) => index + 1));
  expect(expectOk(h.service.feed.headSeq())).toBe(seqs.length);
  expectProjectionsRebuildable(h.store.db);
});

test("parentId follows the thread leaf and a new thread starts at null", () => {
  const h = openHarness();
  const { threadId } = newThread(h);
  const other = newThread(h, "other");
  startTurn(h, threadId);
  startTurn(h, other.threadId);
  const rows = h.store.raw
    .query<{ id: string; parent_id: string | null; thread_id: string }, []>(
      "SELECT id, parent_id, thread_id FROM events ORDER BY seq",
    )
    .all();
  for (const id of [threadId, other.threadId]) {
    const own = rows.filter((row) => row.thread_id === id);
    expect(own[0]?.parent_id).toBeNull();
    for (let i = 1; i < own.length; i += 1) expect(own[i]?.parent_id).toBe(own[i - 1]?.id ?? "");
  }
});

test("recordedAt never decreases even when the clock jumps back", () => {
  const h = openHarness();
  const { threadId } = newThread(h);
  startTurn(h, threadId);
  h.clock.set(h.clock.now() - 60_000);
  startTurn(h, threadId);
  const stamps = h.store.raw
    .query<{ recorded_at: number }, []>("SELECT recorded_at FROM events ORDER BY seq")
    .all()
    .map((row) => row.recorded_at);
  expect(stamps).toEqual(stamps.toSorted((a, b) => a - b));
});

describe("producers", () => {
  test("commit_rejects_unowned_kind", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    expect(() =>
      draftOf(h, h.tasks, "effect.result", threadId, { turnId: null, stepId: null }, {}),
    ).toThrow("store.prefix_not_owned");
    // 합성 결과 예외는 공개 핸들로 열리지 않는다
    expect(() =>
      draftOf(h, h.loop, "effect.result", threadId, { turnId: null, stepId: null }, {}),
    ).toThrow("store.prefix_not_owned");
  });

  test("a producer is claimed once and core.persistence is never claimable", () => {
    const h = openHarness();
    expect(() => h.service.producer("core.loop")).toThrow("store.producer_claimed");
    expect(() => h.service.producer("core.persistence")).toThrow("store.producer_claimed");
  });

  test("a retired kind cannot be drafted (post.accepted, U-05)", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    expect(() =>
      draftOf(h, h.tasks, "post.accepted", threadId, { turnId: null, stepId: null }, {}),
    ).toThrow("store.kind_retired");
  });

  test("an unregistered extension kind cannot be drafted", () => {
    const h = openHarness();
    const alpha = h.service.producer("ext.alpha");
    expect(() =>
      alpha.draft({
        id: h.ids.next("evt"),
        kind: "x.alpha.note.added",
        threadId: h.ids.next("thr"),
        turnId: null,
        stepId: null,
        causationId: null,
        correlationId: null,
        payload: {},
      }),
    ).toThrow("store.kind_unregistered");
  });
});

describe("ownership", () => {
  // spec §9.24
  test("commit_requires_ownership_guard: a taken-over token is ownership_lost and rows stay", () => {
    const h = openHarness();
    const { threadId, token } = newThread(h);
    startTurn(h, threadId);
    // B가 임대를 인수한다(epoch + 1). A는 늦게 깨어나 커밋한다
    h.store.leases.takeover(token.resource, TEST_HOLDER_B);
    const before = h.store.tableHashes();
    const late = commitResult(h, threadId, "late:write", (): CommitPlan => ({
      kind: "append",
      drafts: [
        draftOf(
          h,
          h.loop,
          "turn.started",
          threadId,
          { turnId: h.ids.next("trn"), stepId: null },
          {
            inputItemIds: [],
            requestId: null,
            scopeId: null,
          },
        ),
      ],
      checkpoint: null,
    }));
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error).toEqual({ kind: "ownership_lost", threadId });
    expect(h.store.tableHashes()).toEqual(before);
  });

  test("a thread this service never opened refuses commits", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const restarted = reopenHarness(h);
    const refused = commitResult(restarted, threadId, "k:1", (): CommitPlan => ({
      kind: "reject",
      code: "x",
      detail: null,
    }));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.kind).toBe("ownership_lost");
  });

  test("a commit for an unknown thread without thread.started is thread_not_found", () => {
    const h = openHarness();
    const ghost = h.ids.next("thr");
    const result = commitResult(h, ghost, "ghost:1", (): CommitPlan => ({
      kind: "append",
      drafts: [
        draftOf(
          h,
          h.loop,
          "step.started",
          ghost,
          { turnId: h.ids.next("trn"), stepId: h.ids.next("stp") },
          {
            stepIndex: 0,
          },
        ),
      ],
      checkpoint: null,
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: "thread_not_found", threadId: ghost });
  });

  test("an observer cannot commit", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const other = reopenHarness(h);
    expect(other.service.openForRead(threadId).ok).toBe(true);
    const result = commitResult(other, threadId, "obs:1", (): CommitPlan => ({
      kind: "reject",
      code: "x",
      detail: null,
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: "read_only", reason: "observer" });
  });
});

describe("checkpoints", () => {
  test("step_commit_contains_checkpoint", async () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    fullStep(h, turn, 0, []);
    const rows = h.store.raw
      .query<{ kind: string; seq: number; id: string }, [string]>(
        "SELECT kind, seq, id FROM events WHERE thread_id = ? ORDER BY seq",
      )
      .all(threadId);
    const stepEnd = rows.findIndex((row) => row.kind === "step.completed");
    expect(rows[stepEnd + 1]?.kind).toBe("checkpoint.step");
    const checkpoint = h.store.raw
      .query<{ seq: number; turn_id: string; step_index: number; next: string }, [string]>(
        "SELECT seq, turn_id, step_index, next FROM step_checkpoints WHERE thread_id = ?",
      )
      .get(threadId);
    expect(checkpoint).toEqual({
      seq: rows[stepEnd + 1]?.seq ?? -1,
      turn_id: turn.turnId,
      step_index: 0,
      next: "turn_end",
    });
    const loaded = expectOk(await h.service.loadCheckpoint(threadId));
    // leafEventId는 같은 커밋의 step.completed 이벤트다
    expect(String(loaded?.leafEventId)).toBe(rows[stepEnd]?.id ?? "");
    expect(String(loaded?.threadId)).toBe(threadId);
  });

  test("checkpoint_without_step_is_bug_except_approval_wait", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    const stepId = h.ids.next("stp");
    const scope = { turnId: turn.turnId, stepId };
    const before = h.store.tableHashes();
    expect(() =>
      commitResult(h, threadId, "cp:bad", (): CommitPlan => ({
        kind: "append",
        drafts: [draftOf(h, h.loop, "step.started", threadId, scope, { stepIndex: 0 })],
        checkpoint: checkpointInput(turn.turnId, stepId, 0, "request"),
      })),
    ).toThrow("store.checkpoint_without_step");
    expect(h.store.tableHashes()).toEqual(before);
    // D-06: 승인 대기 체크포인트의 next는 await_input 하나다. tools는 승인 대기가 아니다
    expect(() =>
      commitResult(h, threadId, "cp:approval-tools", (): CommitPlan => ({
        kind: "append",
        drafts: [draftOf(h, h.loop, "step.started", threadId, scope, { stepIndex: 0 })],
        checkpoint: {
          ...checkpointInput(turn.turnId, stepId, 0, "tools"),
          pendingToolCalls: [{ toolCallId: "tc1", effectId: null, waiting: "approval" }],
        },
      })),
    ).toThrow("store.checkpoint_without_step");
    const waiting: StepCheckpointInput = {
      ...checkpointInput(turn.turnId, stepId, 0, "await_input"),
      pendingToolCalls: [{ toolCallId: "tc1", effectId: null, waiting: "approval" }],
    };
    const ok = commitOrThrow(h, threadId, "cp:approval", () => ({
      kind: "append",
      drafts: [draftOf(h, h.loop, "step.started", threadId, scope, { stepIndex: 0 })],
      checkpoint: waiting,
    }));
    expect(ok.eventIds).toHaveLength(2);
  });

  // spec §9.23
  test("step_commit_count_matches_formula", () => {
    for (const toolCount of [0, 1, 2, 3]) {
      const h = openHarness();
      const { threadId } = newThread(h);
      const turn = startTurn(h, threadId);
      const before = h.commits();
      fullStep(
        h,
        turn,
        0,
        Array.from({ length: toolCount }, (_, i) => ({
          toolCallId: `tc${i}`,
          toolName: "read",
          replay: "safe" as const,
        })),
      );
      // S1, C3, 도구마다 E1~E3, C5
      expect(h.commits() - before).toBe(3 + 3 * toolCount);
      endTurn(h, turn);
      expectProjectionsRebuildable(h.store.db);
    }
  });
});

describe("validation", () => {
  test("a payload that violates its catalog schema is a Bug and leaves no rows", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const before = h.store.tableHashes();
    expect(() =>
      commitResult(h, threadId, "bad:payload", (): CommitPlan => ({
        kind: "append",
        drafts: [
          draftOf(
            h,
            h.loop,
            "step.started",
            threadId,
            { turnId: h.ids.next("trn"), stepId: h.ids.next("stp") },
            {
              stepIndex: -3,
            },
          ),
        ],
        checkpoint: null,
      })),
    ).toThrow("store.schema_invalid");
    expect(h.store.tableHashes()).toEqual(before);
  });

  test("an envelope over 256 KiB is a Bug", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const turnId = h.ids.next("trn");
    expect(() =>
      commitResult(h, threadId, "big:1", (): CommitPlan => ({
        kind: "append",
        drafts: [
          draftOf(
            h,
            h.loop,
            "turn.started",
            threadId,
            { turnId, stepId: null },
            {
              inputItemIds: [],
              requestId: "x".repeat(10),
              scopeId: null,
            },
          ),
          draftOf(
            h,
            h.loop,
            "item.recorded",
            threadId,
            { turnId, stepId: null },
            {
              item: {
                itemId: h.ids.next("itm"),
                status: "completed",
                kind: "user",
                message: { role: "user", content: "y".repeat(300_000), timestamp: 1 },
                requestId: null,
              },
            },
          ),
        ],
        checkpoint: null,
      })),
    ).toThrow("store.event_too_large");
  });

  test("a commit key outside COMMIT_KEY_PATTERN and an empty commit are Bugs", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    expect(() => commitResult(h, threadId, "bad key!", emptyPlan)).toThrow("store.schema_invalid");
    expect(() => commitResult(h, threadId, "empty:1", emptyPlan)).toThrow("at least one draft");
  });

  test("commit inside build is store.nested_write", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    expect(() =>
      commitResult(h, threadId, "outer:1", (): CommitPlan => {
        commitResult(h, threadId, "inner:1", () => ({ kind: "reject", code: "x", detail: null }));
        return { kind: "reject", code: "x", detail: null };
      }),
    ).toThrow("store.nested_write");
  });

  test("a build that throws rolls everything back and records nothing", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const before = h.store.tableHashes();
    expect(() =>
      commitResult(h, threadId, "boom:1", () => {
        throw new Bug("boom");
      }),
    ).toThrow("boom");
    expect(h.store.tableHashes()).toEqual(before);
    // 같은 키로 다시 처리된다(TX-05)
    expect(
      expectOk(
        commitResult(h, threadId, "boom:1", () => ({ kind: "reject", code: "x", detail: null })),
      ).status,
    ).toBe("rejected");
  });
});
