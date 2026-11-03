import { assertNever } from "@fresnel/contracts";
import type { ScheduleListItem } from "@fresnel/contracts/capabilities";
import { scheduleListView, type ScheduleRow } from "@fresnel/client";
import type { CommandError } from "../../commands.ts";
import {
  draftOfEntry,
  emptyDraft,
  NO_ERRORS,
  type ScheduleDraft,
  type SheetErrors,
} from "./schedule-draft.ts";
import type { MessageRef } from "./schedule-text.ts";

// 예약 화면(P-07)의 상태 기계. 순수 함수만 둔다: 명령을 부르는 일은 화면이 맡고, 결과를 이 모델의 동작으로 옮긴다.
// 목록은 요청 결과라 거울에 넣지 않는다(FS-03). 시각이 필요한 동작은 `now`를 받아 시험에서 값을 고정한다.

type ListState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready" }
  /** 목록을 읽지 못했다. 표 위에 알림을 띄우고 행은 남긴다 */
  | { readonly kind: "failed"; readonly reason: "failed" | "unsupported" }
  /** 연결이 없다. 행은 마지막 목록을 그대로 두고 동작은 모두 잠근다 */
  | { readonly kind: "offline" };

export interface Notice {
  readonly tone: "danger" | "success";
  readonly text: MessageRef;
}

export interface SheetState {
  readonly mode: "new" | "copy";
  readonly draft: ScheduleDraft;
  readonly errors: SheetErrors;
  readonly sending: boolean;
}

export interface ScheduleState {
  readonly list: ListState;
  /** host가 준 목록 항목 그대로다. 행(`ScheduleRow`)은 `rowsOf`가 만든다 */
  readonly items: readonly ScheduleListItem[];
  readonly serviceModeOff: boolean;
  readonly selectedId: string | null;
  /** 프롬프트를 펼친 항목 id */
  readonly expanded: readonly string[];
  readonly sheet: SheetState | null;
  /** 취소 확인 대화 상자가 가리키는 예약 id */
  readonly cancelId: string | null;
  /** 명령이 가는 중이다. 같은 동작을 두 번 보내지 않도록 버튼을 잠근다 */
  readonly busy: boolean;
  readonly notice: Notice | null;
}

export const INITIAL_SCHEDULE_STATE: ScheduleState = {
  list: { kind: "loading" },
  items: [],
  serviceModeOff: false,
  selectedId: null,
  expanded: [],
  sheet: null,
  cancelId: null,
  busy: false,
  notice: null,
};

export type ScheduleAction =
  | { readonly type: "listStarted" }
  | {
      readonly type: "listLoaded";
      readonly items: readonly ScheduleListItem[];
      readonly serviceModeOff: boolean;
    }
  | { readonly type: "listFailed"; readonly reason: ListFailure }
  | { readonly type: "select"; readonly id: string }
  | { readonly type: "move"; readonly delta: 1 | -1 }
  | { readonly type: "toggleExpanded"; readonly id: string }
  | { readonly type: "openNew"; readonly nowMs: number }
  | { readonly type: "openCopy"; readonly id: string; readonly nowMs: number }
  | { readonly type: "sheetChanged"; readonly draft: ScheduleDraft }
  | { readonly type: "sheetSending"; readonly sending: boolean }
  | { readonly type: "sheetFailed"; readonly errors: SheetErrors }
  | { readonly type: "sheetClosed" }
  | { readonly type: "askCancel"; readonly id: string }
  | { readonly type: "dismissCancel" }
  | { readonly type: "busy"; readonly busy: boolean }
  | { readonly type: "notice"; readonly notice: Notice | null };

export type ListFailure = "offline" | "failed" | "unsupported";

/** 명령 오류를 목록 상태의 원인으로 바꾼다. 연결 없음만 offline이다 */
export function listFailureOf(error: CommandError): ListFailure {
  switch (error.kind) {
    case "offline":
      return "offline";
    case "unsupported":
      return "unsupported";
    case "failed":
    case "locked":
    case "rejected":
      return "failed";
    default:
      return assertNever(error, "CommandError");
  }
}

function listStateOf(reason: ListFailure): ListState {
  switch (reason) {
    case "offline":
      return { kind: "offline" };
    case "unsupported":
      return { kind: "failed", reason: "unsupported" };
    case "failed":
      return { kind: "failed", reason: "failed" };
    default:
      return assertNever(reason, "ListFailure");
  }
}

/** 목록이 바뀌어도 선택은 남는 항목을 따른다. 없으면 첫 행이다 */
function keepSelection(current: string | null, rows: readonly ScheduleRow[]): string | null {
  if (rows.some((row) => row.id === current)) return current;
  return rows[0]?.id ?? null;
}

/** 화면에 보이는 행(정렬 적용). 키보드 이동 순서도 이것이다 */
export function rowsOf(state: ScheduleState): readonly ScheduleRow[] {
  return scheduleListView(state.items);
}

