import { describe, expect, test } from "bun:test";
import { parse } from "../../src/base/index.ts";
import {
  RunIdSchema,
  RunViewSchema,
  SCHEDULE_CAPABILITIES,
  ScheduleEntries,
  ScheduleEntriesKey,
  ScheduleEntryViewSchema,
  ScheduleErrorSchema,
  ScheduleIdSchema,
  ScheduleListItemSchema,
  ScheduleTriggerSchema,
  validateCapability,
  validateCapabilitySet,
  type RunView,
  type ScheduleEntryView,
  type ScheduleError,
  type ScheduleListItem,
  type ScheduleTrigger,
} from "../../src/capabilities/index.ts";

// M3b B1-SCH2. 능력 `schedule.entries`(L2.schedule.spec §4.4.9)의 정의를 값으로 고정한다.
// 트리거와 항목 모양은 cap-schedule의 TriggerSpec, ScheduleEntry, RunRecord와 같은 필드다.

const SCH = "sch_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const RUN = "run_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const THREAD = "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const CREATE = ScheduleEntries.service.methods.create;
const LIST = ScheduleEntries.service.methods.list;
const CANCEL = ScheduleEntries.service.methods.cancel;
const FIRE = ScheduleEntries.service.methods.fire;
const TOOL = ScheduleEntries.tools[0];

const entry: ScheduleEntryView = {
  id: SCH,
  trigger: { kind: "interval", everySeconds: 3600 },
  prompt: "매일 요약",
  workspace: null,
  title: "요약",
  sessionKind: "cron",
  enabled: true,
  createdAt: 1_790_000_000_000,
  nextDueAt: 1_790_003_600_000,
  lastStartedAt: null,
  iterations: 0,
  stoppedReason: null,
};

const run: RunView = {
  runId: RUN,
  scheduleId: SCH,
  firedBy: "interval",
  dueAt: 1_790_003_600_000,
  claimedAt: 1_790_003_600_100,
  missed: false,
  status: "finished",
  threadId: THREAD,
  startedAt: 1_790_003_600_200,
  endedAt: 1_790_003_700_000,
  outcome: "completed",
  reason: null,
  skippedCount: 0,
};

describe("schedule.entries definition", () => {
  test("validates with no issues, warnings included, alone and in the set", () => {
    expect(validateCapability(ScheduleEntries)).toEqual([]);
    expect(validateCapabilitySet(SCHEDULE_CAPABILITIES)).toEqual([]);
  });

  test("the id and version are the capability ones, and the key carries them", () => {
    expect(ScheduleEntries.id).toBe("schedule.entries");
    expect(ScheduleEntries.version).toBe("1.0.0");
    expect(ScheduleEntriesKey).toEqual({ capability: "schedule.entries", version: "1.0.0" });
    expect(SCHEDULE_CAPABILITIES.map((d) => d.id)).toEqual(["schedule.entries"]);
  });

  test("the four methods and the only model tool schedule_create", () => {
    expect(Object.keys(ScheduleEntries.service.methods).toSorted()).toEqual([
      "cancel",
      "create",
      "fire",
      "list",
    ]);
    expect(ScheduleEntries.tools.map((t) => t.name)).toEqual(["schedule_create"]);
    expect(TOOL.method).toBe("create");
    expect(TOOL.label).toBe("예약 만들기");
    expect(TOOL.executionMode).toBe("sequential");
    expect(TOOL.replay).toBeUndefined();
    expect(TOOL.hints).toEqual({
      readOnly: false,
      destructive: false,
      idempotent: false,
      openWorld: false,
    });
  });

  test("declared errors: the common not_found is not declared (validate rejects shadowing)", () => {
    expect(Object.keys(CREATE.errors ?? {}).toSorted()).toEqual([
      "at_in_past",
      "interval_too_short",
      "invalid_trigger",
      "limit_reached",
      "store_failed",
    ]);
    expect(Object.keys(LIST.errors ?? {})).toEqual(["store_failed"]);
    expect(Object.keys(CANCEL.errors ?? {})).toEqual(["store_failed"]);
    expect(Object.keys(FIRE.errors ?? {}).toSorted()).toEqual([
      "disabled",
      "not_remote",
      "store_failed",
    ]);
    for (const decl of Object.values(CREATE.errors ?? {})) expect(decl.retryable).toBe(false);
  });
});

