// src/state/engine/convo-select.ts
// 대화 상태(`convo.ts`)를 화면 부품이 읽는 모양으로 고르는 선택자. 순수 함수이고, 같은 입력 참조에는 같은 결과 참조를 돌려준다
// (빈 값은 모듈 상수, 만든 배열은 입력 참조로 기억한다). 스펙: docs/xeon/L4/desktop-ux/spec.md 대화 상태 절.
import type { ThreadId, TurnId, Usage } from "@fresnel/contracts/conversation";
import type {
  AgentRecord,
  ApprovalTrail,
  ConvoMarker,
  GoalState,
  Intervention,
  LeaseRecord,
  ThreadConvo,
  ToolProgress,
  TurnEnd,
  TurnNoticeRecord,
  TurnRecord,
} from "./convo.ts";
import { EMPTY_THREAD_CONVO } from "./convo.ts";
import type { EngineMirror, Streaming } from "./state.ts";
import type { ThreadSummary } from "@fresnel/contracts/wire";

const NO_INTERVENTIONS: readonly Intervention[] = Object.freeze([]);
const NO_APPROVALS: readonly ApprovalTrail[] = Object.freeze([]);
const NO_MARKERS: readonly ConvoMarker[] = Object.freeze([]);

const convoOf = (s: EngineMirror, threadId: ThreadId): ThreadConvo =>
  s.convo[threadId] ?? EMPTY_THREAD_CONVO;

// ── 도구 호출 ─────────────────────────────────────────────────────────

/** 도구 호출의 진행 출력(마지막 줄들과 받은 총량). 진행 행이 확정 전이면 호출 id 대신 item id로 찾는다 */
export const selectToolProgress = (
  s: EngineMirror,
  threadId: ThreadId,
  toolCallIdOrItemId: string,
): ToolProgress | null => convoOf(s, threadId).tools[toolCallIdOrItemId]?.progress ?? null;

/** 도구 호출의 개입 목록(종류, 확장 이름, 사유). 받은 순서다 */
export const selectToolInterventions = (
  s: EngineMirror,
  threadId: ThreadId,
  toolCallId: string,
): readonly Intervention[] =>
  convoOf(s, threadId).tools[toolCallId]?.interventions ?? NO_INTERVENTIONS;

/** 도구 호출에 붙은 승인 기록(누가 무엇을 어떤 범위로 허용·거부했나) */
export const selectToolApprovals = (
  s: EngineMirror,
  threadId: ThreadId,
  toolCallId: string,
): readonly ApprovalTrail[] => convoOf(s, threadId).tools[toolCallId]?.approvals ?? NO_APPROVALS;

/** 도구 호출에 묶이지 않은 개입(시크릿 가림, 시크릿 승인) */
export const selectLooseInterventions = (
  s: EngineMirror,
  threadId: ThreadId,
): readonly Intervention[] => convoOf(s, threadId).looseInterventions;

/** 도구 호출 id 없는 승인(계획·질문·검토 승인)의 기록 */
export const selectLooseApprovals = (
  s: EngineMirror,
  threadId: ThreadId,
): readonly ApprovalTrail[] => convoOf(s, threadId).looseApprovals;

// ── 턴 요약 ───────────────────────────────────────────────────────────

type TurnUsageSummary = {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly totalTokens: number;
  /** 비용 합(통화 단위는 모델 표가 정한다). 사용량이 없으면 null */
  readonly cost: number | null;
};

/** 턴 하나의 요약. 단계 수, 시간, 토큰, 비용 계산에 필요한 값, 모델, 멈춘 사유 */
export type TurnSummary = {
  readonly turnId: TurnId;
  readonly origin: TurnRecord["origin"];
  /** 시작 사건 seq(못 봤으면 null). 표지 자리를 고를 때 쓴다 */
  readonly startedSeq: number | null;
  /** 이 턴을 시작한 입력 item. 줄 모델이 턴 경계를 고른다 */
  readonly inputItemIds: TurnRecord["inputItemIds"];
  /** 주도 턴이면 임대한 scope id(그 확장이 주도한 턴) */
  readonly leadScopeId: string | null;
  readonly model: string | null;
  readonly startedAt: string | null;
  readonly running: boolean;
  /** 중단을 요청해 멈추는 중이다(`turn.abort_requested`를 받았고 아직 안 끝났다) */
  readonly aborting: boolean;
  readonly abort: TurnRecord["abort"];
  readonly steps: number;
  /** 시작과 끝 사건의 시각 차(ms). 끝나지 않았거나 시작을 못 봤으면 null */
  readonly durationMs: number | null;
  readonly usage: TurnUsageSummary | null;
  /** 모델 호출 합계 원본(비용 표 계산용). 없으면 null */
  readonly rawUsage: Usage | null;
  readonly end: TurnEnd | null;
  /** 마지막 단계의 멈춘 사유(`stop`, `toolUse`, `length` 등 모델 응답 사유) */
  readonly stopReason: TurnRecord["lastStopReason"];
  readonly warnings: TurnRecord["warnings"];
  readonly notices: readonly TurnNoticeRecord[];
  readonly lastContextTokens: number | null;
};

