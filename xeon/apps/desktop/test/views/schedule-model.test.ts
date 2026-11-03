import { describe, expect, test } from "bun:test";
import { catalogOf } from "@fresnel/client/i18n";
import type { ScheduleLastRun } from "@fresnel/client";
import type { ScheduleEntryView, ScheduleListItem } from "@fresnel/contracts/capabilities";
import {
  checkDraft,
  draftOfEntry,
  emptyDraft,
  NO_ERRORS,
  sheetErrorsOf,
  type ScheduleDraft,
} from "../../src/views/pages/schedules/schedule-draft.ts";
import {
  INITIAL_SCHEDULE_STATE,
  isOffline,
  keyIntentOf,
  listFailureOf,
  rowsOf,
  scheduleReducer,
  type ScheduleState,
} from "../../src/views/pages/schedules/schedule-model.ts";
import {
  lastRunStatusOf,
  type MessageRef,
  SCHEDULE_ERROR_ID,
  scheduleErrorOf,
  triggerSummaryOf,
} from "../../src/views/pages/schedules/schedule-text.ts";

// 예약 화면의 상태 기계, 시트 검사, 키 뜻, 문장 키. 시각은 NOW로 고정하고 값으로 비교한다.

const NOW = 1_800_000_000_000;

const ENTRY: ScheduleEntryView = {
  id: "sch_aa1",
  trigger: { kind: "interval", everySeconds: 600 },
  prompt: "캐시를 정리한다\n결과를 요약해 줘\n세 번째 줄",
  workspace: "/Users/me/fresnel",
  title: "캐시 정리",
  sessionKind: "cron",
  enabled: true,
  createdAt: NOW - 86_400_000,
  nextDueAt: NOW + 600_000,
  lastStartedAt: null,
  iterations: 3,
  stoppedReason: null,
};

function itemOf(
  entry: Partial<ScheduleEntryView>,
  lastRun: ScheduleListItem["lastRun"] = null,
): ScheduleListItem {
  return { entry: { ...ENTRY, ...entry }, lastRun };
}

const LATER = itemOf({ id: "sch_bb2", title: "나중", nextDueAt: NOW + 3_600_000 });
const SOONER = itemOf({ id: "sch_cc3", title: "먼저", nextDueAt: NOW + 60_000 });
const OFF = itemOf({
  id: "sch_dd4",
  title: "꺼짐",
  enabled: false,
  nextDueAt: null,
  stoppedReason: "cancelled",
});

function loaded(items: readonly ScheduleListItem[], serviceModeOff = false): ScheduleState {
  return scheduleReducer(INITIAL_SCHEDULE_STATE, {
    type: "listLoaded",
    items,
    serviceModeOff,
  });
}

