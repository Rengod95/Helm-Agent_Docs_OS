import { describe, expect, test } from "bun:test";
import type { EventId, ThreadId, TurnId } from "@xeon/contracts/conversation";
import type { CommitPlan, StepCheckpointInput } from "@xeon/contracts/records";
import { expectProjectionsRebuildable } from "../src/testing/index.ts";
import {
  checkpointInput,
  commitOrThrow,
  commitResult,
  draftOf,
  expectOk,
  newThread,
  openHarness,
  reopenHarness,
  startTurn,
  type Harness,
} from "./support/harness.ts";

// 승인 요청과 응답(L1.tools.spec §4.7, L1.persistence.spec §4.2 A1). 실제 SQLite 위에서 TxView.approval과 p_approvals를 검사한다.

function requestedPayload(threadId: ThreadId, turnId: TurnId, stepId: string): unknown {
  return {
    origin: { threadId, turnId, stepId, toolCallId: "tc1", caller: "main" },
    requestKey: "tc1",
    title: "Run a command",
    body: {
      kind: "tool",
      tool: { toolName: "bash", risk: "high", args: {}, argsHash: "0".repeat(64), ruleId: null },
    },
    remember: ["once"],
    surfaceThreadId: threadId,
    requestedAt: 1,
  };
}

function resolvedPayload(approvalId: EventId): unknown {
  return {
    approvalId,
    decision: "allow",
    answer: null,
    remember: "once",
    requestedRemember: null,
    resolvedBy: "user",
  };
}

interface Requested {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly approvalId: EventId;
}

/** A1: approval.requested와 대기 체크포인트를 한 커밋으로 쓴다. 루프의 대기 체크포인트처럼 next는 await_input이다 */
function requestApproval(h: Harness): Requested {
  const { threadId } = newThread(h);
  const turn = startTurn(h, threadId);
  const stepId = h.ids.next("stp");
  const scope = { turnId: turn.turnId, stepId };
  const waiting: StepCheckpointInput = {
    ...checkpointInput(turn.turnId, stepId, 0, "await_input"),
    pendingToolCalls: [{ toolCallId: "tc1", effectId: null, waiting: "approval" }],
  };
  const committed = commitOrThrow(h, threadId, "approval:req:tc1", () => ({
    kind: "append",
    drafts: [
      draftOf(
        h,
        h.tools,
        "approval.requested",
        threadId,
        scope,
        requestedPayload(threadId, turn.turnId, stepId),
      ),
    ],
    checkpoint: waiting,
  }));
  const approvalId = committed.eventIds[0];
  if (approvalId === undefined) throw new Error("the approval event is missing");
  return { threadId, turnId: turn.turnId, approvalId };
}

function resolve(h: Harness, requested: Requested) {
  const { threadId, turnId, approvalId } = requested;
  return commitResult(h, threadId, `approval:res:${approvalId}`, (view): CommitPlan => {
    const known = view.approval(approvalId);
    if (known === undefined) return { kind: "reject", code: "approval_missing", detail: null };
    if (known.resolved) return { kind: "reject", code: "already_resolved", detail: null };
    return {
      kind: "append",
      drafts: [
        draftOf(
          h,
          h.tools,
          "approval.resolved",
          threadId,
          { turnId, stepId: null },
          resolvedPayload(approvalId),
        ),
      ],
      checkpoint: null,
    };
  });
}