function usageSummaryOf(usage: Usage | null): TurnUsageSummary | null {
  if (usage === null) return null;
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    totalTokens: usage.totalTokens,
    cost: usage.cost.total,
  };
}

/** 턴 기록 하나를 요약으로 바꾼다(순수) */
function summarizeTurn(turn: TurnRecord): TurnSummary {
  const done = turn.completion;
  return {
    turnId: turn.turnId,
    origin: turn.origin,
    startedSeq: turn.startedSeq,
    inputItemIds: turn.inputItemIds,
    leadScopeId: turn.scopeId,
    model: turn.model,
    startedAt: turn.startedAt,
    running: done === null,
    aborting: done === null && turn.abort !== null,
    abort: turn.abort,
    steps: turn.steps,
    durationMs: done?.durationMs ?? null,
    usage: usageSummaryOf(done?.usage ?? null),
    rawUsage: done?.usage ?? null,
    end: done?.end ?? null,
    stopReason: turn.lastStopReason,
    warnings: turn.warnings,
    notices: turn.notices,
    lastContextTokens: turn.lastContextTokens,
  };
}

const turnSummaryCache = new WeakMap<readonly TurnRecord[], readonly TurnSummary[]>();
const NO_SUMMARIES: readonly TurnSummary[] = Object.freeze([]);

/** thread의 턴 요약 목록. 오래된 턴이 앞이다 */
export function selectTurnSummaries(s: EngineMirror, threadId: ThreadId): readonly TurnSummary[] {
  const turns = convoOf(s, threadId).turns;
  if (turns.length === 0) return NO_SUMMARIES;
  const known = turnSummaryCache.get(turns);
  if (known !== undefined) return known;
  const made = turns.map(summarizeTurn);
  turnSummaryCache.set(turns, made);
  return made;
}

export function selectTurnSummary(
  s: EngineMirror,
  threadId: ThreadId,
  turnId: TurnId,
): TurnSummary | undefined {
  return selectTurnSummaries(s, threadId).find((t) => t.turnId === turnId);
}

/** 지금 멈추는 중인 턴이 있나(입력창 위 "지금 띠"와 중단 단추가 읽는다) */
export function selectAborting(s: EngineMirror, threadId: ThreadId): boolean {
  return convoOf(s, threadId).turns.some((t) => t.completion === null && t.abort !== null);
}

// ── 주도 구간 ─────────────────────────────────────────────────────────

/** 주도 구간 하나: 어느 턴들이 어느 확장의 주도인가 */
export type LeadSegment = {
  readonly leaseId: string;
  /** 주도한 확장의 scope id */
  readonly scopeId: string;
  readonly epoch: number | null;
  readonly active: boolean;
  readonly acquiredSeq: number;
  readonly acquiredAt: string;
  readonly releasedSeq: number | null;
  readonly releasedAt: string | null;
  /** 반납 사유(`budget`, `idle`, `waiting` 등). 아직 보유 중이면 null */
  readonly releaseReason: LeaseRecord["releaseReason"];
  readonly limits: LeaseRecord["limits"];
  /** 이 구간에서 주도한 턴(같은 scope이고 구간 안에서 시작한 턴). 오래된 것이 앞이다 */
  readonly turnIds: readonly TurnId[];
  /** 한도 대비 사용량: 턴 수, 토큰 합(끝난 턴의 사용량), 위임 수 */
  readonly used: { readonly turns: number; readonly tokens: number; readonly spawns: number };
};

const leadCache = new WeakMap<ThreadConvo, readonly LeadSegment[]>();
const NO_LEADS: readonly LeadSegment[] = Object.freeze([]);

