import { describe, expect, test } from "bun:test";
import { THREADLESS_NOTICE_SEQ_BASE, type Notice } from "@fresnel/contracts/capabilities";
import {
  isThreadlessScheduleFailure,
  mergeScheduleFailures,
  SCHEDULE_FAILURE_SHOWN,
  scheduleFailuresShownOf,
} from "../../src/views/schedule-run-failures-model.ts";

/** 대화 없이 실패한 예약 실행의 알림. seq는 대화 없는 알림의 범위에서 `offset`만큼 떨어진다 */
const failure = (offset: number, createdAt: number): Notice => ({
  kind: "error",
  title: "예약 작업이 실패했어요",
  body: "start_failed",
  seq: THREADLESS_NOTICE_SEQ_BASE + offset,
  sourceType: "schedule.run_finished",
  createdAt,
});

const seqsOf = (notices: readonly Notice[]): readonly number[] => notices.map((n) => n.seq);

describe("isThreadlessScheduleFailure", () => {
  test("only an error from a finished scheduled run with a thread-less seq counts", () => {
    expect(isThreadlessScheduleFailure(failure(1, 100))).toBe(true);
    expect(isThreadlessScheduleFailure({ ...failure(1, 100), seq: 5 })).toBe(false);
    expect(isThreadlessScheduleFailure({ ...failure(1, 100), kind: "completed" })).toBe(false);
    expect(isThreadlessScheduleFailure({ ...failure(1, 100), sourceType: "turn.completed" })).toBe(
      false,
    );
  });
});

describe("mergeScheduleFailures", () => {
  test("keeps one entry per seq, drops the other notices, and lists the newest first", () => {
    const merged = mergeScheduleFailures(
      [failure(1, 100)],
      [
        failure(1, 100),
        failure(2, 300),
        { ...failure(3, 50), sourceType: "turn.completed" },
        { ...failure(4, 60), kind: "completed" },
      ],
    );
    expect(seqsOf(merged)).toEqual([
      THREADLESS_NOTICE_SEQ_BASE + 2,
      THREADLESS_NOTICE_SEQ_BASE + 1,
    ]);
  });

  test("the newest goes by creation time, not by the seq, which is a hash of the run", () => {
    const merged = mergeScheduleFailures([], [failure(9, 100), failure(2, 500)]);
    expect(seqsOf(merged)).toEqual([
      THREADLESS_NOTICE_SEQ_BASE + 2,
      THREADLESS_NOTICE_SEQ_BASE + 9,
    ]);
  });

  test("the state keeps at most twenty and drops the oldest", () => {
    const many = Array.from({ length: 25 }, (_, i) => failure(i + 1, (i + 1) * 10));
    const merged = mergeScheduleFailures([], many);
    expect(merged.length).toBe(20);
    expect(merged[0]?.seq).toBe(THREADLESS_NOTICE_SEQ_BASE + 25);
    expect(merged.at(-1)?.seq).toBe(THREADLESS_NOTICE_SEQ_BASE + 6);
  });
});

describe("scheduleFailuresShownOf", () => {
  const five = [1, 2, 3, 4, 5].map((i) => failure(i, i * 100));

  test("shows the newest three, newest first", () => {
    const shown = scheduleFailuresShownOf(five, 0);
    expect(shown.length).toBe(SCHEDULE_FAILURE_SHOWN);
    expect(seqsOf(shown)).toEqual([
      THREADLESS_NOTICE_SEQ_BASE + 5,
      THREADLESS_NOTICE_SEQ_BASE + 4,
      THREADLESS_NOTICE_SEQ_BASE + 3,
    ]);
  });

  test("a cleared thread-less boundary hides the notices at or below it", () => {
    expect(seqsOf(scheduleFailuresShownOf(five, THREADLESS_NOTICE_SEQ_BASE + 4))).toEqual([
      THREADLESS_NOTICE_SEQ_BASE + 5,
    ]);
    expect(scheduleFailuresShownOf(five, THREADLESS_NOTICE_SEQ_BASE + 5)).toEqual([]);
  });

  test("nothing shows when there are no failures", () => {
    expect(scheduleFailuresShownOf([], 0)).toEqual([]);
  });
});
