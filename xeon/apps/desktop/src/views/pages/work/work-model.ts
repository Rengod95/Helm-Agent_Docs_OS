import type { MessageArgs, MessageId } from "@fresnel/client/i18n";
import { assertNever, type Result } from "@fresnel/contracts";
import type { WireResult } from "@fresnel/contracts/wire";
import type { CommandError } from "../../commands.ts";

// 목표와 작업 화면(P-14)의 순수 모델. 목표 상태 값, 작업 목록의 접기, 목표 명령 줄과 읽기 상태를 다룬다.
// 계획 카드(W-18)의 값과 판 목록도 여기서 만든다. 값은 `toEqual`로 비교한다.
// 문장은 `MessageRef`(id와 인자)로 돌려주고 그릴 때 `t()`로 만든다.

export type GoalWire = WireResult<"goal.status">["goal"];
export type TaskWire = WireResult<"work.tasks.list">["tasks"][number];
export type PlanVersionWire = WireResult<"work.plans.versions">["versions"][number];
type GoalStatusWire = "active" | "met" | "exhausted" | "cleared";

/** 그릴 때 `t()`로 만들 문장: 메시지 id와 인자 */
interface MessageRef {
  readonly id: MessageId;
  readonly args?: MessageArgs;
}

/** 목표 한 개의 화면 값. "판정 2/3"의 두 숫자와 마지막 판정, 끝난 까닭을 담는다 */
export interface GoalVM {
  readonly condition: string;
  readonly status: GoalStatusWire;
  readonly statusRef: MessageRef;
  readonly judged: number;
  readonly maxJudgments: number;
  readonly verdict: { readonly met: boolean; readonly reason: string } | null;
  /** 끝난 까닭. 진행 중이면 null */
  readonly endRef: MessageRef | null;
}

export function goalVMOf(goal: NonNullable<GoalWire>): GoalVM {
  return {
    condition: goal.condition,
    status: goal.status,
    statusRef: { id: goalStatusIdOf(goal.status) },
    judged: goal.judged,
    maxJudgments: goal.maxJudgments,
    verdict: goal.lastVerdict,
    endRef: goalEndRefOf(goal),
  };
}

function goalStatusIdOf(status: GoalStatusWire): MessageId {
  switch (status) {
    case "active":
      return "desktop.work.goal.status.active";
    case "met":
      return "desktop.work.goal.status.met";
    case "exhausted":
      return "desktop.work.goal.status.exhausted";
    case "cleared":
      return "desktop.work.goal.status.cleared";
    default:
      return assertNever(status, "GoalStatusWire");
  }
}

/**
 * 끝난 까닭. 호스트는 `limit_reached`와 `judge_failed`를 둘 다 `exhausted`로 준다(`goalViewOf`). 판정 횟수가 최대에 닿았으면
 * 한도 때문이고, 아니면 판정이 실패한 것으로 본다. 이 구분은 화면 문장만 바꾸고 상태 값은 바꾸지 않는다.
 */
function goalEndRefOf(goal: NonNullable<GoalWire>): MessageRef | null {
  switch (goal.status) {
    case "active":
      return null;
    case "met":
      return { id: "desktop.work.goal.end.met" };
    case "cleared":
      return { id: "desktop.work.goal.end.cleared" };
    case "exhausted":
      return goal.judged >= goal.maxJudgments
        ? { id: "desktop.work.goal.end.limit", args: { count: goal.maxJudgments } }
        : { id: "desktop.work.goal.end.judgeFailed" };
    default:
      return assertNever(goal.status, "GoalStatusWire");
  }
}

/** 작업 목록을 접는 기준. 작업이 이만큼을 넘으면 완료된 작업을 접는다 */
export const DONE_FOLD_LIMIT = 100;

type TaskStepStatus = "todo" | "now" | "done";

interface TaskStep {
  readonly id: string;
  readonly label: string;
  readonly status: TaskStepStatus;
  /** 막힘 사유나 취소 표지. 없으면 null */
  readonly detailRef: MessageRef | null;
}

export interface TaskListVM {
  /** 그릴 작업 행(접힌 완료 작업은 뺀다) */
  readonly steps: readonly TaskStep[];
  readonly total: number;
  readonly doneCount: number;
  /** 완료 작업을 접을 수 있는가(작업이 `DONE_FOLD_LIMIT`을 넘을 때) */
  readonly foldable: boolean;
  /** 접혀 있어 보이지 않는 완료 작업 수 */
  readonly hiddenDone: number;
}

