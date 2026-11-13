import type { ThreadId } from "@fresnel/contracts/conversation";
import type { RunSource } from "../../../state/engine/index.ts";

// 실행 중 탭(DP-196)의 순수 모델. 거울의 대화 값(`selectRunSources`)과 지금 시각으로 세 묶음을 만든다:
// 기다림(승인을 기다리는 대화) · 도는 중 · 방금 끝남(끝난 지 `JUST_FINISHED_MS` 안). 자식(하위 에이전트) 대화는 같은 묶음의 부모 아래에 둔다.
// "끝남"은 엔진 상태에서만 정한다: 대화가 running이 아니고, 하위 에이전트면 기록도 running이 아니며, 끝난 시각이 있어야 한다
// (zed#54602처럼 아직 도는 것을 끝났다고 보이지 않는다).

/** 방금 끝난 것을 남겨 두는 시간 */
export const JUST_FINISHED_MS = 120_000;

type RunState = "waiting" | "running" | "finished";

type RunOutcome = "completed" | "interrupted" | "failed";

export interface RunRow {
  readonly threadId: ThreadId;
  /** 대화 제목(없으면 첫 입력 미리보기, 그것도 없으면 null) */
  readonly title: string | null;
  /** 하위 에이전트 이름. 사용자 대화면 null */
  readonly agentName: string | null;
  readonly background: boolean;
  /** 대화를 만든 쪽이 예약·원격이면 그 종류 */
  readonly origin: "schedule" | "remote" | null;
  readonly state: RunState;
  /** 끝난 것의 결과. 끝나지 않았으면 null */
  readonly outcome: RunOutcome | null;
  readonly approvals: number;
  /** 지금 부르는 도구. 없으면 null */
  readonly tool: string | null;
  /** 마지막 턴의 끝낸 단계 수 */
  readonly steps: number;
  /** 도는 중이면 턴 시작(모르면 마지막 활동), 끝났으면 끝난 시각(epoch ms) */
  readonly sinceMs: number;
  /** 끝난 것의 토큰 합. 모르면 null */
  readonly tokens: number | null;
  /** 부모 대화 id(자식 대화일 때) */
  readonly parentId: ThreadId | null;
  /** 같은 묶음에 부모가 없어 위로 올라온 자식이면 부모 제목 */
  readonly parentTitle: string | null;
  readonly children: readonly RunRow[];
}

export interface RunBoard {
  readonly waiting: readonly RunRow[];
  readonly running: readonly RunRow[];
  readonly finished: readonly RunRow[];
  /** 도는 대화 수(자식 포함) */
  readonly runningCount: number;
  readonly waitingCount: number;
}

