import { err, ok, type Result } from "@fresnel/contracts";
import type { ExtUiEntry, HostConnection } from "@fresnel/contracts/wire";
import { createScreenLedger, type ScreenLedger } from "@fresnel/client/views/ledger";
import type { BridgePolicyContext } from "@fresnel/client/views/app";
import { syncAppRoots, type AppRootsInvoke, type SkippedAppRoot } from "./app-roots.ts";
import {
  groupPlacements,
  layoutOf,
  layoutValuesOf,
  UI_HIDDEN_KEY,
  UI_ORDER_KEY,
  type PlacementGroups,
  type UiLayout,
} from "./placements.ts";
import {
  appsAllowed,
  policyContextOf,
  UI_ALLOW_PROJECT_APPS_KEY,
  UI_APPS_KEY,
} from "./policy-context.ts";

// 플러그인 화면의 실행 맥락. `ext.ui.list`를 읽어 항목을 들고, 앱 root를 셸에 알리고, 화면 장부 하나를 갖는다. React와 DOM이 없다.
// 설정 키 `x.ui.apps`와 `x.ui.allowProjectApps`는 코드가 읽는 그대로 읽는다(옛 이름 `x.views.*`는 없다. 문서도 `x.ui.*`로 통일했다).

type PluginUiPhase = "loading" | "ready" | "offline";

export interface PluginUiState {
  readonly phase: PluginUiPhase;
  readonly entries: readonly ExtUiEntry[];
  /** 앱 정책 설정 값(`x.ui.*`). 프레임을 못 쓰는 기기에서는 `x.ui.apps`가 거짓으로 덮인다 */
  readonly settings: Readonly<Record<string, unknown>>;
  /** 자리별 항목. 사용자가 숨긴 항목은 빠지고 상태 표시줄 칸은 사용자 순서를 따른다 */
  readonly groups: PlacementGroups;
  /** 사용자가 숨긴 항목과 자리별 순서(`x.ui.hidden`, `x.ui.order`). `settings`에서 읽은 값이다 */
  readonly layout: UiLayout;
  /** 꺼졌거나 안전 모드로 실리지 않은 확장 이름. 이 확장의 화면은 프레임과 폴링을 닫고 앱 root도 셸에 알리지 않는다 */
  readonly inactive: ReadonlySet<string>;
  /** 셸이 건너뛴 앱 root(나쁜 항목). 그 확장의 앱 화면은 그리지 못하고 이유를 보인다 */
  readonly rootsSkipped: readonly SkippedAppRoot[];
}

export interface PluginUiRuntimeDeps {
  /** 연결이 있을 때만 `run`을 부른다. 없으면 오류 값이다 */
  readonly withConnection: <T>(
    run: (connection: HostConnection) => Promise<T>,
  ) => Promise<Result<T, unknown>>;
  /** 셸 `invoke`(운영) 또는 가짜(시험). 프레임을 못 쓰는 기기에서는 `undefined`이고 앱 root는 보내지 않는다 */
  readonly appRootsInvoke: AppRootsInvoke | undefined;
  /** 이 기기가 프레임을 쓸 수 있는가. Windows는 전용 스킴 주소가 달라 대상이 아니다 */
  readonly framesSupported: boolean;
}

export interface PluginUiRuntime {
  readonly ledger: ScreenLedger;
  readonly getState: () => PluginUiState;
  readonly subscribe: (listener: () => void) => () => void;
  /** `ext.ui.list`와 앱 정책 설정을 다시 읽는다 */
  readonly refresh: (threadId?: string) => Promise<void>;
  /** 화면 하나의 다리 판정 맥락. `ext.get`과 `command.list`를 읽는다 */
  readonly contextFor: (
    entry: ExtUiEntry,
    openThreadId: string | undefined,
  ) => Promise<Result<BridgePolicyContext, { readonly kind: string }>>;
  /** 이 항목의 앱을 지금 그릴 수 있는가(기기, 설정, 등급) */
  readonly framesAllowed: (entry: ExtUiEntry) => boolean;
  /**
   * 숨김과 순서를 사용자 범위 설정에 쓴다(리뷰 없음, ADR-0021 §3.12). 화면은 먼저 바꾸고, 쓰기가 실패하면 앞 값으로 되돌리고 오류 값을 준다
   */
  readonly saveLayout: (next: UiLayout) => Promise<Result<void, LayoutSaveError>>;
}

/** 쓰기 실패(연결 없음, 엔진 거절). 화면은 토스트 한 줄을 보인다 */
interface LayoutSaveError {
  readonly kind: "write_failed";
}

const EMPTY_SETTINGS: Readonly<Record<string, unknown>> = {};
const NO_NAMES: ReadonlySet<string> = new Set();
const NO_SKIPPED: readonly SkippedAppRoot[] = [];

function stateOf(
  phase: PluginUiPhase,
  entries: readonly ExtUiEntry[],
  settings: Readonly<Record<string, unknown>>,
  inactive: ReadonlySet<string>,
  rootsSkipped: readonly SkippedAppRoot[] = NO_SKIPPED,
): PluginUiState {
  return {
    phase,
    entries,
    settings,
    groups: groupPlacements(entries, settings),
    layout: layoutOf(settings),
    inactive,
    rootsSkipped,
  };
}

