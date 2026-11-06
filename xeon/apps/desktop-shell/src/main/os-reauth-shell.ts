// `os_reauth`의 Electron 어댑터. `systemPreferences`(Touch ID), 시계, 앱 로그 파일을 os-reauth.ts의 ports에 잇는다.
// 사유 문구와 결과 판단은 os-reauth.ts에 있다. 이 파일은 연결만 한다.
//
// [알려진 차이, 사용자 결정 대기] Electron의 `promptTouchID`는 Touch ID 전용이라 Rust 원본의 기기 암호 대체(LAPolicy.DeviceOwnerAuthentication)가 없다.
// Touch ID가 없는 맥은 `canPromptTouchID`가 거짓이라 `unavailable`이다. 기기 암호까지 쓰려면 네이티브 addon이 필요하다(임의로 넣지 않았다).

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { attempt } from "@fresnel/contracts";
import { systemPreferences } from "electron";
import type { ShellContext, ShellModule } from "./context.ts";
import { createOsReauthModule } from "./os-reauth.ts";

/** Tauri 앱 로그(AppLog)와 같은 파일이다 */
const LOG_FILE = "fresnel-desktop.log";

/** 앱 로그에 한 줄을 덧붙인다. 쓰지 못하면 표준 오류로 대신한다(AppLog와 같다). 로그 때문에 명령이 실패하지 않는다 */
function appendLogLine(logsDir: string, line: string): void {
  const text = `${new Date().toISOString()} ${line}\n`;
  const written = attempt(() => {
    mkdirSync(logsDir, { recursive: true });
    appendFileSync(path.join(logsDir, LOG_FILE), text);
  });
  if (!written.ok) process.stderr.write(text);
}

export const osReauthShellModule: ShellModule = {
  name: "os-reauth",
  register(ctx: ShellContext) {
    createOsReauthModule({
      platform: ctx.platform,
      canPromptTouchID: () => systemPreferences.canPromptTouchID(),
      promptTouchID: (reason) => systemPreferences.promptTouchID(reason),
      now: () => Date.now(),
      log: (line) => {
        appendLogLine(ctx.paths.logs, line);
      },
    }).register(ctx);
  },
};
