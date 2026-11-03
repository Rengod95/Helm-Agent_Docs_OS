import {
  DIRECT_CREATE_MODES,
  DirectCreateModeSettingSchema,
  type DirectCreateMode,
} from "@fresnel/contracts/capabilities";
import {
  defineSettings,
  resolveSetting,
  type ScopeStack,
  type SettingDef,
} from "@fresnel/contracts/settings";

// L2.schedule.spec §6. 키 `l2.schedule.entries.directCreate`는 직접 호출(모델 도구 경로 밖)의 `schedule.entries.create`를 정한다.
// 파일 범위는 managed와 user뿐이다. 저장소(project, local) 설정이 예약 만들기 정책을 바꾸지 못하게 하려는 것이다 [결정: 2026-11-03 사용자].

const USER_MANAGED = ["managed", "user"] as const;

const scheduleSettings = defineSettings("l2.schedule", {
  "entries.directCreate": {
    type: DirectCreateModeSettingSchema,
    default: "allow",
    range: { enum: [...DIRECT_CREATE_MODES] },
    runtimeChange: "live",
    allowedScopes: USER_MANAGED,
    ui: {
      tab: "execution",
      widget: "select",
      order: 350,
      label: "확장의 예약 직접 만들기",
      help: "모델 도구가 아닌 확장·그룹의 직접 호출을 다룬다. allow는 바로 만들고, ask는 승인을 묻고, deny는 막는다",
    },
    since: "0.1.0",
  },
});

/** 이 패키지가 선언하는 설정 정의. 조립 루트가 카탈로그에 넣는다 */
export const SCHEDULE_SETTING_DEFS: readonly SettingDef[] = Object.values(scheduleSettings.defs);

/** 설정 층을 돌려준다. 호출마다 읽으므로 변경이 다음 호출부터 적용된다 */
export interface ScheduleSettingsSource {
  layers(threadId: string | undefined): ScopeStack;
}

export interface ScheduleSettings {
  readonly entries: { readonly directCreate: DirectCreateMode };
}

export const DEFAULT_SCHEDULE_SETTINGS: ScheduleSettings = {
  entries: { directCreate: "allow" },
};

const DIRECT_CREATE_VALUES: readonly string[] = DIRECT_CREATE_MODES;

function isDirectCreateMode(value: unknown): value is DirectCreateMode {
  return typeof value === "string" && DIRECT_CREATE_VALUES.includes(value);
}

/** 유효 값을 읽는다. 범위 밖 층은 `resolveSetting`이 건너뛰고, 값이 없으면 기본값(allow)이다 */
export function readScheduleSettings(layers: ScopeStack): ScheduleSettings {
  const directCreate = resolveSetting(scheduleSettings.defs["entries.directCreate"], layers).setting
    .value;
  return {
    entries: {
      directCreate: isDirectCreateMode(directCreate)
        ? directCreate
        : DEFAULT_SCHEDULE_SETTINGS.entries.directCreate,
    },
  };
}
