// OS 알림 종류별 켜짐 값의 읽기와 쓰기(B-10). 값은 로컬 설정(`LOCAL`)에 있고, 값이 없으면 켠 것이다.
// 알림 전달기는 `notifyPrefsOf`로 읽고, 설정 화면은 `NotifyPrefsPort`로 바꾼다.
import type { LocalSettings } from "../settings-store/index.ts";
import { LOCAL } from "../settings-store/index.ts";
import type { NotifyCategory, NotifyPrefs } from "./os-notify-model.ts";

/** 설정 화면이 쓰는 면. 쓰기는 저장에 성공했는지만 돌려준다 */
export interface NotifyPrefsPort {
  readonly get: () => NotifyPrefs;
  readonly set: (category: NotifyCategory, on: boolean) => Promise<boolean>;
}

/** 묶음마다 로컬 설정 키 하나 */
const KEY_OF = {
  turnDone: LOCAL.notifyTurnDone,
  approval: LOCAL.notifyApproval,
  scheduleFailed: LOCAL.notifyScheduleFailed,
} as const;

/** 저장된 값을 읽는다. 값이 없으면 켠 것이다 */
export function notifyPrefsOf(local: Pick<LocalSettings, "get">): NotifyPrefs {
  return {
    turnDone: local.get(KEY_OF.turnDone) ?? true,
    approval: local.get(KEY_OF.approval) ?? true,
    scheduleFailed: local.get(KEY_OF.scheduleFailed) ?? true,
  };
}

export function notifyPrefsPortOf(local: LocalSettings): NotifyPrefsPort {
  return {
    get: () => notifyPrefsOf(local),
    set: async (category, on) => {
      const saved = await local.set(KEY_OF[category], on);
      return saved.ok;
    },
  };
}
