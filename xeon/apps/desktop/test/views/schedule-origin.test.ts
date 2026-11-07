import { describe, expect, test } from "bun:test";
import type { RunRecord } from "../../src/views/pages/schedules/schedule-model.ts";
import { runOrdinalOf, SCHEDULE_RUNS_WINDOW } from "../../src/views/schedule-origin.ts";
import { thr } from "../state/helpers.ts";

// 예약 대화 머리의 "n번째 실행": 실행 기록에서 이 대화가 몇 번째 실행인지. 기록은 호스트가 가장 새 것부터 준다.

const BASE_MS = Date.UTC(2026, 10, 7, 0, 0);

/** `minutes`분 뒤의 시각(ISO). 실행 시작 시각 fixture */
function at(minutes: number): string {
  return new Date(BASE_MS + minutes * 60_000).toISOString();
}

function run(runId: string, minutes: number, threadId: string | null): RunRecord {
  return {
    runId,
    startedAt: at(minutes),
    endedAt: at(minutes + 1),
    outcome: threadId === null ? "skipped" : "ok",
    threadId,
    error: null,
  };
}

describe("runOrdinalOf", () => {
  test("numbers a run by its start time, oldest first, from the most-recent-first list", () => {
    const runs = [run("run_c", 180, thr(3)), run("run_b", 120, thr(2)), run("run_a", 60, thr(1))];
    expect(runOrdinalOf(runs, thr(1))).toBe(1);
    expect(runOrdinalOf(runs, thr(2))).toBe(2);
    expect(runOrdinalOf(runs, thr(3))).toBe(3);
  });

  test("does not depend on the order of the list, only on start times", () => {
    const runs = [run("run_b", 120, thr(2)), run("run_c", 180, thr(3)), run("run_a", 60, thr(1))];
    expect(runOrdinalOf(runs, thr(2))).toBe(2);
  });

  test("runs without a thread id are not counted", () => {
    const runs = [
      run("run_c", 180, thr(3)),
      run("run_skip", 90, null),
      run("run_b", 120, thr(2)),
      run("run_a", 60, thr(1)),
    ];
    expect(runOrdinalOf(runs, thr(2))).toBe(2);
    expect(runOrdinalOf(runs, thr(3))).toBe(3);
  });

  test("is null when the thread has no run in the list", () => {
    const runs = [run("run_a", 60, thr(1)), run("run_b", 120, thr(2))];
    expect(runOrdinalOf(runs, thr(9))).toBeNull();
  });

  test("is null for an empty run list", () => {
    expect(runOrdinalOf([], thr(1))).toBeNull();
  });

  test("numbers the run when the list is one short of the host window", () => {
    const runs = Array.from({ length: SCHEDULE_RUNS_WINDOW - 1 }, (_, index) =>
      run(`run_${index + 1}`, (index + 1) * 60, thr(index + 1)),
    );
    expect(runOrdinalOf(runs, thr(SCHEDULE_RUNS_WINDOW - 1))).toBe(SCHEDULE_RUNS_WINDOW - 1);
  });

  test("is null when the list is full, since older runs may have been cut off", () => {
    const runs = Array.from({ length: SCHEDULE_RUNS_WINDOW }, (_, index) =>
      run(`run_${index + 1}`, (index + 1) * 60, thr(index + 1)),
    );
    expect(runOrdinalOf(runs, thr(1))).toBeNull();
    expect(runOrdinalOf(runs, thr(SCHEDULE_RUNS_WINDOW))).toBeNull();
  });
});
