// @fresnel/cap-dialog 공개 진입점(L2.dialog). 조립 루트가 쓰는 이름만 내보낸다.
export { dialogPlugin } from "./plugin.ts";
export type { DialogPluginOptions } from "./plugin.ts";
export { dialogManifest, DIALOG_EXTENSION_NAME } from "./manifest.ts";
export { DEFAULT_DIALOG_SETTINGS, DIALOG_SETTING_DEFS, readDialogSettings } from "./settings.ts";
export type { DialogSettings, DialogSettingsSource } from "./settings.ts";
export type { ApprovalsPortFactory } from "./ports/approvals.ts";
export type { ShellFailure, ShellOutput, ShellPort, ShellRunContext } from "./ports/shell.ts";
export type { BuiltinCommandDecl, CommandsServiceApi } from "./commands/service.ts";
// 휘발 조각 번호 발급기. 조립 루트가 하나를 만들어 `scope.handler_failed`와 `dialogPlugin`에 나눠 준다
export { createChunkNumbering } from "./chunk-numbering.ts";
export type { ChunkNumbering } from "./chunk-numbering.ts";
// dialog.status 발신자. 조립 루트는 쓰지 않고, 번호를 `scope.handler_failed`와 나누는 apps/host 시험이 쓴다
export { sessionStatusPublisher } from "./session-adapter.ts";
