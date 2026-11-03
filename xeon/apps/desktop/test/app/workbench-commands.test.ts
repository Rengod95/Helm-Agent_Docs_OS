import { describe, expect, test } from "bun:test";
import type { TraceTurnResult } from "@fresnel/contracts/extensions";
import type {
  ExtHealthEntry,
  HookEntry,
  HooksOrderGetResult,
  HooksOrderPreviewResult,
  HooksOrderResetResult,
  HooksOrderSetResult,
} from "@fresnel/contracts/wire";
import { thr, trn } from "../state/helpers.ts";
import { engineFake, makeApp, until } from "./support.ts";

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
