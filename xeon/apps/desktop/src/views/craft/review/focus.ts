// 리뷰 화면(C5)이 처음 고를 항목. 리뷰는 고른 항목을 화면 안 상태로만 들어서, 밖에서 연 쪽(테스트 챗 창의 "리뷰에서 보기")이
// 여기에 항목 id를 두고 화면을 옮긴다. 화면은 처음 그릴 때 한 번 가져가고 비운다(트레이스의 `target.ts`와 같은 방식).

let pending: string | null = null;

export function focusReviewItem(itemId: string): void {
  pending = itemId;
}

/** 둔 항목 id를 가져가고 비운다. 없으면 null */
export function takeReviewFocus(): string | null {
  const itemId = pending;
  pending = null;
  return itemId;
}
