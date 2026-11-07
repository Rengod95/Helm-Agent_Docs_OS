import type { MessageId } from "@fresnel/client/i18n";
import { classifyTurnFailure, type TurnFailure, type TurnFailureKind } from "@fresnel/client";
import { parse } from "@fresnel/contracts";
import { SecretNameSchema, type SecretName } from "@fresnel/contracts/capabilities";
import { secretNameOf } from "./pages/settings/settings-secret-model.ts";

// 실패한 턴의 오류 문장(`turn.completed.error`)을 사용자 문장과 다음 행동으로 나눈다(SC-06, P-02). 화면 없이 시험한다.
// 종류는 `packages/client`의 `classifyTurnFailure`가 정한다(엔진은 종류를 싣지 않는다). 여기서는 문장과 단추만 고른다.

/** 오류 줄의 단추. 키 다시 등록은 설정 > 시크릿, 모델 바꾸기는 입력창 모델 고르기, 다시 보내기는 마지막 사용자 메시지를 다시 보낸다 */
export type TurnFailureAction = "reregister-key" | "open-providers" | "change-model" | "resend";

export interface TurnFailureView {
  readonly kind: TurnFailureKind;
  readonly text: MessageId;
  readonly action: TurnFailureAction | null;
  /** 문장의 `{host}`, `{seconds}` 같은 자리 값. 없으면 필드가 없다 */
  readonly params?: Readonly<Record<string, string>>;
  /** 정보 아이콘 뒤 "자세히"에 보일 원문 */
  readonly detail: string;
}

const VIEWS: Readonly<
  Record<TurnFailureKind, { readonly text: MessageId; readonly action: TurnFailureAction | null }>
> = {
  auth: { text: "desktop.turnFailure.auth", action: "reregister-key" },
  permission_denied: { text: "desktop.turnFailure.permissionDenied", action: "change-model" },
  host_mismatch: { text: "desktop.turnFailure.hostMismatch", action: "open-providers" },
  bad_request: { text: "desktop.turnFailure.badRequest", action: null },
  context_overflow: { text: "desktop.turnFailure.contextOverflow", action: "change-model" },
  model_not_found: { text: "desktop.turnFailure.modelNotFound", action: "change-model" },
  rate_limited: { text: "desktop.turnFailure.rateLimited", action: "resend" },
  server: { text: "desktop.turnFailure.server", action: "resend" },
  network: { text: "desktop.turnFailure.network", action: "resend" },
  interrupted: { text: "desktop.turnFailure.interrupted", action: "resend" },
  unknown: { text: "desktop.turnFailure.unknown", action: "resend" },
};

/** 종류와 자리 값으로 문장 키를 고른다. 호스트를 모르면 호스트 없는 문장을, 대기 초가 없으면 대기 없는 문장을 쓴다 */
function textOf(failure: TurnFailure): MessageId {
  if (failure.kind === "host_mismatch" && failure.params === undefined) {
    return "desktop.turnFailure.hostMismatchAny";
  }
  if (failure.kind === "rate_limited" && failure.params !== undefined) {
    return "desktop.turnFailure.rateLimitedWait";
  }
  return VIEWS[failure.kind].text;
}

export function turnFailureOf(error: string): TurnFailureView {
  const failure = classifyTurnFailure(error);
  return {
    kind: failure.kind,
    text: textOf(failure),
    action: VIEWS[failure.kind].action,
    ...(failure.params === undefined ? {} : { params: failure.params }),
    detail: error,
  };
}

/** 모델 참조(`provider/modelId[:추론 레벨]`)에서 제공자 id를 꺼낸다. 참조가 없거나 슬래시가 없으면 null이다 */
export function providerOfModelRef(ref: string | null): string | null {
  if (ref === null) return null;
  const slash = ref.indexOf("/");
  return slash <= 0 ? null : ref.slice(0, slash);
}

/** 키 참조(`secret://<이름>`)에서 시크릿 이름을 꺼낸다. 참조가 아니거나 이름이 규칙에 맞지 않으면 null이다 */
export function keySecretOf(keyRef: string | null): SecretName | null {
  const name = keyRef === null ? null : secretNameOf(keyRef);
  if (name === null) return null;
  const parsed = parse(SecretNameSchema, name);
  return parsed.ok ? parsed.value : null;
}

/**
 * 실패한 턴이 쓴 모델의 제공자가 쓰는 키의 시크릿 이름. 모델을 모르거나 그 제공자의 키 참조가 없으면 null이다
 * (그때 "키 다시 등록"은 시크릿 탭만 연다).
 */
export function keySecretOfModel(
  ref: string | null,
  providers: readonly { readonly id: string; readonly apiKeyRef: string | null }[],
): SecretName | null {
  const provider = providerOfModelRef(ref);
  if (provider === null) return null;
  const entry = providers.find((candidate) => candidate.id === provider);
  return keySecretOf(entry?.apiKeyRef ?? null);
}
