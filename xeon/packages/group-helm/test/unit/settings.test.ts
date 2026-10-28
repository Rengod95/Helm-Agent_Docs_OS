import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { buildCatalog, checkSettingDef } from "@xeon/contracts/settings";
import {
  DEFAULT_HELM_DRIVE_LIMITS,
  DEFAULT_HELM_SETTINGS,
  helmSettings,
  helmSettingsOf,
} from "../../src/index.ts";

test("settings.defs-pass-check", () => {
  const defs = Object.values(helmSettings.defs);
  for (const def of defs) expect(checkSettingDef(def)).toEqual([]);
  expect(buildCatalog([{ owner: "group-helm", namespace: "l3.helm", defs }]).ok).toBe(true);
  expect(Object.fromEntries(defs.map((def) => [def.key, def.default]))).toEqual({
    "l3.helm.autoStart": "suggest",
    "l3.helm.driveLimits": { maxTurns: 4, maxSpawns: 8, maxTokens: 400000 },
    "l3.helm.maxLenses": 3,
    "l3.helm.writeGuard": true,
  });
  expect(helmSettings.defs.driveLimits.default).toEqual(DEFAULT_HELM_DRIVE_LIMITS);
  expect(helmSettings.defs.autoStart.range).toEqual({ enum: ["off", "suggest", "auto"] });
  expect(helmSettings.defs.maxLenses.range).toEqual({ min: 1, max: 8 });
  for (const def of defs) {
    expect(def.runtimeChange).toBe("nextTurn");
    expect(def.allowedScopes).toEqual(["managed", "user", "project", "local", "session"]);
    expect(def.ui?.tab).toBe("plugins");
  }
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
