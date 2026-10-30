import {
  isProcessAlive,
  type ServiceRegistration,
  createRegistrationStore,
} from "@xeon/platform-process";
import { createOsService, readOsRuntime } from "@xeon/platform-os";
import { hostResourceDir } from "../state-paths.ts";
import {
  ok,
  attemptAsync,
  repeatAsync,
  type Clock,
  type Result,
  type Scheduler,
} from "@xeon/contracts";
import type { WireResult } from "@xeon/contracts/wire";
import { connectServiceTransport, createHostConnection, helloService } from "./connect.ts";
import { requestServiceShutdown, waitServiceGone } from "./ensure.ts";
import { resolveServicePaths, type ServicePathError } from "./paths.ts";
import { systemTime } from "./time.ts";

// L4.host-service.spec §3.2 `xeon service status`·`stop`, SV-07. 엔진을 열지 않고 등록 파일과 소켓으로 서비스를 조회하고 내린다.

export interface ServiceControlOptions {
  readonly runtimeDir?: string;
  readonly time?: { readonly clock: Clock; readonly scheduler: Scheduler };
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
    };

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
    const hello = await helloService(connection, { clientName: "xeon-status" });
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
    return ok({ running: true, registration, status: status.value });
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
