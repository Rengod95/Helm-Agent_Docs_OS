// 기능 모듈 목록. 다음 트랙은 이 배열에 줄을 더한다(모듈 파일은 src/main/<기능>.ts, `register(ctx)`를 내보낸다).
import type { ShellModule } from "./context.ts";
import { dbToolsShellModule } from "./db-tools-shell.ts";
import { desktopSettingsModule } from "./desktop-settings.ts";
import { dialogsModule } from "./dialogs.ts";
import { engineModule } from "./engine.ts";
import { inspectModule } from "./inspect.ts";
import { logFolderShellModule } from "./log-folder-shell.ts";
import { openExternalModule } from "./open-external.ts";
import { revealPathShellModule } from "./reveal-path-shell.ts";
import { secretEntryModule } from "./secret-entry.ts";
import { secretRevealModule } from "./secret-reveal.ts";
import { serviceShellModule } from "./service-mode-shell.ts";
import { remoteShellModule } from "./remote-shell.ts";
import { notifyOsShellModule } from "./notify-os-shell.ts";
import { osReauthShellModule } from "./os-reauth-shell.ts";
import { shellIntentsModule } from "./shell-intents.ts";
import { singleInstanceShellModule } from "./single-instance-shell.ts";
import { trayShellModule } from "./tray-shell.ts";
import { viewSchemeModule } from "./view-scheme.ts";
import { windowCaptureModule } from "./window-capture.ts";
import { windowStateModule } from "./window-state.ts";
import { updaterShellModule } from "./updater-shell.ts";

/** 단일 인스턴스 잠금이 가장 먼저 와야 한다(두 번째 실행이 다른 초기화를 하기 전에 끝난다) */
export const MODULES: readonly ShellModule[] = [
  singleInstanceShellModule,
  desktopSettingsModule,
  engineModule,
  inspectModule,
  windowStateModule,
  windowCaptureModule,
  openExternalModule,
  logFolderShellModule,
  revealPathShellModule,
  dbToolsShellModule,
  serviceShellModule,
  remoteShellModule,
  dialogsModule,
  secretEntryModule,
  secretRevealModule,
  viewSchemeModule,
  shellIntentsModule,
  trayShellModule,
  notifyOsShellModule,
  osReauthShellModule,
  updaterShellModule,
];
