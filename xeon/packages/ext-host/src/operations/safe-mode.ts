import type { ExtensionManifest, ExtensionName } from "@xeon/contracts/extensions";
import type { Tier } from "./tier.ts";

/** 안전 모드를 켠 경로(X.operations.spec §4.6.1) */
export type SafeModeSource = "flag" | "env" | "setting" | "command";

export interface StartupOptions {
  readonly safeMode: { readonly active: boolean; readonly source?: SafeModeSource };
  /** --disable-ext로 받은 이름. 이번 시작에만 적용한다 */
  readonly disabled: readonly ExtensionName[];
}

/** 안전 모드도 개별 끄기도 쓰지 않는 시작 옵션 */
export const NO_STARTUP_OPTIONS: StartupOptions = { safeMode: { active: false }, disabled: [] };

export interface LoadCandidate {
  readonly name: ExtensionName;
  readonly tier: Tier;
  readonly layer: ExtensionManifest["layer"];
}

export type SkipReason = "safe_mode" | "disabled_flag";

/**
 * 안전 모드에서도 싣는 대상인지(X.operations.spec §4.6.2). `guard`·`core` tier와 L1·L2 내장 패키지는 켜짐이다.
 * L3 내장 그룹과 `user`·`project` tier(기본 플러그인 Helm 포함)는 꺼진다 [결정: review.m3-design-inputs D-M3-07 a]
 */
export function allowedInSafeMode(candidate: LoadCandidate): boolean {
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
    if (options.disabled.includes(candidate.name)) {
      skipped.push({ name: candidate.name, reason: "disabled_flag" });
    } else if (options.safeMode.active && !allowedInSafeMode(candidate)) {
      skipped.push({ name: candidate.name, reason: "safe_mode" });
    } else {
      load.push(candidate);
    }
  }
  return { load, skipped };
}

/** 연속 시작 실패 기록 포트. 구현과 파일 위치는 L4.host-service.spec [가정] */
export interface StartupHealthStore {
  /** 이번 시작을 "진행 중"으로 표시하고 직전까지의 연속 실패 수를 돌려준다 */
  beginStartup(): number;
  /** 첫 사용자 입력을 받을 준비가 되면 부른다. 연속 실패 수를 0으로 */
  markStarted(): void;
}

/** 순수 함수. 연속 실패 수가 기준 이상이면 시작 화면에 안전 모드를 제안한다 */
export function shouldSuggestSafeMode(consecutiveFailures: number, threshold: number): boolean {
  return consecutiveFailures >= threshold;
}
