// @xeon/core-loop 공개 진입점. L1.loop.spec §8.1 제공 목록.
export { createLoopService, type LoopServiceDeps, type LoopServiceHandle } from "./service.ts";
export {
  DEFAULT_BASE_PROMPT,
  LOOP_EXTENSION_NAME,
  LOOP_MANIFEST,
  loopExtensionUnit,
  type LoopPluginOptions,
} from "./plugin.ts";
export {
  DEFAULT_LOOP_SETTINGS,
  LOOP_MAX_STEPS_DEFAULT,
  LOOP_SETTING_DEFS,
  type LoopSettingsSource,
} from "./settings.ts";
export {
  createAgentEventMapper,
  type BoundAgentEventMapper,
  type MapperOptions,
} from "./event-mapper.ts";
export { finalizeBoundary, type BoundaryCheckContext, type BoundaryVerdict } from "./checkpoint.ts";
export { LoopRejection, RunFailure, type RunFailureCode } from "./errors.ts";
export type { HostMode, LoopContext, LoopDeps, LoopExtHost } from "./types.ts";
