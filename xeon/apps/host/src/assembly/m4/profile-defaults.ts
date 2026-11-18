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
 * 코어 서비스가 아직 이 단위에 기대는 L2 내장 플러그인(M5c §4.1.17, `plugin.requiredByCore`). 도구 파이프라인의 파일 서비스(`cap-workspace`)와
 * 사람에게 묻기(`cap-dialog`)다. 프로필에 남지만 프로필과 무관하게 켜지고(E(T)), 프로필 편집이 이 단위를 빼면 거절한다.
 * E2의 L1 분할이 끝나면 이 표시와 오류를 지운다
 */
export const REQUIRED_BY_CORE: ReadonlySet<string> = new Set(["cap-workspace", "cap-dialog"]);

/**
 * 숨은 시스템 프로필 `craft`의 id(M5c §4.8.5). 테스트 대화만 쓴다. 사용자가 고르지 않고 목록에 나오지 않으며 저장하지 않는다
 */
export const CRAFT_PROFILE_ID = "craft";
/** 테스트 대화의 시작 Drive이자 유일한 플러그인인 빌더의 내장 이름(`authoring`, 화면 이름 "Plugin Builder") */
const CRAFT_BUILDER_PLUGIN = "authoring";
/** 테스트 대화의 권한 모드. 묻는 모드다(`bypass`가 아니다, §4.8.5) */
const CRAFT_PERMISSION_MODE = "default";

/**
 * 숨은 `craft` 프로필의 값. 저장하지 않고 이 값을 그대로 쓴다(`default`와 같은 방식). 공통 묶음은 받지 않는다
 * (`plugin-set.ts`가 대화의 해소에서 뺀다, §4.8.5 [제안]).
 */
export function craftProfile(): Profile {
  return {
    id: CRAFT_PROFILE_ID,
    title: "craft",
    builtin: true,
    hidden: true,
    plugins: [{ name: CRAFT_BUILDER_PLUGIN }],
    settings: [{ key: PERMISSION_MODE_KEY, value: CRAFT_PERMISSION_MODE }],
    startDrive: CRAFT_BUILDER_PLUGIN,
    updatedAt: NEVER_EDITED_ISO,
    rev: 0,
  };
}

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
