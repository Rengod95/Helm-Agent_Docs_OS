// 아티팩트 스킴 모듈의 electron 쪽 진입점(`shell.showItemInFolder`). 시험은 electron 없이 `artifact-scheme.ts`의 만드는 함수를 쓴다.
import { shell } from "electron";
import { createArtifactSchemeModule } from "./artifact-scheme.ts";
import type { ShellModule } from "./context.ts";

export const artifactSchemeShellModule: ShellModule = createArtifactSchemeModule((target) => {
  shell.showItemInFolder(target);
});
