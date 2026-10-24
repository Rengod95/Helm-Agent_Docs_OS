import { afterEach, describe, expect, test } from "bun:test";
import { Bug, parse } from "@xeon/contracts";
import {
  PlanApprovalAnswerSchema,
  PlanApprovalSubjectSchema,
  PlanSubmitOutput,
} from "@xeon/contracts/capabilities";
import {
  ApprovalRequestedPayloadSchema,
  ApprovalResolvedPayloadSchema,
} from "@xeon/contracts/records";
import { PLAN_REF_PATTERN } from "../src/plans/refs.ts";
import { rejection } from "./support/assertions.ts";
import { openHarness, type Harness } from "./support/harness.ts";
import { readPlans } from "../src/projection/read.ts";
import { PlanId } from "./support/plans.ts";

let opened: Harness | undefined;

async function harness(...args: Parameters<typeof openHarness>): Promise<Harness> {
  opened = await openHarness(...args);
  return opened;
}

afterEach(async () => {
  await opened?.[Symbol.asyncDispose]();
  opened = undefined;
});

async function submit(h: Harness, requestId = "call-1", planId?: string) {
  return await h.plans.submit(
    {
      title: "Refactor the loader",
      body: "1. split\n2. test",
      ...(planId === undefined ? {} : { planId: PlanId(planId) }),
    },
    h.opts(requestId),
  );
}

function latestOf(h: Harness) {
  const read = readPlans(h.store.service.scoped("cap.work"), h.threadId);
  if (!read.ok) throw new Bug("read failed", { cause: read.error });
  return read.value;
}

