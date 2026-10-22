import { Bug } from "@xeon/contracts";
import type { PlatformModule } from "@xeon/ext-host";
import { OsPortKey } from "@xeon/contracts/services";
import { readOsRuntime, type OsRuntime } from "./runtime.ts";
import { createOsService, type PlatformOsConfig } from "./service.ts";

export type { PlatformOsConfig, OsServiceHandle, OsStartError } from "./service.ts";
export { createOsService, resolveOsDirs } from "./service.ts";
export type { OsRuntime } from "./runtime.ts";
export { readOsRuntime } from "./runtime.ts";
export { OS_SETTING_DEFS } from "./settings.ts";
export type { LogRedact, LogSink } from "./logger.ts";
export type { BundledPath, BundledSource } from "./binaries/resolve.ts";
export { createIdFactory, createLocalIdFactory } from "./ids.ts";
export { createJsonLinesLogger } from "./logger.ts";
export { systemClock } from "./time/clock.ts";
export { systemRandom } from "./time/random.ts";
export { systemScheduler, type SystemScheduler } from "./time/scheduler.ts";

/**
 * L0 등록 단위. 조립 루트가 ExtHost.registerPlatform으로 등록한다. 플랫폼 판별이나 디렉터리 준비가 실패하면
 * setup이 던지고 registerPlatform이 그대로 던진다(시작 실패, L0.os.spec §3.10).
 */
export function platformOsPlugin(
  config: PlatformOsConfig,
  runtime: OsRuntime = readOsRuntime(),
): PlatformModule {
  return {
    name: "platform-os",
    async setup(ctx) {
      const started = await createOsService(config, runtime);
      if (!started.ok) {
        throw new Bug(`platform-os failed to start: ${started.error.kind}`, {
          cause: started.error,
        });
      }
      ctx.providePort(OsPortKey, started.value.service);
      ctx.onDispose(() => started.value.dispose());
    },
  };
}
