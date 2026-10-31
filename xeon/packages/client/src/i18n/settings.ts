import { Type, type TString } from "typebox";
import { defineSettings, type SettingDefInput, type SettingGroup } from "@xeon/contracts/settings";

// ADR-0016 §3.3. 표시 언어 설정. CLI와 데스크톱이 함께 쓰므로 클라이언트 패키지에 둔다.
// 키는 `l4.ui.locale`이다: 설정 키 이름공간이 `f|x|l0-4|ext`로 고정이라 ADR의 논리 이름 `ui.locale`을 그대로 쓸 수 없다
// [결정: 오케스트레이터 기본값].

export type UiSettingInputs = {
  readonly locale: SettingDefInput<TString>;
};

export const UI_LOCALE_KEY = "l4.ui.locale" as const;

export const uiSettings: SettingGroup<"l4.ui", UiSettingInputs> = defineSettings("l4.ui", {
  locale: {
    type: Type.String(),
    default: "auto",
    range: { enum: ["auto", "ko", "en"] },
    runtimeChange: "live",
    allowedScopes: ["managed", "user", "local", "session"],
    ui: {
      tab: "appearance",
      widget: "select",
      order: 90,
      label: "Display language",
      labelKey: "settings.l4.ui.locale.label",
      help: "Language of messages and screens",
      helpKey: "settings.l4.ui.locale.help",
    },
    since: "0.1.0",
  },
});
