import type { ProposalAction, ProposalRowVM, ProposalScope } from "@fresnel/client/settings";
import { assertNever } from "@fresnel/contracts";
import type { ProposalListParams, ProposalSource, WireResult } from "@fresnel/contracts/wire";
import type { SkillViewError } from "../../commands.ts";

// 제안 화면(P-06)의 순수 모델. 거르기, 목록 상태, 상세의 편집기·확인·범위, 바로 가기 키 뜻을 다룬다.
// 값은 `toEqual`로 비교한다. 서버 호출과 문장 만들기는 `proposals-screen.tsx`가 한다.

export type StatusFilter = "pending" | "applied" | "all";
export type SourceFilter = "all" | ProposalSource;
export type KindFilter = "all" | ProposalRowVM["kind"];

export interface ProposalFilter {
  readonly status: StatusFilter;
  readonly source: SourceFilter;
  readonly kind: KindFilter;
}

/** 처음 여는 거르기: 대기 중인 제안, 두 출처, 모든 종류 */
export const INITIAL_FILTER: ProposalFilter = { status: "pending", source: "all", kind: "all" };

/**
 * `proposal.list` params. 상태가 "모두"면 상태 거름을 걸지 않는다. 출처가 "모두"면 출처를 보내지 않는다.
 * 종류 거름은 wire에 없어 화면이 읽은 행에서 거른다(`visibleRowsOf`). 쪽 크기는 호스트 기본값을 쓴다.
 */
export function listParamsOf(filter: ProposalFilter, cursor: string | null): ProposalListParams {
  const status: ProposalListParams["status"] =
    filter.status === "all" ? undefined : [filter.status === "pending" ? "pending" : "applied"];
  return {
    ...(status === undefined ? {} : { status }),
    ...(filter.source === "all" ? {} : { source: filter.source }),
    ...(cursor === null ? {} : { cursor }),
  };
}

/** 한 쪽의 읽은 결과. 더 보기는 쪽을 이어 붙인다 */
export interface ProposalPage {
  readonly rows: readonly ProposalRowVM[];
  readonly unavailableTexts: readonly string[];
  readonly nextCursor: string | null;
}

export type ListState =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | ({ readonly status: "ready"; readonly loadingMore: boolean } & ProposalPage);

/** 상세의 입력 칸. 수정은 본문, 거절은 메모다 */
export type Editor =
  | { readonly mode: "none" }
  | { readonly mode: "edit"; readonly key: string; readonly text: string }
  | { readonly mode: "reject"; readonly key: string; readonly text: string };

/** 확인 대화 상자가 묻는 동작. 되돌리기는 늘, 승인은 지우거나 덮어쓰는 제안만 묻는다 */
type Confirm = { readonly key: string; readonly action: "approve" | "revert" } | null;

interface Notice {
  readonly tone: "success" | "danger";
  /** 이미 문장으로 바꾼 글(화면 언어). 상태에는 id가 아니라 글이 든다 */
  readonly text: string;
}

/** 충돌 스킬 본문을 읽는 요청. `threadId`는 프로젝트 스킬을 찾을 작업 폴더를 정하는 근거 대화다(없으면 null) */
export interface SkillRequest {
  readonly name: string;
  readonly threadId: string | null;
}

/** 본문을 읽지 못한 이유. `offline`은 연결이 없다, `failed`는 그 밖의 읽기 실패다 */
export type SkillPeekFailure = "notFound" | "unsupported" | "offline" | "failed";

/** 충돌 스킬 대화 상자. `closed`가 아니면 `request`의 스킬을 본다. 연 뒤에만 읽는다 */
export type SkillPeek =
  | { readonly status: "closed" }
  | ({ readonly status: "loading" } & SkillRequest)
  | ({
      readonly status: "ready";
      readonly skill: WireResult<"knowledge.skills.view">;
    } & SkillRequest)
  | ({ readonly status: SkillPeekFailure } & SkillRequest);

export interface ProposalsState {
  readonly filter: ProposalFilter;
  readonly list: ListState;
  /** 마지막으로 목록을 읽은 시각(ms). 행의 상대 시각은 이 시각 기준이다 */
  readonly readAt: number;
  readonly selectedKey: string | null;
  /** 고른 적용 범위. null이면 행의 기본(`scopeChoice.initial`)을 쓴다 */
  readonly scope: ProposalScope | null;
  readonly editor: Editor;
  readonly confirm: Confirm;
  readonly busy: boolean;
  readonly notice: Notice | null;
  readonly skill: SkillPeek;
}

export const INITIAL_PROPOSALS_STATE: ProposalsState = {
  filter: INITIAL_FILTER,
  list: { status: "loading" },
  readAt: 0,
  selectedKey: null,
  scope: null,
  editor: { mode: "none" },
  confirm: null,
  busy: false,
  notice: null,
  skill: { status: "closed" },
};

