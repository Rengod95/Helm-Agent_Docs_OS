import {
  defineSettings,
  type SettingDefInput,
  type SettingGroup,
} from "@fresnel/contracts/settings";
import { Type } from "typebox";

/**
 * l3.orchestration.* 설정 키(L3.group-sdk.spec §6). 키는 하나뿐이다.
 * 그룹 켜기는 X 예약 키 `ext.<이름>.enabled`라서 여기에 정의하지 않는다. 구동 그룹 선택 키 `x.primitives.activeDriver`는
 * E3에서 없앴다(drive-isolation.md 2.2). 주도 시작은 명령과 프로필이 한다.
 */
export const orchestrationSdkSettings: SettingGroup<
  "l3.orchestration",
  { readonly instrumentation: SettingDefInput }
> = defineSettings("l3.orchestration", {
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
      help: "Records how much time the group spends on rejections, publishing, delegation, and leases. When off, there are no records and no instrumentation values.",
    },
    since: "0.1.0",
  },
});
