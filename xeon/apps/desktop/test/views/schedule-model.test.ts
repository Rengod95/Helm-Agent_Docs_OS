import { describe, expect, test } from "bun:test";
import { catalogOf } from "@fresnel/client/i18n";
import { scheduleRowOf, type ScheduleLastRun } from "@fresnel/client";
import type { RunView, ScheduleEntryView, ScheduleListItem } from "@fresnel/contracts/capabilities";
import type { ThreadOrigin } from "@fresnel/contracts/wire";
import {
  checkDraft,
  checkEditDraft,
  draftOfEntry,
  emptyDraft,
  NO_ERRORS,
  sheetErrorsOf,
  type ScheduleDraft,
} from "../../src/views/pages/schedules/schedule-draft.ts";
import {
  canAct,
  INITIAL_SCHEDULE_STATE,
  isOffline,
  keyIntentOf,
  listFailureOf,
  listParamsOf,
  noticeOf,
  rowMenuOf,
  rowsOf,
  scheduleReducer,
  scheduleRunSignatureOf,
  type ScheduleState,
} from "../../src/views/pages/schedules/schedule-model.ts";
import {
  FILTER_ID,
  lastRunAtOf,
  lastRunStatusOf,
  message,
  nextRunTextOf,
  ROW_ACTION_ID,
  type MessageRef,
  SCHEDULE_ERROR_ID,
  scheduleErrorOf,
  timeTextOf,
  triggerSummaryOf,
} from "../../src/views/pages/schedules/schedule-text.ts";
import { summary, thr } from "../state/helpers.ts";

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
    serviceRestartPending: false,
    nowMs: NOW,
  });
}

