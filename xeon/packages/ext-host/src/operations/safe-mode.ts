import type { ExtensionLayer, ExtensionName } from "@fresnel/contracts/extensions";
import type { HookId, Tier } from "./tier.ts";

/** 안전 모드를 켠 경로(X.operations.spec §4.6.1) */
export type SafeModeSource = "flag" | "env" | "setting" | "command";

export interface StartupOptions {
  readonly safeMode: { readonly active: boolean; readonly source?: SafeModeSource };
  /** --disable-ext로 받은 이름. 이번 시작에만 적용한다 */
  readonly disabled: readonly ExtensionName[];
}

/** 안전 모드도 개별 끄기도 쓰지 않는 시작 옵션 */
export const NO_STARTUP_OPTIONS: StartupOptions = { safeMode: { active: false }, disabled: [] };

/** 확장 로드 후보. `kind`는 생략할 수 있다(옛 호출자) */
interface ExtensionLoadCandidate {
  readonly kind?: "extension";
  readonly name: ExtensionName;
  readonly tier: Tier;
  readonly layer: ExtensionLayer;
}

/**
 * 외부 훅(X 훅) 로드 후보(X-20, 사용자 결정: 안전 모드에서 X 훅도 싣지 않는다). `name`은 훅 id다.
 * 외부 훅 로더(M4)는 훅을 싣기 전에 `startupFilter`에 이 후보를 넘긴다
 */
interface HookLoadCandidate {
  readonly kind: "hook";
  readonly name: HookId;
  readonly tier: Tier;
}

export type LoadCandidate = ExtensionLoadCandidate | HookLoadCandidate;

export type SkipReason = "safe_mode" | "disabled_flag";

/**
 * 안전 모드에서도 싣는 대상인지(X.operations.spec §4.6.2). `guard`·`core` tier와 L1·L2 내장 패키지는 켜짐이다.
 * L3 내장 그룹과 `user`·`project` tier(기본 플러그인 Helm 포함)는 꺼진다 [결정: review.m3-design-inputs D-M3-07 a].
 * 외부 훅(X 훅)은 모두 꺼진다 [결정: 사용자 2026-11-01 안전 모드 X 훅 제외]
 */
export function allowedInSafeMode(candidate: LoadCandidate): boolean {
  // 외부 훅은 tier와 상관없이 안전 모드에서 싣지 않는다(X-20)
  if (candidate.kind === "hook") return false;
  if (candidate.tier === "guard" || candidate.tier === "core") return true;
  if (candidate.tier === "builtin") return candidate.layer === "L1" || candidate.layer === "L2";
  return false;
}

/** 순수 함수. 로드 후보에서 꺼지는 대상을 빼고 사유를 남긴다. `--disable-ext`가 안전 모드보다 먼저 사유가 된다 */
export function startupFilter(
  candidates: readonly LoadCandidate[],
  options: StartupOptions,
): {
  readonly load: readonly LoadCandidate[];
  readonly skipped: readonly { readonly name: ExtensionName; readonly reason: SkipReason }[];
} {
  const load: LoadCandidate[] = [];
  const skipped: { readonly name: ExtensionName; readonly reason: SkipReason }[] = [];
  for (const candidate of candidates) {
    // `--disable-ext`는 확장 이름만 가리킨다. 훅 id가 확장 이름과 같아도 훅에는 적용하지 않는다
    if (candidate.kind !== "hook" && options.disabled.includes(candidate.name)) {
      skipped.push({ name: candidate.name, reason: "disabled_flag" });
    } else if (options.safeMode.active && !allowedInSafeMode(candidate)) {
      skipped.push({ name: candidate.name, reason: "safe_mode" });
    } else {
      load.push(candidate);
    }
  }
  return { load, skipped };
}

/** 순수 함수. 연속 실패 수가 기준 이상이면 시작 화면에 안전 모드를 제안한다 */
export function shouldSuggestSafeMode(consecutiveFailures: number, threshold: number): boolean {
  return consecutiveFailures >= threshold;
}
