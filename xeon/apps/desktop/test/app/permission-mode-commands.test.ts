import { describe, expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { WIRE_ERRORS, type EventWire } from "@fresnel/contracts/wire";
import { evt, thr } from "../state/helpers.ts";
import { engineFake, makeApp, tick, until, type EngineExtra } from "./support.ts";

// 입력창 승인 모드 칩의 명령을 가짜 엔진 위에서 돌린다. 보낸 params는 `toEqual`로 정확히 비교하고,
// 설정 변경 알림은 대화 범위와 키로 걸러지는지 본다.

const KEY = "l1.tools.permissionMode";

async function liveApp(extra: EngineExtra) {
  const engine = engineFake(undefined, undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().link.phase === "live", "live link");
  return { app, ...engine };
}

const paramsOf = (params: readonly { method: string; params: unknown }[], method: string) =>
  params.filter((entry) => entry.method === method).map((entry) => entry.params);

/** `settings.get`·`settings.set`이 돌려주는 유효 값 한 줄. 필드는 wire 모양 그대로다 */
const setting = (value: unknown) => ({
  key: KEY,
  value,
  source: { scope: "launch" },
  locked: false,
  shadowed: [],
  runtimeChange: "live",
  pendingUntil: null,
  deprecated: false,
});

/** 호스트 안에서 쓴 세션 값(계획 승인 등)이 남기는 내구 `settings.changed` 기록 */
const settingsEvent = (seq: number, threadId: ThreadId, key = KEY): EventWire => ({
  id: evt(seq),
  kind: "settings.changed",
  version: 1,
  durable: true,
  seq,
  parentId: null,
  threadId,
  turnId: null,
  stepId: null,
  recordedAt: "2026-11-07T10:00:00.000Z",
  causationId: null,
  correlationId: "c",
  payload: { key, scope: "launch", value: "acceptEdits" },
  redactions: [],
});

describe("thread permission mode commands", () => {
  test("setThreadMode writes the launch scope of that thread only", async () => {
    const { app, params } = await liveApp({
      results: { "settings.set": { setting: setting("acceptEdits") } },
    });
    const done = await app.commands.setThreadMode(thr(1), "acceptEdits");
    expect(done).toEqual({ ok: true, value: null });
    expect(paramsOf(params, "settings.set")).toEqual([
      { key: KEY, value: "acceptEdits", scope: "launch", threadId: thr(1) },
    ]);
    await app.stop();
  });

  test("a lock held by another process comes back as locked and opens the lock dialog", async () => {
    const { app } = await liveApp({
      errors: {
        "settings.set": {
          code: 3002,
          kind: "thread.locked",
          details: { ownerKind: "cli", options: ["observe"] },
        },
      },
    });
    const done = await app.commands.setThreadMode(thr(1), "default");
    expect(done).toEqual({
      ok: false,
      error: { kind: "locked", ownerKind: "cli", options: ["observe"] },
    });
    expect(app.ui.read.getState().locked).toEqual({
      threadId: thr(1),
      ownerKind: "cli",
      options: ["observe"],
    });
    await app.stop();
  });

  test("a refused write (managed setting locks the key) comes back as a rejection", async () => {
    const { app } = await liveApp({
      errors: {
        "settings.set": {
          code: WIRE_ERRORS["settings.locked"].code,
          kind: "settings.locked",
        },
      },
    });
    const done = await app.commands.setThreadMode(thr(1), "default");
    expect(done.ok).toBe(false);
    await app.stop();
  });

  test("readThreadMode reads the value for that thread and passes it through unchecked", async () => {
    const { app, params } = await liveApp({
      results: { "settings.get": { settings: [setting("plan")] } },
    });
    const got = await app.commands.readThreadMode(thr(1));
    expect(got).toEqual({ ok: true, value: "plan" });
    expect(paramsOf(params, "settings.get")).toContainEqual({ keys: [KEY], threadId: thr(1) });
    await app.stop();
  });

  test("readThreadMode gives undefined when the host sends no value for the key", async () => {
    const { app } = await liveApp({ results: { "settings.get": { settings: [] } } });
    expect(await app.commands.readThreadMode(thr(1))).toEqual({ ok: true, value: undefined });
    await app.stop();
  });

  test("onThreadModeChanged wakes for this thread's mode key and for unscoped changes only", async () => {
    const { app, fake } = await liveApp({});
    let woke = 0;
    const stop = app.commands.onThreadModeChanged(thr(1), () => void (woke += 1));
    // 다른 키, 다른 대화, 그리고 대화에 묶이지 않은 전체 변경 두 가지를 차례로 보낸다
    fake.emitLine({
      jsonrpc: "2.0",
      method: "settings.invalidated",
      params: { keys: ["l4.cli.theme"], scopes: ["launch"], threadId: thr(1) },
    });
    fake.emitLine({
      jsonrpc: "2.0",
      method: "settings.invalidated",
      params: { keys: [KEY], scopes: ["launch"], threadId: thr(2) },
    });
    fake.emitLine({
      jsonrpc: "2.0",
      method: "settings.invalidated",
      params: { keys: [], scopes: ["user"], threadId: null },
    });
    fake.emitLine({
      jsonrpc: "2.0",
      method: "settings.invalidated",
      params: { keys: [KEY], scopes: ["launch"], threadId: thr(1) },
    });
    await until(() => woke >= 1, "first wake-up");
    await tick(20);
    expect(woke).toBe(2);
    stop();
    fake.emitLine({
      jsonrpc: "2.0",
      method: "settings.invalidated",
      params: { keys: [KEY], scopes: ["launch"], threadId: thr(1) },
    });
    await tick(20);
    expect(woke).toBe(2);
    await app.stop();
  });

  test("a session write with no invalidation (plan approval) wakes through the event batch, for this thread's mode key only", async () => {
    const { app, fake } = await liveApp({});
    let woke = 0;
    const stop = app.commands.onThreadModeChanged(thr(1), () => void (woke += 1));
    const batch = (from: number, events: EventWire[]): void =>
      fake.emitLine({
        jsonrpc: "2.0",
        method: "events.batch",
        params: { sub: "s1", from, to: from + 1, caughtUp: true, events },
      });
    batch(5, [settingsEvent(6, thr(2))]);
    batch(6, [settingsEvent(7, thr(1), "l4.cli.theme")]);
    batch(7, [settingsEvent(8, thr(1))]);
    await tick(20);
    expect(woke).toBe(1);
    stop();
    batch(8, [settingsEvent(9, thr(1))]);
    await tick(20);
    expect(woke).toBe(1);
    await app.stop();
  });
});
