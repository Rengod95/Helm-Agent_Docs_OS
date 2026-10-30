import { defineManifest } from "@xeon/contracts/extensions";
import type { GroupManifest } from "@xeon/group-kit";

/**
 * 약관 위험 고지 문구. 매니페스트 userConfig 설명이고, 설정 화면은 켜기 전에 이 문구를 보인다(L1.models.spec §4.11.3).
 * 이 그룹은 공개 배포판에 들어가지 않는다. 위험은 켠 사용자가 진다.
 */
export const DISGUISE_RISK_NOTICE: string =
  "이 플러그인은 Claude 구독 OAuth 토큰으로 Claude Code 클라이언트와 같은 모양의 요청을 보냅니다. Anthropic 이용 약관에 어긋날 수 있고 계정이 제한되거나 정지될 수 있습니다. 공개 배포판에는 들어 있지 않으며, 켜면 그 위험을 사용자가 집니다.";

/** 플러그인 산출물(`.xeon-plugin/plugin.json`)이 옮겨 쓰는 매니페스트 상수. 기본 꺼짐이고 엔트리는 번들(dist)을 가리킨다 */
export const providerAnthropicOauthManifest: GroupManifest = defineManifest({
  schemaVersion: 1,
  name: "provider-anthropic-oauth",
  version: "0.1.0",
  displayName: "Anthropic OAuth provider",
  description: "Claude 구독 OAuth 토큰으로 Anthropic provider를 여는 위장 provider(기본 꺼짐)",
  layer: "L3",
  kind: "group",
  entry: "./dist/index.js",
  defaultEnabled: false,
  usesDrive: false,
  points: [],
  trust: { level: "user" },
  userConfig: {
    acknowledgeRisk: {
      setting: "ext.provider-anthropic-oauth.acknowledgeRisk",
      title: "약관 위험 고지에 동의",
      description: DISGUISE_RISK_NOTICE,
      required: false,
    },
    credential: {
      setting: "ext.provider-anthropic-oauth.credential",
      title: "OAuth 토큰",
      sensitive: true,
      required: false,
    },
  },
});