export type ProposalsAction =
  | { readonly type: "filterChanged"; readonly filter: ProposalFilter }
  /** 목록을 읽기 시작한다. `append`가 참이면 더 보기다 */
  | { readonly type: "listStarted"; readonly append: boolean }
  | {
      readonly type: "listLoaded";
      readonly page: ProposalPage;
      readonly append: boolean;
      readonly readAt: number;
    }
  | { readonly type: "listFailed" }
  | { readonly type: "select"; readonly key: string | null }
  | { readonly type: "scopeChosen"; readonly scope: ProposalScope }
  | { readonly type: "editorOpened"; readonly mode: "edit" | "reject"; readonly key: string }
  | { readonly type: "editorChanged"; readonly text: string }
  | { readonly type: "editorClosed" }
  | { readonly type: "confirmOpened"; readonly key: string; readonly action: "approve" | "revert" }
  | { readonly type: "confirmClosed" }
  | { readonly type: "busyChanged"; readonly busy: boolean }
  | { readonly type: "noticeSet"; readonly notice: Notice | null }
  /** 충돌 스킬 대화 상자를 열거나 다시 읽는다. 읽기는 이 동작 뒤에 화면이 부른다 */
  | { readonly type: "skillOpened"; readonly request: SkillRequest }
  | {
      readonly type: "skillLoaded";
      readonly request: SkillRequest;
      readonly skill: WireResult<"knowledge.skills.view">;
    }
  | {
      readonly type: "skillFailed";
      readonly request: SkillRequest;
      readonly failure: SkillPeekFailure;
    }
  | { readonly type: "skillClosed" };

/** 읽기 응답이 지금 대화 상자가 기다리는 요청의 것인가. 닫았거나 다른 스킬을 연 뒤의 늦은 응답은 버린다 */
function isPendingFor(peek: SkillPeek, request: SkillRequest): boolean {
  return (
    peek.status === "loading" && peek.name === request.name && peek.threadId === request.threadId
  );
}

export function proposalsReducer(state: ProposalsState, action: ProposalsAction): ProposalsState {
  switch (action.type) {
    case "filterChanged":
      // 거르기가 바뀌면 목록과 선택, 열린 입력 칸을 모두 비운다
      return {
        ...state,
        filter: action.filter,
        list: { status: "loading" },
        selectedKey: null,
        scope: null,
        editor: { mode: "none" },
        confirm: null,
        notice: null,
      };
    case "listStarted":
      if (action.append) {
        return state.list.status === "ready"
          ? { ...state, list: { ...state.list, loadingMore: true } }
          : state;
      }
      return { ...state, list: { status: "loading" } };
    case "listLoaded": {
      const rows =
        action.append && state.list.status === "ready"
          ? [...state.list.rows, ...action.page.rows]
          : action.page.rows;
      // 다시 읽었을 때 고른 행이 사라졌으면 선택도 푼다(결정으로 대기 목록에서 빠진 경우)
      const kept = rows.some((row) => row.key === state.selectedKey);
      return {
        ...state,
        readAt: action.readAt,
        list: {
          status: "ready",
          loadingMore: false,
          rows,
          unavailableTexts: action.page.unavailableTexts,
          nextCursor: action.page.nextCursor,
        },
        selectedKey: action.append || kept ? state.selectedKey : null,
      };
    }
    case "listFailed":
      return { ...state, list: { status: "failed" } };
    case "select":
      return {
        ...state,
        selectedKey: action.key,
        scope: null,
        editor: { mode: "none" },
        confirm: null,
      };
    case "scopeChosen":
      return { ...state, scope: action.scope };
    case "editorOpened":
      return {
        ...state,
        editor: { mode: action.mode, key: action.key, text: "" },
        confirm: null,
      };
    case "editorChanged":
      return state.editor.mode === "none"
        ? state
        : { ...state, editor: { ...state.editor, text: action.text } };
    case "editorClosed":
      return { ...state, editor: { mode: "none" } };
    case "confirmOpened":
      return {
        ...state,
        confirm: { key: action.key, action: action.action },
        editor: { mode: "none" },
      };
    case "confirmClosed":
      return { ...state, confirm: null };
    case "busyChanged":
      return { ...state, busy: action.busy };
    case "noticeSet":
      return { ...state, notice: action.notice };
    case "skillOpened":
      return { ...state, skill: { status: "loading", ...action.request } };
    case "skillLoaded":
      return isPendingFor(state.skill, action.request)
        ? { ...state, skill: { status: "ready", skill: action.skill, ...action.request } }
        : state;
    case "skillFailed":
      return isPendingFor(state.skill, action.request)
        ? { ...state, skill: { status: action.failure, ...action.request } }
        : state;
    case "skillClosed":
      return { ...state, skill: { status: "closed" } };
    default:
      return assertNever(action, "ProposalsAction");
  }
}

