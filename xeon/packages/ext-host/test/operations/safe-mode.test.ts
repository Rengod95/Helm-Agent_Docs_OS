import { expect, test } from "bun:test";
import {
  allowedInSafeMode,
  NO_STARTUP_OPTIONS,
  shouldSuggestSafeMode,
  startupFilter,
  type LoadCandidate,
} from "../../src/operations/index.ts";

const candidates: readonly LoadCandidate[] = [
  { name: "core-tools", tier: "guard", layer: "L1" },
  { name: "core-loop", tier: "core", layer: "L1" },
  { name: "cap-web", tier: "builtin", layer: "L2" },
  { name: "group-learning", tier: "builtin", layer: "L3" },
  { name: "helm", tier: "user", layer: "plugin" },
  { name: "proj-ext", tier: "project", layer: "plugin" },
];

test("safe mode keeps guard, core and L1/L2 built-ins and drops L3 groups and user/project tiers", () => {
  const result = startupFilter(candidates, {
    safeMode: { active: true, source: "flag" },
    disabled: [],
  });
  expect(result.load.map((candidate) => candidate.name)).toEqual([
    "core-tools",
    "core-loop",
    "cap-web",
  ]);
  expect(result.skipped).toEqual([
    { name: "group-learning", reason: "safe_mode" },
    { name: "helm", reason: "safe_mode" },
    { name: "proj-ext", reason: "safe_mode" },
  ]);
});

test("--disable-ext drops only the named extension and wins over safe mode as the reason", () => {
  const result = startupFilter(candidates, {
    safeMode: { active: true },
    disabled: ["cap-web", "helm"],
  });
  expect(result.skipped).toContainEqual({ name: "cap-web", reason: "disabled_flag" });
  expect(result.skipped).toContainEqual({ name: "helm", reason: "disabled_flag" });
  const flagOnly = startupFilter(candidates, { ...NO_STARTUP_OPTIONS, disabled: ["helm"] });
  expect(flagOnly.skipped).toEqual([{ name: "helm", reason: "disabled_flag" }]);
  expect(flagOnly.load).toHaveLength(5);
});

test("without options nothing is skipped", () => {
  expect(startupFilter(candidates, NO_STARTUP_OPTIONS).load).toEqual([...candidates]);
});

test("allowedInSafeMode follows the spec table", () => {
  expect(allowedInSafeMode({ name: "x", tier: "builtin", layer: "plugin" })).toBe(false);
  expect(allowedInSafeMode({ name: "x", tier: "builtin", layer: "L3" })).toBe(false);
  expect(allowedInSafeMode({ name: "x", tier: "guard", layer: "plugin" })).toBe(true);
});

test("a safe mode suggestion needs the threshold of consecutive failures", () => {
  expect(shouldSuggestSafeMode(2, 3)).toBe(false);
  expect(shouldSuggestSafeMode(3, 3)).toBe(true);
});