export function createPluginUiRuntime(deps: PluginUiRuntimeDeps): PluginUiRuntime {
  const listeners = new Set<() => void>();
  const ledger = createScreenLedger();
  let state: PluginUiState = stateOf("loading", [], EMPTY_SETTINGS, NO_NAMES);
  /** 읽기가 겹치면 하나로 묶는다. 읽는 중에 또 요청이 오면 끝난 뒤 한 번 더 읽는다 */
  let running: Promise<void> | undefined;
  let again = false;
  let againThread: string | undefined;

  function set(next: PluginUiState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  // 안전 모드로 빠진 확장. 어느 프로필에도 없을 뿐인 설치된 앱은 열리므로 `inactive`로 막지 않는다(AGE-78). 꺼짐은 항목 상태가 알려 준다
  let safeOff: ReadonlySet<string> = NO_NAMES;

  function framesAllowed(entry: ExtUiEntry): boolean {
    return (
      deps.framesSupported &&
      entry.state !== "disabled" &&
      !safeOff.has(entry.extension) &&
      appsAllowed(entry.trust, state.settings)
    );
  }

  async function readOnce(threadId: string | undefined): Promise<void> {
    const read = await deps.withConnection(async (connection) => {
      const list = await connection.request(
        "ext.ui.list",
        threadId === undefined ? {} : { threadId },
      );
      const extensions = await connection.request("ext.list", {});
      const got = await connection.request("settings.get", {
        keys: [UI_APPS_KEY, UI_ALLOW_PROJECT_APPS_KEY, UI_HIDDEN_KEY, UI_ORDER_KEY],
      });
      return { items: list.items, extensions: extensions.extensions, settings: got.settings };
    });
    if (!read.ok) {
      set(stateOf("offline", state.entries, state.settings, state.inactive, state.rootsSkipped));
      return;
    }
    const values: Record<string, unknown> = {};
    for (const row of read.value.settings) values[row.key] = row.value;
    // 이 기기가 프레임을 못 쓰면 정책 값과 상관없이 앱을 막는다
    const settings = deps.framesSupported ? values : { ...values, [UI_APPS_KEY]: false };
    const inactive = new Set(
      read.value.extensions
        .filter((item) => item.status !== "enabled" || item.safeModeExcluded !== null)
        .map((item) => item.name),
    );
    safeOff = new Set(
      read.value.extensions
        .filter((item) => item.safeModeExcluded !== null)
        .map((item) => item.name),
    );
    set(stateOf("ready", read.value.items, settings, inactive));
    if (deps.appRootsInvoke !== undefined && deps.framesSupported) {
      // 꺼진 확장(항목 상태 `disabled`)과 안전 모드로 빠진 확장의 앱 root는 셸에 두지 않는다. 어느 프로필에도 없을 뿐인 설치된 앱은 둔다(AGE-78).
      // 거부 이유는 화면이 앱 root 없이 그리는 것으로 드러난다(프레임 주소가 404). 여기서는 던지지 않는다
      const synced = await syncAppRoots(
        deps.appRootsInvoke,
        read.value.items.filter((item) => !safeOff.has(item.extension)),
      );
      if (synced.ok && synced.value.length > 0) {
        set(stateOf("ready", read.value.items, settings, inactive, synced.value));
      }
    }
  }

  return {
    ledger,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    framesAllowed,

    async saveLayout(next) {
      const before = state;
      const values = layoutValuesOf(next);
      const settings = {
        ...before.settings,
        [UI_HIDDEN_KEY]: values.hidden,
        [UI_ORDER_KEY]: values.order,
      };
      set(stateOf(before.phase, before.entries, settings, before.inactive, before.rootsSkipped));
      const wrote = await deps.withConnection(async (connection) => {
        await connection.request("settings.set", {
          key: UI_HIDDEN_KEY,
          value: values.hidden,
          scope: "user",
        });
        await connection.request("settings.set", {
          key: UI_ORDER_KEY,
          value: values.order,
          scope: "user",
        });
      });
      if (wrote.ok) return ok(undefined);
      // 그사이 다시 읽은 값이 없을 때만 되돌린다(새로 읽은 값이 더 맞다)
      if (state.entries === before.entries) {
        set(
          stateOf(
            before.phase,
            before.entries,
            before.settings,
            before.inactive,
            before.rootsSkipped,
          ),
        );
      }
      return err({ kind: "write_failed" });
    },

    refresh(threadId) {
      if (running !== undefined) {
        again = true;
        againThread = threadId;
        return running;
      }
      const work = (async (): Promise<void> => {
        await readOnce(threadId);
        while (again) {
          again = false;
          // oxlint-disable-next-line no-await-in-loop -- 읽기가 겹치면 끝난 뒤 한 번 더 읽는다 (X.loading-trust.spec §4.3.4)
          await readOnce(againThread);
        }
      })();
      running = work.finally(() => {
        running = undefined;
      });
      return running;
    },

    async contextFor(entry, openThreadId) {
      const read = await deps.withConnection(async (connection) => {
        const get = await connection.request("ext.get", { name: entry.extension });
        const commands = await connection.request("command.list", {});
        return { get, commands: commands.commands };
      });
      if (!read.ok) return err({ kind: "offline" });
      const built = policyContextOf({
        get: read.value.get,
        entry,
        openThreadId,
        commands: read.value.commands.map((command) => ({
          name: command.name,
          origin: command.origin,
        })),
      });
      return built.ok ? ok(built.value) : err({ kind: built.error.kind });
    },
  };
}

/** 넘겨받기 nonce. 주소 조각에 들어가므로 URL 안전 글자만 쓰고 16바이트 난수다 */
export function newFrameNonce(random: (bytes: Uint8Array) => void): string {
  const bytes = new Uint8Array(16);
  random(bytes);
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}
