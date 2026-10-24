import { describe, expect, test } from "bun:test";
import { buildCatalog, checkSettingDef, validateSettingValue } from "@xeon/contracts/settings";
import { CONTEXT_SETTING_DEFS, contextSettingsOf, DEFAULT_CONTEXT_SETTINGS } from "../src/index.ts";

function defOf(key: string) {
  const def = CONTEXT_SETTING_DEFS.find((candidate) => candidate.key === key);
  if (def === undefined) throw new Error(`missing setting ${key}`);
  return def;
}

describe("l1.context settings", () => {
  test("declares exactly the keys of the spec table", () => {
    expect(CONTEXT_SETTING_DEFS.map((def) => def.key)).toEqual([
      "l1.context.autoCompact",
      "l1.context.reserveTokens",
      "l1.context.keepRecentTokens",
      "l1.context.compactionInstructions",
      "l1.context.pruneToolResults",
      "l1.context.pruneThresholdChars",
      "l1.context.reinjectRecentFiles",
      "l1.context.cacheWarming",
    ]);
  });

  test("every definition passes checkSettingDef, is an L1 setting and builds a catalog", () => {
    for (const def of CONTEXT_SETTING_DEFS) {
      expect(checkSettingDef(def)).toEqual([]);
      expect(def.layer).toBe("L1");
      expect(def.since).toBe("0.1.0");
    }
    const built = buildCatalog([
      { owner: "core-context", namespace: "l1.context", defs: CONTEXT_SETTING_DEFS },
    ]);
    expect(built.ok).toBe(true);
  });

  test("defaults match the spec table", () => {
    const defaults = Object.fromEntries(CONTEXT_SETTING_DEFS.map((def) => [def.key, def.default]));
    expect(defaults).toEqual({
      "l1.context.autoCompact": true,
      "l1.context.reserveTokens": 16384,
      "l1.context.keepRecentTokens": 20000,
      "l1.context.compactionInstructions": "",
      "l1.context.pruneToolResults": false,
      "l1.context.pruneThresholdChars": 200,
      "l1.context.reinjectRecentFiles": 5,
      "l1.context.cacheWarming": "off",
    });
  });

  test("values outside the documented type or range are rejected, valid ones pass", () => {
    expect(validateSettingValue(defOf("l1.context.cacheWarming"), "always").ok).toBe(false);
    expect(validateSettingValue(defOf("l1.context.cacheWarming"), "idle").ok).toBe(true);
  });

  test("compactionInstructions does not accept the session scope", () => {
    expect(defOf("l1.context.compactionInstructions").allowedScopes).not.toContain("session");
    expect(defOf("l1.context.autoCompact").allowedScopes).toContain("session");
  });
});

describe("contextSettingsOf", () => {
  test("an empty reader gives the defaults", () => {
    expect(contextSettingsOf(() => undefined)).toEqual(DEFAULT_CONTEXT_SETTINGS);
  });

  test("the defaults in the declaration come from the same constant", () => {
    for (const def of CONTEXT_SETTING_DEFS) {
      const name = def.key.replace("l1.context.", "");
      expect(def.default).toEqual(Reflect.get(DEFAULT_CONTEXT_SETTINGS, name));
    }
  });

  test("valid values are taken and out-of-range ones fall back per key", () => {
    const values: Record<string, unknown> = {
      "l1.context.autoCompact": false,
      "l1.context.reserveTokens": 4096,
      "l1.context.keepRecentTokens": 10,
      "l1.context.compactionInstructions": "keep the todo list",
      "l1.context.cacheWarming": "idle",
      "l1.context.reinjectRecentFiles": 99,
    };
    expect(contextSettingsOf((key) => values[key])).toMatchObject({
      autoCompact: false,
      reserveTokens: 4096,
      keepRecentTokens: DEFAULT_CONTEXT_SETTINGS.keepRecentTokens,
      compactionInstructions: "keep the todo list",
      cacheWarming: "idle",
      reinjectRecentFiles: DEFAULT_CONTEXT_SETTINGS.reinjectRecentFiles,
    });
  });
});