describe("schedule.entries effect classes (ADR-0015 §3.3)", () => {
  test("list is read only and replay safe", () => {
    expect(LIST.readOnly).toBe(true);
    expect(LIST.replay).toBe("safe");
    expect(LIST.idempotent).toBeUndefined();
  });

  test("create, cancel and fire carry no marks: unsafe replay, not idempotent, not read only", () => {
    for (const method of [CREATE, CANCEL, FIRE]) {
      expect(method.replay).toBeUndefined();
      expect(method.idempotent).toBeUndefined();
      expect(method.readOnly).toBeUndefined();
    }
  });
});

describe("schedule.entries inputs and the create tool", () => {
  test("every interval passes as an interval trigger and the method input accepts it", () => {
    const input = TOOL.toInput?.({ prompt: "p", everySeconds: 300 });
    expect(input).toEqual({ trigger: { kind: "interval", everySeconds: 300 }, prompt: "p" });
    expect(parse(CREATE.input, input).ok).toBe(true);
  });

  test("a valid RFC 3339 time becomes an at trigger in epoch milliseconds", () => {
    const input = TOOL.toInput?.({ prompt: "p", at: "2026-11-01T09:00:00Z", title: "t" });
    expect(input).toEqual({
      trigger: { kind: "at", atMs: Date.UTC(2026, 10, 1, 9) },
      prompt: "p",
      title: "t",
    });
    expect(parse(CREATE.input, input).ok).toBe(true);
  });

  test("no title key appears when the model gives none", () => {
    const input = TOOL.toInput?.({ prompt: "p", everySeconds: 600 });
    expect(input !== undefined && "title" in input).toBe(false);
  });

  test("both everySeconds and at, or neither, becomes an at trigger with atMs 0 that the method input rejects", () => {
    const both = TOOL.toInput?.({ prompt: "p", everySeconds: 600, at: "2026-11-01T09:00:00Z" });
    const neither = TOOL.toInput?.({ prompt: "p" });
    expect(both).toEqual({ trigger: { kind: "at", atMs: 0 }, prompt: "p" });
    expect(neither).toEqual({ trigger: { kind: "at", atMs: 0 }, prompt: "p" });
    expect(parse(CREATE.input, both).ok).toBe(false);
    expect(parse(CREATE.input, neither).ok).toBe(false);
  });

  test("an unparsable at becomes atMs 0 and is rejected by the method input", () => {
    const input = TOOL.toInput?.({ prompt: "p", at: "내일 아침" });
    expect(input).toEqual({ trigger: { kind: "at", atMs: 0 }, prompt: "p" });
    expect(parse(CREATE.input, input).ok).toBe(false);
  });

  test("the tool result is one line with the next due time, or none", () => {
    const withNext = TOOL.toContent?.({ entry });
    const without = TOOL.toContent?.({ entry: { ...entry, nextDueAt: null } });
    expect(withNext?.content).toEqual([
      { type: "text", text: `schedule ${SCH} next=2026-09-21T15:13:20.000Z` },
    ]);
    expect(without?.content).toEqual([{ type: "text", text: `schedule ${SCH} next=none` }]);
  });
});

