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

/** 초점을 돌려줄 자리: 다음 대기 카드, 또는 입력창 */
export type FocusReturn<T> =
  | { readonly kind: "card"; readonly id: T }
  | { readonly kind: "composer" };

/** 초점이 문서 맨 위(BODY)로 떨어졌는지. 초점이 있던 요소가 사라지면 브라우저가 BODY로 둔다 */
export function focusIsLost(active: { readonly tagName: string } | null): boolean {
  return active === null || active.tagName === "BODY";
}

/**
 * 승인 카드가 사라진 뒤 초점 자리(1-1). 대기 목록이 줄었고 초점이 BODY로 떨어졌을 때만 돌려준다.
 * 사라진 카드의 뒤쪽에서 아직 남은 첫 카드, 없으면 남은 첫 카드, 하나도 없으면 입력창이다.
 */
export function focusAfterApprovalChange<T>(
  before: readonly T[],
  after: readonly T[],
  lost: boolean,
): FocusReturn<T> | null {
  if (!lost) return null;
  const removed = before.findIndex((id) => !after.includes(id));
  if (removed === -1) return null;
  const following = before.slice(removed + 1).find((id) => after.includes(id));
  const target = following ?? after[0];
  return target === undefined ? { kind: "composer" } : { kind: "card", id: target };
}

/** 턴이 끝났을 때(진행 중 → 아님) 초점이 BODY면 입력창으로 간다 */
export function focusAfterTurnEnd(wasRunning: boolean, running: boolean, lost: boolean): boolean {
  return wasRunning && !running && lost;
}
