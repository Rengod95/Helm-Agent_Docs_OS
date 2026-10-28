import { describe, expect, test } from "bun:test";
import { buildCatalog, checkSettingDef } from "@xeon/contracts/settings";
import {
  DEFAULT_SANDBOX_SETTINGS,
  SANDBOX_SETTING_DEFS,
  readSandboxSettings,
} from "../src/settings.ts";

describe("sandbox settings", () => {
  test("declares the l0.sandbox keys under l0.sandbox with valid definitions", () => {
    expect(SANDBOX_SETTING_DEFS.map((def) => def.key)).toEqual([
      "l0.sandbox.enabled",
      "l0.sandbox.onUnavailable",
      "l0.sandbox.protectedPaths.extra",
      "l0.sandbox.writeRoots.extra",
      "l0.sandbox.escapeRetry",
      "l0.sandbox.network.blockedDomains",
      "l0.sandbox.credentialFiles",
      "l0.sandbox.nestedNamespaces",
      "l0.sandbox.selfTestIntervalMin",
    ]);
    for (const def of SANDBOX_SETTING_DEFS) {
      expect(checkSettingDef(def)).toEqual([]);
      expect(def.layer).toBe("L0");
    }
    const catalog = buildCatalog([
      { owner: "platform-sandbox", namespace: "l0.sandbox", defs: SANDBOX_SETTING_DEFS },
    ]);
    expect(catalog.ok).toBe(true);
  });

  test("keys that widen what runs never accept the project scope", () => {
    const byKey = new Map(SANDBOX_SETTING_DEFS.map((def) => [def.key, def]));
    for (const key of [
      "l0.sandbox.enabled",
      "l0.sandbox.onUnavailable",
      "l0.sandbox.writeRoots.extra",
      "l0.sandbox.escapeRetry",
      "l0.sandbox.credentialFiles",
      "l0.sandbox.nestedNamespaces",
    ]) {
      expect(byKey.get(key)?.allowedScopes).not.toContain("project");
    }
    expect(byKey.get("l0.sandbox.protectedPaths.extra")?.allowedScopes).toContain("project");
    expect(byKey.get("l0.sandbox.network.blockedDomains")?.allowedScopes).toContain("project");
  });

  test("runtime change timing follows the spec", () => {
    const byKey = new Map(SANDBOX_SETTING_DEFS.map((def) => [def.key, def]));
    expect(byKey.get("l0.sandbox.enabled")?.runtimeChange).toBe("nextTurn");
    expect(byKey.get("l0.sandbox.selfTestIntervalMin")?.runtimeChange).toBe("restart");
    expect(byKey.get("l0.sandbox.selfTestIntervalMin")?.ui).toBeUndefined();
  });

  test("defaults are what the spec lists", () => {
    expect(DEFAULT_SANDBOX_SETTINGS).toEqual({
      enabled: true,
      onUnavailable: "disable_execute",
      protectedPathsExtra: [],
      writeRootsExtra: [],
      escapeRetry: false,
      blockedDomains: [],
      credentialFiles: "allow",
      nestedNamespaces: false,
      selfTestIntervalMin: 60,
    });
    expect(readSandboxSettings(() => undefined)).toEqual(DEFAULT_SANDBOX_SETTINGS);
  });

  test("reads valid values and falls back to defaults for invalid ones", () => {
    const values: Record<string, unknown> = {
      "l0.sandbox.enabled": false,
      "l0.sandbox.onUnavailable": "ask",
      "l0.sandbox.protectedPaths.extra": ["/a", "~/b"],
      "l0.sandbox.writeRoots.extra": ["/w"],
      "l0.sandbox.escapeRetry": true,
      "l0.sandbox.network.blockedDomains": ["bad.example"],
      "l0.sandbox.credentialFiles": "deny",
      "l0.sandbox.nestedNamespaces": true,
      "l0.sandbox.selfTestIntervalMin": 0,
    };
    expect(readSandboxSettings((key) => values[key])).toEqual({
      enabled: false,
      onUnavailable: "ask",
      protectedPathsExtra: ["/a", "~/b"],
      writeRootsExtra: ["/w"],
      escapeRetry: true,
      blockedDomains: ["bad.example"],
      credentialFiles: "deny",
      nestedNamespaces: true,
      selfTestIntervalMin: 0,
    });
    const broken: Record<string, unknown> = {
      "l0.sandbox.enabled": "yes",
      "l0.sandbox.onUnavailable": "turn_it_off",
      "l0.sandbox.protectedPaths.extra": [1, 2],
      "l0.sandbox.writeRoots.extra": "/w",
      "l0.sandbox.escapeRetry": 1,
      "l0.sandbox.network.blockedDomains": "bad.example",
      "l0.sandbox.credentialFiles": "maybe",
      "l0.sandbox.nestedNamespaces": "yes",
      "l0.sandbox.selfTestIntervalMin": 99999,
    };
    expect(readSandboxSettings((key) => broken[key])).toEqual(DEFAULT_SANDBOX_SETTINGS);
  });
});