export function isOffline(state: ScheduleState): boolean {
  return state.list.kind === "offline";
}

/** 동작 버튼을 눌러도 되는가: 연결이 있고 다른 명령이 가고 있지 않다 */
export function canAct(state: ScheduleState): boolean {
  return !isOffline(state) && !state.busy;
}

function moved(state: ScheduleState, delta: 1 | -1): ScheduleState {
  const rows = rowsOf(state);
  if (rows.length === 0) return state;
  const index = rows.findIndex((row) => row.id === state.selectedId);
  const next =
    index < 0
      ? delta > 0
        ? 0
        : rows.length - 1
      : Math.min(rows.length - 1, Math.max(0, index + delta));
  const row = rows[next];
  return row === undefined ? state : { ...state, selectedId: row.id };
}

export function scheduleReducer(state: ScheduleState, action: ScheduleAction): ScheduleState {
  switch (action.type) {
    case "listStarted":
      return { ...state, list: { kind: "loading" } };
    case "listLoaded": {
      const rows = scheduleListView(action.items);
      return {
        ...state,
        list: { kind: "ready" },
        items: action.items,
        serviceModeOff: action.serviceModeOff,
        selectedId: keepSelection(state.selectedId, rows),
      };
    }
    case "listFailed":
      return { ...state, list: listStateOf(action.reason) };
    case "select":
      return { ...state, selectedId: action.id };
    case "move":
      return moved(state, action.delta);
    case "toggleExpanded":
      return {
        ...state,
        expanded: state.expanded.includes(action.id)
          ? state.expanded.filter((id) => id !== action.id)
          : [...state.expanded, action.id],
      };
    case "openNew":
      return {
        ...state,
        sheet: { mode: "new", draft: emptyDraft(action.nowMs), errors: NO_ERRORS, sending: false },
      };
    case "openCopy": {
      const item = state.items.find((candidate) => candidate.entry.id === action.id);
      if (item === undefined) return state;
      return {
        ...state,
        sheet: {
          mode: "copy",
          draft: draftOfEntry(item.entry, action.nowMs),
          errors: NO_ERRORS,
          sending: false,
        },
      };
    }
    case "sheetChanged":
      return state.sheet === null
        ? state
        : { ...state, sheet: { ...state.sheet, draft: action.draft, errors: NO_ERRORS } };
    case "sheetSending":
      return state.sheet === null
        ? state
        : { ...state, sheet: { ...state.sheet, sending: action.sending } };
    case "sheetFailed":
      return state.sheet === null
        ? state
        : { ...state, sheet: { ...state.sheet, sending: false, errors: action.errors } };
    case "sheetClosed":
      return { ...state, sheet: null };
    case "askCancel":
      return { ...state, cancelId: action.id };
    case "dismissCancel":
      return { ...state, cancelId: null };
    case "busy":
      return { ...state, busy: action.busy };
    case "notice":
      return { ...state, notice: action.notice };
    default:
      return assertNever(action, "ScheduleAction");
  }
}

// ── 키보드 ─────────────────────────────────────────────────────────────

/** 키 입력의 필요한 사실만 모은 값. DOM 이벤트를 모델이 직접 보지 않게 한다 */
export interface KeyFacts {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  /** 입력 칸(input, textarea, select, 편집 가능)에 초점이 있다 */
  readonly editable: boolean;
  /** 초점이 표의 행에 있다 */
  readonly onRow: boolean;
}

export type KeyIntent =
  | { readonly type: "new" }
  | { readonly type: "move"; readonly delta: 1 | -1 }
  | { readonly type: "openThread" }
  | { readonly type: "cancel" };

/**
 * 화면 키 입력의 뜻. 입력 칸에 초점이 있으면 아무것도 하지 않는다(⌘N 포함).
 * ↑↓와 Enter는 행에 초점이 있을 때만 뜻이 있다(버튼의 Enter는 버튼이 한다). ⌫는 취소 확인을 연다.
 */
export function keyIntentOf(facts: KeyFacts): KeyIntent | null {
  if (facts.editable) return null;
  const mod = facts.metaKey || facts.ctrlKey;
  if (mod && !facts.altKey && !facts.shiftKey && facts.key.toLowerCase() === "n") {
    return { type: "new" };
  }
  if (mod || facts.altKey || facts.shiftKey) return null;
  if (facts.key === "ArrowDown") return facts.onRow ? { type: "move", delta: 1 } : null;
  if (facts.key === "ArrowUp") return facts.onRow ? { type: "move", delta: -1 } : null;
  if (facts.key === "Enter") return facts.onRow ? { type: "openThread" } : null;
  if (facts.key === "Backspace") return { type: "cancel" };
  return null;
}

/** 선택된 행의 예약 항목(없으면 null) */
export function selectedItemOf(state: ScheduleState): ScheduleListItem | null {
  return state.items.find((item) => item.entry.id === state.selectedId) ?? null;
}

export function noticeOf(text: MessageRef, tone: Notice["tone"]): Notice {
  return { tone, text };
}
