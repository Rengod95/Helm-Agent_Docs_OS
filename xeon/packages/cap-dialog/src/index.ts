// @xeon/cap-dialog 공개 진입점(L2.dialog). 조립 루트가 쓰는 이름만 내보낸다.
export { dialogPlugin } from "./plugin.ts";
export type { DialogPluginOptions } from "./plugin.ts";
export { dialogManifest, DIALOG_EXTENSION_NAME } from "./manifest.ts";
export { DEFAULT_DIALOG_SETTINGS, DIALOG_SETTING_DEFS, readDialogSettings } from "./settings.ts";
export type { DialogSettings, DialogSettingsSource } from "./settings.ts";
export type { ApprovalsPortFactory } from "./ports/approvals.ts";
export type { ShellFailure, ShellOutput, ShellPort, ShellRunContext } from "./ports/shell.ts";
export type { BuiltinCommandDecl, CommandsServiceApi } from "./commands/service.ts";
