import { attemptAsync, detach } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type {
  EffectiveSetting,
  SettingKey,
  SettingScope,
  SettingDefWire,
} from "@fresnel/contracts/settings";
import type {
  HostConnection,
  Unsubscribe,
  WireParams,
  WireRequestOptions,
} from "@fresnel/contracts/wire";
import { defaultWriteScope, writableScopes } from "./badges.ts";
import { invalidationConcerns, type SettingsInvalidation } from "./invalidation.ts";
import {
  initialSettingsState,
  reduceSettings,
  type SettingsAction,
  type SettingsState,
} from "./state.ts";
import { planReset, planWrite, toFieldError, type FollowUp } from "./write-flow.ts";
import type { SecretStatus, WritableScope } from "./types.ts";

// 설정 화면 컨트롤러(L4.settings-ui §3.2). 연결과 전이 함수를 잇는다: 읽기, 편집, 저장, 복귀, 변경 알림 반영.
// 실패는 전부 상태의 오류 값으로 남는다. 메서드는 던지지 않는다.

/** 시크릿 흐름 요청(값 없음). 값 입력과 열람은 호스트 쪽 L0.secrets 흐름이 받는다(§4.6.4 C안) */
export type SecretFlowRequest =
  | { readonly kind: "register"; readonly name: string }
  | { readonly kind: "rotate"; readonly name: string }
  | { readonly kind: "reveal"; readonly name: string };

export type SecretFlowOutcome =
  | { readonly kind: "done"; readonly status: SecretStatus }
  | { readonly kind: "cancelled" }
  | { readonly kind: "unavailable"; readonly reason: string };

/** desktop(L4.desktop.spec)이 채워 넘긴다. 설정 화면은 이 값만으로 동작한다 */
export interface SettingsHostPort {
  readonly connection: HostConnection;
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
  /** settings.list → settings.get 순서로 읽고 `settings.invalidated` 알림을 구독한다 */
  load(signal?: AbortSignal): Promise<void>;
  /** 초안을 바꾼다. 클라이언트 검사 결과를 상태에 남긴다. 전송하지 않는다 */
  edit(key: SettingKey, raw: unknown): void;
  selectScope(key: SettingKey, scope: WritableScope): void;
  /** 초안을 settings.set으로 보낸다. 클라이언트 검사가 실패하면 보내지 않는다 */
  commit(key: SettingKey): Promise<void>;
  discard(key: SettingKey): void;
  /** 범위 값을 settings.reset으로 지운다 */
  reset(key: SettingKey, scope: Exclude<SettingScope, "managed">): Promise<void>;
  restartHost(): Promise<void>;
  dispose(): Promise<void>;
}

function requestOptions(signal: AbortSignal | undefined): WireRequestOptions | undefined {
  return signal === undefined ? undefined : { signal };
}

export function createSettingsController(port: SettingsHostPort): SettingsController {
  const { connection } = port;
  let state: SettingsState = initialSettingsState;
  const listeners = new Set<(next: SettingsState) => void>();
  /** 키별 진행 중인 쓰기. 같은 키의 다음 쓰기는 이것이 끝난 뒤 보낸다 */
  const inFlight = new Map<SettingKey, Promise<void>>();
  let unsubscribe: Unsubscribe | null = null;

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

  async function reloadCatalog(signal?: AbortSignal): Promise<boolean> {
    const listed = await attemptAsync(() =>
      connection.request("settings.list", { includeDeprecated: true }, requestOptions(signal)),
    );
    if (!listed.ok) {
      failLoad(listed.error.cause);
      return false;
    }
    dispatch({ type: "catalogLoaded", defs: listed.value.defs });
    return true;
  }

  /** 키 목록의 유효 값을 다시 읽는다. 키가 비면 전체다. 응답은 도착한 순서대로 반영한다 */
  async function refreshValues(
    keys: readonly SettingKey[],
    signal?: AbortSignal,
  ): Promise<boolean> {
    const threadId = port.currentThreadId();
    const params: WireParams<"settings.get"> = {
      ...(keys.length === 0 ? {} : { keys: [...keys] }),
      ...(threadId === null ? {} : { threadId }),
    };
    const got = await attemptAsync(() =>
      connection.request("settings.get", params, requestOptions(signal)),
    );
    if (!got.ok) {
      failLoad(got.error.cause);
      return false;
    }
    dispatch({ type: "valuesLoaded", settings: got.value.settings });
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
    def: SettingDefWire,
    send: () => Promise<EffectiveSetting>,
    onSaved: (setting: EffectiveSetting, seq: number) => SettingsAction,
  ): Promise<void> {
    const seq = (state.requestSeq.get(key) ?? 0) + 1;
    dispatch({ type: "writeStarted", key, seq });
    const work = (async (): Promise<void> => {
      const outcome = await attemptAsync(send);
      if (!outcome.ok) {
        const mapped = toFieldError(def, outcome.error.cause);
        dispatch({ type: "writeFailed", key, seq, error: mapped.error });
        await followUp(mapped.followUp, key);
        return;
      }
      dispatch(onSaved(outcome.value, seq));
    })();
    inFlight.set(key, work);
    await work;
    if (inFlight.get(key) === work) inFlight.delete(key);
  }

  /** 같은 키의 진행 중 쓰기가 끝난 뒤 `rerun`을 한다. 진행 중인 쓰기가 없으면 null이다 */
  function queued(key: SettingKey, rerun: () => Promise<void>): Promise<void> | null {
    const pending = inFlight.get(key);
    return pending === undefined ? null : pending.then(() => rerun());
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

  async function load(signal?: AbortSignal): Promise<void> {
    syncThread();
    dispatch({ type: "loadStarted" });
    // 구독을 읽기보다 먼저 건다. 읽는 사이의 변경을 놓치지 않으려고다
    if (unsubscribe === null) {
      unsubscribe = connection.onNotification("settings.invalidated", onInvalidated);
    }
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
    const setting = current.values.get(key);
    const scope =
      current.scopes.get(key) ??
      defaultWriteScope(writableScopes(def, setting, current.threadId !== null));
    const plan = planWrite(def, setting, draft.value, scope, current.threadId);
    if (plan.kind === "blocked") {
      dispatch({ type: "writeBlocked", key, error: plan.error });
      return Promise.resolve();
    }
    const params = plan.params;
    const sent = draft.value;
    return write(
      key,
      def,
      () => connection.request("settings.set", params).then((result) => result.setting),
      (saved, seq) => ({ type: "writeSucceeded", key, seq, setting: saved, sent }),
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
    if (plan.kind === "blocked") {
      dispatch({ type: "writeBlocked", key, error: plan.error });
      return Promise.resolve();
    }
    const params = plan.params;
    return write(
      key,
      def,
      () => connection.request("settings.reset", params).then((result) => result.setting),
      (saved, seq) => ({ type: "resetSucceeded", key, seq, setting: saved }),
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
    reset,
    restartHost,
    dispose() {
      unsubscribe?.();
      unsubscribe = null;
      listeners.clear();
      return Promise.resolve();
    },
  };
}
