import { err, ok, type Result } from "@fresnel/contracts";
import type { ExtUiEntry, HostConnection } from "@fresnel/contracts/wire";
import { createScreenLedger, type ScreenLedger } from "@fresnel/client/views/ledger";
import type { BridgePolicyContext } from "@fresnel/client/views/app";
import { syncAppRoots, type AppRootsInvoke } from "./app-roots.ts";
import { groupPlacements, type PlacementGroups } from "./placements.ts";
import {
  appsAllowed,
  policyContextOf,
  UI_ALLOW_PROJECT_APPS_KEY,
  UI_APPS_KEY,
} from "./policy-context.ts";

// 플러그인 화면의 실행 맥락. `ext.ui.list`를 읽어 항목을 들고, 앱 root를 셸에 알리고, 화면 장부 하나를 갖는다. React와 DOM이 없다.
// 설정 키 `x.ui.apps`와 `x.ui.allowProjectApps`는 코드가 읽는 그대로 읽는다(`x.views.*`와의 이름 충돌은 사용자 결정 대기, 건드리지 않는다).

type PluginUiPhase = "loading" | "ready" | "offline";

export interface PluginUiState {
  readonly phase: PluginUiPhase;
  readonly entries: readonly ExtUiEntry[];
  /** 앱 정책 설정 값(`x.ui.*`). 프레임을 못 쓰는 기기에서는 `x.ui.apps`가 거짓으로 덮인다 */
  readonly settings: Readonly<Record<string, unknown>>;
  readonly groups: PlacementGroups;
}

export interface PluginUiRuntimeDeps {
  /** 연결이 있을 때만 `run`을 부른다. 없으면 오류 값이다 */
  readonly withConnection: <T>(
    run: (connection: HostConnection) => Promise<T>,
  ) => Promise<Result<T, unknown>>;
  /** Tauri `invoke`(운영) 또는 가짜(시험). 프레임을 못 쓰는 기기에서는 `undefined`이고 앱 root는 보내지 않는다 */
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
}

const EMPTY_SETTINGS: Readonly<Record<string, unknown>> = {};

function stateOf(
  phase: PluginUiPhase,
  entries: readonly ExtUiEntry[],
  settings: Readonly<Record<string, unknown>>,
): PluginUiState {
  return { phase, entries, settings, groups: groupPlacements(entries, settings) };
}

export function createPluginUiRuntime(deps: PluginUiRuntimeDeps): PluginUiRuntime {
  const listeners = new Set<() => void>();
  const ledger = createScreenLedger();
  let state: PluginUiState = stateOf("loading", [], EMPTY_SETTINGS);

  function set(next: PluginUiState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  function framesAllowed(entry: ExtUiEntry): boolean {
    return deps.framesSupported && appsAllowed(entry.trust, state.settings);
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

    async refresh(threadId) {
      const read = await deps.withConnection(async (connection) => {
        const list = await connection.request(
          "ext.ui.list",
          threadId === undefined ? {} : { threadId },
        );
        const got = await connection.request("settings.get", {
          keys: [UI_APPS_KEY, UI_ALLOW_PROJECT_APPS_KEY],
        });
        return { items: list.items, settings: got.settings };
      });
      if (!read.ok) {
        set(stateOf("offline", state.entries, state.settings));
        return;
      }
      const values: Record<string, unknown> = {};
      for (const row of read.value.settings) values[row.key] = row.value;
      // 이 기기가 프레임을 못 쓰면 정책 값과 상관없이 앱을 막는다
      const settings = deps.framesSupported ? values : { ...values, [UI_APPS_KEY]: false };
      set(stateOf("ready", read.value.items, settings));
      if (deps.appRootsInvoke !== undefined && deps.framesSupported) {
        // 거부 이유는 화면이 앱 root 없이 그리는 것으로 드러난다(프레임 주소가 404). 여기서는 던지지 않는다
        await syncAppRoots(deps.appRootsInvoke, read.value.items);
      }
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
