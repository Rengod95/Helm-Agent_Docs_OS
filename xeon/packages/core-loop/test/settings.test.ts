import { expect, test } from "bun:test";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { buildCatalog, checkSettingDef } from "@xeon/contracts/settings";
import {
  DEFAULT_LOOP_SETTINGS,
  LOOP_GATE_MAX_CONTINUES_DEFAULT,
  LOOP_MAX_STEPS_DEFAULT,
  LOOP_REPEAT_ACTION_ERROR_DEFAULT,
  LOOP_REPEAT_ACTION_OBSERVATION_DEFAULT,
  LOOP_REPEAT_ENABLED_DEFAULT,
  LOOP_SETTING_DEFS,
} from "../src/index.ts";

test("l1_loop_declares_the_step_and_gate_keys_with_the_documented_shape", () => {
  expect(LOOP_SETTING_DEFS.map((def) => def.key)).toEqual([
    "l1.loop.maxSteps",
    "l1.loop.gate.maxContinues",
    "l1.loop.repeat.enabled",
    "l1.loop.repeat.actionObservation",
    "l1.loop.repeat.actionError",
  ]);
  const [def, gate] = LOOP_SETTING_DEFS;
  expect(gate?.key).toBe("l1.loop.gate.maxContinues");
  expect(gate).toMatchObject({
    layer: "L1",
    default: 8,
    range: { min: 0, max: 100 },
    runtimeChange: "nextTurn",
    ui: { tab: "budgets", widget: "number", order: 20, unit: "회" },
  });
  expect(def).toMatchObject({
    key: "l1.loop.maxSteps",
    layer: "L1",
    default: 0,
    range: { min: 0, max: 10_000 },
    runtimeChange: "nextTurn",
    since: "0.1.0",
    ui: { tab: "budgets", widget: "number", unit: "단계" },
  });
  expect(def?.allowedScopes).toEqual(["managed", "user", "project", "local", "session"]);
});

test("the_setting_definitions_pass_the_catalog_rules", () => {
  for (const def of LOOP_SETTING_DEFS) expect(checkSettingDef(def)).toEqual([]);
  const built = buildCatalog([
    { owner: "core-loop", namespace: "l1.loop", defs: LOOP_SETTING_DEFS },
  ]);
  expect(built.ok).toBe(true);
});

test("l1_loop_declares_the_repeat_keys_with_the_documented_shape", () => {
  const [, , enabled, observation, error] = LOOP_SETTING_DEFS;
  expect(enabled).toMatchObject({
    key: "l1.loop.repeat.enabled",
    layer: "L1",
    default: true,
    runtimeChange: "live",
    since: "0.3.0",
    ui: { tab: "budgets", widget: "toggle", order: 30, label: "반복 감지 알림" },
  });
  expect(enabled?.range).toBeUndefined();
  expect(observation).toMatchObject({
    key: "l1.loop.repeat.actionObservation",
    layer: "L1",
    default: 4,
    range: { min: 2, max: 50 },
    runtimeChange: "live",
    since: "0.3.0",
    ui: { tab: "budgets", widget: "number", order: 31, unit: "회" },
  });
  expect(error).toMatchObject({
    key: "l1.loop.repeat.actionError",
    layer: "L1",
    default: 3,
    range: { min: 2, max: 50 },
    runtimeChange: "live",
    since: "0.3.0",
    ui: { tab: "budgets", widget: "number", order: 32, unit: "회" },
  });
  for (const def of [enabled, observation, error]) {
    expect(def?.allowedScopes).toEqual(["managed", "user", "project", "local", "session"]);
  }
});

test("the_repeat_defaults_are_on_four_and_three", () => {
  expect(LOOP_REPEAT_ENABLED_DEFAULT).toBe(true);
  expect(LOOP_REPEAT_ACTION_OBSERVATION_DEFAULT).toBe(4);
  expect(LOOP_REPEAT_ACTION_ERROR_DEFAULT).toBe(3);
  const thread = fixedIdFactory(0).next("thr");
  expect(DEFAULT_LOOP_SETTINGS.repeat(thread)).toEqual({
    enabled: true,
    actionObservation: 4,
    actionError: 3,
  });
});

test("the_default_has_no_step_cap", () => {
  expect(LOOP_MAX_STEPS_DEFAULT).toBe(0);
  const thread = fixedIdFactory(0).next("thr");
  expect(DEFAULT_LOOP_SETTINGS.maxSteps(thread)).toBe(0);
  expect(LOOP_GATE_MAX_CONTINUES_DEFAULT).toBe(8);
  expect(DEFAULT_LOOP_SETTINGS.gateMaxContinues(thread)).toBe(8);
});
