// 대화 없이 실패한 예약 실행의 알림을 상태줄 진행 중 묶음에 올릴 때 쓰는 순수 함수. React와 명령을 보지 않는다.
// 대화를 열기 전에 실패한 실행은 대화가 없어 진행 중 목록에 행이 없으므로, 이 알림들이 예약 묶음의 실패 줄이 된다.

import { isThreadlessNoticeSeq, type Notice } from "@fresnel/contracts/capabilities";
import { newestFirstOf } from "./notices-model.ts";

/** 진행 중 묶음에 보일 최근 실패 수. 더 오래된 것은 받은 요청의 알림 목록에 남는다 */
export const SCHEDULE_FAILURE_SHOWN = 3;

/** 화면이 들고 있는 실패 알림의 상한. 보이는 수보다 넉넉히 두고 넘으면 오래된 것을 버린다 */
const SCHEDULE_FAILURE_KEEP = 20;

/** 대화 없는 예약 실행의 실패 알림인가: 오류이고, 출처가 예약 실행 종료이고, seq가 대화 없는 알림의 범위다 */
export function isThreadlessScheduleFailure(notice: Notice): boolean {
  return (
    notice.kind === "error" &&
    notice.sourceType === "schedule.run_finished" &&
    isThreadlessNoticeSeq(notice.seq)
  );
}

/**
 * 들고 있는 실패 알림에 받은 것을 합친다. 대화 없는 예약 실패가 아닌 알림은 버리고, 같은 seq는 한 번만 둔다.
 * 최신이 먼저이고 상한을 넘으면 오래된 것을 버린다.
 */
export function mergeScheduleFailures(
  current: readonly Notice[],
  incoming: readonly Notice[],
): readonly Notice[] {
  const seen = new Map<number, Notice>();
  for (const notice of [...current, ...incoming]) {
    if (isThreadlessScheduleFailure(notice)) seen.set(notice.seq, notice);
  }
  return [...seen.values()].toSorted(newestFirstOf).slice(0, SCHEDULE_FAILURE_KEEP);
}

/**
 * 상태줄에 보일 실패 알림. 대화 없는 알림 band의 지운 경계 뒤의 것만 두고, 최신 `SCHEDULE_FAILURE_SHOWN`건을 최신이 먼저 준다.
 * 지운 경계는 seq로 비교한다(대화 없는 알림의 seq가 이 경계보다 크면 지운 뒤에 온 알림이다).
 */
export function scheduleFailuresShownOf(
  notices: readonly Notice[],
  clearedThreadless: number,
): readonly Notice[] {
  return notices
    .filter((notice) => notice.seq > clearedThreadless)
    .toSorted(newestFirstOf)
    .slice(0, SCHEDULE_FAILURE_SHOWN);
}
