import { defineSettings, type SettingGroup } from "@xeon/contracts/settings";

/**
 * 설정 키를 더하는 자리. 키는 ext.__ID__.<이름>으로 읽힌다(F.wire-settings.spec §3.8.3).
 * enabled와 isolation은 X가 예약한 키라 여기에 두지 않는다.
 */
export const settings: SettingGroup<"ext.__ID__", Record<never, never>> = defineSettings(
  "ext.__ID__",
  {},
);
