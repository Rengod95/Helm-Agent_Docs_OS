import { afterEach, describe, expect, test } from "bun:test";
import { goalGateDecision } from "@fresnel/contracts/capabilities";
import type { JudgeOutcome } from "@fresnel/contracts/services";
import { gateAnswers } from "./support/gate.ts";
import { openHarness, type Harness } from "./support/harness.ts";

// hooks-core-boundary §6.1·6.2 D-30. 완료 게이트는 판정을 공개 기능 `agents.judge`로 부른다(requestId를 넘긴다).
// 결정은 F의 `goalGateDecision`이 낸다. L2는 core-agents를 import하지 않는다.

let opened: Harness | undefined;

afterEach(async () => {
  await opened?.[Symbol.asyncDispose]();
  opened = undefined;
});

function notMet(run: number): JudgeOutcome {
  return {
    kind: "judged",
    record: {
      goalRef: "g1",
      run,
      verdict: "not_met",
      rationale: "tests not run",
      missing: ["tests pass"],
      usage: null,
      model: { provider: "p", modelId: "judge-model" },
    },
  };
}

describe("the completion gate asks agents.judge", () => {
  test("the judge capability is called once with a request id made from the turn (the payload has no step) and the decision is goalGateDecision's", async () => {
    opened = await openHarness({ maxRuns: 3 });
    const h = opened;
    const rig = gateAnswers(h, [notMet(1)]);
    await h.goals.set(
      { condition: "all tests pass", judge: { kind: "model", rubric: ["tests pass"] } },
      h.opts(),
    );

    const patch = await rig.settle();

    expect(rig.requestIds).toEqual([`judge:${String(rig.turnId)}:g1`]);
    expect(rig.calls).toHaveLength(1);
    const expected = goalGateDecision(notMet(1));
    expect(expected).toMatchObject({ continue: true, reason: "not_met" });
    expect(patch?.continue).toBe(expected.continue);
  });

  test("a missing judge capability stops the turn as a judge failure, with no request sent", async () => {
    opened = await openHarness({ maxRuns: 3 });
    const h = opened;
    const rig = gateAnswers(h, "absent");
    await h.goals.set({ condition: "x" }, h.opts());

    const patch = await rig.settle();

    expect(patch?.continue).toBe(false);
    expect(rig.requestIds).toEqual([]);
    expect(goalGateDecision({ kind: "failed", message: "x" })).toMatchObject({
      continue: false,
      reason: "failed",
    });
  });
});
