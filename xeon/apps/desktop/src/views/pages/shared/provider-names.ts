import { PRESET_PROVIDERS } from "@fresnel/client/settings";

// 모델 제공자의 보이는 이름과 글자 표지(DP-83 [결정: 2026-11-11 사용자]). 로고는 쓰지 않는다. 알려진 제공자만 고유 이름이 있고,
// 나머지는 id 그대로다. 호스트는 "제공자 추가"의 고르기 카드에 곁 정보로만 보인다(요청은 엔진 카탈로그의 주소를 쓴다).

interface KnownProvider {
  readonly name: string;
  readonly host: string;
}

const KNOWN: Readonly<Record<string, KnownProvider>> = {
  anthropic: { name: "Anthropic", host: "api.anthropic.com" },
  openai: { name: "OpenAI", host: "api.openai.com" },
  google: { name: "Google", host: "generativelanguage.googleapis.com" },
  openrouter: { name: "OpenRouter", host: "openrouter.ai" },
};

/** 알려진 제공자 id. 고르기 카드의 순서다 */
export const KNOWN_PROVIDER_IDS: readonly string[] = PRESET_PROVIDERS;

export function isKnownProvider(id: string): boolean {
  return Object.hasOwn(KNOWN, id);
}

export function providerNameOf(id: string): string {
  return KNOWN[id]?.name ?? id;
}

export function providerHostOf(id: string): string | null {
  return KNOWN[id]?.host ?? null;
}

/** 글자 표지: 이름의 첫 글자(대문자). 비면 "?" */
export function providerMarkOf(id: string): string {
  const first = providerNameOf(id).trim().charAt(0);
  return first === "" ? "?" : first.toUpperCase();
}

/** `provider/model`의 provider. 빗금이 없으면 전체다 */
export function providerOfRef(ref: string): string {
  const slash = ref.indexOf("/");
  return slash < 0 ? ref : ref.slice(0, slash);
}
