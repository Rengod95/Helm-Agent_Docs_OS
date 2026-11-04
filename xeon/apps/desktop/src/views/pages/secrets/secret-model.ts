import { assertNever, type Result } from "@fresnel/contracts";
import type { SecretName } from "@fresnel/contracts/capabilities";
import type {
  SecretAuditResult,
  SecretListEntry,
  SecretReferencesResult,
  SecretTestResult,
} from "@fresnel/contracts/wire";
import type { SecretCommandError } from "../../commands.ts";
import { HIDDEN_REVEAL, type RevealView } from "./secret-reveal.ts";
import type { MetaDraft } from "./secret-draft.ts";

// 시크릿 화면(P-10)의 상태 기계. 순수 함수만 둔다: 명령은 화면이 부르고, 결과를 이 모델의 동작으로 옮긴다.
// 목록과 참조와 시험은 요청 결과라 거울에 넣지 않는다(FS-03). 값은 이 상태 어디에도 없다: 값 보기는 `RevealView`(이름, 종류, 남은 초)만 든다.

/** 50개를 넘으면 검색과 정렬을 보인다 */
export const SEARCH_THRESHOLD = 50;
/** 값 보기 상태의 남은 초를 이 간격으로 다시 쓴다 */
export const COUNTDOWN_REFRESH_MS = 10_000;

export type SecretSort = "name" | "lastUsed" | "expiry" | "status";
export const SORT_KEYS: readonly SecretSort[] = ["name", "lastUsed", "expiry", "status"];

/** 요청 결과 하나의 상태. `idle`은 아직 부르지 않았다 */
export type Load<T> =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly value: T }
  | { readonly kind: "failed"; readonly error: SecretCommandError };

type ListState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready" }
  | { readonly kind: "failed"; readonly error: SecretCommandError };

/** 고른 시크릿의 상세. 이름이 바뀌면 새로 만든다(늦은 응답이 새 이름을 덮지 않도록 이름을 같이 든다) */
export interface DetailState {
  readonly name: SecretName;
  readonly refs: Load<SecretReferencesResult>;
  /** 사용 기록(W-13). 고를 때 한 번 읽는다 */
  readonly audit: Load<SecretAuditResult>;
  readonly test: Load<SecretTestResult>;
}

/** 등록 창. 추가는 이름 칸 다음에 값 칸이고, 값 바꾸기는 값 칸만 있다. 값 칸은 화면에 DOM으로만 있다 */
export type EntryState =
  | { readonly kind: "closed" }
  | {
      readonly kind: "name";
      readonly name: string;
      readonly error: string | null;
      readonly busy: boolean;
    }
  | {
      readonly kind: "value";
      readonly name: SecretName;
      readonly action: "add" | "set";
      readonly error: string | null;
      readonly busy: boolean;
    };

export type MetaState =
  | { readonly kind: "closed" }
  | {
      readonly kind: "open";
      readonly name: SecretName;
      readonly draft: MetaDraft;
      readonly error: string | null;
      readonly busy: boolean;
    };

export interface Notice {
  readonly tone: "success" | "danger" | "info";
  readonly text: string;
}

export interface SecretsState {
  readonly list: ListState;
  readonly rows: readonly SecretListEntry[];
  readonly query: string;
  readonly sort: SecretSort;
  readonly detail: DetailState | null;
  readonly entry: EntryState;
  readonly meta: MetaState;
  /** 삭제 확인 대화 상자가 열려 있다(고른 시크릿에 대해) */
  readonly confirmRemove: boolean;
  /** 명령이 가고 있다. 같은 동작을 두 번 보내지 않도록 동작 버튼을 잠근다 */
  readonly busy: boolean;
  readonly notice: Notice | null;
  /** 값 보기 상태. 값은 없다 */
  readonly reveal: RevealView;
  /** 이 기기에서 재인증을 띄울 수 있는가(`RevealGate.available`). 거짓이면 값 보기를 잠근다 */
  readonly revealAvailable: boolean;
  /** 지금 시각(epoch ms). 화면이 효과에서 갱신한다(그림 중에 시계를 읽지 않는다). 마지막 사용 문장이 쓴다 */
  readonly nowMs: number;
}

