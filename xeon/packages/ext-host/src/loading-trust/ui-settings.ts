import { Type, type TArray, type TObject, type TOptional, type TString } from "typebox";
import {
  defineSettings,
  type SettingDefInput,
  type SettingGroup,
} from "@fresnel/contracts/settings";

/** 화면 항목 열쇠(`<확장 이름>/<항목 id>`) 목록. 항목 id는 `UI_ID_PATTERN`(32자)이고 확장 이름은 64자까지다 */
const UI_ITEM_KEYS: TArray<TString> = Type.Array(Type.String({ minLength: 3, maxLength: 128 }), {
  maxItems: 512,
});

/** 자리마다 사용자가 정한 항목 순서. 목록에 없는 항목은 그 뒤에 기본 순서(확장 이름, 항목 id)로 온다 */
const UI_ORDER_TYPE: TObject<{
  status: TOptional<TArray<TString>>;
  panel: TOptional<TArray<TString>>;
}> = Type.Object(
  { status: Type.Optional(UI_ITEM_KEYS), panel: Type.Optional(UI_ITEM_KEYS) },
  { additionalProperties: false },
);

/**
 * X 층 Plugin UI 키. defineSettings("x.ui", …)(X.loading-trust.spec §6). 앱 정책은 `LoadOptions.uiPolicy`로 로더에 들어간다.
 * 범위는 `managed`, `user`뿐이다. `project`는 물론 `local`(F.wire-settings 범위 표의 "프로젝트의 개인 파일")도 빼서,
 * 저장소가 자기 앱 권한을 켜거나 전역 정책을 되돌리지 못하게 한다. `launch`는 `restart` 키에 D7 규칙으로 막힌다
 */
export const uiSettings: SettingGroup<
  "x.ui",
  {
    readonly apps: SettingDefInput;
    readonly allowProjectApps: SettingDefInput;
    readonly hidden: SettingDefInput<typeof UI_ITEM_KEYS>;
    readonly order: SettingDefInput<typeof UI_ORDER_TYPE>;
  }
> = defineSettings("x.ui", {
  apps: {
    type: Type.Boolean(),
    // 기본 켜짐 [결정: 2026-11-04 사용자]: 프레임 격리 시험이 이 Mac에서 통과한 뒤 켠다(ADR-0021 §6 1번).
    // Windows는 전용 스킴 주소가 달라 클라이언트가 값과 상관없이 끈다(ADR-0021 §3.6.2)
    default: true,
    runtimeChange: "restart",
    allowedScopes: ["managed", "user"],
    ui: { tab: "plugins", widget: "toggle", order: 450, label: "Allow plugin app screens" },
    since: "0.1.0",
  },
  allowProjectApps: {
    type: Type.Boolean(),
    default: false,
    runtimeChange: "restart",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "plugins",
      widget: "toggle",
      order: 460,
      label: "Allow app screens for work folder plugins",
    },
    since: "0.1.0",
  },
  // 사용자가 숨긴 화면 항목과 자리별 순서 [결정: 2026-11-23 사용자, AGE-73 "1. 가 2. 가 3. 가"]. 앱 전체에 한 벌이고(프로필마다 따로 두지 않음)
  // 리뷰를 거치지 않는다. 플러그인을 바꾸지 않고 앱이 그리는 것만 바꾼다. 엔진은 읽지 않고 데스크톱이 `settings.get`으로 읽는다.
  // 설정 화면에 줄을 두지 않는다(`ui` 없음): 크래프트 플러그인 상세 "화면과 설정" 탭이 항목 줄마다 바꾼다(L4.desktop-ux.spec §6.24)
  hidden: {
    type: UI_ITEM_KEYS,
    default: [],
    runtimeChange: "live",
    allowedScopes: ["managed", "user"],
    since: "0.1.0",
  },
  order: {
    type: UI_ORDER_TYPE,
    default: {},
    runtimeChange: "live",
    allowedScopes: ["managed", "user"],
    since: "0.1.0",
  },
});
