import { describe, expect, test } from "bun:test";
import type { PluginCard } from "@fresnel/contracts/extensions";
import {
  WIRE_ERRORS,
  type CommonSet,
  type Profile,
  type WireResult,
} from "@fresnel/contracts/wire";
import { summary, thr } from "../state/helpers.ts";
import { engineFake, makeApp, until, type EngineExtra } from "./support.ts";

// 첫 실행 화면의 명령(`commands.setup`의 그룹·검색 메서드)을 가짜 엔진 위에서 돌린다. 기본 그룹 토글은 기본 프로필에 정확한
// `profile.put`·`profile.removePlugin` 요청을 보내는지, 읽기는 기본 프로필과 공통 묶음, 설치 목록, 안전 모드를 어떻게 옮기는지,
// 검색 "나중에"는 데스크톱 로컬 설정 키를 쓰는지 본다. 값은 `toEqual`로 비교한다.

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

const PERMISSION_SETTING = { key: "l1.tools.permissionMode", value: "bypass" };

/** 기본 프로필(저장된 rev 3)에 플러그인 `notes` 하나만 든 값 */
const DEFAULT_PROFILE: Profile = {
  id: "default",
  title: "기본",
  builtin: true,
  plugins: [{ name: "notes" }],
  settings: [PERMISSION_SETTING],
  startDrive: null,
  updatedAt: "2026-11-18T09:00:00Z",
  rev: 3,
};

/** 같은 기본 프로필에 helm을 더한 값 */
const DEFAULT_WITH_HELM: Profile = {
  ...DEFAULT_PROFILE,
  plugins: [{ name: "notes" }, { name: "helm" }],
};

const COMMON: CommonSet = { plugins: [], settings: [], updatedAt: "2026-11-18T09:00:00Z", rev: 0 };

/** `profile.list`의 결과: 기본 프로필 하나와 공통 묶음 */
function listOf(profile: Profile, common: CommonSet = COMMON): WireResult<"profile.list"> {
  return { profiles: [profile], common, rev: 3 };
}

const HASH = `sha256:${"a".repeat(64)}`;

/** 설치된 플러그인 한 장(`plugin.list`의 카드). 클라이언트가 카드 모양을 검사하므로 전체 모양을 둔다 */
function cardOf(name: string): PluginCard {
  return {
    name,
    displayName: name,
    purpose: null,
    does: { inject: null, hook: null, drive: null },
    enforcement: "advisory",
    runs: { code: false, isolated: null },
    cost: { always: null, drive: null, onDemand: null, toolCount: null, basis: "unknown" },
    health: { state: "idle", lastActiveAt: null, lastError: null },
    origin: { kind: "user" },
    review: { state: "approved", currentHash: HASH, pendingItemId: null, approvedAt: null },
    usedBy: [],
  };
}

const WEB_SETTINGS = {
  searchProvider: "auto",
  searchOrder: [],
  searchParallel: 1,
  browseProvider: "auto",
  browseOrder: [],
  robots: "never",
};

const paramsOf = (params: readonly { method: string; params: unknown }[], method: string) =>
  params.filter((entry) => entry.method === method).map((entry) => entry.params);

async function liveApp(extra: EngineExtra) {
  const engine = engineFake([summary(thr(1))], undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().link.phase === "live", "live link");
  return { app, ...engine };
}

