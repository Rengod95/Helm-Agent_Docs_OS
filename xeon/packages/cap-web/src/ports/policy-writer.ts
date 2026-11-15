import type { Result } from "@fresnel/contracts";

/** 웹 정책 설정을 쓰지 못한 이유 */
export type WebPolicyWriteError = { readonly kind: "failed"; readonly message: string };

/**
 * 웹 접근 승인의 "계속 허용" 선택을 사용자 범위 설정에 남기는 통로(L2.web.spec §4.5.5). 구현은 조립 루트가 설정 저장소에 잇는다.
 * 쓰기가 실패해도 이번 호출은 허용된 채로 진행한다(사용자가 허용을 눌렀다). 다음에 다시 묻는다.
 */
export interface WebPolicyWriter {
  /** 호스트를 `l2.web.policy.allow`의 user 범위 목록에 더한다. 이미 있으면 그대로 둔다 */
  allowHost(host: string): Promise<Result<void, WebPolicyWriteError>>;
  /** `l2.web.policy.default`를 user 범위에서 `allow`로 둔다 */
  allowAllSites(): Promise<Result<void, WebPolicyWriteError>>;
}
