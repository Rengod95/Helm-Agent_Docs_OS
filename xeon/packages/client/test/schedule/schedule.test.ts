import { describe, expect, test } from "bun:test";
import type {
  RunView,
  ScheduleEntryView,
  ScheduleError,
  ScheduleListItem,
  ScheduleTrigger,
} from "@fresnel/contracts/capabilities";
import {
  createParamsOf,
  scheduleErrorKey,
  scheduleListView,
  scheduleRowOf,
  serviceModeWarning,
  triggerOfDraft,
  type TriggerDraft,
} from "../../src/schedule/index.ts";

// 예약 view-model: 목록 행, 정렬, 시트 입력 검사, create 입력, 오류 키, 서비스 모드 경고. 값으로 비교한다.

const NOW = 1_800_000_000_000;

const ENTRY: ScheduleEntryView = {
  id: "sch_aa1",
  trigger: { kind: "interval", everySeconds: 600 },
  prompt: "캐시를 정리한다",
  workspace: "/Users/me/fresnel",
  title: "캐시 정리",
  sessionKind: "cron",
  enabled: true,
  createdAt: NOW - 86_400_000,
  nextDueAt: NOW + 600_000,
  lastStartedAt: NOW - 600_000,
  iterations: 3,
  stoppedReason: null,
};

const RUN: RunView = {
  runId: "run_01",
  scheduleId: "sch_aa1",
  firedBy: "interval",
  dueAt: NOW - 600_000,
  claimedAt: NOW - 600_000,
  missed: false,
  status: "finished",
  threadId: "thr_9",
  startedAt: NOW - 600_000,
  endedAt: NOW - 590_000,
  outcome: "completed",
  reason: null,
  skippedCount: 0,
};

/** 목록 항목 한 건. 시험마다 항목 필드만 바꾼다 */
function itemOf(
  entry: Partial<ScheduleEntryView>,
  lastRun: RunView | null = null,
): ScheduleListItem {
  return { entry: { ...ENTRY, ...entry }, lastRun };
}

describe("scheduleRowOf", () => {
  test("a finished interval entry keeps its title, due time and last run as they are", () => {
    expect(scheduleRowOf(itemOf({}, RUN))).toEqual({
      id: "sch_aa1",
      title: "캐시 정리",
      triggerKind: "interval",
      triggerSummary: { kind: "interval", everySeconds: 600 },
      nextDueAt: NOW + 600_000,
      enabled: true,
      iterations: 3,
      stoppedReason: null,
      lastRun: { status: "finished", outcome: "completed", reason: null, threadId: "thr_9" },
      promptPreview: "캐시를 정리한다",
      promptHasMore: false,
    });
  });

  test("the trigger summary is data for each of the five trigger kinds", () => {
    const triggers: readonly ScheduleTrigger[] = [
      { kind: "interval", everySeconds: 600 },
      { kind: "at", atMs: NOW + 3_600_000 },
      { kind: "file_watch", paths: ["/Users/me/notes"], debounceMs: 2000 },
      { kind: "remote" },
      { kind: "repeat", intervalSeconds: 600, maxIterations: 10, expiresAtMs: NOW + 86_400_000 },
    ];
    expect(
      triggers.map((trigger) => {
        const row = scheduleRowOf(itemOf({ trigger }));
        return { kind: row.triggerKind, summary: row.triggerSummary };
      }),
    ).toEqual([
      { kind: "interval", summary: { kind: "interval", everySeconds: 600 } },
      { kind: "at", summary: { kind: "at", atMs: NOW + 3_600_000 } },
      {
        kind: "file_watch",
        summary: { kind: "file_watch", paths: ["/Users/me/notes"], debounceMs: 2000 },
      },
      { kind: "remote", summary: { kind: "remote" } },
      {
        kind: "repeat",
        summary: {
          kind: "repeat",
          intervalSeconds: 600,
          maxIterations: 10,
          expiresAtMs: NOW + 86_400_000,
        },
      },
    ]);
  });

  test("a stopped loop without a last run shows the stop reason and a null last run", () => {
    expect(
      scheduleRowOf(
        itemOf({
          trigger: { kind: "repeat", intervalSeconds: 600, maxIterations: 4, expiresAtMs: NOW + 1 },
          enabled: false,
          nextDueAt: null,
          iterations: 4,
          stoppedReason: "max_iterations",
        }),
      ),
    ).toEqual({
      id: "sch_aa1",
      title: "캐시 정리",
      triggerKind: "repeat",
      triggerSummary: {
        kind: "repeat",
        intervalSeconds: 600,
        maxIterations: 4,
        expiresAtMs: NOW + 1,
      },
      nextDueAt: null,
      enabled: false,
      iterations: 4,
      stoppedReason: "max_iterations",
      lastRun: null,
      promptPreview: "캐시를 정리한다",
      promptHasMore: false,
    });
  });

  test("a failed run keeps its reason and a null thread id", () => {
    const failed: RunView = {
      ...RUN,
      status: "skipped",
      threadId: null,
      outcome: null,
      reason: "overlap",
      skippedCount: 2,
    };
    expect(scheduleRowOf(itemOf({}, failed)).lastRun).toEqual({
      status: "skipped",
      outcome: null,
      reason: "overlap",
      threadId: null,
    });
  });

  test("the title falls back to the first line of the prompt, trimmed to 60 characters", () => {
    expect(
      scheduleRowOf(itemOf({ title: null, prompt: "  주간 회고를 정리한다  \n둘째 줄" })).title,
    ).toEqual("주간 회고를 정리한다");
    expect(scheduleRowOf(itemOf({ title: null, prompt: "가".repeat(70) })).title).toEqual(
      "가".repeat(60),
    );
    expect(scheduleRowOf(itemOf({ title: null, prompt: "\n\n실제 제목\n다음" })).title).toEqual(
      "실제 제목",
    );
  });

  test("the prompt preview is the first two lines and promptHasMore says whether more follow", () => {
    expect(scheduleRowOf(itemOf({ prompt: "첫 줄\n둘째 줄\n셋째 줄\n넷째 줄" }))).toMatchObject({
      promptPreview: "첫 줄\n둘째 줄",
      promptHasMore: true,
    });
    expect(scheduleRowOf(itemOf({ prompt: "첫 줄\n둘째 줄" }))).toMatchObject({
      promptPreview: "첫 줄\n둘째 줄",
      promptHasMore: false,
    });
    expect(scheduleRowOf(itemOf({ prompt: "첫 줄\r\n둘째 줄\r\n셋째 줄" }))).toMatchObject({
      promptPreview: "첫 줄\n둘째 줄",
      promptHasMore: true,
    });
  });
});

