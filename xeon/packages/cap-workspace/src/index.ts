// @fresnel/cap-workspace 공개 진입점(L2.workspace). 조립 루트가 쓰는 이름만 내보낸다.
// 서비스 부분(경로 검사, 샌드박스 셸, 쓰기 허용 승인)은 코어 구현 묶음이 낸다. 조립 루트가 `core` 옵션으로 넘긴다.
export { workspacePlugin } from "./plugin.ts";
export type { WorkspacePluginOptions } from "./plugin.ts";
export { workspaceManifest, WORKSPACE_EXTENSION_NAME } from "./manifest.ts";
export {
  DEFAULT_WORKSPACE_SETTINGS,
  WORKSPACE_SETTING_DEFS,
  readWorkspaceSettings,
} from "./settings.ts";
export type { WorkspaceSettings, WorkspaceSettingsSource } from "./settings.ts";
