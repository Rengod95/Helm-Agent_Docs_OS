import { Nullable } from "@xeon/contracts";
import {
  SecretRef,
  defineSettings,
  type SettingDefInput,
  type SettingGroup,
} from "@xeon/contracts/settings";
import { Type, type TBoolean, type TNull, type TString, type TUnion } from "typebox";

/**
 * ext.provider-anthropic-oauth.* 설정 묶음. 고지 동의와 자격 증명 참조가 모두 맞아야 provider를 등록한다
 * (L1.models.spec §4.11.3). `credential`은 비밀 참조(`secret://…`)이고 비밀 값이 아니다.
 * [결정] `credential`은 `secret: true`로 두지 않는다. 비밀 키는 기본값을 둘 수 없고 타입이 SecretRef 하나여야 해서
 * "값 없음(null)"을 기본으로 표현할 수 없다(checkSettingDef D2, D3). 같은 이유로 widget은 "secret"이 아니라 "text"다(D8).
 */
export const providerAnthropicOauthSettings: SettingGroup<
  "ext.provider-anthropic-oauth",
  {
    readonly acknowledgeRisk: SettingDefInput<TBoolean>;
    readonly credential: SettingDefInput<TUnion<[TString, TNull]>>;
  }
> = defineSettings("ext.provider-anthropic-oauth", {
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
  credential: {
    type: Nullable(SecretRef),
    default: null,
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "plugins",
      widget: "text",
      order: 20,
      label: "OAuth 토큰 비밀 참조",
    },
    since: "0.1.0",
  },
});
