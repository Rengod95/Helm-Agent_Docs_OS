import { targetsStorageOf, type AttachFailureKind, type TargetEntry } from "@fresnel/client";
import { err, ok, type Result } from "@fresnel/contracts";
import {
  WIRE_ERRORS,
  type HostClientView,
  type HostConnection,
  type WireResult,
} from "@fresnel/contracts/wire";
import { LOCAL, type LocalSettings } from "../settings-store/index.ts";
import type { UiStore } from "../state/ui/index.ts";
import type { DesktopIpc, EngineTarget, IpcError } from "../transport/ipc.ts";
import type {
  AutostartError,
  CommandError,
  ConnectionCommands,
  ConnectionSnapshot,
  ConnectTarget,
  ServiceCard,
  TargetStoreError,
} from "../views/commands.ts";
import type { EngineSwitch } from "./engine-switch.ts";
import type { Session } from "./session.ts";

// 연결 화면(P-08)이 부르는 명령. 대상 목록은 로컬 설정 파일에서 읽고 쓰며(FS-03: 거울에 넣지 않는다), 엔진 대상 바꾸기는
// 셸 명령 `engine_retarget`이다. 진행은 엔진 상태와 연결 상태가 화면에 알리므로 여기서는 값만 돌려준다.

/** 서비스 모드 설정 키. 설정 화면과 예약 화면이 같은 키를 쓴다(app/schedule.ts) */
const SERVICE_ENABLED_KEY = "l0.process.service.enabled";
/** 원격 응답 허용 설정 키(L2.schedule §6). 엔진 카탈로그에 없으면 `settings.unknownKey`로 거절된다 */
const REMOTE_RESPOND_KEY = "l2.schedule.remote.allowRespond";
const UNKNOWN_KEY_CODE = WIRE_ERRORS["settings.unknownKey"].code;

const SCOPE = "user";

/** 셸 계약(`EngineTarget`)은 주소만 든다. 이름은 화면과 상태 표시줄이 쓰므로 셸 인자에 싣지 않는다 */
function engineTargetOf(target: ConnectTarget): EngineTarget {
  return target.kind === "local" ? { kind: "local" } : { kind: "remote", address: target.address };
}

/** `l4.desktop.engine.shutdownGraceMs` 기본값(settings-store/defs.ts, Rust 기본값과 같다) */
const DEFAULT_SHUTDOWN_GRACE_MS = 7000;

