import { describe, expect, test } from "bun:test";
import type { RunView, ScheduleEntryView, ScheduleListItem } from "@fresnel/contracts/capabilities";
import type { WireParams } from "@fresnel/contracts/wire";
import { checkDraft, draftOfEntry } from "../../src/views/pages/schedules/schedule-draft.ts";
import { summary, thr } from "../state/helpers.ts";
import { engineFake, makeApp, until, type EngineExtra } from "./support.ts";

// 예약 명령(`commands.schedule`)을 가짜 엔진 위에서 끝까지 돌린다. 목록은 항목과 서비스 모드 경고로, 기대한 실패는 값으로,
// 구형 host(메서드 없음)는 `unsupported`로 오는지 본다. 값은 `toEqual`로 비교한다.

const NOW = 1_800_000_000_000;

const ENTRY: ScheduleEntryView = {
  id: "sch_aa1",
  trigger: { kind: "interval", everySeconds: 600 },
  prompt: "캐시를 정리한다",
  workspace: null,
  title: "캐시 정리",
  sessionKind: "cron",
  enabled: true,
  createdAt: NOW,
  nextDueAt: NOW + 600_000,
  lastStartedAt: null,
  iterations: 0,
  stoppedReason: null,
};

const ITEM: ScheduleListItem = { entry: ENTRY, lastRun: null };

const RUN: RunView = {
  runId: "run_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  scheduleId: "sch_aa1",
  firedBy: "remote",
  dueAt: NOW,
  claimedAt: NOW,
  missed: false,
  status: "started",
  threadId: null,
  startedAt: NOW,
  endedAt: null,
  outcome: null,
  reason: null,
  skippedCount: 0,
};

/** 설정 한 줄(`settings.get`의 값 모양). 시험 값은 서비스 모드 키 하나다 */
function serviceSetting(value: unknown) {
  return {
    key: "l0.process.service.enabled",
    value,
    source: { scope: "user" },
    locked: false,
    shadowed: [],
    runtimeChange: "live",
    pendingUntil: null,
    deprecated: false,
  };
}

async function liveApp(extra: EngineExtra) {
  const engine = engineFake([summary(thr(1))], undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().link.phase === "live", "live link");
  return { app, ...engine };
}

const paramsOf = (params: readonly { method: string; params: unknown }[], method: string) =>
  params.find((entry) => entry.method === method)?.params;

describe("schedule.list maps the list and the service-mode setting", () => {
  test("items come back as the host sent them, and a service mode that is off is reported", async () => {
    const { app } = await liveApp({
      results: {
        "schedule.list": { ok: true, items: [ITEM] },
        "settings.get": { settings: [serviceSetting(false)] },
      },
    });
    const listed = await app.commands.schedule.list({});
    expect(listed).toEqual({ ok: true, value: { items: [ITEM], serviceModeOff: true } });
    await app.stop();
  });

  test("a service mode that is on reports no warning", async () => {
    const { app } = await liveApp({
      results: {
        "schedule.list": { ok: true, items: [] },
        "settings.get": { settings: [serviceSetting(true)] },
      },
    });
    const listed = await app.commands.schedule.list({});
    expect(listed).toEqual({ ok: true, value: { items: [], serviceModeOff: false } });
    await app.stop();
  });

  test("a store failure from schedule.list is a failed command error, not a value", async () => {
    const { app } = await liveApp({
      results: {
        "schedule.list": { ok: false, error: { kind: "store_failed", message: "disk" } },
      },
    });
    const listed = await app.commands.schedule.list({});
    expect(listed).toEqual({ ok: false, error: { kind: "failed" } });
    await app.stop();
  });

  test("a host without schedule.list gets the unsupported command error", async () => {
    const { app } = await liveApp({
      errors: { "schedule.list": { code: -32601, kind: "jsonrpc.methodNotFound" } },
    });
    const listed = await app.commands.schedule.list({});
    expect(listed).toEqual({ ok: false, error: { kind: "unsupported" } });
    await app.stop();
  });
});