describe("schedule.entries schemas", () => {
  test("ids accept the sch and run prefixes and reject the other prefix", () => {
    expect(parse(ScheduleIdSchema, SCH).ok).toBe(true);
    expect(parse(ScheduleIdSchema, RUN).ok).toBe(false);
    expect(parse(ScheduleIdSchema, "sch_").ok).toBe(false);
    expect(parse(RunIdSchema, RUN).ok).toBe(true);
    expect(parse(RunIdSchema, SCH).ok).toBe(false);
  });

  test("the five trigger kinds parse by value", () => {
    const triggers: ScheduleTrigger[] = [
      { kind: "interval", everySeconds: 60 },
      { kind: "at", atMs: 1_790_000_000_000 },
      { kind: "file_watch", paths: ["/tmp/a.txt"], debounceMs: 500 },
      { kind: "remote" },
      { kind: "loop", intervalSeconds: 0, maxIterations: 3, expiresAtMs: 1_790_000_000_000 },
    ];
    for (const trigger of triggers)
      expect(parse(ScheduleTriggerSchema, trigger)).toEqual({
        ok: true,
        value: trigger,
      });
  });

  test("the trigger schema does not hardcode the 300 second minimum; the engine checks it", () => {
    expect(parse(ScheduleTriggerSchema, { kind: "interval", everySeconds: 60 }).ok).toBe(true);
  });

  test("triggers reject unknown fields, atMs 0, a zero interval, an empty paths list and unknown kinds", () => {
    const bad: unknown[] = [
      { kind: "remote", extra: 1 },
      { kind: "at", atMs: 0 },
      { kind: "interval", everySeconds: 0 },
      { kind: "interval", everySeconds: 31536001 },
      { kind: "interval", everySeconds: 1.5 },
      { kind: "file_watch", paths: [], debounceMs: 0 },
      { kind: "file_watch", paths: ["/a"], debounceMs: 3600001 },
      { kind: "loop", intervalSeconds: 0, maxIterations: 0, expiresAtMs: 1 },
      { kind: "loop", intervalSeconds: 0, maxIterations: 1, expiresAtMs: 0 },
      { kind: "cron", expr: "0 9 * * *" },
    ];
    for (const trigger of bad) expect(parse(ScheduleTriggerSchema, trigger).ok).toBe(false);
  });

  test("an entry view round trips by value and a bad session kind or stop reason is rejected", () => {
    expect(parse(ScheduleEntryViewSchema, entry)).toEqual({ ok: true, value: entry });
    expect(parse(ScheduleEntryViewSchema, { ...entry, sessionKind: "manual" }).ok).toBe(false);
    expect(parse(ScheduleEntryViewSchema, { ...entry, stoppedReason: "other" }).ok).toBe(false);
    expect(parse(ScheduleEntryViewSchema, { ...entry, extra: true }).ok).toBe(false);
    const stopped: ScheduleEntryView = {
      ...entry,
      enabled: false,
      nextDueAt: null,
      stoppedReason: "cancelled",
    };
    expect(parse(ScheduleEntryViewSchema, stopped)).toEqual({ ok: true, value: stopped });
  });

  test("a run view round trips by value and rejects an unknown status", () => {
    expect(parse(RunViewSchema, run)).toEqual({ ok: true, value: run });
    expect(parse(RunViewSchema, { ...run, status: "done" }).ok).toBe(false);
    const skipped: RunView = {
      ...run,
      status: "skipped",
      threadId: null,
      startedAt: null,
      endedAt: null,
      outcome: null,
      reason: "overlap",
      skippedCount: 4,
    };
    expect(parse(RunViewSchema, skipped)).toEqual({ ok: true, value: skipped });
  });

  test("a list item holds the entry and its last run or null, and rejects extra fields", () => {
    const items: ScheduleListItem[] = [
      { entry, lastRun: null },
      { entry: { ...entry, id: "sch_B" }, lastRun: run },
    ];
    for (const item of items)
      expect(parse(ScheduleListItemSchema, item)).toEqual({ ok: true, value: item });
    expect(parse(ScheduleListItemSchema, { entry, lastRun: null, extra: 1 }).ok).toBe(false);
  });

  test("every error kind is accepted, a wrong detail type or an unknown kind is rejected", () => {
    const kinds: ScheduleError[] = [
      { kind: "interval_too_short", minSeconds: 300 },
      { kind: "at_in_past" },
      { kind: "invalid_trigger", reason: "간격 0" },
      { kind: "limit_reached", max: 100 },
      { kind: "not_found" },
      { kind: "not_remote" },
      { kind: "disabled" },
      { kind: "store_failed", message: "쓰기 실패" },
    ];
    for (const error of kinds)
      expect(parse(ScheduleErrorSchema, error)).toEqual({ ok: true, value: error });
    expect(parse(ScheduleErrorSchema, { kind: "interval_too_short", minSeconds: "300" }).ok).toBe(
      false,
    );
    expect(parse(ScheduleErrorSchema, { kind: "unknown" }).ok).toBe(false);
  });

  test("the list output holds at most 200 items", () => {
    const item = { entry, lastRun: null };
    expect(parse(LIST.output, { items: Array.from({ length: 200 }, () => item) }).ok).toBe(true);
    expect(parse(LIST.output, { items: Array.from({ length: 201 }, () => item) }).ok).toBe(false);
  });
});
