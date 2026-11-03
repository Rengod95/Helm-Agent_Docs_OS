import { expect, test } from "bun:test";
import {
  checkOrder,
  createHookOrderState,
  hookOrderOf,
  hookOrderValue,
  previewOrder,
  TIERS,
  type HookOrderMap,
  type PreviewRef,
  type PreviewRow,
} from "../../src/operations/index.ts";

const GUARD = TIERS.indexOf("guard");
const USER = TIERS.indexOf("user");
const BUILTIN = TIERS.indexOf("builtin");
const CORE = TIERS.indexOf("core");

function rowOf(registrationId: string, tier: number, exempt = false): PreviewRow {
  return { registrationId, extension: registrationId, tier, exempt };
}

function refOf(registrationId: string, tier: number): PreviewRef {
  return { registrationId, extension: registrationId, tier };
}

// 기본 순서: guard → 사용자 → 내장
const TOOL_ROWS: readonly PreviewRow[] = [
  rowOf("core-tools", GUARD, true),
  rowOf("alpha", USER),
  rowOf("beta", BUILTIN),
];

test("hook order: the guard tier is rank 0 of TIERS, the default's first rank", () => {
  expect(GUARD).toBe(0);
  expect(TIERS[GUARD]).toBe("guard");
  expect(USER).toBeGreaterThan(GUARD);
  expect(CORE).toBeGreaterThan(BUILTIN);
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

test("hook order state: reads the source at creation and keeps the applied value until applyPending", () => {
  let stored: HookOrderMap = hookOrderOf({ "tool.call.before": ["alpha", "beta"] });
  let reads = 0;
  const state = createHookOrderState(() => {
    reads += 1;
    return stored;
  });
  expect(reads).toBe(1);
  expect(state.applied("tool.call.before")).toEqual(["alpha", "beta"]);
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

test("hook order state: a change saved before any read stays pending until applyPending", () => {
  let stored: HookOrderMap = hookOrderOf({ "tool.call.before": ["alpha", "beta"] });
  const state = createHookOrderState(() => stored);
  // 아무도 읽기 전에 저장이 바뀌어도 적용 중인 값은 처음 저장된 값이고, 단계 경계 전까지 보류다
  stored = hookOrderOf({ "tool.call.before": ["beta", "alpha"] });
  expect(state.pending()).toBe(true);
  expect(state.applied("tool.call.before")).toEqual(["alpha", "beta"]);
  expect(state.applyPending()).toBe(true);
  expect(state.applied("tool.call.before")).toEqual(["beta", "alpha"]);
  expect(state.pending()).toBe(false);
});

test("hook order state: start adopts the saved value read now, so a state built before the settings load applies it at startup", () => {
  let stored: HookOrderMap = hookOrderOf({});
  const state = createHookOrderState(() => stored);
  stored = hookOrderOf({ "tool.call.before": ["beta", "alpha"] });
  state.start();
  expect(state.pending()).toBe(false);
  expect(state.applied("tool.call.before")).toEqual(["beta", "alpha"]);
});

test("checkOrder: drops duplicates and keeps unknown ids and the guard id in the proposed order", () => {
  expect(checkOrder(["core-tools", "beta", "zeta", "beta", "alpha"])).toEqual([
    "core-tools",
    "beta",
    "zeta",
    "alpha",
  ]);
});

test("checkOrder never rejects: a guard placed after a regular handler is saved as proposed", () => {
  expect(checkOrder(["alpha", "core-tools"])).toEqual(["alpha", "core-tools"]);
  expect(checkOrder(["beta", "core-tools", "alpha"])).toEqual(["beta", "core-tools", "alpha"]);
});

test("previewOrder: first closed hook gives first_answer and first_failure_deny with the earlier rows, and an autoDisable for the non-exempt row", () => {
  const preview = previewOrder("tool.call.before", ["beta", "alpha"], TOOL_ROWS);
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
  // guard는 면제라 자동 끄기 노트가 없다. beta는 뒤에 alpha가 있으므로 노트가 있다
  expect(preview.autoDisable).toEqual([
    { registrationId: "beta", extension: "beta", affects: [refOf("alpha", USER)] },
  ]);
  // guard가 기본 순서대로 맨 앞에 있으므로 guard 위험 노트는 없다
  expect(preview).not.toHaveProperty("guard");
  expect(preview.guardRisk).toEqual([]);
});

test("previewOrder: a guard moved behind a regular handler may be skipped and loses its first position", () => {
  const preview = previewOrder("tool.call.before", ["alpha", "core-tools"], TOOL_ROWS);
  expect(preview.order).toEqual(["alpha", "core-tools", "beta"]);
  expect(preview.guardRisk).toEqual([
    {
      registrationId: "core-tools",
      extension: "core-tools",
      mayBeSkipped: true,
      losesFirstPosition: true,
      by: [refOf("alpha", USER)],
    },
  ]);
  // 같은 guard가 건너뛰어지는 노트도 skips에 있다(guardRisk는 그 사실을 따로 모아 알린다)
  expect(preview.skips).toContainEqual({
    registrationId: "core-tools",
    extension: "core-tools",
    reason: "first_answer",
    by: [refOf("alpha", USER)],
  });
});

test("previewOrder: a guard kept first in the proposal has no guard risk", () => {
  const preview = previewOrder("tool.call.before", ["core-tools", "beta", "alpha"], TOOL_ROWS);
  expect(preview.order).toEqual(["core-tools", "beta", "alpha"]);
  expect(preview.guardRisk).toEqual([]);
});

test("previewOrder: on a tap hook a moved guard loses its first position but is never skipped", () => {
  const preview = previewOrder("boundary.turn.before", ["beta", "core-tools"], TOOL_ROWS);
  expect(preview.order).toEqual(["beta", "alpha", "core-tools"]);
  expect(preview.skips).toEqual([]);
  expect(preview.guardRisk).toEqual([
    {
      registrationId: "core-tools",
      extension: "core-tools",
      mayBeSkipped: false,
      losesFirstPosition: true,
      by: [refOf("beta", BUILTIN), refOf("alpha", USER)],
    },
  ]);
});

test("previewOrder: a chain hook with a stop rule can skip a guard moved behind a handler", () => {
  const preview = previewOrder("input.user.before", ["alpha", "core-tools"], TOOL_ROWS);
  expect(preview.guardRisk).toEqual([
    {
      registrationId: "core-tools",
      extension: "core-tools",
      mayBeSkipped: true,
      losesFirstPosition: true,
      by: [refOf("alpha", USER)],
    },
  ]);
});

test("previewOrder: an open first hook gives first_answer only, with no failure deny and no autoDisable", () => {
  const preview = previewOrder("thread.compact.before", ["beta", "alpha"], TOOL_ROWS);
  expect(preview.skips.map((note) => note.reason)).toEqual(["first_answer", "first_answer"]);
  expect(preview.skips[0]).toEqual({
    registrationId: "beta",
    extension: "beta",
    reason: "first_answer",
    by: [refOf("core-tools", GUARD)],
  });
  expect(preview.valueChanges).toEqual([]);
  expect(preview.autoDisable).toEqual([]);
  // guard가 맨 앞에 남으므로 건너뛰어질 수 없고 맨 앞을 잃지도 않는다
  expect(preview.guardRisk).toEqual([]);
});

test("previewOrder: a chain hook with a stop rule gives valueChanges and chain_stop", () => {
  const preview = previewOrder("input.user.before", ["beta", "alpha"], TOOL_ROWS);
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
  expect(preview.guardRisk).toEqual([]);
});

test("previewOrder: a chain hook without a stop rule gives valueChanges only", () => {
  const preview = previewOrder("request.context.before", ["beta", "alpha"], TOOL_ROWS);
  expect(preview.valueChanges.map((note) => note.registrationId)).toEqual(["beta", "alpha"]);
  expect(preview.skips).toEqual([]);
  expect(preview.autoDisable).toEqual([]);
});

test("previewOrder: a tap hook gives no notes and no guard risk when the guard stays first", () => {
  const preview = previewOrder("boundary.turn.before", ["beta", "alpha"], TOOL_ROWS);
  expect(preview).toEqual({
    hook: "boundary.turn.before",
    order: ["core-tools", "beta", "alpha"],
    skips: [],
    valueChanges: [],
    autoDisable: [],
    guardRisk: [],
  });
});

test("previewOrder: moving a guard among guards reports the first guard as losing its position and the later one as skippable", () => {
  const rows: readonly PreviewRow[] = [
    rowOf("g-one", GUARD, true),
    rowOf("g-two", GUARD, true),
    rowOf("alpha", USER),
  ];
  const preview = previewOrder("tool.call.before", ["g-two", "g-one", "alpha"], rows);
  expect(preview.order).toEqual(["g-two", "g-one", "alpha"]);
  // g-two가 맨 앞으로 올라가 위험이 없다. g-one은 맨 앞을 잃고 g-two 뒤에서 건너뛰어질 수 있다
  expect(preview.guardRisk).toEqual([
    {
      registrationId: "g-one",
      extension: "g-one",
      mayBeSkipped: true,
      losesFirstPosition: true,
      by: [refOf("g-two", GUARD)],
    },
  ]);
});