/** thread의 주도 구간 목록(임대 순서). 임대가 없으면 빈 목록이다 */
export function selectLeadSegments(s: EngineMirror, threadId: ThreadId): readonly LeadSegment[] {
  const c = convoOf(s, threadId);
  if (c.leases.length === 0) return NO_LEADS;
  const known = leadCache.get(c);
  if (known !== undefined) return known;
  const made = c.leases.map((lease): LeadSegment => {
    const mine = c.turns.filter(
      (t) =>
        t.scopeId === lease.scopeId &&
        t.startedSeq !== null &&
        t.startedSeq >= lease.acquiredSeq &&
        (lease.releasedSeq === null || t.startedSeq <= lease.releasedSeq),
    );
    const tokens = mine.reduce((sum, t) => sum + (t.completion?.usage?.totalTokens ?? 0), 0);
    const spawns = c.agents.filter(
      (a) => a.owner.kind === "drive" && a.owner.leaseId === lease.leaseId,
    ).length;
    return {
      leaseId: lease.leaseId,
      scopeId: lease.scopeId,
      epoch: lease.epoch,
      active: lease.releasedSeq === null,
      acquiredSeq: lease.acquiredSeq,
      acquiredAt: lease.acquiredAt,
      releasedSeq: lease.releasedSeq,
      releasedAt: lease.releasedAt,
      releaseReason: lease.releaseReason,
      limits: lease.limits,
      turnIds: mine.map((t) => t.turnId),
      used: { turns: mine.length, tokens, spawns },
    };
  });
  leadCache.set(c, made);
  return made;
}

/** 이 턴을 주도한 구간(없으면 사용자나 다른 출처의 턴이다) */
export function selectLeadOfTurn(
  s: EngineMirror,
  threadId: ThreadId,
  turnId: TurnId,
): LeadSegment | undefined {
  return selectLeadSegments(s, threadId).find((l) => l.turnIds.includes(turnId));
}

// ── 하위 에이전트 ─────────────────────────────────────────────────────

/** 부모의 에이전트 줄이 읽는 값: 기록과 자식 대화의 진행 */
export type AgentRow = {
  readonly agent: AgentRecord;
  /** 자식 대화의 진행(단계 수, 지금 하는 도구). 자식 대화를 거울이 아직 못 봤으면 null이다 */
  readonly progress: AgentProgress | null;
};

type AgentProgress = {
  /** 자식의 지금(마지막) 턴이 끝낸 단계 수 */
  readonly steps: number;
  /** 자식이 지금 실행 중인 도구 이름(마지막 하나). 없으면 null */
  readonly currentTool: string | null;
  /** 자식 대화의 턴 수 */
  readonly turns: number;
  readonly running: boolean;
};

/** 자식 대화에서 지금 실행 중인 도구 이름. 확정 전 진행 item(`streaming`)에서 읽는다 */
function currentToolOf(streaming: Streaming, childThreadId: ThreadId): string | null {
  for (let i = streaming.itemIds.length - 1; i >= 0; i -= 1) {
    const id = streaming.itemIds[i];
    const item = id === undefined ? undefined : streaming.items[id];
    if (item !== undefined && item.threadId === childThreadId && item.toolName !== null) {
      return item.toolName;
    }
  }
  return null;
}

function progressOf(s: EngineMirror, childThreadId: ThreadId): AgentProgress | null {
  const child = s.convo[childThreadId];
  if (child === undefined) return null;
  const last = child.turns.at(-1);
  return {
    steps: last?.steps ?? 0,
    currentTool: currentToolOf(s.streaming, childThreadId),
    turns: child.turns.length,
    running: last !== undefined && last.completion === null,
  };
}

/** thread가 띄운 하위 에이전트와 자식 대화의 진행. 자식 사건은 같은 저장소 구독으로 이미 들어오므로 따로 구독하지 않는다 */
const NO_ROWS: readonly AgentRow[] = Object.freeze([]);
const rowsCache = new WeakMap<
  readonly AgentRecord[],
  {
    readonly convo: EngineMirror["convo"];
    readonly streaming: Streaming;
    readonly rows: readonly AgentRow[];
  }
>();

export function selectAgentRows(s: EngineMirror, threadId: ThreadId): readonly AgentRow[] {
  const agents = convoOf(s, threadId).agents;
  if (agents.length === 0) return NO_ROWS;
  const known = rowsCache.get(agents);
  if (known !== undefined && known.convo === s.convo && known.streaming === s.streaming) {
    return known.rows;
  }
  const rows = agents.map((agent) => ({ agent, progress: progressOf(s, agent.childThreadId) }));
  rowsCache.set(agents, { convo: s.convo, streaming: s.streaming, rows });
  return rows;
}

// ── 지금 ──────────────────────────────────────────────────────────────

