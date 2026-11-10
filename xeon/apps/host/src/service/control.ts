import {
  isProcessAlive,
  type ServiceRegistration,
  createRegistrationStore,
} from "@fresnel/platform-process";
import { createOsService, readOsRuntime } from "@fresnel/platform-os";
import { hostResourceDir } from "../state-paths.ts";
import {
  ok,
  attemptAsync,
  repeatAsync,
  type Clock,
  type Result,
  type Scheduler,
} from "@fresnel/contracts";
import { WireError, type WireResult } from "@fresnel/contracts/wire";
import { connectServiceTransport, createHostConnection, helloService } from "./connect.ts";
import { requestServiceShutdown, waitServiceGone } from "./ensure.ts";
import { resolveServicePaths, type ServicePathError } from "./paths.ts";
import { systemTime } from "./time.ts";
import type { AutostartDeps, AutostartStatus } from "./autostart.ts";

// L4.host-service.spec §3.2 `fresnel service status`·`stop`, SV-07. 엔진을 열지 않고 등록 파일과 소켓으로 서비스를 조회하고 내린다.

export interface ServiceControlOptions {
  readonly runtimeDir?: string;
  readonly time?: { readonly clock: Clock; readonly scheduler: Scheduler };
  /**
   * 로그인 자동 시작(`service install|uninstall`, `status`의 `autostart`)이 쓰는 기기 접근. 기본은 실제 기기(launchd, systemd)다. 시험은 가짜를 넣는다
   */
  readonly autostart?: AutostartDeps;
  /**
   * pid의 프로세스 시작 시각 지문(L0.os `processStartFingerprint`). 없거나 모르면 null이다. 기본은 L0.os 구현.
   * 등록 파일의 `startedAt`과 같을 때만 그 pid를 같은 서비스로 본다(pid 재사용 방지)
   */
  readonly fingerprint?: (pid: number) => number | null;
}

/** 기본 지문 읽기: L0.os 서비스를 한 번 만들어 읽고 닫는다 */
async function defaultFingerprint(pid: number): Promise<number | null> {
  const started = await createOsService(
    { resourceDir: hostResourceDir(), logSink: () => undefined, logRedact: (line) => line },
    readOsRuntime(),
  );
  if (!started.ok) return null;
  try {
    const read = started.value.service.processStartFingerprint(pid);
    return read.ok ? read.value : null;
  } finally {
    await started.value.dispose();
  }
}

/** pid가 등록 파일의 서비스인가: 살아 있고 시작 시각 지문이 `startedAt`과 같다. 확인할 수 없으면 거짓이다 */
async function sameProcess(
  options: ServiceControlOptions,
  registration: ServiceRegistration,
): Promise<boolean> {
  if (!isProcessAlive(registration.pid)) return false;
  const print =
    options.fingerprint === undefined
      ? await defaultFingerprint(registration.pid)
      : options.fingerprint(registration.pid);
  return print !== null && print === registration.startedAt;
}

export type ServiceStatusResult =
  | {
      readonly running: false;
      readonly reason: "no_registration" | "unreachable" | "insecure_registration";
    }
  | {
      readonly running: true;
      readonly registration: ServiceRegistration;
      readonly status: WireResult<"host.status">;
      /** `host.remote.status`의 답. 서비스가 답하지 못하면(이전 버전 등) null */
      readonly remote: WireResult<"host.remote.status"> | null;
    };

/**
 * 화면과 `--json`에 내보내는 모양. 등록 파일의 접속 토큰은 뺀다(호스트 접속 권한이라 출력하지 않는다).
 * `autostart`는 서비스가 떠 있는지와 상관없이 더한다(등록 파일과 OS 등록 상태다)
 */
export function serviceStatusView(
  result: ServiceStatusResult,
  autostart: AutostartStatus,
): unknown {
  if (!result.running) return { ...result, autostart };
  const { token: _token, ...registration } = result.registration;
  return {
    running: true,
    registration,
    status: result.status,
    remote: result.remote,
    autostart,
  };
}