describe("scheduleListView", () => {
  test("enabled first, then next due ascending with null last, then id", () => {
    const items = [
      itemOf({ id: "sch_c1", nextDueAt: 300 }),
      itemOf({ id: "sch_b1", nextDueAt: null, trigger: { kind: "remote" } }),
      itemOf({ id: "sch_d1", enabled: false, nextDueAt: null }),
      itemOf({ id: "sch_a2", nextDueAt: 300 }),
      itemOf({ id: "sch_e1", nextDueAt: 100 }),
    ];
    expect(scheduleListView(items).map((row) => row.id)).toEqual([
      "sch_e1",
      "sch_a2",
      "sch_c1",
      "sch_b1",
      "sch_d1",
    ]);
  });

  test("sorting does not reorder the input list", () => {
    const items = [itemOf({ id: "sch_z", nextDueAt: 5 }), itemOf({ id: "sch_m", nextDueAt: 1 })];
    scheduleListView(items);
    expect(items.map((item) => item.entry.id)).toEqual(["sch_z", "sch_m"]);
  });

  test("an empty list gives no rows", () => {
    expect(scheduleListView([])).toEqual([]);
  });
});

describe("triggerOfDraft", () => {
  const DRAFT: TriggerDraft = {
    kind: "interval",
    intervalSeconds: "600",
    atMs: null,
    paths: [],
    debounceMs: "0",
    loopIntervalSeconds: "600",
    maxIterations: "4",
    expiresAtMs: String(NOW + 1000),
  };

  test("interval: 300 to 31536000 seconds is accepted, the bounds included", () => {
    expect(triggerOfDraft({ ...DRAFT, intervalSeconds: "600" }, NOW)).toEqual({
      ok: true,
      trigger: { kind: "interval", everySeconds: 600 },
    });
    expect(triggerOfDraft({ ...DRAFT, intervalSeconds: "300" }, NOW)).toEqual({
      ok: true,
      trigger: { kind: "interval", everySeconds: 300 },
    });
    expect(triggerOfDraft({ ...DRAFT, intervalSeconds: "31536000" }, NOW)).toEqual({
      ok: true,
      trigger: { kind: "interval", everySeconds: 31_536_000 },
    });
  });

  test("interval: 1 to 299 seconds is interval_too_short with the 300 second minimum", () => {
    expect(triggerOfDraft({ ...DRAFT, intervalSeconds: "1" }, NOW)).toEqual({
      ok: false,
      field: "intervalSeconds",
      code: "interval_too_short",
      minSeconds: 300,
    });
    expect(triggerOfDraft({ ...DRAFT, intervalSeconds: "299" }, NOW)).toEqual({
      ok: false,
      field: "intervalSeconds",
      code: "interval_too_short",
      minSeconds: 300,
    });
  });

  test("interval: outside 1..31536000 or not a number is invalid_trigger", () => {
    for (const intervalSeconds of ["0", "31536001", "-5", "abc", "", "1.5"]) {
      expect(triggerOfDraft({ ...DRAFT, intervalSeconds }, NOW)).toEqual({
        ok: false,
        field: "intervalSeconds",
        code: "invalid_trigger",
      });
    }
  });

  test("at: a time after now is accepted", () => {
    expect(triggerOfDraft({ ...DRAFT, kind: "at", atMs: NOW + 60_000 }, NOW)).toEqual({
      ok: true,
      trigger: { kind: "at", atMs: NOW + 60_000 },
    });
  });

  test("at: a time at or before now is at_in_past, and no time chosen is invalid_trigger", () => {
    expect(triggerOfDraft({ ...DRAFT, kind: "at", atMs: NOW - 1 }, NOW)).toEqual({
      ok: false,
      field: "atMs",
      code: "at_in_past",
    });
    expect(triggerOfDraft({ ...DRAFT, kind: "at", atMs: NOW }, NOW)).toEqual({
      ok: false,
      field: "atMs",
      code: "at_in_past",
    });
    expect(triggerOfDraft({ ...DRAFT, kind: "at", atMs: null }, NOW)).toEqual({
      ok: false,
      field: "atMs",
      code: "invalid_trigger",
    });
  });

  test("file_watch: paths are trimmed, and the debounce is read as a number", () => {
    expect(
      triggerOfDraft(
        { ...DRAFT, kind: "file_watch", paths: ["/a", " /b "], debounceMs: "500" },
        NOW,
      ),
    ).toEqual({
      ok: true,
      trigger: { kind: "file_watch", paths: ["/a", "/b"], debounceMs: 500 },
    });
  });

  test("file_watch: 1 to 16 paths, each 1 to 4096 characters after trimming", () => {
    const sixteen = Array.from({ length: 16 }, (_, index) => `/p/${index}`);
    expect(
      triggerOfDraft({ ...DRAFT, kind: "file_watch", paths: sixteen, debounceMs: "0" }, NOW),
    ).toEqual({
      ok: true,
      trigger: { kind: "file_watch", paths: sixteen, debounceMs: 0 },
    });
    const seventeen = [...sixteen, "/p/16"];
    expect(
      triggerOfDraft({ ...DRAFT, kind: "file_watch", paths: seventeen, debounceMs: "0" }, NOW),
    ).toEqual({ ok: false, field: "paths", code: "invalid_trigger" });
    expect(
      triggerOfDraft({ ...DRAFT, kind: "file_watch", paths: [], debounceMs: "0" }, NOW),
    ).toEqual({ ok: false, field: "paths", code: "invalid_trigger" });
    expect(
      triggerOfDraft({ ...DRAFT, kind: "file_watch", paths: ["   "], debounceMs: "0" }, NOW),
    ).toEqual({ ok: false, field: "paths", code: "invalid_trigger" });
    expect(
      triggerOfDraft(
        { ...DRAFT, kind: "file_watch", paths: ["/a".padEnd(4097, "x")], debounceMs: "0" },
        NOW,
      ),
    ).toEqual({ ok: false, field: "paths", code: "invalid_trigger" });
  });

  test("file_watch: debounce outside 0..3600000 or blank is invalid_trigger on debounceMs", () => {
    expect(
      triggerOfDraft({ ...DRAFT, kind: "file_watch", paths: ["/a"], debounceMs: "3600001" }, NOW),
    ).toEqual({ ok: false, field: "debounceMs", code: "invalid_trigger" });
    expect(
      triggerOfDraft({ ...DRAFT, kind: "file_watch", paths: ["/a"], debounceMs: "" }, NOW),
    ).toEqual({ ok: false, field: "debounceMs", code: "invalid_trigger" });
  });

  test("remote: needs no fields", () => {
    expect(triggerOfDraft({ ...DRAFT, kind: "remote" }, NOW)).toEqual({
      ok: true,
      trigger: { kind: "remote" },
    });
  });

  test("repeat: a loop with a future expiry is accepted", () => {
    expect(
      triggerOfDraft(
        {
          ...DRAFT,
          kind: "repeat",
          loopIntervalSeconds: "600",
          maxIterations: "10",
          expiresAtMs: String(NOW + 1000),
        },
        NOW,
      ),
    ).toEqual({
      ok: true,
      trigger: { kind: "repeat", intervalSeconds: 600, maxIterations: 10, expiresAtMs: NOW + 1000 },
    });
  });

  test("repeat: a zero interval is accepted, the engine allows it", () => {
    expect(triggerOfDraft({ ...DRAFT, kind: "repeat", loopIntervalSeconds: "0" }, NOW)).toEqual({
      ok: true,
      trigger: { kind: "repeat", intervalSeconds: 0, maxIterations: 4, expiresAtMs: NOW + 1000 },
    });
  });

  test("repeat: maxIterations outside 1..10000 is invalid_trigger on maxIterations", () => {
    expect(triggerOfDraft({ ...DRAFT, kind: "repeat", maxIterations: "0" }, NOW)).toEqual({
      ok: false,
      field: "maxIterations",
      code: "invalid_trigger",
    });
    expect(triggerOfDraft({ ...DRAFT, kind: "repeat", maxIterations: "10001" }, NOW)).toEqual({
      ok: false,
      field: "maxIterations",
      code: "invalid_trigger",
    });
  });

  test("repeat: an interval above the maximum is invalid on loopIntervalSeconds", () => {
    expect(
      triggerOfDraft({ ...DRAFT, kind: "repeat", loopIntervalSeconds: "31536001" }, NOW),
    ).toEqual({ ok: false, field: "loopIntervalSeconds", code: "invalid_trigger" });
  });

  test("repeat: an expiry at or before now is invalid_trigger on expiresAtMs", () => {
    expect(triggerOfDraft({ ...DRAFT, kind: "repeat", expiresAtMs: String(NOW) }, NOW)).toEqual({
      ok: false,
      field: "expiresAtMs",
      code: "invalid_trigger",
    });
  });
});