type NowTask = {
  readonly id: string;
  readonly content: string;
  /** 진행 중일 때 보이는 문장(없으면 null) */
  readonly activeForm: string | null;
  /** 화면 분류: 할 일(todo) · 지금(now) · 끝(done). 실패와 취소는 끝으로 센다(`status`로 구분한다) */
  readonly state: "todo" | "now" | "done";
  readonly status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  readonly blocked: boolean;
};

/** 입력창 위 "지금 띠"가 읽는 값. 턴이 도는 중에도 사건마다 갱신된다 */
export type NowState = {
  /** 목표 한 줄(조건). 목표가 없으면 null */
  readonly goalLine: string | null;
  readonly goalStatus: GoalState["goal"]["status"] | null;
  /** 판정 n/max. 목표가 없으면 null */
  readonly judgment: { readonly n: number; readonly max: number } | null;
  readonly tasks: readonly NowTask[];
  /** 끝난 할 일 수와 센 할 일 수(취소는 세지 않는다) */
  readonly progress: { readonly done: number; readonly total: number };
  readonly runningAgents: number;
  readonly pendingApprovals: number;
  /** 지금 도는 턴이 있다 */
  readonly turnRunning: boolean;
  readonly aborting: boolean;
};

const nowCache = new WeakMap<
  ThreadConvo,
  { readonly approvals: EngineMirror["approvals"]; readonly now: NowState }
>();

function taskStateOf(status: NowTask["status"]): NowTask["state"] {
  if (status === "pending") return "todo";
  if (status === "in_progress") return "now";
  return "done";
}

/** thread의 "지금": 목표, 판정, 할 일 목록과 진행, 도는 하위 에이전트 수, 기다리는 승인 수 */
export function selectNow(s: EngineMirror, threadId: ThreadId): NowState {
  const c = convoOf(s, threadId);
  const cached = nowCache.get(c);
  if (cached !== undefined && cached.approvals === s.approvals) return cached.now;
  const tasks = c.taskOrder.flatMap((id): NowTask[] => {
    const t = c.tasks[id];
    if (t === undefined) return [];
    const blocked = t.task.blockedBy.some((b) => {
      const other = c.tasks[b];
      return other !== undefined && other.task.status !== "completed";
    });
    return [
      {
        id: t.task.id,
        content: t.task.content,
        activeForm: t.task.activeForm,
        state: taskStateOf(t.task.status),
        status: t.task.status,
        blocked,
      },
    ];
  });
  const counted = tasks.filter((t) => t.status !== "cancelled");
  const last = c.turns.at(-1);
  const goal = c.goal;
  const now: NowState = {
    goalLine: goal === null ? null : goal.goal.condition,
    goalStatus: goal === null ? null : goal.goal.status,
    judgment: goal === null ? null : { n: goal.goal.judgments, max: goal.goal.maxRuns },
    tasks,
    progress: {
      done: counted.filter((t) => t.status === "completed").length,
      total: counted.length,
    },
    runningAgents: c.agents.filter((a) => a.status === "running").length,
    pendingApprovals: Object.values(s.approvals.byId).filter((a) => a.threadId === threadId).length,
    turnRunning: last !== undefined && last.completion === null,
    aborting: last !== undefined && last.completion === null && last.abort !== null,
  };
  nowCache.set(c, { approvals: s.approvals, now });
  return now;
}

// ── 변화 표지 ─────────────────────────────────────────────────────────

/** 대화 줄 사이에 놓을 표지(모델 전환, 권한 모드 전환, 재개, 예약 실행 시작, 갈라내기·되감기). 줄 모델이 `at`·`seq`로 자리를 고른다 */
export function selectMarkers(s: EngineMirror, threadId: ThreadId): readonly ConvoMarker[] {
  const markers = convoOf(s, threadId).markers;
  return markers.length === 0 ? NO_MARKERS : markers;
}

// ── 작업 판(DP-195) ────────────────────────────────────────────────────

/** 작업 한 개(`work.task_*` 사건으로 쌓은 기록). 내용, 진행형 문장, 상태, 소유자, 막는 작업 id */
export type TaskRecord = ThreadConvo["tasks"][string]["task"];

const NO_TASK_RECORDS: readonly TaskRecord[] = Object.freeze([]);
const taskRecordsCache = new WeakMap<ThreadConvo, readonly TaskRecord[]>();

