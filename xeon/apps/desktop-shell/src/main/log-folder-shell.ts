// 로그 폴더 열기 모듈의 electron 쪽 진입점(`shell.openPath`). 시험은 electron 없이 `log-folder.ts`의 만드는 함수를 쓴다.
import { shell } from "electron";
import type { ShellModule } from "./context.ts";
import { createLogFolderModule } from "./log-folder.ts";

export const logFolderShellModule: ShellModule = createLogFolderModule((target) =>
  shell.openPath(target),
);