describe("list state and rows", () => {
  test("a loaded list shows the enabled rows first, soonest first, and selects the first row", () => {
    const state = loaded([OFF, LATER, SOONER]);
    expect(state.list).toEqual({ kind: "ready" });
    expect(rowsOf(state).map((row) => row.id)).toEqual(["sch_cc3", "sch_bb2", "sch_dd4"]);
    expect(state.selectedId).toBe("sch_cc3");
  });

  test("a refresh keeps the selected row when it is still there", () => {
    const selected = scheduleReducer(loaded([LATER, SOONER]), { type: "select", id: "sch_bb2" });
    const refreshed = scheduleReducer(selected, {
      type: "listLoaded",
      items: [LATER, SOONER],
      serviceModeOff: false,
    });
    expect(refreshed.selectedId).toBe("sch_bb2");
  });

  test("a refresh that drops the selected row selects the first row", () => {
    const selected = scheduleReducer(loaded([LATER, SOONER]), { type: "select", id: "sch_bb2" });
    const refreshed = scheduleReducer(selected, {
      type: "listLoaded",
      items: [SOONER],
      serviceModeOff: false,
    });
    expect(refreshed.selectedId).toBe("sch_cc3");
  });

  test("the arrow moves stop at the ends and start from the first row when nothing is selected", () => {
    const start = loaded([SOONER, LATER]);
    const down = scheduleReducer(start, { type: "move", delta: 1 });
    expect(down.selectedId).toBe("sch_bb2");
    expect(scheduleReducer(down, { type: "move", delta: 1 }).selectedId).toBe("sch_bb2");
    expect(scheduleReducer(down, { type: "move", delta: -1 }).selectedId).toBe("sch_cc3");
    const unselected = { ...start, selectedId: null };
    expect(scheduleReducer(unselected, { type: "move", delta: -1 }).selectedId).toBe("sch_bb2");
    expect(scheduleReducer(unselected, { type: "move", delta: 1 }).selectedId).toBe("sch_cc3");
  });

  test("a failed read keeps the rows, and an offline read locks the actions", () => {
    const shown = loaded([SOONER]);
    const offline = scheduleReducer(shown, { type: "listFailed", reason: "offline" });
    expect(offline.list).toEqual({ kind: "offline" });
    expect(isOffline(offline)).toBe(true);
    expect(offline.items).toEqual([SOONER]);
    const failed = scheduleReducer(shown, { type: "listFailed", reason: "failed" });
    expect(failed.list).toEqual({ kind: "failed", reason: "failed" });
    expect(isOffline(failed)).toBe(false);
  });

  test("a host without the method shows the unsupported failure", () => {
    const state = scheduleReducer(INITIAL_SCHEDULE_STATE, {
      type: "listFailed",
      reason: listFailureOf({ kind: "unsupported" }),
    });
    expect(state.list).toEqual({ kind: "failed", reason: "unsupported" });
  });

  test("a command error maps to the list failure reason", () => {
    expect(listFailureOf({ kind: "offline" })).toBe("offline");
    expect(listFailureOf({ kind: "unsupported" })).toBe("unsupported");
    expect(listFailureOf({ kind: "failed" })).toBe("failed");
  });

  test("the service-mode flag comes with the list", () => {
    expect(loaded([], true).serviceModeOff).toBe(true);
    expect(loaded([], false).serviceModeOff).toBe(false);
  });

  test("the prompt fold toggles per row", () => {
    const opened = scheduleReducer(loaded([SOONER]), { type: "toggleExpanded", id: "sch_cc3" });
    expect(opened.expanded).toEqual(["sch_cc3"]);
    expect(scheduleReducer(opened, { type: "toggleExpanded", id: "sch_cc3" }).expanded).toEqual([]);
  });
});

describe("sheet, cancel confirm and notices", () => {
  const NEW_DRAFT = emptyDraft(NOW);

  test("opening a new sheet starts from the empty draft", () => {
    const state = scheduleReducer(loaded([]), { type: "openNew", nowMs: NOW });
    expect(state.sheet).toEqual({
      mode: "new",
      draft: NEW_DRAFT,
      errors: NO_ERRORS,
      sending: false,
    });
  });

  test("duplicating prefills the sheet with the same values, title, prompt, folder and trigger", () => {
    const fileWatch = itemOf({
      id: "sch_ee5",
      title: "빌드 감시",
      prompt: "빌드를 다시 돌려 줘",
      workspace: "/Users/me/code",
      trigger: { kind: "file_watch", paths: ["/Users/me/code/src"], debounceMs: 2000 },
    });
    const state = scheduleReducer(loaded([fileWatch]), {
      type: "openCopy",
      id: "sch_ee5",
      nowMs: NOW,
    });
    expect(state.sheet?.mode).toBe("copy");
    expect(state.sheet?.draft).toEqual({
      title: "빌드 감시",
      prompt: "빌드를 다시 돌려 줘",
      workspace: "/Users/me/code",
      enabled: true,
      trigger: {
        ...NEW_DRAFT.trigger,
        kind: "file_watch",
        paths: ["/Users/me/code/src"],
        debounceMs: "2000",
      },
    });
  });

  test("the sheet closes, and a failed submit keeps it open with the errors", () => {
    const opened = scheduleReducer(loaded([]), { type: "openNew", nowMs: NOW });
    const failed = scheduleReducer(opened, {
      type: "sheetFailed",
      errors: {
        fields: { prompt: { id: "desktop.schedules.promptRequired", args: {} } },
        form: null,
      },
    });
    expect(failed.sheet?.errors.fields.prompt?.id).toBe("desktop.schedules.promptRequired");
    expect(scheduleReducer(failed, { type: "sheetClosed" }).sheet).toBeNull();
  });

  test("editing the draft clears the errors", () => {
    const opened = scheduleReducer(loaded([]), { type: "openNew", nowMs: NOW });
    const failed = scheduleReducer(opened, {
      type: "sheetFailed",
      errors: { fields: {}, form: { id: "desktop.schedules.actionFailed", args: {} } },
    });
    const edited = scheduleReducer(failed, {
      type: "sheetChanged",
      draft: { ...NEW_DRAFT, prompt: "정리해 줘" },
    });
    expect(edited.sheet?.errors).toEqual(NO_ERRORS);
    expect(edited.sheet?.draft.prompt).toBe("정리해 줘");
  });

  test("the cancel confirm holds the target until it is dismissed", () => {
    const asked = scheduleReducer(loaded([SOONER]), { type: "askCancel", id: "sch_cc3" });
    expect(asked.cancelId).toBe("sch_cc3");
    expect(scheduleReducer(asked, { type: "dismissCancel" }).cancelId).toBeNull();
  });

  test("a notice is set and cleared", () => {
    const text: MessageRef = { id: "desktop.schedules.cancelled", args: {} };
    const set = scheduleReducer(loaded([]), {
      type: "notice",
      notice: { tone: "success", text },
    });
    expect(set.notice).toEqual({ tone: "success", text });
    expect(scheduleReducer(set, { type: "notice", notice: null }).notice).toBeNull();
  });
});

