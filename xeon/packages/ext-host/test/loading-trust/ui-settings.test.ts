import { expect, test } from "bun:test";
import { buildCatalog } from "@fresnel/contracts/settings";
import { uiSettings } from "../../src/loading-trust/index.ts";

test("settings: x.ui keys pass the catalog", () => {
  const defs = Object.values(uiSettings.defs);
  expect(buildCatalog([{ owner: "ext-host", namespace: "x.ui", defs }]).ok).toBe(true);
});

test("settings: apps and allowProjectApps both default off until the real-device check (ADR-0021 §6), both in the X layer", () => {
  expect(Object.keys(uiSettings.defs)).toEqual(["apps", "allowProjectApps"]);
  expect(uiSettings.defs.apps.key).toBe("x.ui.apps");
  expect(uiSettings.defs.apps.default).toBe(false);
  expect(uiSettings.defs.apps.layer).toBe("X");
  expect(uiSettings.defs.allowProjectApps.key).toBe("x.ui.allowProjectApps");
  expect(uiSettings.defs.allowProjectApps.default).toBe(false);
  expect(uiSettings.defs.allowProjectApps.layer).toBe("X");
});

test("settings: neither key can be set from the project, local or launch scope", () => {
  // 저장소가 자기 앱 권한을 켜거나 전역 정책을 되돌리지 못하게 한다(X.loading-trust.spec §6)
  expect(uiSettings.defs.apps.allowedScopes).toEqual(["managed", "user"]);
  expect(uiSettings.defs.allowProjectApps.allowedScopes).toEqual(["managed", "user"]);
  expect(uiSettings.defs.apps.runtimeChange).toBe("restart");
  expect(uiSettings.defs.allowProjectApps.runtimeChange).toBe("restart");
});
