import {
  isProcessAlive,
  stopProcess,
  type ServiceRegistration,
  createRegistrationStore,
} from "@xeon/platform-process";
import { ok, attemptAsync, type Clock, type Result, type Scheduler } from "@xeon/contracts";
import type { WireResult } from "@xeon/contracts/wire";
import { connectServiceTransport, createHostConnection, helloService } from "./connect.ts";
import { requestServiceShutdown, waitServiceGone } from "./ensure.ts";
import { resolveServicePaths, type ServicePathError } from "./paths.ts";
import { systemTime } from "./time.ts";

// L4.host-service.spec §3.2 `xeon service status`·`stop`, SV-07. 엔진을 열지 않고 등록 파일과 소켓으로 서비스를 조회하고 내린다.

export interface ServiceControlOptions {
  readonly runtimeDir?: string;
  readonly time?: { readonly clock: Clock; readonly scheduler: Scheduler };
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
    // 등록 파일의 pid·시작 시각 지문과 같은 서비스인지 확인한다(pid 재사용 오인 방지)
    if (status.value.pid !== registration.pid) return ok({ running: false, reason: "unreachable" });
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
  if (!status.value.running) {
    // 등록은 남았는데 접속할 수 없고 프로세스도 없으면 낡은 기록이다. 정리는 다음 기동이 한다
    return ok({ kind: "not_running" });
  }
  const { registration } = status.value;
  const accepted = await requestServiceShutdown(registration, "user");
  if (accepted && (await waitServiceGone(store, time, timeoutMs + 1000)))
    return ok({ kind: "stopped" });
  if (!isProcessAlive(registration.pid)) return ok({ kind: "stopped" });
  const outcome = await stopProcess(
    {
      kill: (pid, signal) => {
        process.kill(pid, signal);
      },
      alive: isProcessAlive,
      clock: time.clock,
      scheduler: time.scheduler,
    },
    registration.pid,
    { termWaitMs: timeoutMs, killWaitMs: timeoutMs },
  );
  if (outcome === "terminated" || outcome === "killed") return ok({ kind: "signalled", outcome });
  if (outcome === "already_gone") return ok({ kind: "stopped" });
  return ok({ kind: "failed", message: "the service did not exit after SIGKILL" });
}
