import type { RegistrationId } from "@fresnel/contracts/extensions";

/** 순서 덮어쓰기가 움직이지 못하는 tier 순위. TIERS의 "guard"(0)다. 보안 가드를 항상 맨 앞에 두는 고정은 이 상수와 isPinnedTier 한 곳이다 */
export const PINNED_TIER_RANK = 0;

/** 고정 tier(guard)인가. 순서 덮어쓰기가 이 항목을 옮기거나 이름으로 옮기지 못하게 막는다 */
export function isPinnedTier(rank: number): boolean {
  return rank === PINNED_TIER_RANK;
}

/**
 * 기본 정렬(tier, loadIndex, seq)된 목록에 사용자의 훅별 순서 덮어쓰기를 적용한다. 입력은 고치지 않는다.
 * - 고정 tier 항목은 항상 맨 앞에 주어진 순서대로 남는다. 덮어쓰기는 이들을 옮기지도 이름으로 옮기지도 못한다.
 * - 나머지 항목 중 덮어쓰기에 이름이 있는 항목은, 그 항목들이 차지한 자리에 덮어쓰기 순서(이름의 첫 출현 위치)대로 놓인다.
 *   같은 순서 안에서는 원래 상대 순서를 지킨다.
 * - 이름이 없는 항목은 자리를 지킨다. 목록에 없는 이름은 무시한다.
 * - 같은 scopeId의 항목(한 등록이 한 훅에 `on`을 여러 번 부른 경우)은 같은 순서를 받아 원래 상대 순서를 지킨다.
 */
export function orderEntries<T extends { readonly scopeId: RegistrationId }>(
  sorted: readonly T[],
  tierOf: (entry: T) => number,
  override: readonly string[] | undefined,
): readonly T[] {
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const entry of sorted) {
    if (isPinnedTier(tierOf(entry))) pinned.push(entry);
    else rest.push(entry);
  }
  if (override === undefined || override.length === 0) return [...pinned, ...rest];

  const rankOf = new Map<RegistrationId, number>();
  override.forEach((registrationId, index) => {
    if (!rankOf.has(registrationId)) rankOf.set(registrationId, index);
  });

  // 덮어쓰기에 이름이 있는 항목과, 그 항목이 rest에서 차지한 자리
  const named: { readonly entry: T; readonly slot: number; readonly rank: number }[] = [];
  rest.forEach((entry, slot) => {
    const rank = rankOf.get(entry.scopeId);
    if (rank !== undefined) named.push({ entry, slot, rank });
  });
  const reordered = named.toSorted((a, b) => a.rank - b.rank || a.slot - b.slot);

  const merged = [...rest];
  named.forEach((place, index) => {
    const next = reordered[index];
    if (next !== undefined) merged[place.slot] = next.entry;
  });
  return [...pinned, ...merged];
}
