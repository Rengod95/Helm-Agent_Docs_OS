import { detach, err, ok, type Clock, type Scheduler } from "@xeon/contracts";
import { WIRE_PROTOCOL_VERSION } from "@xeon/contracts/wire";
import { createOsService, readOsRuntime, type OsServiceHandle } from "@xeon/platform-os";
import {
  bindServiceSocket,
  createIdleMonitor,
  createRegistrationStore,
  createTokenGate,
  listenSocket,
  type ActivationLock,
  type IdleMonitor,
  type ServiceRegistration,
  type SocketListener,
} from "@xeon/platform-process";
import { AssembleError, ENGINE_VERSION } from "../assemble.ts";
import { hostLimitsOf } from "../assembly/settings-sources.ts";
import type { ServeAuth } from "../connection-types.ts";
import {
  closeHost,
  settingReaderOf,
  startHost,
  stopTurns,
  type HostExit,
  type RunningHost,
} from "../host-runtime.ts";
import type { AssembleOptions } from "../types.ts";
import { messageOf } from "../util.ts";
import { autoResumeThreads } from "./auto-resume.ts";
import { hostResourceDir } from "../state-paths.ts";
import { resolveServicePaths } from "./paths.ts";

// L4.host-service.spec §4.9 서비스 모드, SV-01·SV-02·SV-04·SV-05·SV-07. `xeon service run`/`xeon host --service`의 본체.
// 순서: 소켓 선점(이중 기동 방지) → 엔진 조립(mode "service") → 연결 허브에 리스너 연결 → 등록 파일 기록 → 유휴 감시.
// 종료 길은 셋이고 모두 같은 절차를 밟는다: 유휴 유예 경과, SIGTERM, wire `host.shutdown`.

export const SERVICE_STARTUP_GRACE_MS = 10_000;
/** `l0.process.service.idleGraceMs`의 기본값. 설정을 읽지 못할 때만 쓴다 */
const DEFAULT_IDLE_GRACE_MS = 60_000;

export interface ServiceOptions {
  readonly assemble?: Omit<AssembleOptions, "mode">;
  /** 서비스 파일 디렉터리. 없으면 L0.os의 `dirs.runtime`. 시험이 임시 디렉터리를 넘긴다 */
  readonly runtimeDir?: string;
  /** 기본 SERVICE_STARTUP_GRACE_MS */
  readonly startupGraceMs?: number;
  /** 기본은 설정 `l0.process.service.idleGraceMs`(60000). 시험이 짧은 값을 넘긴다(설정 범위 밖 값 허용) */
  readonly idleGraceMs?: number;
  /**
   * TCP로도 연다(원격 사용, M3-REQ-43). 등록 파일의 토큰이 필요하고 `host.hello`의 `auth.token`으로 검사한다.
   * 비루프백 주소도 토큰이 있으므로 열 수 있다. 기본은 열지 않는다
   */
  readonly tcp?: { readonly host: string; readonly port: number };
  /** 유휴 타이머의 시계. 없으면 L0.os의 시계. 시험이 수동 시계를 넘긴다 */
  readonly time?: { readonly clock: Clock; readonly scheduler: Scheduler };
  /** SIGTERM을 받으면 종료한다. 기본 true. 시험은 끈다 */
  readonly handleSignals?: boolean;
  /** 토큰용 난수. 기본 `crypto.getRandomValues` */
  readonly random?: (bytes: number) => Uint8Array;
}

export interface ServiceHandle {
  /** 지금 등록 파일에 적힌 내용(토큰을 돌리면 새 토큰) */
  readonly registration: ServiceRegistration;
  /** TCP로 열었으면 `host:port`(포트 0이면 고른 포트) */
  readonly tcpAddress: string | undefined;
  /** 종료 절차가 끝나면 이행한다 */
  readonly exited: Promise<HostExit>;
  /** 유휴 종료 예정 시각(epoch ms). 없으면 null */
  idleShutdownAt(): number | null;
  /** 지금 열려 있는 연결 수 */
  connections(): number;
  /** 종료 절차를 밟는다. 여러 번 불러도 한 번만 실행한다 */
  shutdown(reason: "signal" | "idle" | "stop"): Promise<void>;
  /** 새 TCP 토큰으로 바꾸고 등록 파일을 다시 쓴다. 이전 토큰은 즉시 무효이고 열린 연결은 그대로다 */
  rotateToken(): string;
}

export type ServiceStart =
  | { readonly started: true; readonly handle: ServiceHandle }
  /** 다른 서비스가 소켓을 쥐고 있다(SV-02). `service run`은 종료코드 0으로 끝난다 */
  | {
      readonly started: false;
      readonly reason: "in_use";
      readonly existing: ServiceRegistration | null;
    }
  /** 시작하지 못했다(경로, 소켓, 조립 실패). `service run`은 종료코드 1로 끝난다 */
  | { readonly started: false; readonly reason: "failed"; readonly message: string };

