import { THREADLESS_NOTICE_SEQ_BASE, type Notice } from "@fresnel/contracts/capabilities";
import type { RunRecord, ScheduleService } from "@fresnel/cap-schedule";

// 대화에 묶이지 않은 알림(L4.desktop-ux 예약 절). 예약이 대화를 열기 전에 실패하면(`start_failed`) 대화의 내구 이벤트가 없어
// `turn.completed`에서 파생하는 알림이 생기지 않는다. 그 실행의 기록(`RunRecord`)에서 알림을 계산한다: 목록은 기록에서 늘 다시 계산하고
// (재시작해도 남는다), 실행이 끝나는 순간에는 `publishThreadless`로 구독자에게 보낸다. 같은 실행은 늘 같은 알림이다.

/** 알림 제목. 앱은 이 원문을 쓰지 않고 출처(`schedule.run_finished`)와 종류로 자기 문구를 고른다(한국어 문장은 앱 카탈로그의 몫이다) */
const THREADLESS_TITLE = "A scheduled run failed";

/** 32비트 FNV-1a. 실행 id에서 같은 값을 다시 만들 수 있으면 되고 암호학적 성질은 쓰지 않는다 */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** 같은 밀리초에 끝난 실행을 가르는 해시 칸 수 */
const HASH_SLOTS = 1024;

/**
 * 대화 없는 알림의 seq. 기준값에 `시각(ms) * 1024 + 실행 id 해시(0..1023)`를 더한다. 시각 순으로 커지므로 "모두 지우기" 경계(가장 큰 seq)가
 * 뒤에 오는 실패를 가리지 않고, 같은 실행은 늘 같은 값이다. 같은 밀리초에 끝난 둘이 해시까지 같을 확률만 남는다(1/1024)
 */
function threadlessSeqOf(runId: string, createdAt: number): number {
  return THREADLESS_NOTICE_SEQ_BASE + createdAt * HASH_SLOTS + (fnv1a(runId) % HASH_SLOTS);
}

/** 실행 기록 하나의 대화 없는 알림. 대화를 열지 못하고 실패한 실행(`failed`이고 `threadId`가 null)만 알림이 된다. 본문은 실패 이유 코드다 */
export function threadlessNoticeOf(run: RunRecord): Notice | null {
  if (run.status !== "failed" || run.threadId !== null) return null;
  const createdAt = run.endedAt ?? run.claimedAt;
  return {
    kind: "error",
    title: THREADLESS_TITLE,
    body: run.reason,
    seq: threadlessSeqOf(run.runId, createdAt),
    sourceType: "schedule.run_finished",
    createdAt,
  };
}

/** 보관 중인 실행 기록에서 계산한 대화 없는 알림 전부. 예약 서비스가 아직 기록을 읽지 못했으면 비어 있다 */
export function threadlessNoticesOf(schedule: Pick<ScheduleService, "list" | "runs">): Notice[] {
  const notices: Notice[] = [];
  for (const entry of schedule.list()) {
    for (const run of schedule.runs(entry.id, Number.MAX_SAFE_INTEGER)) {
      const notice = threadlessNoticeOf(run);
      if (notice !== null) notices.push(notice);
    }
  }
  return notices;
}
