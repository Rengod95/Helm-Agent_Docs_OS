import { describe, expect, test } from "bun:test";
import { buildCatalog, checkSettingDef, validateSettingValue } from "@xeon/contracts/settings";
import { PERSISTENCE_SETTING_DEFS } from "../src/index.ts";

function defOf(key: string) {
  const def = PERSISTENCE_SETTING_DEFS.find((candidate) => candidate.key === key);
  if (def === undefined) throw new Error(`missing setting ${key}`);
  return def;
}

describe("l1.persistence settings", () => {
  test("declares exactly the keys of the spec table", () => {
    expect(PERSISTENCE_SETTING_DEFS.map((def) => def.key)).toEqual([
      "l1.persistence.retention.maxAgeDays",
      "l1.persistence.retention.maxCount",
      "l1.persistence.autoResume",
      "l1.persistence.maxResumeAttempts",
      "l1.persistence.export.format",
    ]);
  });

  test("every definition passes checkSettingDef, is an L1 setting and builds a catalog", () => {
    for (const def of PERSISTENCE_SETTING_DEFS) {
      expect(checkSettingDef(def)).toEqual([]);
      expect(def.layer).toBe("L1");
      expect(def.since).toBe("0.1.0");
    }
    const built = buildCatalog([
      { owner: "core-persistence", namespace: "l1.persistence", defs: PERSISTENCE_SETTING_DEFS },
    ]);
    expect(built.ok).toBe(true);
  });

  test("defaults match the spec table", () => {
    const defaults = Object.fromEntries(
      PERSISTENCE_SETTING_DEFS.map((def) => [def.key, def.default]),
    );
    expect(defaults).toEqual({
      "l1.persistence.retention.maxAgeDays": 0,
      "l1.persistence.retention.maxCount": 0,
      "l1.persistence.autoResume": false,
      "l1.persistence.maxResumeAttempts": 3,
      "l1.persistence.export.format": "pi-jsonl",
    });
  });

  test("values outside the documented type or range are rejected, valid ones pass", () => {
    expect(validateSettingValue(defOf("l1.persistence.maxResumeAttempts"), 21).ok).toBe(false);
    expect(validateSettingValue(defOf("l1.persistence.export.format"), "xeon-jsonl").ok).toBe(true);
  });
});
