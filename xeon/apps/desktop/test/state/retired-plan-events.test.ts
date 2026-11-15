import { describe, expect, test } from "bun:test";
import { Bug, parse } from "@fresnel/contracts";
import { ApprovalRequestedPayloadSchema } from "@fresnel/contracts/records";
import type { EventWire } from "@fresnel/contracts/wire";
import { decodeDurable, decodePendingApprovals } from "../../src/state/engine/decode.ts";
import type { MirrorInput } from "../../src/state/engine/input.ts";
import { reduceMirror } from "../../src/state/engine/reduce.ts";
import { INITIAL_MIRROR, type EngineMirror } from "../../src/state/engine/state.ts";
import { STORE, SUB, evt, thr } from "./helpers.ts";

// 은퇴한 계획 사건(`work.plan_submitted`·`work.plan_withdrawn`)과 옛 계획 승인 요청(`approval.requested`의 `plan` 본문)은
// 알 수 없는 종류로 건너뛴다. 거울에 계획 기록이나 승인 카드가 생기지 않고, 뒤의 사건은 평소처럼 들어간다.

const T = thr(1);
const AT = "2026-11-04T00:00:00.000Z";

function wire(seq: number, kind: EventWire["kind"], payload: unknown): EventWire {
  return {
    id: evt(seq),
    kind,
    version: 1,
    durable: true,
    seq,
    parentId: null,
    threadId: T,
    turnId: null,
    stepId: null,
    recordedAt: AT,
    causationId: null,
    correlationId: null,
    payload,
    redactions: [],
  };
}

const SUBMITTED = {
  planId: "p1",
  version: 1,
  title: "옛 계획",
  body: "1. 읽기",
  artifact: null,
  supersedes: null,
};

function oldPlanRequest() {
  const parsed = parse(ApprovalRequestedPayloadSchema, {
    origin: { threadId: T, turnId: null, stepId: null, toolCallId: null, caller: "main" },
    requestKey: "plan-1",
    title: "Review the plan",
    body: { kind: "plan", plan: { plan: "1. 읽기", planRef: null, nextModes: ["default"] } },
    remember: ["once"],
    surfaceThreadId: T,
    requestedAt: 1,
  });
  if (!parsed.ok) throw new Bug("the old plan request fixture must match its schema");
  return parsed.value;
}

describe("retired plan events", () => {
  test("an old work.plan_submitted event decodes as an unknown kind, keeping its position", () => {
    expect(decodeDurable(wire(1, "work.plan_submitted", SUBMITTED))).toEqual({
      type: "other",
      seq: 1,
      eventId: evt(1),
      threadId: T,
      turnId: null,
      at: AT,
    });
  });

  test("an old work.plan_withdrawn event is an unknown kind too", () => {
    const fact = decodeDurable(
      wire(2, "work.plan_withdrawn", { planId: "p1", version: 1, reason: "exit_mode" }),
    );
    expect(fact.type).toBe("other");
  });

  test("the mirror moves past old plan events as it does past any unknown kind", () => {
    const facts = [
      decodeDurable(wire(1, "work.plan_submitted", SUBMITTED)),
      decodeDurable(
        wire(2, "work.plan_withdrawn", { planId: "p1", version: 1, reason: "exit_mode" }),
      ),
    ];
    const inputs: MirrorInput[] = [
      { type: "subscribed", sub: SUB, storeId: STORE, start: 0, live: true, from: "head" },
      { type: "batch", sub: SUB, from: 0, to: 2, caughtUp: true, facts },
    ];
    let state: EngineMirror = INITIAL_MIRROR;
    for (const input of inputs) state = reduceMirror(state, input).state;
    expect(state.cursor).toEqual({ storeId: STORE, seq: 2 });
    expect(state.queuedInputs).toEqual([]);
    expect(state.approvals.ids).toEqual([]);
  });

  test("an old plan approval request is not put on the approval list, live or pending", () => {
    const request = oldPlanRequest();
    expect(decodeDurable(wire(3, "approval.requested", request)).type).toBe("other");
    expect(
      decodePendingApprovals({ approvals: [{ approvalId: evt(3), seq: 3, request }] }),
    ).toEqual([]);
  });
});