export async function serviceStatus(
  options: ServiceControlOptions = {},
): Promise<Result<ServiceStatusResult, ServicePathError>> {
  const paths = resolveServicePaths(
    options.runtimeDir === undefined ? {} : { runtimeDir: options.runtimeDir },
  );
  if (!paths.ok) return paths;
  const store = createRegistrationStore({ path: paths.value.registrationPath });
  const read = store.read();
  if (!read.ok) {
    return ok({
      running: false,
      reason: read.error.kind === "insecure_mode" ? "insecure_registration" : "no_registration",
    });
  }
  const registration = read.value;
  const transport = await connectServiceTransport({ kind: "unix", path: registration.socket });
  if (!transport.ok) return ok({ running: false, reason: "unreachable" });
  const connection = createHostConnection(transport.value);
  try {
    const hello = await helloService(connection, { clientName: "fresnel-status" });
    if (!hello.ok) return ok({ running: false, reason: "unreachable" });
    const status = await attemptAsync(() =>
      connection.request("host.status", {}, { timeoutMs: 3000 }),
    );
    if (!status.ok) return ok({ running: false, reason: "unreachable" });
    // 등록 파일의 pid·시작 시각과 같은 서비스인지 확인한다(pid 재사용 오인 방지)
    if (
      status.value.pid !== registration.pid ||
      new Date(status.value.startedAt).getTime() !== registration.startedAt
    ) {
      return ok({ running: false, reason: "unreachable" });
    }
    // 원격 상태는 서비스 상태 다음에 묻는다. 답이 없으면(이전 버전 서비스) null이다
    const remote = await attemptAsync(() =>
      connection.request("host.remote.status", {}, { timeoutMs: 3000 }),
    );
    return ok({
      running: true,
      registration,
      status: status.value,
      remote: remote.ok ? remote.value : null,
    });
  } finally {
    await connection.close();
  }
}

/** `service pair`의 결과. `paired`만 코드를 싣는다 */
export type ServicePairResult =
  | { readonly kind: "paired"; readonly code: string; readonly expiresAt: number }
  /** 서비스가 떠 있지 않다(등록이 없거나 접속하지 못한다) */
  | { readonly kind: "not_running" }
  /** 게이트웨이를 띄울 수 없는 환경 문제(바이너리 없음, 환경 오류). 사용자 환경을 고쳐야 한다 */
  | { readonly kind: "environment"; readonly message: string }
  /** 원격 접속이 꺼져 있다(`remote.off`) */
  | { readonly kind: "remote_off" }
  /** 그 밖의 실패. `message`는 사람이 읽는 한 줄이다 */
  | { readonly kind: "failed"; readonly message: string };

const PAIR_TIMEOUT_MS = 10_000;
const OLDER_SERVICE_MESSAGE =
  'the running service does not support remote access; run "fresnel service stop" and start it again';

/** 게이트웨이가 환경 문제로 멈췄는지(`RemoteStatusView.error.kind`). 이 값은 종료코드 2의 근거다 */
function isEnvironmentKind(kind: string): boolean {
  return kind === "gateway-binary-missing" || kind === "gateway-environment";
}

/** `host.remote.pair` 실패를 결과로 옮긴다. `remote.off`는 꺼짐이고, 메서드가 없으면 이전 버전 서비스다 */
function pairFailureOf(cause: unknown): ServicePairResult {
  if (cause instanceof WireError) {
    if (cause.data.kind === "remote.off") return { kind: "remote_off" };
    if (cause.data.kind === "jsonrpc.methodNotFound") {
      return { kind: "failed", message: OLDER_SERVICE_MESSAGE };
    }
    return { kind: "failed", message: `pairing failed (${cause.data.kind})` };
  }
  return { kind: "failed", message: "pairing failed (the service did not answer)" };
}

/**
 * 페어링 코드를 청한다(L4.remote §8.3). 먼저 원격 상태를 보고 환경 문제와 시작 중인 상태를 가려낸다.
 * 꺼져 있으면 서비스가 `remote.off`로 답하고, 그 값을 `remote_off`로 옮긴다. 코드는 결과에만 싣는다(로그에 쓰지 않는다).
 */
