// @xeon/core-tools 공개 진입점. 다른 L1은 이 패키지를 import하지 않고 서비스(xeon.tools, xeon.approvals)로 협력한다.
export {
  toolsManifest,
  toolsPlugin,
  TOOLS_EXTENSION_NAME,
  type ToolsPluginOptions,
} from "./plugin.ts";
export {
  TOOLS_SETTING_DEFAULTS,
  TOOLS_SETTING_DEFS,
  TOOLS_SETTING_KEYS,
  type ToolsSettingsSource,
} from "./settings.ts";
export type { CapabilityResolver } from "./entries.ts";
export type { OutputTruncator, TruncationOutcome } from "./types.ts";
