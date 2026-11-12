import { describe, expect, test } from "bun:test";
import type { AgentRow, LeadSegment, NowState } from "../../src/state/engine/index.ts";
import {
  nowShownOf,
  nowViewOf,
  progressPercentOf,
  scopeNameOf,
  type NowTaskView,
} from "../../src/views/now/now-model.ts";
import { thr, trn } from "../state/helpers.ts";

// 지금 띠(DP-100)의 순수 판정: 언제 그리는지, 접힌 줄 본문의 우선순위, 진행·에이전트·주도 값.

function nowOf(over: Partial<NowState> = {}): NowState {
  return {
    goalLine: null,
    goalStatus: null,
    judgment: null,
    tasks: [],
    progress: { done: 0, total: 0 },
    runningAgents: 0,
    pendingApprovals: 0,
    turnRunning: false,
    aborting: false,
    ...over,
  };
}

function task(
  id: string,
  status: NowTaskView["status"],
  activeForm: string | null = null,
): NowTaskView {
  const state = status === "pending" ? "todo" : status === "in_progress" ? "now" : "done";
  return { id, content: `할 일 ${id}`, activeForm, state, status, blocked: false };
}

function agent(status: AgentRow["agent"]["status"], tool: string | null = null): AgentRow {
  return {
    agent: {
      childThreadId: thr(9),
      agent: "explorer",
      requestId: "req-1",
      caller: "agent",
      depth: 1,
      background: false,
      owner: { kind: "scope", scopeId: "group:core" },
      modelRole: "default",
      spawnedSeq: 1,
      spawnedAt: "2026-11-12T00:00:00.000Z",
      status,
      settledAt: null,
      reportText: null,
      reportTruncated: false,
      usage: null,
      error: null,
      limitHit: null,
    },
    progress: { steps: 4, currentTool: tool, turns: 1, running: status === "running" },
  };
}

function lead(active: boolean, maxTurns?: number): LeadSegment {
  return {
    leaseId: "lease-1",
    scopeId: "group:helm",
    epoch: 1,
    active,
    acquiredSeq: 1,
    acquiredAt: "2026-11-12T00:00:00.000Z",
    releasedSeq: active ? null : 9,
    releasedAt: null,
    releaseReason: null,
    limits: maxTurns === undefined ? {} : { maxTurns },
    turnIds: [trn(1), trn(2)],
    used: { turns: 2, tokens: 0, spawns: 0 },
  };
}

describe("nowShownOf", () => {
  test("nothing going on draws nothing", () => {
    expect(nowShownOf(nowOf(), [], [])).toBe(false);
    expect(nowShownOf(nowOf({ turnRunning: true }), [], [])).toBe(false);
  });

  test("an open task, an active goal, a running agent, an active lead or stopping each draw the strip", () => {
    expect(nowShownOf(nowOf({ tasks: [task("1", "pending")] }), [], [])).toBe(true);
    expect(nowShownOf(nowOf({ goalLine: "테스트 통과", goalStatus: "active" }), [], [])).toBe(true);
    expect(nowShownOf(nowOf(), [agent("running")], [])).toBe(true);
    expect(nowShownOf(nowOf(), [], [lead(true)])).toBe(true);
    expect(nowShownOf(nowOf({ aborting: true }), [], [])).toBe(true);
  });

  test("finished tasks stay while the turn runs and go away when it ends; a met goal does not hold it", () => {
    const done = [task("1", "completed")];
    expect(nowShownOf(nowOf({ tasks: done, turnRunning: true }), [], [])).toBe(true);
    expect(nowShownOf(nowOf({ tasks: done }), [], [])).toBe(false);
    expect(
      nowShownOf(nowOf({ goalLine: "끝", goalStatus: "met" }), [agent("completed")], [lead(false)]),
    ).toBe(false);
  });
});

