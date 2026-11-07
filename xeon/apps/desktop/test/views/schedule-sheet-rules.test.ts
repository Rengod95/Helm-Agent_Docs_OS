import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { activeLocale, setActiveLocale, t, type Locale } from "@fresnel/client/i18n";
import { SCHEDULE_BOUNDS, scheduleRowOf, type ScheduleRow } from "@fresnel/client";
import {
  WATCH_PATH_OUTSIDE_ROOTS_REASON,
  type ScheduleListItem,
  type ScheduleTrigger,
} from "@fresnel/contracts/capabilities";
import {
  clampNoticeOf,
  sheetErrorsOf,
  typedOverLimitOf,
} from "../../src/views/pages/schedules/schedule-draft.ts";
import { canReenableRow } from "../../src/views/pages/schedules/schedule-table.tsx";
import { message } from "../../src/views/pages/schedules/schedule-text.ts";

// 예약 시트와 표의 순수 규칙: 간격 상한을 넘게 친 값의 안내, 감시 경로 저장 거절의 칸 배정, 다시 켜기 단추의 조건.

const NOW = new Date(2026, 10, 4, 8, 0).getTime();
const MAX = SCHEDULE_BOUNDS.intervalSeconds.max;
const OVER = 99_999_999;

describe("interval clamp notice", () => {
  let previous: Locale = "ko";
  beforeEach(() => {
    previous = activeLocale();
    setActiveLocale("ko");
  });
  afterEach(() => {
    setActiveLocale(previous);
  });

  test("a value typed over the limit is remembered while the field still shows the typed text", () => {
    expect(typedOverLimitOf(null, { value: OVER, dirty: true }, MAX)).toBe(OVER);
  });

  test("an in-range edit clears the memory, so the notice goes away", () => {
    expect(typedOverLimitOf(OVER, { value: 600, dirty: true }, MAX)).toBeNull();
  });

  test("the commit report keeps the memory, because the commit is what lowers the value", () => {
    expect(typedOverLimitOf(OVER, { value: MAX, dirty: false }, MAX)).toBe(OVER);
  });

  test("the notice shows only when the typed value was over the limit and the field now sits at the limit", () => {
    expect(clampNoticeOf(OVER, MAX, MAX)).toBe(true);
    expect(clampNoticeOf(null, MAX, MAX)).toBe(false);
    expect(clampNoticeOf(OVER, 600, MAX)).toBe(false);
  });

  test("the notice names the real limit in seconds and days", () => {
    expect(t("desktop.schedules.form.clamped", { max: MAX, days: 365 })).toBe(
      "상한 31536000초(365일)로 줄였어요",
    );
  });
});

describe("save-time watch path refusal", () => {
  let previous: Locale = "ko";
  beforeEach(() => {
    previous = activeLocale();
    setActiveLocale("ko");
  });
  afterEach(() => {
    setActiveLocale(previous);
  });

  test("a path outside the app folders lands on the path field, not on the form", () => {
    const errors = sheetErrorsOf({
      kind: "invalid_trigger",
      reason: WATCH_PATH_OUTSIDE_ROOTS_REASON,
    });
    expect(errors.fields.paths).toEqual(message("desktop.schedules.error.watchPathOutside"));
    expect(errors.form).toBeNull();
    expect(t("desktop.schedules.error.watchPathOutside")).toBe(
      "이 경로는 감시할 수 없어요. 앱이 허용한 폴더(설정·데이터·상태 폴더) 안의 경로만 감시할 수 있어요.",
    );
  });

  test("any other invalid trigger stays on the form as before", () => {
    const errors = sheetErrorsOf({ kind: "invalid_trigger", reason: "paths_empty" });
    expect(errors.fields).toEqual({});
    expect(errors.form).toEqual(message("desktop.schedules.error.invalidTrigger"));
  });
});

/** 표의 행 한 줄을 만든다. 트리거와 켜짐만 시험이 정한다 */
function rowOf(trigger: ScheduleTrigger, enabled: boolean): ScheduleRow {
  const item: ScheduleListItem = {
    entry: {
      id: "sch_rule",
      trigger,
      prompt: "정리한다",
      workspace: null,
      title: "정리",
      sessionKind: "cron",
      enabled,
      createdAt: NOW - 86_400_000,
      nextDueAt: enabled ? NOW + 60_000 : null,
      lastStartedAt: null,
      iterations: 1,
      stoppedReason: enabled ? null : "completed",
    },
    lastRun: null,
  };
  return scheduleRowOf(item);
}

describe("reenable button rule", () => {
  test("an enabled row never offers turn-back-on", () => {
    expect(canReenableRow(rowOf({ kind: "interval", everySeconds: 300 }, true), NOW)).toBe(false);
  });

  test("a finished one-shot time cannot be turned back on", () => {
    const finished = rowOf({ kind: "at", atMs: NOW - 3_600_000 }, false);
    expect(canReenableRow(finished, NOW)).toBe(false);
  });

  test("a one-shot time exactly at now has already passed and cannot be turned back on", () => {
    expect(canReenableRow(rowOf({ kind: "at", atMs: NOW }, false), NOW)).toBe(false);
  });

  test("a cancelled one-shot time that is still in the future can be turned back on", () => {
    expect(canReenableRow(rowOf({ kind: "at", atMs: NOW + 3_600_000 }, false), NOW)).toBe(true);
  });

  test("other turned-off triggers keep the button", () => {
    expect(canReenableRow(rowOf({ kind: "interval", everySeconds: 300 }, false), NOW)).toBe(true);
    expect(canReenableRow(rowOf({ kind: "remote" }, false), NOW)).toBe(true);
  });
});
