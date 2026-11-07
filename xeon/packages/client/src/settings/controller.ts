import { Bug, attemptAsync, detach, parseJson, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type {
  EffectiveSetting,
  SettingKey,
  SettingScope,
  SettingSource,
  SettingDefWire,
} from "@fresnel/contracts/settings";
import type {
  HostConnection,
  SettingsFileScope,
  Unsubscribe,
  WireParams,
  WireRequestOptions,
} from "@fresnel/contracts/wire";
import { t } from "../i18n/index.ts";
import { chosenWriteScope } from "./badges.ts";
import { invalidationConcerns, type SettingsInvalidation } from "./invalidation.ts";
import {
  initialSettingsState,
  reduceSettings,
  type SettingsAction,
  type SettingsState,
} from "./state.ts";
import {
  localFieldError,
  planReset,
  planWrite,
  toFieldError,
  type FollowUp,
} from "./write-flow.ts";
import type {
  FieldError,
  LocalWrite,
  LocalWriteFailure,
  SecretStatus,
  WritableScope,
} from "./types.ts";

// 설정 화면 컨트롤러(L4.settings-ui §3.2). 연결과 전이 함수를 잇는다: 읽기, 편집, 저장, 복귀, 변경 알림 반영.
// 실패는 전부 상태의 오류 값으로 남는다. 메서드는 던지지 않는다.
// 두 원천(§4.1.3): 엔진 항목은 `settings.*`로, `l4.desktop.` 항목은 로컬 저장소 포트로 읽고 쓴다.

/** 시크릿 흐름 요청(값 없음). 값 입력과 열람은 호스트 쪽 L0.secrets 흐름이 받는다(§4.6.4 C안) */
export type SecretFlowRequest =
  | { readonly kind: "register"; readonly name: string }
  | { readonly kind: "rotate"; readonly name: string }
  | { readonly kind: "reveal"; readonly name: string };

export type SecretFlowOutcome =
  | { readonly kind: "done"; readonly status: SecretStatus }
  | { readonly kind: "cancelled" }
  | { readonly kind: "unavailable"; readonly reason: string };

/**
 * 데스크톱 로컬 저장소 포트(L4.settings-ui §4.1.3, L4.desktop.spec §3.6). desktop이 구조 타입으로 맞춘다.
 * 이 패키지는 `apps/desktop`의 타입을 알지 못한다. 정의는 `l4.desktop.` 접두사 키만 준다고 가정한다.
 */
export interface LocalSettingsPort {
  /** `l4.desktop.*` 정의 목록 */
  defs(): readonly SettingDefWire[];
  /** 유효 값. 저장한 값이 없으면 기본값을 출처 `default`로 돌려준다. 정의가 없는 키면 undefined */
  get(key: SettingKey): EffectiveSetting | undefined;
  set(key: SettingKey, value: unknown): Promise<LocalWrite>;
  /** 기본값으로 되돌린다 */
  reset(key: SettingKey): Promise<LocalWrite>;
  /** 이 포트에서 값이 바뀔 때 알린다 */
  onChange(listener: (setting: EffectiveSetting) => void): Unsubscribe;
}

/** desktop(L4.desktop.spec)이 채워 넘긴다. 설정 화면은 이 값만으로 동작한다 */
export interface SettingsHostPort {
  /** 엔진 연결. 엔진이 없으면 null이다. 그때 컨트롤러는 로컬 원천 항목만 읽고 쓴다 */
  readonly connection: HostConnection | null;
  /** 데스크톱 로컬 원천. 없으면 `l4.desktop.*` 항목이 없다 */
  readonly localStore?: LocalSettingsPort;
  /** 현재 보고 있는 대화. 없으면 null이고 `launch` 범위 쓰기를 숨긴다 */
  currentThreadId(): ThreadId | null;
  /** 재시작이 필요한 변경을 적용하려고 호스트 재시작을 요청한다. 수명 관리는 desktop 몫이다 */
  requestHostRestart(): Promise<void>;
  /** 시크릿 탭의 값 입력과 열람을 L0.secrets 흐름으로 넘긴다. 이 컨트롤러는 호출하지 않는다 */
  readonly openSecretFlow?: (request: SecretFlowRequest) => Promise<SecretFlowOutcome>;
}

export interface SettingsController {
  getState(): SettingsState;
  subscribe(listener: (state: SettingsState) => void): Unsubscribe;
  /** 로컬 원천을 읽고, 엔진이 있으면 settings.list → settings.get 순서로 읽는다. `settings.invalidated` 알림을 구독한다 */
  load(signal?: AbortSignal): Promise<void>;
  /** 초안을 바꾼다. 클라이언트 검사 결과를 상태에 남긴다. 전송하지 않는다 */
  edit(key: SettingKey, raw: unknown): void;
  selectScope(key: SettingKey, scope: WritableScope): void;
  /** 초안을 저장한다. 로컬 항목은 로컬 저장소에, 엔진 항목은 settings.set으로 보낸다. 클라이언트 검사가 실패하면 보내지 않는다 */
  commit(key: SettingKey): Promise<void>;
  discard(key: SettingKey): void;
  /** 다른 곳에서 값이 바뀐 초안을 그대로 둔다. 이 뒤에야 저장할 수 있다 */
  keepDraft(key: SettingKey): void;
  /** 범위 값을 지운다. 로컬 항목은 기본값으로 되돌린다 */
  reset(key: SettingKey, scope: Exclude<SettingScope, "managed">): Promise<void>;
  restartHost(): Promise<void>;
  dispose(): Promise<void>;
}

/** 쓰기 한 번의 결과. 실패는 필드 오류와 뒤 처리로 나뉜다 */
type WriteOutcome =
  | { readonly ok: true; readonly setting: EffectiveSetting }
  | { readonly ok: false; readonly error: FieldError; readonly followUp: FollowUp };

/** 로컬 저장소가 던지면(포트 계약 밖) 저장 실패로 본다 */
const STORAGE_FAILURE: LocalWriteFailure = { ok: false, kind: "storage", details: {} };

function requestOptions(signal: AbortSignal | undefined): WireRequestOptions | undefined {
  return signal === undefined ? undefined : { signal };
}

/** 가려진 범위가 파일에 쓴 값을 읽을 범위. `launch`와 `default`는 파일이 없다 */
function fileScopeOf(scope: SettingSource["scope"]): SettingsFileScope | null {
  return scope === "default" || scope === "launch" ? null : scope;
}

/** 값이 가려진 범위 가운데 파일에서 읽을 범위. 같은 범위는 한 번만 읽는다 */
function shadowedFileScopesOf(
  values: ReadonlyMap<SettingKey, EffectiveSetting>,
): readonly SettingsFileScope[] {
  const scopes = new Set<SettingsFileScope>();
  for (const setting of values.values()) {
    for (const source of setting.shadowed) {
      const scope = fileScopeOf(source.scope);
      if (scope !== null) scopes.add(scope);
    }
  }
  return [...scopes];
}

/** 범위 파일 원문(JSON 객체)을 키별 값으로 바꾼다. 파일이 JSON 객체가 아니면 null이다(호스트가 같은 파일을 같은 식으로 읽는다) */
function valuesOfSettingsFile(text: string): ReadonlyMap<SettingKey, unknown> | null {
  const parsed = parseJson(text);
  if (!parsed.ok) return null;
  const json = parsed.value;
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  return new Map(Object.entries(json));
}

function transientError(): FieldError {
  return { kind: "transient", message: t("client.settings.field.transient") };
}

/** 엔진 쓰기 한 번. 던져진 실패는 호스트 오류 문장으로 바꾼다(§4.4.4) */
async function engineSend(
  def: SettingDefWire,
  call: () => PromiseLike<EffectiveSetting>,
): Promise<WriteOutcome> {
  const outcome = await attemptAsync(call);
  if (outcome.ok) return { ok: true, setting: outcome.value };
  const mapped = toFieldError(def, outcome.error.cause);
  return { ok: false, error: mapped.error, followUp: mapped.followUp };
}

/** 로컬 쓰기 한 번. 다시 읽을 연결이 없으므로 뒤 처리는 `none`이다 */
async function localSend(
  def: SettingDefWire,
  call: () => Promise<LocalWrite>,
): Promise<WriteOutcome> {
  const outcome = await attemptAsync(call);
  const written = outcome.ok ? outcome.value : STORAGE_FAILURE;
  if (written.ok) return { ok: true, setting: written.setting };
  return { ok: false, error: localFieldError(def, written), followUp: "none" };
}

export function createSettingsController(port: SettingsHostPort): SettingsController {
  const { connection, localStore } = port;
  let state: SettingsState = initialSettingsState;
  const listeners = new Set<(next: SettingsState) => void>();
  /** 키별 진행 중인 쓰기. 같은 키의 다음 쓰기는 이것이 끝난 뒤 보낸다 */
  const inFlight = new Map<SettingKey, Promise<void>>();
  let unsubscribe: Unsubscribe | null = null;
  let unsubscribeLocal: Unsubscribe | null = null;
  /** 연결 종료를 기다리는 걸었는가, 그리고 연결이 닫혔는가 */
  let closeWatched = false;
  let linkClosed = false;

  function dispatch(action: SettingsAction): void {
    const next = reduceSettings(state, action);
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener(state);
  }

  function syncThread(): void {
    dispatch({ type: "threadChanged", threadId: port.currentThreadId() });
  }

  function failLoad(cause: unknown): void {
    dispatch({ type: "loadFailed", error: toFieldError(undefined, cause).error });
  }

  /** 엔진 연결이 살아 있으면 그것을, 없거나 끊겼으면 null이다. 엔진 호출은 이것으로만 한다 */
  function liveLink(): HostConnection | null {
    return state.engineOffline ? null : connection;
  }

  /** 로컬 원천 쓰기. 로컬 원천 항목은 포트가 있을 때만 정의에 들어오므로 없으면 불변 조건이 깨진 것이다 */
  function localStoreOf(): LocalSettingsPort {
    if (localStore === undefined) throw new Bug("local origin without a local settings store");
    return localStore;
  }

  /** 로컬 저장소의 유효 값. 키가 비면 로컬 정의 전부다 */
  function localValuesOf(keys: readonly SettingKey[]): readonly EffectiveSetting[] {
    if (localStore === undefined) return [];
    const localKeys = state.catalogs.desktop.map((def) => def.key);
    const wanted = keys.length === 0 ? localKeys : localKeys.filter((key) => keys.includes(key));
    return wanted.flatMap((key) => {
      const setting = localStore.get(key);
      return setting === undefined ? [] : [setting];
    });
  }

  /** 엔진 정의 목록을 다시 읽는다. 연결이 없으면 읽을 것이 없다 */
  async function reloadCatalog(signal?: AbortSignal): Promise<boolean> {
    const link = liveLink();
    if (link === null) return true;
    const listed = await attemptAsync(() =>
      link.request("settings.list", { includeDeprecated: true }, requestOptions(signal)),
    );
    if (!listed.ok) {
      failLoad(listed.error.cause);
      return false;
    }
    dispatch({ type: "catalogLoaded", origin: "engine", defs: listed.value.defs });
    return true;
  }

  /**
   * 키 목록의 유효 값을 다시 읽는다. 키가 비면 전체다. 로컬 값은 바로 읽고, 엔진 값은 연결이 있을 때만 읽는다.
   * 응답은 도착한 순서대로 반영한다. 가려진 범위의 파일 값도 이때 다시 읽는다.
   */
  async function refreshValues(
    keys: readonly SettingKey[],
    signal?: AbortSignal,
  ): Promise<boolean> {
    const local = localValuesOf(keys);
    const link = liveLink();
    if (link === null) {
      dispatch({ type: "valuesLoaded", settings: local });
      return true;
    }
    const threadId = port.currentThreadId();
    const params: WireParams<"settings.get"> = {
      ...(keys.length === 0 ? {} : { keys: [...keys] }),
      ...(threadId === null ? {} : { threadId }),
    };
    const got = await attemptAsync(() =>
      link.request("settings.get", params, requestOptions(signal)),
    );
    if (!got.ok) {
      failLoad(got.error.cause);
      return false;
    }
    dispatch({ type: "valuesLoaded", settings: [...got.value.settings, ...local] });
    await refreshScopeFiles();
    return true;
  }

  async function followUp(kind: FollowUp, key: SettingKey): Promise<void> {
    if (kind === "refreshValue") {
      await refreshValues([key]);
    } else if (kind === "reloadCatalog") {
      await reloadCatalog();
    }
  }

  /** 쓰기 하나: 요청 번호를 올리고 보낸 뒤 응답을 상태에 반영한다. 같은 키의 응답은 마지막 번호만 남는다 */
  async function write(
    key: SettingKey,
    send: () => Promise<WriteOutcome>,
    onSaved: (setting: EffectiveSetting, seq: number) => SettingsAction,
  ): Promise<void> {
    const seq = (state.requestSeq.get(key) ?? 0) + 1;
    dispatch({ type: "writeStarted", key, seq });
    const work = (async (): Promise<void> => {
      const outcome = await send();
      if (!outcome.ok) {
        dispatch({ type: "writeFailed", key, seq, error: outcome.error });
        await followUp(outcome.followUp, key);
        return;
      }
      dispatch(onSaved(outcome.setting, seq));
      // 저장으로 가려진 범위의 파일이 바뀌었을 수 있어 다시 읽는다(알림을 기다리지 않는다)
      await refreshScopeFiles();
    })();
    inFlight.set(key, work);
    await work;
    if (inFlight.get(key) === work) inFlight.delete(key);
  }

  /** 가려진 범위 파일 읽기 번호. 겹친 읽기는 마지막 것만 반영한다 */
  let scopeFileSeq = 0;

  /** 엔진 연결이 살아 있을 때 범위 파일 하나를 읽는다. 읽지 못했거나 파일이 JSON 객체가 아니면 null이다 */
  async function readScopeFile(
    scope: SettingsFileScope,
  ): Promise<ReadonlyMap<SettingKey, unknown> | null> {
    const link = liveLink();
    if (link === null) return null;
    const threadId = port.currentThreadId();
    // 작업 폴더 범위(project, local)는 대화가 있어야 경로가 정해진다. user는 대화를 보내지 않는다(파일 편집기와 같다)
    const folderScope = scope === "project" || scope === "local";
    if (folderScope && threadId === null) return null;
    const params = folderScope && threadId !== null ? { scope, threadId } : { scope };
    const read = await attemptAsync(() => link.request("settings.readFile", params));
    return read.ok ? valuesOfSettingsFile(read.value.text) : null;
  }

  /**
   * 가려진 범위의 파일을 다시 읽어 `scopeFiles`를 채운다(§4.3.4). 읽기는 실패해도 설정 읽기를 실패시키지 않는다.
   * 가려진 범위가 없으면 할 일이 없다.
   */
  async function refreshScopeFiles(): Promise<void> {
    const seq = ++scopeFileSeq;
    const scopes = shadowedFileScopesOf(state.values);
    const read = await Promise.all(
      scopes.map(async (scope) => ({ scope, values: await readScopeFile(scope) })),
    );
    if (seq !== scopeFileSeq) return;
    for (const entry of read) {
      dispatch({ type: "scopeFileRead", scope: entry.scope, values: entry.values });
    }
  }

  /** 같은 키의 진행 중 쓰기가 끝난 뒤 `rerun`을 한다. 진행 중인 쓰기가 없으면 null이다 */
  function queued(key: SettingKey, rerun: () => Promise<void>): Promise<void> | null {
    const pending = inFlight.get(key);
    return pending === undefined ? null : pending.then(() => rerun());
  }

  function blocked(key: SettingKey, error: FieldError): Promise<void> {
    dispatch({ type: "writeBlocked", key, error });
    return Promise.resolve();
  }

  function onInvalidated(notice: SettingsInvalidation): void {
    if (!invalidationConcerns(notice, port.currentThreadId())) return;
    dispatch({ type: "invalidated", keys: notice.keys });
    detach(refreshAfterInvalidation(notice.keys), (cause) => {
      failLoad(cause);
    });
  }

  /** 알림 뒤 다시 읽기. 키가 비었거나 카탈로그에 없는 키가 있으면 목록부터 다시 읽는다 */
  async function refreshAfterInvalidation(keys: readonly SettingKey[]): Promise<void> {
    const catalogChanged = keys.length === 0 || keys.some((key) => !state.defs.has(key));
    if (catalogChanged && !(await reloadCatalog())) return;
    await refreshValues(keys);
  }

  /** 연결이 닫히면 엔진 원천 항목을 읽기 전용으로 바꾼다(§4.1.3). 연결마다 한 번만 건다 */
  function watchClose(link: HostConnection): void {
    if (closeWatched) return;
    closeWatched = true;
    detach(untilClosed(link), rethrow);
  }

  async function untilClosed(link: HostConnection): Promise<void> {
    await link.closed;
    linkClosed = true;
    dispatch({ type: "engineStateChanged", offline: true });
  }

  async function load(signal?: AbortSignal): Promise<void> {
    syncThread();
    dispatch({ type: "loadStarted" });
    if (localStore !== undefined) {
      if (unsubscribeLocal === null) {
        unsubscribeLocal = localStore.onChange((setting) => {
          dispatch({ type: "valueChanged", setting });
        });
      }
      dispatch({ type: "catalogLoaded", origin: "desktop", defs: localStore.defs() });
    }
    if (connection === null) {
      dispatch({ type: "engineStateChanged", offline: true });
      await refreshValues([], signal);
      return;
    }
    // 구독을 읽기보다 먼저 건다. 읽는 사이의 변경을 놓치지 않으려고다
    if (unsubscribe === null) {
      unsubscribe = connection.onNotification("settings.invalidated", onInvalidated);
    }
    watchClose(connection);
    dispatch({ type: "engineStateChanged", offline: linkClosed });
    if (!(await reloadCatalog(signal))) return;
    await refreshValues([], signal);
  }

  function commit(key: SettingKey): Promise<void> {
    const after = queued(key, () => commit(key));
    if (after !== null) return after;
    syncThread();
    const current = state;
    const def = current.defs.get(key);
    const draft = current.drafts.get(key);
    if (def === undefined || draft === undefined) return Promise.resolve();
    // 다른 곳에서 바뀐 값은 덮어쓰지 않는다. "새 값 쓰기"나 "내 값 유지"를 고른 뒤에 저장한다(scA-4-2)
    if (current.remoteChanged.has(key)) return Promise.resolve();
    const setting = current.values.get(key);
    // 화면의 범위 선택 칸과 같은 값이다(사용자가 고른 범위, 없으면 유효 값을 정한 범위)
    const scope = chosenWriteScope(
      def,
      setting,
      current.threadId !== null,
      current.scopes.get(key),
    );
    const plan = planWrite(def, setting, draft.value, scope, current.threadId);
    if (plan.kind === "blocked") return blocked(key, plan.error);
    const sent = draft.value;
    const onSaved = (saved: EffectiveSetting, seq: number): SettingsAction => ({
      type: "writeSucceeded",
      key,
      seq,
      setting: saved,
      sent,
    });
    if ((current.origins.get(key) ?? "engine") === "desktop") {
      const store = localStoreOf();
      return write(key, () => localSend(def, () => store.set(key, sent)), onSaved);
    }
    const link = liveLink();
    if (link === null) return blocked(key, transientError());
    const params = plan.params;
    return write(
      key,
      () => engineSend(def, () => link.request("settings.set", params).then((r) => r.setting)),
      onSaved,
    );
  }

  function reset(key: SettingKey, scope: Exclude<SettingScope, "managed">): Promise<void> {
    const after = queued(key, () => reset(key, scope));
    if (after !== null) return after;
    syncThread();
    const current = state;
    const def = current.defs.get(key);
    if (def === undefined) return Promise.resolve();
    const plan = planReset(def, current.values.get(key), scope, current.threadId);
    if (plan.kind === "blocked") return blocked(key, plan.error);
    const onSaved = (saved: EffectiveSetting, seq: number): SettingsAction => ({
      type: "resetSucceeded",
      key,
      seq,
      setting: saved,
    });
    if ((current.origins.get(key) ?? "engine") === "desktop") {
      const store = localStoreOf();
      return write(key, () => localSend(def, () => store.reset(key)), onSaved);
    }
    const link = liveLink();
    if (link === null) return blocked(key, transientError());
    const params = plan.params;
    return write(
      key,
      () => engineSend(def, () => link.request("settings.reset", params).then((r) => r.setting)),
      onSaved,
    );
  }

  async function restartHost(): Promise<void> {
    dispatch({ type: "restartRequested" });
    const outcome = await attemptAsync(() => port.requestHostRestart());
    if (!outcome.ok) {
      dispatch({
        type: "restartFailed",
        error: toFieldError(undefined, outcome.error.cause).error,
      });
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    edit(key, raw) {
      dispatch({ type: "draftEdited", key, raw });
    },
    selectScope(key, scope) {
      dispatch({ type: "scopeSelected", key, scope });
    },
    commit,
    discard(key) {
      dispatch({ type: "draftDiscarded", key });
    },
    keepDraft(key) {
      dispatch({ type: "remoteKept", key });
    },
    reset,
    restartHost,
    dispose() {
      unsubscribe?.();
      unsubscribe = null;
      unsubscribeLocal?.();
      unsubscribeLocal = null;
      listeners.clear();
      return Promise.resolve();
    },
  };
}
