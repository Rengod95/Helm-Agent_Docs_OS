// OS 알림의 Electron 어댑터(B-10). 이 파일만 electron 값을 가져온다. 권한 API가 없어 지원 여부로 답한다.
// Electron은 알림 객체를 치우면 클릭을 잃으므로, 닫히거나 눌리거나 실패할 때까지 `live`가 붙든다.
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { attempt } from "@fresnel/contracts";
import { Notification } from "electron";
import type { ShellModule } from "./context.ts";
import {
  createNotifyOsModule,
  permissionWordOf,
  SHOW_FAILED_LOG,
  type ShownNotice,
} from "./notify-os.ts";

/** Rust 앱 로그와 같은 파일이다(`applog.rs`) */
const LOG_FILE = "fresnel-desktop.log";

/** 떠 있는 알림. 눌림 이벤트를 받으려고 닫히거나 눌리거나 실패할 때까지 든다 */
const live = new Set<Notification>();

/** 로그 한 줄을 앱 로그 파일에 붙인다. 쓰지 못하면 표준 오류로 대신한다(로그 때문에 앱이 멈추지 않는다) */
function appendLog(logs: string, line: string): void {
  const written = attempt(() => {
    mkdirSync(logs, { recursive: true });
    appendFileSync(path.join(logs, LOG_FILE), `${new Date().toISOString()} ${line}\n`);
  });
  if (!written.ok) process.stderr.write(`${line}\n`);
}

function showNotice(
  notice: ShownNotice,
  onClick: () => void,
  log: (line: string) => void,
): boolean {
  if (!Notification.isSupported()) return false;
  const note = new Notification({
    title: notice.title,
    body: notice.body ?? "",
    silent: false,
  });
  live.add(note);
  const release = (): void => {
    live.delete(note);
  };
  note.once("click", () => {
    release();
    onClick();
  });
  note.once("close", release);
  // 띄운 뒤에 실패하면 답은 이미 `shown`이라 로그로만 남긴다
  note.once("failed", () => {
    release();
    log(SHOW_FAILED_LOG);
  });
  note.show();
  return true;
}

/** OS 알림 명령 셋을 Electron에 엮는 셸 모듈. `modules.ts`에 한 줄로 더한다 */
export const notifyOsShellModule: ShellModule = {
  name: "notify-os",
  register(ctx) {
    const log = (line: string): void => {
      appendLog(ctx.paths.logs, line);
    };
    createNotifyOsModule({
      permission: () => permissionWordOf(Notification.isSupported()),
      show: (notice, onClick) => showNotice(notice, onClick, log),
      log,
    }).register(ctx);
  },
};
