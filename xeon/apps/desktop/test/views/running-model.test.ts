import { describe, expect, test } from "bun:test";
import type { AgentRecord, RunSource, TurnRecord } from "../../src/state/engine/index.ts";
import {
  elapsedOf,
  JUST_FINISHED_MS,
  runBoardOf,
} from "../../src/views/panels/running/running-model.ts";
import { summary, thr, trn } from "../state/helpers.ts";

// 실행 중 탭(DP-196): 기다림 · 도는 중 · 방금 끝남, 자식 대화 묶기, "끝남"은 엔진 상태에서만.

const NOW = Date.parse("2026-11-13T12:00:00.000Z");
const iso = (msAgo: number): string => new Date(NOW - msAgo).toISOString();

function turn(over: Partial<TurnRecord> = {}): TurnRecord {
  return {
    lastComposition: null,
    turnId: trn(1),
    startedSeq: 1,
    startedAt: iso(5 * 60_000),
    origin: "user",
    scopeId: null,
    requestId: null,
    inputItemIds: [],
    model: null,
    steps: 3,
    lastStepIndex: 2,
    lastStopReason: null,
    warnings: [],
    lastContextTokens: null,
    notices: [],
    abort: null,
    completion: null,
    ...over,
  };
}

function agentRecord(child: number, over: Partial<AgentRecord> = {}): AgentRecord {
  return {
    childThreadId: thr(child),
    agent: "reviewer",
    requestId: "req-1",
    caller: "agent",
    depth: 1,
    background: true,
    owner: { kind: "scope", scopeId: "group:core" },
    modelRole: "default",
    spawnedSeq: 1,
    spawnedAt: iso(60_000),
    status: "running",
    settledAt: null,
    reportText: null,
    reportTruncated: false,
    usage: null,
    error: null,
    limitHit: null,
    ...over,
  };
}

function source(over: Partial<RunSource> & { readonly id: number }): RunSource {
  const { id, ...rest } = over;
  return {
    summary: summary(thr(id), { title: `대화 ${String(id)}` }),
    lastTurn: null,
    currentTool: null,
    agent: null,
    ...rest,
  };
}

function settled(msAgo: number): RunSource {
  return source({
    id: 2,
    agent: agentRecord(2, {
      status: "error",
      settledAt: iso(msAgo),
      usage: {
        input: 10,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 12_400,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    }),
  });
}

function done(id: number): RunSource {
  return source({
    id,
    lastTurn: turn({
      completion: {
        at: iso(10_000),
        status: "interrupted",
        stepCount: 3,
        usage: null,
        error: null,
        durationMs: 1000,
        end: { kind: "interrupted", code: "user" },
      },
    }),
  });
}

describe("runBoardOf", () => {
  test("a running thread with a running subagent nests the child under it", () => {
    const board = runBoardOf(
      [
        source({
          id: 1,
          summary: summary(thr(1), { title: "테스트 정리", status: "running" }),
          lastTurn: turn(),
          currentTool: "bash",
        }),
        source({
          id: 2,
          summary: summary(thr(2), {
            status: "running",
            spawnedBy: { threadId: thr(1), kind: "subagent" },
          }),
          lastTurn: turn({ steps: 4, startedAt: iso(30_000) }),
          agent: agentRecord(2),
        }),
      ],
      null,
      NOW,
    );
    expect(board.runningCount).toBe(2);
    expect(board.waiting).toEqual([]);
    expect(board.running.length).toBe(1);
    const parent = board.running[0];
    expect(parent?.title).toBe("테스트 정리");
    expect(parent?.tool).toBe("bash");
    expect(parent?.sinceMs).toBe(NOW - 5 * 60_000);
    expect(parent?.children.map((c) => [c.agentName, c.background, c.steps])).toEqual([
      ["reviewer", true, 4],
    ]);
  });

  test("approvals waiting win over running; a child whose parent is not in the group lifts up with the parent's title", () => {
    const board = runBoardOf(
      [
        source({
          id: 1,
          summary: summary(thr(1), { title: "부모", pendingApprovals: 2, status: "running" }),
        }),
        source({
          id: 2,
          summary: summary(thr(2), {
            status: "running",
            spawnedBy: { threadId: thr(1), kind: "subagent" },
          }),
          agent: agentRecord(2),
        }),
      ],
      null,
      NOW,
    );
    expect(board.waiting.map((r) => [r.title, r.approvals])).toEqual([["부모", 2]]);
    expect(board.running.map((r) => [r.agentName, r.parentTitle])).toEqual([["reviewer", "부모"]]);
    expect(board.waitingCount).toBe(1);
  });

  test("finished only from engine state: a subagent still running is never finished even if its thread is idle", () => {
    const board = runBoardOf(
      [source({ id: 2, agent: agentRecord(2, { status: "running" }) })],
      null,
      NOW,
    );
    expect(board.running.length).toBe(1);
    expect(board.finished).toEqual([]);
  });

  test("a settled subagent stays as just finished for two minutes, with its outcome and tokens", () => {
    const fresh = runBoardOf([settled(60_000)], null, NOW);
    expect(fresh.finished.map((r) => [r.outcome, r.tokens, r.sinceMs])).toEqual([
      ["failed", 12_400, NOW - 60_000],
    ]);
    expect(runBoardOf([settled(JUST_FINISHED_MS + 1)], null, NOW).finished).toEqual([]);
  });

  test("another conversation's finished turn shows; the open conversation's own turn does not", () => {
    const board = runBoardOf([done(1), done(3)], thr(1), NOW);
    expect(board.finished.map((r) => [r.threadId, r.outcome])).toEqual([[thr(3), "interrupted"]]);
  });

  test("an idle thread with nothing recent is not on the board; schedule origin is kept as a chip", () => {
    const board = runBoardOf(
      [
        source({ id: 1 }),
        source({
          id: 4,
          summary: summary(thr(4), {
            status: "running",
            origin: { kind: "schedule", scheduleId: "s1" },
          }),
        }),
      ],
      null,
      NOW,
    );
    expect(board.running.map((r) => [r.threadId, r.origin])).toEqual([[thr(4), "schedule"]]);
  });
});

describe("elapsedOf", () => {
  test("under a minute is just now, then minutes, then hours", () => {
    expect(elapsedOf(NOW - 30_000, NOW)).toEqual({ unit: "justNow", count: 0 });
    expect(elapsedOf(NOW - 5 * 60_000, NOW)).toEqual({ unit: "minutes", count: 5 });
    expect(elapsedOf(NOW - 3 * 3_600_000, NOW)).toEqual({ unit: "hours", count: 3 });
  });
});
