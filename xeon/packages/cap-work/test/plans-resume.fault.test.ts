import { afterEach, describe, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import { readPlans } from "../src/projection/read.ts";
import { rejection } from "./support/assertions.ts";
import { openHarness, type Harness } from "./support/harness.ts";
import { PlanId } from "./support/plans.ts";

let opened: Harness | undefined;

afterEach(async () => {
  await opened?.[Symbol.asyncDispose]();
  opened = undefined;
});

function plan(h: Harness) {
  const read = readPlans(h.store.service.scoped("cap.work"), h.threadId);
  if (!read.ok) throw new Bug("read failed", { cause: read.error });
  return read.value[0];
}

describe("restart while a plan waits for approval", () => {
  test("a crash between the plan record and the approval request is repaired once at resume", async () => {
    opened = await openHarness();
    const h = opened;
    // 계획 기록은 커밋됐고 승인 요청이 저장소 실패로 나가지 못한다(프로세스가 여기서 끝난 것과 같다)
    h.approvals.failRequests(1);
    const crashed = await rejection(h.plans.submit({ title: "t", body: "b" }, h.opts("c1")));
    expect(crashed.data.code).toBe("unavailable");
    expect(plan(h)).toMatchObject({ status: "submitted", approvalId: null });
    expect(h.approvals.requests).toEqual([]);

    // 재시작: 새 런타임이 스레드를 다시 연다
    const restarted = h.restartPlans();
    await restarted.resume(h.threadId);
    expect(h.approvals.requests).toHaveLength(1);
    expect(plan(h)?.approvalId).toBe(h.approvals.requests[0]?.approvalId);

    // 도구 호출이 같은 입력과 같은 requestId로 다시 들어온다: 새 계획도 새 요청도 만들지 않는다
    const retried = await restarted.api.submit({ title: "t", body: "b" }, h.opts("c1"));
    expect(retried).toMatchObject({ status: "input_required", planId: "p1", version: 1 });
    expect(h.approvals.requests).toHaveLength(1);
    expect(readPlans(h.store.service.scoped("cap.work"), h.threadId)).toMatchObject({
      ok: true,
      value: [expect.anything()],
    });
  });

  test("after a restart the response reaches the retried submit exactly once as decided", async () => {
    opened = await openHarness();
    const h = opened;
    const first = await h.plans.submit({ title: "t", body: "b" }, h.opts("c1"));
    if (first.status !== "input_required") throw new Bug("expected input_required");

    const restarted = h.restartPlans();
    await restarted.resume(h.threadId);
    expect(h.approvals.requests).toHaveLength(1);
    await h.approvals.respond(first.approvalId, "allow");

    const decided = await restarted.api.submit({ title: "t", body: "b" }, h.opts("c1"));
    expect(decided).toMatchObject({ status: "decided", decision: "approved" });
    const again = await restarted.api.submit({ title: "t", body: "b" }, h.opts("c1"));
    expect(again).toEqual(decided);
    expect(h.approvals.requests).toHaveLength(1);
  });

  test("an approval that arrived while no listener ran is finished at resume", async () => {
    opened = await openHarness();
    const h = opened;
    h.mode.set(h.threadId, "acceptEdits");
    await h.plans.enterMode({}, h.opts("e1"));
    const out = await h.plans.submit({ title: "t", body: "b" }, h.opts("c1"));
    if (out.status !== "input_required") throw new Bug("expected input_required");
    h.listener?.stop();
    await h.approvals.respond(out.approvalId, "allow");
    await h.settle();
    expect(h.mode.current(h.threadId)).toBe("plan");

    const restarted = h.restartPlans();
    await restarted.resume(h.threadId);
    expect(h.mode.current(h.threadId)).toBe("acceptEdits");
    await restarted.resume(h.threadId);
    expect(h.mode.calls.filter((call) => call.startsWith("restore"))).toHaveLength(1);
  });

  test("a plan response given before the restart is not lost for decide methods", async () => {
    opened = await openHarness();
    const h = opened;
    await h.plans.submit({ title: "t", body: "b" }, h.opts("c1"));
    const restarted = h.restartPlans();
    const approved = await restarted.api.approve({ planId: PlanId("p1") }, h.opts("d1"));
    expect(approved.plan.status).toBe("approved");
  });
});