export function taskListOf(tasks: readonly TaskWire[], doneExpanded: boolean): TaskListVM {
  const all = tasks.map(taskStepOf);
  const doneCount = all.filter((step) => step.status === "done").length;
  const foldable = tasks.length > DONE_FOLD_LIMIT;
  const hideDone = foldable && !doneExpanded;
  const steps = hideDone ? all.filter((step) => step.status !== "done") : all;
  return {
    steps,
    total: tasks.length,
    doneCount,
    foldable,
    hiddenDone: hideDone ? doneCount : 0,
  };
}

function taskStepOf(task: TaskWire): TaskStep {
  const status: TaskStepStatus =
    task.status === "done" ? "done" : task.status === "in_progress" ? "now" : "todo";
  let detailRef: MessageRef | null = null;
  if (task.status === "cancelled") detailRef = { id: "desktop.work.tasks.cancelled" };
  else if (task.blockedBy !== null) {
    detailRef = { id: "desktop.work.tasks.blocked", args: { reason: task.blockedBy } };
  }
  return { id: task.taskId, label: task.content, status, detailRef };
}

/** 목표 명령 줄. 걸기는 조건 글을, 해제는 `clear`다 */
export type GoalIntent =
  | { readonly kind: "set"; readonly condition: string }
  | { readonly kind: "clear" };

/** 조건 글의 최대 길이(`GoalView.condition`의 상한과 같다) */
export const GOAL_CONDITION_MAX = 4000;

export type GoalCommandError = { readonly kind: "empty" } | { readonly kind: "tooLong" };

/**
 * 목표 명령 줄을 만든다. 조건은 앞뒤 빈칸을 떼고 쓴다. 빈 조건과 상한을 넘는 조건은 보내기 전에 거른다.
 * 결과 줄은 `command.run`의 `text`로 그대로 간다.
 */
export function goalCommandTextOf(
  intent: GoalIntent,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: GoalCommandError } {
  if (intent.kind === "clear") return { ok: true, value: "/goal clear" };
  const condition = intent.condition.trim();
  if (condition === "") return { ok: false, error: { kind: "empty" } };
  if (condition.length > GOAL_CONDITION_MAX) return { ok: false, error: { kind: "tooLong" } };
  return { ok: true, value: `/goal ${condition}` };
}

// ---- 계획 카드와 판 목록(P-14, W-18) ----

/** 판 목록에 그리는 판 수 상한(최신 판부터). 넘는 오래된 판은 숨기고 그 수를 알린다 */
export const PLAN_VERSION_LIST_MAX = 50;

/** 접힌 판 본문의 글 수 상한(UTF-16 단위). 넘으면 잘라 보이고 펼치기를 둔다 */
export const PLAN_PREVIEW_CHARS = 200;

/** 계획 읽기 상태. `ready`의 판 목록은 호스트가 준 그대로다(정렬은 화면 모델이 한다) */
export type PlanLoad =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "notFound" }
  | { readonly status: "ready"; readonly versions: readonly PlanVersionWire[] };

/**
 * 대화의 최근 계획과 그 판 목록. `planId`가 null이면 이 대화에 계획이 없어 카드가 숨는다.
 * 판 목록은 카드(최신 판의 제목, 번호, 상태)와 "버전 보기" 목록이 같이 쓴다.
 */
interface PlanState {
  readonly planId: string | null;
  readonly load: PlanLoad;
}

/** 계획 판 상태의 문장 id */
export function planStatusIdOf(status: PlanVersionWire["status"]): MessageId {
  switch (status) {
    case "submitted":
      return "desktop.work.plan.status.submitted";
    case "approved":
      return "desktop.work.plan.status.approved";
    case "rejected":
      return "desktop.work.plan.status.rejected";
    case "revision_requested":
      return "desktop.work.plan.status.revisionRequested";
    case "superseded":
      return "desktop.work.plan.status.superseded";
    case "withdrawn":
      return "desktop.work.plan.status.withdrawn";
    default:
      return assertNever(status, "PlanVersionWire.status");
  }
}

