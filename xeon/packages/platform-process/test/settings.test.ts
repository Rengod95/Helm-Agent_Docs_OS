import { describe, expect, test } from "bun:test";
import { buildCatalog, checkSettingDef, validateSettingValue } from "@xeon/contracts/settings";
import {
  PROCESS_SERVICE_SETTINGS_DEFAULTS,
  PROCESS_SETTING_DEFS,
  PROCESS_SHUTDOWN_TIMEOUT_DEFAULT_MS,
} from "../src/index.ts";

describe("l0.process settings", () => {
  test("declares exactly the five keys of the spec table", () => {
    expect(PROCESS_SETTING_DEFS.map((def) => def.key)).toEqual([
      "l0.process.service.enabled",
      "l0.process.service.idleGraceMs",
      "l0.process.service.startTimeoutMs",
      "l0.process.shutdown.timeoutMs",
      "l0.process.lockFallback.default",
    ]);
  });

  test("every definition passes checkSettingDef and is an L0 setting", () => {
    for (const def of PROCESS_SETTING_DEFS) {
      expect(checkSettingDef(def)).toEqual([]);
      expect(def.layer).toBe("L0");
      expect(def.since).toBe("0.1.0");
    }
  });

  test("has no auto-resume key (it belongs to l1.persistence)", () => {
    expect(PROCESS_SETTING_DEFS.some((def) => def.key.includes("autoResume"))).toBe(false);
  });

  test("builds a catalog without issues", () => {
    const built = buildCatalog([
      { owner: "platform-process", namespace: "l0.process", defs: PROCESS_SETTING_DEFS },
    ]);
    expect(built.ok).toBe(true);
  });

  test("defaults match the spec table", () => {
    const defaults = Object.fromEntries(PROCESS_SETTING_DEFS.map((def) => [def.key, def.default]));
    expect(defaults).toEqual({
      "l0.process.service.enabled": false,
      "l0.process.service.idleGraceMs": 60_000,
      "l0.process.service.startTimeoutMs": 10_000,
      "l0.process.shutdown.timeoutMs": 3000,
      "l0.process.lockFallback.default": "ask",
    });
  });

  test("the service settings default comes from the declared shutdown timeout", () => {
    const declared = PROCESS_SETTING_DEFS.find(
      (def) => def.key === "l0.process.shutdown.timeoutMs",
    );
    expect(declared?.default).toBe(PROCESS_SHUTDOWN_TIMEOUT_DEFAULT_MS);
    expect(declared?.default).toBe(PROCESS_SERVICE_SETTINGS_DEFAULTS.shutdownTimeoutMs);
  });

  test("ranges reject out-of-range values and unknown lock fallback choices", () => {
    const timeout = PROCESS_SETTING_DEFS.find((def) => def.key === "l0.process.shutdown.timeoutMs");
    const fallback = PROCESS_SETTING_DEFS.find(
      (def) => def.key === "l0.process.lockFallback.default",
    );
    expect(timeout).toBeDefined();
    expect(fallback).toBeDefined();
    if (timeout === undefined || fallback === undefined) return;
    expect(validateSettingValue(timeout, 499).ok).toBe(false);
    expect(validateSettingValue(timeout, 500).ok).toBe(true);
    expect(validateSettingValue(timeout, 60_001).ok).toBe(false);
    expect(validateSettingValue(fallback, "fork").ok).toBe(true);
    expect(validateSettingValue(fallback, "delegate").ok).toBe(false);
  });
});