/** 대화 상자나 편집기가 열려 있는가. 열려 있으면 목록의 바로 가기 키는 쉰다(포털 대화 상자의 키 입력도 화면까지 올라온다) */
export function overlayOpenOf(state: ProposalsState): boolean {
  return state.confirm !== null || state.editor.mode !== "none" || state.skill.status !== "closed";
}

/** 종류 거름을 적용한 행. "모두"면 그대로다 */
export function visibleRowsOf(
  rows: readonly ProposalRowVM[],
  kind: KindFilter,
): readonly ProposalRowVM[] {
  return kind === "all" ? rows : rows.filter((row) => row.kind === kind);
}

/** 고른 행. 목록에 없으면 null */
export function selectedRowOf(
  rows: readonly ProposalRowVM[],
  selectedKey: string | null,
): ProposalRowVM | null {
  return rows.find((row) => row.key === selectedKey) ?? null;
}

/** 지금 적용할 범위: 고른 값이 있으면 그것, 없으면 행의 기본. 범위를 고를 수 없는 행은 null */
export function effectiveScopeOf(
  row: ProposalRowVM,
  chosen: ProposalScope | null,
): ProposalScope | null {
  if (row.scopeChoice === null) return null;
  return chosen ?? row.scopeChoice.initial;
}

/**
 * 확인 대화 상자를 먼저 묻는 동작. 되돌리기는 늘 묻고, 승인은 지우거나 덮어쓰는 제안만 묻는다. 묻지 않으면 null이다
 */
export function confirmActionOf(
  row: ProposalRowVM,
  action: ProposalAction,
): "approve" | "revert" | null {
  if (action === "revert") return "revert";
  if (action === "approve" && row.destructive) return "approve";
  return null;
}

/** 본문 읽기 오류를 대화 상자의 상태로 바꾼다. 연결이 없으면 offline, 이름이 없으면 notFound, 기능이 꺼져 있으면 unsupported다 */
export function skillFailureOf(error: SkillViewError): SkillPeekFailure {
  switch (error.kind) {
    case "not_found":
      return "notFound";
    case "unsupported":
      return "unsupported";
    case "offline":
      return "offline";
    case "locked":
    case "rejected":
    case "switching":
    case "failed":
      return "failed";
    default:
      return assertNever(error, "SkillViewError");
  }
}

/** 변경 보기가 한 번에 보이는 줄 수. 넘으면 나머지는 접어 둔다(spec §6.10 긴 내용) */
export const DIFF_FOLD_LINES = 500;

export interface DiffLine {
  /** 1부터 세는 줄 번호. 그릴 때 키로도 쓴다 */
  readonly number: number;
  readonly kind: "context" | "add" | "remove";
  readonly text: string;
}

/** 변경 글을 줄로 나눈다. `+`는 추가, `-`는 삭제, 그 밖은 문맥이다. 글자 앞의 부호 한 칸은 떼어 낸다 */
export function diffLinesOf(diff: string): readonly DiffLine[] {
  if (diff === "") return [];
  return diff.split("\n").map((line, index): DiffLine => {
    const number = index + 1;
    if (line.startsWith("+")) return { number, kind: "add", text: line.slice(1).replace(/^ /, "") };
    if (line.startsWith("-")) {
      return { number, kind: "remove", text: line.slice(1).replace(/^ /, "") };
    }
    return { number, kind: "context", text: line.replace(/^ /, "") };
  });
}

/** ↑↓로 옮긴 뒤의 선택 키. 목록이 비었으면 null, 끝에서는 그 자리에 머문다 */
export function moveSelectionOf(
  rows: readonly ProposalRowVM[],
  selectedKey: string | null,
  delta: 1 | -1,
): string | null {
  if (rows.length === 0) return null;
  const current = rows.findIndex((row) => row.key === selectedKey);
  if (current === -1) return rows[0]?.key ?? null;
  const next = Math.min(rows.length - 1, Math.max(0, current + delta));
  return rows[next]?.key ?? null;
}

/** 바로 가기 키(spec §6.10): ↑↓ 행, a 승인, e 수정, x 거절, u 되돌리기. 입력 칸 안에서는 받지 않는다 */
export type ProposalKeyIntent =
  | { readonly type: "move"; readonly delta: 1 | -1 }
  | { readonly type: "act"; readonly action: ProposalAction };

export interface ProposalKeyEvent {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly editable: boolean;
}

const KEY_INTENTS: Readonly<Record<string, ProposalKeyIntent>> = {
  ArrowDown: { type: "move", delta: 1 },
  ArrowUp: { type: "move", delta: -1 },
  a: { type: "act", action: "approve" },
  e: { type: "act", action: "edit" },
  x: { type: "act", action: "reject" },
  u: { type: "act", action: "revert" },
};

export function proposalKeyIntentOf(event: ProposalKeyEvent): ProposalKeyIntent | null {
  if (event.editable || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return null;
  }
  if (!Object.hasOwn(KEY_INTENTS, event.key)) return null;
  return KEY_INTENTS[event.key] ?? null;
}
