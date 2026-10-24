// @xeon/cap-work 공개 진입점(L2.work). 조립 루트가 쓰는 이름만 내보낸다.
export { workPlugin, WORK_PRODUCER, type WorkPluginOptions } from "./plugin.ts";
export { workManifest, WORK_EXTENSION_NAME } from "./manifest.ts";
export {
  DEFAULT_WORK_SETTINGS,
  WORK_SETTING_DEFS,
  readWorkSettings,
  type JudgeErrorPolicy,
  type WorkSettings,
  type WorkSettingsSource,
} from "./settings.ts";
export { createTasksApi } from "./tasks/service.ts";
export type { WorkTasksDeps } from "./deps.ts";
export type { WorkReader, WorkSessionPort } from "./ports/session.ts";
export { createWorkProjector } from "./projection/projector.ts";
export {
  WORK_PROJECTOR_DDL,
  WORK_PROJECTOR_NAME,
  WORK_PROJECTOR_TABLES,
  WORK_PROJECTOR_VERSION,
} from "./projection/ddl.ts";
