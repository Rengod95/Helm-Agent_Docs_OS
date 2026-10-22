import { describe, expect, test } from "bun:test";
import { buildCatalog, checkSettingDef, validateSettingValue } from "@xeon/contracts/settings";
import { AGENTS_SETTING_DEFS } from "../src/index.ts";

function defOf(key: string) {
  const def = AGENTS_SETTING_DEFS.find((candidate) => candidate.key === key);
  if (def === undefined) throw new Error(`missing setting ${key}`);
  return def;
}

describe("l1.agents settings", () => {
  test("declares exactly the keys of the spec table", () => {
    expect(AGENTS_SETTING_DEFS.map((def) => def.key)).toEqual([
      "l1.agents.maxDepth",
      "l1.agents.maxConcurrent",
      "l1.agents.resultMaxChars",
      "l1.agents.judge.maxRuns",
    ]);
  });

  test("every definition passes checkSettingDef, is an L1 setting and builds a catalog", () => {
    for (const def of AGENTS_SETTING_DEFS) {
      expect(checkSettingDef(def)).toEqual([]);
      expect(def.layer).toBe("L1");
      expect(def.since).toBe("0.1.0");
    }
    const built = buildCatalog([
      { owner: "core-agents", namespace: "l1.agents", defs: AGENTS_SETTING_DEFS },
    ]);
    expect(built.ok).toBe(true);
  });

  test("defaults match the spec table", () => {
    const defaults = Object.fromEntries(AGENTS_SETTING_DEFS.map((def) => [def.key, def.default]));
    expect(defaults).toEqual({
      "l1.agents.maxDepth": 1,
      "l1.agents.maxConcurrent": 8,
      "l1.agents.resultMaxChars": 24000,
      "l1.agents.judge.maxRuns": 3,
    });
  });

  test("values outside the documented type or range are rejected, valid ones pass", () => {
    expect(validateSettingValue(defOf("l1.agents.maxDepth"), 6).ok).toBe(false);
    expect(validateSettingValue(defOf("l1.agents.maxDepth"), 0).ok).toBe(true);
  });
});
