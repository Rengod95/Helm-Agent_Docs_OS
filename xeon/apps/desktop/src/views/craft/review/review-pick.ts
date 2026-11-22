// 다른 화면이 리뷰 화면에 "이 항목을 열어 달라"고 건네는 한 칸(m6Mb). 플러그인 상세의 구성원 탭이 리뷰로 보낸 뒤 "리뷰에서 보기"로 쓴다.
// 리뷰 화면은 처음 그릴 때 읽고(`peekReviewItem`, 개발 모드의 두 번 부르기에도 같은 값), 그린 뒤 비운다(`clearReviewItem`).

let requested: string | null = null;

/** 리뷰 화면이 다음에 열릴 때 고를 항목 */
export function requestReviewItem(itemId: string): void {
  requested = itemId;
}

/** 건넨 항목. 없으면 null */
export function peekReviewItem(): string | null {
  return requested;
}

/** 건넨 항목을 따랐다. 다음에 화면을 열면 처음 항목부터 보인다 */
export function clearReviewItem(): void {
  requested = null;
}