describe("createParamsOf", () => {
  test("empty workspace and title are left out of the create input", () => {
    const params = createParamsOf({ kind: "remote" }, "지금 정리", "  ", "");
    expect(params).toStrictEqual({ trigger: { kind: "remote" }, prompt: "지금 정리" });
  });

  test("a workspace and a title are passed trimmed", () => {
    expect(
      createParamsOf(
        { kind: "interval", everySeconds: 600 },
        "주간 회고",
        " /Users/me/notes ",
        " 주간 회고 ",
      ),
    ).toStrictEqual({
      trigger: { kind: "interval", everySeconds: 600 },
      prompt: "주간 회고",
      workspace: "/Users/me/notes",
      title: "주간 회고",
    });
  });
});

describe("scheduleErrorKey", () => {
  test("every error code maps to its desktop.schedules.error key", () => {
    const errors: readonly ScheduleError[] = [
      { kind: "interval_too_short", minSeconds: 300 },
      { kind: "at_in_past" },
      { kind: "invalid_trigger", reason: "paths_empty" },
      { kind: "limit_reached", max: 100 },
      { kind: "not_found" },
      { kind: "not_remote" },
      { kind: "disabled" },
      { kind: "store_failed", message: "disk full" },
    ];
    expect(errors.map((error) => scheduleErrorKey(error))).toEqual([
      "desktop.schedules.error.interval_too_short",
      "desktop.schedules.error.at_in_past",
      "desktop.schedules.error.invalid_trigger",
      "desktop.schedules.error.limit_reached",
      "desktop.schedules.error.not_found",
      "desktop.schedules.error.not_remote",
      "desktop.schedules.error.disabled",
      "desktop.schedules.error.store_failed",
    ]);
  });
});

describe("serviceModeWarning", () => {
  test("warns unless the service setting is exactly true", () => {
    expect(serviceModeWarning({})).toBe(true);
    expect(serviceModeWarning({ "l0.process.service.enabled": false })).toBe(true);
    expect(serviceModeWarning({ "l0.process.service.enabled": "true" })).toBe(true);
    expect(serviceModeWarning({ "l0.process.service.enabled": true })).toBe(false);
    expect(serviceModeWarning({ "l0.process.service.enabled": true, other: 1 })).toBe(false);
  });
});
