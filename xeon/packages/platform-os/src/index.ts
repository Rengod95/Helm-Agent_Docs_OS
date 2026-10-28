import { err, ok } from "@xeon/contracts";
import type { PlatformModule } from "@xeon/ext-host";
import { OsPortKey } from "@xeon/contracts/services";
import { readOsRuntime, type OsRuntime } from "./runtime.ts";
import { createOsService, type PlatformOsConfig } from "./service.ts";

export type { PlatformOsConfig, OsServiceHandle, OsStartError } from "./service.ts";
export { createOsService, resolveOsDirs } from "./service.ts";
export {
  DEFAULT_FILE_LOCK_POLL_MS,
  DEFAULT_FILE_LOCK_TIMEOUT_MS,
  type FileLock,
  type FileLockError,
  type FileLockOptions,
  type FileLockScope,
} from "./file-lock/index.ts";
export {
  createNotify,
  createOsNotifierProvider,
  buildNotifyCommand,
  type NotifierProvider,
} from "./notify/provider.ts";
export { createFileWatcher, type FileWatcher, type WatchBackend } from "./watch/watcher.ts";
export { createFsWatchBackend } from "./watch/fs-watch.ts";
export {
  createWorktreeOps,
  type WorktreeCreateOptions,
  type WorktreeError,
  type WorktreeInfo,
  type WorktreeOps,
} from "./worktree.ts";
export { createRotatingFileSink, type RotatingFileSinkOptions } from "./log-file.ts";
export { createBoundedList, DEFAULT_DIAGNOSTICS_CAP, type BoundedList } from "./bounded.ts";
export { PRODUCT, productUserAgent } from "./product.ts";
export type { OsRuntime } from "./runtime.ts";
export { readOsRuntime } from "./runtime.ts";
export { OS_SETTING_DEFS } from "./settings.ts";
export type { LogLevelSource, LogRedact, LogSink } from "./logger.ts";
export {
  createNodeBinaryFs,
  type BinaryFs,
  type BundledPath,
  type BundledSource,
} from "./binaries/resolve.ts";
export {
  generateBinariesLock,
  type LockGenerateError,
  type LockInput,
  type LockReadFs,
} from "./binaries/lock.ts";
export {
  binaryRequirements,
  checkExternalBinaries,
  type BinaryCheckDeps,
  type BinaryCheckItem,
  type BinaryCheckReport,
  type BinaryCheckStatus,
  type BinaryNeed,
  type BinaryRequirement,
} from "./binaries/requirements.ts";
export { createRipgrepSource, type RipgrepSourceDeps } from "./binaries/rg.ts";
export { createIdFactory, createLocalIdFactory } from "./ids.ts";
export { createJsonLinesLogger } from "./logger.ts";
export { systemClock } from "./time/clock.ts";
export { systemRandom } from "./time/random.ts";
export { systemScheduler, type SystemScheduler } from "./time/scheduler.ts";

/**
 * L0 등록 단위. 조립 루트가 ExtHost.registerPlatform으로 등록한다. 플랫폼 판별이나 디렉터리 준비가 실패하면
 * setup이 err를 돌려주고 registerPlatform이 그 오류를 값으로 돌려준다(시작 실패, L0.os.spec §3.10).
 */
export function platformOsPlugin(
  config: PlatformOsConfig,
  runtime: OsRuntime = readOsRuntime(),
): PlatformModule {
  return {
    name: "platform-os",
    async setup(ctx) {
      const started = await createOsService(config, runtime);
      if (!started.ok) return err({ reason: started.error.kind, cause: started.error });
      ctx.providePort(OsPortKey, started.value.service);
      ctx.onDispose(() => started.value.dispose());
      return ok(undefined);
    },
  };
}
