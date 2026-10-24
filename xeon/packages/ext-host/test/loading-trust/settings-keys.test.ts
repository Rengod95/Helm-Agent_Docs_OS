import { expect, test } from "bun:test";
import { buildCatalog, checkSettingDef } from "@xeon/contracts/settings";
import {
  loadingTrustSettings,
  RESERVED_EXT_KEYS,
  reservedExtensionSettings,
} from "../../src/loading-trust/index.ts";
import { makeManifest } from "../primitives/fixtures/support.ts";
import { createLoaderHarness, moduleOf } from "./support/harness.ts";

test("settings: enabled false skips setup", async () => {
  const harness = await createLoaderHarness();
  harness.settings.enabled.set("set-off", false);
  let entryCalls = 0;
  const off = moduleOf({ name: "set-off" });
  const report = await harness.loader.loadAll(
    harness.options([
      {
        ...off,
        extension: () => {
          entryCalls += 1;
        },
      },
    ]),
  );
  expect(entryCalls).toBe(0);
  expect(report.extensions[0]?.state).toBe("disabled");
  expect(report.diagnostics.map((entry) => entry.code)).toEqual(["disabled_by_setting"]);
  expect(harness.t.host.scope("set-off")).toBeUndefined();
});

test("settings: enable at runtime loads once", async () => {
  const harness = await createLoaderHarness();
  harness.settings.enabled.set("set-late", false);
  let entryCalls = 0;
  const late = moduleOf({ name: "set-late" });
  await harness.loader.loadAll(
    harness.options([
      {
        ...late,
        extension: ({ scope }) => {
          entryCalls += 1;
          scope("set-late", {}, () => {});
        },
      },
    ]),
  );
  expect(entryCalls).toBe(0);
  harness.settings.enabled.set("set-late", true);
  const signal = new AbortController().signal;
  const info = await harness.loader.settingChanged("set-late", signal);
  expect(info?.state).toBe("active");
  expect(entryCalls).toBe(1);
  await harness.loader.ensureLoaded("set-late", signal);
  await harness.loader.settingChanged("set-late", signal);
  expect(entryCalls).toBe(1);
  expect(harness.t.host.scope("set-late")?.status).toBe("enabled");
});

test("settings: turning an active extension off and on requests scope toggles", async () => {
  const harness = await createLoaderHarness();
  await harness.loader.loadAll(harness.options([moduleOf({ name: "set-flip" })]));
  const signal = new AbortController().signal;
  harness.settings.enabled.set("set-flip", false);
  await harness.loader.settingChanged("set-flip", signal);
  expect(harness.t.host.scope("set-flip")?.status).toBe("disabling");
  harness.settings.enabled.set("set-flip", true);
  await harness.loader.settingChanged("set-flip", signal);
  expect(harness.t.host.scope("set-flip")?.status).toBe("enabled");
});

test("settings: an explicit enabled=true overrides the manifest default", async () => {
  const harness = await createLoaderHarness();
  harness.settings.enabled.set("set-default-off", true);
  const report = await harness.loader.loadAll(
    harness.options([moduleOf({ name: "set-default-off", defaultEnabled: false })]),
  );
  expect(report.extensions[0]?.state).toBe("active");
  expect(harness.t.host.scope("set-default-off")?.status).toBe("enabled");
  // 설정 값이 없으면 매니페스트 기본값(꺼짐)을 따른다
  const second = await createLoaderHarness();
  const other = await second.loader.loadAll(
    second.options([moduleOf({ name: "set-default-off", defaultEnabled: false })]),
  );
  expect(other.extensions[0]?.state).toBe("disabled");
});

test("settings: foreign namespace rejects load", async () => {
  const harness = await createLoaderHarness();
  const report = await harness.loader.loadAll(
    harness.options([
      moduleOf({
        name: "set-foreign",
        userConfig: { steps: { setting: "l1.loop.maxSteps", title: "Max steps" } },
      }),
      moduleOf({ name: "set-fine" }),
    ]),
  );
  const foreign = report.extensions.find((info) => info.name === "set-foreign");
  expect(foreign?.state).toBe("rejected");
  expect(report.diagnostics.map((entry) => entry.code)).toEqual(["settings_rejected"]);
  expect(report.settingGroups.map((group) => group.owner)).toEqual(["set-fine"]);
  expect(harness.t.host.scope("set-foreign")).toBeUndefined();
});

