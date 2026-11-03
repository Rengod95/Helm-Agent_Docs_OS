// 이 대화의 프로필 적용의 글: 실패 갈래와 적용 시점. 컨트롤러의 토스트와 검사 탭의 확인 대화 상자가 같이 쓴다.
import type { MessageId } from "@fresnel/client/i18n";
import type { ProfileFailure } from "@fresnel/client/workbench";
import type { ProfileApplyResult } from "@fresnel/contracts/wire";

const FAILURE_TEXT: Readonly<Record<ProfileFailure, MessageId>> = {
  not_found: "desktop.inspect.profile.error.notFound",
  trust_required: "desktop.inspect.profile.error.trustRequired",
  apply_partial: "desktop.inspect.profile.error.applyPartial",
  limit: "desktop.inspect.profile.error.limit",
  failed: "desktop.inspect.profile.error.failed",
};

/** 프로필 적용 실패 한 줄 */
export function profileFailureText(failure: ProfileFailure): MessageId {
  return FAILURE_TEXT[failure];
}

const APPLIES_TEXT: Readonly<Record<ProfileApplyResult["appliesAt"], MessageId>> = {
  nextStepBoundary: "desktop.inspect.profile.appliesAt.nextStepBoundary",
  now: "desktop.inspect.profile.appliesAt.now",
};

/** 적용 시점 글. 다음 단계 경계면 그 뒤에 적용된다는 말이다 */
export function profileAppliesText(appliesAt: ProfileApplyResult["appliesAt"]): MessageId {
  return APPLIES_TEXT[appliesAt];
}
