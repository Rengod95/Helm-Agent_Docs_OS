import { expect, test } from "bun:test";
import { validateManifest } from "@xeon/contracts/extensions";
import { buildCatalog, checkSettingDef } from "@xeon/contracts/settings";
import { checkGroup } from "@xeon/group-kit/testing";
import {
  DISGUISE_RISK_NOTICE,
  providerAnthropicOauthGroup,
  providerAnthropicOauthManifest,
  providerAnthropicOauthSettings,
} from "../../src/index.ts";

test("manifest.valid-and-off-by-default", () => {
  const checked = validateManifest(providerAnthropicOauthManifest);
  expect(checked.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  expect(providerAnthropicOauthManifest).toMatchObject({
    name: "provider-anthropic-oauth",
    version: "0.1.0",
    displayName: "Anthropic OAuth provider",
    layer: "L3",
    kind: "group",
    entry: "./dist/index.js",
    defaultEnabled: false,
    usesDrive: false,
    points: [],
    trust: { level: "user" },
  });
});

test("manifest.user-config-carries-the-risk-notice-and-the-token-reference", () => {
  expect(providerAnthropicOauthManifest.userConfig).toEqual({
    acknowledgeRisk: {
      setting: "ext.provider-anthropic-oauth.acknowledgeRisk",
      title: "약관 위험 고지에 동의",
      description: DISGUISE_RISK_NOTICE,
      required: false,
    },
    credential: {
      setting: "ext.provider-anthropic-oauth.credential",
      title: "OAuth 토큰",
      sensitive: true,
      required: false,
    },
  });
});

test("settings.defaults-are-off-and-no-credential", () => {
  const defs = Object.values(providerAnthropicOauthSettings.defs);
  for (const def of defs) expect(checkSettingDef(def)).toEqual([]);
  expect(providerAnthropicOauthSettings.namespace).toBe("ext.provider-anthropic-oauth");
  expect(providerAnthropicOauthSettings.defs.acknowledgeRisk.key).toBe(
    "ext.provider-anthropic-oauth.acknowledgeRisk",
  );
  expect(providerAnthropicOauthSettings.defs.acknowledgeRisk.default).toBe(false);
  expect(providerAnthropicOauthSettings.defs.acknowledgeRisk.allowedScopes).toEqual([
    "managed",
    "user",
  ]);
  expect(providerAnthropicOauthSettings.defs.credential.key).toBe(
    "ext.provider-anthropic-oauth.credential",
  );
  expect(providerAnthropicOauthSettings.defs.credential.default).toBeNull();
  expect(providerAnthropicOauthSettings.defs.credential.allowedScopes).toEqual(["managed", "user"]);
  expect(
    buildCatalog([
      {
        owner: "provider-anthropic-oauth",
        namespace: "ext.provider-anthropic-oauth",
        defs,
      },
    ]).ok,
  ).toBe(true);
});

test("group.check-group-reports-no-errors", async () => {
  const issues = await checkGroup(providerAnthropicOauthGroup);
  expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
});
