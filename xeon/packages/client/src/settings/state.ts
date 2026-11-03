import { assertNever } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type {
  EffectiveSetting,
  SettingDefWire,
  SettingKey,
  SettingScope,
} from "@fresnel/contracts/settings";
import { writableScopes } from "./badges.ts";
import { affectedKeys } from "./invalidation.ts";
import { resolveWidget } from "./widget-map.ts";
import { buildSettingsView } from "./view.ts";
import { checkClientValue, coerceInput } from "./write-flow.ts";
import type { FieldError, FieldVM, SettingsView, ValueIssue, WritableScope } from "./types.ts";

// 설정 화면의 상태와 전이(L4.settings-ui §3.5 model/state, §4.4, §4.5). 순수 함수만 둔다.
// 호스트 호출은 controller.ts가 하고, 응답을 이 전이 함수의 행동으로 바꾼다. 같은 행동 목록이면 같은 상태가 나온다.

/** 편집 중인 값 하나. `issues`가 비어 있지 않으면 저장할 수 없다 */
export interface FieldDraft {
  readonly value: unknown;
  readonly issues: readonly ValueIssue[];
}

export type LoadStatus = "idle" | "loading" | "ready" | "failed";

export interface SettingsState {
  readonly status: LoadStatus;
  readonly loadError: FieldError | null;
  /** 키별 정의. 같은 키가 두 번 오면 처음 것을 쓴다 */
  readonly defs: ReadonlyMap<SettingKey, SettingDefWire>;
  /** 키별 유효 값(`settings.get` 결과) */
  readonly values: ReadonlyMap<SettingKey, EffectiveSetting>;
  readonly drafts: ReadonlyMap<SettingKey, FieldDraft>;
  /** 사용자가 고른 쓰기 범위. 없으면 기본 범위를 쓴다 */
  readonly scopes: ReadonlyMap<SettingKey, WritableScope>;
  readonly saving: ReadonlySet<SettingKey>;
  readonly errors: ReadonlyMap<SettingKey, FieldError>;
  /** 초안을 가진 채 바깥에서 값이 바뀐 키 */
  readonly remoteChanged: ReadonlySet<SettingKey>;
  /** 키별 마지막 쓰기 요청 번호. 이전 번호의 응답은 버린다 */
  readonly requestSeq: ReadonlyMap<SettingKey, number>;
  /** 열린 대화. 없으면 `launch` 범위를 뺀다 */
  readonly threadId: ThreadId | null;
  readonly restartError: FieldError | null;
}

export type SettingsAction =
  | { readonly type: "loadStarted" }
  | { readonly type: "catalogLoaded"; readonly defs: readonly SettingDefWire[] }
  | { readonly type: "valuesLoaded"; readonly settings: readonly EffectiveSetting[] }
  | { readonly type: "loadFailed"; readonly error: FieldError }
  | { readonly type: "draftEdited"; readonly key: SettingKey; readonly raw: unknown }
  | { readonly type: "draftDiscarded"; readonly key: SettingKey }
  /** 범위는 화면 입력이라 모든 범위를 받는다. 쓸 수 있는 범위가 아니면 전이가 버린다 */
  | { readonly type: "scopeSelected"; readonly key: SettingKey; readonly scope: SettingScope }
  | { readonly type: "writeBlocked"; readonly key: SettingKey; readonly error: FieldError }
  | { readonly type: "writeStarted"; readonly key: SettingKey; readonly seq: number }
  | {
      readonly type: "writeSucceeded";
      readonly key: SettingKey;
      readonly seq: number;
      readonly setting: EffectiveSetting;
      /** 보낸 값. 응답 사이에 초안이 바뀌었으면 새 초안을 남긴다 */
      readonly sent: unknown;
    }
  | {
      readonly type: "resetSucceeded";
      readonly key: SettingKey;
      readonly seq: number;
      readonly setting: EffectiveSetting;
    }
  | {
      readonly type: "writeFailed";
      readonly key: SettingKey;
      readonly seq: number;
      readonly error: FieldError;
    }
  /** 변경 알림. 키가 비면 모든 키다 */
  | { readonly type: "invalidated"; readonly keys: readonly SettingKey[] }
  | { readonly type: "threadChanged"; readonly threadId: ThreadId | null }
  | { readonly type: "restartRequested" }
  | { readonly type: "restartFailed"; readonly error: FieldError };

