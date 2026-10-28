import { detach, err, ok, type Logger } from "@xeon/contracts";
import type { PortKey } from "@xeon/contracts/extensions";
import {
  ExecPortKey,
  OsPortKey,
  SandboxServiceName,
  SecretServiceName,
  type SandboxService,
  type SecretService,
} from "@xeon/contracts/services";
import type { PlatformModule } from "@xeon/ext-host";
import {
  createOsService,
  type OsRuntime,
  type OsServiceHandle,
  type PlatformOsConfig,
} from "@xeon/platform-os";
import {
  createSandboxService,
  type SandboxServiceHandle,
  type SandboxSettings,
} from "@xeon/platform-sandbox";
import type { SecretServiceRuntime } from "@xeon/platform-secrets";

// L0 패키지 가운데 조립 루트가 직접 등록 단위를 만드는 것들(platform-os, platform-secrets, platform-sandbox). 서비스 팩토리는 각 패키지가
// 내놓고, ExtHost.registerPlatform에 올리는 모듈은 조립 루트가 만든다(L0.secrets.plan SC-12, L0.sandbox.spec 둘 다 그렇게 적었다).

const SECRETS_KEY: PortKey<SecretService> = { name: SecretServiceName };
const SANDBOX_KEY: PortKey<SandboxService> = { name: SandboxServiceName };

/**
 * `xeon.os`를 올리고 핸들(`fileLock`, `checkBinaries`)을 `onHandle`로 넘긴다. `platformOsPlugin`은 서비스만 포트로 내놓아서
 * F `OsService`에 없는 두 멤버를 조립 루트가 쥘 수 없다(L0.os.spec §3.6.1, §3.11). 시작 실패는 값으로 돌려준다(L0.os.spec §3.10)
 */
export function osPlatform(
  config: PlatformOsConfig,
  runtime: OsRuntime,
  onHandle: (handle: OsServiceHandle) => void,
): PlatformModule {
  return {
    name: "platform-os",
    async setup(ctx) {
      const started = await createOsService(config, runtime);
      if (!started.ok) return err({ reason: started.error.kind, cause: started.error });
      ctx.providePort(OsPortKey, started.value.service);
      ctx.onDispose(() => started.value.dispose());
      onHandle(started.value);
      return ok(undefined);
    },
  };
}

export function secretsPlatform(runtime: SecretServiceRuntime): PlatformModule {
  return {
    name: "platform-secrets",
    setup(ctx) {
      ctx.providePort(SECRETS_KEY, runtime);
      ctx.onDispose(() => {
        runtime[Symbol.dispose]();
      });
    },
  };
}

/** 샌드박스 서비스 팩토리. 시험이 대역을 넣는다 */
export type SandboxFactory = typeof createSandboxService;

/** 시작할 때 자가 시험이 끝난 보고를 한 줄로 남긴다 */
function logFirstReport(
  handle: SandboxServiceHandle,
  logger: Logger,
  shell: Parameters<SandboxServiceHandle["startSelfTests"]>[0],
): void {
  const schedule = handle.startSelfTests(shell);
  detach(
    schedule.first.then((result) => {
      if (!result.ok) return undefined;
      const report = result.value;
      const failed = report.items.filter((item) => !item.passed).map((item) => item.id);
      if (report.passed) {
        logger.info("sandbox.self_test", { passed: true, durationMs: report.durationMs });
      } else {
        logger.warn("sandbox.self_test", { passed: false, failed, durationMs: report.durationMs });
      }
      return undefined;
    }),
    (caught) => {
      logger.error("sandbox.self_test_log_failed", {
        error: caught instanceof Error ? caught.name : typeof caught,
      });
    },
  );
}

/**
 * xeon.os, xeon.secrets, xeon.exec가 먼저 등록되어 있어야 한다. 시작 때 상태 탐지와 srt 초기화를 한 번 하고(L0.sandbox.spec §4.1),
 * 자가 시험(`startSelfTests`)을 조립 루트에서 한 번 시작한다: 시작 직후 한 번 돌고 `l0.sandbox.selfTestIntervalMin`분마다 반복한다.
 * 시작을 막지 않는다. 서비스 dispose가 반복을 멈춘다(L0.sandbox.spec §4.7)
 */
export function sandboxPlatform(
  settings: () => SandboxSettings,
  signal: AbortSignal,
  create: SandboxFactory = createSandboxService,
): PlatformModule {
  return {
    name: "platform-sandbox",
    async setup(ctx) {
      const os = ctx.port(OsPortKey);
      const handle = await create({ os, secrets: ctx.port(SECRETS_KEY), settings }, signal);
      ctx.providePort(SANDBOX_KEY, handle);
      logFirstReport(handle, os.logger("sandbox"), ctx.port(ExecPortKey));
      ctx.onDispose(() => handle.dispose());
    },
  };
}
