import { expect, test } from "bun:test";
import { validateManifest } from "@fresnel/contracts/extensions";
import { buildCatalog, checkSettingDef } from "@fresnel/contracts/settings";
import { checkGroup } from "@fresnel/group-sdk/testing";
import {
  DISGUISE_RISK_NOTICE,
  providerAnthropicOauthGroup,
  providerAnthropicOauthManifest,
  providerAnthropicOauthSettings,
} from "../../src/index.ts";

test("manifest.valid-and-off-by-default", () => {
  const checked = validateManifest(providerAnthropicOauthManifest);
  expect(checked.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  // 플러그인 그룹이다: group 선언과 id 없는 L3 루트 플러그인 하나. drive는 선언하지 않는다
  expect(providerAnthropicOauthManifest.group).toEqual({});
  expect(providerAnthropicOauthManifest.plugins.map((plugin) => [plugin.id, plugin.layer])).toEqual(
    [[undefined, "L3"]],
  );
  expect(providerAnthropicOauthManifest.plugins.map((plugin) => plugin.drives)).toEqual([
    undefined,
  ]);
  expect(providerAnthropicOauthManifest.plugins.map((plugin) => plugin.hooks)).toEqual([[]]);
  expect(providerAnthropicOauthManifest).toMatchObject({
    schemaVersion: 2,
    name: "provider-anthropic-oauth",
    version: "0.1.0",
    displayName: "Anthropic OAuth provider",
    entry: "./dist/index.js",
    defaultEnabled: false,
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