export const initialSettingsState: SettingsState = {
  status: "idle",
  loadError: null,
  defs: new Map(),
  values: new Map(),
  drafts: new Map(),
  scopes: new Map(),
  saving: new Set(),
  errors: new Map(),
  remoteChanged: new Set(),
  requestSeq: new Map(),
  threadId: null,
  restartError: null,
};

function catalogOf(defs: readonly SettingDefWire[]): Map<SettingKey, SettingDefWire> {
  const catalog = new Map<SettingKey, SettingDefWire>();
  for (const def of defs) {
    if (!catalog.has(def.key)) catalog.set(def.key, def);
  }
  return catalog;
}

function withEntry<K, V>(map: ReadonlyMap<K, V>, key: K, value: V): Map<K, V> {
  const next = new Map(map);
  next.set(key, value);
  return next;
}

function withoutEntry<K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
}

function withMember<T>(set: ReadonlySet<T>, item: T): Set<T> {
  const next = new Set(set);
  next.add(item);
  return next;
}

function withoutMember<T>(set: ReadonlySet<T>, item: T): ReadonlySet<T> {
  if (!set.has(item)) return set;
  const next = new Set(set);
  next.delete(item);
  return next;
}

/** 이 요청 번호가 그 키의 마지막 쓰기 요청인가. 아니면 응답은 버린다 */
function isLatest(state: SettingsState, key: SettingKey, seq: number): boolean {
  return state.requestSeq.get(key) === seq;
}

/** 편집 입력을 초안으로 바꾼다. 위젯 변환이 실패하면 초안에 실패 항목을 남긴다 */
function editDraft(state: SettingsState, key: SettingKey, raw: unknown): SettingsState {
  const def = state.defs.get(key);
  if (def === undefined) return state;
  const widget = resolveWidget(def).widget;
  if (widget.kind === "readonly") return state;
  const cleared = withoutEntry(state.errors, key);
  const coerced = coerceInput(widget, raw);
  if (!coerced.ok) {
    // 시크릿 입력이 참조 형식이 아니면 값을 남기지 않고 버린다(§4.6.1 2번)
    if (def.secret === true) {
      const error: FieldError = {
        kind: "invalidValue",
        message: coerced.error.message,
        issues: [coerced.error],
      };
      return {
        ...state,
        drafts: withoutEntry(state.drafts, key),
        errors: withEntry(cleared, key, error),
      };
    }
    return {
      ...state,
      drafts: withEntry(state.drafts, key, { value: raw, issues: [coerced.error] }),
      errors: cleared,
    };
  }
  const checked = checkClientValue(def, coerced.value);
  return {
    ...state,
    drafts: withEntry(state.drafts, key, {
      value: coerced.value,
      issues: checked.ok ? [] : checked.error,
    }),
    errors: cleared,
  };
}

/** 쓰기 성공 공통 처리. 응답 값을 반영하고 바깥 변경 표시를 지운다 */
function applySaved(
  state: SettingsState,
  key: SettingKey,
  setting: EffectiveSetting,
): SettingsState {
  return {
    ...state,
    values: withEntry(state.values, key, setting),
    saving: withoutMember(state.saving, key),
    errors: withoutEntry(state.errors, key),
    remoteChanged: withoutMember(state.remoteChanged, key),
  };
}

/**
 * 설정 화면 상태 전이. 같은 입력이면 같은 출력이고, 바뀌지 않은 경우 입력 상태 객체를 그대로 돌려준다.
 * 알림·응답 순서는 호출자가 맞춘다. 한 연결의 응답은 보낸 순서대로 오므로 키별 요청 번호 비교로 충분하다.
 */
