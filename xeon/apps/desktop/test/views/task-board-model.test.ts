import { describe, expect, test } from "bun:test";
import { Bug, parse } from "@fresnel/contracts";
import { WorkTaskRecordSchema, type WorkTaskRecord } from "@fresnel/contracts/records";
import {
  openTaskGroupsOf,
  OPEN_TASK_GROUPS_MAX,
  progressPercentOf,
  taskBoardOf,
} from "../../src/views/panels/tasks/task-board-model.ts";
import { thr } from "../state/helpers.ts";

// 작업 탭(DP-195)의 작업 판: 지금 하나 · 다음 · 실패 · 끝남, 진행, 막힘(끝나지 않은 막는 작업만), 열린 작업 묶음.

function task(
  id: number,
  status: WorkTaskRecord["status"],
  over: { activeForm?: string; owner?: string; blockedBy?: readonly number[] } = {},
): WorkTaskRecord {
  const parsed = parse(WorkTaskRecordSchema, {
    id: `t${String(id)}`,
    content: `작업 ${String(id)}`,
    activeForm: over.activeForm ?? null,
    status,
    owner: over.owner ?? null,
    blockedBy: (over.blockedBy ?? []).map((n) => `t${String(n)}`),
  });
  if (!parsed.ok) throw new Bug(`test task ${String(id)} is not a valid task record`);
  return parsed.value;
}

describe("taskBoardOf", () => {
  test("the first in-progress task is the current card; the rest of the work follows in record order", () => {
    const board = taskBoardOf([
      task(1, "completed"),
      task(2, "in_progress", { activeForm: "단위를 통일하는 중", owner: "reviewer" }),
      task(3, "pending", { blockedBy: [2] }),
      task(4, "in_progress"),
      task(5, "failed"),
      task(6, "cancelled"),
    ]);
    expect(board.current).toEqual({
      id: "t2",
      content: "작업 2",
      activeForm: "단위를 통일하는 중",
      status: "in_progress",
      owner: "reviewer",
      waitingOn: [],
    });
    expect(board.next.map((x) => x.id)).toEqual(["t4", "t3"]);
    expect(board.next[1]?.waitingOn).toEqual(["작업 2"]);
    expect(board.failed.map((x) => x.id)).toEqual(["t5"]);
    expect(board.finished.map((x) => x.id)).toEqual(["t1", "t6"]);
    // 취소는 세지 않는다: 끝 1 / 센 5
    expect(board.progress).toEqual({ done: 1, total: 5 });
    expect(board.blocked).toBe(1);
    expect(board.total).toBe(6);
  });

  test("a blocker that is already completed does not count as waiting", () => {
    const board = taskBoardOf([task(1, "completed"), task(2, "pending", { blockedBy: [1] })]);
    expect(board.next[0]?.waitingOn).toEqual([]);
    expect(board.blocked).toBe(0);
  });

  test("no tasks is an empty board with zero progress", () => {
    const board = taskBoardOf([]);
    expect(board).toEqual({
      current: null,
      next: [],
      failed: [],
      finished: [],
      progress: { done: 0, total: 0 },
      blocked: 0,
      total: 0,
    });
    expect(progressPercentOf(board.progress)).toBe(0);
  });

  test("progress percent rounds", () => {
    expect(progressPercentOf({ done: 1, total: 3 })).toBe(33);
    expect(progressPercentOf({ done: 3, total: 3 })).toBe(100);
  });
});

describe("openTaskGroupsOf", () => {
  test("only threads with unfinished work are grouped; the headline is the current task's active form", () => {
    const groups = openTaskGroupsOf([
      { threadId: thr(1), tasks: [task(1, "completed")] },
      {
        threadId: thr(2),
        tasks: [
          task(1, "completed"),
          task(2, "in_progress", { activeForm: "고치는 중" }),
          task(3, "pending"),
        ],
      },
      { threadId: thr(3), tasks: [task(1, "pending")] },
    ]);
    expect(groups).toEqual([
      { threadId: thr(2), done: 1, total: 3, headline: "고치는 중", open: 2 },
      { threadId: thr(3), done: 0, total: 1, headline: "작업 1", open: 1 },
    ]);
  });

  test("at most five groups", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      threadId: thr(i + 1),
      tasks: [task(1, "pending")],
    }));
    expect(openTaskGroupsOf(many).length).toBe(OPEN_TASK_GROUPS_MAX);
  });
});
