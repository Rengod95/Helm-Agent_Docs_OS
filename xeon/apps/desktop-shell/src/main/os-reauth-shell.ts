// `os_reauth`의 Electron 어댑터. `systemPreferences`(Touch ID), 시계, 앱 로그 파일을 os-reauth.ts의 ports에 잇는다.
// 사유 문구와 결과 판단은 os-reauth.ts에 있다. 이 파일은 연결만 한다.
//
// [알려진 차이, 사용자 결정 대기] Electron의 `promptTouchID`는 Touch ID 전용이라 Rust 원본의 기기 암호 대체(LAPolicy.DeviceOwnerAuthentication)가 없다.
// Touch ID가 없는 맥은 `canPromptTouchID`가 거짓이라 `unavailable`이다. 기기 암호까지 쓰려면 네이티브 addon이 필요하다(임의로 넣지 않았다).

import { systemPreferences } from "electron";
import type { ShellContext, ShellModule } from "./context.ts";
import { appLogOf } from "./lib/applog.ts";
import { createOsReauthModule } from "./os-reauth.ts";

export const osReauthShellModule: ShellModule = {
  name: "os-reauth",
  register(ctx: ShellContext) {
    const appLog = appLogOf(ctx);
    createOsReauthModule({
      platform: ctx.platform,
      canPromptTouchID: () => systemPreferences.canPromptTouchID(),
      promptTouchID: (reason) => systemPreferences.promptTouchID(reason),
      now: () => Date.now(),
      log: (line) => {
        appLog.line(line);
      },
    }).register(ctx);
  },
};
