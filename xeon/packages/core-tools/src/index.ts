// @fresnel/core-tools 공개 진입점. 다른 L1은 이 패키지를 import하지 않고 서비스(fresnel.tools, fresnel.approvals)로 협력한다.
import type { DialogCore } from "@fresnel/contracts/services";
import { questionApprovalsOver } from "./ask/approvals.ts";
import { guarded, toCapabilityError } from "./ask/errors.ts";
import { createAskService } from "./ask/service.ts";
export {
  toolsManifest,
  toolsPlugin,
  TOOLS_EXTENSION_NAME,
  type ToolsPluginOptions,
} from "./plugin.ts";
export {
  normalizeStoredMode,
  TOOLS_SETTING_DEFAULTS,
  TOOLS_SETTING_DEFS,
  TOOLS_SETTING_KEYS,
  type ToolsSettingsSource,
} from "./settings.ts";
export type { CapabilityResolver } from "./entries.ts";
export type { OutputTruncator } from "./types.ts";
export {
  createMcpStartGate,
  MCP_START_RULE_ID,
  MCP_START_TOOL_NAME,
  type McpStartDefinition,
  type McpStartGate,
  type McpStartGateDeps,
  type McpStartVerdict,
} from "./mcp-start.ts";
// 사람에게 묻기(dialog.ask)의 서비스(층 D1에서 cap-dialog에서 옮겼다). 기능 등록과 `ask_user` 도구 등록은 cap-dialog와 apps/host가 한다.
export { createAskService } from "./ask/service.ts";
export type { AskService } from "./ask/service.ts";
export type { AskDeps, Timers } from "./ask/deps.ts";
export { questionApprovalsOver, type ApprovalsPortFactory } from "./ask/approvals.ts";
// 서비스 경계 실패 변환. 질문 서비스가 쓰고 cap-dialog의 알림·상태·명령·첨부 서비스도 같은 클래스를 쓴다
export { DialogFailure, guarded, toCapabilityError } from "./ask/errors.ts";
// cap-dialog가 받는 질문 기능 묶음. 조립 루트가 `dialogPlugin({ core: dialogCore })`로 넘긴다(cap-dialog는 이 패키지를 import하지 않는다)
export const dialogCore: DialogCore = {
  createAskService,
  questionApprovalsOver,
  guardedDialog: guarded,
  toDialogCapabilityError: toCapabilityError,
};
