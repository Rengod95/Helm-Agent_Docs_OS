import { describe, expect, test } from "bun:test";
import { Bug, parse } from "@fresnel/contracts";
import type { ThreadId, Usage } from "@fresnel/contracts/conversation";
import { GoalRecordSchema, WorkTaskRecordSchema } from "@fresnel/contracts/records";
import type { VolatileEventWire } from "@fresnel/contracts/wire";
import {
  EMPTY_THREAD_CONVO,
  type AgentRecord,
  type GoalState,
  type LeaseRecord,
  type TaskState,
  type TurnAbortRecord,
  type ThreadConvo,
  type TurnCompletion,
  type TurnRecord,
} from "../../src/state/engine/convo.ts";
import {
  selectAborting,
  selectAgentRows,
  selectLeadOfTurn,
  selectLeadSegments,
  selectMarkers,
  selectNow,
  selectToolProgress,
  selectTurnSummaries,
  selectTurnSummary,
} from "../../src/state/engine/convo-select.ts";
import { decodeVolatile } from "../../src/state/engine/decode.ts";
import type { MirrorInput } from "../../src/state/engine/input.ts";
import { reduceMirror } from "../../src/state/engine/reduce.ts";
import {
  EMPTY_STREAMING,
  INITIAL_MIRROR,
  type EngineMirror,
} from "../../src/state/engine/state.ts";
import { approvalRequest, evt, itm, STORE, SUB, thr, trn } from "./helpers.ts";

const T = thr(1);
const CHILD = thr(2);
const ELSE = thr(3);
const MISSING = thr(4);

const START = "2026-11-07T00:00:00.000Z";
const END = "2026-11-07T00:00:02.500Z";

const TURN_BASE: TurnRecord = {
  turnId: trn(1),
  startedSeq: null,
  inputItemIds: [],
  startedAt: null,
  origin: "user",
  scopeId: null,
  requestId: null,
  model: null,
  steps: 0,
  lastStepIndex: -1,
  lastStopReason: null,
  warnings: [],
  lastContextTokens: null,
  lastComposition: null,
  notices: [],
  abort: null,
  completion: null,
};

const DONE: TurnCompletion = {
  at: END,
  status: "completed",
  stepCount: 3,
  usage: null,
  error: null,
  durationMs: 2500,
  end: { kind: "completed" },
};

function turnOf(n: number, over: Partial<TurnRecord> = {}): TurnRecord {
  return { ...TURN_BASE, turnId: trn(n), ...over };
}

function usageOf(totalTokens: number, cost: number): Usage {
  return {
    input: 10,
    output: 5,
    cacheRead: 2,
    cacheWrite: 1,
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
  };
}

function convoOf(over: Partial<ThreadConvo>): ThreadConvo {
  return { ...EMPTY_THREAD_CONVO, ...over };
}

function mirrorOf(convo: EngineMirror["convo"], over: Partial<EngineMirror> = {}): EngineMirror {
  return { ...INITIAL_MIRROR, convo, ...over };
}

function agentOf(child: ThreadId, status: AgentRecord["status"]): AgentRecord {
  return {
    childThreadId: child,
    agent: "helper",
    requestId: "req-1",
    caller: "main",
    depth: 1,
    background: false,
    owner: { kind: "drive", turnId: null, scopeId: "g", leaseId: "l1" },
    modelRole: "fast",
    spawnedSeq: 10,
    spawnedAt: START,
    status,
    settledAt: null,
    reportText: null,
    reportTruncated: false,
    usage: null,
    error: null,
    limitHit: null,
  };
}

const LEASE: LeaseRecord = {
  leaseId: "l1",
  scopeId: "g",
  lineageId: "lin-1",
  epoch: 2,
  limits: { maxTurns: 3 },
  acquiredSeq: 5,
  acquiredAt: START,
  releasedSeq: 9,
  releasedAt: END,
  releaseReason: "budget",
};

