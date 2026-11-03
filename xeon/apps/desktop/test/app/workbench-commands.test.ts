import { describe, expect, test } from "bun:test";
import type { TraceTurnResult } from "@fresnel/contracts/extensions";
import type {
  EventWire,
  ExtHealthEntry,
  HookEntry,
  HooksOrderGetResult,
  HooksOrderPreviewResult,
  HooksOrderResetResult,
  HooksOrderSetResult,
} from "@fresnel/contracts/wire";
import {
  hasScopeChange,
  isExtSettingsChange,
  subscribeExtChanges,
} from "../../src/app/workbench-commands.ts";
import { fakeConnection } from "../state/fake-connection.ts";
import { evt, SUB, thr, trn } from "../state/helpers.ts";
import { engineFake, makeApp, tick, until } from "./support.ts";

// 크래프트 명령이 보내는 wire 메서드와 params(W-22 ext.health, W-36 hooks.list, W-51 hooks.order.*, W-43 trace.turn).
// 가짜 엔진 위에서 명령을 부르고, 보낸 메서드와 params, 돌아온 값을 값으로 본다.

type Extra = Parameters<typeof engineFake>[2];

async function liveApp(extra: Extra) {
  const engine = engineFake(undefined, undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().threads.status === "ready", "threads ready");
  return { app, ...engine };
}

/** 메서드 이름으로 보낸 params를 보낸 순서대로 모은다 */
const paramsOf = (
  calls: readonly { readonly method: string; readonly params: unknown }[],
  method: string,
): unknown[] => calls.filter((call) => call.method === method).map((call) => call.params);

const HEALTH: ExtHealthEntry = {
  name: "web",
  registrationId: "web",
  consecutiveFailures: 2,
  windowFailures: 2,
  windowMs: 1000,
  autoDisabled: false,
  lastFailureAt: "2026-11-04T10:00:00Z",
  lastError: "timeout",
};

describe("크래프트 명령의 wire 호출", () => {
  test("ext.health는 모든 확장을 뜻하는 빈 params로 보내고 장부 배열을 돌려준다", async () => {
    const { app, params } = await liveApp({ results: { "ext.health": { health: [HEALTH] } } });
    const got = await app.commands.workbench.health();
    expect(got).toEqual({ ok: true, value: [HEALTH] });
    expect(paramsOf(params, "ext.health")).toEqual([{}]);
    await app.stop();
  });

  test("hooks.list는 빈 params로 보내고 hooks 배열을 돌려준다", async () => {
    const hook: HookEntry = {
      hook: "tool.call.before",
      fold: "first",
      handlers: 1,
      registrations: ["web"],
      external: false,
      order: [{ registrationId: "web", extension: "web", tier: 0, status: "enabled", error: null }],
    };
    const { app, params } = await liveApp({ results: { "hooks.list": { hooks: [hook] } } });
    const got = await app.commands.workbench.hooks();
    expect(got).toEqual({ ok: true, value: [hook] });
    expect(paramsOf(params, "hooks.list")).toEqual([{}]);
    await app.stop();
  });

  test("hooks.order.get은 빈 params로 보내고 저장 값과 적용 순서를 그대로 돌려준다", async () => {
    const body: HooksOrderGetResult = {
      hooks: [{ hook: "tool.call.before", saved: [], applied: ["web"], pending: false }],
    };
    const { app, params } = await liveApp({ results: { "hooks.order.get": body } });
    expect(await app.commands.workbench.orderGet()).toEqual({ ok: true, value: body });
    expect(paramsOf(params, "hooks.order.get")).toEqual([{}]);
    await app.stop();
  });

  test("orderSet은 hook과 order를 보내고, 저장 결과를 돌려준다", async () => {
    const result: HooksOrderSetResult = {
      hook: "tool.call.before",
      saved: ["core", "web"],
      appliesAt: "nextStepBoundary",
    };
    const { app, params } = await liveApp({ results: { "hooks.order.set": result } });
    const got = await app.commands.workbench.orderSet("tool.call.before", ["core", "web"]);
    expect(got).toEqual({ ok: true, value: result });
    expect(paramsOf(params, "hooks.order.set")).toEqual([
      { hook: "tool.call.before", order: ["core", "web"] },
    ]);
    await app.stop();
  });

  test("orderReset은 훅을 생략하면 빈 params를, 주면 hook을 보낸다", async () => {
    const result: HooksOrderResetResult = {
      hooks: ["tool.call.before"],
      appliesAt: "nextStepBoundary",
    };
    const { app, params } = await liveApp({ results: { "hooks.order.reset": result } });
    expect(await app.commands.workbench.orderReset()).toEqual({ ok: true, value: result });
    expect(await app.commands.workbench.orderReset("tool.call.before")).toEqual({
      ok: true,
      value: result,
    });
    expect(paramsOf(params, "hooks.order.reset")).toEqual([{}, { hook: "tool.call.before" }]);
    await app.stop();
  });

  test("orderPreview는 hook과 order를 보내고 미리보기 결과를 그대로 돌려준다", async () => {
    const result: HooksOrderPreviewResult = {
      hook: "tool.call.before",
      order: ["core", "web"],
      saveable: true,
      skips: [],
      valueChanges: [],
      autoDisable: [],
      guardRisk: [],
    };
    const { app, params } = await liveApp({ results: { "hooks.order.preview": result } });
    expect(await app.commands.workbench.orderPreview("tool.call.before", ["core", "web"])).toEqual({
      ok: true,
      value: result,
    });
    expect(paramsOf(params, "hooks.order.preview")).toEqual([
      { hook: "tool.call.before", order: ["core", "web"] },
    ]);
    await app.stop();
  });

  test("trace는 threadId와 turnId를 보내고 턴 계측을 그대로 돌려준다", async () => {
    const turn: TraceTurnResult = {
      traceEnabled: true,
      retained: true,
      entries: [
        {
          seq: 1,
          hook: "tool.call.before",
          step: 0,
          handlers: [{ registrationId: "web", ms: 3, result: "ok" }],
        },
      ],
    };
    const { app, params } = await liveApp({ results: { "trace.turn": turn } });
    expect(await app.commands.workbench.trace(thr(1), trn(1))).toEqual({ ok: true, value: turn });
    expect(paramsOf(params, "trace.turn")).toEqual([{ threadId: thr(1), turnId: trn(1) }]);
    await app.stop();
  });

  test("호스트에 메서드가 없으면(-32601) 명령은 unsupported 값이다", async () => {
    const { app } = await liveApp({
      errors: { "hooks.list": { code: -32601, kind: "jsonrpc.methodNotFound" } },
    });
    expect(await app.commands.workbench.hooks()).toEqual({
      ok: false,
      error: { kind: "unsupported" },
    });
    await app.stop();
  });
});

