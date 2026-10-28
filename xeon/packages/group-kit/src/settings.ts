import { defineSettings, type SettingDefInput, type SettingGroup } from "@xeon/contracts/settings";
import { Type } from "typebox";

/**
 * l3.group-kit.* 설정 키(L3.group-kit.spec §6). 키는 둘뿐이다.
 * 구동 그룹 선택은 X 키 `x.primitives.activeDriveGroup`을 읽고(review.decisions-2 S-15), 그룹 켜기는 X 예약 키
 * `ext.<이름>.enabled`라서 여기에 정의하지 않는다.
 */
export const groupKitSettings: SettingGroup<
  "l3.group-kit",
  { readonly instrumentation: SettingDefInput; readonly statusLine: SettingDefInput }
> = defineSettings("l3.group-kit", {
  instrumentation: {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "live",
    allowedScopes: ["managed", "user", "project", "local", "session"],
    ui: {
      tab: "plugins",
      widget: "toggle",
      order: 200,
      label: "그룹 계측",
      help: "그룹이 거부, 게시, 위임, 임대 시간을 얼마나 썼는지 기록한다. 끄면 기록과 /group status 계측 값이 없다.",
    },
    since: "0.1.0",
  },
  statusLine: {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "live",
    allowedScopes: ["user", "project", "local", "session"],
    ui: {
      tab: "plugins",
      widget: "toggle",
      order: 201,
      label: "상태줄 그룹 표시",
      help: "상태줄에 켜진 그룹과 구동 그룹을 보인다.",
    },
    since: "0.1.0",
  },
});