/** 판 번호가 가장 큰 판. 판이 없으면 null */
export function latestPlanVersion(versions: readonly PlanVersionWire[]): PlanVersionWire | null {
  let latest: PlanVersionWire | null = null;
  for (const version of versions) {
    if (latest === null || version.version > latest.version) latest = version;
  }
  return latest;
}

/** 계획 카드 값: 최신 판의 제목, 판 번호, 상태 */
export interface PlanCardVM {
  readonly title: string;
  readonly version: number;
  readonly statusRef: MessageRef;
}

/** 판 목록이 비어 있으면 null이다(그림은 못 찾은 것으로 본다) */
export function planCardOf(versions: readonly PlanVersionWire[]): PlanCardVM | null {
  const latest = latestPlanVersion(versions);
  if (latest === null) return null;
  return {
    title: latest.title,
    version: latest.version,
    statusRef: { id: planStatusIdOf(latest.status) },
  };
}

/** 계획 읽기 상태를 그림이 고르는 갈래. 읽는 중에 연결이 없으면 오프라인이고, 판이 없으면 못 찾은 것이다 */
export type PlanLoadView = "loading" | "offline" | "failed" | "notFound" | "ready";

export function planLoadViewOf(load: PlanLoad, live: boolean): PlanLoadView {
  switch (load.status) {
    case "loading":
      return live ? "loading" : "offline";
    case "failed":
      return "failed";
    case "notFound":
      return "notFound";
    case "ready":
      return load.versions.length === 0 ? "notFound" : "ready";
    default:
      return assertNever(load, "PlanLoad");
  }
}

/** 판 목록의 한 줄. 접힌 글은 `preview`이고, 펼치면 `body`와 `feedback`이 보인다 */
export interface PlanVersionRow {
  readonly version: number;
  readonly title: string;
  readonly statusRef: MessageRef;
  readonly preview: string;
  /** 펼치면 더 보이는 것이 있나(본문이 잘렸거나 의견이 있다) */
  readonly expandable: boolean;
  readonly body: string;
  /** 반려 사유나 수정 요청 내용. 없으면 null */
  readonly feedback: string | null;
}

export interface PlanVersionListVM {
  /** 최신 판부터 `PLAN_VERSION_LIST_MAX`개 */
  readonly rows: readonly PlanVersionRow[];
  /** 숨긴 오래된 판 수 */
  readonly hiddenCount: number;
}

/** 판 목록을 최신 판부터 정렬하고 상한만큼 자른다. 본문은 접힌 글로 줄인다 */
export function planVersionListOf(versions: readonly PlanVersionWire[]): PlanVersionListVM {
  const newest = [...versions].toSorted((a, b) => b.version - a.version);
  const shown = newest.slice(0, PLAN_VERSION_LIST_MAX);
  return { rows: shown.map(planVersionRowOf), hiddenCount: newest.length - shown.length };
}

function planVersionRowOf(version: PlanVersionWire): PlanVersionRow {
  const body = version.body.trim();
  const { preview, cut } = previewOf(body);
  const feedback =
    version.feedback === null || version.feedback.trim() === "" ? null : version.feedback.trim();
  return {
    version: version.version,
    title: version.title,
    statusRef: { id: planStatusIdOf(version.status) },
    preview,
    expandable: cut || feedback !== null,
    body,
    feedback,
  };
}

/** 글을 상한까지 자른다. 글자 쌍의 앞 절반에서 자르지 않는다 */
function previewOf(text: string): { readonly preview: string; readonly cut: boolean } {
  if (text.length <= PLAN_PREVIEW_CHARS) return { preview: text, cut: false };
  let end = PLAN_PREVIEW_CHARS;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return { preview: `${text.slice(0, end)}…`, cut: true };
}

/**
 * 판 목록 읽기 결과를 화면 동작으로 바꾼다. 모르는 계획 id(거절의 `path`가 `planId`)는 못 찾은 것이고,
 * 나머지 실패는 읽기 실패다. 읽기 결과가 늦게 와도 `planId`가 같을 때만 상태에 들어간다(reducer가 본다).
 */
export function planActionOf(
  planId: string,
  listed: Result<WireResult<"work.plans.versions">, CommandError>,
): WorkAction {
  if (listed.ok) return { type: "planLoaded", planId, versions: listed.value.versions };
  const notFound = listed.error.kind === "rejected" && listed.error.path === "planId";
  return { type: "planFailed", planId, reason: notFound ? "notFound" : "failed" };
}