function goalRecord(): GoalState["goal"] {
  const parsed = parse(GoalRecordSchema, {
    goalId: "g1",
    condition: "테스트 통과",
    judge: { kind: "model" },
    maxRuns: 5,
    continuation: "self",
    judgments: 2,
    status: "active",
    lastVerdict: null,
  });
  if (!parsed.ok) throw new Bug("test goal is not a valid goal record");
  return parsed.value;
}

const GOAL: GoalState = {
  goal: goalRecord(),
  seq: 4,
  judgments: [],
};

function taskOf(
  id: string,
  status: TaskState["task"]["status"],
  blockedBy: string[] = [],
  activeForm: string | null = null,
): TaskState {
  const parsed = parse(WorkTaskRecordSchema, {
    id,
    content: `할 일 ${id}`,
    activeForm,
    status,
    owner: null,
    blockedBy,
  });
  if (!parsed.ok) throw new Bug(`test task ${id} is not a valid task record`);
  return { task: parsed.value, seq: 3 };
}

/** 도는 턴, 임대, 하위 에이전트 둘, 목표, 할 일 넷, 이 thread의 승인과 다른 thread의 승인이 든 거울 */
function busyMirror(): EngineMirror {
  return mirrorOf(
    {
      [T]: convoOf({
        turns: [turnOf(6, { startedSeq: 7, scopeId: "g", model: "m-1" })],
        leases: [LEASE],
        agents: [agentOf(CHILD, "running"), agentOf(MISSING, "completed")],
        goal: GOAL,
        tasks: {
          t1: taskOf("t1", "pending", ["t2"]),
          t2: taskOf("t2", "in_progress", [], "t2 하는 중"),
          t3: taskOf("t3", "completed"),
          t4: taskOf("t4", "cancelled"),
        },
        taskOrder: ["t1", "t2", "t3", "t4"],
      }),
    },
    {
      approvals: {
        resolved: [],
        ids: [evt(1), evt(2)],
        byId: {
          [evt(1)]: { approvalId: evt(1), threadId: T, seq: 3, request: approvalRequest(T) },
          [evt(2)]: { approvalId: evt(2), threadId: ELSE, seq: 4, request: approvalRequest(ELSE) },
        },
      },
    },
  );
}

describe("selectTurnSummary", () => {
  test("끝난 턴은 단계 수, 시간, 사용량 합, 비용, 끝, 모델, 출처, 주도 scope를 요약한다", () => {
    const usage = usageOf(18, 0.25);
    const s = mirrorOf({
      [T]: convoOf({
        turns: [
          turnOf(1, {
            startedSeq: 1,
            startedAt: START,
            origin: "scheduled",
            scopeId: "g",
            model: "m-1",
            steps: 3,
            lastStepIndex: 2,
            lastContextTokens: 1200,
            completion: { ...DONE, usage },
          }),
        ],
      }),
    });
    expect(selectTurnSummary(s, T, trn(1))).toEqual({
      turnId: trn(1),
      startedSeq: 1,
      inputItemIds: [],
      origin: "scheduled",
      leadScopeId: "g",
      model: "m-1",
      startedAt: START,
      running: false,
      aborting: false,
      abort: null,
      steps: 3,
      durationMs: 2500,
      usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, totalTokens: 18, cost: 0.25 },
      rawUsage: usage,
      end: { kind: "completed" },
      stopReason: null,
      warnings: [],
      notices: [],
      lastContextTokens: 1200,
      composition: null,
    });
    expect(selectTurnSummary(s, T, trn(9))).toBeUndefined();
  });

  test("완료되지 않은 턴은 도는 중이고 시간과 사용량이 없다", () => {
    const s = mirrorOf({
      [T]: convoOf({ turns: [turnOf(1, { startedSeq: 1, startedAt: START, steps: 1 })] }),
    });
    expect(selectTurnSummary(s, T, trn(1))).toMatchObject({
      running: true,
      aborting: false,
      durationMs: null,
      usage: null,
      rawUsage: null,
      end: null,
    });
  });

  test("중단을 요청했고 아직 끝나지 않았으면 aborting이 참이다", () => {
    const abort: TurnAbortRecord = {
      code: "user",
      message: null,
      cause: "direct",
      background: false,
    };
    const s = mirrorOf({
      [T]: convoOf({ turns: [turnOf(1, { startedSeq: 1, abort })] }),
    });
    expect(selectTurnSummary(s, T, trn(1))).toMatchObject({
      running: true,
      aborting: true,
      abort,
    });
    expect(selectAborting(s, T)).toBe(true);
  });

  test("중단 기록이 있어도 이미 끝난 턴이면 aborting은 거짓이다", () => {
    const abort: TurnAbortRecord = {
      code: "user",
      message: null,
      cause: "direct",
      background: false,
    };
    const s = mirrorOf({
      [T]: convoOf({
        turns: [
          turnOf(1, {
            startedSeq: 1,
            abort,
            completion: { ...DONE, end: { kind: "interrupted", code: "user" } },
          }),
        ],
      }),
    });
    expect(selectTurnSummary(s, T, trn(1))).toMatchObject({ running: false, aborting: false });
    expect(selectAborting(s, T)).toBe(false);
  });
});