export function initialSecretsState(revealAvailable: boolean): SecretsState {
  return {
    list: { kind: "loading" },
    rows: [],
    query: "",
    sort: "name",
    detail: null,
    entry: { kind: "closed" },
    meta: { kind: "closed" },
    confirmRemove: false,
    busy: false,
    notice: null,
    reveal: HIDDEN_REVEAL,
    revealAvailable,
    nowMs: 0,
  };
}

export type SecretsAction =
  | { readonly type: "now"; readonly nowMs: number }
  | { readonly type: "listStarted" }
  | { readonly type: "listLoaded"; readonly rows: readonly SecretListEntry[] }
  | { readonly type: "listFailed"; readonly error: SecretCommandError }
  | { readonly type: "query"; readonly query: string }
  | { readonly type: "sort"; readonly sort: SecretSort }
  | { readonly type: "select"; readonly name: SecretName | null }
  | { readonly type: "move"; readonly delta: 1 | -1 }
  | {
      readonly type: "refs";
      readonly name: SecretName;
      readonly load: Load<SecretReferencesResult>;
    }
  | { readonly type: "audit"; readonly name: SecretName; readonly load: Load<SecretAuditResult> }
  | { readonly type: "test"; readonly name: SecretName; readonly load: Load<SecretTestResult> }
  | { readonly type: "confirmRemove"; readonly open: boolean }
  | { readonly type: "entryAdd" }
  | { readonly type: "entryChange"; readonly name: SecretName }
  | { readonly type: "entryName"; readonly name: string }
  | { readonly type: "entryPending"; readonly busy: boolean }
  | {
      readonly type: "entryBegun";
      readonly name: SecretName;
      readonly action: "add" | "set";
      readonly started: boolean;
    }
  | { readonly type: "entryFailed"; readonly error: string }
  | { readonly type: "entryClosed" }
  | { readonly type: "metaOpen"; readonly name: SecretName; readonly draft: MetaDraft }
  | { readonly type: "metaDraft"; readonly draft: MetaDraft }
  | { readonly type: "metaBusy"; readonly busy: boolean }
  | { readonly type: "metaFailed"; readonly error: string }
  | { readonly type: "metaClosed" }
  | { readonly type: "busy"; readonly busy: boolean }
  | { readonly type: "notice"; readonly notice: Notice | null }
  | { readonly type: "reveal"; readonly view: RevealView };

// ── 정렬과 검색 ─────────────────────────────────────────────────────────

const STATUS_RANK: Readonly<Record<SecretListEntry["status"], number>> = {
  expired: 0,
  missing: 1,
  expiring: 2,
  orphaned: 3,
  valid: 4,
};

/** 값이 있는 쪽을 앞에 두고 없는 쪽은 끝으로 보낸다 */
function byText(
  a: string | null | undefined,
  b: string | null | undefined,
  descending: boolean,
): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  if (a === b) return 0;
  const ascending = a < b ? -1 : 1;
  return descending ? -ascending : ascending;
}

function compareOf(sort: SecretSort): (a: SecretListEntry, b: SecretListEntry) => number {
  switch (sort) {
    case "name":
      return (a, b) => a.name.localeCompare(b.name);
    case "lastUsed":
      return (a, b) => byText(a.lastUsedAt, b.lastUsedAt, true);
    case "expiry":
      return (a, b) => byText(a.meta?.expiresAt, b.meta?.expiresAt, false);
    case "status":
      return (a, b) =>
        STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name);
    default:
      return assertNever(sort, "SecretSort");
  }
}

