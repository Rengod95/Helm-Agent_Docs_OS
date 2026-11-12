import {
  lastTargetOf,
  sshTargetOfAddress,
  parseTargetAddress,
  targetsStorageOf,
  type AttachFailureKind,
  type TargetEntry,
} from "@fresnel/client";
import { err, ok, type Clock, type Result, type Scheduler } from "@fresnel/contracts";
import {
  WIRE_ERRORS,
  type HostClientView,
  type HostConnection,
  type WireResult,
} from "@fresnel/contracts/wire";
import { LOCAL, type LocalSettings } from "../settings-store/index.ts";
import type { EngineMirror, ReadonlyStore } from "../state/engine/index.ts";
import { watch } from "../state/shared/index.ts";
import type { UiStore } from "../state/ui/index.ts";
import type {
  DesktopIpc,
  EngineTarget,
  IpcError,
  PreflightOutcome,
  RemoteTestOutcome,
  SshHostsReply,
} from "../transport/ipc.ts";
import type {
  AutostartError,
  CommandError,
  ConnectionCommands,
  ConnectionSnapshot,
  ConnectTarget,
  FingerprintError,
  PairFailure,
  RestoreTargetOutcome,
  ServiceAlive,
  ServiceCard,
  SwitchImpact,
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

/** 앱을 켤 때 마지막 대상으로 `running`이 되기를 기다리는 시한(ms). 넘기면 이 컴퓨터로 돌아온다(L4.remote.spec §3.3) */
const RESTORE_TIMEOUT_MS = 30_000;

type Run = <T>(
  work: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

export interface ConnectionDeps {
  /** 대상 바꾸기는 쓰기 보류(W-08)를 거친다. ipc를 바로 부르지 않는다 */
  readonly engineSwitch: Pick<EngineSwitch, "retarget">;
  readonly local: Pick<LocalSettings, "load" | "get" | "set">;
  readonly session: Pick<Session, "reconnect" | "restartEngine" | "engineVersion">;
  readonly ui: Pick<UiStore, "actions" | "read">;
  readonly run: Run;
  /** 이 기기의 서비스 셸 명령(상태 읽기, 켜기, 끄기, 로그인 자동 시작 켜기·끄기)과 원격 붙기 명령 */
  readonly ipc: Pick<
    DesktopIpc,
    | "serviceStatus"
    | "serviceEnsure"
    | "serviceStop"
    | "serviceAutostartSet"
    | "sshHosts"
    | "sshPreflight"
    | "remoteTest"
    | "remoteFingerprint"
    | "remotePair"
    | "sshServiceAlive"
  >;
  /** 엔진이 지금 붙은 대상의 종류(UI 스토어의 `engineTarget`). 이 기기일 때만 서비스 명령을 부른다 */
  readonly engineTargetKind: () => "local" | "remote";
  /** 엔진 상태 거울. 다시 붙기가 `running`이 되는지 본다 */
  readonly engine: ReadonlyStore<EngineMirror>;
  /** 다시 붙기의 시한과 감시 해제 시한에 쓴다 */
  readonly scheduler: Pick<Scheduler, "setTimeout" | "clearTimeout">;
  /** 본 원격 상태의 시각. 없으면 벽시계다 */
  readonly clock?: Clock;
  /** 대상 기억 저장처럼 밖으로 드러나야 하는 실패를 기록한다(TY-25). 저장 실패가 대상 바꾸기를 실패시키지는 않는다 */
  readonly report: (cause: unknown) => void;
}

/** 대상 주소의 호스트 이름(알림 문장의 이름으로 쓴다). 소켓 경로만 있는 `unix:` 주소는 주소 그대로다 */
function hostLabelOf(address: string): string {
  const parsed = parseTargetAddress(address);
  if (!parsed.ok || parsed.target.kind === "unix") return address;
  return parsed.target.host;
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
  const {
    engineSwitch,
    local,
    session,
    ui,
    run,
    ipc,
    engineTargetKind,
    engine,
    scheduler,
    report,
  } = deps;
  const clock: Clock = deps.clock ?? { now: () => Date.now() };

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

  /** 로컬 설정 파일을 읽는다. 읽지 못하면 기록하고 값 없이 간다(저장된 값을 모르면 이 컴퓨터로 본다) */
  const loadLocal = async (): Promise<void> => {
    const loaded = await local.load();
    if (!loaded.ok) report(loaded.error);
  };

  /**
   * 엔진 대상을 바꾼다. 성공하면 바뀐 대상을 화면에 적고, `remember`이면 로컬 설정에도 적어 앱을 다시 켤 때 그 대상으로 붙게 한다.
   * 저장이 실패해도 바꾸기는 성공이다. 저장 실패는 `report`로 남긴다.
   */
  const switchTo = async (
    target: ConnectTarget,
    remember: boolean,
  ): Promise<Result<null, AttachFailureKind>> => {
    // 지난 연결 실패는 이 시도의 결과가 아니므로 먼저 지운다. 그러지 않으면 새 엔진 상태가 낡은 오류와 맞물린다
    ui.actions.setConnectError(null);
    // 바꾸는 동안 쓰기는 옛 엔진으로 가지 않고 `switching`으로 거절된다. 대기 한도는 설정 파일의 값이고 없으면 기본값이다
    await loadLocal();
    const graceMs = local.get(LOCAL.shutdownGraceMs) ?? DEFAULT_SHUTDOWN_GRACE_MS;
    const done = await engineSwitch.retarget(engineTargetOf(target), graceMs);
    if (!done.ok) {
      // 셸 명령 오류나 바꾸는 중(`switching`)은 연결 실패 종류가 아니다. 엔진이 붙은 대상도 그대로 둔다
      return err("other");
    }
    // 바뀐 대상을 적는다. 상태 표시줄 첫 칸과 연결 화면이 이 값을 읽는다
    ui.actions.setEngineTarget(target);
    if (remember) {
      const saved = await local.set(
        LOCAL.lastTarget,
        target.kind === "local" ? "" : target.address,
      );
      if (!saved.ok) report(saved.error);
    }
    // 연결 루프가 실패로 멈춰 있으면 새 대상으로 다시 붙도록 깨운다. 연결 중이면 아무 일도 없다
    session.reconnect();
    return ok(null);
  };

  /** 대상의 이름. 대상 목록에 같은 주소가 있으면 그 이름이고, 없으면 주소의 호스트 이름이다 */
  const nameOf = (address: string): string => {
    const listed = targetsStorageOf(local.get(LOCAL.connectionTargets));
    const found = listed.find((item) => item.address === address);
    return found?.label ?? hostLabelOf(address);
  };

  /**
   * 엔진이 `running`이 될 때까지 기다린다. 기다리기 전에 엔진이 이미 `running`이었으면, 한 번 내려간 뒤에 다시 `running`이
   * 돼야 새 엔진으로 본다(옛 엔진의 `running`을 성공으로 잡지 않는다). `failed`나 `stopped`가 먼저 오면 거짓이다.
   * 시한이 지나도 거짓이다. 결과가 정해지면 감시와 시한을 푼다.
   */
  const awaitRunning = (): {
    readonly done: Promise<boolean>;
    readonly finish: (up: boolean) => void;
  } => {
    const settled = Promise.withResolvers<boolean>();
    let sawDown = engine.getState().engine?.kind !== "running";
    let decided = false;
    let unwatch: (() => void) | null = null;
    let timer: ReturnType<Scheduler["setTimeout"]> | null = null;
    const finish = (up: boolean): void => {
      if (decided) return;
      decided = true;
      if (timer !== null) scheduler.clearTimeout(timer);
      unwatch?.();
      settled.resolve(up);
    };
    unwatch = watch(
      engine,
      (mirror) => mirror.engine?.kind ?? null,
      (kind) => {
        if (kind === null) return;
        if (kind === "running") {
          if (sawDown) finish(true);
          return;
        }
        if (kind === "failed" || kind === "stopped") {
          finish(false);
          return;
        }
        sawDown = true;
      },
      report,
    );
    timer = scheduler.setTimeout(() => finish(false), RESTORE_TIMEOUT_MS);
    return { done: settled.promise, finish };
  };

  /** 엔진 대상을 바꾸는 보류(`engineSwitching`)가 풀릴 때까지 기다린다. 보류는 제한 시간이 있어 반드시 풀린다 */
  const untilSwitchSettled = (): Promise<void> => {
    if (!ui.read.getState().engineSwitching) return Promise.resolve();
    const settled = Promise.withResolvers<void>();
    const unwatch = watch(
      ui.read,
      (state) => state.engineSwitching,
      (switching) => {
        if (switching) return;
        unwatch();
        settled.resolve();
      },
      report,
    );
    return settled.promise;
  };

  /**
   * 마지막 대상으로 붙지 못했을 때 이 컴퓨터로 돌아온다. 저장된 마지막 대상은 지우지 않는다(다음에 앱을 켤 때 다시 시도한다).
   * 돌아오지 못하면 알림을 남기지 않고 기록한다.
   */
  const fallBack = async (name: string): Promise<"fellBack"> => {
    // 시작 실패 뒤에도 보류가 남아 있으면 이 컴퓨터로 가는 바꾸기가 `switching`으로 거절된다. 보류가 풀린 뒤에 바꾼다
    await untilSwitchSettled();
    const back = await switchTo({ kind: "local" }, false);
    if (back.ok) {
      ui.actions.setTargetNotice({ kind: "fellBack", name });
    } else {
      report(back.error);
    }
    return "fellBack";
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
    retarget(target: ConnectTarget): Promise<Result<null, AttachFailureKind>> {
      return switchTo(target, true);
    },
    async restoreLastTarget(): Promise<RestoreTargetOutcome> {
      await loadLocal();
      const last = lastTargetOf(local.get(LOCAL.lastTarget));
      if (last === null) return "none";
      const name = nameOf(last.address);
      // 감시는 바꾸기 호출 전에 건다. 호출이 돌아오기 전에 엔진 상태가 바뀔 수 있다
      const waiting = awaitRunning();
      const switched = await switchTo(
        { kind: "remote", address: last.address, label: name },
        false,
      );
      if (!switched.ok) waiting.finish(false);
      if (await waiting.done) return "restored";
      return fallBack(name);
    },
    async retry(): Promise<void> {
      ui.actions.setConnectError(null);
      const restarted = await session.restartEngine();
      if (!restarted) session.reconnect();
    },
    async load(): Promise<Result<ConnectionSnapshot, CommandError>> {
      const host = await run((c) => c.request("host.status", {}));
      if (!host.ok) return host;
      // 원격 대상이면 지금 본 상태를 적는다(끊겼을 때 "마지막으로 본 상태"로 쓴다). 이 기기일 때는 적지 않는다
      if (engineTargetKind() === "remote") {
        ui.actions.setLastRemoteSeen({
          at: clock.now(),
          version: session.engineVersion(),
          liveTurns: host.value.liveTurns,
        });
      }
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
    async sshHosts(): Promise<Result<SshHostsReply, CommandError>> {
      const read = await ipc.sshHosts();
      return read.ok ? ok(read.value) : err({ kind: "failed" });
    },
    async preflight(input, onEvent): Promise<Result<PreflightOutcome, CommandError>> {
      const outcome = await ipc.sshPreflight(input, onEvent);
      return outcome.ok ? ok(outcome.value) : err({ kind: "failed" });
    },
    async testTarget(address): Promise<Result<RemoteTestOutcome, CommandError>> {
      const tested = await ipc.remoteTest(address);
      return tested.ok ? ok(tested.value) : err({ kind: "failed" });
    },
    async fingerprintOf(host, port): Promise<Result<string, FingerprintError>> {
      const read = await ipc.remoteFingerprint(host, port);
      if (!read.ok) return err({ kind: "failed" });
      const reply = read.value;
      return reply.ok ? ok(reply.fingerprint) : err({ kind: "probe", code: reply.code });
    },
    async pair(input): Promise<Result<{ readonly deviceName: string }, PairFailure>> {
      const paired = await ipc.remotePair(input);
      if (!paired.ok) return err({ kind: "failed" });
      const reply = paired.value;
      if (reply.ok) return ok({ deviceName: reply.deviceName });
      return err({
        kind: "server",
        code: reply.code,
        retryAfterSeconds: reply.retryAfterSeconds ?? null,
      });
    },
    async serviceAlive(address): Promise<ServiceAlive> {
      // 원격 서비스 살아 있음은 ssh 주소에만 있다. 서비스를 띄우지 않고 상태만 읽는다
      const target = sshTargetOfAddress(address);
      if (target === null) return { alive: null, version: null, code: null };
      const read = await ipc.sshServiceAlive(target);
      if (!read.ok) return { alive: null, version: null, code: null };
      return {
        alive: read.value.alive,
        version: read.value.version ?? null,
        code: read.value.code,
      };
    },
    async switchImpact(): Promise<Result<SwitchImpact, CommandError>> {
      const host = await run((c) => c.request("host.status", {}));
      if (!host.ok) return host;
      return ok({
        liveTurns: host.value.liveTurns,
        waitingApprovals: host.value.waitingApprovals ?? 0,
        keepsRunning: host.value.mode === "service",
      });
    },
    dismissTargetNotice(): void {
      ui.actions.setTargetNotice(null);
    },
    async lastTarget(): Promise<string | null> {
      await loadLocal();
      return lastTargetOf(local.get(LOCAL.lastTarget))?.address ?? null;
    },
  };
}
