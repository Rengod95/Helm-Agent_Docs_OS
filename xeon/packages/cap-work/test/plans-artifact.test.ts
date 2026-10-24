import { afterEach, describe, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import { readPlans } from "../src/projection/read.ts";
import { openHarness, type Harness } from "./support/harness.ts";
import { PlanId } from "./support/plans.ts";

let opened: Harness | undefined;

afterEach(async () => {
  await opened?.[Symbol.asyncDispose]();
  opened = undefined;
});

function rows(h: Harness) {
  const read = readPlans(h.store.service.scoped("cap.work"), h.threadId);
  if (!read.ok) throw new Bug("read failed", { cause: read.error });
  return read.value;
}

describe("plan artifacts (optional)", () => {
  test("without the artifact service the plan has artifact null", async () => {
    opened = await openHarness({ artifacts: false });
    const h = opened;
    const out = await h.plans.submit({ title: "t", body: "b" }, h.opts("c1"));
    expect(out.status).toBe("input_required");
    expect(rows(h)[0]?.artifact).toBeNull();
  });

  test("the first version registers and the next version updates the same artifact", async () => {
    opened = await openHarness();
    const h = opened;
    await h.plans.submit({ title: "Plan", body: "v1" }, h.opts("c1"));
    await h.plans.revise({ planId: PlanId("p1"), feedback: "more" }, h.opts("d1"));
    await h.plans.submit({ title: "Plan", body: "v2", planId: PlanId("p1") }, h.opts("c2"));
    const [first, second] = rows(h);
    expect(first?.artifact).toEqual({ artifactId: "art1", kind: "plan", title: "Plan" });
    expect(second?.artifact?.artifactId).toBe("art1");
    expect(h.artifacts?.calls).toEqual(["register:plan:p1:1", "update:art1:plan:p1:2"]);
  });

  test("a failing artifact service does not stop the submit", async () => {
    opened = await openHarness();
    const h = opened;
    h.artifacts?.failWith("store offline");
    const out = await h.plans.submit({ title: "t", body: "b" }, h.opts("c1"));
    expect(out.status).toBe("input_required");
    expect(rows(h)[0]?.artifact).toBeNull();
    expect(h.logs.some((line) => line.event === "work.plans.artifact_failed")).toBe(true);
  });

  test("a retry after the commit does not register a second artifact", async () => {
    opened = await openHarness();
    const h = opened;
    const first = await h.plans.submit({ title: "t", body: "b" }, h.opts("c1"));
    const second = await h.plans.submit({ title: "t", body: "b" }, h.opts("c1"));
    expect(second).toEqual(first);
    expect(h.artifacts?.calls).toEqual(["register:plan:p1:1"]);
  });

  test("a retry after a crash between the registration and the commit gets the same artifact", async () => {
    opened = await openHarness();
    const h = opened;
    // 등록은 됐고 계획 기록은 없다: 등록 호출의 멱등 키(plan:p1:1)로 같은 산출물이 돌아온다
    await h.artifacts?.register({
      threadId: h.threadId,
      title: "t",
      body: "b",
      requestId: "plan:p1:1",
      meta: { planId: "p1", planVersion: 1 },
    });
    await h.plans.submit({ title: "t", body: "b" }, h.opts("c1"));
    expect(rows(h)[0]?.artifact?.artifactId).toBe("art1");
    expect(h.artifacts?.calls).toEqual(["register:plan:p1:1"]);
  });
});
