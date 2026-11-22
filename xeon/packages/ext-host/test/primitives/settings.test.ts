import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { buildCatalog } from "@fresnel/contracts/settings";
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
    "x.primitives.capabilityProviders",
    "x.primitives.driveDefaultLimits",
    "x.primitives.driveLimits",
    "x.primitives.driveMaxDepth",
    "x.primitives.driveRequiresOrchestration",
  ]);
  expect(primitivesSettings.defs.driveLimits.default).toEqual({});
  expect(primitivesSettings.defs.driveDefaultLimits.default).toEqual({
    maxTurns: 4,
    maxSpawns: 8,
    maxTokens: 400_000,
  });
  expect(primitivesSettings.defs.driveDefaultLimits.runtimeChange).toBe("nextTurn");
  // 프로필은 시작 한도만 바꿀 수 있다. 천장(driveLimits)은 프로필 범위를 열지 않는다
  expect(primitivesSettings.defs.driveDefaultLimits.allowedScopes).toEqual([
    "managed",
    "user",
    "project",
    "launch",
    "profile",
  ]);
  expect(primitivesSettings.defs.driveLimits.allowedScopes).toEqual([
    "managed",
    "user",
    "project",
    "launch",
  ]);
  for (const def of [
    primitivesSettings.defs.driveDefaultLimits,
    primitivesSettings.defs.driveLimits,
  ]) {
    expect(def.ui?.widget).toBe("table");
  }
  expect(primitivesSettings.defs.driveMaxDepth.default).toBe(8);
  expect(primitivesSettings.defs.driveMaxDepth.runtimeChange).toBe("nextTurn");
  // 프로필이 바꿀 수 있는 주도 한도다(M5c §4.2.6). 천장 driveLimits는 profile 범위를 열지 않는다
  expect(primitivesSettings.defs.driveMaxDepth.allowedScopes).toEqual([
    "managed",
    "user",
    "project",
    "launch",
    "profile",
  ]);
  expect(primitivesSettings.defs.driveLimits.allowedScopes).not.toContain("profile");
  // 깊이 상한은 정수 1 이상만 받는다
  expect(parse(primitivesSettings.defs.driveMaxDepth.type, 1).ok).toBe(true);
  expect(parse(primitivesSettings.defs.driveMaxDepth.type, 0).ok).toBe(false);
  expect(parse(primitivesSettings.defs.driveMaxDepth.type, 1.5).ok).toBe(false);
  expect(primitivesSettings.defs.capabilityProviders.default).toEqual({});
  expect(primitivesSettings.defs.driveRequiresOrchestration.default).toBe(true);
  expect(primitivesSettings.defs.driveRequiresOrchestration.runtimeChange).toBe("restart");
  expect(primitivesSettings.defs.driveRequiresOrchestration.allowedScopes).toEqual([
    "managed",
    "user",
  ]);
  expect(primitivesSettings.defs.driveLimits.runtimeChange).toBe("nextTurn");
  expect(primitivesSettings.defs.capabilityProviders.runtimeChange).toBe("restart");
  for (const def of defs) {
    expect(def.layer).toBe("X");
    expect(def.allowedScopes).not.toContain("local");
    expect(def.ui?.tab).toBe("plugins");
  }
});

test("a static settings source defaults to the default caps, no ceiling, the default depth limit and no provider choice", () => {
  const source = createStaticPrimitivesSettings();
  const thread = fixedIdFactory().next("thr");
  expect(source.driveDefaultLimits(thread)).toEqual(DEFAULT_DRIVE_LIMITS);
  expect(source.driveLimits(thread)).toEqual({});
  expect(source.driveMaxDepth(thread)).toBe(8);
  expect(source.capabilityProviders()).toEqual({});
  expect(createStaticPrimitivesSettings({ driveMaxDepth: 3 }).driveMaxDepth(thread)).toBe(3);
});

test("the drive policy reads group-only by default and can be opened by the static source", () => {
  expect(createStaticPrimitivesSettings().driveRequiresOrchestration()).toBe(true);
  expect(
    createStaticPrimitivesSettings({
      driveRequiresOrchestration: true,
    }).driveRequiresOrchestration(),
  ).toBe(true);
  expect(
    createStaticPrimitivesSettings({
      driveRequiresOrchestration: false,
    }).driveRequiresOrchestration(),
  ).toBe(false);
});
