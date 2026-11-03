import type { RegistrationId } from "@fresnel/contracts/extensions";

/**
 * 기본 정렬(tier, loadIndex, seq)된 목록에 사용자의 훅별 순서 덮어쓰기를 적용한다. 입력은 고치지 않는다.
 * - 덮어쓰기에 이름이 있는 항목은, 그 항목들이 차지한 자리에 덮어쓰기 순서(이름의 첫 출현 위치)대로 놓인다.
 *   같은 순서 안에서는 원래 상대 순서를 지킨다.
 * - 이름이 없는 항목은 자리를 지킨다. 목록에 없는 이름은 무시한다.
 * - guard tier 항목도 덮어쓰기로 옮길 수 있다(2026-11-03 사용자 결정). 덮어쓰기가 없으면 기본 정렬 그대로이고 guard가 앞이다.
 * - 같은 scopeId의 항목(한 등록이 한 훅에 `on`을 여러 번 부른 경우)은 같은 순서를 받아 원래 상대 순서를 지킨다.
 */
export function orderEntries<T extends { readonly scopeId: RegistrationId }>(
  sorted: readonly T[],
  override: readonly string[] | undefined,
): readonly T[] {
  if (override === undefined || override.length === 0) return [...sorted];

  const rankOf = new Map<RegistrationId, number>();
  override.forEach((registrationId, index) => {
    if (!rankOf.has(registrationId)) rankOf.set(registrationId, index);
  });

  // 덮어쓰기에 이름이 있는 항목과, 그 항목이 기본 정렬에서 차지한 자리
  const named: { readonly entry: T; readonly slot: number; readonly rank: number }[] = [];
  sorted.forEach((entry, slot) => {
    const rank = rankOf.get(entry.scopeId);
    if (rank !== undefined) named.push({ entry, slot, rank });
  });
  const reordered = named.toSorted((a, b) => a.rank - b.rank || a.slot - b.slot);

  const merged = [...sorted];
  named.forEach((place, index) => {
    const next = reordered[index];
    if (next !== undefined) merged[place.slot] = next.entry;
  });
  return merged;
}