describe("schedule create, cancel, fire and enable return the host's values", () => {
  test("create returns ok:false with the error value, and the call itself succeeds", async () => {
    const { app, params } = await liveApp({
      results: {
        "schedule.create": { ok: false, error: { kind: "interval_too_short", minSeconds: 300 } },
      },
    });
    const created = await app.commands.schedule.create({
      trigger: { kind: "interval", everySeconds: 60 },
      prompt: "정리해 줘",
    });
    expect(created).toEqual({
      ok: true,
      value: { ok: false, error: { kind: "interval_too_short", minSeconds: 300 } },
    });
    expect(paramsOf(params, "schedule.create")).toEqual({
      trigger: { kind: "interval", everySeconds: 60 },
      prompt: "정리해 줘",
    });
    await app.stop();
  });

  test("create returns ok:true with the entry and warnings", async () => {
    const { app } = await liveApp({
      results: {
        "schedule.create": { ok: true, entry: ENTRY, warnings: ["service_mode_off"] },
      },
    });
    const created = await app.commands.schedule.create({
      trigger: { kind: "interval", everySeconds: 600 },
      prompt: "캐시를 정리한다",
    });
    expect(created).toEqual({
      ok: true,
      value: { ok: true, entry: ENTRY, warnings: ["service_mode_off"] },
    });
    await app.stop();
  });

  test("cancel sends the schedule id and returns the not_found value as a value", async () => {
    const { app, params } = await liveApp({
      results: { "schedule.cancel": { ok: false, error: { kind: "not_found" } } },
    });
    const cancelled = await app.commands.schedule.cancel("sch_aa1");
    expect(cancelled).toEqual({ ok: true, value: { ok: false, error: { kind: "not_found" } } });
    expect(paramsOf(params, "schedule.cancel")).toEqual({ scheduleId: "sch_aa1" });
    await app.stop();
  });

  test("enableService writes the service key at user scope with the value true", async () => {
    const { app, params } = await liveApp({
      results: { "settings.set": { setting: serviceSetting(true) } },
    });
    const enabled = await app.commands.schedule.enableService();
    expect(enabled).toEqual({ ok: true, value: null });
    expect(paramsOf(params, "settings.set")).toEqual({
      key: "l0.process.service.enabled",
      value: true,
      scope: "user",
    });
    await app.stop();
  });

  test("a host without schedule.create gets the unsupported command error", async () => {
    const { app } = await liveApp({
      errors: { "schedule.create": { code: -32601, kind: "jsonrpc.methodNotFound" } },
    });
    const created = await app.commands.schedule.create({
      trigger: { kind: "remote" },
      prompt: "원격",
    });
    expect(created).toEqual({ ok: false, error: { kind: "unsupported" } });
    await app.stop();
  });
});

describe("each row action sends its exact wire params", () => {
  test("the list asks for the enabled rows, or for all rows with no argument", async () => {
    const { app, params } = await liveApp({
      results: {
        "schedule.list": { ok: true, items: [] },
        "settings.get": { settings: [serviceSetting(true)] },
      },
    });
    await app.commands.schedule.list({ enabled: true });
    await app.commands.schedule.list({});
    const sent = params
      .filter((entry) => entry.method === "schedule.list")
      .map((entry) => entry.params);
    expect(sent).toEqual([{ enabled: true }, {}]);
    await app.stop();
  });

  test("fire sends the schedule id and returns the run the host started", async () => {
    const { app, params } = await liveApp({
      results: { "schedule.fire": { ok: true, run: RUN } },
    });
    const fired = await app.commands.schedule.fire("sch_aa1");
    expect(fired).toEqual({ ok: true, value: { ok: true, run: RUN } });
    expect(paramsOf(params, "schedule.fire")).toEqual({ scheduleId: "sch_aa1" });
    await app.stop();
  });

  test("duplicate prefills the sheet from the entry, and submitting it sends the exact create params", async () => {
    const drafted = checkDraft(draftOfEntry(ENTRY, NOW), NOW);
    const expected: WireParams<"schedule.create"> = {
      trigger: { kind: "interval", everySeconds: 600 },
      prompt: "캐시를 정리한다",
      title: "캐시 정리",
      enabled: true,
    };
    expect(drafted).toEqual({ ok: true, params: expected });
    const { app, params } = await liveApp({
      results: {
        "schedule.create": { ok: true, entry: ENTRY, warnings: [] },
      },
    });
    const created = await app.commands.schedule.create(expected);
    expect(created).toEqual({ ok: true, value: { ok: true, entry: ENTRY, warnings: [] } });
    expect(paramsOf(params, "schedule.create")).toEqual(expected);
    await app.stop();
  });
});
