import { describe, expect, test } from "bun:test";
import { buildCatalog, checkSettingDef, validateSettingValue } from "@xeon/contracts/settings";
import { TOOLS_SETTING_DEFS } from "../src/index.ts";

function defOf(key: string) {
  const def = TOOLS_SETTING_DEFS.find((candidate) => candidate.key === key);
  if (def === undefined) throw new Error(`missing setting ${key}`);
  return def;
}

describe("l1.tools settings", () => {
  test("declares exactly the keys of the spec table", () => {
    expect(TOOLS_SETTING_DEFS.map((def) => def.key)).toEqual([
      "l1.tools.permissionMode",
      "l1.tools.bypassAllowed",
      "l1.tools.rules",
      "l1.tools.output.maxLines",
      "l1.tools.output.maxBytes",
      "l1.tools.exposure.deferThreshold",
    ]);
  });

  test("every definition passes checkSettingDef, is an L1 setting and builds a catalog", () => {
    for (const def of TOOLS_SETTING_DEFS) {
      expect(checkSettingDef(def)).toEqual([]);
      expect(def.layer).toBe("L1");
      expect(def.since).toBe("0.1.0");
    }
    const built = buildCatalog([
      { owner: "core-tools", namespace: "l1.tools", defs: TOOLS_SETTING_DEFS },
    ]);
    expect(built.ok).toBe(true);
  });

  test("defaults match the spec table", () => {
    const defaults = Object.fromEntries(TOOLS_SETTING_DEFS.map((def) => [def.key, def.default]));
    expect(defaults).toEqual({
      "l1.tools.permissionMode": "default",
      "l1.tools.bypassAllowed": true,
      "l1.tools.rules": [],
      "l1.tools.output.maxLines": 2000,
      "l1.tools.output.maxBytes": 51200,
      "l1.tools.exposure.deferThreshold": 64,
    });
  });

  test("values outside the documented type or range are rejected, valid ones pass", () => {
    expect(validateSettingValue(defOf("l1.tools.output.maxLines"), 50).ok).toBe(false);
    expect(validateSettingValue(defOf("l1.tools.permissionMode"), "plan").ok).toBe(true);
  });

  test("bypassAllowed is managed-only and output limits accept only file scopes", () => {
    expect(defOf("l1.tools.bypassAllowed").allowedScopes).toEqual(["managed"]);
    expect(defOf("l1.tools.output.maxBytes").allowedScopes).not.toContain("session");
    expect(defOf("l1.tools.permissionMode").allowedScopes).toContain("session");
  });
});
