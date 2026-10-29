import type { ProviderResourceDef } from "@xeon/contracts/extensions";

/** provider 등록 이름. 모델 참조는 `anthropic-oauth/<모델 id>`가 된다 */
export const ANTHROPIC_OAUTH_PROVIDER_NAME: string = "anthropic-oauth";

/**
 * 위장 provider의 JSON 정의(kind `config`). 키는 설정의 비밀 참조만 받는다(리터럴은 포트가 거부한다).
 * provider id가 기본 `anthropic`이 아니므로 core-models 가드(L1.models.spec §3.9)는 이 등록을 막지 않는다.
 * 요청 모양은 pi-ai 내장 OAuth 분기가 정한다. 와이어 동등 래퍼는 만들지 않는다 [미결 M-8].
 * 모델 세 개는 pi-ai 1.3.0 내장 카탈로그(providers/data/anthropic.json)에서 옮겼다. 비용은 기본 구간 값이다.
 */
export function anthropicOauthProvider(credential: string): ProviderResourceDef {
  return {
    kind: "config",
    name: "Anthropic OAuth",
    baseUrl: "https://api.anthropic.com",
    api: "anthropic-messages",
    apiKey: credential,
    models: [
      {
        id: "claude-opus-5-5",
        name: "Claude Opus 5.5",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
      },
      {
        id: "claude-sonnet-5-5",
        name: "Claude Sonnet 5.5",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
      },
      {
        id: "claude-haiku-5-5",
        name: "Claude Haiku 5.5",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
      },
    ],
  };
}
