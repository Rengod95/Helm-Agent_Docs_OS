import { describe, expect, test } from "bun:test";
import type { TraceTurnResult } from "@fresnel/contracts/extensions";
import {
  WIRE_ERRORS,
  type EventWire,
  type ExtHealthEntry,
  type ExtRollbackResult,
  type ExtVersionsResult,
  type HookEntry,
  type HooksOrderGetResult,
  type HooksOrderPreviewResult,
  type HooksOrderResetResult,
  type HooksOrderSetResult,
  type VolatileEventWire,
  type Profile,
  type ProfileApplyResult,
  type ProfileListResult,
} from "@fresnel/contracts/wire";
import {
  asksDisable,
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

/** 보낸 메서드 이름 가운데 `names`에 든 것만 보낸 순서대로 모은다(두 호출의 순서를 본다) */
const orderOf = (methods: readonly string[], ...names: readonly string[]): string[] =>
  methods.filter((method) => names.includes(method));

/** `settings.set`이 돌려주는 저장 결과. 답 명령은 이 결과를 받아야 다음 호출로 넘어간다 */
const SETTING_WRITTEN = {
  setting: {
    key: "ext.review.enabled",
    value: false,
    source: { scope: "user" },
    locked: false,
    shadowed: [],
    runtimeChange: "live",
    pendingUntil: null,
    deprecated: false,
  },
};

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

/** 휘발 scope.handler_failed 조각. 열린 대화마다 온다 */
function failedChunk(payload: unknown): { readonly event: VolatileEventWire } {
  return {
    event: {
      id: evt(1),
      kind: "scope.handler_failed",
      version: 1,
      durable: false,
      threadId: thr(1),
      turnId: null,
      stepId: null,
      recordedAt: "2026-11-04T00:00:00.000Z",
      causationId: null,
      correlationId: "c",
      n: 0,
      afterSeq: 3,
      payload,
    },
  };
}
const failurePayload = {
  owner: "ext:review",
  point: "tool.result",
  result: "threw",
  message: "boom",
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
          handlers: [
            {
              registrationId: "web",
              ms: 3,
              result: "passed",
              atMs: 0,
              size: 0,
              skippedBy: null,
              reason: null,
            },
          ],
        },
      ],
    };
    const { app, params } = await liveApp({ results: { "trace.turn": turn } });
    expect(await app.commands.workbench.trace(thr(1), trn(1))).toEqual({ ok: true, value: turn });
    expect(paramsOf(params, "trace.turn")).toEqual([{ threadId: thr(1), turnId: trn(1) }]);
    await app.stop();
  });

  test("켜 두기와 다시 켜기 답은 설정에 켜짐을 쓰고 그다음 ext.reenable을 name만 담아 보내며 값 null을 돌려준다", async () => {
    const applied = { appliesAt: "nextStepBoundary", diagnostics: [] };
    const { app, params, methods } = await liveApp({
      results: { "settings.set": SETTING_WRITTEN, "ext.reenable": applied },
    });
    expect(await app.commands.workbench.reenable("review")).toEqual({ ok: true, value: null });
    expect(paramsOf(params, "settings.set")).toEqual([
      { key: "ext.review.enabled", value: true, scope: "user" },
    ]);
    expect(paramsOf(params, "ext.reenable")).toEqual([{ name: "review" }]);
    expect(orderOf(methods, "settings.set", "ext.reenable")).toEqual([
      "settings.set",
      "ext.reenable",
    ]);
    await app.stop();
  });

  test("다시 켜기의 설정 쓰기가 거절되면 ext.reenable을 보내지 않고 코드를 담은 오류 값이다", async () => {
    const { app, params } = await liveApp({
      errors: {
        "settings.set": { code: WIRE_ERRORS["settings.locked"].code, kind: "settings.locked" },
      },
    });
    expect(await app.commands.workbench.reenable("review")).toEqual({
      ok: false,
      error: { kind: "rejected", code: WIRE_ERRORS["settings.locked"].code },
    });
    expect(paramsOf(params, "ext.reenable")).toEqual([]);
    await app.stop();
  });

  test("끄기 답은 설정에 끄기를 user 범위로 쓴 뒤 ext.disableConfirm을 name만 담아 보내고 값 null을 돌려준다", async () => {
    const applied = { appliesAt: "nextStepBoundary", diagnostics: [] };
    const { app, params, methods } = await liveApp({
      results: { "settings.set": SETTING_WRITTEN, "ext.disableConfirm": applied },
    });
    expect(await app.commands.workbench.keepOff("review")).toEqual({ ok: true, value: null });
    expect(paramsOf(params, "settings.set")).toEqual([
      { key: "ext.review.enabled", value: false, scope: "user" },
    ]);
    expect(paramsOf(params, "ext.disableConfirm")).toEqual([{ name: "review" }]);
    expect(orderOf(methods, "settings.set", "ext.disableConfirm")).toEqual([
      "settings.set",
      "ext.disableConfirm",
    ]);
    await app.stop();
  });

  test("끄기 답의 설정 쓰기가 관리 위치 잠금으로 거절되면 ext.disableConfirm을 보내지 않고 코드를 담은 오류 값이다", async () => {
    const { app, params } = await liveApp({
      errors: {
        "settings.set": { code: WIRE_ERRORS["settings.locked"].code, kind: "settings.locked" },
      },
    });
    expect(await app.commands.workbench.keepOff("review")).toEqual({
      ok: false,
      error: { kind: "rejected", code: WIRE_ERRORS["settings.locked"].code },
    });
    expect(paramsOf(params, "ext.disableConfirm")).toEqual([]);
    await app.stop();
  });

  test("설정에는 꺼졌는데 ext.disableConfirm이 거절되면 설정을 켜짐으로 되돌리고 그 코드를 담은 오류 값이다", async () => {
    const { app, params, methods } = await liveApp({
      results: { "settings.set": SETTING_WRITTEN },
      errors: {
        "ext.disableConfirm": {
          code: WIRE_ERRORS["extension.safeModeActive"].code,
          kind: "extension.safeModeActive",
        },
      },
    });
    expect(await app.commands.workbench.keepOff("review")).toEqual({
      ok: false,
      error: { kind: "rejected", code: WIRE_ERRORS["extension.safeModeActive"].code },
    });
    expect(paramsOf(params, "settings.set")).toEqual([
      { key: "ext.review.enabled", value: false, scope: "user" },
      { key: "ext.review.enabled", value: true, scope: "user" },
    ]);
    expect(orderOf(methods, "settings.set", "ext.disableConfirm")).toEqual([
      "settings.set",
      "ext.disableConfirm",
      "settings.set",
    ]);
    await app.stop();
  });

  test("켜 두기 답이 안전 모드로 거절되면 코드를 담은 오류 값이다", async () => {
    const { app } = await liveApp({
      results: { "settings.set": SETTING_WRITTEN },
      errors: {
        "ext.reenable": {
          code: WIRE_ERRORS["extension.safeModeActive"].code,
          kind: "extension.safeModeActive",
        },
      },
    });
    expect(await app.commands.workbench.reenable("review")).toEqual({
      ok: false,
      error: { kind: "rejected", code: WIRE_ERRORS["extension.safeModeActive"].code },
    });
    await app.stop();
  });

  test("이 대화에서 끄기는 settings.set을 범위 launch와 대화 id와 함께 보내고 값 null을 돌려준다", async () => {
    const saved = {
      setting: {
        key: "ext.helm.enabled",
        value: false,
        source: { scope: "launch" },
        locked: false,
        shadowed: [],
        runtimeChange: "live",
        pendingUntil: null,
        deprecated: false,
      },
    };
    const { app, params } = await liveApp({ results: { "settings.set": saved } });
    const request = {
      key: "ext.helm.enabled",
      value: false,
      scope: "launch" as const,
      threadId: thr(1),
    };
    expect(await app.commands.workbench.toggleForThread(request)).toEqual({
      ok: true,
      value: null,
    });
    expect(paramsOf(params, "settings.set")).toEqual([
      { key: "ext.helm.enabled", value: false, scope: "launch", threadId: thr(1) },
    ]);
    await app.stop();
  });

  test("이 대화에서 끄기가 대화 범위 거절(thread.notFound)이면 코드를 담은 오류 값이다", async () => {
    const { app } = await liveApp({
      errors: {
        "settings.set": { code: WIRE_ERRORS["thread.notFound"].code, kind: "thread.notFound" },
      },
    });
    expect(
      await app.commands.workbench.toggleForThread({
        key: "ext.helm.enabled",
        value: true,
        scope: "launch",
        threadId: thr(1),
      }),
    ).toEqual({
      ok: false,
      error: { kind: "rejected", code: WIRE_ERRORS["thread.notFound"].code },
    });
    await app.stop();
  });

  test("프로필 목록은 빈 params로 보내고 프로필 배열을 돌려준다", async () => {
    const QUIET: Profile = {
      id: "quiet",
      title: "조용히",
      enable: ["helm"],
      disable: [],
      settings: [],
      driver: null,
      updatedAt: "2026-11-04T10:00:00Z",
      rev: 1,
    };
    const listed: ProfileListResult = { profiles: [QUIET], rev: 1 };
    const { app, params } = await liveApp({ results: { "profile.list": listed } });
    expect(await app.commands.workbench.profiles()).toEqual({ ok: true, value: [QUIET] });
    expect(paramsOf(params, "profile.list")).toEqual([{}]);
    await app.stop();
  });

  test("프로필 적용은 id, threadId, layer thread를 보내고 쓴 키와 적용 시점을 돌려준다", async () => {
    const applied: ProfileApplyResult = {
      written: ["ext.helm.enabled"],
      layer: "thread",
      appliesAt: "nextStepBoundary",
    };
    const { app, params } = await liveApp({ results: { "profile.apply": applied } });
    expect(await app.commands.workbench.applyProfile("quiet", thr(1))).toEqual({
      ok: true,
      value: applied,
    });
    expect(paramsOf(params, "profile.apply")).toEqual([
      { id: "quiet", threadId: thr(1), layer: "thread" },
    ]);
    await app.stop();
  });

  test("프로필이 없으면(profile.notFound) 코드를 담은 오류 값이다", async () => {
    const { app } = await liveApp({
      errors: {
        "profile.apply": { code: WIRE_ERRORS["profile.notFound"].code, kind: "profile.notFound" },
      },
    });
    expect(await app.commands.workbench.applyProfile("gone", thr(1))).toEqual({
      ok: false,
      error: { kind: "rejected", code: WIRE_ERRORS["profile.notFound"].code },
    });
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

  test("versions는 name만 보내고 앱에 든 번들 판을 담은 결과를 그대로 돌려준다", async () => {
    const body: ExtVersionsResult = {
      versions: [
        {
          version: "0.2.0",
          installedAt: "2026-11-02T00:00:00.000Z",
          source: "user",
          manifestHash: "h2",
          stateSchemaVersion: null,
          current: true,
        },
      ],
      bundledVersion: "0.1.0",
    };
    const { app, params } = await liveApp({ results: { "ext.versions": body } });
    expect(await app.commands.workbench.versions("helm")).toEqual({ ok: true, value: body });
    expect(paramsOf(params, "ext.versions")).toEqual([{ name: "helm" }]);
    await app.stop();
  });

  test("installPreview는 출처를, install은 출처와 미리 보기 해시를 그대로 보낸다", async () => {
    const sha256 = "b".repeat(64);
    const installed = {
      name: "docs",
      version: "1.0.0",
      location: "/ext/docs",
      appliesAt: "restart",
    } as const;
    const { app, params } = await liveApp({ results: { "ext.install": installed } });
    expect(await app.commands.workbench.install("/plugins/docs", sha256)).toEqual({
      ok: true,
      value: installed,
    });
    expect(paramsOf(params, "ext.install")).toEqual([{ source: "/plugins/docs", sha256 }]);
    await app.stop();
  });

  test("reload는 이름만 ext.reload로 보내고 거절은 오류 값으로 돌려준다", async () => {
    const { app, params } = await liveApp({
      results: { "ext.reload": { appliesAt: "nextStepBoundary", diagnostics: [] } },
    });
    expect(await app.commands.workbench.reload("docs")).toEqual({ ok: true, value: null });
    expect(paramsOf(params, "ext.reload")).toEqual([{ name: "docs" }]);
    await app.stop();
    const refused = await liveApp({
      errors: { "ext.reload": { code: 3403, kind: "extension.safeModeActive" } },
    });
    expect(await refused.app.commands.workbench.reload("docs")).toEqual({
      ok: false,
      error: { kind: "rejected", code: 3403 },
    });
    await refused.app.stop();
  });

  test("install이 안전 모드와 잠금으로 거절되면 화면이 가를 수 있는 오류로 돌아온다", async () => {
    const { app } = await liveApp({
      errors: { "ext.install": { code: 3403, kind: "extension.safeModeActive" } },
    });
    const refused = await app.commands.workbench.install("/plugins/docs", "b".repeat(64));
    expect(refused).toEqual({ ok: false, error: { kind: "rejected", code: 3403 } });
    await app.stop();
  });

  test("rollback은 번들 판을 version으로 보내고 clearState는 참일 때만 싣는다", async () => {
    const result: ExtRollbackResult = { appliesAt: "restart", stateCleared: false };
    const { app, params } = await liveApp({ results: { "ext.rollback": result } });
    expect(await app.commands.workbench.rollback("helm", "0.1.0", false)).toEqual({
      ok: true,
      value: "restart",
    });
    expect(await app.commands.workbench.rollback("helm", "0.1.0", true)).toEqual({
      ok: true,
      value: "restart",
    });
    expect(paramsOf(params, "ext.rollback")).toEqual([
      { name: "helm", version: "0.1.0" },
      { name: "helm", version: "0.1.0", clearState: true },
    ]);
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

  test("새 끌까요 질문을 알리는 조각(asksDisable)에서만 목록을 다시 읽는다", () => {
    expect(asksDisable(failedChunk({ ...failurePayload, consecutive: 5, asksDisable: true }))).toBe(
      true,
    );
    expect(asksDisable(failedChunk({ ...failurePayload, consecutive: 4 }))).toBe(false);
    expect(
      asksDisable(failedChunk({ ...failurePayload, consecutive: 5, asksDisable: false })),
    ).toBe(false);
    expect(asksDisable(failedChunk({ owner: "ext:review" }))).toBe(false);
    const fake = fakeConnection({});
    let woke = 0;
    const stop = subscribeExtChanges(fake.connection, () => void (woke += 1));
    fake.emit("stream.chunk", failedChunk({ ...failurePayload, consecutive: 4 }));
    expect(woke).toBe(0);
    fake.emit(
      "stream.chunk",
      failedChunk({ ...failurePayload, consecutive: 5, asksDisable: true }),
    );
    expect(woke).toBe(1);
    stop();
    fake.emit(
      "stream.chunk",
      failedChunk({ ...failurePayload, consecutive: 5, asksDisable: true }),
    );
    expect(woke).toBe(1);
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
