import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CapabilityIdSchema, SemVerSchema } from "../../src/capabilities/index.ts";
import {
  CapabilityProvisionSchema,
  CapabilityRequirementSchema,
  EXTENSION_NAME_PATTERN,
  ExtensionManifestSchema,
  PluginDeclSchema,
  defineManifest,
  validateManifest,
  validateUsage,
  type ExtensionManifest,
} from "../../src/extensions/index.ts";
import { codesOf, groupJson, pluginAt, pluginJson } from "./helpers.ts";

const smokeGroup: unknown = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures/smoke-group.manifest.json"), "utf8"),
);

describe("ExtensionManifest", () => {
  test("a minimal plugin is valid and returned as is", () => {
    const result = validateManifest(pluginJson());
    expect(result.issues).toEqual([]);
    expect(result.manifest?.name).toBe("acme-notes");
    expect(result.manifest?.plugins).toEqual([{ layer: "plugin", hooks: [] }]);
  });

  test.each(["schemaVersion", "name", "version", "entry", "plugins"])(
    "required top-level field: %s missing is a schema error",
    (field) => {
      const input = pluginJson();
      delete input[field];
      const result = validateManifest(input);
      expect(result.manifest).toBeUndefined();
      expect(codesOf(result.issues)).toEqual(["schema"]);
    },
  );

  test("layer and hooks are required inside each plugin", () => {
    const noLayer = validateManifest(pluginJson({ plugins: [{ hooks: [] }] }));
    expect(noLayer.manifest).toBeUndefined();
    expect(codesOf(noLayer.issues)).toEqual(["schema"]);
    const noHooks = validateManifest(pluginJson({ plugins: [{ layer: "plugin" }] }));
    expect(noHooks.manifest).toBeUndefined();
    expect(codesOf(noHooks.issues)).toEqual(["schema"]);
  });

  test("a non-object input is a schema error", () => {
    expect(codesOf(validateManifest([]).issues)).toEqual(["schema"]);
    expect(codesOf(validateManifest(null).issues)).toEqual(["schema"]);
  });

  test("version and range", () => {
    expect(codesOf(validateManifest(pluginJson({ version: "1.0" })).issues)).toContain(
      "version_invalid",
    );
    const ok = validateManifest(
      pluginJson({}, { requires: [{ id: "web.search", range: "^1.2.0" }] }),
    );
    expect(ok.issues).toEqual([]);
    for (const range of ["1.x", "^1 || ^2"]) {
      const bad = validateManifest(pluginJson({}, { requires: [{ id: "web.search", range }] }));
      expect(codesOf(bad.issues)).toEqual(["range_invalid"]);
    }
  });

  test("unknown keys", () => {
    const result = validateManifest(pluginJson({ futureField: 1 }));
    expect(codesOf(result.issues)).toEqual(["unknown_key"]);
    expect(result.issues[0]?.severity).toBe("warning");
    expect(result.manifest !== undefined && "futureField" in result.manifest).toBe(false);

    const entry = { setting: "ext.acme-notes.token", title: "Token", extra: true };
    const inEntry = validateManifest(pluginJson({ userConfig: { token: entry } }));
    expect(codesOf(inEntry.issues)).toContain("user_config_invalid");
    expect(inEntry.manifest).toBeUndefined();

    const inComponents = validateManifest(pluginJson({ components: { skills: [], hooks: [] } }));
    expect(inComponents.issues.some((i) => i.severity === "error")).toBe(true);
  });

  test("capability schema shared", () => {
    expect(CapabilityRequirementSchema.properties.id).toBe(CapabilityIdSchema);
    // TypeBox는 Optional·Array로 감싸며 하위 스키마를 복사하므로 플러그인 필드 안에서는 같은 참조가 아니라 같은 구조다
    // (F.extensions.spec §9 8의 "동일 참조"는 CapabilityRequirementSchema까지만 성립한다)
    expect(PluginDeclSchema.properties.requires.items.properties.id).toEqual(CapabilityIdSchema);
    expect(PluginDeclSchema.properties.provides.items.properties.id).toEqual(CapabilityIdSchema);
    expect(CapabilityProvisionSchema.properties.id).toBe(CapabilityIdSchema);
    expect(CapabilityProvisionSchema.properties.version).toBe(SemVerSchema);
    expect(ExtensionManifestSchema.properties.version).toBe(SemVerSchema);
  });

  test("name pattern", () => {
    expect(EXTENSION_NAME_PATTERN).toBe("^[a-z][a-z0-9-]{1,31}$");
    expect(validateManifest(pluginJson({ name: "acme-notes" })).issues).toEqual([]);
    for (const name of ["acme_notes", "Acme", "a", "a".repeat(33), "1abc"]) {
      const result = validateManifest(pluginJson({ name }));
      expect(result.manifest).toBeUndefined();
      expect(codesOf(result.issues)).toContain("name_invalid");
    }
    expect(validateManifest(pluginJson({ name: "a".repeat(32) })).issues).toEqual([]);
  });

  test("smoke group fixture valid", () => {
    const result = validateManifest(smokeGroup);
    expect(result.issues).toEqual([]);
    expect(result.manifest?.group).toEqual({});
    expect(result.manifest?.plugins.map((plugin) => plugin.layer)).toEqual(["L3"]);
  });

  test("smoke group usage matches its declaration", () => {
    const manifest = validateManifest(smokeGroup).manifest;
    if (manifest === undefined) throw new Error("fixture must be valid");
    const issues = validateUsage(manifest, pluginAt(manifest, 0), {
      on: ["tool.call.before", "boundary.step.after"],
      post: true,
      drive: true,
      capabilities: [],
      recordKinds: ["grp.smoke-group.note.recorded"],
      readsRecordKinds: [],
    });
    expect(issues).toEqual([]);
  });

  test("defineManifest is the identity", () => {
    const literal: ExtensionManifest = {
      schemaVersion: 2,
      name: "acme-notes",
      version: "1.0.0",
      entry: "./src/index.ts",
      plugins: [{ layer: "plugin", hooks: ["tool.call.before"] }],
    };
    expect(defineManifest(literal)).toBe(literal);
    expect(validateManifest(literal).issues).toEqual([]);
    expect(literal.plugins).toEqual([{ layer: "plugin", hooks: ["tool.call.before"] }]);
  });

  test("an unknown hook name is hook_unknown", () => {
    expect(codesOf(validateManifest(pluginJson({}, { hooks: ["tool.before"] })).issues)).toEqual([
      "hook_unknown",
    ]);
  });

  test("a group manifest json helper is valid", () => {
    expect(validateManifest(groupJson()).issues).toEqual([]);
  });
});
