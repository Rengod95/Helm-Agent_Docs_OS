import type { MessageId } from "@fresnel/client/i18n";
import { REMOVE_REQUESTED_TEXT } from "./remove-model.ts";

// "검토함으로 보냈다" 상태. 설치와 지우기는 바로 일어나지 않고 검토 항목이 되어 승인을 기다린다.
// 컨트롤러가 이 값을 `reviewSent`로 화면에 넘기고, 검토함 화면(별도 작업)이 `itemId`로 그 항목을 연다.

export interface ReviewSent {
  /** 무엇을 보냈나: 설치(`install`)나 지우기(`remove`) */
  readonly kind: "install" | "remove";
  /** 검토 항목 id(`pluginReview.submitDraft`, `plugin.requestRemove`의 결과) */
  readonly itemId: string;
}

/** 보낸 요청을 알리는 문장 */
export function reviewSentTextOf(sent: ReviewSent): MessageId {
  return sent.kind === "install" ? "desktop.install.requested" : REMOVE_REQUESTED_TEXT;
}
