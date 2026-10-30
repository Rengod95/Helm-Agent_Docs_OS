import { describe, expect, test } from "bun:test";
import { buildCatalog, checkSettingDef, type ScopeLayer } from "@xeon/contracts/settings";
import {
  ARTIFACTS_SETTING_DEFS,
  DEFAULT_ARTIFACTS_SETTINGS,
  readArtifactsSettings,
} from "../src/settings.ts";

function layer(scope: ScopeLayer["scope"], values: Record<string, unknown>): ScopeLayer {
  return { scope, values: new Map(Object.entries(values)) };
}

describe("settings", () => {
  test("the five keys pass the definition checks and build a catalog", () => {
    expect(ARTIFACTS_SETTING_DEFS.map((def) => def.key)).toEqual([
      "l2.artifacts.maxPerSession",
      "l2.artifacts.maxContentBytes",
      "l2.artifacts.reviews.deliverAs",
      "l2.artifacts.tools.reviewRequest",
      "l2.artifacts.tools.sessionRename",
    ]);
    for (const def of ARTIFACTS_SETTING_DEFS) {
      expect(checkSettingDef(def)).toEqual([]);
      expect(def.layer).toBe("L2");
      expect(def.secret).toBeUndefined();
    }
    expect(
      buildCatalog([
        { owner: "cap-artifacts", namespace: "l2.artifacts", defs: ARTIFACTS_SETTING_DEFS },
      ]).ok,
    ).toBe(true);
  });

  test("ranges, run modes, scopes and tabs follow the spec table", () => {
    const byKey = new Map(ARTIFACTS_SETTING_DEFS.map((def) => [def.key, def]));
    const limits = ["l2.artifacts.maxPerSession", "l2.artifacts.maxContentBytes"];
    for (const key of limits) {
      expect(byKey.get(key)?.runtimeChange).toBe("live");
      expect(byKey.get(key)?.allowedScopes).toEqual(["managed", "user", "project", "local"]);
      expect(byKey.get(key)?.ui?.tab).toBe("sessions");
    }
    expect(byKey.get("l2.artifacts.maxPerSession")?.range).toEqual({ min: 1, max: 10000 });
    expect(byKey.get("l2.artifacts.maxContentBytes")?.range).toEqual({ min: 1024, max: 268435456 });

    const deliver = byKey.get("l2.artifacts.reviews.deliverAs");
    expect(deliver?.runtimeChange).toBe("live");
    expect(deliver?.allowedScopes).toEqual(["managed", "user", "project", "local", "session"]);
    expect(deliver?.range).toEqual({ enum: ["steer", "followUp", "next"] });
    expect(deliver?.ui?.tab).toBe("tools");

    for (const key of ["l2.artifacts.tools.reviewRequest", "l2.artifacts.tools.sessionRename"]) {
      expect(byKey.get(key)?.runtimeChange).toBe("nextTurn");
      expect(byKey.get(key)?.allowedScopes).toContain("session");
      expect(byKey.get(key)?.ui?.tab).toBe("tools");
    }
  });

  test("defaults match the spec table", () => {
    expect(readArtifactsSettings([])).toEqual(DEFAULT_ARTIFACTS_SETTINGS);
    expect(DEFAULT_ARTIFACTS_SETTINGS).toEqual({
      maxPerSession: 500,
      maxContentBytes: 26214400,
      reviews: { deliverAs: "followUp" },
      tools: { reviewRequest: true, sessionRename: false },
    });
  });

  test("values from a file scope override the defaults", () => {
    const set = readArtifactsSettings([
      layer("user", {
        "l2.artifacts.maxPerSession": 20,
        "l2.artifacts.maxContentBytes": 1048576,
        "l2.artifacts.reviews.deliverAs": "next",
        "l2.artifacts.tools.reviewRequest": false,
        "l2.artifacts.tools.sessionRename": true,
      }),
    ]);
    expect(set).toEqual({
      maxPerSession: 20,
      maxContentBytes: 1048576,
      reviews: { deliverAs: "next" },
      tools: { reviewRequest: false, sessionRename: true },
    });
  });

  test("values outside the range or of the wrong type fall back to the defaults", () => {
    const set = readArtifactsSettings([
      layer("user", {
        "l2.artifacts.maxPerSession": 0,
        "l2.artifacts.maxContentBytes": 512,
        "l2.artifacts.reviews.deliverAs": "bogus",
        "l2.artifacts.tools.reviewRequest": "yes",
      }),
    ]);
    expect(set).toEqual(DEFAULT_ARTIFACTS_SETTINGS);
    const over = readArtifactsSettings([layer("user", { "l2.artifacts.maxPerSession": 10001 })]);
    expect(over.maxPerSession).toBe(500);
  });

  test("a session layer may set the review and tool keys but not the limits", () => {
    const set = readArtifactsSettings([
      layer("user", { "l2.artifacts.maxPerSession": 40 }),
      layer("session", {
        "l2.artifacts.maxPerSession": 3,
        "l2.artifacts.reviews.deliverAs": "steer",
        "l2.artifacts.tools.reviewRequest": false,
      }),
    ]);
    expect(set.maxPerSession).toBe(40);
    expect(set.reviews.deliverAs).toBe("steer");
    expect(set.tools.reviewRequest).toBe(false);
  });
});