describe("sheet validation becomes the create input", () => {
  const base: ScheduleDraft = { ...emptyDraft(NOW), prompt: "정리해 줘" };

  test("a valid interval becomes the trigger and the prompt, with the folder and title left out when empty", () => {
    const draft: ScheduleDraft = {
      ...base,
      trigger: { ...base.trigger, kind: "interval", intervalSeconds: "600" },
    };
    expect(checkDraft(draft, NOW)).toEqual({
      ok: true,
      params: {
        trigger: { kind: "interval", everySeconds: 600 },
        prompt: "정리해 줘",
        enabled: true,
      },
    });
  });

  test("the folder and title are sent when they are filled in, and enabled follows the switch", () => {
    const draft: ScheduleDraft = {
      ...base,
      title: "  캐시 정리  ",
      workspace: "/Users/me/fresnel",
      enabled: false,
      trigger: { ...base.trigger, kind: "remote" },
    };
    expect(checkDraft(draft, NOW)).toEqual({
      ok: true,
      params: {
        trigger: { kind: "remote" },
        prompt: "정리해 줘",
        workspace: "/Users/me/fresnel",
        title: "캐시 정리",
        enabled: false,
      },
    });
  });

  test("an interval under the minimum is a field error with the minimum", () => {
    const draft: ScheduleDraft = {
      ...base,
      trigger: { ...base.trigger, kind: "interval", intervalSeconds: "60" },
    };
    const checked = checkDraft(draft, NOW);
    expect(checked).toEqual({
      ok: false,
      errors: {
        fields: {
          intervalSeconds: {
            id: "desktop.schedules.error.intervalTooShort",
            args: { minSeconds: 300 },
          },
        },
        form: null,
      },
    });
  });

  test("a time in the past and an empty prompt are both field errors", () => {
    const draft: ScheduleDraft = {
      ...base,
      prompt: "   ",
      trigger: { ...base.trigger, kind: "at", atMs: NOW - 1000 },
    };
    const checked = checkDraft(draft, NOW);
    expect(checked).toEqual({
      ok: false,
      errors: {
        fields: {
          prompt: { id: "desktop.schedules.promptRequired", args: {} },
          atMs: { id: "desktop.schedules.error.atInPast", args: {} },
        },
        form: null,
      },
    });
  });

  test("a loop whose expiry has passed is an invalid trigger on the expiry field", () => {
    const draft: ScheduleDraft = {
      ...base,
      trigger: { ...base.trigger, kind: "repeat", expiresAtMs: String(NOW - 1) },
    };
    const checked = checkDraft(draft, NOW);
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.errors.fields.expiresAtMs).toEqual({
      id: "desktop.schedules.error.invalidTrigger",
      args: {},
    });
  });

  test("a host's interval error lands under the interval field, and a limit lands on the sheet", () => {
    expect(sheetErrorsOf({ kind: "interval_too_short", minSeconds: 300 })).toEqual({
      fields: {
        intervalSeconds: {
          id: "desktop.schedules.error.intervalTooShort",
          args: { minSeconds: 300 },
        },
      },
      form: null,
    });
    expect(sheetErrorsOf({ kind: "limit_reached", max: 5 })).toEqual({
      fields: {},
      form: { id: "desktop.schedules.error.limitReached", args: { max: 5 } },
    });
  });

  test("a copy keeps the trigger values and the title, and the trigger kind's own inputs", () => {
    const copied = draftOfEntry(ENTRY, NOW);
    expect(copied.title).toBe("캐시 정리");
    expect(copied.trigger.kind).toBe("interval");
    expect(copied.trigger.intervalSeconds).toBe("600");
    expect(checkDraft(copied, NOW).ok).toBe(true);
  });
});

