import type { SettingsTab } from "@fresnel/contracts/settings";

// 데스크톱 설정 화면의 구역 id(L4.settings-ui §4.1.1 [결정: 2026-11-11 사용자]). 엔진 정의의 `ui.tab`(13개)과 따로,
// 화면은 이 열두 구역으로 나뉜다. 구역 구성(어느 키가 어디에 드는가)은 `views/pages/settings/settings-sections.ts`가 정한다.
// 상태 저장소의 설정 점프(`SettingsJump`)가 이 id를 받으므로 상태 쪽에 둔다.

export const SETTINGS_SECTION_IDS = [
  "general",
  "notifications",
  "models",
  "secrets",
  "permissions",
  "sandbox",
  "tools",
  "plugins",
  "sessions",
  "connection",
  "execution",
  "data",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

/** 설정 점프가 받는 자리: 화면 구역 id 또는 옛 탭 id. 옛 탭은 화면이 구역으로 바꾼다(`sectionOfJump`) */
export type SettingsJumpTarget = SettingsSectionId | SettingsTab;

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return SETTINGS_SECTION_IDS.some((id) => id === value);
}
