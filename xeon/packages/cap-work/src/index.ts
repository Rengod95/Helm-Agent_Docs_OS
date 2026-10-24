// @xeon/cap-work 공개 진입점(L2.work). 조립 루트가 쓰는 이름만 내보낸다.
export { workPlugin, WORK_PRODUCER, type WorkPluginOptions } from "./plugin.ts";
export { registerWorkCommands, WORK_COMMAND_ORIGIN, type WorkCommandDeps } from "./commands.ts";
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
export { createPlans, type PlansRuntime } from "./plans/service.ts";
export { startPlanModeListener, type PlanModeListener } from "./plans/listener.ts";
export { planRefOf, PLAN_REF_PATTERN } from "./plans/refs.ts";
export {
  approvalRequestId,
  nextModesFor,
  PLAN_ANSWER_JSON_SCHEMA,
  planSubject,
  type PlanApprovalsFactory,
} from "./ports/approvals.ts";
export type { ArtifactFailure, PlanArtifactInput, PlanArtifactsPort } from "./ports/artifacts.ts";
export {
  toolsPermissionMode,
  type ModeFailure,
  type PermissionModePort,
} from "./ports/permission-mode.ts";
export type { WorkPlansDeps, WorkTasksDeps } from "./deps.ts";
export type { WorkReader, WorkSessionPort } from "./ports/session.ts";
export { createWorkProjector } from "./projection/projector.ts";
export {
  WORK_PROJECTOR_DDL,
  WORK_PROJECTOR_NAME,
  WORK_PROJECTOR_TABLES,
  WORK_PROJECTOR_VERSION,
} from "./projection/ddl.ts";
