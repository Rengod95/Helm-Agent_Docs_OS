import type { MessageId } from "@fresnel/client/i18n";

// 실패한 턴의 오류 문장(`turn.completed.error`)을 사용자 문장과 다음 행동으로 나눈다(SC-06, P-02). 화면 없이 시험한다.
// 엔진은 오류 종류(`ModelErrorKind`)를 이 문장에 싣지 않는다. 엔진 계약을 바꾸지 않고 문장 앞의 상태 코드와 제공자 오류 이름으로 나눈다.

type TurnFailureKind =
  | "auth"
  | "bad_request"
  | "model_not_found"
  | "rate_limited"
  | "server"
  | "network"
  | "unknown";

/** 오류 줄의 단추. 키 다시 등록은 설정 > 시크릿, 모델 바꾸기는 입력창 모델 고르기, 다시 보내기는 마지막 사용자 메시지를 다시 보낸다 */
export type TurnFailureAction = "reregister-key" | "change-model" | "resend";

export interface TurnFailureView {
  readonly kind: TurnFailureKind;
  readonly text: MessageId;
  readonly action: TurnFailureAction | null;
  /** 정보 아이콘 뒤 "자세히"에 보일 원문 */
  readonly detail: string;
}

const STATUS_PREFIX = /^\s*(\d{3})\b/;
const OWN_KIND = /^\s*([a-z_]+):/;
const NETWORK =
  /connection (?:error|refused|reset|closed)|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|network|timed? ?out|provider_unavailable/i;

function statusKind(status: number): TurnFailureKind | null {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "model_not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500 && status <= 599) return "server";
  if (status >= 400 && status <= 499) return "bad_request";
  return null;
}

function kindOf(error: string): TurnFailureKind {
  const own = OWN_KIND.exec(error)?.[1];
  if (own === "secret_unresolved" || own === "oauth_token_on_default_provider") return "auth";
  if (own === "model_not_found" || own === "model_unavailable") return "model_not_found";
  if (own === "provider_unavailable") return "network";
  const status = STATUS_PREFIX.exec(error)?.[1];
  if (status !== undefined) {
    const byStatus = statusKind(Number(status));
    if (byStatus !== null) return byStatus;
  }
  if (/authentication_error|permission_error|invalid x-api-key/i.test(error)) return "auth";
  if (/model_not_found|not_found_error/i.test(error)) return "model_not_found";
  if (/rate_limit_error|rate.?limit|too many requests/i.test(error)) return "rate_limited";
  if (/overloaded_error|overloaded/i.test(error)) return "server";
  if (/invalid_request_error/i.test(error)) return "bad_request";
  if (NETWORK.test(error)) return "network";
  return "unknown";
}

const VIEWS: Readonly<
  Record<TurnFailureKind, { readonly text: MessageId; readonly action: TurnFailureAction | null }>
> = {
  auth: { text: "desktop.turnFailure.auth", action: "reregister-key" },
  bad_request: { text: "desktop.turnFailure.badRequest", action: null },
  model_not_found: { text: "desktop.turnFailure.modelNotFound", action: "change-model" },
  rate_limited: { text: "desktop.turnFailure.rateLimited", action: "resend" },
  server: { text: "desktop.turnFailure.server", action: "resend" },
  network: { text: "desktop.turnFailure.network", action: "resend" },
  unknown: { text: "desktop.turnFailure.unknown", action: "resend" },
};

export function turnFailureOf(error: string): TurnFailureView {
  const kind = kindOf(error);
  return { kind, ...VIEWS[kind], detail: error };
}
