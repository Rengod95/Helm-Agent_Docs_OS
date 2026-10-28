import { expect, test } from "bun:test";
import { buildCatalog } from "@xeon/contracts/settings";
import { fixedIdFactory } from "../../src/testing/index.ts";
import {
  DEFAULT_DRIVE_LIMITS,
  createStaticPrimitivesSettings,
  primitivesSettings,
} from "../../src/primitives/index.ts";

test("x.primitives keys pass the catalog check and carry the documented defaults", () => {
  const defs = Object.values(primitivesSettings.defs);
  const catalog = buildCatalog([{ owner: "ext-host", namespace: "x.primitives", defs }]);
  expect(catalog.ok).toBe(true);
  expect(defs.map((def) => def.key).toSorted()).toEqual([
    "x.primitives.activeDriveGroup",
    "x.primitives.capabilityProviders",
    "x.primitives.driveDefaultLimits",
    "x.primitives.driveLimits",
    "x.primitives.leaseWaitLimit",
  ]);
  expect(primitivesSettings.defs.driveLimits.default).toEqual({});
  expect(primitivesSettings.defs.driveDefaultLimits.default).toEqual({
    maxTurns: 4,
    maxSpawns: 8,
    maxTokens: 400_000,
  });
  expect(primitivesSettings.defs.driveDefaultLimits.runtimeChange).toBe("nextTurn");
  for (const def of [
    primitivesSettings.defs.driveDefaultLimits,
    primitivesSettings.defs.driveLimits,
  ]) {
    expect(def.allowedScopes).toEqual(["managed", "user", "project", "session"]);
    expect(def.ui?.widget).toBe("table");
  }
  expect(primitivesSettings.defs.leaseWaitLimit.default).toBe(8);
  expect(primitivesSettings.defs.activeDriveGroup.default).toBeNull();
  expect(primitivesSettings.defs.capabilityProviders.default).toEqual({});
  expect(primitivesSettings.defs.driveLimits.runtimeChange).toBe("nextTurn");
  expect(primitivesSettings.defs.capabilityProviders.runtimeChange).toBe("restart");
  for (const def of defs) {
    expect(def.layer).toBe("X");
    expect(def.allowedScopes).not.toContain("local");
    expect(def.ui?.tab).toBe("plugins");
  }
});

test("a static settings source defaults to the default caps, no ceiling, no selection and no provider choice", () => {
  const source = createStaticPrimitivesSettings();
  const thread = fixedIdFactory().next("thr");
  expect(source.driveDefaultLimits(thread)).toEqual(DEFAULT_DRIVE_LIMITS);
  expect(source.driveLimits(thread)).toEqual({});
  expect(source.activeDriveGroup(thread)).toBeNull();
  expect(source.capabilityProviders()).toEqual({});
});
