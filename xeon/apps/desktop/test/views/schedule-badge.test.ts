import { describe, expect, test } from "bun:test";
import type { RunView, ScheduleEntryView, ScheduleListItem } from "@fresnel/contracts/capabilities";
import { failedScheduleCountOf } from "../../src/views/pages/schedules/schedule-badge.ts";

// 예약 내비 배지의 수: 마지막 실행이 실패한 예약 수. 실패는 상태가 failed이거나 끝난 실행의 결과가 failed다(화면 표식과 같다).

const NOW = 1_800_000_000_000;

const ENTRY: ScheduleEntryView = {
  id: "sch_aa1",
  trigger: { kind: "interval", everySeconds: 600 },
  prompt: "캐시를 정리한다",
  workspace: null,
  title: "캐시 정리",
  sessionKind: "cron",
  enabled: true,
  createdAt: NOW - 86_400_000,
  nextDueAt: NOW + 600_000,
  lastStartedAt: null,
  iterations: 3,
  stoppedReason: null,
};

function itemOf(id: string, lastRun: RunView | null, enabled = true): ScheduleListItem {
  return { entry: { ...ENTRY, id, enabled }, lastRun, missedRuns: 0 };
}

/** 마지막 실행 기록 하나. 값은 끝난 실행(완료)이고 시험에서 고친다 */
function runOf(overrides: Partial<RunView>): RunView {
  return {
    runId: "run_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    scheduleId: "sch_aa1",
    firedBy: "interval",
    dueAt: NOW - 600_000,
    claimedAt: NOW - 600_000,
    missed: false,
    status: "finished",
    threadId: "thr_00000000000000000000000001",
    startedAt: NOW - 600_000,
    endedAt: NOW - 180_000,
    outcome: "completed",
    reason: null,
    skippedCount: 0,
    ...overrides,
  };
}

describe("failed schedule count", () => {
  test("counts the schedules whose last run failed, by a failed status or by a finished run's failed outcome", () => {
    const items = [
      itemOf("sch_a", runOf({ status: "failed", outcome: null })),
      itemOf("sch_b", runOf({ status: "finished", outcome: "failed" })),
      itemOf("sch_c", runOf({ status: "finished", outcome: "completed" })),
      itemOf("sch_d", runOf({ status: "skipped", outcome: null })),
      itemOf("sch_e", null),
      itemOf("sch_f", runOf({ status: "started", outcome: null })),
      itemOf("sch_g", runOf({ status: "finished", outcome: "aborted" })),
    ];
    expect(failedScheduleCountOf(items)).toBe(2);
  });

  test("a disabled schedule whose last run failed still counts, since the badge reads every schedule", () => {
    const items = [itemOf("sch_h", runOf({ status: "failed", outcome: null }), false)];
    expect(failedScheduleCountOf(items)).toBe(1);
  });

  test("an empty list, and schedules that never ran, count zero", () => {
    expect(failedScheduleCountOf([])).toBe(0);
    expect(failedScheduleCountOf([itemOf("sch_e", null), itemOf("sch_i", null)])).toBe(0);
  });
});
