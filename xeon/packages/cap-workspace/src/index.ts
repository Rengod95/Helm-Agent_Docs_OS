// @xeon/cap-workspace 공개 진입점(L2.workspace). 조립 루트가 쓰는 이름만 내보낸다.
export { workspacePlugin } from "./plugin.ts";
export type { WorkspacePluginOptions } from "./plugin.ts";
export { workspaceManifest, WORKSPACE_EXTENSION_NAME } from "./manifest.ts";
export {
  DEFAULT_WORKSPACE_SETTINGS,
  WORKSPACE_SETTING_DEFS,
  readWorkspaceSettings,
} from "./settings.ts";
export type { WorkspaceSettings, WorkspaceSettingsSource } from "./settings.ts";
