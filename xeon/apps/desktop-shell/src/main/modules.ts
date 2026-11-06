// 기능 모듈 목록. 다음 트랙은 이 배열에 줄을 더한다(모듈 파일은 src/main/<기능>.ts, `register(ctx)`를 내보낸다).
import type { ShellModule } from "./context.ts";
import { desktopSettingsModule } from "./desktop-settings.ts";
import { dialogsModule } from "./dialogs.ts";
import { engineModule } from "./engine.ts";
import { inspectModule } from "./inspect.ts";
import { openExternalModule } from "./open-external.ts";
import { secretEntryModule } from "./secret-entry.ts";
import { viewSchemeModule } from "./view-scheme.ts";
import { windowStateModule } from "./window-state.ts";

export const MODULES: readonly ShellModule[] = [
  desktopSettingsModule,
  engineModule,
  inspectModule,
  windowStateModule,
  openExternalModule,
  dialogsModule,
  secretEntryModule,
  viewSchemeModule,
];