type Run = <T>(
  work: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

export interface ConnectionDeps {
  /** 대상 바꾸기는 쓰기 보류(W-08)를 거친다. ipc를 바로 부르지 않는다 */
  readonly engineSwitch: Pick<EngineSwitch, "retarget">;
  readonly local: Pick<LocalSettings, "load" | "get" | "set">;
  readonly session: Pick<Session, "reconnect" | "restartEngine">;
  readonly ui: Pick<UiStore, "actions">;
  readonly run: Run;
  /** 이 기기의 서비스 셸 명령(상태 읽기, 켜기, 끄기, 로그인 자동 시작 켜기·끄기) */
  readonly ipc: Pick<
    DesktopIpc,
    "serviceStatus" | "serviceEnsure" | "serviceStop" | "serviceAutostartSet"
  >;
  /** 엔진이 지금 붙은 대상의 종류(UI 스토어의 `engineTarget`). 이 기기일 때만 서비스 명령을 부른다 */
  readonly engineTargetKind: () => "local" | "remote";
}

/** 셸 오류를 화면이 아는 닫힌 코드로 줄인다. 셸이 준 코드 가운데 두 개만 살리고 나머지는 `unknown`이다(경로나 토큰을 싣지 않는다) */
function autostartErrorOf(error: IpcError): AutostartError {
  if (error.kind !== "command") return { code: "unknown" };
  if (error.code === "autostart_failed" || error.code === "bad-request") {
    return { code: error.code };
  }
  return { code: "unknown" };
}

export function createConnectionCommands(deps: ConnectionDeps): ConnectionCommands {
  const { engineSwitch, local, session, ui, run, ipc, engineTargetKind } = deps;

  /** 서비스 모드 설정을 사용자 범위에 쓴다. 적용은 호출하는 쪽이 정한다 */
  const writeServiceSetting = async (enabled: boolean): Promise<Result<null, CommandError>> => {
    const written = await run((c) =>
      c.request("settings.set", { key: SERVICE_ENABLED_KEY, value: enabled, scope: SCOPE }),
    );
    return written.ok ? ok(null) : written;
  };

  /**
   * 이 기기의 엔진을 다시 띄운다. 살아 있는 엔진도 확인으로 다시 띄운다(`confirmed`). 셸이 거절하면(엔진이 떠 있지 않으면)
   * 세션이 다시 잇는다. 새 엔진은 바뀐 서비스 설정으로 뜬다.
   */
  const restartLocalEngine = async (): Promise<void> => {
    const restarted = await session.restartEngine({ confirmed: true });
    if (!restarted) session.reconnect();
  };

  /** 이 기기 서비스를 켜고 엔진을 그 서비스에 붙인다. 켜지 못하면 설정을 꺼짐으로 되돌린다(화면이 실제 상태를 보이도록) */
  const enableLocalService = async (): Promise<Result<null, CommandError>> => {
    const ensured = await ipc.serviceEnsure();
    if (!ensured.ok) {
      await writeServiceSetting(false);
      return err({ kind: "failed" });
    }
    await restartLocalEngine();
    return ok(null);
  };

  /** 이 기기 서비스를 멈추고 엔진을 앱 안의 사이드카로 다시 띄운다. 멈추지 못하면 설정은 그대로 두고 오류를 준다 */
  const disableLocalService = async (): Promise<Result<null, CommandError>> => {
    const stopped = await ipc.serviceStop();
    if (!stopped.ok) return err({ kind: "failed" });
    await restartLocalEngine();
    return ok(null);
  };

  const setServiceMode = async (enabled: boolean): Promise<Result<null, CommandError>> => {
    const written = await writeServiceSetting(enabled);
    if (!written.ok) return written;
    // 원격 대상은 이 기기의 서비스와 상관없어 설정만 쓴다
    if (engineTargetKind() === "remote") return ok(null);
    return enabled ? enableLocalService() : disableLocalService();
  };

  /** 이 기기의 서비스 카드. 엔진 대상이 원격이면 읽지 않는다. 읽지 못하면 `unknown`이다(소켓 경로는 싣지 않는다) */
  const serviceCardOf = async (host: WireResult<"host.status">): Promise<ServiceCard> => {
    if (engineTargetKind() === "remote") return { kind: "unknown" };
    const status = await ipc.serviceStatus();
    if (!status.ok) return { kind: "unknown" };
    const reply = status.value;
    if (!reply.running) return { kind: "stopped", reason: reply.reason };
    return {
      kind: "running",
      pid: reply.pid,
      version: reply.version,
      startedAt: reply.startedAt,
      attached: host.mode === "service",
    };
  };

  return {
    async targets(): Promise<Result<readonly TargetEntry[], TargetStoreError>> {
      const loaded = await local.load();
      if (!loaded.ok) return err({ kind: "storage" });
      // 저장된 값은 항목마다 주소 형식과 루프백 규칙을 다시 검사한다(targetsStorageOf). 틀린 항목은 버린다
      return ok(targetsStorageOf(local.get(LOCAL.connectionTargets)));
    },
    async saveTargets(list): Promise<Result<null, TargetStoreError>> {
      const written = await local.set(LOCAL.connectionTargets, [...list]);
      return written.ok ? ok(null) : err({ kind: "storage" });
    },
    async retarget(target: ConnectTarget): Promise<Result<null, AttachFailureKind>> {
      // 지난 연결 실패는 이 시도의 결과가 아니므로 먼저 지운다. 그러지 않으면 새 엔진 상태가 낡은 오류와 맞물린다
      ui.actions.setConnectError(null);
      // 바꾸는 동안 쓰기는 옛 엔진으로 가지 않고 `switching`으로 거절된다. 대기 한도는 설정 파일의 값이고 없으면 기본값이다
      await local.load();
      const graceMs = local.get(LOCAL.shutdownGraceMs) ?? DEFAULT_SHUTDOWN_GRACE_MS;
      const done = await engineSwitch.retarget(engineTargetOf(target), graceMs);
      if (!done.ok) {
        // 셸 명령 오류나 바꾸는 중(`switching`)은 연결 실패 종류가 아니다. 엔진이 붙은 대상도 그대로 둔다
        return err("other");
      }
      // 바뀐 대상을 적는다. 상태 표시줄 첫 칸과 연결 화면이 이 값을 읽는다(앱을 다시 켜면 이 컴퓨터로 돌아간다)
      ui.actions.setEngineTarget(target);
      // 연결 루프가 실패로 멈춰 있으면 새 대상으로 다시 붙도록 깨운다. 연결 중이면 아무 일도 없다
      session.reconnect();
      return ok(null);
    },
    async retry(): Promise<void> {
      ui.actions.setConnectError(null);
      const restarted = await session.restartEngine();
      if (!restarted) session.reconnect();
    },
    async load(): Promise<Result<ConnectionSnapshot, CommandError>> {
      const host = await run((c) => c.request("host.status", {}));
      if (!host.ok) return host;
      const service = await serviceCardOf(host.value);
      const settings = await run((c) => c.request("settings.get", { keys: [SERVICE_ENABLED_KEY] }));
      if (!settings.ok) return settings;
      const setting = settings.value.settings.find((item) => item.key === SERVICE_ENABLED_KEY);
      // 켜 두었지만 엔진이 다시 시작해야 켜지는 중이면 예약 화면 띠와 같은 근거(`pendingUntil`)로 알린다
      const restartPending = setting?.pendingUntil === "restart";
      // 원격 응답 허용은 따로 읽는다. 엔진이 모르는 키 하나 때문에 `settings.get`이 통째로 거절되면 상태 카드 전체를 잃는다
      const remote = await run((c) => c.request("settings.get", { keys: [REMOTE_RESPOND_KEY] }));
      if (!remote.ok) {
        const unknown = remote.error.kind === "rejected" && remote.error.code === UNKNOWN_KEY_CODE;
        if (!unknown) return remote;
        return ok({
          host: host.value,
          service,
          restartPending,
          remoteAllowRespond: null,
        });
      }
      const allow = remote.value.settings.find((item) => item.key === REMOTE_RESPOND_KEY);
      const remoteAllowRespond = typeof allow?.value === "boolean" ? allow.value : null;
      return ok({
        host: host.value,
        service,
        restartPending,
        remoteAllowRespond,
      });
    },
    async clients(): Promise<Result<readonly HostClientView[], CommandError>> {
      // 목록은 상태 카드와 따로 읽는다. 이 읽기가 실패해도 `load`의 값은 그대로 쓴다(화면이 두 읽기를 따로 가진다)
      const listed = await run((c) => c.request("host.clients", {}));
      return listed.ok ? ok(listed.value.clients) : listed;
    },
    setServiceMode,
    startLocalService: () => setServiceMode(true),
    stopLocalService: () => setServiceMode(false),
    async serviceAutostart() {
      const status = await ipc.serviceStatus();
      return status.ok ? ok(status.value.autostart) : err(autostartErrorOf(status.error));
    },
    async setServiceAutostart(enabled) {
      const set = await ipc.serviceAutostartSet(enabled);
      return set.ok
        ? ok({ lingerAdvice: set.value.lingerAdvice })
        : err(autostartErrorOf(set.error));
    },
    async setRemoteRespond(enabled: boolean): Promise<Result<null, CommandError>> {
      const written = await run((c) =>
        c.request("settings.set", { key: REMOTE_RESPOND_KEY, value: enabled, scope: SCOPE }),
      );
      return written.ok ? ok(null) : written;
    },
    /** 원격 서비스를 협조 종료한다. 이 기기의 서비스는 `stopLocalService`다 */
    async stopService(): Promise<Result<boolean, CommandError>> {
      const done = await run((c) => c.request("host.shutdown", { reason: "user" }));
      return done.ok ? ok(done.value.accepted) : done;
    },
  };
}