export function reduceSettings(state: SettingsState, action: SettingsAction): SettingsState {
  switch (action.type) {
    case "loadStarted":
      return { ...state, status: "loading", loadError: null };
    case "catalogLoaded":
      return { ...state, defs: catalogOf(action.defs) };
    case "valuesLoaded": {
      const values = new Map(state.values);
      for (const setting of action.settings) values.set(setting.key, setting);
      return { ...state, values, status: "ready", loadError: null };
    }
    case "loadFailed":
      return { ...state, status: "failed", loadError: action.error };
    case "draftEdited":
      return editDraft(state, action.key, action.raw);
    case "draftDiscarded":
      return {
        ...state,
        drafts: withoutEntry(state.drafts, action.key),
        errors: withoutEntry(state.errors, action.key),
        remoteChanged: withoutMember(state.remoteChanged, action.key),
      };
    case "scopeSelected": {
      const def = state.defs.get(action.key);
      if (def === undefined) return state;
      const writable = writableScopes(def, state.values.get(action.key), state.threadId !== null);
      const chosen = writable.find((scope) => scope === action.scope);
      if (chosen === undefined) return state;
      return { ...state, scopes: withEntry(state.scopes, action.key, chosen) };
    }
    case "writeBlocked":
      return { ...state, errors: withEntry(state.errors, action.key, action.error) };
    case "writeStarted":
      return {
        ...state,
        requestSeq: withEntry(state.requestSeq, action.key, action.seq),
        saving: withMember(state.saving, action.key),
        errors: withoutEntry(state.errors, action.key),
      };
    case "writeSucceeded": {
      if (!isLatest(state, action.key, action.seq)) return state;
      const draft = state.drafts.get(action.key);
      // 보낸 값과 같은 초안만 지운다. 응답을 기다리는 사이 새로 바꾼 초안은 남긴다
      const drafts =
        draft !== undefined && Object.is(draft.value, action.sent)
          ? withoutEntry(state.drafts, action.key)
          : state.drafts;
      return applySaved({ ...state, drafts }, action.key, action.setting);
    }
    case "resetSucceeded":
      if (!isLatest(state, action.key, action.seq)) return state;
      return applySaved(state, action.key, action.setting);
    case "writeFailed": {
      if (!isLatest(state, action.key, action.seq)) return state;
      // 시크릿 값 오류는 초안을 버린다(§4.4.4)
      const drafts =
        action.error.kind === "secretValue" ? withoutEntry(state.drafts, action.key) : state.drafts;
      return {
        ...state,
        drafts,
        saving: withoutMember(state.saving, action.key),
        errors: withEntry(state.errors, action.key, action.error),
      };
    }
    case "invalidated": {
      const marked = affectedKeys(action.keys, state.defs).filter(
        (key) => state.drafts.has(key) && !state.remoteChanged.has(key),
      );
      if (marked.length === 0) return state;
      return { ...state, remoteChanged: new Set([...state.remoteChanged, ...marked]) };
    }
    case "threadChanged":
      return state.threadId === action.threadId ? state : { ...state, threadId: action.threadId };
    case "restartRequested":
      return state.restartError === null ? state : { ...state, restartError: null };
    case "restartFailed":
      return { ...state, restartError: action.error };
    default:
      return assertNever(action, "SettingsAction");
  }
}

function overlayField(field: FieldVM, state: SettingsState): FieldVM {
  const draft = state.drafts.get(field.key);
  const scope = state.scopes.get(field.key);
  return {
    ...field,
    value: draft === undefined ? field.value : draft.value,
    selectedScope: scope ?? field.selectedScope,
    dirty: draft !== undefined,
    issues: draft?.issues ?? [],
    saving: state.saving.has(field.key),
    error: state.errors.get(field.key) ?? null,
    remoteChanged: state.remoteChanged.has(field.key),
  };
}

/** 상태에서 화면 view-model을 만든다. 초안 값과 쓰기 상태를 항목에 덮어 쓴다 */
export function settingsViewOf(state: SettingsState): SettingsView {
  const view = buildSettingsView({
    defs: [...state.defs.values()],
    values: state.values,
    hasThread: state.threadId !== null,
  });
  return {
    ...view,
    tabs: view.tabs.map((tab) => ({
      id: tab.id,
      label: tab.label,
      gauge: tab.gauge,
      emptyText: tab.emptyText,
      fields: tab.fields.map((field) => overlayField(field, state)),
    })),
  };
}
