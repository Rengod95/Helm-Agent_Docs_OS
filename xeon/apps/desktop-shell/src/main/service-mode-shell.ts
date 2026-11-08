// 서비스 명령 모듈의 electron 쪽 진입점(운영 launcher). 시험은 electron 없이 `service-mode.ts`의 만드는 함수를 쓴다.
import os from "node:os";
import type { ShellModule } from "./context.ts";
import { pipedLauncher } from "./engine/launcher.ts";
import { appLogOf } from "./lib/applog.ts";
import { nodeScheduler } from "./lib/scheduler.ts";
import { createServiceModule } from "./service-mode.ts";

export const serviceShellModule: ShellModule = createServiceModule({
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
});