describe("submit_plan and the approval record", () => {
  test("submit makes a kind plan approval request that has the same record shape as every other request", async () => {
    const h = await harness();
    const out = await submit(h);
    expect(out).toMatchObject({ status: "input_required", planId: "p1", version: 1 });
    expect(parse(PlanSubmitOutput, out).ok).toBe(true);

    const [request] = h.approvals.requests;
    expect(request?.kind).toBe("plan");
    expect(request?.requestId).toBe("plan:p1:1");
    // 이벤트 로그에 남은 approval.requested가 L1 카탈로그 스키마를 통과한다
    const events: unknown[] = [];
    for await (const item of h.session.readFrom(0)) {
      if (item.ok && item.value.kind === "approval.requested") events.push(item.value.payload);
    }
    expect(events).toHaveLength(1);
    const payload = parse(ApprovalRequestedPayloadSchema, events[0]);
    expect(payload.ok && payload.value.body.kind).toBe("plan");
    if (payload.ok && payload.value.body.kind === "plan") {
      expect(payload.value.body.plan.plan).toBe("1. split\n2. test");
      expect(PLAN_REF_PATTERN.exec(payload.value.body.plan.planRef ?? "")).not.toBeNull();
      expect(payload.value.body.plan.nextModes).toEqual(["default", "acceptEdits"]);
    }
    // 도메인 대상은 PlanApprovalSubjectSchema를 통과하고 계획 행과 일치한다
    const [row] = latestOf(h);
    expect(
      parse(PlanApprovalSubjectSchema, {
        planId: row?.planId,
        version: row?.version,
        title: row?.title,
        body: row?.body,
        artifact: row?.artifact,
      }).ok,
    ).toBe(true);
    expect(row?.approvalId).toBe(request?.approvalId);
    expect(row?.status).toBe("submitted");
  });

  test("allow approves, deny rejects with the feedback, answer asks for a revision", async () => {
    const h = await harness();
    const first = await submit(h, "c1");
    if (first.status !== "input_required") throw new Bug("expected input_required");
    await h.approvals.respond(first.approvalId, "allow", { note: "go" });
    expect(await submit(h, "c1")).toMatchObject({
      status: "decided",
      decision: "approved",
      feedback: null,
    });

    const second = await submit(h, "c2");
    if (second.status !== "input_required") throw new Bug("expected input_required");
    await h.approvals.respond(second.approvalId, "deny", { feedback: "too risky" });
    expect(await submit(h, "c2")).toMatchObject({
      status: "decided",
      planId: "p2",
      decision: "rejected",
      feedback: "too risky",
    });

    const third = await submit(h, "c3");
    if (third.status !== "input_required") throw new Bug("expected input_required");
    await h.approvals.respond(third.approvalId, "answer", {
      action: "revise",
      feedback: "split step 2",
    });
    expect(await submit(h, "c3")).toMatchObject({
      status: "decided",
      planId: "p3",
      decision: "revision_requested",
      feedback: "split step 2",
    });
    expect(latestOf(h).map((p) => `${p.planId}:${p.status}:${p.feedback}`)).toEqual([
      "p1:approved:null",
      "p2:rejected:too risky",
      "p3:revision_requested:split step 2",
    ]);
  });

  test("approve, reject and revise answer through the same approval record", async () => {
    const h = await harness();
    await submit(h, "c1");
    const approved = await h.plans.approve({ planId: PlanId("p1"), note: "ok" }, h.opts("d1"));
    expect(approved.plan).toMatchObject({ planId: "p1", version: 1, status: "approved" });

    await submit(h, "c2");
    const rejected = await h.plans.reject({ planId: PlanId("p2"), reason: "no" }, h.opts("d2"));
    expect(rejected.plan).toMatchObject({ status: "rejected", feedback: "no" });

    await submit(h, "c3");
    const revised = await h.plans.revise({ planId: PlanId("p3"), feedback: "again" }, h.opts("d3"));
    expect(revised.plan).toMatchObject({ status: "revision_requested", feedback: "again" });

    // 세 결정 모두 approval.resolved 한 건으로 남고 카탈로그 스키마를 통과한다
    const decisions: string[] = [];
    for await (const item of h.session.readFrom(0)) {
      if (!item.ok || item.value.kind !== "approval.resolved") continue;
      const payload = parse(ApprovalResolvedPayloadSchema, item.value.payload);
      if (payload.ok) decisions.push(`${payload.value.decision}:${payload.value.resolvedBy}`);
    }
    expect(decisions).toEqual(["allow:user", "deny:user", "answer:user"]);
  });

  test("a decided version rejects another decision with plan_closed and its status", async () => {
    const h = await harness();
    await submit(h, "c1");
    await h.plans.approve({ planId: PlanId("p1") }, h.opts("d1"));
    const error = await rejection(h.plans.reject({ planId: PlanId("p1") }, h.opts("d2")));
    expect(error.data.code).toBe("plan_closed");
    expect(error.data.detail).toEqual({ status: "approved" });
    const missing = await rejection(h.plans.approve({ planId: PlanId("p9") }, h.opts("d3")));
    expect(missing.data.code).toBe("not_found");
  });

  test("a cancelled request reads as withdrawn and the submit retry reports it as rejected", async () => {
    const h = await harness();
    const first = await submit(h, "c1");
    if (first.status !== "input_required") throw new Bug("expected input_required");
    const port = h.approvals.factory({
      threadId: h.threadId,
      turnId: null,
      stepId: null,
      toolCallId: null,
      caller: "main",
    });
    await port.cancel(h.threadId, first.approvalId, "turn cancelled");
    expect(latestOf(h)[0]?.status).toBe("withdrawn");
    const again = await submit(h, "c1");
    expect(again).toMatchObject({ status: "decided", decision: "rejected" });
  });

  test("a group can wait for the decision in memory", async () => {
    const h = await harness();
    const waiting = h.plans.submit({ title: "t", body: "b", wait: true }, h.opts("w1"));
    await h.settle();
    const request = h.approvals.requests[0];
    if (request === undefined) throw new Bug("no request");
    await h.approvals.respond(request.approvalId, "allow");
    expect(await waiting).toMatchObject({ status: "decided", decision: "approved" });
  });

  test("a group waiting for the decision does not block approve on the same plan", async () => {
    const h = await harness();
    const waiting = h.plans.submit({ title: "t", body: "b", wait: true }, h.opts("w1"));
    await h.settle();
    const approved = await h.plans.approve({ planId: PlanId("p1") }, h.opts("d1"));
    expect(approved.plan.status).toBe("approved");
    expect(await waiting).toMatchObject({ status: "decided", decision: "approved" });
  });

  test("the revise answer shape is the one the answer schema describes", () => {
    expect(parse(PlanApprovalAnswerSchema, { action: "revise", feedback: "x" }).ok).toBe(true);
    expect(parse(PlanApprovalAnswerSchema, { action: "revise" }).ok).toBe(false);
  });

  test("without an approval service the submit is unavailable and the plan is not recorded", async () => {
    const h = await harness();
    const bare = h.restartPlans({ approvals: undefined });
    const error = await rejection(bare.api.submit({ title: "t", body: "b" }, h.opts("c1")));
    expect(error.data.code).toBe("unavailable");
    expect(latestOf(h)).toEqual([]);
  });
});
