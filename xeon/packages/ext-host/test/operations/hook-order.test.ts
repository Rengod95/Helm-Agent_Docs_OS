import { expect, test } from "bun:test";
import {
  checkOrder,
  createHookOrderState,
  hookOrderOf,
  hookOrderValue,
  isPinnedTier,
  PINNED_TIER_RANK,
  previewOrder,
  TIERS,
  type HookOrderMap,
  type PreviewRef,
  type PreviewRow,
} from "../../src/operations/index.ts";

const GUARD = PINNED_TIER_RANK;
const USER = TIERS.indexOf("user");
const BUILTIN = TIERS.indexOf("builtin");
const CORE = TIERS.indexOf("core");

function rowOf(registrationId: string, tier: number, exempt = false): PreviewRow {
  return { registrationId, extension: registrationId, tier, exempt };
}

function refOf(registrationId: string, tier: number): PreviewRef {
  return { registrationId, extension: registrationId, tier };
}

// 디스패치 순서: 고정(guard) → 사용자 → 내장
const TOOL_ROWS: readonly PreviewRow[] = [
  rowOf("core-tools", GUARD, true),
  rowOf("alpha", USER),
  rowOf("beta", BUILTIN),
];

test("hook order: the guard tier is rank 0 and only it is pinned", () => {
  expect(TIERS[PINNED_TIER_RANK]).toBe("guard");
  expect(isPinnedTier(PINNED_TIER_RANK)).toBe(true);
  expect(isPinnedTier(USER)).toBe(false);
  expect(isPinnedTier(CORE)).toBe(false);
});

test("hook order: hookOrderOf keeps valid lists and drops junk keys, values, items and duplicates", () => {
  const map = hookOrderOf({
    "tool.call.before": ["alpha", "beta", "alpha", 3, null, "beta"],
    "not.a.hook": ["gamma"],
    "tool.result": "alpha",
    "boundary.turn.before": [],
    "input.user.before": ["delta"],
  });
  expect(hookOrderValue(map)).toEqual({
    "tool.call.before": ["alpha", "beta"],
    "input.user.before": ["delta"],
  });
});

test("hook order: hookOrderOf of a non-object is empty", () => {
  for (const junk of [null, undefined, "text", 7, ["tool.call.before"]]) {
    expect(hookOrderValue(hookOrderOf(junk))).toEqual({});
  }
});

test("hook order: hookOrderValue round-trips a valid value", () => {
  const value = { "tool.call.before": ["beta", "alpha"], "tool.result": ["alpha"] };
  expect(hookOrderValue(hookOrderOf(value))).toEqual(value);
});

test("hook order state: reads the source on the first call and keeps the applied value until applyPending", () => {
  let stored: HookOrderMap = hookOrderOf({ "tool.call.before": ["alpha", "beta"] });
  let reads = 0;
  const state = createHookOrderState(() => {
    reads += 1;
    return stored;
  });
  expect(reads).toBe(0);
  expect(state.applied("tool.call.before")).toEqual(["alpha", "beta"]);
  expect(reads).toBe(1);
  expect(state.applied("tool.call.before")).toEqual(["alpha", "beta"]);
  expect(reads).toBe(1);

  stored = hookOrderOf({ "tool.call.before": ["beta", "alpha"] });
  expect(hookOrderValue(state.saved())).toEqual({ "tool.call.before": ["beta", "alpha"] });
  expect(state.pending()).toBe(true);
  expect(state.applied("tool.call.before")).toEqual(["alpha", "beta"]);

  expect(state.applyPending()).toBe(true);
  expect(state.applied("tool.call.before")).toEqual(["beta", "alpha"]);
  expect(state.pending()).toBe(false);
  expect(state.applyPending()).toBe(false);
});

test("hook order state: an equal saved value is not pending and applyPending reports no change", () => {
  let stored: HookOrderMap = hookOrderOf({ "tool.call.before": ["alpha"] });
  const state = createHookOrderState(() => stored);
  expect(state.applyPending()).toBe(false);
  stored = hookOrderOf({ "tool.call.before": ["alpha"] });
  expect(state.pending()).toBe(false);
  expect(state.applyPending()).toBe(false);
  stored = new Map();
  expect(state.pending()).toBe(true);
  expect(state.applyPending()).toBe(true);
  expect(state.applied("tool.call.before")).toBeUndefined();
  expect(state.appliedMap().size).toBe(0);
});

test("checkOrder: drops guard ids and duplicates and keeps unknown ids", () => {
  expect(
    checkOrder("tool.call.before", ["core-tools", "beta", "zeta", "beta", "alpha"], TOOL_ROWS),
  ).toEqual({ ok: true, value: ["beta", "zeta", "alpha"] });
});

test("checkOrder: omitting the guard id is fine", () => {
  expect(checkOrder("tool.call.before", ["beta", "alpha"], TOOL_ROWS)).toEqual({
    ok: true,
    value: ["beta", "alpha"],
  });
});

test("checkOrder: a guard placed after a regular handler is above_guard", () => {
  expect(checkOrder("tool.call.before", ["alpha", "core-tools"], TOOL_ROWS)).toEqual({
    ok: false,
    error: {
      kind: "above_guard",
      hook: "tool.call.before",
      registrationId: "core-tools",
      above: "alpha",
    },
  });
});