function failed(message: string): ServiceStart {
  return { started: false, reason: "failed", message };
}

function randomBytes(bytes: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(bytes));
}

function idleGraceOf(read: (key: string) => unknown): number {
  const value = read("l0.process.service.idleGraceMs");
  return typeof value === "number" ? value : DEFAULT_IDLE_GRACE_MS;
}

/** 활성화 잠금: L0.os의 파일 잠금을 기다리지 않고 시도한다. 얻지 못하면 다른 경합자가 처리 중이다 */
function activationLockOf(os: OsServiceHandle, lockPath: string): ActivationLock {
  return async (fn) => {
    const held = await os.fileLock.withLock(lockPath, fn, { timeoutMs: 0 });
    return held.ok ? ok(held.value) : err({ kind: "busy" });
  };
}

export async function startService(options: ServiceOptions = {}): Promise<ServiceStart> {
  const paths = resolveServicePaths(
    options.runtimeDir === undefined ? {} : { runtimeDir: options.runtimeDir },
  );
  if (!paths.ok) return failed(`service files cannot be placed: ${paths.error.kind}`);
  const registrationStore = createRegistrationStore({ path: paths.value.registrationPath });

  // 이 서비스 프로세스 자신의 L0.os: 시계·타이머와 파일 잠금. 엔진도 자기 L0.os를 만든다
  const osStarted = await createOsService(
    { resourceDir: hostResourceDir(), logSink: () => undefined, logRedact: (line) => line },
    readOsRuntime(),
  );
  if (!osStarted.ok) return failed(`os service failed: ${osStarted.error.kind}`);
  const os = osStarted.value;
  const time = options.time ?? {
    clock: os.service.time.clock,
    scheduler: os.service.time.scheduler,
  };

  // 1. 소켓 선점(SV-02)
  const bound = await bindServiceSocket({
    path: paths.value.socketPath,
    activationLock: activationLockOf(os, paths.value.activationLockPath),
  });
  if (!bound.ok) {
    await os.dispose();
    if (bound.error.kind === "in_use") {
      const existing = registrationStore.read();
      return { started: false, reason: "in_use", existing: existing.ok ? existing.value : null };
    }
    return failed(`the service socket cannot be opened: ${bound.error.kind}`);
  }
  const unix = bound.value;

  // 2. 엔진 조립
  const lifecycleSlot: { idle: IdleMonitor | undefined } = { idle: undefined };
  const stopRequested = Promise.withResolvers<"stop">();
  let running: RunningHost;
  try {
    running = await startHost(
      { ...options.assemble, mode: "service" },
      {
        stopRequested: () => {
          stopRequested.resolve("stop");
        },
        idleShutdownAt: () => lifecycleSlot.idle?.idleShutdownAt ?? null,
      },
    );
  } catch (caught) {
    await unix.close();
    await os.dispose();
    const message =
      caught instanceof AssembleError ? caught.message : `startup failed: ${messageOf(caught)}`;
    return failed(message);
  }
  const { engine, hub } = running;
  const read = settingReaderOf(engine);
  const log = engine.ports.log;
  const devChecks = options.assemble?.devChecks === true;
  const gate = createTokenGate(options.random ?? randomBytes);

  // 3. 연결 허브에 리스너를 잇는다. 소켓 위 연결은 TCP만 토큰이 필요하다
  const tcpAuth: ServeAuth = { requiresToken: true, verify: (presented) => gate.verify(presented) };
  const attach = (listener: SocketListener): void => {
    listener.onConnection((transport, peer) => {
      hub.serve(transport, {
        limits: hostLimitsOf(read),
        devChecks,
        ...(peer.requiresToken ? { auth: tcpAuth } : {}),
      });
    });
  };
  attach(unix);
  let tcp: SocketListener | undefined;
  if (options.tcp !== undefined) {
    const listened = await listenSocket({
      kind: "tcp",
      host: options.tcp.host,
      port: options.tcp.port,
      token: gate.current(),
    });
    if (!listened.ok) {
      await closeHost(running);
      await unix.close();
      await os.dispose();
      return failed(`the tcp listener cannot be opened: ${listened.error.kind}`);
    }
    tcp = listened.value;
    attach(tcp);
  }

  // 4. 등록 파일(SV-01)
  const registrationOf = (): ServiceRegistration => ({
    schemaVersion: 1,
    version: ENGINE_VERSION,
    protocolVersion: WIRE_PROTOCOL_VERSION,
    socket: unix.path,
    pid: process.pid,
    startedAt: engine.startedAt,
    token: gate.current(),
    storeId: engine.storeId,
    ...(tcp === undefined ? {} : { tcp: tcp.path }),
  });
  const registration = registrationOf();
  const written = registrationStore.write(registration);
  if (!written.ok) {
    await closeHost(running);
    await tcp?.close();
    await unix.close();
    await os.dispose();
    return failed(`the registration file cannot be written: ${written.error.kind}`);
  }

  // 5. 종료 절차. 참여자 등록은 엔진이 끝난 뒤 등록 역순으로 불린다(확장·L0 참여자보다 먼저 turn을 멈춘다)
  const turnStop: { outcome: "clean" | "deadline" } = { outcome: "clean" };
  engine.shutdown.onShutdown("host", async () => {
    turnStop.outcome = await stopTurns(running);
  });
  const exited = Promise.withResolvers<HostExit>();
  const closing: { promise: Promise<void> | undefined } = { promise: undefined };
  const signals: { off: () => void } = { off: () => undefined };

  function shutdown(reason: "signal" | "idle" | "stop"): Promise<void> {
    closing.promise ??= (async () => {
      lifecycleSlot.idle?.[Symbol.dispose]();
      const engineReason = reason === "stop" ? "shutdown_request" : reason;
      await engine.shutdown.request(engineReason);
      // 등록 파일과 소켓을 먼저 내려 새 클라이언트가 죽어 가는 서비스에 붙지 않게 한다
      const removed = registrationStore.removeIfOwned(registration.pid, registration.startedAt);
      if (!removed.ok)
        log.error("service.registration_remove_failed", { kind: removed.error.kind });
      await tcp?.close();
      await unix.close();
      await closeHost(running);
      signals.off();
      await os.dispose();
      exited.resolve(
        turnStop.outcome === "deadline"
          ? {
              code: 1,
              reason,
              message: "the running turn did not stop within the shutdown deadline",
            }
          : { code: 0, reason },
      );
    })();
    return closing.promise;
  }

  // 6. 유휴 감시(SV-04). 판정 입력이 바뀔 때마다 다시 계산한다
  const idle = createIdleMonitor({
    clock: time.clock,
    scheduler: time.scheduler,
    startupGraceMs: options.startupGraceMs ?? SERVICE_STARTUP_GRACE_MS,
    idleGraceMs: options.idleGraceMs ?? idleGraceOf(read),
  });
  lifecycleSlot.idle = idle;
  const recompute = (): void => {
    const activity = engine.ports.activity.snapshot();
    idle.update({
      connections: hub.size,
      // 승인 대기 세션은 live다(D-M3-13 행 2)
      liveTasks: activity.liveTasks + activity.waitingApprovals,
      pendingSchedules: activity.pendingSchedules,
    });
  };
  hub.onSizeChange(recompute);
  engine.ports.activity.onChange(recompute);
  idle.onIdle(() => {
    detach(shutdown("idle"), (caught) => {
      log.error("service.idle_shutdown_failed", { message: messageOf(caught) });
    });
  });
  recompute();

  // wire host.shutdown은 처리기가 협조 종료를 마쳤다. 나머지 정리를 이어서 한다
  detach(
    stopRequested.promise.then(() => shutdown("stop")),
    (caught) => {
      log.error("service.stop_failed", { message: messageOf(caught) });
    },
  );
  if (options.handleSignals !== false) {
    const onSignal = (): void => {
      detach(shutdown("signal"), (caught) => {
        log.error("service.signal_shutdown_failed", { message: messageOf(caught) });
      });
    };
    process.once("SIGTERM", onSignal);
    process.once("SIGINT", onSignal);
    signals.off = () => {
      process.off("SIGTERM", onSignal);
      process.off("SIGINT", onSignal);
    };
  }

  // 7. 자동 재개(기본 꺼짐, L1.persistence.spec §4.8.3). 서비스가 서로 연결을 받기 시작한 뒤 백그라운드로 한다
  if (read("l1.persistence.autoResume") === true) {
    detach(autoResumeThreads(engine, log), (caught) => {
      log.error("service.auto_resume_failed", { message: messageOf(caught) });
    });
  }

  const handle: ServiceHandle = {
    get registration() {
      return registrationOf();
    },
    tcpAddress: tcp?.path,
    exited: exited.promise,
    idleShutdownAt: () => idle.idleShutdownAt,
    connections: () => hub.size,
    shutdown,
    rotateToken() {
      const next = gate.rotate();
      const rewritten = registrationStore.write(registrationOf());
      if (!rewritten.ok)
        log.error("service.registration_rewrite_failed", { kind: rewritten.error.kind });
      return next;
    },
  };
  return { started: true, handle };
}
