// L1.context.spec §4.7 임계, plan C-6. pi compaction.ts:116-142, 264-270 이식.
// 기본값은 `settings.ts`의 DEFAULT_CONTEXT_SETTINGS 한 곳에만 둔다(BP-06).

export interface CompactionSettings {
  readonly enabled: boolean;
  readonly reserveTokens: number;
  readonly keepRecentTokens: number;
}

/** 컨텍스트 토큰이 창에서 응답 예약분을 뺀 값을 넘으면 참이다(비교는 `>`). 꺼져 있으면 항상 거짓이다 */
export function shouldCompactTokens(
  contextTokens: number,
  contextWindow: number,
  settings: CompactionSettings,
): boolean {
  if (!settings.enabled) return false;
  return contextTokens > contextWindow - settings.reserveTokens;
}
