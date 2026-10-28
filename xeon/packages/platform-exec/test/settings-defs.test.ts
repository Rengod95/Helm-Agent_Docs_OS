import { describe, expect, test } from "bun:test";
import { buildCatalog, checkSettingDef, validateSettingValue } from "@xeon/contracts/settings";
import { EXEC_SETTING_DEFS } from "../src/index.ts";

function defOf(key: string) {
  const def = EXEC_SETTING_DEFS.find((candidate) => candidate.key === key);
  if (def === undefined) throw new Error(`missing setting ${key}`);
  return def;
}

describe("l0.exec settings", () => {
  test("declares exactly the keys of the spec table", () => {
    expect(EXEC_SETTING_DEFS.map((def) => def.key)).toEqual([
      "l0.exec.shell",
      "l0.exec.defaultTimeoutMs",
      "l0.exec.unattendedTimeoutMs",
      "l0.exec.outputSpillBytes",
      "l0.exec.envAllowlist.extra",
    ]);
  });

  test("every definition passes checkSettingDef, is an L0 setting and builds a catalog", () => {
    for (const def of EXEC_SETTING_DEFS) {
      expect(checkSettingDef(def)).toEqual([]);
      expect(def.layer).toBe("L0");
      expect(def.since).toBe("0.1.0");
    }
    const built = buildCatalog([
      { owner: "platform-exec", namespace: "l0.exec", defs: EXEC_SETTING_DEFS },
    ]);
    expect(built.ok).toBe(true);
  });

  test("defaults match the spec table", () => {
    const defaults = Object.fromEntries(EXEC_SETTING_DEFS.map((def) => [def.key, def.default]));
    expect(defaults).toEqual({
      "l0.exec.shell": undefined, // no default: the shell is found automatically
      "l0.exec.defaultTimeoutMs": 0,
      "l0.exec.unattendedTimeoutMs": 1_800_000,
      "l0.exec.outputSpillBytes": 10485760,
      "l0.exec.envAllowlist.extra": [],
    });
  });

  test("values outside the documented type or range are rejected, valid ones pass", () => {
    expect(validateSettingValue(defOf("l0.exec.envAllowlist.extra"), ["9BAD"]).ok).toBe(false);
    expect(validateSettingValue(defOf("l0.exec.envAllowlist.extra"), ["JAVA_HOME"]).ok).toBe(true);
  });

  test("shell and envAllowlist.extra do not accept the project scope", () => {
    expect(defOf("l0.exec.shell").allowedScopes).not.toContain("project");
    expect(defOf("l0.exec.envAllowlist.extra").allowedScopes).not.toContain("project");
    expect(defOf("l0.exec.defaultTimeoutMs").allowedScopes).toContain("project");
  });
});
