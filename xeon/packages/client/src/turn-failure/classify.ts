// 실패한 turn의 오류 문장(`turn.completed.error`)을 종류로 나눈다. 엔진은 종류를 문장에 싣지 않으므로 문장 앞의 상태 코드,
// 호스트 표지, 제공자 오류 이름으로 가른다. 화면(desktop)과 CLI가 같은 판정을 쓰고 문구는 각자 고른다. 순수 함수다.
// 판정 순서: 끊김 접두 > 호스트 불일치 > 상태 코드 > 이름 (L1.models.spec §3.8, §4.5).

/** 앞부분 답이 온 뒤 끊긴 스트림의 종결 접두. core-models `classify.ts`의 `STREAM_INTERRUPTED_PREFIX`와 같은 값이다 */
export const STREAM_INTERRUPTED_PREFIX = "stream_interrupted: ";

export type TurnFailureKind =
  | "auth"
  | "permission_denied"
  | "host_mismatch"
  | "bad_request"
  | "context_overflow"
  | "model_not_found"
  | "rate_limited"
  | "server"
  | "network"
  | "interrupted"
  | "unknown";

export interface TurnFailure {
  readonly kind: TurnFailureKind;
  /** 자리 값. `host_mismatch`는 `host`, `rate_limited`는 서버가 알린 대기 `seconds`를 싣는다. 없으면 필드가 없다 */
  readonly params?: Readonly<Record<string, string>>;
}

const STATUS_PREFIX = /^\s*(\d{3})\b/;
// 엔진(secrets-bridge)이 `denied: host_mismatch, host=<요청 호스트>`로 싣는다
const HOST_MISMATCH = /denied: host_mismatch(?:, host=(\S+?))?\)?(?:\s|$)/;
// 재시도 한도를 넘긴 429에 서버가 대기를 알렸을 때 문장 끝에 붙는 표지(core-models pipeline의 markedErrorText)
const RETRY_AFTER = /\[retry-after=(\d+)\]/;
const OWN_KIND = /^\s*([a-z_]+):/;
const CONTEXT_OVERFLOW =
  /prompt is too long|context length|maximum context|exceeds the context window/i;
const NETWORK =
  /connection (?:error|refused|reset|closed)|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|network|timed? ?out|provider_unavailable/i;

/** 상태 코드 줄로 가른다. 맞는 종류가 없으면 null이다 */
function statusKind(status: number, error: string): TurnFailureKind | null {
  if (status === 401) return "auth";
  if (status === 403) return "permission_denied";
  if (status === 404) return "model_not_found";
  if (status === 429) return "rate_limited";
  // 문맥 넘침은 400이다. bad_request보다 먼저 본다
  if (status === 400 && CONTEXT_OVERFLOW.test(error)) return "context_overflow";
  if (status >= 500 && status <= 599) return "server";
  if (status >= 400 && status <= 499) return "bad_request";
  return null;
}

/** 상태 코드가 없는 문장을 제공자 오류 이름과 본문 말로 가른다 */
function nameKind(error: string): TurnFailureKind {
  const own = OWN_KIND.exec(error)?.[1];
  if (own === "secret_unresolved" || own === "oauth_token_on_default_provider") return "auth";
  if (own === "model_not_found" || own === "model_unavailable") return "model_not_found";
  if (own === "provider_unavailable") return "network";
  if (/permission_error|forbidden/i.test(error)) return "permission_denied";
  if (/authentication_error|unauthori[sz]ed|invalid x-api-key/i.test(error)) return "auth";
  if (/model_not_found|not_found_error/i.test(error)) return "model_not_found";
  if (/rate_limit_error|rate.?limit|too many requests/i.test(error)) return "rate_limited";
  if (/overloaded_error|overloaded/i.test(error)) return "server";
  if (/invalid_request_error/i.test(error)) return "bad_request";
  if (NETWORK.test(error)) return "network";
  return "unknown";
}

/** 실패한 turn의 오류 문장을 종류와 자리 값으로 나눈다. 같은 문장에는 항상 같은 답을 준다 */
export function classifyTurnFailure(error: string): TurnFailure {
  if (error.startsWith(STREAM_INTERRUPTED_PREFIX)) return { kind: "interrupted" };
  const mismatch = HOST_MISMATCH.exec(error);
  if (mismatch !== null) {
    const host = mismatch[1];
    return host === undefined
      ? { kind: "host_mismatch" }
      : { kind: "host_mismatch", params: { host } };
  }
  const status = STATUS_PREFIX.exec(error)?.[1];
  const kind = (status === undefined ? null : statusKind(Number(status), error)) ?? nameKind(error);
  if (kind !== "rate_limited") return { kind };
  const seconds = RETRY_AFTER.exec(error)?.[1];
  return seconds === undefined ? { kind } : { kind, params: { seconds } };
}
