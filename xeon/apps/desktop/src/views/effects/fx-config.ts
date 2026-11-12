// 이펙트 배치 설정(dzE 시안 §2.5, DP-126 [결정: 2026-11-12 사용자]). 오로라를 어디에 둘지 이 값 하나로 바꾼다.
// 추천은 입력창(composer): 턴마다 늘 보이는 자리라서다. 지금 띠(strip)는 할 일·에이전트·주도가 있을 때만 서므로 대안으로 남긴다.
// 견본·검수에서는 `<html data-fx-aurora="strip">`로 덮어 견줄 수 있다.

export type AuroraSite = "composer" | "strip" | "both" | "off";

/** 제품 기본값 */
export const AURORA_SITE: AuroraSite = "composer";

function isAuroraSite(value: string | undefined): value is AuroraSite {
  return value === "composer" || value === "strip" || value === "both" || value === "off";
}

/** 지금 쓰는 자리. `<html data-fx-aurora>`가 있으면 그 값, 없으면 AURORA_SITE */
function auroraSiteOf(): AuroraSite {
  if (typeof document === "undefined") return AURORA_SITE;
  const value = document.documentElement.dataset["fxAurora"];
  return isAuroraSite(value) ? value : AURORA_SITE;
}

/** 이 자리에 오로라를 그리는가 */
export function auroraOn(
  site: "composer" | "strip",
  current: AuroraSite = auroraSiteOf(),
): boolean {
  return current === "both" || current === site;
}
