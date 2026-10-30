import { expect, test } from "bun:test";
import { validateManifest } from "@xeon/contracts/extensions";
import { buildCatalog, checkSettingDef } from "@xeon/contracts/settings";
import { checkGroup } from "@xeon/group-kit/testing";
import {
  accountRotationGroup,
  accountRotationManifest,
  accountRotationSettings,
  ROTATION_RISK_NOTICE,
} from "../../src/index.ts";

test("manifest.valid-and-off-by-default", () => {
  const checked = validateManifest(accountRotationManifest);
  expect(checked.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  expect(accountRotationManifest).toMatchObject({
    name: "account-rotation",
    layer: "L3",
    kind: "group",
    entry: "./dist/index.js",
    defaultEnabled: false,
    usesDrive: false,
    points: [],
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
