// `os_reauth`의 Electron 어댑터. `mac-security` 애드온(Touch ID, 안 되면 Mac 암호), 시계, 앱 로그 파일을 os-reauth.ts의 ports에 잇는다.
// 사유 문구와 결과 판단은 os-reauth.ts에 있다. 이 파일은 연결만 한다.
// 애드온을 불러오지 못하면(`lib/mac-security.ts`) 재인증은 `unavailable`이고 앱은 계속 돈다.

import type { ShellContext, ShellModule } from "./context.ts";
import { appLogOf } from "./lib/applog.ts";
import { loadMacSecurity } from "./lib/mac-security.ts";
import { createOsReauthModule } from "./os-reauth.ts";

export const osReauthShellModule: ShellModule = {
  name: "os-reauth",
  register(ctx: ShellContext) {
    const appLog = appLogOf(ctx);
    // macOS가 아니면 애드온을 불러보지 않는다(명령이 포트를 부르지 않고 `unavailable`을 돌려준다)
    const addon = ctx.platform === "darwin" ? loadMacSecurity(ctx.paths.resources) : null;
    if (ctx.platform === "darwin" && addon === null) appLog.line("os reauth: addon not loaded");
    createOsReauthModule({
      platform: ctx.platform,
      canAuthenticate: () => addon?.canAuthenticate().available === true,
      authenticate: (reason) =>
        addon === null ? Promise.reject(new Error("addon not loaded")) : addon.authenticate(reason),
      now: () => Date.now(),
      log: (line) => {
        appLog.line(line);
      },
    }).register(ctx);
  },
};