describe("default group toggles write the default profile's plugin list", () => {
  test("turning helm on appends it to the default profile, with the saved values and its revision", async () => {
    const { app, params } = await liveApp({
      results: {
        "profile.list": listOf(DEFAULT_PROFILE),
        "profile.put": { profile: DEFAULT_WITH_HELM, issues: [] },
      },
    });
    expect(await app.commands.setup.setGroupEnabled("helm", true)).toEqual({
      ok: true,
      value: null,
    });
    expect(paramsOf(params, "profile.list")).toEqual([{}]);
    expect(paramsOf(params, "profile.put")).toEqual([
      {
        profile: {
          id: "default",
          title: "기본",
          plugins: [{ name: "notes" }, { name: "helm" }],
          settings: [PERMISSION_SETTING],
          startDrive: null,
        },
        baseRev: 3,
      },
    ]);
    expect(paramsOf(params, "settings.set")).toEqual([]);
    await app.stop();
  });

  test("turning helm off removes it from the default profile with the listed revision", async () => {
    const { app, params } = await liveApp({
      results: {
        "profile.list": listOf(DEFAULT_WITH_HELM),
        "profile.removePlugin": {
          profile: DEFAULT_PROFILE,
          preview: { threadsUsing: 0, dropsDrive: null },
        },
      },
    });
    expect(await app.commands.setup.setGroupEnabled("helm", false)).toEqual({
      ok: true,
      value: null,
    });
    expect(paramsOf(params, "profile.removePlugin")).toEqual([
      { id: "default", plugin: "helm", baseRev: 3 },
    ]);
    expect(paramsOf(params, "profile.put")).toEqual([]);
    await app.stop();
  });

  test("turning helm on when the default profile already has it writes nothing", async () => {
    const { app, params } = await liveApp({
      results: { "profile.list": listOf(DEFAULT_WITH_HELM) },
    });
    expect(await app.commands.setup.setGroupEnabled("helm", true)).toEqual({
      ok: true,
      value: null,
    });
    expect(paramsOf(params, "profile.put")).toEqual([]);
    await app.stop();
  });

  test("a write the host refuses comes back as a rejected value, not a throw", async () => {
    const { app } = await liveApp({
      results: { "profile.list": listOf(DEFAULT_PROFILE) },
      errors: {
        "profile.put": { code: WIRE_ERRORS["profile.conflict"].code, kind: "profile.conflict" },
      },
    });
    expect(await app.commands.setup.setGroupEnabled("helm", true)).toEqual({
      ok: false,
      error: { kind: "rejected", code: WIRE_ERRORS["profile.conflict"].code },
    });
    await app.stop();
  });

  test("turning helm off when the common set supplies it comes back as the host's refusal", async () => {
    const { app } = await liveApp({
      results: { "profile.list": listOf(DEFAULT_PROFILE) },
      errors: {
        "profile.removePlugin": {
          code: WIRE_ERRORS["profile.commonPlugin"].code,
          kind: "profile.commonPlugin",
        },
      },
    });
    expect(await app.commands.setup.setGroupEnabled("helm", false)).toEqual({
      ok: false,
      error: { kind: "rejected", code: WIRE_ERRORS["profile.commonPlugin"].code },
    });
    await app.stop();
  });
});

describe("the group step reads whether helm is in the default profile", () => {
  test("helm in the default profile reads on, and safe mode comes from host.status", async () => {
    const { app, params } = await liveApp({
      results: {
        "profile.list": listOf(DEFAULT_WITH_HELM),
        "host.status": HOST_STATUS,
      },
    });
    expect(await app.commands.setup.loadGroups()).toEqual({
      ok: true,
      value: { enabled: { helm: true }, safeMode: true },
    });
    expect(paramsOf(params, "profile.list")).toEqual([{}]);
    // 프로필에 든 것으로 정해지면 설치 목록은 읽지 않는다
    expect(paramsOf(params, "plugin.list")).toEqual([]);
    await app.stop();
  });

  test("helm supplied by the common set reads on", async () => {
    const { app } = await liveApp({
      results: {
        "profile.list": listOf(DEFAULT_PROFILE, { ...COMMON, plugins: [{ name: "helm" }] }),
        "host.status": HOST_STATUS,
      },
    });
    expect(await app.commands.setup.loadGroups()).toEqual({
      ok: true,
      value: { enabled: { helm: true }, safeMode: true },
    });
    await app.stop();
  });

  test("helm missing from the profile but installed reads off, after checking the plugin list", async () => {
    const { app, params } = await liveApp({
      results: {
        "profile.list": listOf(DEFAULT_PROFILE),
        "plugin.list": { plugins: [cardOf("helm"), cardOf("notes")] },
        "host.status": HOST_STATUS,
      },
    });
    expect(await app.commands.setup.loadGroups()).toEqual({
      ok: true,
      value: { enabled: { helm: false }, safeMode: true },
    });
    expect(paramsOf(params, "plugin.list")).toEqual([{}]);
    await app.stop();
  });

  test("helm missing from the profile and not installed reads unset, and the step still loads", async () => {
    const { app } = await liveApp({
      results: {
        "profile.list": listOf(DEFAULT_PROFILE),
        "plugin.list": { plugins: [cardOf("notes")] },
        "host.status": HOST_STATUS,
      },
    });
    expect(await app.commands.setup.loadGroups()).toEqual({
      ok: true,
      value: { enabled: { helm: null }, safeMode: true },
    });
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