function taskRecordsOf(c: ThreadConvo): readonly TaskRecord[] {
  if (c.taskOrder.length === 0) return NO_TASK_RECORDS;
  const known = taskRecordsCache.get(c);
  if (known !== undefined) return known;
  const made = c.taskOrder.flatMap((id): TaskRecord[] => {
    const state = c.tasks[id];
    return state === undefined ? [] : [state.task];
  });
  taskRecordsCache.set(c, made);
  return made;
}

/** thread의 작업 기록(만든 순서). 컴팩션과 무관하게 사건에서 쌓인다. 없으면 빈 목록 */
export function selectTaskRecords(s: EngineMirror, threadId: ThreadId): readonly TaskRecord[] {
  return taskRecordsOf(convoOf(s, threadId));
}

/** 작업이 있는 대화 하나 */
export type ThreadTasks = { readonly threadId: ThreadId; readonly tasks: readonly TaskRecord[] };

const NO_THREAD_TASKS: readonly ThreadTasks[] = Object.freeze([]);
const threadTasksCache = new WeakMap<
  EngineMirror["convo"],
  { readonly ids: readonly ThreadId[]; readonly made: readonly ThreadTasks[] }
>();

/** 작업 기록이 있는 대화들(목록 순서: 최근 활동 먼저). 열린 대화가 없을 때 작업 탭이 묶어 보인다 */
export function selectThreadsWithTasks(s: EngineMirror): readonly ThreadTasks[] {
  const known = threadTasksCache.get(s.convo);
  if (known !== undefined && known.ids === s.threads.ids) return known.made;
  const made = s.threads.ids.flatMap((threadId): ThreadTasks[] => {
    const c = s.convo[threadId];
    if (c === undefined || c.taskOrder.length === 0) return [];
    return [{ threadId, tasks: taskRecordsOf(c) }];
  });
  const result = made.length === 0 ? NO_THREAD_TASKS : made;
  threadTasksCache.set(s.convo, { ids: s.threads.ids, made: result });
  return result;
}

// ── 실행 중(DP-196) ────────────────────────────────────────────────────

/**
 * 실행 중 탭이 읽는 대화 하나의 값. 무엇을 보일지(도는 중, 기다림, 방금 끝남)는 화면 모델(`views/panels/running/running-model.ts`)이 시각과 함께 정한다.
 * 끝남은 엔진 상태(대화 `status`, 턴 `completion`, 에이전트 `status`)에서만 온다
 */
export type RunSource = {
  readonly summary: ThreadSummary;
  /** 거울이 아는 마지막 턴. 모르면 null */
  readonly lastTurn: TurnRecord | null;
  /** 지금 실행 중인 도구 이름(확정 전 진행 item). 없으면 null */
  readonly currentTool: string | null;
  /** 이 대화를 띄운 하위 에이전트 기록(자식 대화일 때 부모 거울에서 찾는다). 없으면 null */
  readonly agent: AgentRecord | null;
};

const runSourcesCache = new WeakMap<
  EngineMirror["threads"],
  {
    readonly convo: EngineMirror["convo"];
    readonly streaming: Streaming;
    readonly made: readonly RunSource[];
  }
>();

/** 엔진 내부 일로 만든 대화를 뺀 모든 대화의 실행 값(목록 순서) */
export function selectRunSources(s: EngineMirror): readonly RunSource[] {
  const known = runSourcesCache.get(s.threads);
  if (known !== undefined && known.convo === s.convo && known.streaming === s.streaming) {
    return known.made;
  }
  const agentsByChild = new Map<string, AgentRecord>();
  for (const c of Object.values(s.convo)) {
    for (const agent of c.agents) agentsByChild.set(agent.childThreadId, agent);
  }
  const made = s.threads.ids.flatMap((threadId): RunSource[] => {
    const summary = s.threads.byId[threadId];
    if (summary === undefined || summary.spawnedBy?.kind === "internal") return [];
    const c = s.convo[threadId];
    return [
      {
        summary,
        lastTurn: c?.turns.at(-1) ?? null,
        currentTool: summary.status === "running" ? currentToolOf(s.streaming, threadId) : null,
        agent: agentsByChild.get(threadId) ?? null,
      },
    ];
  });
  runSourcesCache.set(s.threads, { convo: s.convo, streaming: s.streaming, made });
  return made;
}

/** 도는 대화 수(엔진 내부 대화 제외). 막대 "실행 중" 칸의 숫자다 */
export const selectRunningThreadCount = (s: EngineMirror): number =>
  s.threads.ids.reduce((n, id) => {
    const summary = s.threads.byId[id];
    return summary !== undefined &&
      summary.status === "running" &&
      summary.spawnedBy?.kind !== "internal"
      ? n + 1
      : n;
  }, 0);
