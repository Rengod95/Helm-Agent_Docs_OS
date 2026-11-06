import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { buildCatalog, checkSettingDef } from "@fresnel/contracts/settings";
import {
  DEFAULT_HELM_DRIVE_LIMITS,
  DEFAULT_HELM_SETTINGS,
  helmSettings,
  helmSettingsOf,
} from "../../src/index.ts";

test("settings.defs-pass-check", () => {
  const defs = Object.values(helmSettings.defs);
  for (const def of defs) expect(checkSettingDef(def)).toEqual([]);
  expect(buildCatalog([{ owner: "group-helm", namespace: "ext.helm", defs }]).ok).toBe(true);
  expect(Object.fromEntries(defs.map((def) => [def.key, def.default]))).toEqual({
    "ext.helm.autoStart": "suggest",
    "ext.helm.driveLimits": { maxTurns: 4, maxSpawns: 8, maxTokens: 400000 },
    "ext.helm.maxLenses": 3,
    "ext.helm.writeGuard": true,
  });
  expect(helmSettings.defs.driveLimits.default).toEqual(DEFAULT_HELM_DRIVE_LIMITS);
  expect(helmSettings.defs.autoStart.range).toEqual({ enum: ["off", "suggest", "auto"] });
  expect(helmSettings.defs.maxLenses.range).toEqual({ min: 1, max: 8 });
  for (const def of defs) {
    expect(def.runtimeChange).toBe("nextTurn");
    expect(def.allowedScopes).toEqual(["managed", "user", "project", "local", "launch"]);
    expect(def.ui?.tab).toBe("plugins");
  }
});

test("settings.labels-point-to-catalog-keys", () => {
  expect(
    Object.values(helmSettings.defs).map((def) => [def.key, def.ui?.labelKey, def.ui?.helpKey]),
  ).toEqual([
    ["ext.helm.autoStart", "settings.ext.helm.autoStart.label", "settings.ext.helm.autoStart.help"],
    [
      "ext.helm.driveLimits",
      "settings.ext.helm.driveLimits.label",
      "settings.ext.helm.driveLimits.help",
    ],
    ["ext.helm.maxLenses", "settings.ext.helm.maxLenses.label", "settings.ext.helm.maxLenses.help"],
    [
      "ext.helm.writeGuard",
      "settings.ext.helm.writeGuard.label",
      "settings.ext.helm.writeGuard.help",
    ],
  ]);
});

test("the drive limits schema accepts partial limits and rejects zero turns and unknown fields", () => {
  const schema = helmSettings.defs.driveLimits.type;
  expect(parse(schema, { maxTurns: 2 }).ok).toBe(true);
  expect(parse(schema, {}).ok).toBe(true);
  expect(parse(schema, { maxTurns: 0 }).ok).toBe(false);
  expect(parse(schema, { maxTurns: 2, extra: 1 }).ok).toBe(false);
});

test("helmSettingsOf fills missing and malformed keys with the defaults", () => {
  expect(helmSettingsOf({})).toEqual(DEFAULT_HELM_SETTINGS);
  expect(
    helmSettingsOf({
      autoStart: "auto",
      maxLenses: 5,
      writeGuard: false,
      driveLimits: { maxTurns: 2 },
    }),
  ).toEqual({ autoStart: "auto", maxLenses: 5, writeGuard: false, driveLimits: { maxTurns: 2 } });
  expect(helmSettingsOf({ autoStart: "loud", maxLenses: 99 })).toEqual(DEFAULT_HELM_SETTINGS);
});
