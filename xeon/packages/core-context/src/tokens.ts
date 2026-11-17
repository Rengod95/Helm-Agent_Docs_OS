// 문맥 추정 토큰 셈. 조립(`assemble.ts`)의 절 토큰과 호스트의 프로필 비용 추정(M5c §4.2.8)이 같은 값을 쓴다.

/** 글자 수 / 4 올림. pi-ai 추정과 같은 규칙이다 */
export function textTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
