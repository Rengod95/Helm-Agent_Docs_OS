import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import { WIRE_METHODS } from "../../src/wire-settings/wire/index.ts";

// M3b B1-SCH2. `schedule.create`, `schedule.list`, `schedule.cancel`, `schedule.fire`의 params와 결과를 값으로 고정한다.
// 기대한 실패는 JSON-RPC 오류가 아니라 `ok: false`의 `error`다. 결과는 값으로 왕복한다.

const SCH = "sch_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const RUN = "run_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const THREAD = "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV";

function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
function parsed(schema: Parameters<typeof parse>[0], value: unknown): unknown {
  const outcome = parse(schema, roundTrip(value));
  return outcome.ok ? outcome.value : undefined;
}

const entry = {
  id: SCH,
  trigger: { kind: "interval", everySeconds: 3600 },
  prompt: "매일 요약",
  workspace: "/work/a",
  title: null,
  sessionKind: "cron",
  enabled: true,
  createdAt: 1_790_000_000_000,
  nextDueAt: 1_790_003_600_000,
  lastStartedAt: null,
  iterations: 0,
  stoppedReason: null,
};
const run = {
  runId: RUN,
  scheduleId: SCH,
  firedBy: "remote",
  dueAt: 1_790_003_600_000,
  claimedAt: 1_790_003_600_100,
  missed: false,
  status: "started",
  threadId: THREAD,
  startedAt: 1_790_003_600_200,
  endedAt: null,
  outcome: null,
  reason: null,
  skippedCount: 0,
};
const lastRun = { ...run, status: "finished", endedAt: 1_790_003_700_000, outcome: "completed" };

const ERRORS = [
  { kind: "interval_too_short", minSeconds: 300 },
  { kind: "at_in_past" },
  { kind: "invalid_trigger", reason: "간격 0" },
  { kind: "limit_reached", max: 100 },
  { kind: "not_found" },
  { kind: "not_remote" },
  { kind: "disabled" },
  { kind: "store_failed", message: "쓰기 실패" },
];

const create = WIRE_METHODS["schedule.create"];
const list = WIRE_METHODS["schedule.list"];
const cancel = WIRE_METHODS["schedule.cancel"];
const fire = WIRE_METHODS["schedule.fire"];

describe("schedule.* registration", () => {
  test("the four methods are registered at stage M3 in the spec's order", () => {
    const names = Object.keys(WIRE_METHODS).filter((n) => n.startsWith("schedule."));
    expect(names).toEqual(["schedule.create", "schedule.list", "schedule.cancel", "schedule.fire"]);
    for (const spec of [create, list, cancel, fire]) {
      expect(spec.stage).toBe("M3");
      expect(spec.since).toBe("0.1.0");
      expect(spec.status).toBe("active");
    }
  });
});

describe("schedule.create", () => {
  const params = { trigger: { kind: "interval", everySeconds: 3600 }, prompt: "매일 요약" };

  test("params accept the input, with _meta, and reject unknown fields and bad triggers", () => {
    expect(parse(create.params, params).ok).toBe(true);
    expect(parse(create.params, { ...params, _meta: { traceparent: undefined } }).ok).toBe(true);
    expect(
      parse(create.params, { ...params, workspace: "/w", title: "t", enabled: false }).ok,
    ).toBe(true);
    expect(parse(create.params, { ...params, threadId: THREAD }).ok).toBe(false);
    expect(parse(create.params, { prompt: "p" }).ok).toBe(false);
    expect(parse(create.params, { ...params, prompt: "" }).ok).toBe(false);
    expect(parse(create.params, { ...params, enabled: "yes" }).ok).toBe(false);
    expect(parse(create.params, { trigger: { kind: "at", atMs: 0 }, prompt: "p" }).ok).toBe(false);
  });

  test("an ok result round-trips by value with the entry and warnings", () => {
    const ok = { ok: true, entry, warnings: [] };
    expect(parsed(create.result, ok)).toEqual(ok);
    const warned = { ok: true, entry, warnings: ["service_mode_off"] };
    expect(parsed(create.result, warned)).toEqual(warned);
    expect(
      parse(create.result, { ok: true, entry, warnings: ["runs_only_while_app_open"] }).ok,
    ).toBe(false);
  });

  test("an ok:false result round-trips for every error kind", () => {
    for (const error of ERRORS) {
      const failed = { ok: false, error };
      expect(parsed(create.result, failed)).toEqual(failed);
    }
  });

  test("an unknown error kind and an extra field on a result are rejected", () => {
    expect(parse(create.result, { ok: false, error: { kind: "internal" } }).ok).toBe(false);
    expect(parse(create.result, { ok: true, entry, warnings: [], extra: 1 }).ok).toBe(false);
    expect(parse(create.result, { ok: false, error: { kind: "disabled" }, extra: 1 }).ok).toBe(
      false,
    );
  });
});

