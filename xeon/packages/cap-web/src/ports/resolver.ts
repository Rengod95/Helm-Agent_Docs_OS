import type { Result } from "@xeon/contracts";

/** DNS 해석 실패. 정책 거부가 아니라 "주소를 얻지 못함"이다 */
export type ResolveError = { readonly kind: "unresolvable"; readonly message: string };

/**
 * 호스트 이름을 모든 A/AAAA 주소로 푼다. SSRF 사전 검사(L2.web.spec §4.6.3)가 쓴다.
 * 연결 시점의 재검증은 전송(`HttpTransport`)이 맡는다. 운영 구현은 `createSystemResolver`, 시험은 `fake-resolver`다.
 */
export interface DnsResolver {
  resolve(host: string, signal: AbortSignal): Promise<Result<readonly string[], ResolveError>>;
}