/** 내구 이벤트 하나(시험용). 종류와 seq만 바꾼다 */
const durable = (kind: EventWire["kind"], seq: number): EventWire => ({
  id: evt(seq),
  kind,
  version: 1,
  durable: true,
  seq,
  parentId: null,
  threadId: thr(1),
  turnId: null,
  stepId: null,
  recordedAt: "2026-11-04T10:00:00.000Z",
  causationId: null,
  correlationId: "c",
  payload: {},
  redactions: [],
});

describe("확장 목록을 다시 읽을 알림", () => {
  test("확장 설정 키가 바뀌었거나 키 목록이 비면(전체) 맞고, 다른 설정만 바뀌면 아니다", () => {
    expect(isExtSettingsChange({ keys: ["ext.web.enabled"] })).toBe(true);
    expect(isExtSettingsChange({ keys: ["l4.cli.theme", "ext.core-loop.enabled"] })).toBe(true);
    expect(isExtSettingsChange({ keys: [] })).toBe(true);
    expect(isExtSettingsChange({ keys: ["l1.models.default"] })).toBe(false);
  });

  test("내구 이벤트 묶음에 scope.changed가 있을 때만 맞다(자동 끄기 기록)", () => {
    expect(hasScopeChange({ events: [durable("scope.changed", 6)] })).toBe(true);
    expect(hasScopeChange({ events: [durable("turn.started", 6)] })).toBe(false);
    expect(hasScopeChange({ events: [] })).toBe(false);
  });

  test("구독은 맞는 알림마다 한 번 부르고, 구독을 풀면 더 부르지 않는다", () => {
    const fake = fakeConnection({});
    let woke = 0;
    const stop = subscribeExtChanges(fake.connection, () => void (woke += 1));
    fake.emit("settings.invalidated", {
      keys: ["ext.web.enabled"],
      scopes: ["user"],
      threadId: null,
    });
    fake.emit("settings.invalidated", {
      keys: ["l1.models.default"],
      scopes: ["user"],
      threadId: null,
    });
    fake.emit("events.batch", {
      sub: SUB,
      from: 5,
      to: 6,
      caughtUp: true,
      events: [durable("turn.started", 6)],
    });
    expect(woke).toBe(1);
    fake.emit("events.batch", {
      sub: SUB,
      from: 6,
      to: 7,
      caughtUp: true,
      events: [durable("scope.changed", 7)],
    });
    expect(woke).toBe(2);
    stop();
    fake.emit("settings.invalidated", { keys: [], scopes: ["user"], threadId: null });
    fake.emit("events.batch", {
      sub: SUB,
      from: 7,
      to: 8,
      caughtUp: true,
      events: [durable("scope.changed", 8)],
    });
    expect(woke).toBe(2);
  });

  test("명령의 onChanged는 살아 있는 연결의 ext 설정 무효화 알림에 반응한다", async () => {
    const { app, fake } = await liveApp({});
    let woke = 0;
    const stop = app.commands.workbench.onChanged(() => void (woke += 1));
    fake.emitLine({
      jsonrpc: "2.0",
      method: "settings.invalidated",
      params: { keys: ["ext.web.enabled"], scopes: ["user"], threadId: null },
    });
    await until(() => woke === 1, "ext settings wake-up");
    stop();
    fake.emitLine({
      jsonrpc: "2.0",
      method: "settings.invalidated",
      params: { keys: ["ext.web.enabled"], scopes: ["user"], threadId: null },
    });
    await tick(20);
    expect(woke).toBe(1);
    await app.stop();
  });
});
