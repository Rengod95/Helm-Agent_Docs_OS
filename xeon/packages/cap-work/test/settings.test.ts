import { describe, expect, test } from "bun:test";
import {
  buildCatalog,
  checkSettingDef,
  checkSettingWrite,
  type ScopeLayer,
} from "@fresnel/contracts/settings";
import { DEFAULT_WORK_SETTINGS, readWorkSettings, WORK_SETTING_DEFS } from "../src/settings.ts";

function layer(scope: ScopeLayer["scope"], values: Record<string, unknown>): ScopeLayer {
  return { scope, values: new Map(Object.entries(values)) };
}

describe("settings", () => {
  test("the three keys left after plan mode was removed pass the definition checks", () => {
    expect(WORK_SETTING_DEFS.map((def) => def.key)).toEqual([
      "l2.work.goal.delegatedTimeoutSec",
      "l2.work.tasks.autoStart",
      "l2.work.tasks.reminderTurns",
    ]);
    for (const def of WORK_SETTING_DEFS) {
      expect(checkSettingDef(def)).toEqual([]);
      expect(def.layer).toBe("L2");
      expect(def.runtimeChange).toBe("nextTurn");
      expect(def.secret).toBeUndefined();
    }
    expect(
      buildCatalog([{ owner: "cap-work", namespace: "l2.work", defs: WORK_SETTING_DEFS }]).ok,
    ).toBe(true);
  });

  test("tabs and scopes follow the spec table", () => {
    const byKey = new Map(WORK_SETTING_DEFS.map((def) => [def.key, def]));
    expect(byKey.get("l2.work.tasks.autoStart")?.ui?.tab).toBe("tools");
    expect(byKey.get("l2.work.goal.delegatedTimeoutSec")?.allowedScopes).not.toContain("launch");
  });

  test("defaults match the spec table", () => {
    expect(readWorkSettings([])).toEqual(DEFAULT_WORK_SETTINGS);
    expect(DEFAULT_WORK_SETTINGS).toEqual({
      tasks: { autoStart: false, reminderTurns: 0 },
      goal: { delegatedTimeoutSec: 300 },
    });
  });

  test("a stored value for the removed goal.onJudgeError is ignored like an unknown key", () => {
    const removed = readWorkSettings([layer("user", { "l2.work.goal.onJudgeError": "continue" })]);
    const unknown = readWorkSettings([layer("user", { "l2.work.goal.noSuchKey": "continue" })]);
    expect(removed).toEqual(unknown);
    expect(removed).toEqual(DEFAULT_WORK_SETTINGS);
  });

  test("stored values for the removed plans keys are ignored and their writes are refused as unknown keys", () => {
    const stored = readWorkSettings([
      layer("user", {
        "l2.work.plans.requireApproval": false,
        "l2.work.plans.exitOnApprove": false,
      }),
    ]);
    expect(stored).toEqual(DEFAULT_WORK_SETTINGS);
    const built = buildCatalog([
      { owner: "cap-work", namespace: "l2.work", defs: WORK_SETTING_DEFS },
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(
      checkSettingWrite(built.catalog, [], "l2.work.plans.requireApproval", "user", false),
    ).toMatchObject({ ok: false, kind: "settings.unknownKey" });
  });

  test("a write of the removed key is refused as an unknown key, like an unregistered one", () => {
    const built = buildCatalog([
      { owner: "cap-work", namespace: "l2.work", defs: WORK_SETTING_DEFS },
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(
      checkSettingWrite(built.catalog, [], "l2.work.goal.onJudgeError", "user", "continue"),
    ).toMatchObject({ ok: false, kind: "settings.unknownKey" });
    expect(
      checkSettingWrite(built.catalog, [], "l2.work.goal.noSuchKey", "user", "continue"),
    ).toMatchObject({ ok: false, kind: "settings.unknownKey" });
  });

  test("values from a scope layer win, and invalid values fall back", () => {
    const set = readWorkSettings([
      layer("user", {
        "l2.work.tasks.autoStart": true,
        "l2.work.tasks.reminderTurns": 3,
        "l2.work.goal.delegatedTimeoutSec": 60,
      }),
    ]);
    expect(set.tasks).toEqual({ autoStart: true, reminderTurns: 3 });
    expect(set.goal.delegatedTimeoutSec).toBe(60);
    const bad = readWorkSettings([
      layer("user", { "l2.work.tasks.reminderTurns": 51, "l2.work.tasks.autoStart": "yes" }),
    ]);
    expect(bad.tasks).toEqual({ autoStart: false, reminderTurns: 0 });
  });

  test("a session layer overrides the user layer for allowed keys only", () => {
    const set = readWorkSettings([
      layer("user", { "l2.work.tasks.reminderTurns": 5 }),
      layer("launch", { "l2.work.tasks.reminderTurns": 1 }),
    ]);
    expect(set.tasks.reminderTurns).toBe(1);
    const refused = readWorkSettings([layer("launch", { "l2.work.goal.delegatedTimeoutSec": 10 })]);
    expect(refused.goal.delegatedTimeoutSec).toBe(300);
  });
});
