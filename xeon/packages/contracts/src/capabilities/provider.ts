import { Type, type TString } from "typebox";

/** 내장 provider는 소문자 이름, 플러그인 provider는 "plugin:<확장 이름>" */
export const PROVIDER_ID_PATTERN: string = "^(plugin:[a-z][a-z0-9-]{1,31}|[a-z][a-z0-9-]{0,63})$";
export const ProviderIdSchema: TString = Type.String({
  pattern: PROVIDER_ID_PATTERN,
  maxLength: 96,
});
export type ProviderId = string;
export type ProviderOrigin = "plugin" | "detected" | "builtin";

export type ProviderAvailability =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly detail?: string };

export interface ProviderFallback {
  readonly provider: ProviderId;
  /** probe = isAvailable 실패, call = 호출 중 오류(safe 메서드만) */
  readonly stage: "probe" | "call";
  /** probe면 ProviderAvailability.reason, call이면 CapabilityErrorData.code */
  readonly reason: string;
  readonly detail?: string;
}

/** provider 체인을 거친 메서드 출력의 meta에 싣는다 */
export interface ProviderSelectionMeta {
  readonly provider: ProviderId;
  readonly selectedBy: "call" | "setting" | "auto";
  readonly fallbacks: readonly ProviderFallback[];
}

export interface ProviderCandidate {
  readonly id: ProviderId;
  readonly origin: ProviderOrigin;
}

export interface ProviderOrderInput {
  readonly candidates: readonly ProviderCandidate[];
  readonly callProvider?: ProviderId;
  /** 설정 l2.<domain>.<능력>.provider. "auto" 또는 provider id */
  readonly settingProvider: ProviderId;
  /** 설정 l2.<domain>.<능력>.pluginOrder */
  readonly pluginOrder: readonly ProviderId[];
}

function byBytes(a: ProviderCandidate, b: ProviderCandidate): number {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * 시도할 순서. 순수 함수. 명시 선택(호출 인자, 설정)이면 원소 하나, 후보에 없으면 빈 배열이다.
 * auto이면 plugin(pluginOrder 순, 목록에 없는 플러그인은 그 뒤에 id 바이트 순) → detected → builtin(각각 id 바이트 순).
 */
export function orderProviderCandidates(input: ProviderOrderInput): {
  readonly selectedBy: "call" | "setting" | "auto";
  readonly order: readonly ProviderId[];
} {
  const known = (id: ProviderId): boolean => input.candidates.some((c) => c.id === id);
  if (input.callProvider !== undefined) {
    return {
      selectedBy: "call",
      order: known(input.callProvider) ? [input.callProvider] : [],
    };
  }
  if (input.settingProvider !== "auto") {
    return {
      selectedBy: "setting",
      order: known(input.settingProvider) ? [input.settingProvider] : [],
    };
  }
  const plugins = input.candidates.filter((c) => c.origin === "plugin");
  const listed: ProviderCandidate[] = [];
  for (const id of input.pluginOrder) {
    const hit = plugins.find((c) => c.id === id);
    if (hit !== undefined && !listed.includes(hit)) listed.push(hit);
  }
  const unlisted = plugins.filter((c) => !listed.includes(c)).toSorted(byBytes);
  const detected = input.candidates.filter((c) => c.origin === "detected").toSorted(byBytes);
  const builtin = input.candidates.filter((c) => c.origin === "builtin").toSorted(byBytes);
  return {
    selectedBy: "auto",
    order: [...listed, ...unlisted, ...detected, ...builtin].map((c) => c.id),
  };
}
