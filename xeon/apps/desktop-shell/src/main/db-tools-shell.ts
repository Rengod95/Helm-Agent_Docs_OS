// 백업·저장 공간 모듈의 electron 쪽 진입점(`shell.openPath`와 운영 launcher). 시험은 electron 없이 `db-tools.ts`의 만드는 함수를 쓴다.
import { shell } from "electron";
import os from "node:os";
import type { ShellModule } from "./context.ts";
import { createDbToolsModule } from "./db-tools.ts";
import { pipedLauncher } from "./engine/launcher.ts";
import { appLogOf } from "./lib/applog.ts";
import { nodeScheduler } from "./lib/scheduler.ts";

export const dbToolsShellModule: ShellModule = createDbToolsModule({
  launcherOf: (ctx) =>
    pipedLauncher({
      env: ctx.env,
      platform: ctx.platform,
      arch: process.arch,
      resources: ctx.paths.resources,
      home: os.homedir(),
      log: appLogOf(ctx),
      scheduler: nodeScheduler(),
    }),
  open: (target) => shell.openPath(target),
  now: () => new Date(),
});
