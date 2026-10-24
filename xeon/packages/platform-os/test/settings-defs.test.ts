import { describe, expect, test } from "bun:test";
import { buildCatalog, checkSettingDef, validateSettingValue } from "@xeon/contracts/settings";
import { OS_SETTING_DEFS } from "../src/index.ts";

function defOf(key: string) {
  const def = OS_SETTING_DEFS.find((candidate) => candidate.key === key);
  if (def === undefined) throw new Error(`missing setting ${key}`);
  return def;
}

describe("l0.os settings", () => {
  test("declares exactly the keys of the spec table and no notify key", () => {
    expect(OS_SETTING_DEFS.map((def) => def.key)).toEqual([
      "l0.os.telemetry.enabled",
      "l0.os.telemetry.exporter",
      "l0.os.telemetry.endpoint",
      "l0.os.dirs.override",
      "l0.os.log.level",
    ]);
  });

  test("every definition passes checkSettingDef, is an L0 setting and builds a catalog", () => {
    for (const def of OS_SETTING_DEFS) {
      expect(checkSettingDef(def)).toEqual([]);
      expect(def.layer).toBe("L0");
      expect(def.since).toBe("0.1.0");
    }
    expect(
      buildCatalog([{ owner: "platform-os", namespace: "l0.os", defs: OS_SETTING_DEFS }]).ok,
    ).toBe(true);
  });

  test("defaults match the spec table", () => {
    const defaults = Object.fromEntries(OS_SETTING_DEFS.map((def) => [def.key, def.default]));
    expect(defaults).toEqual({
      "l0.os.telemetry.enabled": false,
      "l0.os.telemetry.exporter": "file",
      "l0.os.telemetry.endpoint": "http://localhost:4318/v1/traces",
      "l0.os.dirs.override": undefined,
      "l0.os.log.level": "info",
    });
  });

  test("dirs.override is managed-only and not shown in the UI; log.level accepts session", () => {
    expect(defOf("l0.os.dirs.override").allowedScopes).toEqual(["managed"]);
    expect(defOf("l0.os.dirs.override").ui).toBeUndefined();
    expect(defOf("l0.os.log.level").allowedScopes).toContain("session");
    expect(defOf("l0.os.telemetry.enabled").allowedScopes).not.toContain("project");
  });

  test("values outside the documented enums are rejected", () => {
    expect(validateSettingValue(defOf("l0.os.log.level"), "trace").ok).toBe(false);
    expect(validateSettingValue(defOf("l0.os.log.level"), "warn").ok).toBe(true);
    expect(validateSettingValue(defOf("l0.os.telemetry.exporter"), "otlp-http").ok).toBe(true);
    expect(validateSettingValue(defOf("l0.os.telemetry.exporter"), "stdout").ok).toBe(false);
  });
});
