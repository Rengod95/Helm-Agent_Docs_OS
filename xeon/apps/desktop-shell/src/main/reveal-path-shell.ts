// 전체 출력 보기 모듈의 electron 쪽 진입점(`shell.showItemInFolder`). 시험은 electron 없이 `reveal-path.ts`의 만드는 함수를 쓴다.
import { shell } from "electron";
import type { ShellModule } from "./context.ts";
import { createRevealPathModule } from "./reveal-path.ts";

export const revealPathShellModule: ShellModule = createRevealPathModule((target) => {
  shell.showItemInFolder(target);
});
