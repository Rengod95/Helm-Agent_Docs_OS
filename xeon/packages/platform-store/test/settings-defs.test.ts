import { describe, expect, test } from "bun:test";
import { buildCatalog, checkSettingDef, validateSettingValue } from "@xeon/contracts/settings";
import { STORE_SETTING_DEFS } from "../src/index.ts";

function defOf(key: string) {
  const def = STORE_SETTING_DEFS.find((candidate) => candidate.key === key);
  if (def === undefined) throw new Error(`missing setting ${key}`);
  return def;
}

describe("l0.store settings", () => {
  test("declares exactly the keys of the spec table", () => {
    expect(STORE_SETTING_DEFS.map((def) => def.key)).toEqual([
      "l0.store.heartbeatMs",
      "l0.store.leaseTtlMs",
      "l0.store.busyTimeoutMs",
      "l0.store.blobGraceMs",
      "l0.store.requireFts5",
      "l0.store.macFullFsync",
      "l0.store.customSqlitePath",
    ]);
  });

  test("every definition passes checkSettingDef, is an L0 setting and builds a catalog", () => {
    for (const def of STORE_SETTING_DEFS) {
      expect(checkSettingDef(def)).toEqual([]);
      expect(def.layer).toBe("L0");
      expect(def.since).toBe("0.1.0");
    }
    const built = buildCatalog([
      { owner: "platform-store", namespace: "l0.store", defs: STORE_SETTING_DEFS },
    ]);
    expect(built.ok).toBe(true);
  });

  test("defaults match the spec table", () => {
    const defaults = Object.fromEntries(STORE_SETTING_DEFS.map((def) => [def.key, def.default]));
    expect(defaults).toEqual({
      "l0.store.heartbeatMs": 5000,
      "l0.store.leaseTtlMs": 30000,
      "l0.store.busyTimeoutMs": 5000,
      "l0.store.blobGraceMs": 86400000,
      "l0.store.requireFts5": false,
      "l0.store.macFullFsync": true,
      "l0.store.customSqlitePath": null,
    });
  });

  test("values outside the documented type or range are rejected, valid ones pass", () => {
    expect(validateSettingValue(defOf("l0.store.heartbeatMs"), 500).ok).toBe(false);
    expect(validateSettingValue(defOf("l0.store.customSqlitePath"), "/var/db/sqlite.so").ok).toBe(
      true,
    );
  });

  test("project, local and session scopes are not allowed", () => {
    for (const def of STORE_SETTING_DEFS) {
      for (const scope of ["project", "local", "session"] as const) {
        expect(def.allowedScopes).not.toContain(scope);
      }
    }
  });
});
