// OS 알림의 Electron 어댑터(B-10). 이 파일만 electron 값을 가져온다. 권한 API가 없어 지원 여부로 답한다.
// Electron은 알림 객체를 치우면 클릭을 잃으므로, 닫히거나 눌리거나 실패할 때까지 `live`가 붙든다.
import { Notification } from "electron";
import type { ShellModule } from "./context.ts";
import { appLogOf } from "./lib/applog.ts";
import { createNotifyOsModule, permissionWordOf, type ShownNotice } from "./notify-os.ts";

/** 떠 있는 알림. 눌림 이벤트를 받으려고 닫히거나 눌리거나 실패할 때까지 든다 */
const live = new Set<Notification>();

/** OS가 `show`나 `failed`로 답하길 기다리는 상한(ms). 넘으면 띄운 것으로 보고 답한다(그 뒤 실패는 `onFailed`가 알린다) */
const SETTLE_MS = 2000;

function showNotice(
  notice: ShownNotice,
  onClick: () => void,
  onFailed: () => void,
): Promise<boolean> {
  if (!Notification.isSupported()) return Promise.resolve(false);
  const note = new Notification({
    title: notice.title,
    body: notice.body ?? "",
    silent: false,
  });
  live.add(note);
  const release = (): void => {
    live.delete(note);
  };
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (shown: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(shown);
    };
    const timer = setTimeout(() => {
      settle(true);
    }, SETTLE_MS);
    note.once("show", () => {
      settle(true);
    });
    note.once("click", () => {
      release();
      onClick();
    });
    note.once("close", release);
    // 답하기 전의 실패는 답이 `failed`가 된다. 답한 뒤의 실패는 로그와 UI 이벤트로 알린다(`onFailed`)
    note.once("failed", () => {
      release();
      if (settled) onFailed();
      else settle(false);
    });
    note.show();
  });
}

/** OS 알림 명령 셋을 Electron에 엮는 셸 모듈. `modules.ts`에 한 줄로 더한다 */
export const notifyOsShellModule: ShellModule = {
  name: "notify-os",
  register(ctx) {
    const appLog = appLogOf(ctx);
    const log = (line: string): void => {
      appLog.line(line);
    };
    createNotifyOsModule({
      permission: () => permissionWordOf(Notification.isSupported()),
      show: (notice, onClick, onFailed) => showNotice(notice, onClick, onFailed),
      log,
    }).register(ctx);
  },
};
