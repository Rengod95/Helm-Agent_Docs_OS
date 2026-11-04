import {
  defineSettings,
  type SettingDefInput,
  type SettingGroup,
} from "@fresnel/contracts/settings";
import { Type, type TBoolean } from "typebox";

// L3.authoring.spec §6 설정 노출. 개발 모드(`l3.authoring.devMode`)는 replay, benchmark, 코어 변경 검사를 이 컴퓨터에서 돌리는 것을 허용한다.
// 기본은 꺼짐이고, 배포 앱에서 개발 모드를 켜는 조건은 화면 쪽 대화 상자가 다룬다(L4.desktop-ux.spec §12.3 U-4).

/**
 * `l3.authoring.*` 설정 그룹. 소유는 이 패키지다(`coreSettingGroups`가 등록한다).
 * 값은 바로 적용된다(`live`). 개발 모드 판정은 호스트가 설정 값을 읽을 때마다 한다.
 */
export const authoringSettings: SettingGroup<
  "l3.authoring",
  { readonly devMode: SettingDefInput<TBoolean> }
> = defineSettings("l3.authoring", {
  devMode: {
    type: Type.Boolean(),
    default: false,
    runtimeChange: "live",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "plugins",
      widget: "toggle",
      order: 240,
      label: "Plugin development mode",
      labelKey: "settings.l3.authoring.devMode.label",
      help: "When on, this computer can run plugin replay checks and benchmarks.",
      helpKey: "settings.l3.authoring.devMode.help",
    },
    since: "0.1.0",
  },
});