describe("schedule.list", () => {
  test("params take an optional enabled flag and nothing else", () => {
    expect(parse(list.params, {}).ok).toBe(true);
    expect(parse(list.params, { enabled: true, _meta: {} }).ok).toBe(true);
    expect(parse(list.params, { enabled: "yes" }).ok).toBe(false);
    expect(parse(list.params, { limit: 5 }).ok).toBe(false);
  });

  test("an ok result carries the items with their last run or null", () => {
    const ok = {
      ok: true,
      items: [
        { entry, lastRun: null },
        { entry: { ...entry, id: "sch_B1" }, lastRun },
      ],
    };
    expect(parsed(list.result, ok)).toEqual(ok);
    expect(parsed(list.result, { ok: true, items: [] })).toEqual({ ok: true, items: [] });
  });

  test("an ok:false result round-trips for every error kind, and more than 200 items is rejected", () => {
    for (const error of ERRORS) {
      expect(parsed(list.result, { ok: false, error })).toEqual({ ok: false, error });
    }
    const item = { entry, lastRun: null };
    expect(
      parse(list.result, { ok: true, items: Array.from({ length: 201 }, () => item) }).ok,
    ).toBe(false);
  });
});

describe("schedule.cancel", () => {
  test("params take the schedule id and reject a malformed id or an extra field", () => {
    expect(parse(cancel.params, { scheduleId: SCH }).ok).toBe(true);
    expect(parse(cancel.params, { scheduleId: "run_x" }).ok).toBe(false);
    expect(parse(cancel.params, {}).ok).toBe(false);
    expect(parse(cancel.params, { scheduleId: SCH, enabled: false }).ok).toBe(false);
  });

  test("an ok result round-trips by value and an ok:false result round-trips for every error kind", () => {
    const ok = {
      ok: true,
      entry: { ...entry, enabled: false, nextDueAt: null, stoppedReason: "cancelled" },
    };
    expect(parsed(cancel.result, ok)).toEqual(ok);
    for (const error of ERRORS) {
      expect(parsed(cancel.result, { ok: false, error })).toEqual({ ok: false, error });
    }
    expect(parse(cancel.result, { ok: true, run }).ok).toBe(false);
  });
});

describe("schedule.fire", () => {
  test("params take the schedule id and reject a missing id", () => {
    expect(parse(fire.params, { scheduleId: SCH, _meta: {} }).ok).toBe(true);
    expect(parse(fire.params, {}).ok).toBe(false);
  });

  test("an ok result round-trips by value with the run", () => {
    const ok = { ok: true, run };
    expect(parsed(fire.result, ok)).toEqual(ok);
    expect(parse(fire.result, { ok: true, run: { ...run, status: "done" } }).ok).toBe(false);
  });

  test("an ok:false result round-trips for every error kind", () => {
    for (const error of ERRORS) {
      expect(parsed(fire.result, { ok: false, error })).toEqual({ ok: false, error });
    }
    expect(parse(fire.result, { ok: false, error: { kind: "not_remote" }, run }).ok).toBe(false);
  });
});
