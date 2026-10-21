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
import type { ProcessServiceSettings } from "./settings.ts";

// L0.process.spec §3.1·§4.8, L0.process.plan PR-08. ProcessService를 조립하고 xeon.process 포트로 내놓는다.
// M1의 run·spawn은 타입을 맞춘 거부 구현이다(plan §1: 매니페스트 hooks가 M1에 없다, review.decisions-2 U-07).

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
}

/** ProcessService와, 조립 루트가 종료를 요청하고 레지스트리를 닫는 데 쓰는 소유자 쪽 객체 */
export interface ProcessServiceHandle {
  readonly service: ProcessService;
  readonly shutdown: ProcessShutdown;
  readonly background: BackgroundRegistryController;
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
  const service: ProcessService = {
    background,
    shutdown,
    run(_spec: HookRunSpec): Promise<HookRawRun> {
      return Promise.reject(
        new Bug("ProcessPort.run is not available before M2 (L0.process.plan PR-21)"),
      );
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
