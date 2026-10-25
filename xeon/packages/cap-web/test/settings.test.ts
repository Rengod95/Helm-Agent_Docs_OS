import { describe, expect, test } from "bun:test";
import {
  buildCatalog,
  checkSettingDef,
  type ScopeLayer,
  type ScopeStack,
} from "@xeon/contracts/settings";
import { DEFAULT_WEB_SETTINGS, readWebSettings, WEB_SETTING_DEFS } from "../src/settings.ts";

function layer(scope: ScopeLayer["scope"], values: Record<string, unknown>): ScopeLayer {
  return { scope, values: new Map(Object.entries(values)) };
}

// L2.web.spec §6 표의 키 집합
const SPEC_KEYS = [
  "search.provider",
  "search.pluginOrder",
  "search.searxng.url",
  "search.wrapper.model",
  "search.wrapper.maxContinuations",
  "search.modelTool",
  "fetch.extractor",
  "fetch.maxChars",
  "fetch.timeoutSeconds",
  "fetch.promote",
  "fetch.pluginOrder",
  "policy.allow",
  "policy.ask",
  "policy.deny",
  "policy.allowPrivateNetwork",
  "policy.unseenUrl",
  "policy.robots",
  "cache.searchTtlMinutes",
  "cache.fetchTtlMinutes",
  "cache.maxMegabytes",
  "limits.searchPerSession",
  "limits.fetchPerSession",
  "browse.provider",
  "browse.headless",
  "browse.runtime",
  "browse.executablePath",
  "browse.maxMinutes",
  "browse.maxActions",
  "browse.maxUsd",
  "browse.maxSessions",
  "browse.allowNamedProfiles",
  "browse.allowJavascriptExec",
  "browse.allowFileUpload",
  "research.provider",
  "research.maxBudgetUsd",
  "research.keepUnverified",
].map((name) => `l2.web.${name}`);

describe("web settings", () => {
  test("web settings pass checkSettingDef", () => {
    expect(WEB_SETTING_DEFS.map((def) => def.key).toSorted()).toEqual(SPEC_KEYS.toSorted());
    for (const def of WEB_SETTING_DEFS) {
      expect(checkSettingDef(def)).toEqual([]);
      expect(def.layer).toBe("L2");
      expect(def.secret).toBeUndefined();
      expect(def.ui?.tab).toBe("tools");
    }
    const built = buildCatalog([{ owner: "cap-web", namespace: "l2.web", defs: WEB_SETTING_DEFS }]);
    expect(built.ok).toBe(true);
  });

  test("scope limits follow the spec", () => {
    const byKey = new Map(WEB_SETTING_DEFS.map((def) => [def.key, def]));
    const scopes = (name: string): readonly string[] =>
      byKey.get(`l2.web.${name}`)?.allowedScopes ?? [];
    // 저장소를 여는 것만으로 방어가 풀리지 않게 project 범위를 막는 키(§6)
    for (const name of [
      "policy.allowPrivateNetwork",
      "search.searxng.url",
      "browse.allowJavascriptExec",
      "browse.allowFileUpload",
    ]) {
      expect(scopes(name)).not.toContain("project");
      expect(scopes(name)).not.toContain("session");
      expect(scopes(name)).toContain("local");
    }
    // 저장소 설정이 허용 목록을 넓히거나 "대화에 없던 URL" 확인을 끄지 못한다. 막는 쪽(ask, deny)에는 더할 수 있다
    for (const name of ["policy.allow", "policy.unseenUrl"]) {
      expect(scopes(name)).not.toContain("project");
      expect(scopes(name)).toContain("local");
    }
    expect(scopes("policy.ask")).toContain("project");
    expect(scopes("policy.deny")).toContain("project");
    expect(scopes("browse.allowNamedProfiles")).toEqual(["managed", "user"]);
    expect(scopes("cache.maxMegabytes")).toEqual(["managed", "user"]);
    expect(scopes("browse.runtime")).toEqual(["managed", "user"]);
    expect(byKey.get("l2.web.browse.runtime")?.runtimeChange).toBe("restart");
    expect(byKey.get("l2.web.cache.fetchTtlMinutes")?.runtimeChange).toBe("live");
    expect(byKey.get("l2.web.research.maxBudgetUsd")?.since).toBe("0.2.0");
    expect(byKey.get("l2.web.fetch.maxChars")?.since).toBe("0.1.0");
  });

  test("defaults match the spec table", () => {
    expect(readWebSettings([])).toEqual(DEFAULT_WEB_SETTINGS);
    expect(DEFAULT_WEB_SETTINGS.limits).toEqual({ searchPerSession: 100, fetchPerSession: 300 });
    expect(DEFAULT_WEB_SETTINGS.cache).toEqual({
      searchTtlMinutes: 20,
      fetchTtlMinutes: 15,
      maxMegabytes: 256,
    });
    expect(DEFAULT_WEB_SETTINGS.search.searxng).toEqual({ url: "" });
    expect(DEFAULT_WEB_SETTINGS.policy.unseenUrl).toBe("ask");
  });

  test("scalar keys take the highest scope and skip invalid values", () => {
    const stack: ScopeStack = [
      layer("user", { "l2.web.fetch.maxChars": 20000, "l2.web.limits.searchPerSession": 10 }),
      layer("session", { "l2.web.fetch.maxChars": 30000 }),
      // 범위 밖 값은 건너뛰고 아래 층 값이 이긴다
      layer("local", { "l2.web.limits.searchPerSession": 999999999 }),
      // project가 허용하지 않는 키는 무시한다
      layer("project", {
        "l2.web.policy.allowPrivateNetwork": true,
        "l2.web.search.searxng.url": "http://evil.example",
        "l2.web.policy.allow": ["*"],
        "l2.web.policy.unseenUrl": "allow",
      }),
    ];
    const settings = readWebSettings(stack);
    expect(settings.fetch.maxChars).toBe(30000);
    expect(settings.limits.searchPerSession).toBe(10);
    expect(settings.policy.allowPrivateNetwork).toBe(false);
    expect(settings.search.searxng.url).toBe("");
    expect(settings.policy.allow).toEqual([]);
    expect(settings.policy.unseenUrl).toBe("ask");
  });

  test("domain lists merge every scope", () => {
    const stack: ScopeStack = [
      layer("user", {
        "l2.web.policy.deny": ["*.example.com", "a.test"],
        "l2.web.policy.allow": ["a.example.com"],
      }),
      layer("project", {
        "l2.web.policy.deny": ["a.test", "b.test"],
        "l2.web.policy.ask": ["d.test"],
        // 저장소가 허용 목록을 넓히려는 시도는 무시한다
        "l2.web.policy.allow": ["evil.test"],
      }),
      layer("session", { "l2.web.policy.ask": ["c.test"] }),
      // 형식이 틀린 패턴 하나가 있으면 그 범위 값 전체를 건너뛴다
      layer("local", { "l2.web.policy.deny": ["example.*"] }),
    ];
    const settings = readWebSettings(stack);
    expect(settings.policy.deny.toSorted()).toEqual(["*.example.com", "a.test", "b.test"]);
    expect(settings.policy.allow).toEqual(["a.example.com"]);
    expect(settings.policy.ask.toSorted()).toEqual(["c.test", "d.test"]);
  });

  test("enum keys fall back for unknown values", () => {
    const stack: ScopeStack = [
      layer("user", { "l2.web.search.modelTool": "bogus", "l2.web.policy.robots": "always" }),
    ];
    const settings = readWebSettings(stack);
    expect(settings.search.modelTool).toBe("auto");
    expect(settings.policy.robots).toBe("always");
  });
});
