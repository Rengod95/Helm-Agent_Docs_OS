import { expect, test } from "bun:test";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { buildCatalog, checkSettingDef } from "@xeon/contracts/settings";
import { DEFAULT_LOOP_SETTINGS, LOOP_MAX_STEPS_DEFAULT, LOOP_SETTING_DEFS } from "../src/index.ts";

test("l1_loop_declares_only_the_m1_key_with_the_documented_shape", () => {
  expect(LOOP_SETTING_DEFS.map((def) => def.key)).toEqual(["l1.loop.maxSteps"]);
  const [def] = LOOP_SETTING_DEFS;
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

test("the_default_has_no_step_cap", () => {
  expect(LOOP_MAX_STEPS_DEFAULT).toBe(0);
  expect(DEFAULT_LOOP_SETTINGS.maxSteps(fixedIdFactory(0).next("thr"))).toBe(0);
});
