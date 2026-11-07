import { assertNever } from "@fresnel/contracts";
import type { RunView, ScheduleListItem } from "@fresnel/contracts/capabilities";
import { scheduleListView, type ScheduleRow } from "@fresnel/client";
import type { ThreadSummary, WireParams, WireResult } from "@fresnel/contracts/wire";
import type { CommandError } from "../../commands.ts";
import {
  draftOfEntry,
  editDraftOfEntry,
  emptyDraft,
  NO_ERRORS,
  type ScheduleDraft,
  type SheetErrors,
} from "./schedule-draft.ts";
import { message, runReasonTextOf, type MessageRef, type RowAction } from "./schedule-text.ts";

// 예약 화면(P-07)의 상태 기계. 순수 함수만 둔다: 명령을 부르는 일은 화면이 맡고, 결과를 이 모델의 동작으로 옮긴다.
// 목록은 요청 결과라 거울에 넣지 않는다(FS-03). 시각이 필요한 동작은 `now`를 받아 시험에서 값을 고정한다.

type ListState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready" }
  /** 목록을 읽지 못했다. 표 위에 알림을 띄우고 행은 남긴다 */
  | { readonly kind: "failed"; readonly reason: "failed" | "unsupported" }
  /** 연결이 없다. 행은 마지막 목록을 그대로 두고 동작은 모두 잠근다 */
  | { readonly kind: "offline" };

/** 알림에 붙는 동작. `restartEngine`은 "지금 다시 시작" 단추다 */
export type NoticeAction = "restartEngine" | null;

export interface Notice {
  readonly tone: "danger" | "success" | "warning";
  readonly text: MessageRef;
  readonly action: NoticeAction;
}

/** 실행 기록 한 줄 */
export type RunRecord = WireResult<"schedule.runs">["runs"][number];

/** 실행 기록 시트의 읽기 상태. `scheduleId`는 늦게 온 응답을 거르는 열쇠다 */
export type RunsState =
  | { readonly kind: "loading"; readonly scheduleId: string }
  | { readonly kind: "ready"; readonly scheduleId: string; readonly runs: readonly RunRecord[] }
  | { readonly kind: "failed"; readonly scheduleId: string; readonly reason: ListFailure };

export interface SheetState {
  readonly mode: "new" | "copy" | "edit";
  /** 고치기일 때 고치는 예약 id */
  readonly scheduleId: string | null;
  readonly draft: ScheduleDraft;
  readonly errors: SheetErrors;
  readonly sending: boolean;
}

/**
 * 목록 거르기. `enabled`는 켜진 항목만(`schedule.list { enabled: true }`), `all`은 끈 항목까지(`schedule.list {}`)다.
 * 거르기는 wire 인자라 바꾸면 목록을 다시 읽는다.
 */
export type ScheduleFilter = "enabled" | "all";

export interface ScheduleState {
  readonly list: ListState;
  /** host가 준 목록 항목 그대로다. 행(`ScheduleRow`)은 `rowsOf`가 만든다 */
  readonly items: readonly ScheduleListItem[];
  readonly serviceModeOff: boolean;
  /** 서비스 모드를 켰지만 엔진을 다시 시작하지 않아 아직 꺼진 것과 같다. 띠가 "다시 시작해야 켜져요"를 보인다 */
  readonly serviceRestartPending: boolean;
  readonly filter: ScheduleFilter;
  /** 목록을 마지막으로 읽은 시각(epoch ms). 상대 시각은 이 값 기준이다(화면을 다시 그리지 않는다) */
  readonly nowMs: number;
  readonly selectedId: string | null;
  /** 프롬프트를 펼친 항목 id */
  readonly expanded: readonly string[];
  readonly sheet: SheetState | null;
  /** 실행 기록 시트. 닫혀 있으면 null */
  readonly runs: RunsState | null;
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
  serviceRestartPending: false,
  filter: "enabled",
  nowMs: 0,
  selectedId: null,
  expanded: [],
  sheet: null,
  runs: null,
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
      readonly serviceRestartPending: boolean;
      readonly nowMs: number;
    }
  | { readonly type: "serviceEnabled"; readonly restartPending: boolean }
  | { readonly type: "listFailed"; readonly reason: ListFailure }
  | { readonly type: "filterChanged"; readonly filter: ScheduleFilter }
  | { readonly type: "select"; readonly id: string }
  | { readonly type: "move"; readonly delta: 1 | -1 }
  | { readonly type: "toggleExpanded"; readonly id: string }
  | { readonly type: "openNew"; readonly nowMs: number }
  | { readonly type: "openCopy"; readonly id: string; readonly nowMs: number }
  | { readonly type: "openEdit"; readonly id: string; readonly nowMs: number }
  | { readonly type: "runsStarted"; readonly scheduleId: string }
  | {
      readonly type: "runsLoaded";
      readonly scheduleId: string;
      readonly runs: readonly RunRecord[];
    }
  | { readonly type: "runsFailed"; readonly scheduleId: string; readonly reason: ListFailure }
  | { readonly type: "runsClosed" }
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
    case "switching":
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

