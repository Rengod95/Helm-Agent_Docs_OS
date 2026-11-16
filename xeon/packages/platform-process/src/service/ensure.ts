import { err, ok, repeatAsync, type Clock, type Result, type Scheduler } from "@fresnel/contracts";
import type { SocketError } from "../transport/socket.ts";
import type { ServiceRegistration, RegistrationStore } from "./registration.ts";
import type { SpawnServiceError } from "./spawn.ts";

// L0.process.spec §3.2 service/ensure.ts, §4.4.2. 클라이언트가 서비스를 찾거나 기동하는 절차.
// 이 함수는 접속을 돌려주지 않는다. probe가 쓴 연결은 닫고(`host.hello`는 연결마다 한 번이라 다시 쓸 수 없다),
// 호출자가 등록 정보의 소켓으로 새로 접속한다. 두 번째 `ensure`는 이미 떠 있는 서비스를 보고 `started: false`로 붙는다.

export interface ServiceProbe {
  readonly version: string;
  readonly protocolVersion: string;
  /** 서비스의 엔진 빌드 식별자. 옛 서비스는 모른다(없음). `deps.engineBuild`가 있으면 이 값과 같아야 같은 빌드다 */
  readonly build?: string | undefined;
  /** liveTasks 0, pendingSchedules 0. 연결은 자기 자신이 있어 세지 않는다 */
  readonly idle: boolean;
}

export type ProbeError =
  | { readonly kind: "auth_failed" }
  | { readonly kind: "timeout" }
  | { readonly kind: "protocol_unsupported" };

export interface EnsureDeps {
  readonly registration: RegistrationStore;
  /** 소켓에 접속해 `host.hello`·`host.status`를 한 번 왕복하고 연결을 닫는다 */
  readonly probe: (
    socket: string,
    registration: ServiceRegistration,
  ) => Promise<Result<ServiceProbe, ProbeError | SocketError>>;
  /** 한가한 구버전 서비스를 `host.shutdown`(reason `version_replace`)으로 내리고 종료를 기다린다 */
  readonly replace: (
    registration: ServiceRegistration,
  ) => Promise<Result<void, { readonly kind: "replace_failed" }>>;
  /** detached + unref로 `service run`을 띄운다(L4가 명령 배열을 준다) */
  readonly spawnService: () => Result<{ readonly pid: number }, SpawnServiceError>;
  readonly clock: Clock;
  /** 재시도 간격과 시한 */
  readonly scheduler: Scheduler;
  readonly engineVersion: string;
  /** 이 클라이언트의 엔진 빌드 식별자. 있으면 서비스의 `build`와 다를 때(필드가 없는 옛 서비스 포함) 다른 서비스로 본다 */
  readonly engineBuild?: string | undefined;
  /** 호스트 계약 버전. 주 버전이 다르면 접속하지 않는다 */
  readonly protocolVersion: string;
}

export interface EnsureOptions {
  /** 기본 10000(`l0.process.service.startTimeoutMs`) */
  readonly startTimeoutMs?: number;
  /** 재시도 간격. 기본 200 */
  readonly retryMs?: number;
}

export type EnsureOutcome =
  | {
      readonly kind: "connected";
      readonly registration: ServiceRegistration;
      readonly started: boolean;
      /** 다른 빌드·버전의 한가한 서비스를 내리고 새로 띄웠다 */
      readonly replaced: boolean;
    }
  /** 작업 중인 다른 버전 서비스. 경고하고 그대로 접속한다 */
  | { readonly kind: "version_mismatch_busy"; readonly registration: ServiceRegistration };

export type EnsureError =
  | { readonly kind: "start_timeout"; readonly waitedMs: number }
  | { readonly kind: "protocol_unsupported"; readonly serviceVersion: string }
  | { readonly kind: "auth_failed" }
  /** 한가한 다른 주 버전 서비스를 내리지 못했다 */
  | { readonly kind: "replace_failed" }
  | { readonly kind: "insecure_registration"; readonly mode: number }
  | { readonly kind: "spawn_failed"; readonly code: string };

export const DEFAULT_START_TIMEOUT_MS = 10_000;
export const DEFAULT_ENSURE_RETRY_MS = 200;