const parseMs = (iso: string | null | undefined): number | null => {
  if (iso === null || iso === undefined) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

function titleOf(source: RunSource): string | null {
  const title = source.summary.title?.trim() ?? "";
  if (title !== "") return title;
  return source.summary.preview ?? null;
}

function stateOf(source: RunSource, openThreadId: ThreadId | null, nowMs: number): RunState | null {
  const { summary, agent } = source;
  if (summary.pendingApprovals > 0) return "waiting";
  if (summary.status === "running" || agent?.status === "running") return "running";
  const endMs = finishedAtOf(source);
  if (endMs === null || nowMs - endMs > JUST_FINISHED_MS || nowMs - endMs < -JUST_FINISHED_MS) {
    return null;
  }
  // 열린 대화의 사용자 턴은 눈앞에서 끝났으므로 다시 알리지 않는다(자식은 남긴다)
  if (agent === null && summary.threadId === openThreadId) return null;
  return "finished";
}

function finishedAtOf(source: RunSource): number | null {
  if (source.agent !== null) {
    return source.agent.status === "running" ? null : parseMs(source.agent.settledAt);
  }
  return parseMs(source.lastTurn?.completion?.at);
}

function outcomeOf(source: RunSource): RunOutcome {
  if (source.agent !== null) {
    if (source.agent.status === "completed") return "completed";
    if (source.agent.status === "aborted") return "interrupted";
    return "failed";
  }
  return source.lastTurn?.completion?.status ?? "completed";
}

function rowOf(
  source: RunSource,
  state: RunState,
  titles: ReadonlyMap<string, string | null>,
): RunRow {
  const { summary, agent, lastTurn } = source;
  const parentId = summary.spawnedBy?.kind === "subagent" ? summary.spawnedBy.threadId : null;
  const startMs =
    parseMs(lastTurn?.completion === null ? lastTurn.startedAt : null) ??
    parseMs(agent?.status === "running" ? agent.spawnedAt : null) ??
    parseMs(summary.updatedAt) ??
    0;
  const sinceMs = state === "finished" ? (finishedAtOf(source) ?? startMs) : startMs;
  const tokens =
    state === "finished"
      ? (agent?.usage?.totalTokens ?? lastTurn?.completion?.usage?.totalTokens ?? null)
      : null;
  const origin =
    summary.origin?.kind === "schedule" || summary.origin?.kind === "remote"
      ? summary.origin.kind
      : null;
  return {
    threadId: summary.threadId,
    title: titleOf(source),
    agentName: agent?.agent ?? null,
    background: agent?.background ?? false,
    origin,
    state,
    outcome: state === "finished" ? outcomeOf(source) : null,
    approvals: summary.pendingApprovals,
    tool: source.currentTool,
    steps: lastTurn?.steps ?? 0,
    sinceMs,
    tokens,
    parentId,
    parentTitle: parentId === null ? null : (titles.get(parentId) ?? null),
    children: [],
  };
}

/** 같은 묶음 안에서 자식을 부모 아래로 모은다. 부모가 묶음에 없으면 자식은 위에 남고 부모 제목을 단다 */
function nest(rows: readonly RunRow[]): readonly RunRow[] {
  const ids = new Set(rows.map((row) => String(row.threadId)));
  const childrenOf = new Map<string, RunRow[]>();
  for (const row of rows) {
    if (row.parentId !== null && ids.has(String(row.parentId))) {
      const list = childrenOf.get(String(row.parentId)) ?? [];
      list.push(row);
      childrenOf.set(String(row.parentId), list);
    }
  }
  const attach = (row: RunRow): RunRow => {
    const kids = childrenOf.get(String(row.threadId));
    return kids === undefined ? row : { ...row, parentTitle: null, children: kids.map(attach) };
  };
  return rows.filter((row) => row.parentId === null || !ids.has(String(row.parentId))).map(attach);
}

export function runBoardOf(
  sources: readonly RunSource[],
  openThreadId: ThreadId | null,
  nowMs: number,
): RunBoard {
  const titles = new Map(
    sources.map((source) => [String(source.summary.threadId), titleOf(source)]),
  );
  const groups: Record<RunState, RunRow[]> = { waiting: [], running: [], finished: [] };
  for (const source of sources) {
    const state = stateOf(source, openThreadId, nowMs);
    if (state !== null) groups[state].push(rowOf(source, state, titles));
  }
  // 방금 끝난 것은 최근에 끝난 것이 위다
  groups.finished.sort((a, b) => b.sinceMs - a.sinceMs);
  return {
    waiting: nest(groups.waiting),
    running: nest(groups.running),
    finished: nest(groups.finished),
    runningCount: groups.running.length,
    waitingCount: groups.waiting.length,
  };
}

/** 경과 시간 글의 인자(시계는 30초마다 흐르므로 1분 안은 "방금"이다): 1시간 안이면 분, 그 밖은 시간 */
export function elapsedOf(
  sinceMs: number,
  nowMs: number,
): { readonly unit: "justNow" | "minutes" | "hours"; readonly count: number } {
  const minutes = Math.max(0, Math.floor((nowMs - sinceMs) / 60_000));
  if (minutes < 1) return { unit: "justNow", count: 0 };
  if (minutes < 60) return { unit: "minutes", count: minutes };
  return { unit: "hours", count: Math.floor(minutes / 60) };
}