test("checkOrder: guards in a different relative order are guard_moved", () => {
  const rows: readonly PreviewRow[] = [
    rowOf("g-one", GUARD, true),
    rowOf("g-two", GUARD, true),
    rowOf("alpha", USER),
  ];
  expect(checkOrder("tool.call.before", ["g-two", "g-one", "alpha"], rows)).toEqual({
    ok: false,
    error: { kind: "guard_moved", hook: "tool.call.before", registrationId: "g-one" },
  });
  expect(checkOrder("tool.call.before", ["g-one", "g-two", "alpha"], rows)).toEqual({
    ok: true,
    value: ["alpha"],
  });
});

test("previewOrder: first closed hook gives first_answer and first_failure_deny with the earlier rows, and an autoDisable for the non-exempt row", () => {
  const preview = previewOrder("tool.call.before", ["beta", "alpha"], TOOL_ROWS);
  expect(preview.guard).toBeNull();
  expect(preview.order).toEqual(["core-tools", "beta", "alpha"]);
  expect(preview.skips).toEqual([
    {
      registrationId: "beta",
      extension: "beta",
      reason: "first_answer",
      by: [refOf("core-tools", GUARD)],
    },
    {
      registrationId: "beta",
      extension: "beta",
      reason: "first_failure_deny",
      by: [refOf("core-tools", GUARD)],
    },
    {
      registrationId: "alpha",
      extension: "alpha",
      reason: "first_answer",
      by: [refOf("core-tools", GUARD), refOf("beta", BUILTIN)],
    },
    {
      registrationId: "alpha",
      extension: "alpha",
      reason: "first_failure_deny",
      by: [refOf("core-tools", GUARD), refOf("beta", BUILTIN)],
    },
  ]);
  expect(preview.valueChanges).toEqual([]);
  // guard는 면제라 노트가 없다. beta는 뒤에 alpha가 있으므로 자동 끄기 노트가 있다
  expect(preview.autoDisable).toEqual([
    { registrationId: "beta", extension: "beta", affects: [refOf("alpha", USER)] },
  ]);
});

test("previewOrder: an open first hook gives first_answer only, with no failure deny and no autoDisable", () => {
  const preview = previewOrder("thread.compact.before", ["beta", "alpha"], TOOL_ROWS);
  expect(preview.guard).toBeNull();
  expect(preview.skips.map((note) => note.reason)).toEqual(["first_answer", "first_answer"]);
  expect(preview.skips[0]).toEqual({
    registrationId: "beta",
    extension: "beta",
    reason: "first_answer",
    by: [refOf("core-tools", GUARD)],
  });
  expect(preview.valueChanges).toEqual([]);
  expect(preview.autoDisable).toEqual([]);
});

test("previewOrder: a chain hook with a stop rule gives valueChanges and chain_stop", () => {
  const preview = previewOrder("input.user.before", ["beta", "alpha"], TOOL_ROWS);
  expect(preview.guard).toBeNull();
  expect(preview.valueChanges).toEqual([
    { registrationId: "beta", extension: "beta", by: [refOf("core-tools", GUARD)] },
    {
      registrationId: "alpha",
      extension: "alpha",
      by: [refOf("core-tools", GUARD), refOf("beta", BUILTIN)],
    },
  ]);
  expect(preview.skips).toEqual([
    {
      registrationId: "beta",
      extension: "beta",
      reason: "chain_stop",
      by: [refOf("core-tools", GUARD)],
    },
    {
      registrationId: "alpha",
      extension: "alpha",
      reason: "chain_stop",
      by: [refOf("core-tools", GUARD), refOf("beta", BUILTIN)],
    },
  ]);
  expect(preview.autoDisable).toEqual([]);
});

test("previewOrder: a chain hook without a stop rule gives valueChanges only", () => {
  const preview = previewOrder("request.context.before", ["beta", "alpha"], TOOL_ROWS);
  expect(preview.valueChanges.map((note) => note.registrationId)).toEqual(["beta", "alpha"]);
  expect(preview.skips).toEqual([]);
  expect(preview.autoDisable).toEqual([]);
});

test("previewOrder: a tap hook gives no notes", () => {
  const preview = previewOrder("boundary.turn.before", ["beta", "alpha"], TOOL_ROWS);
  expect(preview).toEqual({
    hook: "boundary.turn.before",
    order: ["core-tools", "beta", "alpha"],
    skips: [],
    valueChanges: [],
    autoDisable: [],
    guard: null,
  });
});

test("previewOrder: a proposal that puts a regular handler above a guard reports the guard error and still orders the guard first", () => {
  const preview = previewOrder("tool.call.before", ["beta", "core-tools", "alpha"], TOOL_ROWS);
  expect(preview.guard).toEqual({
    kind: "above_guard",
    hook: "tool.call.before",
    registrationId: "core-tools",
    above: "beta",
  });
  expect(preview.order).toEqual(["core-tools", "beta", "alpha"]);
});

test("previewOrder: moving a guard reports guard_moved and keeps the guards in their current order", () => {
  const rows: readonly PreviewRow[] = [
    rowOf("g-one", GUARD, true),
    rowOf("g-two", GUARD, true),
    rowOf("alpha", USER),
  ];
  const preview = previewOrder("tool.call.before", ["g-two", "g-one", "alpha"], rows);
  expect(preview.guard).toEqual({
    kind: "guard_moved",
    hook: "tool.call.before",
    registrationId: "g-one",
  });
  expect(preview.order).toEqual(["g-one", "g-two", "alpha"]);
});
