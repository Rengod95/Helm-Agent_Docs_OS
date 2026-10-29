import type { Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";

/** 브라우저 동작에서 사람 확인이 필요한 이유(L2.web.spec §4.10.3) */
export type BrowseConfirmReason =
  | "sensitive_click"
  | "cross_origin_form"
  | "after_untrusted_input"
  | "named_profile";

export interface BrowseConfirmRequest {
  readonly threadId: ThreadId | undefined;
  readonly sessionId: string;
  readonly reason: BrowseConfirmReason;
  readonly url: string;
  readonly role?: string;
  readonly name?: string;
  /** 같은 질문을 다시 보내도 새 요청을 만들지 않는 멱등 키 */
  readonly requestKey: string;
}

export type BrowseConfirmError = { readonly kind: "unavailable"; readonly message: string };

/**
 * 사람 확인 포트. 구현은 `xeon.approvals`를 감싸는 조립 쪽 어댑터다. 포트가 없거나 `unavailable`이면 확인이 필요한 동작은
 * `confirmation_denied`로 거부한다(안전한 쪽).
 */
export interface BrowseConfirmPort {
  confirm(
    request: BrowseConfirmRequest,
    signal: AbortSignal,
  ): Promise<Result<"allow" | "deny", BrowseConfirmError>>;
}