test("settings: reserved key in userConfig", async () => {
  const harness = await createLoaderHarness();
  const report = await harness.loader.loadAll(
    harness.options([
      moduleOf({
        name: "set-reserved",
        userConfig: { enabled: { setting: "ext.set-reserved.enabled", title: "Enabled" } },
      }),
    ]),
  );
  expect(report.extensions[0]?.state).toBe("rejected");
  expect(report.diagnostics.map((entry) => entry.code)).toEqual(["settings_reserved_key"]);
});

test("settings: a required userConfig key without a value disables the extension until it has one", async () => {
  const harness = await createLoaderHarness();
  const userConfig = { token: { setting: "ext.set-needs.token", title: "Token", required: true } };
  const report = await harness.loader.loadAll(
    harness.options([moduleOf({ name: "set-needs", userConfig })]),
  );
  expect(report.extensions[0]?.state).toBe("disabled");
  expect(report.diagnostics.map((entry) => entry.code)).toEqual(["config_required"]);
  harness.settings.values.add("ext.set-needs.token");
  const info = await harness.loader.ensureLoaded("set-needs", new AbortController().signal);
  expect(info.state).toBe("active");
});

test("settings: reserved defs shape", () => {
  const manifest = makeManifest({ name: "set-shape", layer: "L2", defaultEnabled: false });
  const builtin = reservedExtensionSettings(manifest, "builtin");
  expect(builtin.namespace).toBe("ext.set-shape");
  // 내장 확장에는 isolation 키가 없다
  expect(builtin.defs.map((def) => def.key)).toEqual(["ext.set-shape.enabled"]);
  const external = reservedExtensionSettings(manifest, "user");
  const [enabled, isolation] = external.defs;
  expect(enabled).toMatchObject({
    key: "ext.set-shape.enabled",
    default: false,
    runtimeChange: "live",
    allowedScopes: ["managed", "user", "project", "local", "session"],
    layer: "L2",
  });
  expect(isolation).toMatchObject({
    key: "ext.set-shape.isolation",
    default: "none",
    runtimeChange: "restart",
    allowedScopes: ["managed", "user"],
    range: { enum: ["none", "process"] },
  });
  for (const def of external.defs) {
    expect(checkSettingDef(def)).toEqual([]);
    expect(def.ui?.tab).toBe("plugins");
  }
  expect(RESERVED_EXT_KEYS).toEqual(["enabled", "isolation"]);
  expect(
    reservedExtensionSettings({ ...manifest, layer: "plugin" }, "builtin").defs[0]?.layer,
  ).toBe("L2");
  expect(
    reservedExtensionSettings({ ...manifest, layer: "L3", kind: "group" }, "builtin").defs[0]
      ?.layer,
  ).toBe("L3");
  const catalog = buildCatalog([
    { owner: "set-shape", namespace: external.namespace, defs: external.defs },
  ]);
  expect(catalog.ok).toBe(true);
});

test("settings: x.loading-trust keys pass the catalog and refuse the project scope", () => {
  const defs = Object.values(loadingTrustSettings.defs);
  expect(buildCatalog([{ owner: "ext-host", namespace: "x.loading-trust", defs }]).ok).toBe(true);
  expect(defs).toHaveLength(5);
  for (const def of defs) {
    expect(def.allowedScopes).not.toContain("project");
    expect(def.ui?.tab).toBe("plugins");
  }
  expect(loadingTrustSettings.defs.defaultProjectTrust.default).toBe("ask");
  expect(loadingTrustSettings.defs["isolation.maxRestarts"].default).toBe(3);
  expect(loadingTrustSettings.defs["isolation.restartWindowSec"].default).toBe(600);
});
