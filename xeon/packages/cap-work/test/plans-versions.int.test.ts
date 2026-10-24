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

async function harness(): Promise<Harness> {
  opened = await openHarness();
  return opened;
}

function rows(h: Harness) {
  const read = readPlans(h.store.service.scoped("cap.work"), h.threadId);
  if (!read.ok) throw new Bug("read failed", { cause: read.error });
  return read.value.map((p) => `${p.planId}v${p.version}:${p.status}`);
}

describe("plan versions", () => {
  test("a revision request keeps v1 and the next submit makes v2 of the same plan", async () => {
    const h = await harness();
    await h.plans.submit({ title: "Plan", body: "v1 body" }, h.opts("c1"));
    await h.plans.revise({ planId: PlanId("p1"), feedback: "add tests" }, h.opts("d1"));
    const second = await h.plans.submit(
      { title: "Plan", body: "v2 body", planId: PlanId("p1") },
      h.opts("c2"),
    );
    expect(second).toMatchObject({ status: "input_required", planId: "p1", version: 2 });
    expect(rows(h)).toEqual(["p1v1:revision_requested", "p1v2:submitted"]);
    const listed = await h.plans.versions({ planId: PlanId("p1") }, h.opts());
    expect(listed.versions.map((v) => [v.version, v.status, v.body, v.feedback].join("|"))).toEqual(
      ["1|revision_requested|v1 body|add tests", "2|submitted|v2 body|"],
    );
  });

  test("a new version while the old one waits for approval is plan_pending and writes nothing", async () => {
    const h = await harness();
    await h.plans.submit({ title: "Plan", body: "v1" }, h.opts("c1"));
    const events = h.eventCount();
    const error = await rejection(
      h.plans.submit({ title: "Plan", body: "v2", planId: PlanId("p1") }, h.opts("c2")),
    );
    expect(error.data.code).toBe("plan_pending");
    expect(h.eventCount()).toBe(events);
    // 같은 requestId로 다시 불러도 같은 거부다
    const again = await rejection(
      h.plans.submit({ title: "Plan", body: "v2", planId: PlanId("p1") }, h.opts("c2")),
    );
    expect(again.data).toEqual(error.data);
  });

  test("an unknown plan id is not_found and a new plan gets the next number", async () => {
    const h = await harness();
    const missing = await rejection(
      h.plans.submit({ title: "t", body: "b", planId: PlanId("p4") }, h.opts("c1")),
    );
    expect(missing.data.code).toBe("not_found");
    await h.plans.submit({ title: "a", body: "a" }, h.opts("c2"));
    await h.plans.reject({ planId: PlanId("p1") }, h.opts("d1"));
    await h.plans.submit({ title: "b", body: "b" }, h.opts("c3"));
    expect(rows(h)).toEqual(["p1v1:rejected", "p2v1:submitted"]);
  });

  test("the same requestId returns the same plan and version without a second record", async () => {
    const h = await harness();
    const first = await h.plans.submit({ title: "Plan", body: "b" }, h.opts("c1"));
    const events = h.eventCount();
    const second = await h.plans.submit({ title: "Plan", body: "b" }, h.opts("c1"));
    expect(second).toEqual(first);
    expect(h.eventCount()).toBe(events);
    expect(h.approvals.requests).toHaveLength(1);
    // 두 번째 호출은 이미 기록된 승인 id로 상태만 묻는다
    expect(h.approvals.requestCalls()).toBe(1);
  });

  test("versions of an unknown plan is not_found", async () => {
    const h = await harness();
    const error = await rejection(h.plans.versions({ planId: PlanId("p1") }, h.opts()));
    expect(error.data.code).toBe("not_found");
  });
});
