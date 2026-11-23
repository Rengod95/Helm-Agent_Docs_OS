import { assertNever, err, ok, type Logger, type Result } from "@fresnel/contracts";
import type { HostConnection, Profile, WireResult } from "@fresnel/contracts/wire";
import {
  binaryViewOf,
  DEFAULT_MODEL_KEY,
  defaultModelOf,
  PROVIDERS_KEY,
  providersOf,
  readProviders,
  withProviderKey,
  type BinaryView,
  type KeyRegisterError,
  type SecretRow,
  type SetupSnapshot,
} from "@fresnel/client/settings";
import { toolsWebViewOf } from "@fresnel/client";
import { LOCAL, type LocalSettings } from "../settings-store/index.ts";
import type { DesktopIpc, SecretRegisterError } from "../transport/ipc.ts";
import type {
  CommandError,
  DefaultGroupId,
  GroupsSnapshot,
  HostNoticesSnapshot,
  SafeModeSnapshot,
  SearchSnapshot,
  SetupCommands,
} from "../views/commands.ts";
import { DEFAULT_PROFILE_ID } from "../views/convo/profile-chip-model.ts";

// 최소 설정 화면이 부르는 wire(G2-08). 모델 키는 값 없는 `secret.*`로만 다루고(L0.secrets.spec R4),
// provider 설정에는 `secret://<이름>` 참조만 쓴다. 값은 이 화면, wire, 로그 어디에도 없다.

/**
 * 점검 없이 다시 읽은 설정(`load({ binaries: false })`)에 앞서 읽은 외부 도구 점검 결과를 이어 붙인다.
 * 설정이 바뀌어도 설치된 도구는 그대로라 점검을 되풀이하지 않는다(점검은 자식 프로세스를 띄운다, HS-69).
 */
export function keepTools(fresh: SetupSnapshot, previous: SetupSnapshot): SetupSnapshot {
  return { ...fresh, binaries: previous.binaries, toolsReady: previous.toolsReady };
}

