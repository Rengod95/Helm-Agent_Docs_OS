import { afterEach, describe, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import { DEFAULT_WORK_SETTINGS } from "../src/settings.ts";
import { readModeMeta, readPlans } from "../src/projection/read.ts";
import { rejection } from "./support/assertions.ts";
import { openHarness, type Harness } from "./support/harness.ts";
import { PlanId } from "./support/plans.ts";

let opened: Harness | undefined;

afterEach(async () => {
  await opened?.[Symbol.asyncDispose]();
  opened = undefined;
});

async function harness(requireApproval = true, exitOnApprove = true): Promise<Harness> {
  opened = await openHarness({
    settings: { ...DEFAULT_WORK_SETTINGS, plans: { requireApproval, exitOnApprove } },
  });
  return opened;
}

function meta(h: Harness) {
  const read = readModeMeta(h.store.service.scoped("cap.work"), h.threadId);
  if (!read.ok) throw new Bug("read failed", { cause: read.error });
  return read.value;
}

function statuses(h: Harness): string[] {
  const read = readPlans(h.store.service.scoped("cap.work"), h.threadId);
  if (!read.ok) throw new Bug("read failed", { cause: read.error });
  return read.value.map((p) => `${p.planId}:${p.status}`);
}

describe("entering plan mode", () => {
  test("enterMode switches to plan and reports the previous mode, also on a retry", async () => {
    const h = await harness();
    await h.mode.set(h.threadId, "acceptEdits");
    const out = await h.plans.enterMode({}, h.opts("e1"));
    expect(out).toEqual({ mode: "plan", previousMode: "acceptEdits" });
    expect(h.mode.current(h.threadId)).toBe("plan");
    expect(meta(h)).toMatchObject({ mode: "plan", modeBeforePlan: "acceptEdits" });
    const again = await h.plans.enterMode({}, h.opts("e1"));
    expect(again).toEqual({ mode: "plan", previousMode: "acceptEdits" });
  });

  test("the previous mode survives a restart through the session history", async () => {
    const h = await harness();
    await h.mode.set(h.threadId, "acceptEdits");
    await h.plans.enterMode({}, h.opts("e1"));
    const restarted = h.restartPlans();
    const again = await restarted.api.enterMode({}, h.opts("e2"));
    expect(again.previousMode).toBe("acceptEdits");
  });

  test("restoring a mode that the policy has forbidden since is denied and keeps plan mode", async () => {
    const h = await harness(false);
    await h.mode.set(h.threadId, "bypass");
    await h.plans.enterMode({}, h.opts("e1"));
    // 조직 정책이 그 사이 bypass를 막았다(실제 ToolService.setMode가 거부한다)
    h.setLayers([{ scope: "managed", values: new Map([["l1.tools.bypassAllowed", false]]) }]);
    const error = await rejection(h.plans.exitMode({}, h.opts("x1")));
    expect(error.data.code).toBe("denied");
    expect(h.mode.current(h.threadId)).toBe("plan");
  });

  test("without a mode service the call is unavailable", async () => {
    const h = await harness();
    const bare = h.restartPlans({ mode: undefined });
    const error = await rejection(bare.api.enterMode({}, h.opts("e1")));
    expect(error.data.code).toBe("unavailable");
  });
});

describe("leaving plan mode", () => {
  test("outside plan mode exitMode is plan_mode_inactive", async () => {
    const h = await harness();
    const error = await rejection(h.plans.exitMode({}, h.opts("x1")));
    expect(error.data.code).toBe("plan_mode_inactive");
  });

  test("with approval required, leaving before approval is refused and nothing is restored", async () => {
    const h = await harness();
    await h.plans.enterMode({}, h.opts("e1"));
    const empty = await rejection(h.plans.exitMode({}, h.opts("x1")));
    expect(empty.data.code).toBe("plan_not_approved");
    await h.plans.submit({ title: "t", body: "b" }, h.opts("c1"));
    const pending = await rejection(h.plans.exitMode({}, h.opts("x2")));
    expect(pending.data.code).toBe("plan_not_approved");
    expect(h.mode.calls.filter((call) => call.startsWith("restore"))).toEqual([]);
    expect(h.mode.current(h.threadId)).toBe("plan");
  });

  test("an approval leaves plan mode once when exitOnApprove is on", async () => {
    const h = await harness();
    await h.mode.set(h.threadId, "acceptEdits");
    await h.plans.enterMode({}, h.opts("e1"));
    await h.plans.submit({ title: "t", body: "b" }, h.opts("c1"));
    await h.plans.approve({ planId: PlanId("p1") }, h.opts("d1"));
    await h.settle();
    expect(h.mode.current(h.threadId)).toBe("acceptEdits");
    expect(h.mode.calls.filter((call) => call.startsWith("restore"))).toEqual([
      "restore:acceptEdits:plan_approval",
    ]);
    // 이미 나왔으므로 같은 승인을 다시 알려도 더 바꾸지 않는다
    await h.runtime.resume(h.threadId);
    expect(h.mode.calls.filter((call) => call.startsWith("restore"))).toHaveLength(1);
  });

  test("with exitOnApprove off the approval leaves the mode, and exitMode then restores it", async () => {
    const h = await harness(true, false);
    await h.plans.enterMode({}, h.opts("e1"));
    await h.plans.submit({ title: "t", body: "b" }, h.opts("c1"));
    await h.plans.approve({ planId: PlanId("p1") }, h.opts("d1"));
    await h.settle();
    expect(h.mode.current(h.threadId)).toBe("plan");
    const out = await h.plans.exitMode({}, h.opts("x1"));
    expect(out).toEqual({ mode: "default", previousMode: "plan" });
    expect(h.mode.calls.filter((call) => call.startsWith("restore"))).toEqual([
      "restore:default:user",
    ]);
  });

  test("a mode the approver picks wins over the restore", async () => {
    const h = await harness();
    await h.mode.set(h.threadId, "acceptEdits");
    await h.plans.enterMode({}, h.opts("e1"));
    const out = await h.plans.submit({ title: "t", body: "b" }, h.opts("c1"));
    if (out.status !== "input_required") throw new Bug("expected input_required");
    await h.approvals.respond(out.approvalId, "allow", { mode: "default" });
    await h.settle();
    expect(h.mode.current(h.threadId)).toBe("default");
    expect(h.mode.calls.filter((call) => call.startsWith("restore"))).toEqual([]);
  });

  test("a plan submitted before entering plan mode does not count", async () => {
    const h = await harness();
    await h.plans.submit({ title: "old", body: "b" }, h.opts("c0"));
    await h.plans.approve({ planId: PlanId("p1") }, h.opts("d0"));
    await h.plans.enterMode({}, h.opts("e1"));
    const error = await rejection(h.plans.exitMode({}, h.opts("x1")));
    expect(error.data.code).toBe("plan_not_approved");
  });

  test("without the approval requirement exitMode withdraws a pending plan and closes its request", async () => {
    const h = await harness(false);
    await h.plans.enterMode({}, h.opts("e1"));
    await h.plans.submit({ title: "t", body: "b" }, h.opts("c1"));
    const out = await h.plans.exitMode({}, h.opts("x1"));
    expect(out).toEqual({ mode: "default", previousMode: "plan" });
    expect(statuses(h)).toEqual(["p1:withdrawn"]);
    let withdrawn = 0;
    for await (const item of h.session.readFrom(0)) {
      if (item.ok && item.value.kind === "work.plan_withdrawn") withdrawn += 1;
    }
    expect(withdrawn).toBe(1);
    // 같은 requestId 재호출은 이미 나온 상태라 plan_mode_inactive다(알려진 한계: 모드 전환은 이벤트로 기록하지 않는다)
    const again = await rejection(h.plans.exitMode({}, h.opts("x1")));
    expect(again.data.code).toBe("plan_mode_inactive");
  });

  test("a configured plan mode with no entry event still counts every plan", async () => {
    const h = await harness();
    // 파일 설정이 plan으로 시작시킨 대화: 모드 진입 이벤트가 없다
    h.setLayers([{ scope: "user", values: new Map([["l1.tools.permissionMode", "plan"]]) }]);
    expect(h.mode.current(h.threadId)).toBe("plan");
    await h.plans.submit({ title: "t", body: "b" }, h.opts("c1"));
    await h.plans.approve({ planId: PlanId("p1") }, h.opts("d1"));
    await h.settle();
    expect(h.mode.current(h.threadId)).toBe("default");
  });
});
