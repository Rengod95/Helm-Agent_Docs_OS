// L2.web.spec §4.10.3. 사람 확인이 필요한 요소 어휘(영어·한국어). 판정은 완전하지 않다: 브라우저 세션이 격리된 새 프로필인 것이 1차 방어다.

const ENGLISH = [
  "pay",
  "purchase",
  "buy",
  "order",
  "checkout",
  "transfer",
  "send",
  "post",
  "publish",
  "delete",
  "remove",
  "agree",
  "accept",
  "confirm",
  "submit",
] as const;

const KOREAN = ["결제", "구매", "주문", "송금", "전송", "게시", "삭제", "동의", "약관"] as const;

const ENGLISH_PATTERN = new RegExp(`\\b(?:${ENGLISH.join("|")})`, "iu");

/** 요소의 이름·역할이 결제·구매·주문·송금·전송·게시·삭제·약관 동의 어휘에 맞는가. 순수 함수 */
export function isSensitiveTarget(target: {
  readonly role: string;
  readonly name?: string;
}): boolean {
  const name = target.name ?? "";
  if (ENGLISH_PATTERN.test(name)) return true;
  return KOREAN.some((word) => name.includes(word));
}