type Run = <T>(
  work: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

/** 셸의 오류를 화면이 아는 오류로 바꾼다. 셸 내부 사정(`detail`, 잘못된 요청)은 화면에 올리지 않는다 */
export function keyRegisterErrorOf(error: SecretRegisterError): KeyRegisterError {
  switch (error.kind) {
    case "unavailable":
    case "empty":
    case "too-large":
    case "busy":
    case "timeout":
    case "keystore":
      return { kind: error.kind };
    case "rejected":
      return { kind: "rejected", exitCode: error.exitCode, detail: error.detail, code: error.code };
    case "bad-request":
    case "unknown":
      return { kind: "failed" };
    default:
      return assertNever(error, "SecretRegisterError");
  }
}

/** 쓰기 범위는 사용자 설정 파일이다. 키 등록과 기본 모델은 대화마다 다르지 않다 */
const SCOPE = "user";

/**
 * 기본 그룹이 나타내는 플러그인 이름. 그룹을 켜고 끄는 것은 기본 프로필의 플러그인 목록에 이 이름을 넣고 빼는 일이다.
 * 사용자 설정 키는 쓰지 않는다(플러그인의 켜고 끄기는 프로필에서만 정한다). 첫 실행 화면만 쓴다
 */
const GROUP_PLUGIN: Readonly<Record<DefaultGroupId, string>> = {
  helm: "helm",
};

/** 기본 프로필. 저장된 것이 없어도 목록에 공장 값으로 든다(호스트가 더한다) */
function defaultProfileOf(list: WireResult<"profile.list">): Profile | undefined {
  return list.profiles.find((profile) => profile.id === DEFAULT_PROFILE_ID);
}

/** `host.status`의 안전 모드 칸을 화면 값으로 바꾼다. 칸이 없으면(구형 호스트) 거짓, null, 0이다 */
export function safeModeOf(status: WireResult<"host.status">): SafeModeSnapshot {
  return {
    active: status.safeMode === true,
    cause: status.safeModeCause ?? null,
    startupFailures: status.startupFailures ?? 0,
    suggest: status.suggestSafeMode === true,
  };
}

/**
 * `host.status`의 호스트 알림 칸을 화면 값으로 바꾼다. 문제 칸과 시작 알림 칸이 없으면(문제가 없거나 구형 호스트) 빈 목록이다
 */
export function hostNoticesOf(status: WireResult<"host.status">): HostNoticesSnapshot {
  return {
    settingsProblems: status.settingsProblems ?? [],
    startupNotices: status.startupNotices ?? [],
  };
}

/** 샌드박스 켜기 키(L0.sandbox.spec §6). 상태 줄의 "샌드박스 꺼짐" 칸이 읽는다 */
const SANDBOX_ENABLED_KEY = "l0.sandbox.enabled";

export function createSetupCommands(
  run: Run,
  onInvalidated: (listener: () => void) => () => void,
  onAnyInvalidated: (listener: () => void) => () => void,
  ipc: Pick<DesktopIpc, "registerSecret">,
  local: Pick<LocalSettings, "load" | "get" | "set">,
  logger: Pick<Logger, "warn">,
): SetupCommands {
  return {
    async load(options) {
      const settings = await run((c) =>
        c.request("settings.get", { keys: [DEFAULT_MODEL_KEY, PROVIDERS_KEY] }),
      );
      if (!settings.ok) return settings;
      const valueOf = (key: string): unknown =>
        settings.value.settings.find((s) => s.key === key)?.value;
      const secrets = await run((c) => c.request("secret.list", {}));
      const rows: readonly SecretRow[] | null = secrets.ok
        ? secrets.value.secrets.map((entry) => ({
            name: entry.name,
            registered: entry.status === "valid" || entry.status === "expiring",
          }))
        : null;
      // 외부 도구 점검은 바이너리마다 자식 프로세스를 띄우므로 요청한 쪽만 한다(HS-69). 읽지 못하거나 구형 호스트면 "받을 수 없음"이다
      let binaries: BinaryView | null = null;
      if (options.binaries) {
        const status = await run((c) => c.request("host.status", { includeBinaries: true }));
        binaries = status.ok ? binaryViewOf(status.value.binaries) : null;
      }
      // 호스트가 문제를 실은 기본 모델(카탈로그에 없는 id)은 고른 것으로 치지 않는다(HS-80). 그러면 "기본 모델 선택" 단계가 끝나지 않는다
      const modelProblem = settings.value.settings.find(
        (s) => s.key === DEFAULT_MODEL_KEY,
      )?.problem;
      const snapshot: SetupSnapshot = {
        providers: providersOf(valueOf(PROVIDERS_KEY)),
        defaultModel:
          modelProblem === undefined ? defaultModelOf(valueOf(DEFAULT_MODEL_KEY)) : null,
        secrets: rows,
        toolsReady: binaries === null ? null : binaries.ready,
        binaries,
      };
      return ok(snapshot);
    },
    async beginKeyEntry(name, action) {
      const begun = await run((c) => c.request("secret.beginEntry", { name, action }));
      return begun.ok ? ok(begun.value.started) : begun;
    },
    async registerKey(name, action, value) {
      const registered = await ipc.registerSecret(name, action, value);
      return registered.ok ? ok(null) : err(keyRegisterErrorOf(registered.error));
    },
    async connectProviderKey(providerId, secretName) {
      // 목록 전체를 한 키로 쓰므로(병합 단위는 키 하나) 현재 값을 읽어 원소만 바꾼 목록을 보낸다
      const current = await run((c) => c.request("settings.get", { keys: [PROVIDERS_KEY] }));
      if (!current.ok) return current;
      // 읽을 수 없는 목록 위에는 쓰지 않는다: 빈 목록으로 보고 쓰면 다른 provider와 baseUrl이 사라진다
      const stored = readProviders(current.value.settings[0]?.value);
      if (!stored.ok) {
        return err({
          kind: "rejected",
          code: null,
          detail: "the stored provider list cannot be read, so it was left as it is",
        });
      }
      const providers = withProviderKey(stored.value, providerId, secretName);
      const written = await run((c) =>
        c.request("settings.set", { key: PROVIDERS_KEY, value: providers, scope: SCOPE }),
      );
      return written.ok ? ok(null) : written;
    },
    async setDefaultModel(ref) {
      const written = await run((c) =>
        c.request("settings.set", { key: DEFAULT_MODEL_KEY, value: ref, scope: SCOPE }),
      );
      return written.ok ? ok(null) : written;
    },
    async loadGroups() {
      // 켜짐은 기본 프로필(공통 묶음 포함)의 플러그인 목록이 정한다. 목록에 없으면 설치되었는지 본다: 설치되지 않았으면
      // 값을 알 수 없는 것(null, 화면 기본값으로 그린다)이고, 설치되었으면 꺼진 것이다.
      const listed = await run((c) => c.request("profile.list", {}));
      if (!listed.ok) return listed;
      const list = listed.value;
      const groupOn = async (plugin: string): Promise<Result<boolean | null, CommandError>> => {
        const names = [...list.common.plugins, ...(defaultProfileOf(list)?.plugins ?? [])];
        if (names.some((ref) => ref.name === plugin)) return ok(true);
        const cards = await run((c) => c.request("plugin.list", {}));
        if (!cards.ok) return cards;
        return ok(cards.value.plugins.some((card) => card.name === plugin) ? false : null);
      };
      const helm = await groupOn(GROUP_PLUGIN.helm);
      if (!helm.ok) return helm;
      const status = await run((c) => c.request("host.status", {}));
      if (!status.ok) return status;
      const snapshot: GroupsSnapshot = {
        enabled: { helm: helm.value },
        safeMode: status.value.safeMode === true,
      };
      return ok(snapshot);
    },
    async loadSandboxEnabled() {
      const read = await run((c) => c.request("settings.get", { keys: [SANDBOX_ENABLED_KEY] }));
      if (!read.ok) return read;
      // 값을 쓴 적 없으면 기본(켬)이다. 거짓을 쓴 때만 꺼짐
      return ok(read.value.settings.find((s) => s.key === SANDBOX_ENABLED_KEY)?.value !== false);
    },
    async loadSafeMode() {
      const status = await run((c) => c.request("host.status", {}));
      if (!status.ok) {
        // 화면은 이 실패를 아무것도 그리지 않는 것으로 받는다(안전 모드 안내는 화면을 막지 않는 부가 정보다). 원인만 남긴다
        logger.warn("desktop.safeMode.read_failed", { reason: status.error.kind });
        return status;
      }
      return ok(safeModeOf(status.value));
    },
    async loadHostNotices() {
      const status = await run((c) => c.request("host.status", {}));
      if (!status.ok) {
        // 화면은 이 실패를 아무것도 그리지 않는 것으로 받는다(알림은 화면을 막지 않는 부가 정보다). 원인만 남긴다
        logger.warn("desktop.hostNotices.read_failed", { reason: status.error.kind });
        return status;
      }
      return ok(hostNoticesOf(status.value));
    },
    async setGroupEnabled(group, enabled) {
      // 기본 프로필을 다시 읽어 저장된 값(id, 제목, 설정, 시작 Drive, 개정)을 그대로 보낸다. 개정이 어긋나면 호스트가 거절하고 그 오류를 돌려준다
      const listed = await run((c) => c.request("profile.list", {}));
      if (!listed.ok) return listed;
      const profile = defaultProfileOf(listed.value);
      if (profile === undefined) return err({ kind: "failed" });
      const plugin = GROUP_PLUGIN[group];
      if (!enabled) {
        // 공통 묶음에서 온 것이거나 기본 프로필에 없는 것이면 호스트가 거절한다. 그 오류를 그대로 돌려준다
        const removed = await run((c) =>
          c.request("profile.removePlugin", { id: profile.id, plugin, baseRev: profile.rev }),
        );
        return removed.ok ? ok(null) : removed;
      }
      // 이미 든 것이면 다시 쓰지 않는다(중복 없이, 개정도 올리지 않는다)
      if (profile.plugins.some((ref) => ref.name === plugin)) return ok(null);
      const written = await run((c) =>
        c.request("profile.put", {
          profile: {
            id: profile.id,
            title: profile.title,
            plugins: [...profile.plugins, { name: plugin }],
            settings: profile.settings,
            startDrive: profile.startDrive,
          },
          baseRev: profile.rev,
        }),
      );
      return written.ok ? ok(null) : written;
    },
    async loadSearch() {
      const providers = await run((c) => c.request("web.providers", {}));
      if (!providers.ok) return providers;
      // 로컬 설정은 읽은 뒤에 본다. 읽지 못하면 "나중에" 값을 모르므로 실패로 돌린다
      const loaded = await local.load();
      if (!loaded.ok) return err({ kind: "failed" });
      const snapshot: SearchSnapshot = {
        web: toolsWebViewOf(providers.value),
        dismissed: local.get(LOCAL.searchHintDismissed) === true,
      };
      return ok(snapshot);
    },
    async dismissSearchHint() {
      const written = await local.set(LOCAL.searchHintDismissed, true);
      return written.ok ? ok(null) : err({ kind: "failed" });
    },
    onInvalidated,
    onAnyInvalidated,
  };
}
