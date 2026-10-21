import { expect, test } from "bun:test";
import { buildCatalog } from "@xeon/contracts/settings";
import { fixedIdFactory } from "../../src/testing/index.ts";
import { createStaticPrimitivesSettings, primitivesSettings } from "../../src/primitives/index.ts";

test("x.primitives keys pass the catalog check and carry the documented defaults", () => {
  const defs = Object.values(primitivesSettings.defs);
  const catalog = buildCatalog([{ owner: "ext-host", namespace: "x.primitives", defs }]);
  expect(catalog.ok).toBe(true);
  expect(defs.map((def) => def.key).toSorted()).toEqual([
    "x.primitives.activeDriveGroup",
    "x.primitives.capabilityProviders",
    "x.primitives.driveLimits",
  ]);
  expect(primitivesSettings.defs.driveLimits.default).toEqual({});
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

test("a static settings source defaults to no limits, no selection and no provider choice", () => {
  const source = createStaticPrimitivesSettings();
  expect(source.driveLimits()).toEqual({});
  expect(source.activeDriveGroup(fixedIdFactory().next("thr"))).toBeNull();
  expect(source.capabilityProviders()).toEqual({});
});
