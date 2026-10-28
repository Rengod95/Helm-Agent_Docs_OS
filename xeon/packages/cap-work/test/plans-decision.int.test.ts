import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Bug, eachAsync, parse } from "@xeon/contracts";
import {
  PlanApprovalSubjectSchema,
  PlanSubmitOutput,
  type CallContext,
} from "@xeon/contracts/capabilities";
import {
  ApprovalAnswerSchema,
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

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

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
    // E5: 질문·MCP 질문과 같은 레코드 모양. 봉투 필드, 출처 필드, 기억 범위가 kind와 무관하게 같다
    // (cap-dialog `ask-flow.test.ts`가 같은 목록을 kind question에서 단언한다)
    expect(Object.keys(events[0] ?? {}).toSorted()).toEqual([
      "body",
      "origin",
      "remember",
      "requestKey",
      "requestedAt",
      "surfaceThreadId",
      "title",
    ]);
    if (payload.ok) {
      expect(Object.keys(payload.value.origin).toSorted()).toEqual([
        "caller",
        "stepId",
        "threadId",
        "toolCallId",
        "turnId",
      ]);
      expect(payload.value.remember).toEqual(["once"]);
      expect(payload.value.surfaceThreadId).toBe(payload.value.origin.threadId);
    }
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

  test("the request origin caller is what approvalCallerOf makes from the call context (G1-09)", async () => {
    const cases: readonly (readonly [string, CallContext["caller"], string])[] = [
      ["main conversation", { kind: "model", agent: "main" }, "main"],
      ["subagent", { kind: "model", agent: "subagent", agentName: "explore" }, "subagent:explore"],
      ["background fork", { kind: "model", agent: "background" }, "background"],
      ["extension", { kind: "extension", extension: "grp-helm" }, "ext:grp-helm"],
      ["host", { kind: "host" }, "host"],
    ];
    await eachAsync(cases, async ([name, caller, expected]) => {
      const h = await harness();
      await h.plans.submit(
        { title: "Refactor the loader", body: "1. split\n2. test" },
        { requestId: "call-1", context: { threadId: h.threadId, caller } },
      );
      const origins: unknown[] = [];
      for await (const item of h.session.readFrom(0)) {
        if (item.ok && item.value.kind === "approval.requested") origins.push(item.value.payload);
      }
      const payload = parse(ApprovalRequestedPayloadSchema, origins[0]);
      expect([name, payload.ok ? payload.value.origin.caller : undefined]).toEqual([
        name,
        expected,
      ]);
      await opened?.[Symbol.asyncDispose]();
      opened = undefined;
      return undefined;
    });
  });

  test("allow approves and deny rejects with the feedback; a decision the plan kind does not take is not applied", async () => {
    const h = await harness();
    const first = await submit(h, "c1");
    if (first.status !== "input_required") throw new Bug("expected input_required");
    expect(await h.approvals.respond(first.approvalId, "allow", { note: "go" })).toBe(true);
    expect(await submit(h, "c1")).toMatchObject({
      status: "decided",
      decision: "approved",
      feedback: null,
    });

    const second = await submit(h, "c2");
    if (second.status !== "input_required") throw new Bug("expected input_required");
    expect(await h.approvals.respond(second.approvalId, "deny", { feedback: "too risky" })).toBe(
      true,
    );
    expect(await submit(h, "c2")).toMatchObject({
      status: "decided",
      planId: "p2",
      decision: "rejected",
      feedback: "too risky",
    });

    // 계획 승인은 answer 결정을 받지 않는다(L1.tools.spec §3.6 표). 응답은 적용되지 않고 요청은 대기로 남는다
    const third = await submit(h, "c3");
    if (third.status !== "input_required") throw new Bug("expected input_required");
    expect(await h.approvals.respond(third.approvalId, "answer", { feedback: "split" })).toBe(
      false,
    );
    expect(await submit(h, "c3")).toMatchObject({ status: "input_required", planId: "p3" });
    // 정본 모양이 아닌 answer(허용 안 되는 mode)도 적용되지 않는다
    expect(await h.approvals.respond(third.approvalId, "allow", { mode: "bypass" })).toBe(false);
    expect(latestOf(h).map((p) => `${p.planId}:${p.status}:${p.feedback}`)).toEqual([
      "p1:approved:null",
      "p2:rejected:too risky",
      "p3:submitted:null",
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

    // 수정 요청은 wire에서 deny + { feedback }이다. 기록에서는 반려와 같다(통합 항목 W-2 (c))
    await submit(h, "c3");
    const revised = await h.plans.revise({ planId: PlanId("p3"), feedback: "again" }, h.opts("d3"));
    expect(revised.plan).toMatchObject({ status: "rejected", feedback: "again" });

    // 세 결정 모두 approval.resolved 한 건으로 남고 카탈로그 스키마와 wire 정본 answer 모양을 통과한다
    const decisions: string[] = [];
    for await (const item of h.session.readFrom(0)) {
      if (!item.ok || item.value.kind !== "approval.resolved") continue;
      const payload = parse(ApprovalResolvedPayloadSchema, item.value.payload);
      if (!payload.ok) continue;
      decisions.push(`${payload.value.decision}:${payload.value.resolvedBy}`);
      if (payload.value.answer !== null) {
        expect(parse(ApprovalAnswerSchema, payload.value.answer).ok).toBe(true);
      }
    }
    expect(decisions).toEqual(["allow:user", "deny:user", "deny:user"]);
  });

  test("the respond requestId is the F requestKeyFor of the call requestId", async () => {
    const h = await harness();
    const long = "r".repeat(49);
    const odd = "call:with space";
    await submit(h, "c1");
    await h.plans.approve({ planId: PlanId("p1") }, h.opts("d1"));
    await submit(h, "c2");
    await h.plans.reject({ planId: PlanId("p2"), reason: "no" }, h.opts(long));
    await submit(h, "c3");
    await h.plans.reject({ planId: PlanId("p3"), reason: "no" }, h.opts(odd));
    expect(h.approvals.respondRequestIds).toEqual([
      "d1",
      `h_${sha(long).slice(0, 40)}`,
      `h_${sha(odd).slice(0, 40)}`,
    ]);
    for (const key of h.approvals.respondRequestIds) expect(key).toMatch(/^[A-Za-z0-9_.-]{1,48}$/);
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

  test("without an approval service the submit is unavailable and the plan is not recorded", async () => {
    const h = await harness();
    const bare = h.restartPlans({ approvals: undefined });
    const error = await rejection(bare.api.submit({ title: "t", body: "b" }, h.opts("c1")));
    expect(error.data.code).toBe("unavailable");
    expect(latestOf(h)).toEqual([]);
  });
});
