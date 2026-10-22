import { Bug, type Clock, type Logger, type Scheduler } from "@xeon/contracts";
import type { LocalIdFactory } from "@xeon/contracts/conversation";
import {
  ProcessPortKey,
  type HookRawRun,
  type HookRunSpec,
  type IsolatedChild,
  type IsolationSpawnSpec,
  type PortKey,
  type ProcessPort,
} from "@xeon/contracts/extensions";
import { OsServiceName, type OsService, type ProcessService } from "@xeon/contracts/services";
import { createProcessShutdown, type ProcessShutdown } from "./lease/shutdown.ts";
import { createBackgroundRegistry, type BackgroundRegistryController } from "./registry.ts";
import { createHookRunner } from "./port/hook-run.ts";
import { detectProcessPlatform, type ProcessPlatformProvider } from "./select.ts";
import type { ProcessServiceSettings } from "./settings.ts";

// L0.process.spec §3.1·§4.8, L0.process.plan PR-08. ProcessService를 조립하고 xeon.process 포트로 내놓는다.
// run(외부 훅, PR-21)은 M2에서 구현했다. spawn(격리 확장 자식, PR-22)은 2차라 거부 구현이다(spec §4.8 spawn 4번).

export interface ProcessServiceDeps {
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  /** "bgp_<ULID>" 발급 */
  readonly ids: LocalIdFactory;
  readonly logger: Logger;
  readonly settings: ProcessServiceSettings;
  /** 종료 시한 초과 때 exit(1)로 부른다 */
  readonly exit: (code: number) => never;
  /** 조립 루트가 직접 쥐고 request를 부르려면 미리 만들어 넘긴다. 없으면 settings로 만든다 */
  readonly shutdown?: ProcessShutdown;
  /**
   * 외부 훅의 프로세스 트리 종료 수단. 생략하면 실행 중인 OS에서 고른다(select.ts).
   * `null`이면 지원하지 않는 OS로 보고 모든 훅 실행이 spawnError `unsupported_platform`이다.
   */
  readonly platform?: ProcessPlatformProvider | null;
}

/** ProcessService와, 조립 루트가 종료를 요청하고 레지스트리를 닫는 데 쓰는 소유자 쪽 객체 */
export interface ProcessServiceHandle {
  readonly service: ProcessService;
  readonly shutdown: ProcessShutdown;
  readonly background: BackgroundRegistryController;
}

function selectedPlatform(logger: Logger): ProcessPlatformProvider | null {
  const selected = detectProcessPlatform(logger);
  if (selected.ok) return selected.value;
  logger.warn("process.os_unsupported", { platform: selected.error.platform });
  return null;
}

export function createProcessService(deps: ProcessServiceDeps): ProcessServiceHandle {
  const shutdown =
    deps.shutdown ??
    createProcessShutdown({
      timeoutMs: deps.settings.shutdownTimeoutMs,
      clock: deps.clock,
      scheduler: deps.scheduler,
      exit: deps.exit,
      logger: deps.logger,
    });
  const background = createBackgroundRegistry({
    clock: deps.clock,
    scheduler: deps.scheduler,
    ids: deps.ids,
    logger: deps.logger,
  });
  // 종료 협조 때 레지스트리의 모든 항목을 병렬로 정지한다(spec §4.3)
  shutdown.onShutdown("background-registry", async () => {
    await background.close();
  });
  const platform = deps.platform === undefined ? selectedPlatform(deps.logger) : deps.platform;
  const hooks = createHookRunner({
    platform: platform ?? undefined,
    scheduler: deps.scheduler,
    graceMs: deps.settings.shutdownTimeoutMs,
    shutdownSignal: shutdown.signal,
    logger: deps.logger,
  });
  // 종료 협조가 시작되면 실행 중인 훅은 shutdown.signal로 이미 중단 요청을 받았다. 끝나기를 기다린다(spec §4.8 run 5번)
  shutdown.onShutdown("hook-runs", async () => {
    await hooks.drain();
  });
  const service: ProcessService = {
    background,
    shutdown,
    run(spec: HookRunSpec): Promise<HookRawRun> {
      return hooks.run(spec);
    },
    spawn(_spec: IsolationSpawnSpec): Promise<IsolatedChild> {
      return Promise.reject(
        new Bug("ProcessPort.spawn is not available in the first release (isolation_unavailable)"),
      );
    },
  };
  return { service, shutdown, background };
}

// ── Cordis 플랫폼 모듈 ───────────────────────────────────────────────────

/** 이 패키지가 xeon.os에서 쓰는 부분: 시계·타이머와 구성요소 로거 */
export type ProcessOsPort = Pick<OsService, "time" | "logger">;

/**
 * ext-host `PlatformContext`(X.primitives.spec §3.2)의 이 패키지가 쓰는 부분. ext-host가 이름을 내보내기 전까지 구조로만 맞춘다.
 * 실제 `PlatformContext`의 제네릭 `providePort<Api>`·`port<Api>`는 아래 두 메서드에 대입할 수 있다.
 * ext-host가 `PlatformModule`·`PlatformContext`를 내보내면 이 둘을 그 타입으로 바꾼다.
 */
export interface ProcessPlatformContext {
  /** xeon.process 포트 제공 */
  providePort(key: PortKey<ProcessPort>, impl: ProcessPort): void;
  /** 먼저 등록된 xeon.os 조회. 없으면 던진다 */
  port(key: PortKey<ProcessOsPort>): ProcessOsPort;
  /** 호스트 dispose 때 역순으로 실행한다 */
  onDispose(fn: () => void | Promise<void>): void;
}

export interface ProcessPlatformModule {
  readonly name: "platform-process";
  setup(ctx: ProcessPlatformContext): void;
}

export interface ProcessPluginOptions {
  readonly ids: LocalIdFactory;
  readonly settings: ProcessServiceSettings;
  readonly exit: (code: number) => never;
  /** 조립 루트가 종료를 직접 요청하려면 미리 만들어 넘긴다 */
  readonly shutdown?: ProcessShutdown;
}

const OS_PORT_KEY: PortKey<ProcessOsPort> = { name: OsServiceName };

/** `xeon.os`가 먼저 등록되어 있어야 한다. 시계·타이머·로거를 거기서 받는다 */
export function processPlugin(options: ProcessPluginOptions): ProcessPlatformModule {
  return {
    name: "platform-process",
    setup(ctx) {
      const os = ctx.port(OS_PORT_KEY);
      const handle = createProcessService({
        clock: os.time.clock,
        scheduler: os.time.scheduler,
        ids: options.ids,
        logger: os.logger("platform-process"),
        settings: options.settings,
        exit: options.exit,
        ...(options.shutdown === undefined ? {} : { shutdown: options.shutdown }),
      });
      ctx.providePort(ProcessPortKey, handle.service);
      ctx.onDispose(async () => {
        await handle.background.close();
      });
    },
  };
}
