import { homedir } from "node:os";
import {
  attemptAsync,
  err,
  ok,
  repeatAsync,
  type Clock,
  type Result,
  type Scheduler,
} from "@xeon/contracts";
import {
  ensureService,
  isProcessAlive,
  spawnDetachedService,
  type EnsureError,
  type EnsureOutcome,
  type ProbeError,
  type RegistrationStore,
  type ServiceProbe,
  type ServiceRegistration,
  type SocketError,
  createRegistrationStore,
} from "@xeon/platform-process";
import { WIRE_PROTOCOL_VERSION } from "@xeon/contracts/wire";
import { ENGINE_VERSION } from "../assemble.ts";
import { createHostConnection, connectServiceTransport, helloService } from "./connect.ts";
import { resolveServicePaths, type ServicePathError, type ServicePaths } from "./paths.ts";
import { systemTime } from "./time.ts";

// L4.host-service.spec §3.3.4 ensure.ts, SV-03·SV-06. `ensureService`(L0.process)의 의존을 호스트 계약(`host.hello`, `host.status`, `host.shutdown`)과
// 실제 프로세스 기동으로 채운다. 한가함은 `liveTurns == 0`이고 연결이 자기 하나뿐인 때다(승인 대기 turn은 liveTurns에 들어 있다 [가정]).

/** 서비스를 띄우는 전체 명령(`... service run`). 실행 파일 위치는 호출자가 안다(CLI 바이너리, 개발 진입) */
export interface ServiceCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export interface EnsureHostServiceOptions {
  readonly runtimeDir?: string;
  readonly start: ServiceCommand;
  readonly startTimeoutMs?: number;
  readonly retryMs?: number;
  /** 비교할 엔진 버전. 기본 이 호스트의 버전 */
  readonly ownVersion?: string;
  readonly time?: { readonly clock: Clock; readonly scheduler: Scheduler };
  /** 교체 종료를 기다리는 시한. 기본 `l0.process.shutdown.timeoutMs`(3000) + 2000 */
  readonly replaceWaitMs?: number;
}

export type EnsureHostServiceError =
  | EnsureError
  | { readonly kind: "paths"; readonly error: ServicePathError };

export interface EnsuredService {
  readonly outcome: EnsureOutcome;
  readonly paths: ServicePaths;
}

const DEFAULT_REPLACE_WAIT_MS = 5000;
const CLIENT_NAME = "xeon-ensure";

/** 소켓에 접속해 hello와 status를 한 번 왕복한다. 연결은 닫고 돌려준다 */
async function probeService(
  registration: ServiceRegistration,
): Promise<
  Result<
    ServiceProbe & { readonly pid: number; readonly startedAt: string },
    ProbeError | SocketError
  >
> {
  const transport = await connectServiceTransport({ kind: "unix", path: registration.socket });
  if (!transport.ok) return transport;
  const connection = createHostConnection(transport.value);
  try {
    const hello = await helloService(connection, { clientName: CLIENT_NAME });
    if (!hello.ok) {
      if (hello.error.kind === "auth_failed") return err({ kind: "auth_failed" });
      if (hello.error.kind === "protocol_unsupported") return err({ kind: "protocol_unsupported" });
      return err({ kind: "timeout" });
    }
    const status = await attemptAsync(() =>
      connection.request("host.status", {}, { timeoutMs: 3000 }),
    );
    if (!status.ok) return err({ kind: "timeout" });
    return ok({
      version: hello.value.server.version,
      protocolVersion: hello.value.protocolVersion,
      idle: status.value.liveTurns === 0 && status.value.connections <= 1,
      pid: status.value.pid,
      startedAt: status.value.startedAt,
    });
  } finally {
    await connection.close();
  }
}

function sleep(scheduler: Scheduler, ms: number): Promise<void> {
  return new Promise((resolve) => {
    scheduler.setTimeout(resolve, ms);
  });
}

/** 등록 파일이 사라지거나 소켓에 접속할 수 없을 때까지 기다린다. 시한 안에 내려갔으면 true */
export async function waitServiceGone(
  store: RegistrationStore,
  time: { readonly clock: Clock; readonly scheduler: Scheduler },
  waitMs: number,
): Promise<boolean> {
  const deadline = time.clock.now() + waitMs;
  return repeatAsync<boolean>(async () => {
    const read = store.read();
    if (!read.ok) return { value: true };
    const transport = await connectServiceTransport({ kind: "unix", path: read.value.socket });
    if (!transport.ok) return { value: true };
    await transport.value.close("probe");
    if (time.clock.now() >= deadline) return { value: false };
    await sleep(time.scheduler, 50);
    return undefined;
  });
}

/** `host.shutdown`을 보내 서비스를 협조 종료시킨다. 받아들여졌으면 true */
export async function requestServiceShutdown(
  registration: ServiceRegistration,
  reason: "version_replace" | "user",
): Promise<boolean> {
  const transport = await connectServiceTransport({ kind: "unix", path: registration.socket });
  if (!transport.ok) return false;
  const connection = createHostConnection(transport.value);
  try {
    const hello = await helloService(connection, { clientName: CLIENT_NAME });
    if (!hello.ok) return false;
    const sent = await attemptAsync(() =>
      connection.request("host.shutdown", { reason }, { timeoutMs: 10_000 }),
    );
    return sent.ok && sent.value.accepted;
  } finally {
    await connection.close();
  }
}

export async function ensureHostService(
  options: EnsureHostServiceOptions,
): Promise<Result<EnsuredService, EnsureHostServiceError>> {
  const paths = resolveServicePaths(
    options.runtimeDir === undefined ? {} : { runtimeDir: options.runtimeDir },
  );
  if (!paths.ok) return err({ kind: "paths", error: paths.error });
  const store = createRegistrationStore({ path: paths.value.registrationPath });
  const time = options.time ?? systemTime();
  const ensured = await ensureService(
    {
      registration: store,
      probe: (_socket, registration) => probeService(registration),
      async replace(registration) {
        const accepted = await requestServiceShutdown(registration, "version_replace");
        if (!accepted) return err({ kind: "replace_failed" });
        const gone = await waitServiceGone(
          store,
          time,
          options.replaceWaitMs ?? DEFAULT_REPLACE_WAIT_MS,
        );
        // 응답은 왔는데 시한 안에 내려가지 않았으면 프로세스가 남아 있는지 본다
        return gone || !isProcessAlive(registration.pid)
          ? ok(undefined)
          : err({ kind: "replace_failed" });
      },
      spawnService: () =>
        spawnDetachedService({
          command: options.start.command,
          args: options.start.args,
          // 서비스의 cwd는 홈 디렉터리다(opencode server-process.ts:60-64)
          cwd: homedir(),
        }),
      clock: time.clock,
      scheduler: time.scheduler,
      engineVersion: options.ownVersion ?? ENGINE_VERSION,
      protocolVersion: WIRE_PROTOCOL_VERSION,
    },
    {
      ...(options.startTimeoutMs === undefined ? {} : { startTimeoutMs: options.startTimeoutMs }),
      ...(options.retryMs === undefined ? {} : { retryMs: options.retryMs }),
    },
  );
  if (!ensured.ok) return ensured;
  return ok({ outcome: ensured.value, paths: paths.value });
}
