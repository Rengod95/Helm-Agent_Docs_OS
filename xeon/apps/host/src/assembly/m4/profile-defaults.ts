import type { Profile } from "@fresnel/contracts/wire";

// 내장 기본 프로필의 상수와 공장 값(M5c §2, §4.1.2). 저장소(`profile-store.ts`)와 옮김(`profile-migrate.ts`)이 함께 쓰므로 여기에 둔다.

/** 내장 기본 프로필의 id. 지울 수 없다 */
export const DEFAULT_PROFILE_ID = "default";
/** 권한 모드 설정 키. 프로필이 가진다(§4.1.2) */
export const PERMISSION_MODE_KEY = "l1.tools.permissionMode";
/** 공장 권한 모드("모두 허용") */
export const FACTORY_PERMISSION_MODE = "bypass";
/** 저장되지 않은 값의 시각. 한 번도 고치지 않았음을 뜻한다 */
export const NEVER_EDITED_ISO: string = new Date(0).toISOString();

/**
 * 공장 값 기본 프로필. `plugins`는 호출자가 넘긴다(번들 기본 플러그인 가운데 코어가 아닌 것, §4.1.2).
 * `rev` 0은 저장되지 않았음을 뜻한다. 처음 고치면 1부터 센다.
 */
export function factoryDefaultProfile(plugins: readonly string[]): Profile {
  return {
    id: DEFAULT_PROFILE_ID,
    // 화면 이름은 id로 현지화한다(내장 프로필). 저장 값은 id와 같다
    title: "default",
    builtin: true,
    plugins: plugins.map((name) => ({ name })),
    settings: [{ key: PERMISSION_MODE_KEY, value: FACTORY_PERMISSION_MODE }],
    startDrive: null,
    updatedAt: NEVER_EDITED_ISO,
    rev: 0,
  };
}
