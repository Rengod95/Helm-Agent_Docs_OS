import { describe, expect, test } from "bun:test";
import {
  REGISTRATION_ID_PATTERN,
  effectiveLayer,
  pluginDefaultEnabled,
  pluginsOf,
  registrationIdOf,
} from "../../src/extensions/index.ts";
import { groupJson, pluginAt, pluginJson, validManifest } from "./helpers.ts";

describe("registrationIdOf", () => {
  test("the root plugin uses the extension name, others use name/id", () => {
    expect(registrationIdOf({ name: "helm" }, undefined)).toBe("helm");
    expect(registrationIdOf({ name: "helm" }, "explore")).toBe("helm/explore");
  });

  test("the ids match REGISTRATION_ID_PATTERN and the stored scopeId shape", () => {
    const pattern = new RegExp(REGISTRATION_ID_PATTERN);
    const ids = [
      registrationIdOf({ name: "helm" }, undefined),
      registrationIdOf({ name: "helm" }, "explore"),
    ];
    expect(ids).toEqual(["helm", "helm/explore"]);
    expect(ids.map((id) => pattern.test(id))).toEqual([true, true]);
    for (const bad of ["helm/", "helm/explore/x", "Helm", "helm/E"]) {
      expect(pattern.test(bad)).toBe(false);
    }
  });
});

describe("pluginsOf", () => {
  test("without group no plugin is in a group", () => {
    const manifest = validManifest(
      pluginJson({
        name: "helm",
        plugins: [
          { layer: "plugin", hooks: [] },
          { id: "explore", layer: "plugin", hooks: [] },
        ],
      }),
    );
    const entries = pluginsOf(manifest);
    expect(entries.map((entry) => entry.registrationId)).toEqual(["helm", "helm/explore"]);
    expect(entries.map((entry) => entry.index)).toEqual([0, 1]);
    expect(entries.map((entry) => entry.root)).toEqual([true, false]);
    expect(entries.map((entry) => entry.inGroup)).toEqual([false, false]);
  });

  test("group without members puts every plugin in the group", () => {
    const manifest = validManifest(
      groupJson({
        name: "helm",
        plugins: [
          { layer: "L3", hooks: [] },
          { id: "explore", layer: "L3", hooks: [] },
        ],
      }),
    );
    const entries = pluginsOf(manifest);
    expect(entries.map((entry) => entry.registrationId)).toEqual(["helm", "helm/explore"]);
    expect(entries.map((entry) => entry.root)).toEqual([true, false]);
    expect(entries.map((entry) => entry.inGroup)).toEqual([true, true]);
  });

  test("group members pick the non-root plugins; the root stays in the group", () => {
    const manifest = validManifest(
      groupJson({
        name: "helm",
        group: { members: ["alpha"] },
        plugins: [
          { layer: "L3", hooks: [] },
          { id: "alpha", layer: "L3", hooks: [] },
          { id: "beta", layer: "L3", hooks: [] },
        ],
      }),
    );
    const entries = pluginsOf(manifest);
    expect(entries.map((entry) => entry.registrationId)).toEqual([
      "helm",
      "helm/alpha",
      "helm/beta",
    ]);
    expect(entries.map((entry) => entry.root)).toEqual([true, false, false]);
    expect(entries.map((entry) => entry.inGroup)).toEqual([true, true, false]);
  });
});

describe("pluginDefaultEnabled", () => {
  test("the root plugin follows the extension defaultEnabled, true when unset", () => {
    const unset = validManifest(pluginJson());
    expect(pluginDefaultEnabled(unset, pluginAt(unset, 0))).toBe(true);
    const off = validManifest(pluginJson({ defaultEnabled: false }));
    expect(pluginDefaultEnabled(off, pluginAt(off, 0))).toBe(false);
  });

  test("a plugin's own defaultEnabled overrides the extension default for the root", () => {
    const manifest = validManifest(pluginJson({}, { defaultEnabled: false }));
    expect(pluginDefaultEnabled(manifest, pluginAt(manifest, 0))).toBe(false);
  });

  test("a non-root plugin is off unless its own defaultEnabled is true", () => {
    const manifest = validManifest(
      pluginJson({
        name: "helm",
        plugins: [
          { layer: "plugin", hooks: [] },
          { id: "explore", layer: "plugin", hooks: [] },
          { id: "sync", layer: "plugin", hooks: [], defaultEnabled: true },
        ],
      }),
    );
    expect(pluginDefaultEnabled(manifest, pluginAt(manifest, 1))).toBe(false);
    expect(pluginDefaultEnabled(manifest, pluginAt(manifest, 2))).toBe(true);
  });
});

describe("effectiveLayer", () => {
  test("the highest layer among the plugins", () => {
    const manifest = validManifest(
      groupJson({
        name: "helm",
        plugins: [
          { layer: "L2", hooks: [] },
          { id: "explore", layer: "L3", hooks: [] },
        ],
      }),
    );
    expect(effectiveLayer(manifest)).toBe("L3");
  });

  test("a single L1 plugin is L1", () => {
    expect(effectiveLayer(validManifest(pluginJson({}, { layer: "L1" })))).toBe("L1");
  });

  test("external plugins are plugin", () => {
    expect(effectiveLayer(validManifest(pluginJson()))).toBe("plugin");
  });
});
