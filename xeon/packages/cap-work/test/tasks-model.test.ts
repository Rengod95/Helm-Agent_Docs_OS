import { describe, expect, test } from "bun:test";
import type { WorkTaskStatus } from "@xeon/contracts/capabilities";
import {
  blockersOf,
  indexTasks,
  isResolved,
  TASK_STATUSES,
  toViews,
  transitionOf,
  type Transition,
} from "../src/tasks/model.ts";
import { task, tid } from "./support/tasks.ts";

// L2.work.spec §4.1.2 표. 행은 현재 상태, 열은 바꿀 상태다
const TABLE: Readonly<Record<WorkTaskStatus, Readonly<Record<WorkTaskStatus, Transition>>>> = {
  pending: {
    pending: "same",
    in_progress: "check_blocked",
    completed: "allowed",
    failed: "invalid",
    cancelled: "allowed",
  },
  in_progress: {
    pending: "allowed",
    in_progress: "same",
    completed: "allowed",
    failed: "allowed",
    cancelled: "allowed",
  },
  completed: {
    pending: "allowed",
    in_progress: "invalid",
    completed: "same",
    failed: "invalid",
    cancelled: "invalid",
  },
  failed: {
    pending: "allowed",
    in_progress: "check_blocked",
    completed: "invalid",
    failed: "same",
    cancelled: "allowed",
  },
  cancelled: {
    pending: "allowed",
    in_progress: "invalid",
    completed: "invalid",
    failed: "invalid",
    cancelled: "same",
  },
};

describe("transition table", () => {
  test("all 25 cells match the spec table", () => {
    expect(TASK_STATUSES).toEqual(["pending", "in_progress", "completed", "failed", "cancelled"]);
    for (const from of TASK_STATUSES) {
      for (const to of TASK_STATUSES) {
        expect(`${from}->${to}: ${transitionOf(from, to)}`).toBe(
          `${from}->${to}: ${TABLE[from][to]}`,
        );
      }
    }
  });
});

describe("blocked computation", () => {
  test("completed and cancelled blockers are released; failed, pending and in_progress hold", () => {
    const tasks = [
      task("t1", "completed"),
      task("t2", "cancelled"),
      task("t3", "failed"),
      task("t4", "pending"),
      task("t5", "in_progress"),
      task("t6", "pending", ["t1", "t2"]),
      task("t7", "pending", ["t1", "t3"]),
      task("t8", "pending", ["t4"]),
      task("t9", "pending", ["t5"]),
    ];
    const index = indexTasks(tasks);
    const blockers = (id: string): string[] => {
      const found = index.get(tid(id));
      return found === undefined ? [] : blockersOf(found, index);
    };
    expect(blockers("t6")).toEqual([]);
    expect(blockers("t7")).toEqual(["t3"]);
    expect(blockers("t8")).toEqual(["t4"]);
    expect(blockers("t9")).toEqual(["t5"]);
    expect(isResolved("completed") && isResolved("cancelled")).toBe(true);
    expect(isResolved("failed") || isResolved("pending") || isResolved("in_progress")).toBe(false);
  });

  test("views add blocked and the reverse edges in list order", () => {
    const views = toViews([
      task("t1"),
      task("t2", "pending", ["t1"]),
      task("t3", "pending", ["t1", "t2"]),
    ]);
    expect(views.map((v) => `${v.id} blocked=${v.blocked} blocks=${v.blocks.join(",")}`)).toEqual([
      "t1 blocked=false blocks=t2,t3",
      "t2 blocked=true blocks=t3",
      "t3 blocked=true blocks=",
    ]);
  });
});
