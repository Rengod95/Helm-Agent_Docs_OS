import type { AgentRow, LeadSegment, NowState } from "../../state/engine/index.ts";
import type { DriveFramesRead } from "../convo/drive-frames.ts";
import { driveBandShownOf, driveStackOf } from "../convo/drive-stack-model.ts";

// 입력창 위 "지금 띠"의 순수 판정(L4.desktop-ux DP-100 [결정: 2026-11-11 사용자]). 화면 부품(now-strip.tsx)에서 떼어 React 밖에서 시험한다.
// 값은 dzT1의 선택자(`selectNow`, `selectAgentRows`, `selectLeadSegments`)가 준다. 이 파일은 무엇을 보일지만 정한다.

export type NowTaskView = NowState["tasks"][number];

/** 접힌 줄 앞 아이콘의 상태 */
export type NowPulse = "running" | "stopping" | "idle";

/** 접힌 줄 본문 한 줄의 출처. 글은 부품이 고른다(할 일 문장은 그대로, 나머지는 번역 문장) */
export type NowHeadline =
  | { readonly kind: "task"; readonly text: string }
  | { readonly kind: "goal"; readonly text: string }
  | { readonly kind: "count"; readonly count: number }
  | { readonly kind: "agents"; readonly count: number }
  | { readonly kind: "lead"; readonly name: string }
  | { readonly kind: "stopping" };

interface NowLead {
  /** 화면에 보일 확장 이름(scope id의 마지막 조각) */
  readonly name: string;
  readonly turns: number;
  /** 턴 한도. 없으면 null */
  readonly maxTurns: number | null;
}

export interface NowAgentView {
  readonly id: string;
  readonly name: string;
  readonly running: boolean;
  /** 자식이 지금 부르는 도구. 모르면 null */
  readonly tool: string | null;
  readonly steps: number;
  readonly status: AgentRow["agent"]["status"];
}

export interface NowView {
  readonly pulse: NowPulse;
  readonly headline: NowHeadline;
  /** 진행 수. 할 일이 없으면 null */
  readonly progress: { readonly done: number; readonly total: number } | null;
  readonly goal: {
    readonly text: string;
    readonly judgment: { readonly n: number; readonly max: number } | null;
  } | null;
  readonly tasks: readonly NowTaskView[];
  readonly agents: readonly NowAgentView[];
  readonly runningAgents: number;
  readonly lead: NowLead | null;
  readonly pendingApprovals: number;
}

/** scope id(`group:helm`, `ext/helm` 같은 꼴)에서 사람이 읽을 이름. 구분자가 없으면 그대로 */
export function scopeNameOf(scopeId: string): string {
  const parts = scopeId.split(/[:/]/).filter((part) => part !== "");
  return parts.at(-1) ?? scopeId;
}

function leadOf(leads: readonly LeadSegment[]): NowLead | null {
  const active = leads.findLast((lead) => lead.active);
  if (active === undefined) return null;
  return {
    name: scopeNameOf(active.scopeId),
    turns: active.used.turns,
    maxTurns: active.limits.maxTurns ?? null,
  };
}

function agentViewOf(row: AgentRow): NowAgentView {
  return {
    id: row.agent.childThreadId,
    name: row.agent.agent,
    running: row.agent.status === "running",
    tool: row.progress?.currentTool ?? null,
    steps: row.progress?.steps ?? 0,
    status: row.agent.status,
  };
}

/** 끝나지 않은 할 일이 있나(할 일·지금). 실패·취소·끝은 끝난 것이다 */
function hasOpenTasks(tasks: readonly NowTaskView[]): boolean {
  return tasks.some((task) => task.state !== "done");
}

/**
 * 띠를 그릴 것인가. 진행 중 목표, 끝나지 않은 할 일, 턴이 도는 동안의 할 일 목록(다 끝났어도), 도는 하위 에이전트, 주도 중인 플러그인,
 * 멈추는 중 가운데 하나라도 있으면 그린다. 아무것도 없으면 그리지 않는다
 */
export function nowShownOf(
  now: NowState,
  agents: readonly AgentRow[],
  leads: readonly LeadSegment[],
): boolean {
  if (now.aborting) return true;
  if (now.goalLine !== null && now.goalStatus === "active") return true;
  if (hasOpenTasks(now.tasks)) return true;
  if (now.turnRunning && now.tasks.length > 0) return true;
  if (agents.some((row) => row.agent.status === "running")) return true;
  return leads.some((lead) => lead.active);
}

/** 접힌 줄 본문: 멈추는 중 > 지금 할 일(activeForm, 없으면 내용) > 진행 중 목표 > 남은 할 일 수 > 도는 에이전트 > 주도 */
function headlineOf(now: NowState, lead: NowLead | null, runningAgents: number): NowHeadline {
  if (now.aborting) return { kind: "stopping" };
  const current = now.tasks.find((task) => task.state === "now");
  if (current !== undefined) return { kind: "task", text: current.activeForm ?? current.content };
  if (now.goalLine !== null && now.goalStatus === "active")
    return { kind: "goal", text: now.goalLine };
  const open = now.tasks.filter((task) => task.state !== "done").length;
  if (open > 0) return { kind: "count", count: open };
  if (runningAgents > 0) return { kind: "agents", count: runningAgents };
  if (lead !== null) return { kind: "lead", name: lead.name };
  return { kind: "count", count: 0 };
}

export function nowViewOf(
  now: NowState,
  agents: readonly AgentRow[],
  leads: readonly LeadSegment[],
): NowView {
  const lead = leadOf(leads);
  const agentViews = agents.map(agentViewOf);
  const runningAgents = agentViews.filter((agent) => agent.running).length;
  return {
    pulse: now.aborting ? "stopping" : now.turnRunning ? "running" : "idle",
    headline: headlineOf(now, lead, runningAgents),
    progress: now.progress.total === 0 ? null : now.progress,
    goal:
      now.goalLine === null
        ? null
        : { text: now.goalLine, judgment: now.goalStatus === "active" ? now.judgment : null },
    tasks: now.tasks,
    agents: agentViews,
    runningAgents,
    lead,
    pendingApprovals: now.pendingApprovals,
  };
}

/** 진행 막대 값(0~100). 할 일이 없으면 null */
export function progressPercentOf(progress: NowView["progress"]): number | null {
  if (progress === null || progress.total === 0) return null;
  return Math.round((progress.done / progress.total) * 100);
}

const NO_LEADS: readonly LeadSegment[] = [];

/**
 * 지금 띠가 보일 Drive 구간(lcM6g). 입력창 위 Drive 띠(composer.tsx `DriveStackBand`)가 보이면 같은 사실("Driving by authoring", 턴 수)을
 * 그 띠가 이미 말하므로 여기서는 뺀다(입력창 위 두 줄이 같은 말을 하지 않게). 띠를 그릴지 아직 모르면(스택을 읽는 중) 역시 뺀다: 대화를
 * 열자마자 이 줄이 떴다가 띠가 오면 사라지는 깜빡임을 막는다. 연결이 없거나 스택을 못 읽었거나 기본 루프만 돌면 띠가 없으므로 그대로 둔다
 */
export function leadsBesideBandOf(
  leads: readonly LeadSegment[],
  frames: DriveFramesRead,
): readonly LeadSegment[] {
  if (frames.kind === "loading") return NO_LEADS;
  if (frames.kind === "ready" && driveBandShownOf(driveStackOf(frames.frames))) return NO_LEADS;
  return leads;
}