describe("nowViewOf headline", () => {
  test("the current task's active sentence comes first, then its content", () => {
    const now = nowOf({
      tasks: [
        task("1", "completed"),
        task("2", "in_progress", "sub 함수를 더하는 중"),
        task("3", "pending"),
      ],
      goalLine: "모든 시험 통과",
      goalStatus: "active",
    });
    expect(nowViewOf(now, [], []).headline).toEqual({ kind: "task", text: "sub 함수를 더하는 중" });
    const plain = nowOf({ tasks: [task("2", "in_progress")] });
    expect(nowViewOf(plain, [], []).headline).toEqual({ kind: "task", text: "할 일 2" });
  });

  test("without a current task: the active goal, then the open task count, then agents, then the lead", () => {
    expect(nowViewOf(nowOf({ goalLine: "통과", goalStatus: "active" }), [], []).headline).toEqual({
      kind: "goal",
      text: "통과",
    });
    expect(
      nowViewOf(nowOf({ tasks: [task("1", "pending"), task("2", "pending")] }), [], []).headline,
    ).toEqual({
      kind: "count",
      count: 2,
    });
    expect(nowViewOf(nowOf(), [agent("running")], []).headline).toEqual({
      kind: "agents",
      count: 1,
    });
    expect(nowViewOf(nowOf(), [], [lead(true)]).headline).toEqual({ kind: "lead", name: "helm" });
  });

  test("stopping wins over everything and sets the stopping pulse", () => {
    const view = nowViewOf(
      nowOf({ aborting: true, turnRunning: true, tasks: [task("1", "in_progress")] }),
      [],
      [],
    );
    expect(view.headline).toEqual({ kind: "stopping" });
    expect(view.pulse).toBe("stopping");
    expect(nowViewOf(nowOf({ turnRunning: true }), [], []).pulse).toBe("running");
    expect(nowViewOf(nowOf(), [], []).pulse).toBe("idle");
  });
});

describe("nowViewOf values", () => {
  test("progress is null without tasks and a percent with them", () => {
    expect(nowViewOf(nowOf(), [], []).progress).toBeNull();
    const view = nowViewOf(nowOf({ progress: { done: 3, total: 7 } }), [], []);
    expect(view.progress).toEqual({ done: 3, total: 7 });
    expect(progressPercentOf(view.progress)).toBe(43);
    expect(progressPercentOf(null)).toBeNull();
  });

  test("agents carry their current tool and steps, and only running ones are counted", () => {
    const view = nowViewOf(nowOf(), [agent("running", "read"), agent("completed")], []);
    expect(view.runningAgents).toBe(1);
    expect(view.agents.map((row) => [row.running, row.tool, row.steps])).toEqual([
      [true, "read", 4],
      [false, null, 4],
    ]);
  });

  test("the active lead gives the extension name, turns and the turn limit", () => {
    expect(nowViewOf(nowOf(), [], [lead(true, 8)]).lead).toEqual({
      name: "helm",
      turns: 2,
      maxTurns: 8,
    });
    expect(nowViewOf(nowOf(), [], [lead(true)]).lead?.maxTurns).toBeNull();
    expect(nowViewOf(nowOf(), [], [lead(false)]).lead).toBeNull();
  });

  test("the goal keeps its judgment count only while it is active", () => {
    const active = nowViewOf(
      nowOf({ goalLine: "g", goalStatus: "active", judgment: { n: 2, max: 5 } }),
      [],
      [],
    );
    expect(active.goal).toEqual({ text: "g", judgment: { n: 2, max: 5 } });
    const met = nowViewOf(
      nowOf({ goalLine: "g", goalStatus: "met", judgment: { n: 5, max: 5 } }),
      [],
      [],
    );
    expect(met.goal).toEqual({ text: "g", judgment: null });
  });
});

describe("scopeNameOf", () => {
  test("takes the last piece of a scope id", () => {
    expect(scopeNameOf("group:helm")).toBe("helm");
    expect(scopeNameOf("ext/plugins/helm")).toBe("helm");
    expect(scopeNameOf("helm")).toBe("helm");
  });
});
