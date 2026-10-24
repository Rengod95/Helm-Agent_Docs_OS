import { describe, expect, test } from "bun:test";
import { err, ok, type Result } from "../../src/index.ts";
import type { ApprovalId, JsonValue, ThreadId } from "../../src/conversation/index.ts";
import {
  L2_APPROVAL_REQUEST_ID_MAX,
  type ApprovalDecision,
  type ApprovalKind,
  type ApprovalRequestError,
  type ApprovalResolution,
  type L2ApprovalKind,
  type L2ApprovalRequest,
  type L2ApprovalSnapshot,
  type L2ApprovalsPort,
} from "../../src/services/index.ts";
import { ApprovalIdSchema, ThreadIdSchema } from "../../src/conversation/index.ts";
import type { Equal, Expect } from "../types/expect.ts";
import { must, rawId } from "../helpers/ids.ts";

export type KindsFollowTheApprovalProtocol = Expect<Equal<L2ApprovalKind, ApprovalKind>>;
export type DecisionsFollowTheWire = Expect<
  Equal<NonNullable<L2ApprovalSnapshot["resolution"]>["decision"], ApprovalDecision>
>;
export type ResolutionDecisionMatchesApprovalService = Expect<
  Equal<NonNullable<L2ApprovalSnapshot["resolution"]>["decision"], ApprovalResolution["decision"]>
>;

const THREAD: ThreadId = must(ThreadIdSchema, rawId("thr", 1));
const SIGNAL = new AbortController().signal;

/** 메모리 대역. 같은 requestId의 두 번째 request는 새 요청을 만들지 않는다 */
function memoryPort(): {
  readonly port: L2ApprovalsPort;
  readonly requestsMade: () => number;
  readonly resolve: (id: ApprovalId, decision: ApprovalDecision, answer: JsonValue | null) => void;
} {
  const byRequestId = new Map<string, ApprovalId>();
  const snapshots = new Map<ApprovalId, L2ApprovalSnapshot>();
  const waiters = new Map<ApprovalId, ((snapshot: L2ApprovalSnapshot) => void)[]>();
  let made = 0;
  const port: L2ApprovalsPort = {
    request(input: L2ApprovalRequest): Promise<Result<L2ApprovalSnapshot, ApprovalRequestError>> {
      const existing = byRequestId.get(input.requestId);
      const known = existing === undefined ? undefined : snapshots.get(existing);
      if (known !== undefined) return Promise.resolve(ok(known));
      made += 1;
      const approvalId = must(ApprovalIdSchema, rawId("evt", made));
      const snapshot: L2ApprovalSnapshot = { approvalId, state: "pending", resolution: null };
      byRequestId.set(input.requestId, approvalId);
      snapshots.set(approvalId, snapshot);
      return Promise.resolve(ok(snapshot));
    },
    get: (_threadId, approvalId) => Promise.resolve(ok(snapshots.get(approvalId) ?? null)),
    respond: (input) => {
      const current = snapshots.get(input.approvalId);
      if (current === undefined || current.state !== "pending") {
        return Promise.resolve({ applied: false });
      }
      resolveWith(input.approvalId, input.decision, input.answer ?? null);
      return Promise.resolve({ applied: true });
    },
    cancel: (_threadId, approvalId) => {
      const current = snapshots.get(approvalId);
      if (current === undefined || current.state !== "pending") {
        return Promise.resolve({ applied: false });
      }
      const next: L2ApprovalSnapshot = { ...current, state: "cancelled" };
      snapshots.set(approvalId, next);
      for (const wake of waiters.get(approvalId) ?? []) wake(next);
      return Promise.resolve({ applied: true });
    },
    wait: (_threadId, approvalId, signal) =>
      new Promise((resolve) => {
        const current = snapshots.get(approvalId);
        if (current !== undefined && current.state !== "pending") {
          resolve(ok(current));
          return;
        }
        const list = waiters.get(approvalId) ?? [];
        list.push((snapshot) => {
          resolve(ok(snapshot));
        });
        waiters.set(approvalId, list);
        signal.addEventListener("abort", () => {
          resolve(err({ kind: "cancelled" }));
        });
      }),
  };
  function resolveWith(id: ApprovalId, decision: ApprovalDecision, answer: JsonValue | null): void {
    const next: L2ApprovalSnapshot = {
      approvalId: id,
      state: "resolved",
      resolution: { decision, answer },
    };
    snapshots.set(id, next);
    for (const wake of waiters.get(id) ?? []) wake(next);
  }
  return { port, requestsMade: () => made, resolve: resolveWith };
}

function planRequest(requestId: string): L2ApprovalRequest {
  return {
    threadId: THREAD,
    kind: "plan",
    subject: { planId: "p1", version: 1, title: "Plan", body: "# steps", artifact: null },
    requestId,
  };
}

describe("L2ApprovalsPort", () => {
  test("the same requestId returns the existing request instead of making another", async () => {
    const { port, requestsMade } = memoryPort();
    const first = await port.request(planRequest("work:plans:R1"));
    const again = await port.request(planRequest("work:plans:R1"));
    const other = await port.request(planRequest("work:plans:R2"));
    expect(first.ok && again.ok && first.value.approvalId === again.value.approvalId).toBe(true);
    expect(other.ok && first.ok && other.value.approvalId !== first.value.approvalId).toBe(true);
    expect(requestsMade()).toBe(2);
  });

  test("a response resolves a waiting caller once and later responses are not applied", async () => {
    const { port } = memoryPort();
    const requested = await port.request(planRequest("work:plans:R1"));
    if (!requested.ok) throw new Error("request failed");
    const { approvalId } = requested.value;
    const waiting = port.wait(THREAD, approvalId, SIGNAL);
    const first = await port.respond({
      threadId: THREAD,
      approvalId,
      decision: "answer",
      answer: { action: "revise", feedback: "split step 2" },
      requestId: "respond:1",
    });
    expect(first).toEqual({ applied: true });
    const settled = await waiting;
    expect(settled.ok && settled.value.resolution?.decision).toBe("answer");
    const second = await port.respond({
      threadId: THREAD,
      approvalId,
      decision: "allow",
      requestId: "respond:2",
    });
    expect(second).toEqual({ applied: false });
  });

  test("an aborted wait stops waiting and leaves the request pending", async () => {
    const { port } = memoryPort();
    const requested = await port.request(planRequest("work:plans:R1"));
    if (!requested.ok) throw new Error("request failed");
    const controller = new AbortController();
    const waiting = port.wait(THREAD, requested.value.approvalId, controller.signal);
    controller.abort();
    expect(await waiting).toEqual(err({ kind: "cancelled" }));
    const current = await port.get(THREAD, requested.value.approvalId);
    expect(current.ok && current.value?.state).toBe("pending");
  });

  test("a cancelled request reports cancelled to waiters", async () => {
    const { port } = memoryPort();
    const requested = await port.request(planRequest("work:plans:R1"));
    if (!requested.ok) throw new Error("request failed");
    const waiting = port.wait(THREAD, requested.value.approvalId, SIGNAL);
    expect(await port.cancel(THREAD, requested.value.approvalId, "turn aborted")).toEqual({
      applied: true,
    });
    const settled = await waiting;
    expect(settled.ok && settled.value.state).toBe("cancelled");
  });

  test("the request id limit matches the approval record's request key", () => {
    expect(L2_APPROVAL_REQUEST_ID_MAX).toBe(48);
  });
});