describe("approvals", () => {
  test("the waiting commit stores the approval and the await_input checkpoint together", async () => {
    const h = await openHarness();
    const requested = requestApproval(h);
    const checkpoint = expectOk(await h.service.loadCheckpoint(requested.threadId));
    expect(checkpoint?.next).toBe("await_input");
    expect(checkpoint?.pendingToolCalls).toEqual([
      { toolCallId: "tc1", effectId: null, waiting: "approval" },
    ]);
    expect(expectOk(h.service.query.pendingApprovals(requested.threadId))).toEqual([
      {
        approvalId: requested.approvalId,
        threadId: requested.threadId,
        toolCallId: "tc1",
        resolved: false,
      },
    ]);
    expect(expectOk(h.service.query.thread(requested.threadId))?.pendingApprovals).toBe(1);
  });

  test("approval.resolved commits once: view.approval sees the request and a second response is rejected", async () => {
    const h = await openHarness();
    const requested = requestApproval(h);
    const first = expectOk(resolve(h, requested));
    expect(first.status).toBe("committed");
    expect(expectOk(h.service.query.pendingApprovals(requested.threadId))).toEqual([]);

    // 같은 응답은 기록된 결과로 돌아오고, 다른 키의 두 번째 응답은 이미 해결됐다고 거부된다
    const replay = expectOk(resolve(h, requested));
    expect(replay.status === "committed" && replay.replayed).toBe(true);
    const second = expectOk(
      commitResult(h, requested.threadId, "approval:res:again", (view): CommitPlan => {
        const known = view.approval(requested.approvalId);
        return known?.resolved === true
          ? { kind: "reject", code: "already_resolved", detail: null }
          : { kind: "reject", code: "approval_missing", detail: null };
      }),
    );
    expect(second).toMatchObject({ status: "rejected", code: "already_resolved" });
    expectProjectionsRebuildable(h.store.db);
  });

  test("a response to an approval that was never requested is rejected by build, not committed", async () => {
    const h = await openHarness();
    const requested = requestApproval(h);
    const unknown = { ...requested, approvalId: h.ids.next("evt") };
    expect(expectOk(resolve(h, unknown))).toMatchObject({
      status: "rejected",
      code: "approval_missing",
    });
  });

  test("recover lists the unresolved approval of the open turn", async () => {
    const h = await openHarness();
    const requested = requestApproval(h);
    const plan = expectOk(
      h.service.recover(requested.threadId, {
        toolReplay: () => "safe",
        cancelledByOwner: () => false,
        hostMode: "in-process",
      }),
    );
    expect(plan.pendingApprovals).toEqual([requested.approvalId]);
    expect(plan.next).toBe("await_input");
  });

  // spec plan resume_restores_pending_approval
  test("resume_restores_pending_approval: after a restart the same approval comes back and nothing is requested again", async () => {
    const h = await openHarness();
    const requested = requestApproval(h);
    const token = h.store.leases.inspect(`session:${requested.threadId}`);
    if (!token.ok || token.value === null) throw new Error("no lease");
    const restarted = await reopenHarness(h);
    expectOk(
      restarted.service.openForWrite(requested.threadId, {
        resource: `session:${requested.threadId}`,
        holderId: token.value.holderId,
        epoch: token.value.epoch,
      }),
    );
    const requestedCount = (): number | undefined =>
      restarted.store.raw
        .query<{ n: number }, []>(
          "SELECT COUNT(*) AS n FROM events WHERE kind = 'approval.requested'",
        )
        .get()?.n;
    const before = requestedCount();
    const plan = expectOk(
      restarted.service.recover(requested.threadId, {
        toolReplay: () => "safe",
        cancelledByOwner: () => false,
        hostMode: "in-process",
      }),
    );
    expect(plan.pendingApprovals).toEqual([requested.approvalId]);
    expect(plan.checkpoint?.pendingToolCalls).toEqual([
      { toolCallId: "tc1", effectId: null, waiting: "approval" },
    ]);
    expect(plan.next).toBe("await_input");
    expect(plan.reruns).toEqual([]);
    expect(requestedCount()).toBe(before);
    // 다시 열어도 응답은 한 번만 받는다
    expect((await resolveOn(restarted, requested)).status).toBe("committed");
    const after = expectOk(
      restarted.service.recover(requested.threadId, {
        toolReplay: () => "safe",
        cancelledByOwner: () => false,
        hostMode: "in-process",
      }),
    );
    expect(after.pendingApprovals).toEqual([]);
  });
});

async function resolveOn(h: Harness, requested: Requested): Promise<{ status: string }> {
  const result = resolve(h, requested);
  await Promise.resolve();
  return expectOk(result);
}
