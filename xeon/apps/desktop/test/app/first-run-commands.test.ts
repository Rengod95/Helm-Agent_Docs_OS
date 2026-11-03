import { describe, expect, test } from "bun:test";
import type { WireResult } from "@fresnel/contracts/wire";
import { summary, thr } from "../state/helpers.ts";
import { engineFake, makeApp, until, type EngineExtra } from "./support.ts";

// 첫 실행 화면의 명령(`commands.setup`의 그룹·검색 메서드)을 가짜 엔진 위에서 돌린다. 기본 그룹 토글은 정확한 `settings.set` 값을
// 쓰는지, 읽기는 저장된 값과 안전 모드를 어떻게 옮기는지, 검색 "나중에"는 데스크톱 로컬 설정 키를 쓰는지 본다. 값은 `toEqual`로 비교한다.

const HOST_STATUS: WireResult<"host.status"> = {
  mode: "stdio",
  pid: 4211,
  startedAt: "2026-11-04T01:00:00.000Z",
  connections: 1,
  liveTurns: 0,
  idleShutdownAt: null,
  safeMode: true,
};

const DISMISS_KEY = "l4.desktop.firstRun.searchHintDismissed";

const WEB_SETTINGS = {
  searchProvider: "auto",
  searchOrder: [],
  searchParallel: 1,
  browseProvider: "auto",
  browseOrder: [],
  robots: "never",
};

/** 설정 한 줄(`settings.get`·`settings.set`의 값 모양) */
function setting(key: string, value: unknown) {
  return {
    key,
    value,
    source: { scope: "user" },
    locked: false,
    shadowed: [],
    runtimeChange: "live",
    pendingUntil: null,
    deprecated: false,
  };
}

const paramsOf = (params: readonly { method: string; params: unknown }[], method: string) =>
  params.filter((entry) => entry.method === method).map((entry) => entry.params);

async function liveApp(extra: EngineExtra) {
  const engine = engineFake([summary(thr(1))], undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().link.phase === "live", "live link");
  return { app, ...engine };
}

describe("default group toggles write the user-scope switch", () => {
  test("turning learning off and helm on writes the exact settings.set params, in order", async () => {
    const { app, params } = await liveApp({
      results: {
        "settings.set": { setting: setting("ext.learning.enabled", false) },
      },
    });
    const off = await app.commands.setup.setGroupEnabled("learning", false);
    const on = await app.commands.setup.setGroupEnabled("helm", true);
    expect(off).toEqual({ ok: true, value: null });
    expect(on).toEqual({ ok: true, value: null });
    expect(paramsOf(params, "settings.set")).toEqual([
      { key: "ext.learning.enabled", value: false, scope: "user" },
      { key: "ext.helm.enabled", value: true, scope: "user" },
    ]);
    await app.stop();
  });

  test("a switch the engine refuses comes back as a rejected value, not a throw", async () => {
    const { app } = await liveApp({
      errors: { "settings.set": { code: 3102, kind: "settings.invalidValue" } },
    });
    const refused = await app.commands.setup.setGroupEnabled("helm", false);
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("the refused write must be an error value");
    expect(refused.error.kind).toEqual("rejected");
    await app.stop();
  });
});

describe("the group step reads its switches and the safe mode flag", () => {
  test("a saved value is kept, an unset switch is null, and safe mode comes from host.status", async () => {
    const { app, params } = await liveApp({
      results: {
        "settings.get": { settings: [setting("ext.helm.enabled", false)] },
        "host.status": HOST_STATUS,
      },
    });
    const loaded = await app.commands.setup.loadGroups();
    expect(loaded).toEqual({
      ok: true,
      value: { enabled: { helm: false, learning: null }, safeMode: true },
    });
    expect(paramsOf(params, "settings.get")).toEqual([
      { keys: ["ext.helm.enabled", "ext.learning.enabled"] },
    ]);
    await app.stop();
  });
});

describe("the search step reads the web providers and the local dismiss flag", () => {
  test("web.providers is read and the dismissed flag is false until it is set", async () => {
    const { app, params } = await liveApp({
      results: { "web.providers": { providers: [], settings: WEB_SETTINGS } },
    });
    const loaded = await app.commands.setup.loadSearch();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error("web.providers must load");
    expect(loaded.value.dismissed).toBe(false);
    expect(loaded.value.web.search.provider).toEqual("auto");
    expect(loaded.value.web.recommendations.map((entry) => entry.state)).toEqual([
      "not-installed",
      "not-installed",
    ]);
    expect(paramsOf(params, "web.providers")).toEqual([{}]);
    await app.stop();
  });

  test("dismissing the hint writes the desktop local key, and the next read shows it dismissed", async () => {
    const { app, ...engine } = await liveApp({
      results: { "web.providers": { providers: [], settings: WEB_SETTINGS } },
    });
    const dismissed = await app.commands.setup.dismissSearchHint();
    expect(dismissed).toEqual({ ok: true, value: null });
    expect(engine.fake.settingsFile[DISMISS_KEY]).toEqual(true);
    const loaded = await app.commands.setup.loadSearch();
    expect(loaded.ok && loaded.value.dismissed).toBe(true);
    await app.stop();
  });
});