function majorOf(version: string): string {
  return version.split(".")[0] ?? version;
}

type Attempt =
  | { readonly kind: "done"; readonly outcome: Result<EnsureOutcome, EnsureError> }
  /** 서비스가 없거나 내려갔다. 새로 띄워야 한다 */
  | { readonly kind: "absent"; readonly replaced: boolean };

/** 같은 서비스인가: 버전이 같고, 빌드를 비교하는 쪽이면 빌드도 같아야 한다. 빌드를 모르는 옛 서비스는 다르다 */
function sameEngine(deps: EnsureDeps, probe: ServiceProbe): boolean {
  if (probe.version !== deps.engineVersion) return false;
  return deps.engineBuild === undefined || probe.build === deps.engineBuild;
}

async function attemptOnce(
  deps: EnsureDeps,
  started: boolean,
  replacedBefore: boolean,
): Promise<Attempt> {
  const read = deps.registration.read();
  if (!read.ok) {
    // 모드가 열린 파일은 토큰이 새었을 수 있어 접속하지 않는다. 서비스는 다음 기동 때 0600으로 다시 쓴다(spec §5)
    if (read.error.kind === "insecure_mode") {
      return {
        kind: "done",
        outcome: err({ kind: "insecure_registration", mode: read.error.mode }),
      };
    }
    return { kind: "absent", replaced: replacedBefore };
  }
  const registration = read.value;
  const probed = await deps.probe(registration.socket, registration);
  if (!probed.ok) {
    if (probed.error.kind === "auth_failed") {
      return { kind: "done", outcome: err({ kind: "auth_failed" }) };
    }
    if (probed.error.kind === "protocol_unsupported") {
      return {
        kind: "done",
        outcome: err({ kind: "protocol_unsupported", serviceVersion: registration.version }),
      };
    }
    // refused, not_found, timeout 등은 낡은 등록이거나 아직 뜨는 중이다
    return { kind: "absent", replaced: replacedBefore };
  }
  const probe = probed.value;
  if (majorOf(probe.protocolVersion) !== majorOf(deps.protocolVersion)) {
    if (!probe.idle) {
      return {
        kind: "done",
        outcome: err({ kind: "protocol_unsupported", serviceVersion: probe.version }),
      };
    }
    const replaced = await deps.replace(registration);
    return replaced.ok
      ? { kind: "absent", replaced: true }
      : { kind: "done", outcome: err({ kind: "replace_failed" }) };
  }
  if (!sameEngine(deps, probe)) {
    if (!probe.idle) {
      return { kind: "done", outcome: ok({ kind: "version_mismatch_busy", registration }) };
    }
    const replaced = await deps.replace(registration);
    if (replaced.ok) return { kind: "absent", replaced: true };
    return { kind: "done", outcome: ok({ kind: "version_mismatch_busy", registration }) };
  }
  return {
    kind: "done",
    outcome: ok({ kind: "connected", registration, started, replaced: replacedBefore }),
  };
}

function sleep(scheduler: Scheduler, ms: number): Promise<void> {
  return new Promise((resolve) => {
    scheduler.setTimeout(resolve, ms);
  });
}

export async function ensureService(
  deps: EnsureDeps,
  options: EnsureOptions = {},
): Promise<Result<EnsureOutcome, EnsureError>> {
  const timeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  const retryMs = options.retryMs ?? DEFAULT_ENSURE_RETRY_MS;
  const first = await attemptOnce(deps, false, false);
  if (first.kind === "done") return first.outcome;

  const spawned = deps.spawnService();
  if (!spawned.ok) return err({ kind: "spawn_failed", code: spawned.error.code });
  const startedAt = deps.clock.now();
  let replacedAny = first.replaced;
  return repeatAsync<Result<EnsureOutcome, EnsureError>>(async () => {
    await sleep(deps.scheduler, retryMs);
    const next = await attemptOnce(deps, true, replacedAny);
    if (next.kind === "done") return { value: next.outcome };
    replacedAny = next.replaced;
    const waitedMs = deps.clock.now() - startedAt;
    return waitedMs >= timeoutMs ? { value: err({ kind: "start_timeout", waitedMs }) } : undefined;
  });
}
