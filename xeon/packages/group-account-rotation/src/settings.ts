import { defineSettings, type SettingDefInput, type SettingGroup } from "@xeon/contracts/settings";
import { Type, type TBoolean } from "typebox";

/**
 * ext.account-rotation.* 설정 묶음. 키는 고지 동의 하나다. 회전을 실제로 켜는 조건은
 * 플러그인 scope가 켜져 있는 것과 이 값이 참인 것을 함께 본다(core-models, L1.models.spec §4.8).
 */
export const accountRotationSettings: SettingGroup<
  "ext.account-rotation",
  {
    readonly acknowledgeRisk: SettingDefInput<TBoolean>;
  }
> = defineSettings("ext.account-rotation", {
  acknowledgeRisk: {
    type: Type.Boolean(),
    default: false,
    runtimeChange: "live",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "plugins",
      widget: "toggle",
      order: 10,
      label: "약관 위험 고지에 동의",
    },
    since: "0.1.0",
  },
});
