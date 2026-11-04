// 작업 탭의 "계획 보기"(L4.desktop-ux §7 P-14). 대화 안의 계획 카드는 승인을 기다리는 계획의 승인 카드(`data-approval-kind="plan"`)다.
// 카드를 찾으면 화면 가운데로 스크롤하고 초점을 준다. 이미 처리돼 카드가 없으면 false다(호출한 쪽이 알린다).
// DOM 전체가 아니라 쓰는 면만 받는다: `Document`와 `HTMLElement`가 그대로 맞고, 시험은 대역을 넘긴다.

/** 카드 머리(초점 자리)와 카드 항목에서 쓰는 면 */
export interface PlanCardElement {
  closest(selector: string): PlanCardElement | null;
  scrollIntoView(options: { readonly block: "center" }): void;
  focus(): void;
}

export interface PlanCardRoot {
  querySelector(selector: string): PlanCardElement | null;
}

const ITEM = '[data-slot="approval-card-item"]';

/** 대화 안의 계획 카드를 찾아 스크롤하고 초점을 준다. 카드가 화면에 없으면 false다 */
export function jumpToPlanCard(root: PlanCardRoot): boolean {
  const head = root.querySelector(`${ITEM} [data-approval-kind="plan"]`);
  if (head === null) return false;
  const card = head.closest(ITEM) ?? head;
  card.scrollIntoView({ block: "center" });
  head.focus();
  return true;
}