describe("selectLeadSegments", () => {
  test("임대 구간은 같은 scope에서 구간 안에 시작한 턴을 주도 턴으로 세고, 반납 사유를 싣는다", () => {
    const s = mirrorOf({
      [T]: convoOf({
        leases: [LEASE],
        turns: [
          turnOf(2, {
            startedSeq: 6,
            scopeId: "g",
            completion: { ...DONE, usage: usageOf(100, 0.1) },
          }),
          turnOf(3, {
            startedSeq: 8,
            scopeId: "g",
            completion: { ...DONE, usage: usageOf(50, 0.05) },
          }),
          turnOf(4, {
            startedSeq: 7,
            scopeId: "other",
            completion: { ...DONE, usage: usageOf(999, 1) },
          }),
        ],
      }),
    });
    expect(selectLeadSegments(s, T)).toEqual([
      {
        leaseId: "l1",
        scopeId: "g",
        epoch: 2,
        active: false,
        acquiredSeq: 5,
        acquiredAt: START,
        releasedSeq: 9,
        releasedAt: END,
        releaseReason: "budget",
        limits: { maxTurns: 3 },
        turnIds: [trn(2), trn(3)],
        used: { turns: 2, tokens: 150, spawns: 0 },
      },
    ]);
    expect(selectLeadOfTurn(s, T, trn(2))?.leaseId).toBe("l1");
    expect(selectLeadOfTurn(s, T, trn(4))).toBeUndefined();
  });

  test("보유 중인 임대는 active이고 반납 사유와 반납 seq가 없다", () => {
    const held: LeaseRecord = {
      ...LEASE,
      releasedSeq: null,
      releasedAt: null,
      releaseReason: null,
    };
    const s = mirrorOf({
      [T]: convoOf({
        leases: [held],
        turns: [turnOf(2, { startedSeq: 6, scopeId: "g" })],
      }),
    });
    expect(selectLeadSegments(s, T)[0]).toMatchObject({
      active: true,
      releasedSeq: null,
      releaseReason: null,
      turnIds: [trn(2)],
      used: { turns: 1, tokens: 0, spawns: 0 },
    });
  });
});

