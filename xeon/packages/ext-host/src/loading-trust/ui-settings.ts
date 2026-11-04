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
      label: "Allow app screens for project plugins",
    },
    since: "0.1.0",
  },
});
