import { Type, type TArray, type TLiteral, type TNull, type TString, type TUnion } from "typebox";
import { uiSettings } from "@xeon/client/i18n";
import {
  defineSettings,
  type SettingDefInput,
  type SettingGroup,
  type SettingNamespace,
} from "@xeon/contracts/settings";

// L4.cli.spec §6. l4.cli.* 키 네 개. 조립 루트가 import할 수 없는 앱의 설정이라 AssembleOptions.settingGroups로 넘긴다(§3.3).
// 네 키 모두 탭은 appearance다: 표시 설정의 소유자가 L4이기 때문이다.

type StatusSegment = TUnion<
  [
    TLiteral<"model">,
    TLiteral<"thinking">,
    TLiteral<"tokens">,
    TLiteral<"cost">,
    TLiteral<"cwd">,
    TLiteral<"session">,
    TLiteral<"transport">,
  ]
>;

export type CliSettingInputs = {
  readonly theme: SettingDefInput<TString>;
  readonly statusLine: SettingDefInput<TArray<StatusSegment>>;
  readonly keybindingsFile: SettingDefInput<TUnion<[TString, TNull]>>;
  readonly outputMode: SettingDefInput<TString>;
};

/** 키 이름 상수. 코드가 키 문자열을 흩어 쓰지 않게 한다 */
export const CLI_SETTING_KEYS: {
  readonly theme: "l4.cli.theme";
  readonly statusLine: "l4.cli.statusLine";
  readonly keybindingsFile: "l4.cli.keybindingsFile";
  readonly outputMode: "l4.cli.outputMode";
} = {
  theme: "l4.cli.theme",
  statusLine: "l4.cli.statusLine",
  keybindingsFile: "l4.cli.keybindingsFile",
  outputMode: "l4.cli.outputMode",
};

export const cliSettings: SettingGroup<"l4.cli", CliSettingInputs> = defineSettings("l4.cli", {
  theme: {
    type: Type.String(),
    default: "system",
    range: { enum: ["system", "dark", "light"] },
    runtimeChange: "live",
    allowedScopes: ["managed", "user", "local", "session"],
    ui: {
      tab: "appearance",
      widget: "select",
      order: 100,
      label: "CLI color theme",
      labelKey: "settings.l4.cli.theme.label",
    },
    since: "0.1.0",
  },
  statusLine: {
    type: Type.Array(
      Type.Union([
        Type.Literal("model"),
        Type.Literal("thinking"),
        Type.Literal("tokens"),
        Type.Literal("cost"),
        Type.Literal("cwd"),
        Type.Literal("session"),
        Type.Literal("transport"),
      ]),
      { uniqueItems: true, maxItems: 7 },
    ),
    default: ["model", "cwd", "session"],
    runtimeChange: "live",
    allowedScopes: ["managed", "user", "local"],
    ui: {
      tab: "appearance",
      widget: "list",
      order: 110,
      label: "CLI status line items",
      labelKey: "settings.l4.cli.statusLine.label",
    },
    since: "0.1.0",
  },
  keybindingsFile: {
    type: Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]),
    default: null,
    runtimeChange: "restart",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "appearance",
      widget: "text",
      order: 120,
      label: "CLI key bindings file",
      labelKey: "settings.l4.cli.keybindingsFile.label",
    },
    since: "0.1.0",
  },
  outputMode: {
    type: Type.String(),
    default: "text",
    range: { enum: ["text", "json"] },
    runtimeChange: "live",
    allowedScopes: ["managed", "user", "project", "local", "session"],
    ui: {
      tab: "appearance",
      widget: "select",
      order: 130,
      label: "Default output for print mode",
      labelKey: "settings.l4.cli.outputMode.label",
    },
    since: "0.1.0",
  },
});

/** CLI가 엔진 조립에 넘기는 설정 그룹: `l4.cli.*`와 클라이언트 공용 `l4.ui.*`(표시 언어) */
export const cliSettingGroups: readonly SettingGroup<
  SettingNamespace,
  Readonly<Record<string, SettingDefInput>>
>[] = [cliSettings, uiSettings];
