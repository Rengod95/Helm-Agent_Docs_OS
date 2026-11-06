import type { ApprovalRequestedPayload } from "@fresnel/contracts/records";
import type { MessageId } from "@fresnel/client/i18n";
import { cardTitleViewOf } from "./approval-card/card-model.ts";

// 화면 낭독 안내(scD 1-2)의 순수 부분. 새 승인 요청과 턴 완료·실패를 짧은 문장으로 만든다.
// 문장은 앱의 polite 실시간 영역 하나(`live-announcer.tsx`)가 읽는다. 스트리밍 글자는 안내하지 않는다.

/** 안내문의 한 조각: 카탈로그 키와 값 */
export type Announcement = {
  readonly id: MessageId;
  readonly params?: Readonly<Record<string, string>>;
};

/** 새 승인 요청의 안내. 도구 승인은 도구 이름, 계획 검토는 "계획 검토", 그 밖은 요청 제목 */
export function approvalAnnouncement(request: ApprovalRequestedPayload): Announcement {
  const view = cardTitleViewOf(request);
  if (view !== null && view.id === "desktop.approvals.title.tool")
    return { id: "desktop.announce.approval", params: { what: view.params.tool } };
  if (view !== null) return { id: "desktop.announce.approval.plan" };
  return { id: "desktop.announce.approval", params: { what: request.title } };
}

/** 이전 목록에 없던 승인 id만 앞에서부터 돌려준다 */
export function newApprovalIds<T>(before: readonly T[], after: readonly T[]): readonly T[] {
  return after.filter((id) => !before.includes(id));
}

/** 턴이 끝난 순간(진행 중 → 아님)의 안내. 실패 문장이 있으면 실패다. 끝난 순간이 아니면 null */
export function turnAnnouncement(
  wasRunning: boolean,
  running: boolean,
  failure: string | null,
): Announcement | null {
  if (!wasRunning || running) return null;
  return failure === null
    ? { id: "desktop.announce.turnDone" }
    : { id: "desktop.announce.turnFailed" };
}
