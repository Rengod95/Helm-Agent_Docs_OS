import { describe, expect, test } from "bun:test";
import type { GoalStatusResult, WorkTasksListResult } from "@fresnel/contracts/wire";
import {
  DONE_FOLD_LIMIT,
  goalCommandTextOf,
  goalVMOf,
  GOAL_CONDITION_MAX,
  INITIAL_WORK_STATE,
  taskListOf,
  workReducer,
  type TaskWire,
} from "../../src/views/pages/work/work-model.ts";

// 목표와 작업 탭(P-14)의 순수 모델. 값은 `toEqual`로 비교한다. 목표 값은 `goal.status`의 모양을 그대로 쓴다.

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

function task(id: number, status: TaskWire["status"], blockedBy: string | null = null): TaskWire {
  return { taskId: `t${String(id)}`, content: `작업 ${String(id)}`, status, blockedBy };
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

describe("taskListOf", () => {
  test("a short list keeps every task in order, with the blocked reason and cancelled as details", () => {
    const list = taskListOf(
      [
        task(1, "done"),
        task(2, "in_progress", "테스트 실패"),
        task(3, "pending"),
        task(4, "cancelled"),
      ],
      false,
    );
    expect(list).toEqual({
      steps: [
        { id: "t1", label: "작업 1", status: "done", detailRef: null },
        {
          id: "t2",
          label: "작업 2",
          status: "now",
          detailRef: { id: "desktop.work.tasks.blocked", args: { reason: "테스트 실패" } },
        },
        { id: "t3", label: "작업 3", status: "todo", detailRef: null },
        {
          id: "t4",
          label: "작업 4",
          status: "todo",
          detailRef: { id: "desktop.work.tasks.cancelled" },
        },
      ],
      total: 4,
      doneCount: 1,
      foldable: false,
      hiddenDone: 0,
    });
  });

  test("over the limit, done tasks fold away until they are expanded", () => {
    const many = Array.from({ length: DONE_FOLD_LIMIT + 1 }, (_, index) =>
      task(index + 1, index < 50 ? "done" : "pending"),
    );
    const folded = taskListOf(many, false);
    expect(folded.foldable).toBe(true);
    expect(folded.hiddenDone).toBe(50);
    expect(folded.steps.length).toBe(DONE_FOLD_LIMIT + 1 - 50);
    expect(folded.steps.some((step) => step.status === "done")).toBe(false);
    const open = taskListOf(many, true);
    expect(open.hiddenDone).toBe(0);
    expect(open.steps.length).toBe(DONE_FOLD_LIMIT + 1);
  });

  test("exactly at the limit does not fold", () => {
    const at = Array.from({ length: DONE_FOLD_LIMIT }, (_, index) => task(index + 1, "done"));
    expect(taskListOf(at, false).foldable).toBe(false);
    expect(taskListOf(at, false).steps.length).toBe(DONE_FOLD_LIMIT);
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
    expect(again.tasks).toEqual({ status: "loading" });
  });

  test("a failed read of one part does not touch the other, and a done toggle flips the fold", () => {
    const tasks: WorkTasksListResult["tasks"] = [task(1, "done")];
    const state = workReducer(workReducer(INITIAL_WORK_STATE, { type: "tasksLoaded", tasks }), {
      type: "goalFailed",
    });
    expect(state.goal).toEqual({ status: "failed" });
    expect(state.tasks).toEqual({ status: "ready", value: tasks });
    expect(workReducer(state, { type: "doneToggled" }).doneExpanded).toBe(true);
  });

  test("the draft and the busy flag are plain fields", () => {
    const typed = workReducer(INITIAL_WORK_STATE, { type: "draftChanged", draft: "조건" });
    expect(typed.draft).toBe("조건");
    expect(workReducer(typed, { type: "busyChanged", busy: true }).busy).toBe(true);
  });
});
