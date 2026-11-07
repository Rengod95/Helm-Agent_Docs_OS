import { expect, test } from "bun:test";
import { THREADLESS_NOTICE_SEQ_BASE } from "@fresnel/contracts/capabilities";
import type { RunRecord, ScheduleEntry, ScheduleService } from "@fresnel/cap-schedule";
import { threadlessNoticeOf, threadlessNoticesOf } from "../../src/assembly/threadless-notices.ts";

// 대화에 묶이지 않은 알림(L4.desktop-ux 예약 절). 예약이 대화를 열기 전에 실패한 실행(`failed`이고 `threadId`가 없는 기록)만 알림이 된다.
// 알림은 실행 기록에서 계산하므로 같은 기록은 늘 같은 알림이다(seq는 실행 id의 해시).

const CLAIMED_MS = 1_800_000_000_000;
const ENDED_MS = 1_800_000_120_000;
const STARTED_MS = 1_800_000_060_000;

function runOf(fields: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run_1",
    scheduleId: "sch_1",
    firedBy: "interval",
    dueAt: CLAIMED_MS,
    claimedAt: CLAIMED_MS,
    missed: false,
    status: "failed",
    threadId: null,
    startedAt: null,
    endedAt: ENDED_MS,
    outcome: null,
    reason: "start_failed",
    skippedCount: 0,
    ...fields,
  };
}

function entryOf(id: string): ScheduleEntry {
  return {
    id,
    trigger: { kind: "interval", everySeconds: 300 },
    prompt: "summarize the open items",
    workspace: null,
    title: null,
    sessionKind: "cron",
    enabled: true,
    createdAt: CLAIMED_MS,
    nextDueAt: CLAIMED_MS + 300_000,
    lastStartedAt: null,
    iterations: 0,
    stoppedReason: null,
  };
}

test("a failed run without a thread becomes an error notice with its reason, the run's end time and the schedule source", () => {
  const notice = threadlessNoticeOf(runOf());
  expect(notice).toEqual({
    kind: "error",
    title: "예약 작업이 실패했어요",
    body: "start_failed",
    seq: expect.any(Number),
    sourceType: "schedule.run_finished",
    createdAt: ENDED_MS,
  });
  // seq는 대화 없는 알림의 기준값 이상이라 내구 이벤트 seq와 겹치지 않는다
  expect(notice?.seq).toBeGreaterThanOrEqual(THREADLESS_NOTICE_SEQ_BASE);
});

test("a run that never got an end time is dated by its claim", () => {
  expect(threadlessNoticeOf(runOf({ endedAt: null }))?.createdAt).toBe(CLAIMED_MS);
});

test("the same run gives the same seq every time, and different runs give different seqs", () => {
  const first = threadlessNoticeOf(runOf({ runId: "run_same" }));
  const again = threadlessNoticeOf(runOf({ runId: "run_same", endedAt: ENDED_MS + 5_000 }));
  expect(first?.seq).toBe(again?.seq);
  const other = threadlessNoticeOf(runOf({ runId: "run_other" }));
  expect(other?.seq).toBeGreaterThanOrEqual(THREADLESS_NOTICE_SEQ_BASE);
  expect(other?.seq).not.toBe(first?.seq);
});

test("a finished run, a failed run that has a thread, and a skipped run are not notices", () => {
  expect(
    threadlessNoticeOf(
      runOf({
        status: "finished",
        outcome: "completed",
        threadId: "thr_1",
        reason: null,
        startedAt: STARTED_MS,
      }),
    ),
  ).toBeNull();
  expect(
    threadlessNoticeOf(
      runOf({
        status: "failed",
        outcome: "failed",
        threadId: "thr_1",
        reason: "run_failed",
        startedAt: STARTED_MS,
      }),
    ),
  ).toBeNull();
  expect(
    threadlessNoticeOf(
      runOf({ status: "skipped", reason: "overlap", skippedCount: 1, endedAt: null }),
    ),
  ).toBeNull();
});

test("over a schedule with two entries only the thread-less failures become notices, in the order the schedule gives them", () => {
  const failedA = runOf({ runId: "run_a_failed", scheduleId: "sch_a", reason: "start_failed" });
  const skippedA = runOf({
    runId: "run_a_skipped",
    scheduleId: "sch_a",
    status: "skipped",
    reason: "overlap",
    endedAt: null,
  });
  const failedWithThreadB = runOf({
    runId: "run_b_thread",
    scheduleId: "sch_b",
    status: "failed",
    threadId: "thr_b",
    reason: "run_failed",
    startedAt: STARTED_MS,
  });
  const failedB = runOf({
    runId: "run_b_failed",
    scheduleId: "sch_b",
    reason: "host_exit",
    endedAt: ENDED_MS + 1_000,
  });
  const runsOf = new Map<string, readonly RunRecord[]>([
    ["sch_a", [failedA, skippedA]],
    ["sch_b", [failedWithThreadB, failedB]],
  ]);
  const schedule: Pick<ScheduleService, "list" | "runs"> = {
    list: () => [entryOf("sch_a"), entryOf("sch_b")],
    runs: (scheduleId) => runsOf.get(scheduleId) ?? [],
  };

  expect(threadlessNoticesOf(schedule)).toEqual([
    {
      kind: "error",
      title: "예약 작업이 실패했어요",
      body: "start_failed",
      seq: expect.any(Number),
      sourceType: "schedule.run_finished",
      createdAt: ENDED_MS,
    },
    {
      kind: "error",
      title: "예약 작업이 실패했어요",
      body: "host_exit",
      seq: expect.any(Number),
      sourceType: "schedule.run_finished",
      createdAt: ENDED_MS + 1_000,
    },
  ]);
});