export async function servicePair(
  options: ServiceControlOptions = {},
): Promise<Result<ServicePairResult, ServicePathError>> {
  const status = await serviceStatus(options);
  if (!status.ok) return status;
  if (!status.value.running) return ok({ kind: "not_running" });
  const { registration, remote } = status.value;
  if (remote === null) return ok({ kind: "failed", message: OLDER_SERVICE_MESSAGE });
  if (remote.state === "failed") {
    const error = remote.error;
    if (error !== null && isEnvironmentKind(error.kind)) {
      return ok({ kind: "environment", message: error.message });
    }
    const reason = error === null ? "" : ` (${error.kind})`;
    return ok({
      kind: "failed",
      message: `remote access failed${reason}; restart the service to try again`,
    });
  }
  if (remote.state === "starting") {
    return ok({ kind: "failed", message: "remote access is still starting; try again shortly" });
  }
  const transport = await connectServiceTransport({ kind: "unix", path: registration.socket });
  if (!transport.ok) return ok({ kind: "not_running" });
  const connection = createHostConnection(transport.value);
  try {
    const hello = await helloService(connection, { clientName: "fresnel-pair" });
    if (!hello.ok) return ok({ kind: "not_running" });
    const paired = await attemptAsync(() =>
      connection.request("host.remote.pair", {}, { timeoutMs: PAIR_TIMEOUT_MS }),
    );
    if (!paired.ok) return ok(pairFailureOf(paired.error.cause));
    return ok({ kind: "paired", code: paired.value.code, expiresAt: paired.value.expiresAt });
  } finally {
    await connection.close();
  }
}

export type ServiceStopResult =
  | { readonly kind: "not_running" }
  /** `host.shutdown`으로 협조 종료했다 */
  | { readonly kind: "stopped" }
  /** 시한 안에 내려가지 않아 신호로 끝냈다 */
  | { readonly kind: "signalled"; readonly outcome: "terminated" | "killed" }
  | { readonly kind: "failed"; readonly message: string };

/**
 * 서비스를 정지한다(adr.0006 §3.7 7번): `host.shutdown`을 보내고 시한 안에 등록 파일이 사라지기를 기다린다. 남아 있으면 SIGTERM, 다시 기다려도
 * 남으면 SIGKILL이다. SIGKILL 뒤 남은 등록 파일과 소켓 파일은 다음 `ensure`가 낡은 기록으로 처리한다.
 */
export async function stopHostService(
  options: ServiceControlOptions & { readonly shutdownTimeoutMs?: number } = {},
): Promise<Result<ServiceStopResult, ServicePathError>> {
  const status = await serviceStatus(options);
  if (!status.ok) return status;
  const paths = resolveServicePaths(
    options.runtimeDir === undefined ? {} : { runtimeDir: options.runtimeDir },
  );
  if (!paths.ok) return paths;
  const store = createRegistrationStore({ path: paths.value.registrationPath });
  const time = options.time ?? systemTime();
  const timeoutMs = options.shutdownTimeoutMs ?? 3000;
  const registered = store.read();
  if (!registered.ok) return ok({ kind: "not_running" });
  const registration = registered.value;
  if (!status.value.running) {
    // 등록은 있는데 hello·status에 답하지 않는다. 같은 프로세스가 살아 있으면(멈춘 서비스) 신호로 끝낸다.
    // 프로세스가 없거나 지문이 다르면(pid 재사용) 낡은 기록이다. 아무것도 죽이지 않는다
    if (!(await sameProcess(options, registration))) return ok({ kind: "not_running" });
  } else {
    const accepted = await requestServiceShutdown(registration, "user");
    if (accepted && (await waitServiceGone(store, time, timeoutMs + 1000, registration))) {
      return ok({ kind: "stopped" });
    }
  }
  // 신호를 보내기 직전마다 같은 프로세스인지 다시 확인한다. 확인하지 못하면 보내지 않는다
  const send = async (signal: "SIGTERM" | "SIGKILL"): Promise<boolean> => {
    if (!(await sameProcess(options, registration))) return false;
    process.kill(registration.pid, signal);
    return true;
  };
  const exited = (ms: number): Promise<boolean> => {
    const deadline = time.clock.now() + ms;
    return repeatAsync<boolean>(async () => {
      if (!isProcessAlive(registration.pid)) return { value: true };
      if (time.clock.now() >= deadline) return { value: false };
      await new Promise<void>((resolve) => {
        time.scheduler.setTimeout(resolve, 50);
      });
      return undefined;
    });
  };
  if (!(await send("SIGTERM"))) return ok({ kind: "not_running" });
  if (await exited(timeoutMs)) return ok({ kind: "signalled", outcome: "terminated" });
  if (!(await send("SIGKILL"))) return ok({ kind: "signalled", outcome: "terminated" });
  if (await exited(timeoutMs)) return ok({ kind: "signalled", outcome: "killed" });
  return ok({ kind: "failed", message: "the service did not exit after SIGKILL" });
}
