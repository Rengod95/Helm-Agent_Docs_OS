import { expect, test } from "bun:test";
import { validateManifest } from "@fresnel/contracts/extensions";
import { buildCatalog, checkSettingDef } from "@fresnel/contracts/settings";
import { checkGroup } from "@fresnel/group-sdk/testing";
import {
  accountRotationGroup,
  accountRotationManifest,
  accountRotationSettings,
  ROTATION_RISK_NOTICE,
} from "../../src/index.ts";

test("manifest.valid-and-off-by-default", () => {
  const checked = validateManifest(accountRotationManifest);
  expect(checked.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  // 플러그인 그룹이다: group 선언과 id 없는 L3 루트 플러그인 하나. drive는 선언하지 않는다
  expect(accountRotationManifest.group).toEqual({});
  expect(accountRotationManifest.plugins.map((plugin) => [plugin.id, plugin.layer])).toEqual([
    [undefined, "L3"],
  ]);
  expect(accountRotationManifest.plugins.map((plugin) => plugin.drives)).toEqual([undefined]);
  expect(accountRotationManifest.plugins.map((plugin) => plugin.hooks)).toEqual([[]]);
  expect(accountRotationManifest).toMatchObject({
    schemaVersion: 2,
    name: "account-rotation",
    entry: "./dist/index.js",
    defaultEnabled: false,
    trust: { level: "user" },
  });
});

test("manifest.user-config-carries-the-risk-notice", () => {
  expect(accountRotationManifest.userConfig?.acknowledgeRisk).toEqual({
    setting: "ext.account-rotation.acknowledgeRisk",
    title: "약관 위험 고지에 동의",
    description: ROTATION_RISK_NOTICE,
    required: false,
  });
});

test("settings.acknowledge-risk-defaults-to-false", () => {
  const defs = Object.values(accountRotationSettings.defs);
  for (const def of defs) expect(checkSettingDef(def)).toEqual([]);
  expect(accountRotationSettings.defs.acknowledgeRisk.key).toBe(
    "ext.account-rotation.acknowledgeRisk",
  );
  expect(accountRotationSettings.defs.acknowledgeRisk.default).toBe(false);
  expect(accountRotationSettings.defs.acknowledgeRisk.allowedScopes).toEqual(["managed", "user"]);
  expect(
    buildCatalog([{ owner: "account-rotation", namespace: "ext.account-rotation", defs }]).ok,
  ).toBe(true);
});

test("group.check-group-reports-no-errors", async () => {
  const issues = await checkGroup(accountRotationGroup);
  expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
});
