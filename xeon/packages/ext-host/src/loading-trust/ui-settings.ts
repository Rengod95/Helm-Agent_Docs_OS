import { Type } from "typebox";
import {
  defineSettings,
  type SettingDefInput,
  type SettingGroup,
} from "@fresnel/contracts/settings";

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
  }
> = defineSettings("x.ui", {
  apps: {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "restart",
    allowedScopes: ["managed", "user"],
    ui: { tab: "plugins", widget: "toggle", order: 450, label: "플러그인 앱 화면 허용" },
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
      label: "프로젝트 플러그인의 앱 화면 허용",
    },
    since: "0.1.0",
  },
});