/** 거르기 값을 `schedule.list` 인자로 바꾼다. 모두는 빈 인자다(인자를 생략하면 가장 새 200개다) */
export function listParamsOf(filter: ScheduleFilter): WireParams<"schedule.list"> {
  return filter === "enabled" ? { enabled: true } : {};
}

/**
 * 예약이 만든 대화의 `대화 id:상태` 목록을 한 줄로 모은다. 예약 실행이 시작하거나 끝나면(상태가 바뀌면) 값이 바뀌어,
 * 화면이 목록을 다시 읽을 때를 안다. 예약이 아닌 대화는 뺀다. 대화 id로 정렬하므로 목록 순서가 바뀌어도 값은 같다.
 */
export function scheduleRunSignatureOf(threads: readonly ThreadSummary[]): string {
  return threads
    .flatMap((thread) =>
      thread.origin?.kind === "schedule" ? [`${thread.threadId}:${thread.status}`] : [],
    )
    .toSorted()
    .join("|");
}

export interface RowMenuItem {
  readonly action: RowAction;
  readonly disabled: boolean;
}

/**
 * 행 메뉴의 항목과 잠금. 마지막 실행 대화 열기는 대화가 있을 때만 나오고 목록에 없으면 잠근다. 지금 실행은 원격 트리거
 * 행만, 취소는 켜진 행만 나온다. 복제는 늘 나온다. `acting`이 거짓이면(연결 없음, 다른 명령 중) 모든 항목을 잠근다.
 */
export function rowMenuOf(
  row: ScheduleRow,
  acting: boolean,
  openable: boolean,
): readonly RowMenuItem[] {
  const items: RowMenuItem[] = [];
  const threadId = row.lastRun?.threadId ?? null;
  if (threadId !== null) items.push({ action: "openThread", disabled: !acting || !openable });
  if (!row.enabled) items.push({ action: "reenable", disabled: !acting });
  if (row.triggerKind === "remote") items.push({ action: "fire", disabled: !acting });
  items.push({ action: "runs", disabled: !acting });
  items.push({ action: "edit", disabled: !acting });
  if (row.enabled) items.push({ action: "cancel", disabled: !acting });
  items.push({ action: "copy", disabled: !acting });
  return items;
}

