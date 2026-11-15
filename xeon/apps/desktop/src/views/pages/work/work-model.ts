import type { MessageArgs, MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { WireResult } from "@fresnel/contracts/wire";

// 작업 탭(P-14, DP-195)의 목표 순수 모델. 목표 상태 값, 목표 명령 줄과 읽기 상태를 다룬다.
// 작업 목록은 거울에서 사건마다 읽으므로 여기 없다(`views/panels/tasks/task-board-model.ts`).
// 문장은 `MessageRef`(id와 인자)로 돌려주고 그릴 때 `t()`로 만든다.

export type GoalWire = WireResult<"goal.status">["goal"];
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
  readonly draft: string;
  readonly busy: boolean;
  readonly notice: WorkNotice | null;
}

export const INITIAL_WORK_STATE: WorkState = {
  goal: { status: "loading" },
  draft: "",
  busy: false,
  notice: null,
};

export type WorkAction =
  | { readonly type: "loadStarted" }
  | { readonly type: "goalLoaded"; readonly goal: GoalWire }
  | { readonly type: "goalFailed" }
  | { readonly type: "draftChanged"; readonly draft: string }
  | { readonly type: "busyChanged"; readonly busy: boolean }
  | { readonly type: "noticeSet"; readonly notice: WorkNotice | null };

export function workReducer(state: WorkState, action: WorkAction): WorkState {
  switch (action.type) {
    case "loadStarted":
      // 다시 읽는 동안에도 마지막 값은 둔다. 처음 읽을 때만 읽는 중 상태다
      return {
        ...state,
        goal: state.goal.status === "ready" ? state.goal : { status: "loading" },
      };
    case "goalLoaded":
      return { ...state, goal: { status: "ready", value: action.goal } };
    case "goalFailed":
      return { ...state, goal: { status: "failed" } };
    case "draftChanged":
      return { ...state, draft: action.draft };
    case "busyChanged":
      return { ...state, busy: action.busy };
    case "noticeSet":
      return { ...state, notice: action.notice };
    default:
      return assertNever(action, "WorkAction");
  }
}