describe("selectAgentRows", () => {
  test("하위 에이전트 줄은 자식 대화의 단계 수와 지금 실행 중인 도구를 읽는다", () => {
    const agent = agentOf(CHILD, "running");
    const s = mirrorOf(
      {
        [T]: convoOf({ agents: [agent] }),
        [CHILD]: convoOf({ turns: [turnOf(5, { startedSeq: 2, steps: 3 })] }),
      },
      {
        streaming: {
          ...EMPTY_STREAMING,
          itemIds: [itm(1), itm(2)],
          items: {
            [itm(1)]: {
              itemId: itm(1),
              threadId: CHILD,
              turnId: trn(5),
              kind: "toolCall",
              toolName: "bash",
              toolCallId: "c1",
              parts: [],
            },
            [itm(2)]: {
              itemId: itm(2),
              threadId: T,
              turnId: trn(1),
              kind: "toolCall",
              toolName: "read",
              toolCallId: "c2",
              parts: [],
            },
          },
        },
      },
    );
    expect(selectAgentRows(s, T)).toEqual([
      { agent, progress: { steps: 3, currentTool: "bash", turns: 1, running: true } },
    ]);
  });

  test("자식 대화를 거울이 아직 못 봤으면 진행은 null이다", () => {
    const s = mirrorOf({ [T]: convoOf({ agents: [agentOf(MISSING, "running")] }) });
    expect(selectAgentRows(s, T)).toEqual([{ agent: agentOf(MISSING, "running"), progress: null }]);
  });
});

describe("selectNow", () => {
  test("목표, 판정, 할 일 상태와 진행, 도는 에이전트, 기다리는 승인을 한 값으로 고른다", () => {
    expect(selectNow(busyMirror(), T)).toEqual({
      goalLine: "테스트 통과",
      goalStatus: "active",
      judgment: { n: 2, max: 5 },
      tasks: [
        {
          id: "t1",
          content: "할 일 t1",
          activeForm: null,
          state: "todo",
          status: "pending",
          blocked: true,
        },
        {
          id: "t2",
          content: "할 일 t2",
          activeForm: "t2 하는 중",
          state: "now",
          status: "in_progress",
          blocked: false,
        },
        {
          id: "t3",
          content: "할 일 t3",
          activeForm: null,
          state: "done",
          status: "completed",
          blocked: false,
        },
        {
          id: "t4",
          content: "할 일 t4",
          activeForm: null,
          state: "done",
          status: "cancelled",
          blocked: false,
        },
      ],
      progress: { done: 1, total: 3 },
      runningAgents: 1,
      pendingApprovals: 1,
      turnRunning: true,
      aborting: false,
    });
  });

  test("빈 thread의 지금은 목표와 할 일이 없고 모두 0이다", () => {
    expect(selectNow(INITIAL_MIRROR, thr(9))).toEqual({
      goalLine: null,
      goalStatus: null,
      judgment: null,
      tasks: [],
      progress: { done: 0, total: 0 },
      runningAgents: 0,
      pendingApprovals: 0,
      turnRunning: false,
      aborting: false,
    });
  });
});

describe("선택자 참조 안정성", () => {
  test("같은 입력 참조에는 같은 결과 참조를 돌려준다", () => {
    const s = busyMirror();
    expect(selectTurnSummaries(s, T)).toBe(selectTurnSummaries(s, T));
    expect(selectLeadSegments(s, T)).toBe(selectLeadSegments(s, T));
    expect(selectAgentRows(s, T)).toBe(selectAgentRows(s, T));
    expect(selectNow(s, T)).toBe(selectNow(s, T));
  });

  test("관련 없는 칸(연결 상태)이 바뀌어도 턴 요약과 주도 구간은 같은 참조다", () => {
    const s = busyMirror();
    const s2: EngineMirror = { ...s, link: { phase: "connecting" } };
    expect(selectTurnSummaries(s2, T)).toBe(selectTurnSummaries(s, T));
    expect(selectLeadSegments(s2, T)).toBe(selectLeadSegments(s, T));
  });

  test("빈 thread의 표지는 같은 빈 목록 참조다", () => {
    expect(selectMarkers(INITIAL_MIRROR, thr(9))).toBe(selectMarkers(INITIAL_MIRROR, thr(9)));
  });
});

