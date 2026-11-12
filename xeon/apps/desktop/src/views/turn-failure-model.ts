import type { MessageId } from "@fresnel/client/i18n";
import {
  classifyTurnFailure,
  failureReasonOf,
  type TurnFailure,
  type TurnFailureKind,
} from "@fresnel/client";
import { providerNameOf } from "./pages/shared/provider-names.ts";

// 실패한 턴의 오류 문장(`turn.completed.error`)을 사용자 문장과 다음 행동으로 나눈다(SC-06, P-02). 화면 없이 시험한다.
// 종류는 `packages/client`의 `classifyTurnFailure`가 정한다(엔진은 종류를 싣지 않는다). 여기서는 문장과 단추만 고른다.
// 사유 문장(정보 아이콘 뒤)은 `failureReasonOf`가 준다. 서버 본문의 `error.message`이고 시크릿 모양은 가려져 있다.

/**
 * 오류 줄의 단추. 키 넣기와 키 바꾸기는 실패한 턴의 제공자 키 대화 상자를 연다(제공자를 모르면 제공자 목록),
 * 제공자 설정 열기는 제공자 목록, 모델 바꾸기는 입력창 모델 고르기, 다시 보내기는 마지막 사용자 메시지를 다시 보낸다
 */
export type TurnFailureAction =
  | "add-key"
  | "change-key"
  | "open-providers"
  | "change-model"
  | "resend";

export interface TurnFailureView {
  readonly kind: TurnFailureKind;
  readonly text: MessageId;
  readonly action: TurnFailureAction | null;
  /** 문장의 `{provider}`, `{host}`, `{seconds}` 같은 자리 값. 없으면 필드가 없다 */
  readonly params?: Readonly<Record<string, string>>;
  /** 정보 아이콘 뒤에 보일 말: 서버의 사유 문장(시크릿 모양은 `••••`), 사유가 없으면 원문 한 줄 */
  readonly detail: string;
}

const VIEWS: Readonly<
  Record<TurnFailureKind, { readonly text: MessageId; readonly action: TurnFailureAction | null }>
> = {
  no_key: { text: "desktop.turnFailure.noKey", action: "add-key" },
  key_unusable: { text: "desktop.turnFailure.keyUnusable", action: "change-key" },
  auth: { text: "desktop.turnFailure.authAny", action: "change-key" },
  permission_denied: { text: "desktop.turnFailure.permissionDenied", action: "change-model" },
  billing: { text: "desktop.turnFailure.billing", action: null },
  host_mismatch: { text: "desktop.turnFailure.hostMismatch", action: "open-providers" },
  bad_request: { text: "desktop.turnFailure.badRequest", action: null },
  context_overflow: { text: "desktop.turnFailure.contextOverflow", action: "change-model" },
  model_not_found: { text: "desktop.turnFailure.modelNotFound", action: "change-model" },
  rate_limited: { text: "desktop.turnFailure.rateLimited", action: "resend" },
  overloaded: { text: "desktop.turnFailure.overloaded", action: "resend" },
  server: { text: "desktop.turnFailure.server", action: "resend" },
  timeout: { text: "desktop.turnFailure.timeout", action: "resend" },
  network: { text: "desktop.turnFailure.network", action: "resend" },
  interrupted: { text: "desktop.turnFailure.interrupted", action: "resend" },
  unknown: { text: "desktop.turnFailure.unknown", action: "resend" },
};

interface SentenceOf {
  readonly text: MessageId;
  readonly params?: Readonly<Record<string, string>>;
}

/**
 * 종류와 자리 값으로 문장 키를 고른다. 호스트를 모르면 호스트 없는 문장을, 대기 초가 없으면 대기 없는 문장을,
 * 제공자를 모르면 제공자 없는 문장을 쓴다. 401은 제공자 이름을 자리 값으로 싣는다.
 */
function sentenceOf(failure: TurnFailure, provider: string | null): SentenceOf {
  if (failure.kind === "host_mismatch") {
    return failure.params === undefined
      ? { text: "desktop.turnFailure.hostMismatchAny" }
      : { text: VIEWS.host_mismatch.text, params: failure.params };
  }
  if (failure.kind === "rate_limited" && failure.params !== undefined) {
    return { text: "desktop.turnFailure.rateLimitedWait", params: failure.params };
  }
  if (failure.kind === "auth" && provider !== null) {
    return { text: "desktop.turnFailure.auth", params: { provider: providerNameOf(provider) } };
  }
  return { text: VIEWS[failure.kind].text };
}

/**
 * 실패 문장을 화면 문장과 단추로 바꾼다. `provider`는 실패한 턴의 모델 제공자 id다(없으면 null).
 * 같은 문장과 같은 제공자에는 항상 같은 답을 준다.
 */
export function turnFailureOf(error: string, provider: string | null = null): TurnFailureView {
  const failure = classifyTurnFailure(error);
  const sentence = sentenceOf(failure, provider);
  return {
    kind: failure.kind,
    text: sentence.text,
    action: VIEWS[failure.kind].action,
    ...(sentence.params === undefined ? {} : { params: sentence.params }),
    detail: failureReasonOf(error),
  };
}

/**
 * 사이드바 대화 줄에 "보내지 못한 대화" 표시를 달지. 마지막 턴이 실패로 끝났을 때만 참이다.
 * 거울에 실패 문장이 없으면(새로 불러온 대화처럼 알 수 없으면) 거짓이다. 거짓 표시는 달지 않는다.
 */
export function unsentRowOf(failure: string | null): boolean {
  return failure !== null;
}

/** 모델 참조(`provider/modelId[:추론 레벨]`)에서 제공자 id를 꺼낸다. 참조가 없거나 슬래시가 없으면 null이다 */
export function providerOfModelRef(ref: string | null): string | null {
  if (ref === null) return null;
  const slash = ref.indexOf("/");
  return slash <= 0 ? null : ref.slice(0, slash);
}