// ---- 읽기 상태와 화면 상태 ----

/** 한 번 읽는 값의 상태. 실패는 값이고 다시 읽기로 바뀐다 */
type WorkLoad<T> =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "ready"; readonly value: T };

export interface WorkNotice {
  readonly tone: "success" | "danger" | "info";
  readonly text: string;
}

export interface WorkState {
  readonly goal: WorkLoad<GoalWire>;
  readonly tasks: WorkLoad<readonly TaskWire[]>;
  readonly plan: PlanState;
  /** 판 목록 대화상자가 열려 있나 */
  readonly versionsOpen: boolean;
  readonly doneExpanded: boolean;
  readonly draft: string;
  readonly busy: boolean;
  readonly notice: WorkNotice | null;
}

export const INITIAL_WORK_STATE: WorkState = {
  goal: { status: "loading" },
  tasks: { status: "loading" },
  plan: { planId: null, load: { status: "loading" } },
  versionsOpen: false,
  doneExpanded: false,
  draft: "",
  busy: false,
  notice: null,
};

export type WorkAction =
  | { readonly type: "loadStarted" }
  | { readonly type: "goalLoaded"; readonly goal: GoalWire }
  | { readonly type: "goalFailed" }
  | { readonly type: "tasksLoaded"; readonly tasks: readonly TaskWire[] }
  | { readonly type: "tasksFailed" }
  | { readonly type: "planLoadStarted"; readonly planId: string | null }
  | {
      readonly type: "planLoaded";
      readonly planId: string;
      readonly versions: readonly PlanVersionWire[];
    }
  | { readonly type: "planFailed"; readonly planId: string; readonly reason: "notFound" | "failed" }
  | { readonly type: "versionsOpened" }
  | { readonly type: "versionsClosed" }
  | { readonly type: "draftChanged"; readonly draft: string }
  | { readonly type: "busyChanged"; readonly busy: boolean }
  | { readonly type: "doneToggled" }
  | { readonly type: "noticeSet"; readonly notice: WorkNotice | null };

export function workReducer(state: WorkState, action: WorkAction): WorkState {
  switch (action.type) {
    case "loadStarted":
      // 다시 읽는 동안에도 마지막 값은 둔다. 처음 읽을 때만 읽는 중 상태다
      return {
        ...state,
        goal: state.goal.status === "ready" ? state.goal : { status: "loading" },
        tasks: state.tasks.status === "ready" ? state.tasks : { status: "loading" },
      };
    case "goalLoaded":
      return { ...state, goal: { status: "ready", value: action.goal } };
    case "goalFailed":
      return { ...state, goal: { status: "failed" } };
    case "tasksLoaded":
      return { ...state, tasks: { status: "ready", value: action.tasks } };
    case "tasksFailed":
      return { ...state, tasks: { status: "failed" } };
    case "planLoadStarted": {
      // 같은 계획의 마지막 판 목록은 다시 읽는 동안에도 둔다. 계획이 바뀌었거나 처음이면 읽는 중이다
      const kept =
        action.planId !== null &&
        state.plan.planId === action.planId &&
        state.plan.load.status === "ready";
      return {
        ...state,
        plan: { planId: action.planId, load: kept ? state.plan.load : { status: "loading" } },
      };
    }
    case "planLoaded":
      if (state.plan.planId !== action.planId) return state;
      return {
        ...state,
        plan: { planId: action.planId, load: { status: "ready", versions: action.versions } },
      };
    case "planFailed":
      if (state.plan.planId !== action.planId) return state;
      return {
        ...state,
        plan: {
          planId: action.planId,
          load: action.reason === "notFound" ? { status: "notFound" } : { status: "failed" },
        },
      };
    case "versionsOpened":
      return { ...state, versionsOpen: true };
    case "versionsClosed":
      return { ...state, versionsOpen: false };
    case "draftChanged":
      return { ...state, draft: action.draft };
    case "busyChanged":
      return { ...state, busy: action.busy };
    case "doneToggled":
      return { ...state, doneExpanded: !state.doneExpanded };
    case "noticeSet":
      return { ...state, notice: action.notice };
    default:
      return assertNever(action, "WorkAction");
  }
}
