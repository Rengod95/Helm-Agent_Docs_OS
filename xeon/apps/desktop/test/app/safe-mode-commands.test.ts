import { describe, expect, test } from "bun:test";
import type { WireResult } from "@fresnel/contracts/wire";
import { safeModeOf } from "../../src/app/setup.ts";
import { summary, thr } from "../state/helpers.ts";
import { engineFake, makeApp, until, type EngineExtra } from "./support.ts";

// 안전 모드 상태 읽기(`commands.setup.loadSafeMode`, U-06)를 가짜 엔진 위에서 본다. 칸이 없으면 거짓, null, 0이고,
// 칸이 있으면 그 값을 옮긴다. 읽기가 실패하면 오류 값을 돌려주고 원인을 로그에 남긴다.

const BASE: WireResult<"host.status"> = {
  mode: "stdio",
  pid: 4211,
  startedAt: "2026-11-04T01:00:00.000Z",
  connections: 1,
  liveTurns: 0,
  idleShutdownAt: null,
};

async function liveApp(extra: EngineExtra) {
  const engine = engineFake([summary(thr(1))], undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().link.phase === "live", "live link");
  return { app, ...engine };
}

describe("the safe mode snapshot maps host.status with defaults", () => {
  test("a host that sends none of the safe mode fields reads as off, no cause, zero failures, no suggestion", () => {
    expect(safeModeOf(BASE)).toEqual({
      active: false,
      cause: null,
      startupFailures: 0,
      suggest: false,
    });
  });

  test("safe mode with a cause keeps the cause and has no failures to show", () => {
    expect(safeModeOf({ ...BASE, safeMode: true, safeModeCause: "user" })).toEqual({
      active: true,
      cause: "user",
      startupFailures: 0,
      suggest: false,
    });
  });

  test("consecutive startup failures past the threshold carry the count and the suggestion", () => {
    expect(safeModeOf({ ...BASE, startupFailures: 3, suggestSafeMode: true })).toEqual({
      active: false,
      cause: null,
      startupFailures: 3,
      suggest: true,
    });
  });
});

describe("loadSafeMode reads host.status through the engine", () => {
  test("the read asks host.status with empty params and maps the answer", async () => {
    const { app, params } = await liveApp({
      results: { "host.status": { ...BASE, safeMode: true, safeModeCause: "flag" } },
    });
    const loaded = await app.commands.setup.loadSafeMode();
    expect(loaded).toEqual({
      ok: true,
      value: { active: true, cause: "flag", startupFailures: 0, suggest: false },
    });
    expect(params.filter((entry) => entry.method === "host.status")).toEqual([
      { method: "host.status", params: {} },
    ]);
    await app.stop();
  });

  test("a wire error comes back as an error value and is logged with its reason", async () => {
    const { app } = await liveApp({
      errors: { "host.status": { code: 3102, kind: "settings.invalidValue" } },
    });
    const loaded = await app.commands.setup.loadSafeMode();
    expect(loaded.ok).toBe(false);
    const events = app.log.lines().map((line) => line.event);
    expect(events).toContain("desktop.safeMode.read_failed");
    await app.stop();
  });
});
