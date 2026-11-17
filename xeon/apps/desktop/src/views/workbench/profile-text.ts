// 이 대화의 프로필 설정(`thread.setProfile`)의 글: 실패 갈래. 컨트롤러의 토스트와 프로필 구역이 같이 쓴다.
import type { MessageId } from "@fresnel/client/i18n";
import type { ProfileFailure } from "@fresnel/client/workbench";

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
