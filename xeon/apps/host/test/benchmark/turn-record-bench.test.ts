import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import {
  StepCompletedPayloadSchema,
  TurnCompletedPayloadSchema,
  TurnStartedPayloadSchema,
} from "@fresnel/contracts/conversation";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { runScenario } from "./turn-record-driver.ts";
import { buildTurn, scenarioGrid, type Scenario } from "./turn-record-fixture.ts";
import { keepGoing, summarize } from "./turn-record-stats.ts";

// 턴 기록 벤치의 시험. 통계 계산, 합성 턴의 모양과 페이로드 스키마, 구동기가 기대한 행을 쓰는지(짧은 실행)를 본다.

const SHAPE: Scenario = {
  steps: 5,
  callsPerStep: 3,
  hooksPerTurn: 40,
  materials: 60,
  tools: 80,
};

test("summaries use nearest rank: p50 is the 10th of 20, p95 the 19th, max the largest", () => {
  const samples = Array.from({ length: 20 }, (_, index) => index + 1);
  expect(summarize(samples)).toEqual({ n: 20, p50: 10, p95: 19, max: 20 });
  expect(summarize([7])).toEqual({ n: 1, p50: 7, p95: 7, max: 7 });
});

test("the deadline and the target both stop the loop", () => {
  expect(keepGoing(0, 200, 0, 100)).toBe(true);
  expect(keepGoing(200, 200, 0, 100)).toBe(false);
  expect(keepGoing(5, 200, 100, 100)).toBe(false);
});

test("the scenario grid is 3 step counts by 3 call counts with the fixed hooks, materials and tools", () => {
  const grid = scenarioGrid();
  expect(grid.map((scenario) => [scenario.steps, scenario.callsPerStep])).toEqual([
    [1, 0],
    [1, 3],
    [1, 10],
    [5, 0],
    [5, 3],
    [5, 10],
    [20, 0],
    [20, 3],
    [20, 10],
  ]);
  for (const scenario of grid) {
    expect([scenario.hooksPerTurn, scenario.materials, scenario.tools]).toEqual([40, 60, 80]);
  }
});

test("a synthetic turn has the scenario's steps, calls and hooks and parses with the payload schemas", () => {
  const ids = fixedIdFactory();
  const turn = buildTurn(SHAPE, 0, { threadId: ids.next("thr"), ids });
  expect(turn.steps.length).toBe(SHAPE.steps);
  for (const step of turn.steps) {
    expect(step.calls.length).toBe(SHAPE.callsPerStep);
    expect(step.context.kind).toBe("step_context");
    if (step.context.kind !== "step_context")
      throw new Error("the step context must be a step_context event");
    expect(step.context.materials.length).toBe(SHAPE.materials);
    expect(step.context.advertised.count).toBe(SHAPE.tools);
    expect(parse(StepCompletedPayloadSchema, step.completed.payload).ok).toBe(true);
  }
  // 훅은 턴 전체에서 정확히 hooksPerTurn개이고 단계 번호가 맞는다
  const hooks = turn.steps.flatMap((step) => step.hooks);
  expect(hooks.length).toBe(SHAPE.hooksPerTurn);
  for (const step of turn.steps) {
    for (const entry of step.hooks) expect(entry.step).toBe(step.stepIndex);
  }
  expect(parse(TurnStartedPayloadSchema, turn.started.payload).ok).toBe(true);
  expect(parse(TurnCompletedPayloadSchema, turn.completed.payload).ok).toBe(true);
});

test("the driver writes the synthetic turn to the real store with the trace on and only the turn row with it off", async () => {
  // 짧은 실행: 두 단계, 단계당 도구 호출 한 개, 측정 턴 3개. 실행이 끝나면 임시 폴더가 지워진다
  const run = await runScenario(
    { steps: 2, callsPerStep: 1, hooksPerTurn: 40, materials: 60, tools: 80 },
    { iterations: 3, deadlineMs: 60_000 },
  );
  expect(run.iterations).toBe(3);
  expect(run.deadlineHit).toBe(false);
  expect(run.warnings).toBe(0);
  expect(run.on.stepSyncMs.length).toBe(3 * 2);
  expect(run.on.callEachMs.length).toBe(3 * 2);
  expect(run.off.stepSyncMs.length).toBe(3 * 2);
  expect(run.overheadMs.length).toBe(3);
  expect(run.sanity.startsWith("on: 2 steps, 2 calls, 40 hooks, 60 materials")).toBe(true);
});
