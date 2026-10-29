import { defineGroup, type GroupApi, type GroupModule } from "@xeon/group-kit";
import { providerAnthropicOauthManifest } from "./manifest.ts";
import { providerAnthropicOauthSettings } from "./settings.ts";
import { ANTHROPIC_OAUTH_PROVIDER_NAME, anthropicOauthProvider } from "./provider.ts";

/**
 * 그룹 등록. 고지 동의가 참이고 자격 증명 참조가 있을 때만 provider `anthropic-oauth`를 등록한다.
 * 둘 중 하나라도 없으면 아무것도 등록하지 않는다. 그러면 `anthropic-oauth/…` 참조는 provider_unavailable이다(L1.models.spec §5).
 * 설정 값은 setup에서 한 번 읽는다. 값을 바꾸면 scope를 다시 켜야 등록에 반영된다.
 */
function setupProviderAnthropicOauth(
  g: GroupApi<never, typeof providerAnthropicOauthSettings.defs>,
): void {
  const { acknowledgeRisk, credential } = g.settings();
  if (!acknowledgeRisk || credential === null) return;
  g.registerProvider(ANTHROPIC_OAUTH_PROVIDER_NAME, anthropicOauthProvider(credential));
}

/** 기본 꺼짐인 위장 provider 플러그인의 그룹 모듈. 신뢰 등급 user, 설정 네임스페이스 `ext.provider-anthropic-oauth`다 */
export const providerAnthropicOauthGroup: GroupModule = defineGroup<
  never,
  typeof providerAnthropicOauthSettings.defs
>({
  manifest: providerAnthropicOauthManifest,
  settings: providerAnthropicOauthSettings,
  setup: setupProviderAnthropicOauth,
});

/** 외부 로더가 부르는 엔트리(X.loading-trust.spec §4.4.2: named `extension`) */
export const extension: GroupModule["entry"] = providerAnthropicOauthGroup.entry;

export { DISGUISE_RISK_NOTICE, providerAnthropicOauthManifest } from "./manifest.ts";
export { providerAnthropicOauthSettings } from "./settings.ts";