export function scheduleReducer(state: ScheduleState, action: ScheduleAction): ScheduleState {
  switch (action.type) {
    case "listStarted":
      return { ...state, list: { kind: "loading" } };
    case "listLoaded": {
      const rows = scheduleListView(action.items);
      // 다시 시작 알림은 재시작으로 대기가 풀리면 지운다. 남기면 이미 켜진 서비스를 아직 다시 시작하라고 말하게 된다
      const stale = !action.serviceRestartPending && state.notice?.action === "restartEngine";
      return {
        ...state,
        list: { kind: "ready" },
        items: action.items,
        serviceModeOff: action.serviceModeOff,
        serviceRestartPending: action.serviceRestartPending,
        notice: stale ? null : state.notice,
        nowMs: action.nowMs,
        selectedId: keepSelection(state.selectedId, rows),
      };
    }
    case "serviceEnabled":
      // 서비스 모드를 켰으면 꺼짐 띠는 물러난다. 다시 시작이 필요하면 대기 띠가 대신한다
      return { ...state, serviceModeOff: false, serviceRestartPending: action.restartPending };
    case "listFailed":
      return { ...state, list: listStateOf(action.reason) };
    case "filterChanged":
      // 거르기를 바꾸면 선택과 열린 프롬프트, 취소 확인을 비운다(목록은 화면이 다시 읽는다)
      return {
        ...state,
        filter: action.filter,
        selectedId: null,
        expanded: [],
        cancelId: null,
      };
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
        sheet: {
          mode: "new",
          scheduleId: null,
          draft: emptyDraft(action.nowMs),
          errors: NO_ERRORS,
          sending: false,
        },
      };
    case "openCopy": {
      const item = state.items.find((candidate) => candidate.entry.id === action.id);
      if (item === undefined) return state;
      return {
        ...state,
        sheet: {
          mode: "copy",
          scheduleId: null,
          draft: draftOfEntry(item.entry, action.nowMs),
          errors: NO_ERRORS,
          sending: false,
        },
      };
    }
    case "openEdit": {
      const item = state.items.find((candidate) => candidate.entry.id === action.id);
      if (item === undefined) return state;
      return {
        ...state,
        sheet: {
          mode: "edit",
          scheduleId: item.entry.id,
          draft: editDraftOfEntry(item.entry, action.nowMs),
          errors: NO_ERRORS,
          sending: false,
        },
      };
    }
    case "runsStarted":
      return { ...state, runs: { kind: "loading", scheduleId: action.scheduleId } };
    case "runsLoaded":
      return state.runs?.scheduleId === action.scheduleId
        ? { ...state, runs: { kind: "ready", scheduleId: action.scheduleId, runs: action.runs } }
        : state;
    case "runsFailed":
      return state.runs?.scheduleId === action.scheduleId
        ? {
            ...state,
            runs: { kind: "failed", scheduleId: action.scheduleId, reason: action.reason },
          }
        : state;
    case "runsClosed":
      return { ...state, runs: null };
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

/** 놓친 실행 줄의 값. 수는 앱이 꺼진 동안 놓친 기한의 수다 */
export interface MissedRunsView {
  readonly count: number;
}

/** 목록 항목의 놓친 실행 줄. 놓친 실행이 없으면(0) 줄을 그리지 않으므로 null이다 */
export function missedRunsViewOf(item: ScheduleListItem): MissedRunsView | null {
  return item.missedRuns >= 1 ? { count: item.missedRuns } : null;
}

/** 허용 밖 감시 경로 줄의 값. 경로가 하나 이상 있을 때만 준다 */
export interface WatchOutsideView {
  readonly paths: readonly string[];
}

/** 목록 항목의 허용 밖 감시 경로. 경로가 없으면(생략이거나 빈 목록) 줄을 그리지 않으므로 null이다 */
export function watchOutsideViewOf(item: ScheduleListItem): WatchOutsideView | null {
  const paths = item.outsideWatchPaths;
  return paths === undefined || paths.length === 0 ? null : { paths };
}

export function noticeOf(
  text: MessageRef,
  tone: Notice["tone"],
  action: NoticeAction = null,
): Notice {
  return { tone, text, action };
}

/**
 * 지금 실행(`schedule.fire`)의 결과를 알림으로 옮긴다. 호스트가 준 실행 기록의 상태로 정한다: 시작했으면 성공이고,
 * 건너뛰었으면 경고(예: 직전 실행 뒤 5분이 안 지남), 시작하지 못했으면 오류다. 사유는 실행 기록과 같은 문장을 쓴다.
 */
export function fireNoticeOf(run: RunView): Notice {
  switch (run.status) {
    case "claimed":
    case "started":
    case "finished":
      return noticeOf(message("desktop.schedules.fired"), "success");
    case "skipped":
      return noticeOf(runReasonTextOf(run.reason), "warning");
    case "failed":
      return noticeOf(runReasonTextOf(run.reason), "danger");
    default:
      return assertNever(run.status, "RunView.status");
  }
}