function haystackOf(row: SecretListEntry): string {
  return [
    row.name,
    row.meta?.desc ?? "",
    row.meta?.provider ?? "",
    row.meta?.use.hosts.join(" ") ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * 화면에 보이는 행(검색 적용, 정렬 적용). 키보드 이동 순서도 이것이다.
 * 검색은 행이 `SEARCH_THRESHOLD`를 넘을 때만 건다(칸이 그때만 보인다).
 */
function visibleRowsOf(
  rows: readonly SecretListEntry[],
  query: string,
  sort: SecretSort,
): readonly SecretListEntry[] {
  const needle = rows.length > SEARCH_THRESHOLD ? query.trim().toLowerCase() : "";
  const filtered = needle === "" ? rows : rows.filter((row) => haystackOf(row).includes(needle));
  return filtered.toSorted(compareOf(sort));
}

/** 고른 이름이 보이는 행에 있으면 그대로, 없으면 첫 행이다 */
function detailFor(
  current: DetailState | null,
  visible: readonly SecretListEntry[],
): DetailState | null {
  if (current !== null && visible.some((row) => row.name === current.name)) return current;
  const first = visible[0];
  return first === undefined ? null : freshDetail(first.name);
}

function freshDetail(name: SecretName): DetailState {
  return { name, refs: { kind: "idle" }, audit: { kind: "idle" }, test: { kind: "idle" } };
}

// ── 리듀서 ───────────────────────────────────────────────────────────────

export function secretsReducer(state: SecretsState, action: SecretsAction): SecretsState {
  switch (action.type) {
    case "now":
      return { ...state, nowMs: action.nowMs };
    case "listStarted":
      return { ...state, list: { kind: "loading" } };
    case "listLoaded": {
      const visible = visibleRowsOf(action.rows, state.query, state.sort);
      return {
        ...state,
        list: { kind: "ready" },
        rows: action.rows,
        detail: detailFor(state.detail, visible),
      };
    }
    // 연결 없음도 목록 실패의 한 종류다. 행은 마지막 목록을 그대로 둔다
    case "listFailed":
      return { ...state, list: { kind: "failed", error: action.error } };
    case "query": {
      const visible = visibleRowsOf(state.rows, action.query, state.sort);
      return { ...state, query: action.query, detail: detailFor(state.detail, visible) };
    }
    case "sort": {
      const visible = visibleRowsOf(state.rows, state.query, action.sort);
      return { ...state, sort: action.sort, detail: detailFor(state.detail, visible) };
    }
    case "select":
      return {
        ...state,
        detail: action.name === null ? null : freshDetail(action.name),
        confirmRemove: false,
      };
    case "move": {
      const visible = visibleRowsOf(state.rows, state.query, state.sort);
      const index = visible.findIndex((row) => row.name === state.detail?.name);
      const next =
        index < 0
          ? action.delta > 0
            ? 0
            : visible.length - 1
          : Math.min(visible.length - 1, Math.max(0, index + action.delta));
      const row = visible[next];
      if (row === undefined) return state;
      return { ...state, detail: freshDetail(row.name), confirmRemove: false };
    }
    case "refs":
      return state.detail?.name === action.name
        ? { ...state, detail: { ...state.detail, refs: action.load } }
        : state;
    case "audit":
      return state.detail?.name === action.name
        ? { ...state, detail: { ...state.detail, audit: action.load } }
        : state;
    case "test":
      return state.detail?.name === action.name
        ? { ...state, detail: { ...state.detail, test: action.load } }
        : state;
    case "confirmRemove":
      return { ...state, confirmRemove: action.open };
    case "entryAdd":
      return { ...state, entry: { kind: "name", name: "", error: null, busy: false } };
    case "entryChange":
      return {
        ...state,
        entry: { kind: "value", name: action.name, action: "set", error: null, busy: true },
      };
    case "entryName":
      return state.entry.kind === "name"
        ? { ...state, entry: { ...state.entry, name: action.name, error: null } }
        : state;
    case "entryPending":
      return state.entry.kind === "closed"
        ? state
        : { ...state, entry: { ...state.entry, busy: action.busy } };
    case "entryBegun":
      return action.started
        ? { ...state, entry: { kind: "closed" } }
        : {
            ...state,
            entry: {
              kind: "value",
              name: action.name,
              action: action.action,
              error: null,
              busy: false,
            },
          };
    case "entryFailed":
      return state.entry.kind === "closed"
        ? state
        : { ...state, entry: { ...state.entry, busy: false, error: action.error } };
    case "entryClosed":
      return { ...state, entry: { kind: "closed" } };
    case "metaOpen":
      return {
        ...state,
        meta: { kind: "open", name: action.name, draft: action.draft, error: null, busy: false },
      };
    case "metaDraft":
      return state.meta.kind === "open"
        ? { ...state, meta: { ...state.meta, draft: action.draft, error: null } }
        : state;
    case "metaBusy":
      return state.meta.kind === "open"
        ? { ...state, meta: { ...state.meta, busy: action.busy } }
        : state;
    case "metaFailed":
      return state.meta.kind === "open"
        ? { ...state, meta: { ...state.meta, busy: false, error: action.error } }
        : state;
    case "metaClosed":
      return { ...state, meta: { kind: "closed" } };
    case "busy":
      return { ...state, busy: action.busy };
    case "notice":
      return { ...state, notice: action.notice };
    case "reveal":
      return { ...state, reveal: action.view };
    default:
      return assertNever(action, "SecretsAction");
  }
}

// ── 화면 뷰 모델 ─────────────────────────────────────────────────────────

/** 화면이 그릴 값. 값 자체는 없다(값 보기는 상태의 이름, 종류, 남은 초뿐이다) */
export interface SecretsView {
  readonly rows: readonly SecretListEntry[];
  readonly showSearch: boolean;
  readonly offline: boolean;
  /** 목록을 읽는 중이고 아직 행이 없다 */
  readonly loading: boolean;
  /** 목록을 읽지 못한 까닭(연결 없음은 `offline`으로 따로 본다) */
  readonly failed: SecretCommandError | null;
  /** 동작 버튼을 눌러도 되는가: 연결이 있고 다른 명령이 가고 있지 않다 */
  readonly acting: boolean;
  readonly selected: SecretListEntry | null;
  readonly detail: DetailState | null;
  readonly reveal: RevealView;
  readonly revealAvailable: boolean;
}

export function secretsViewOf(state: SecretsState): SecretsView {
  const rows = visibleRowsOf(state.rows, state.query, state.sort);
  const offline = state.list.kind === "failed" && state.list.error.kind === "offline";
  const failed = state.list.kind === "failed" && !offline ? state.list.error : null;
  return {
    rows,
    showSearch: state.rows.length > SEARCH_THRESHOLD,
    offline,
    loading: state.list.kind === "loading" && state.rows.length === 0,
    failed,
    acting: !offline && !state.busy,
    selected: state.rows.find((row) => row.name === state.detail?.name) ?? null,
    detail: state.detail,
    reveal: state.reveal,
    revealAvailable: state.revealAvailable,
  };
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
  /** 값이 지금 보인다 */
  readonly revealed: boolean;
}

export type KeyIntent =
  | { readonly type: "move"; readonly delta: 1 | -1 }
  /** 고른 시크릿의 상세로 초점을 옮긴다 */
  | { readonly type: "detail" }
  | { readonly type: "copy" }
  | { readonly type: "hide" };

/**
 * 화면 키 입력의 뜻. 입력 칸에 초점이 있으면 아무것도 하지 않는다.
 * ↑↓와 Enter는 행에 초점이 있을 때만 뜻이 있다. ⌘C는 값이 보일 때만, Esc는 값이 보일 때 값을 가린다.
 */
export function keyIntentOf(facts: KeyFacts): KeyIntent | null {
  if (facts.editable) return null;
  const mod = facts.metaKey || facts.ctrlKey;
  if (mod && !facts.altKey && !facts.shiftKey && facts.key.toLowerCase() === "c") {
    return facts.revealed ? { type: "copy" } : null;
  }
  if (facts.key === "Escape") return facts.revealed ? { type: "hide" } : null;
  if (mod || facts.altKey || facts.shiftKey) return null;
  if (facts.key === "ArrowDown") return facts.onRow ? { type: "move", delta: 1 } : null;
  if (facts.key === "ArrowUp") return facts.onRow ? { type: "move", delta: -1 } : null;
  if (facts.key === "Enter") return facts.onRow ? { type: "detail" } : null;
  return null;
}

/** 목록 읽기 결과가 `Result`일 때 행을 상태로 옮기는 짧은 도우미 */
export function listActionOf(
  listed: Result<readonly SecretListEntry[], SecretCommandError>,
): SecretsAction {
  return listed.ok
    ? { type: "listLoaded", rows: listed.value }
    : { type: "listFailed", error: listed.error };
}
