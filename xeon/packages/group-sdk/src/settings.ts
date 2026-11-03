import {
  defineSettings,
  type SettingDefInput,
  type SettingGroup,
} from "@fresnel/contracts/settings";
import { Type } from "typebox";

/**
 * l3.group-sdk.* 설정 키(L3.group-sdk.spec §6). 키는 둘뿐이다.
 * 구동 그룹 선택은 X 키 `x.primitives.activeDriver`을 읽고(review.decisions-2 S-15), 그룹 켜기는 X 예약 키
 * `ext.<이름>.enabled`라서 여기에 정의하지 않는다.
 */
export const groupSdkSettings: SettingGroup<
  "l3.group-sdk",
  { readonly instrumentation: SettingDefInput; readonly statusLine: SettingDefInput }
> = defineSettings("l3.group-sdk", {
  instrumentation: {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "live",
    allowedScopes: ["managed", "user", "project", "local", "launch"],
    ui: {
      tab: "plugins",
      widget: "toggle",
      order: 200,
      label: "Group instrumentation",
      help: "Records how much time the group spends on rejections, publishing, delegation, and leases. When off, there are no records and no /group status instrumentation values.",
    },
    since: "0.1.0",
  },
  statusLine: {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "live",
    allowedScopes: ["user", "project", "local", "launch"],
    ui: {
      tab: "plugins",
      widget: "toggle",
      order: 201,
      label: "Show groups in status line",
      help: "Shows the enabled groups and the active driver group in the status line.",
    },
    since: "0.1.0",
  },
});
