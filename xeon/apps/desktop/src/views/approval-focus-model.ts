// 바로 가기 `approval.next`(⌘⇧A, spec §4.8)의 순수 부분. 대기 승인 목록(엔진 거울의 순서)에서 다음 카드를 고른다.
// 카드를 찾아 초점을 주는 DOM 일은 `app.tsx`가 맡는다.

/**
 * 초점이 있는 카드의 다음 카드. 초점이 없거나 목록에 없으면 첫 카드이고, 마지막 카드에서는 처음으로 돈다.
 * 대기 승인이 없으면 `null`이다(그러면 아무 일도 하지 않는다).
 */
export function nextApprovalId<T>(pending: readonly T[], current: T | null): T | null {
  const first = pending[0];
  if (first === undefined) return null;
  const index = current === null ? -1 : pending.indexOf(current);
  if (index === -1) return first;
  return pending[(index + 1) % pending.length] ?? first;
}