describe("거울 통합", () => {
  test("head 재설정(subscribed from head)은 대화 상태를 {}로 비운다", () => {
    const before = mirrorOf(
      { [T]: convoOf({ turns: [turnOf(1, { startedSeq: 1 })] }) },
      { cursor: { storeId: STORE, seq: 5 }, link: { phase: "live", sub: SUB } },
    );
    expect(before.convo[T]?.turns.length).toBe(1);
    const after = reduceMirror(before, {
      type: "subscribed",
      sub: SUB,
      storeId: STORE,
      start: 0,
      live: true,
      from: "head",
    }).state;
    expect(after.convo).toEqual({});
  });
});

// ── 도구 진행 출력(휘발 chunk) ───────────────────────────────────────

const TURN = trn(1);
const RECEIVED = 1_000_000;

const itemStarted: VolatileEventWire = {
  id: evt(800),
  kind: "item.started",
  version: 1,
  durable: false,
  threadId: T,
  turnId: TURN,
  stepId: null,
  recordedAt: START,
  causationId: null,
  correlationId: null,
  n: 0,
  afterSeq: 5,
  payload: { itemId: itm(1), kind: "toolCall", toolCallId: "call-1", toolName: "bash" },
};

function progressEvent(n: number, text: string): VolatileEventWire {
  return {
    id: evt(810 + n),
    kind: "item.updated",
    version: 1,
    durable: false,
    threadId: T,
    turnId: TURN,
    stepId: null,
    recordedAt: START,
    causationId: null,
    correlationId: null,
    n,
    afterSeq: 5,
    payload: {
      itemId: itm(1),
      update: { kind: "tool_progress", partialResult: { content: [{ type: "text", text }] } },
    },
  };
}

const chunkOf = (event: VolatileEventWire): MirrorInput => ({
  type: "chunk",
  fact: decodeVolatile(event, RECEIVED),
});

const SUBSCRIBED: MirrorInput = {
  type: "subscribed",
  sub: SUB,
  storeId: STORE,
  start: 0,
  live: true,
  from: "head",
};

function reduceAll(inputs: readonly MirrorInput[], from: EngineMirror): EngineMirror {
  let state = from;
  for (const input of inputs) state = reduceMirror(state, input).state;
  return state;
}

describe("도구 진행 출력의 거울 상태", () => {
  test("진행 출력은 도구 호출 id에 붙고 selectToolProgress가 마지막 갱신의 줄과 받은 총량을 돌려준다", () => {
    const state = reduceAll(
      [
        SUBSCRIBED,
        chunkOf(itemStarted),
        chunkOf(progressEvent(1, "build 1\nbuild 2\n")),
        chunkOf(progressEvent(2, "build 3\nbuild 4\n")),
      ],
      INITIAL_MIRROR,
    );
    expect(selectToolProgress(state, T, "call-1")).toEqual({
      itemId: itm(1),
      lines: ["build 3", "build 4"],
      receivedChars: 32,
      updates: 2,
    });
  });

  test("확정 전 진행(도구 호출 id를 아직 모름)은 item id로 찾는다", () => {
    const state = reduceAll([SUBSCRIBED, chunkOf(progressEvent(1, "build 1\n"))], INITIAL_MIRROR);
    expect(selectToolProgress(state, T, itm(1))).toEqual({
      itemId: itm(1),
      lines: ["build 1"],
      receivedChars: 8,
      updates: 1,
    });
    expect(selectToolProgress(state, T, "call-1")).toBeNull();
  });

  test("head 재설정은 도구 진행 출력과 대화 상태를 함께 비운다", () => {
    const state = reduceAll(
      [SUBSCRIBED, chunkOf(itemStarted), chunkOf(progressEvent(1, "build 1\n"))],
      INITIAL_MIRROR,
    );
    expect(selectToolProgress(state, T, "call-1")).not.toBeNull();
    const reset = reduceMirror(state, SUBSCRIBED).state;
    expect(selectToolProgress(reset, T, "call-1")).toBeNull();
    expect(reset.convo).toEqual({});
  });
});