describe("keyboard intents", () => {
  const base = {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    editable: false,
    onRow: false,
  };

  test("Mod+N opens a new schedule, but never while an input has focus", () => {
    expect(keyIntentOf({ ...base, key: "n", metaKey: true })).toEqual({ type: "new" });
    expect(keyIntentOf({ ...base, key: "N", ctrlKey: true })).toEqual({ type: "new" });
    expect(keyIntentOf({ ...base, key: "n", metaKey: true, editable: true })).toBeNull();
    expect(keyIntentOf({ ...base, key: "n", metaKey: true, shiftKey: true })).toBeNull();
  });

  test("the arrows move on a row only, and Enter opens the last run on a row only", () => {
    expect(keyIntentOf({ ...base, key: "ArrowDown", onRow: true })).toEqual({
      type: "move",
      delta: 1,
    });
    expect(keyIntentOf({ ...base, key: "ArrowUp", onRow: true })).toEqual({
      type: "move",
      delta: -1,
    });
    expect(keyIntentOf({ ...base, key: "ArrowDown" })).toBeNull();
    expect(keyIntentOf({ ...base, key: "Enter", onRow: true })).toEqual({ type: "openThread" });
    expect(keyIntentOf({ ...base, key: "Enter" })).toBeNull();
  });

  test("Backspace asks for the cancel confirm, and nothing else with a modifier does", () => {
    expect(keyIntentOf({ ...base, key: "Backspace" })).toEqual({ type: "cancel" });
    expect(keyIntentOf({ ...base, key: "Backspace", editable: true })).toBeNull();
    expect(keyIntentOf({ ...base, key: "ArrowDown", onRow: true, altKey: true })).toBeNull();
  });
});

/** 마지막 실행 한 건(시험 값) */
function runOf(
  status: "finished" | "claimed" | "failed" | "skipped",
  outcome: "completed" | "awaiting_approval" | null,
): ScheduleLastRun {
  return { status, outcome, reason: null, threadId: null };
}

describe("message keys", () => {
  test("every error code maps to a catalog key that exists in both locales", () => {
    const ko = catalogOf("ko");
    const en = catalogOf("en");
    for (const id of Object.values(SCHEDULE_ERROR_ID)) {
      expect(ko[id] === undefined).toBe(false);
      expect(en[id] === undefined).toBe(false);
    }
    expect(Object.keys(SCHEDULE_ERROR_ID)).toHaveLength(8);
  });

  test("trigger summaries are data with a message key and its arguments", () => {
    expect(triggerSummaryOf({ kind: "interval", everySeconds: 600 }, "ko")).toEqual({
      id: "desktop.schedules.summary.interval",
      args: { seconds: 600 },
    });
    expect(triggerSummaryOf({ kind: "remote" }, "en")).toEqual({
      id: "desktop.schedules.summary.remote",
      args: {},
    });
    expect(
      triggerSummaryOf({ kind: "file_watch", paths: ["src", "docs"], debounceMs: 1000 }, "en"),
    ).toEqual({ id: "desktop.schedules.summary.fileWatch", args: { paths: "src, docs" } });
  });

  test("the last-run status pairs its text with a tone", () => {
    expect(lastRunStatusOf(runOf("finished", "completed"))).toEqual({
      label: { id: "desktop.schedules.status.completed", args: {} },
      tone: "success",
    });
    expect(lastRunStatusOf(runOf("finished", "awaiting_approval")).tone).toBe("warning");
    expect(lastRunStatusOf(runOf("claimed", null)).tone).toBe("info");
    expect(lastRunStatusOf(runOf("failed", null)).tone).toBe("danger");
    expect(lastRunStatusOf(runOf("skipped", null)).label.id).toBe(
      "desktop.schedules.status.skipped",
    );
  });

  test("a schedule error value carries the number its sentence needs", () => {
    expect(scheduleErrorOf({ kind: "limit_reached", max: 5 })).toEqual({
      id: "desktop.schedules.error.limitReached",
      args: { max: 5 },
    });
    expect(scheduleErrorOf({ kind: "not_remote" })).toEqual({
      id: "desktop.schedules.error.notRemote",
      args: {},
    });
  });
});
