import { describe, expect, test } from "bun:test";
import { engineFake, makeApp, until, type EngineExtra } from "./support.ts";
import { thr } from "../state/helpers.ts";

const KEY = "l1.models.thinkingLevel";

async function liveApp(extra: EngineExtra) {
  const engine = engineFake(undefined, undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().link.phase === "live", "live link");
  return { app, ...engine };
}

const paramsOf = (params: readonly { method: string; params: unknown }[], method: string) =>
  params.filter((entry) => entry.method === method).map((entry) => entry.params);

const setting = (value: unknown) => ({
  key: KEY,
  value,
  source: { scope: "launch" },
  locked: false,
  shadowed: [],
  runtimeChange: "nextTurn",
  pendingUntil: null,
  deprecated: false,
});

describe("thread thinking level commands", () => {
  test("setThreadThinking writes the launch scope of that thread only", async () => {
    const { app, params } = await liveApp({
      results: { "settings.set": { setting: setting("high") } },
    });
    expect(await app.commands.setThreadThinking(thr(1), "high")).toEqual({ ok: true, value: null });
    expect(paramsOf(params, "settings.set")).toEqual([
      { key: KEY, value: "high", scope: "launch", threadId: thr(1) },
    ]);
    await app.stop();
  });

  test("readThreadThinking reads the effective value for that thread unchecked", async () => {
    const { app, params } = await liveApp({
      results: { "settings.get": { settings: [setting("low")] } },
    });
    expect(await app.commands.readThreadThinking(thr(1))).toEqual({ ok: true, value: "low" });
    expect(paramsOf(params, "settings.get")).toContainEqual({ keys: [KEY], threadId: thr(1) });
    await app.stop();
  });
});
