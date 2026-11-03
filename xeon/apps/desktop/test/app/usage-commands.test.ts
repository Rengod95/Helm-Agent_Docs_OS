import { describe, expect, test } from "bun:test";
import type { UsageGetResult } from "@fresnel/contracts/wire";
import { thr } from "../state/helpers.ts";
import { engineFake, makeApp, until, type EngineExtra } from "./support.ts";

// 사용량 명령(`commands.usage.get`)을 가짜 엔진 위에서 끝까지 돌린다. wire params는 `toEqual`로 정확히 비교한다.
// 게이지 값은 손으로 적은 기대 값과 같은지 본다(한도와 재설정 시각을 모르면 null이다).

async function liveApp(extra: EngineExtra) {
  const engine = engineFake([], undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().link.phase === "live", "live link");
  return { app, ...engine };
}

const paramsOf = (params: readonly { method: string; params: unknown }[], method: string) =>
  params.filter((entry) => entry.method === method).map((entry) => entry.params);

const BODY: UsageGetResult = {
  gauges: [
    {
      id: "anthropic::session:tokens",
      providerId: "anthropic",
      account: null,
      window: "session",
      unit: "tokens",
      used: 41_000,
      limit: null,
      resetsAt: null,
    },
    {
      id: "anthropic::session:usd",
      providerId: "anthropic",
      account: null,
      window: "session",
      unit: "usd",
      used: 0.82,
      limit: null,
      resetsAt: null,
    },
  ],
  asOf: "2026-11-04T00:00:00.000Z",
};

describe("usage.get from the account screen", () => {
  test("the threadId goes out as the wire names it, and the gauges come back as the wire value", async () => {
    const { app, params } = await liveApp({ results: { "usage.get": BODY } });
    const got = await app.commands.usage.get({ threadId: thr(1) });
    expect(paramsOf(params, "usage.get")).toEqual([{ threadId: thr(1) }]);
    expect(got).toEqual({ ok: true, value: BODY });
    await app.stop();
  });

  test("a providerId filter goes out alone, with no conversation", async () => {
    const { app, params } = await liveApp({
      results: { "usage.get": { gauges: [], asOf: BODY.asOf } },
    });
    const got = await app.commands.usage.get({ providerId: "anthropic" });
    expect(paramsOf(params, "usage.get")).toEqual([{ providerId: "anthropic" }]);
    expect(got).toEqual({ ok: true, value: { gauges: [], asOf: BODY.asOf } });
    await app.stop();
  });

  test("a conversation the host does not know is a rejected command, not a value", async () => {
    const { app } = await liveApp({
      errors: {
        "usage.get": {
          code: -32001,
          kind: "thread.notFound",
          details: { threadId: thr(9) },
        },
      },
    });
    expect(await app.commands.usage.get({ threadId: thr(9) })).toEqual({
      ok: false,
      error: { kind: "rejected", code: -32001 },
    });
    await app.stop();
  });

  test("with no connection the read is offline", async () => {
    const engine = engineFake();
    const app = makeApp(engine.fake);
    expect(await app.commands.usage.get({ threadId: thr(1) })).toEqual({
      ok: false,
      error: { kind: "offline" },
    });
    await app.stop();
  });
});
