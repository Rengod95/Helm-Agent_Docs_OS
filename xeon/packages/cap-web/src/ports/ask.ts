import type { Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";

/** 사용자에게 물어야 하는 이유(L2.web.spec §4.5.3, §4.6.6) */
export type AskReason = "policy_ask" | "unseen_url" | "secret_pattern";

export interface WebAskRequest {
  readonly threadId: ThreadId;
  readonly capability: "web.search" | "web.fetch" | "web.browse";
  readonly host: string;
  readonly reasons: readonly AskReason[];
  /** 같은 호출의 같은 질문을 다시 보내도 새 요청을 만들지 않는 멱등 키(1~48자) */
  readonly requestKey: string;
}

export type WebAskError = { readonly kind: "unavailable"; readonly message: string };

/**
 * 도메인·URL 승인 요청. 구현은 `xeon.approvals`의 L2 공통 포트(`L2ApprovalsPort`)를 감싸는 어댑터다(`ask-adapter.ts`).
 * 기억 범위(이번만, 이 세션, 항상)는 승인 프로토콜이 처리한다.
 */
export interface WebAskPort {
  ask(request: WebAskRequest, signal: AbortSignal): Promise<Result<"allow" | "deny", WebAskError>>;
}
