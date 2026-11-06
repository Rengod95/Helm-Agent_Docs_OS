// 설정 > 정보와 진단의 "로그 폴더 열기"(scA-8). 로그 폴더(`ctx.paths.logs`)를 OS 파일 관리자로 연다.
// 열 경로는 인자로 받지 않는다. 렌더러가 임의 경로를 열게 하지 않으려고, 셸이 아는 로그 폴더 하나만 연다.
import { mkdirSync } from "node:fs";
import { attempt, attemptAsync } from "@fresnel/contracts";
import { ShellError } from "./commands.ts";
import type { ShellModule } from "./context.ts";

/** 폴더를 OS로 연다. 실패하면 오류 글이 오고 성공하면 빈 글이다(electron `shell.openPath`와 같다) */
type OpenPath = (target: string) => Promise<string>;

export function createLogFolderModule(open: OpenPath): ShellModule {
  return {
    name: "log-folder",
    register(ctx) {
      ctx.handle("open_log_dir", async () => {
        // 아직 로그가 하나도 없으면 폴더가 없을 수 있어 먼저 만든다
        const made = attempt(() => mkdirSync(ctx.paths.logs, { recursive: true }));
        if (!made.ok) throw new ShellError("open_failed");
        const opened = await attemptAsync(() => open(ctx.paths.logs));
        if (!opened.ok || opened.value !== "") throw new ShellError("open_failed");
        return null;
      });
    },
  };
}
