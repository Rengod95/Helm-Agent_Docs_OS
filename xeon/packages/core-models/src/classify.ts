import { isContextOverflow, isRetryableAssistantError } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@fresnel/contracts/conversation";
import type { ModelErrorKind } from "@fresnel/contracts/services";

// L1.models.spec §3.8 classify 규칙, plan M-1.
//
// pi-ai는 재시도 불가 한도 패턴(NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN)과 재시도 가능 패턴을 내보내지 않고
// isRetryableAssistantError만 내보낸다. 그래서 4번(quota_exhausted)은 오류 문구 뒤에 재시도 가능 표지("429")를 붙여도
// pi-ai가 재시도 불가로 보는 경우, 곧 재시도 불가 한도 패턴이 맞은 경우로 판정한다. 5~8번의 상태 코드·문구 구분은 spec 그대로 errorMessage에서 읽는다 [가정: pi-ai 오류 메시지가
// 상태 코드나 오류 이름을 담는다].

/** Fresnel이 직접 만든 오류 종결 메시지의 접두 `<kind>: `. 파이프라인이 붙이고 classify가 읽는다 */
const OWN_ERROR_KINDS: readonly ModelErrorKind[] = [
  "provider_unavailable",
  "secret_unresolved",
  "model_not_found",
  "oauth_token_on_default_provider",
];

/**
 * 앞부분 답이 이미 온 뒤 끊긴 스트림의 종결 메시지 접두. 파이프라인이 붙이고 classify가 transport로 읽는다.
 * ModelErrorKind가 아니다(화면은 이 접두로 "중간에 끊겼다"를 알 수 있다). L1.models.spec §4.5
 */
export const STREAM_INTERRUPTED_PREFIX = "stream_interrupted: ";

/** pi-ai 재시도 가능 패턴에 항상 맞는 표지. 한도 패턴(재시도 불가)이 우선하는지 알아보는 데만 쓴다 */
const RETRYABLE_MARKER = "429";
const RATE_LIMIT = /\b429\b|rate.?limit|too many requests/i;
const OVERLOADED = /\b(?:529|503)\b|overloaded/i;
// 403과 permission_error는 키는 맞는데 이 키로 이 모델을 못 쓴다는 뜻이라 auth와 나눈다
const PERMISSION = /\b403\b|permission_error|forbidden/i;
const AUTH = /\b401\b|unauthori[sz]ed|authentication_error/i;
const TRANSPORT =
  /ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|socket hang up|connection (?:error|refused|reset|closed)|timed? ?out/i;

function ownKind(message: string): ModelErrorKind | null {
  for (const kind of OWN_ERROR_KINDS) {
    if (message.startsWith(`${kind}:`)) return kind;
  }
  return null;
}

/** 순수 함수. 종결 메시지가 오류가 아니면 null */
export function classifyMessage(
  message: AssistantMessage,
  contextWindow?: number,
): ModelErrorKind | null {
  if (message.stopReason === "aborted") return "aborted";
  if (isContextOverflow(message, contextWindow)) return "context_overflow";
  if (message.stopReason !== "error") return null;

  const text = message.errorMessage ?? "";
  const own = ownKind(text);
  if (own !== null) return own;
  if (text.startsWith(STREAM_INTERRUPTED_PREFIX)) return "transport";
  if (!isRetryableAssistantError({ ...message, errorMessage: `${text} ${RETRYABLE_MARKER}` })) {
    return "quota_exhausted";
  }
  if (RATE_LIMIT.test(text)) return "rate_limited";
  if (OVERLOADED.test(text)) return "overloaded";
  if (PERMISSION.test(text)) return "permission_denied";
  if (AUTH.test(text)) return "auth";
  if (TRANSPORT.test(text)) return "transport";
  return "provider_error";
}