/** 목록 항목 한 줄의 마지막 실행 기록. 시험 값은 끝난 실행 하나다 */
function finishedRunOf(overrides: Partial<RunView>): RunView {
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
      serviceRestartPending: false,
      nowMs: NOW,
    });
    expect(refreshed.selectedId).toBe("sch_bb2");
  });

  test("a refresh that drops the selected row selects the first row", () => {
    const selected = scheduleReducer(loaded([LATER, SOONER]), { type: "select", id: "sch_bb2" });
    const refreshed = scheduleReducer(selected, {
      type: "listLoaded",
      items: [SOONER],
      serviceModeOff: false,
      serviceRestartPending: false,
      nowMs: NOW,
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

  test("turning the service on without a restart leaves the restart pending and clears the off flag", () => {
    const off = loaded([], true);
    expect(off.serviceRestartPending).toBe(false);
    const enabled = scheduleReducer(off, { type: "serviceEnabled", restartPending: true });
    expect(enabled.serviceModeOff).toBe(false);
    expect(enabled.serviceRestartPending).toBe(true);
  });

  test("a list that reports the restart as done clears the pending flag", () => {
    const pending = scheduleReducer(loaded([], true), {
      type: "serviceEnabled",
      restartPending: true,
    });
    const reloaded = scheduleReducer(pending, {
      type: "listLoaded",
      items: [],
      serviceModeOff: false,
      serviceRestartPending: false,
      nowMs: NOW,
    });
    expect(reloaded.serviceRestartPending).toBe(false);
    expect(reloaded.serviceModeOff).toBe(false);
  });

  test("a turn-on that needs no restart clears the off flag and leaves no restart pending", () => {
    const enabled = scheduleReducer(loaded([], true), {
      type: "serviceEnabled",
      restartPending: false,
    });
    expect(enabled.serviceModeOff).toBe(false);
    expect(enabled.serviceRestartPending).toBe(false);
  });

  test("a list that still reports the restart pending keeps the restart notice", () => {
    const withNotice = scheduleReducer(
      scheduleReducer(loaded([], true), { type: "serviceEnabled", restartPending: true }),
      {
        type: "notice",
        notice: noticeOf(
          { id: "desktop.schedules.service.enabledRestart", args: {} },
          "success",
          "restartEngine",
        ),
      },
    );
    const reloaded = scheduleReducer(withNotice, {
      type: "listLoaded",
      items: [],
      serviceModeOff: false,
      serviceRestartPending: true,
      nowMs: NOW,
    });
    expect(reloaded.notice?.action).toBe("restartEngine");
  });

  test("a list that reports the restart done drops the restart notice but keeps other notices", () => {
    const withRestartNotice = scheduleReducer(
      scheduleReducer(loaded([], true), { type: "serviceEnabled", restartPending: true }),
      {
        type: "notice",
        notice: noticeOf(
          { id: "desktop.schedules.service.enabledRestart", args: {} },
          "success",
          "restartEngine",
        ),
      },
    );
    const dropped = scheduleReducer(withRestartNotice, {
      type: "listLoaded",
      items: [],
      serviceModeOff: false,
      serviceRestartPending: false,
      nowMs: NOW,
    });
    expect(dropped.notice).toBeNull();
    const other = scheduleReducer(loaded([]), {
      type: "notice",
      notice: noticeOf({ id: "desktop.schedules.cancelled", args: {} }, "success"),
    });
    const kept = scheduleReducer(other, {
      type: "listLoaded",
      items: [],
      serviceModeOff: false,
      serviceRestartPending: false,
      nowMs: NOW,
    });
    expect(kept.notice).toEqual({
      tone: "success",
      text: { id: "desktop.schedules.cancelled", args: {} },
      action: null,
    });
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
      scheduleId: null,
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
      notice: { tone: "success", text, action: null },
    });
    expect(set.notice).toEqual({ tone: "success", text, action: null });
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
      id: "desktop.schedules.summary.everyMinutes",
      args: { count: 10 },
    });
    expect(triggerSummaryOf({ kind: "interval", everySeconds: 3600 }, "ko")).toEqual({
      id: "desktop.schedules.summary.everyHours",
      args: { count: 1 },
    });
    expect(triggerSummaryOf({ kind: "interval", everySeconds: 86400 }, "ko").args).toEqual({
      count: 24,
    });
    expect(triggerSummaryOf({ kind: "interval", everySeconds: 5400 }, "ko").args).toEqual({
      count: 90,
    });
    expect(triggerSummaryOf({ kind: "interval", everySeconds: 90 }, "ko")).toEqual({
      id: "desktop.schedules.summary.everySeconds",
      args: { count: 90 },
    });
    expect(triggerSummaryOf({ kind: "interval", everySeconds: 301 }, "ko")).toEqual({
      id: "desktop.schedules.summary.everySeconds",
      args: { count: 301 },
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

describe("filter, list time and the row menu", () => {
  test("the list opens on the enabled rows, with no list time yet", () => {
    expect(INITIAL_SCHEDULE_STATE.filter).toBe("enabled");
    expect(INITIAL_SCHEDULE_STATE.nowMs).toBe(0);
  });

  test("the filter is a wire argument: enabled asks for enabled rows, all asks with no argument", () => {
    expect(listParamsOf("enabled")).toEqual({ enabled: true });
    expect(listParamsOf("all")).toEqual({});
  });

  test("a loaded list keeps the time it was read at, for the relative times", () => {
    expect(loaded([LATER]).nowMs).toBe(NOW);
  });

  test("changing the filter clears the selection, the open prompts and the cancel confirm, and keeps the filter", () => {
    const state: ScheduleState = {
      ...loaded([LATER, SOONER]),
      expanded: ["sch_bb2"],
      cancelId: "sch_bb2",
    };
    const changed = scheduleReducer(state, { type: "filterChanged", filter: "all" });
    expect(changed.filter).toBe("all");
    expect(changed.selectedId).toBeNull();
    expect(changed.expanded).toEqual([]);
    expect(changed.cancelId).toBeNull();
    expect(changed.items).toEqual([LATER, SOONER]);
  });

  test("a remote row with a thread on the list has open, run now, cancel and duplicate, in that order", () => {
    const row = scheduleRowOf(
      itemOf({ id: "sch_rr1", trigger: { kind: "remote" } }, finishedRunOf({})),
    );
    expect(rowMenuOf(row, true, true)).toEqual([
      { action: "openThread", disabled: false },
      { action: "fire", disabled: false },
      { action: "runs", disabled: false },
      { action: "edit", disabled: false },
      { action: "cancel", disabled: false },
      { action: "copy", disabled: false },
    ]);
  });

  test("an interval row with no run has only cancel and duplicate, and a thread no longer on the list is locked", () => {
    const plain = scheduleRowOf(itemOf({ id: "sch_pp1" }));
    expect(rowMenuOf(plain, true, false)).toEqual([
      { action: "runs", disabled: false },
      { action: "edit", disabled: false },
      { action: "cancel", disabled: false },
      { action: "copy", disabled: false },
    ]);
    const gone = scheduleRowOf(itemOf({ id: "sch_gg1" }, finishedRunOf({})));
    expect(rowMenuOf(gone, true, false)).toEqual([
      { action: "openThread", disabled: true },
      { action: "runs", disabled: false },
      { action: "edit", disabled: false },
      { action: "cancel", disabled: false },
      { action: "copy", disabled: false },
    ]);
  });

  test("a switched-off row has no cancel, and offline or busy locks every item", () => {
    const off = scheduleRowOf(
      itemOf({ id: "sch_of1", enabled: false, nextDueAt: null }, finishedRunOf({})),
    );
    expect(rowMenuOf(off, true, true)).toEqual([
      { action: "openThread", disabled: false },
      { action: "reenable", disabled: false },
      { action: "runs", disabled: false },
      { action: "edit", disabled: false },
      { action: "copy", disabled: false },
    ]);
    const remote = scheduleRowOf(
      itemOf({ id: "sch_rr2", trigger: { kind: "remote" } }, finishedRunOf({})),
    );
    expect(rowMenuOf(remote, false, true)).toEqual([
      { action: "openThread", disabled: true },
      { action: "fire", disabled: true },
      { action: "runs", disabled: true },
      { action: "edit", disabled: true },
      { action: "cancel", disabled: true },
      { action: "copy", disabled: true },
    ]);
    const offline = loaded([]);
    expect(canAct({ ...offline, busy: true })).toBe(false);
  });

  test("the next run reads as a relative time: soon, minutes, the clock, tomorrow, and the absolute time after that", () => {
    const now = new Date(2026, 10, 4, 8, 0).getTime();
    const soon = new Date(2026, 10, 4, 8, 0, 30).getTime();
    const minutes = new Date(2026, 10, 4, 8, 20).getTime();
    const today = new Date(2026, 10, 4, 14, 20).getTime();
    const tomorrow = new Date(2026, 10, 5, 9, 0).getTime();
    const later = new Date(2026, 10, 9, 9, 5).getTime();
    expect(nextRunTextOf(soon, now, "ko")).toEqual(message("desktop.common.due.soon"));
    expect(nextRunTextOf(minutes, now, "ko")).toEqual(
      message("desktop.common.due.inMinutes", { count: 20 }),
    );
    expect(nextRunTextOf(today, now, "ko")).toEqual(
      message("desktop.common.due.at", { time: "14:20" }),
    );
    expect(nextRunTextOf(tomorrow, now, "ko")).toEqual(
      message("desktop.common.due.tomorrow", { time: "09:00" }),
    );
    expect(nextRunTextOf(later, now, "ko")).toEqual(
      message("desktop.common.due.at", { time: timeTextOf(later, "ko") }),
    );
  });

  test("the last run time is the end, else the start, else the claim", () => {
    expect(lastRunAtOf(finishedRunOf({ endedAt: 9, startedAt: 7, claimedAt: 5 }))).toBe(9);
    expect(lastRunAtOf(finishedRunOf({ endedAt: null, startedAt: 7, claimedAt: 5 }))).toBe(7);
    expect(lastRunAtOf(finishedRunOf({ endedAt: null, startedAt: null, claimedAt: 5 }))).toBe(5);
  });

  test("the filter, the row menu and the due-time sentences exist in both locales", () => {
    const ko = catalogOf("ko");
    const en = catalogOf("en");
    const ids: readonly string[] = [
      ...Object.values(FILTER_ID),
      ...Object.values(ROW_ACTION_ID),
      "desktop.schedules.rowMenu",
      "desktop.schedules.filter.label",
      "desktop.common.due.soon",
      "desktop.common.due.inMinutes",
      "desktop.common.due.at",
      "desktop.common.due.tomorrow",
    ];
    for (const id of ids) {
      expect(ko[id] === undefined).toBe(false);
      expect(en[id] === undefined).toBe(false);
    }
  });
});

describe("edit sheet and run history", () => {
  test("opening edit fills title and prompt from the entry and remembers the schedule id", () => {
    const state = scheduleReducer(loaded([LATER]), { type: "openEdit", id: "sch_bb2", nowMs: NOW });
    expect(state.sheet?.mode).toBe("edit");
    expect(state.sheet?.scheduleId).toBe("sch_bb2");
    expect(state.sheet?.draft.title).toBe("나중");
    expect(state.sheet?.draft.prompt).toBe(LATER.entry.prompt);
  });

  test("edit check sends the prompt and a non-empty trimmed title only, and rejects an empty prompt", () => {
    const base = emptyDraft(NOW);
    expect(checkEditDraft({ ...base, title: " 새 제목 ", prompt: "해 줘" }, "sch_x")).toEqual({
      ok: true,
      params: { scheduleId: "sch_x", prompt: "해 줘", title: "새 제목" },
    });
    expect(checkEditDraft({ ...base, title: "  ", prompt: "해 줘" }, "sch_x")).toEqual({
      ok: true,
      params: { scheduleId: "sch_x", prompt: "해 줘" },
    });
    expect(checkEditDraft({ ...base, prompt: " " }, "sch_x")).toEqual({
      ok: false,
      errors: {
        fields: { prompt: message("desktop.schedules.promptRequired") },
        form: null,
      },
    });
  });

  test("run history ignores an answer for a schedule that is no longer shown", () => {
    const started = scheduleReducer(loaded([LATER]), { type: "runsStarted", scheduleId: "sch_a" });
    expect(started.runs).toEqual({ kind: "loading", scheduleId: "sch_a" });
    const stale = scheduleReducer(started, { type: "runsLoaded", scheduleId: "sch_b", runs: [] });
    expect(stale.runs).toEqual({ kind: "loading", scheduleId: "sch_a" });
    const run = {
      runId: "run_1",
      startedAt: "2026-11-04T00:00:00.000Z",
      endedAt: null,
      outcome: "failed" as const,
      threadId: null,
      error: "boom",
    };
    const ready = scheduleReducer(started, {
      type: "runsLoaded",
      scheduleId: "sch_a",
      runs: [run],
    });
    expect(ready.runs).toEqual({ kind: "ready", scheduleId: "sch_a", runs: [run] });
    expect(scheduleReducer(ready, { type: "runsClosed" }).runs).toBeNull();
    const failed = scheduleReducer(started, {
      type: "runsFailed",
      scheduleId: "sch_a",
      reason: "offline",
    });
    expect(failed.runs).toEqual({ kind: "failed", scheduleId: "sch_a", reason: "offline" });
  });
});

describe("run signature of schedule threads", () => {
  const SCHEDULE: ThreadOrigin = { kind: "schedule", scheduleId: "daily" };

  test("threads that a user or a remote client started do not count", () => {
    expect(scheduleRunSignatureOf([summary(thr(1), { status: "running" })])).toBe("");
    const withUser = [
      summary(thr(1), { status: "running" }),
      summary(thr(2), { status: "idle", origin: SCHEDULE }),
    ];
    expect(scheduleRunSignatureOf(withUser)).toBe(
      scheduleRunSignatureOf([summary(thr(2), { status: "idle", origin: SCHEDULE })]),
    );
    expect(scheduleRunSignatureOf(withUser)).toBe(`${thr(2)}:idle`);
  });

  test("a schedule thread that changes status changes the signature, so a run start or end is seen", () => {
    const idle = scheduleRunSignatureOf([summary(thr(2), { status: "idle", origin: SCHEDULE })]);
    const running = scheduleRunSignatureOf([
      summary(thr(2), { status: "running", origin: SCHEDULE }),
    ]);
    expect(running).toBe(`${thr(2)}:running`);
    expect(running).not.toBe(idle);
  });

  test("the order of the threads does not change the signature", () => {
    const a = summary(thr(2), { status: "idle", origin: SCHEDULE });
    const b = summary(thr(3), { status: "running", origin: SCHEDULE });
    expect(scheduleRunSignatureOf([a, b])).toBe(`${thr(2)}:idle|${thr(3)}:running`);
    expect(scheduleRunSignatureOf([b, a])).toBe(scheduleRunSignatureOf([a, b]));
  });
});
