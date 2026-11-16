import type { Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";

/** 사용자에게 물어야 하는 이유(L2.web.spec §4.5.3, §4.6.6) */
export type AskReason = "policy_ask" | "unseen_url" | "secret_pattern";

/** 승인 카드가 고르게 하는 기억 범위: 이번만, 이 사이트 계속 허용, 모든 사이트 허용 */
export type WebAskScope = "once" | "site" | "all";

/** 사용자의 답. `allow_site`와 `allow_all`은 허용이면서 정책 설정에 남기라는 뜻이다 */
export type WebAskAnswer = "allow" | "deny" | "allow_site" | "allow_all";

export interface WebAskRequest {
  readonly threadId: ThreadId;
  readonly capability: "web.search" | "web.fetch" | "web.browse";
  readonly host: string;
  /** 승인 카드에 보일 전체 URL. 시크릿 의심(`secret_pattern`)이면 출처만 싣는다(승인 기록에 시크릿이 남지 않게) */
  readonly url: string;
  readonly reasons: readonly AskReason[];
  /** 이 질문이 제안하는 기억 범위. 첫 값은 항상 `once`다. 시크릿 의심 질문은 `["once"]`뿐이다 */
  readonly scopes: readonly WebAskScope[];
  /** 같은 호출의 같은 질문을 다시 보내도 새 요청을 만들지 않는 멱등 키(1~48자) */
  readonly requestKey: string;
}

export type WebAskError = { readonly kind: "unavailable"; readonly message: string };

/**
 * 도메인·URL 승인 요청. 구현은 `fresnel.approvals`의 L2 공통 포트(`L2ApprovalsPort`)를 감싸는 어댑터다(`ask-adapter.ts`).
 * 선택한 기억 범위는 `WebAskAnswer`로 돌아오고 설정에 쓰는 일은 호출자(`access.ts`)가 `WebPolicyWriter`로 한다.
 */
export interface WebAskPort {
  ask(request: WebAskRequest, signal: AbortSignal): Promise<Result<WebAskAnswer, WebAskError>>;
}
