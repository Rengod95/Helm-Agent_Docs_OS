// @xeon/core-tasks 공개 진입점. 서비스 인터페이스와 타입은 @xeon/contracts/services에 있다(FR-T5).
export { createTasksEntry, TASKS_MANIFEST, type TasksPluginDeps } from "./plugin.ts";
export { createLayeredTasksSettings, tasksSettings } from "./settings.ts";
export {
  createStaticTasksSettings,
  type StaticTasksSettings,
  type TasksSettingsSource,
} from "./settings-source.ts";
