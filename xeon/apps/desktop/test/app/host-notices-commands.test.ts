import { describe, expect, test } from "bun:test";
import type { WireResult } from "@fresnel/contracts/wire";
import { hostNoticesOf } from "../../src/app/setup.ts";
import { summary, thr } from "../state/helpers.ts";
import { engineFake, makeApp, until, type EngineExtra } from "./support.ts";

// 호스트 알림 읽기(`commands.setup.loadHostNotices`, `host.status`의 `settingsProblems`)를 가짜 엔진 위에서 본다.
// 칸이 없으면 빈 목록이고, 칸이 있으면 그 목록을 그대로 옮긴다. 읽기가 실패하면 오류 값을 돌려주고 원인을 로그에 남긴다.

const BASE: WireResult<"host.status"> = {
  mode: "stdio",
  pid: 4211,
  startedAt: "2026-11-04T01:00:00.000Z",
  connections: 1,
  liveTurns: 0,
  idleShutdownAt: null,
};

const PROBLEM = {
  scope: "user" as const,
  path: "/home/me/.fresnel/settings.json",
  reason: "invalid_json" as const,
  line: 3,
  column: 5,
};

async function liveApp(extra: EngineExtra) {
  const engine = engineFake([summary(thr(1))], undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().link.phase === "live", "live link");
  return { app, ...engine };
}

describe("the host notices snapshot maps host.status with defaults", () => {
  test("a host that sends no settings problems reads as an empty list", () => {
    expect(hostNoticesOf(BASE)).toEqual({ settingsProblems: [] });
  });

  test("a settings problem is carried over unchanged", () => {
    expect(hostNoticesOf({ ...BASE, settingsProblems: [PROBLEM] })).toEqual({
      settingsProblems: [PROBLEM],
    });
  });
});

describe("loadHostNotices reads host.status through the engine", () => {
  test("the read asks host.status with empty params and keeps the problem list", async () => {
    const { app, params } = await liveApp({
      results: { "host.status": { ...BASE, settingsProblems: [PROBLEM] } },
    });
    const loaded = await app.commands.setup.loadHostNotices();
    expect(loaded).toEqual({ ok: true, value: { settingsProblems: [PROBLEM] } });
    expect(params.filter((entry) => entry.method === "host.status")).toEqual([
      { method: "host.status", params: {} },
    ]);
    await app.stop();
  });

  test("a wire error comes back as an error value and is logged with its reason", async () => {
    const { app } = await liveApp({
      errors: { "host.status": { code: 3102, kind: "settings.invalidValue" } },
    });
    const loaded = await app.commands.setup.loadHostNotices();
    expect(loaded.ok).toBe(false);
    const events = app.log.lines().map((line) => line.event);
    expect(events).toContain("desktop.hostNotices.read_failed");
    await app.stop();
  });
});
