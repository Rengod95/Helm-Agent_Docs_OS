import { describe, expect, test } from "bun:test";
import type { GoalStatusResult } from "@fresnel/contracts/wire";
import {
  goalCommandTextOf,
  goalVMOf,
  GOAL_CONDITION_MAX,
  INITIAL_WORK_STATE,
  workReducer,
} from "../../src/views/pages/work/work-model.ts";

// 작업 탭(P-14, DP-195)의 목표·계획 순수 모델. 작업 판은 task-board-model.test.ts. 값은 `toEqual`로 비교한다. 목표 값은 `goal.status`의 모양을 그대로 쓴다.

type GoalWire = NonNullable<GoalStatusResult["goal"]>;

function goal(overrides: Partial<GoalWire>): GoalWire {
  return {
    condition: "시험이 모두 통과한다",
    status: "active",
    judged: 2,
    maxJudgments: 3,
    lastVerdict: null,
    ...overrides,
  };
}

describe("goalVMOf", () => {
  test("an active goal keeps its condition and counts, with no end line", () => {
    expect(goalVMOf(goal({}))).toEqual({
      condition: "시험이 모두 통과한다",
      status: "active",
      statusRef: { id: "desktop.work.goal.status.active" },
      judged: 2,
      maxJudgments: 3,
      verdict: null,
      endRef: null,
    });
  });

  test("the last verdict is kept as it came", () => {
    const verdict = { met: false, reason: "e2e 2개 실패" };
    expect(goalVMOf(goal({ lastVerdict: verdict })).verdict).toEqual(verdict);
  });

  test("met and cleared end with their own sentences", () => {
    expect(goalVMOf(goal({ status: "met", judged: 1 })).endRef).toEqual({
      id: "desktop.work.goal.end.met",
    });
    expect(goalVMOf(goal({ status: "cleared" })).endRef).toEqual({
      id: "desktop.work.goal.end.cleared",
    });
  });

  test("exhausted at the judgment limit reads as a limit stop with the limit count", () => {
    expect(goalVMOf(goal({ status: "exhausted", judged: 3, maxJudgments: 3 })).endRef).toEqual({
      id: "desktop.work.goal.end.limit",
      args: { count: 3 },
    });
  });

  test("exhausted before the limit reads as a failed verdict", () => {
    expect(goalVMOf(goal({ status: "exhausted", judged: 1, maxJudgments: 3 })).endRef).toEqual({
      id: "desktop.work.goal.end.judgeFailed",
    });
    expect(goalVMOf(goal({ status: "exhausted", judged: 1, maxJudgments: 3 })).statusRef).toEqual({
      id: "desktop.work.goal.status.exhausted",
    });
  });
});

describe("goalCommandTextOf", () => {
  test("setting trims the condition and sends it as one /goal line", () => {
    expect(goalCommandTextOf({ kind: "set", condition: "  시험이 모두 통과한다  " })).toEqual({
      ok: true,
      value: "/goal 시험이 모두 통과한다",
    });
  });

  test("clearing is the fixed /goal clear line", () => {
    expect(goalCommandTextOf({ kind: "clear" })).toEqual({ ok: true, value: "/goal clear" });
  });

  test("an empty or blank condition is refused before sending", () => {
    expect(goalCommandTextOf({ kind: "set", condition: "   " })).toEqual({
      ok: false,
      error: { kind: "empty" },
    });
  });

  test("a condition longer than the limit is refused, and exactly the limit is allowed", () => {
    const limit = "가".repeat(GOAL_CONDITION_MAX);
    expect(goalCommandTextOf({ kind: "set", condition: limit })).toEqual({
      ok: true,
      value: `/goal ${limit}`,
    });
    expect(goalCommandTextOf({ kind: "set", condition: `${limit}나` })).toEqual({
      ok: false,
      error: { kind: "tooLong" },
    });
  });
});

describe("workReducer", () => {
  test("a reload keeps the last good values on screen and only resets what never loaded", () => {
    const loadedGoal: GoalWire | null = goal({});
    const ready = workReducer(INITIAL_WORK_STATE, { type: "goalLoaded", goal: loadedGoal });
    const again = workReducer(ready, { type: "loadStarted" });
    expect(again.goal).toEqual({ status: "ready", value: loadedGoal });
    expect(workReducer(INITIAL_WORK_STATE, { type: "loadStarted" }).goal).toEqual({
      status: "loading",
    });
  });

  test("a failed goal read is its own state and a reload starts from it", () => {
    const failed = workReducer(INITIAL_WORK_STATE, { type: "goalFailed" });
    expect(failed.goal).toEqual({ status: "failed" });
    expect(workReducer(failed, { type: "loadStarted" }).goal).toEqual({ status: "loading" });
  });

  test("the draft and the busy flag are plain fields", () => {
    const typed = workReducer(INITIAL_WORK_STATE, { type: "draftChanged", draft: "조건" });
    expect(typed.draft).toBe("조건");
    expect(workReducer(typed, { type: "busyChanged", busy: true }).busy).toBe(true);
  });
});
