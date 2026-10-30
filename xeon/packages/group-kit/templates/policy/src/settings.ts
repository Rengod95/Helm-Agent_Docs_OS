import { defineSettings, type SettingDefInput, type SettingGroup } from "@xeon/contracts/settings";
import { Type, type TArray, type TString } from "typebox";

/** ext.__ID__.* 설정 키. enabled와 isolation은 X가 예약한 키라 여기에 두지 않는다 */
export const settings: SettingGroup<
  "ext.__ID__",
  { readonly blockedTools: SettingDefInput<TArray<TString>> }
> = defineSettings("ext.__ID__", {
  blockedTools: {
    type: Type.Array(Type.String()),
    default: [],
    runtimeChange: "nextTurn",
    allowedScopes: ["user", "project", "session"],
    ui: { tab: "plugins", widget: "list", order: 10, label: "막을 도구" },
    since: "__VERSION__",
  },
});
