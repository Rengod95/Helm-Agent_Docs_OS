import { expect, test } from "bun:test";
import {
  allowedInSafeMode,
  NO_STARTUP_OPTIONS,
  startupFilter,
  type LoadCandidate,
} from "../../src/operations/index.ts";

// X-20: 외부 훅(X 훅)도 안전 모드에서는 싣지 않는다(X.operations.spec §4.6.2)
const mixed: readonly LoadCandidate[] = [
  { name: "core-tools", tier: "guard", layer: "L1" },
  { kind: "hook", name: "audit-log", tier: "user" },
  { name: "cap-web", tier: "builtin", layer: "L2" },
  { kind: "hook", name: "block-rm", tier: "project" },
  { kind: "hook", name: "cap-web", tier: "user" },
];

test("safe mode drops every hook candidate whatever its tier, and keeps the allowed extensions", () => {
  const result = startupFilter(mixed, { safeMode: { active: true, source: "flag" }, disabled: [] });
  expect(result.load).toEqual([
    { name: "core-tools", tier: "guard", layer: "L1" },
    { name: "cap-web", tier: "builtin", layer: "L2" },
  ]);
  expect(result.skipped).toEqual([
    { name: "audit-log", reason: "safe_mode" },
    { name: "block-rm", reason: "safe_mode" },
    { name: "cap-web", reason: "safe_mode" },
  ]);
});

test("a hook of any tier is not allowed in safe mode, including guard and core", () => {
  for (const tier of ["guard", "core", "builtin", "user", "project"] as const) {
    expect(allowedInSafeMode({ kind: "hook", name: "h", tier })).toBe(false);
  }
});

test("normal mode loads every hook candidate in the given order", () => {
  const result = startupFilter(mixed, NO_STARTUP_OPTIONS);
  expect(result.load).toEqual([...mixed]);
  expect(result.skipped).toEqual([]);
});

test("--disable-ext names extensions only: a hook with the same id as a disabled extension is not skipped for it", () => {
  const normal = startupFilter(mixed, { ...NO_STARTUP_OPTIONS, disabled: ["cap-web"] });
  expect(normal.skipped).toEqual([{ name: "cap-web", reason: "disabled_flag" }]);
  expect(
    normal.load.map((candidate) => `${candidate.kind ?? "extension"}:${candidate.name}`),
  ).toEqual(["extension:core-tools", "hook:audit-log", "hook:block-rm", "hook:cap-web"]);
  // 안전 모드와 함께면 확장은 --disable-ext가 먼저 사유가 되고 훅은 안전 모드가 사유다
  const both = startupFilter(mixed, { safeMode: { active: true }, disabled: ["cap-web"] });
  expect(both.skipped).toEqual([
    { name: "audit-log", reason: "safe_mode" },
    { name: "cap-web", reason: "disabled_flag" },
    { name: "block-rm", reason: "safe_mode" },
    { name: "cap-web", reason: "safe_mode" },
  ]);
});
