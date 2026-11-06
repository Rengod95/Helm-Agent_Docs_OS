import { expect, test } from "bun:test";
import type { ExtensionManifest } from "@fresnel/contracts/extensions";
import type { SettingDef, SettingKey } from "@fresnel/contracts/settings";
import { registerExtensionKeys } from "../../src/assembly/ext-keys.ts";
import type { ExtensionRecord } from "../../src/assembly/m4/ext-read-port.ts";

const manifest: ExtensionManifest = {
  schemaVersion: 2,
  name: "userplug",
  version: "1.0.0",
  entry: "./index.js",
  plugins: [{ layer: "plugin", hooks: [] }],
  userConfig: {
    greeting: { setting: "ext.userplug.greeting", title: "Greeting" },
    token: { setting: "ext.userplug.token", title: "Token", sensitive: true },
  },
};

const record: ExtensionRecord = {
  manifest,
  location: "/tmp/userplug",
  origin: "user",
  requestedGrade: "user",
  effectiveGrade: "user",
  tier: null,
  loaded: true,
  diagnostics: [],
};

test("registerExtensionKeys adds the declared userConfig keys next to the enabled switch", () => {
  const catalog = new Map<SettingKey, SettingDef>();
  const added = registerExtensionKeys(catalog, [record]);
  expect([...catalog.keys()].toSorted()).toEqual([
    "ext.userplug.enabled",
    "ext.userplug.greeting",
    "ext.userplug.isolation",
    "ext.userplug.token",
  ]);
  expect(added).toBe(4);
  expect(catalog.get("ext.userplug.greeting")?.secret).toBeUndefined();
  expect(catalog.get("ext.userplug.token")?.secret).toBe(true);
  // 두 번째 호출은 더할 것이 없다
  expect(registerExtensionKeys(catalog, [record])).toBe(0);
});
