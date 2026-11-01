import { describe, expect, test } from "bun:test";
import {
  validateManifest,
  validateUsage,
  type ExtensionUsage,
} from "../../src/extensions/index.ts";
import { codesOf, groupJson, pluginAt, pluginJson, validManifest } from "./helpers.ts";

const noUsage: ExtensionUsage = {
  on: [],
  post: false,
  drive: false,
  capabilities: [],
  recordKinds: [],
  readsRecordKinds: [],
};

function decl(kind: string): Record<string, unknown> {
  return { kind, version: 1, description: "d", payload: { type: "object" } };
}

describe("plugins[] format", () => {
  test("a single root plugin is valid", () => {
    const result = validateManifest(pluginJson({}, { hooks: ["tool.call.before"] }));
    expect(result.issues).toEqual([]);
    expect(result.manifest?.plugins).toEqual([{ layer: "plugin", hooks: ["tool.call.before"] }]);
  });

  test("a multi-plugin group with ids is valid", () => {
    const result = validateManifest(
      groupJson({
        name: "helm",
        plugins: [
          { layer: "L3", hooks: ["tool.call.before"] },
          { id: "explore", layer: "L3", hooks: [] },
          { id: "sync", layer: "L3", hooks: ["boundary.step.after"], drives: true },
        ],
      }),
    );
    expect(result.issues).toEqual([]);
    expect(result.manifest?.plugins.map((plugin) => plugin.id)).toEqual([
      undefined,
      "explore",
      "sync",
    ]);
  });

  test("a group whose members list a subset of the plugins is valid", () => {
    const result = validateManifest(
      groupJson({
        name: "helm",
        group: { members: ["explore"] },
        plugins: [
          { layer: "L3", hooks: [] },
          { id: "explore", layer: "L3", hooks: [] },
          { id: "sync", layer: "L3", hooks: [] },
        ],
      }),
    );
    expect(result.issues).toEqual([]);
  });
});

describe("legacy format and schema version", () => {
  for (const field of [
    "kind",
    "views",
    "points",
    "usesDrive",
    "layer",
    "hooks",
    "usesPost",
    "requires",
    "optional",
    "provides",
    "recordKinds",
    "readsRecordKinds",
  ]) {
    test(`top-level ${field} is rejected with legacy_field and nothing is stripped`, () => {
      const result = validateManifest(pluginJson({ [field]: "legacy" }));
      expect(result.manifest).toBeUndefined();
      expect(result.issues.map((i) => [i.code, i.severity, i.path])).toEqual([
        ["legacy_field", "error", `/${field}`],
      ]);
    });
  }

  test("an old-format manifest reports each legacy field and the version", () => {
    const result = validateManifest({
      schemaVersion: 1,
      name: "acme-notes",
      version: "1.0.0",
      layer: "plugin",
      kind: "plugin",
      entry: "./src/index.ts",
      points: ["tool.call.before"],
      usesDrive: false,
    });
    expect(result.manifest).toBeUndefined();
    expect(result.issues.map((i) => [i.code, i.path])).toEqual([
      ["legacy_field", "/kind"],
      ["legacy_field", "/points"],
      ["legacy_field", "/usesDrive"],
      ["legacy_field", "/layer"],
      ["schema_version_unsupported", "/schemaVersion"],
    ]);
  });

  test("schemaVersion 1 is schema_version_unsupported", () => {
    const result = validateManifest(pluginJson({ schemaVersion: 1 }));
    expect(result.manifest).toBeUndefined();
    expect(result.issues.map((i) => [i.code, i.path])).toEqual([
      ["schema_version_unsupported", "/schemaVersion"],
    ]);
  });

  test("an unknown top-level key is a warning and is removed", () => {
    const result = validateManifest(pluginJson({ futureField: 1 }));
    expect(result.issues.map((i) => [i.code, i.severity, i.path])).toEqual([
      ["unknown_key", "warning", "/futureField"],
    ]);
    expect(result.manifest?.name).toBe("acme-notes");
    expect(result.manifest !== undefined && "futureField" in result.manifest).toBe(false);
  });
});

describe("plugin ids and roots", () => {
  test("two plugins without id are plugin_root_ambiguous", () => {
    const result = validateManifest(
      pluginJson({
        plugins: [
          { layer: "plugin", hooks: [] },
          { layer: "plugin", hooks: [] },
        ],
      }),
    );
    expect(result.manifest).toBeUndefined();
    expect(result.issues.map((i) => [i.code, i.path])).toEqual([
      ["plugin_root_ambiguous", "/plugins/1"],
    ]);
  });

  test("a repeated plugin id is plugin_id_duplicate", () => {
    const result = validateManifest(
      groupJson({
        plugins: [
          { id: "explore", layer: "L3", hooks: [] },
          { id: "explore", layer: "L3", hooks: [] },
        ],
      }),
    );
    expect(result.manifest).toBeUndefined();
    expect(result.issues.map((i) => [i.code, i.path])).toEqual([
      ["plugin_id_duplicate", "/plugins/1/id"],
    ]);
  });

  test("a plugin id that does not match the pattern is plugin_id_invalid", () => {
    const result = validateManifest(
      groupJson({
        plugins: [{ id: "Bad_Id", layer: "L3", hooks: [] }],
      }),
    );
    expect(result.manifest).toBeUndefined();
    expect(result.issues.map((i) => [i.code, i.path])).toEqual([
      ["plugin_id_invalid", "/plugins/0/id"],
    ]);
  });
});

describe("layers", () => {
  test("layer plugin mixed with L1~L3 is layer_mixed_external", () => {
    const result = validateManifest(
      pluginJson({
        plugins: [
          { layer: "plugin", hooks: [] },
          { id: "sync", layer: "L3", hooks: [] },
        ],
      }),
    );
    expect(result.manifest).toBeUndefined();
    expect(result.issues.map((i) => [i.code, i.path])).toEqual([
      ["layer_mixed_external", "/plugins/1/layer"],
    ]);
  });
});

describe("group members", () => {
  test("a member that is not a declared plugin id is group_member_unknown", () => {
    const result = validateManifest(
      groupJson({
        group: { members: ["ghost"] },
        plugins: [
          { layer: "L3", hooks: [] },
          { id: "explore", layer: "L3", hooks: [] },
        ],
      }),
    );
    expect(result.manifest).toBeUndefined();
    expect(result.issues.map((i) => [i.code, i.path])).toEqual([
      ["group_member_unknown", "/group/members/0"],
    ]);
  });

  test("a member listed twice is group_member_duplicate", () => {
    const result = validateManifest(
      groupJson({
        group: { members: ["explore", "explore"] },
        plugins: [
          { layer: "L3", hooks: [] },
          { id: "explore", layer: "L3", hooks: [] },
        ],
      }),
    );
    expect(result.manifest).toBeUndefined();
    expect(result.issues.map((i) => [i.code, i.path])).toEqual([
      ["group_member_duplicate", "/group/members/1"],
    ]);
  });
});

describe("hooks", () => {
  test("an unknown hook name is hook_unknown at the hook's path", () => {
    const result = validateManifest(pluginJson({}, { hooks: ["tool.before"] }));
    expect(result.manifest).toBeUndefined();
    expect(result.issues.map((i) => [i.code, i.path])).toEqual([
      ["hook_unknown", "/plugins/0/hooks/0"],
    ]);
  });
});

describe("record kind prefix", () => {
  test("a group needs grp.<name>. and rejects x.<name>.", () => {
    expect(
      codesOf(
        validateManifest(groupJson({}, { recordKinds: [decl("x.learning.skill.proposed")] }))
          .issues,
      ),
    ).toEqual(["record_kind_prefix"]);
    expect(
      validateManifest(groupJson({}, { recordKinds: [decl("grp.learning.skill.proposed")] }))
        .issues,
    ).toEqual([]);
  });

  test("a plugin without group needs x.<name>. and rejects grp.<name>.", () => {
    expect(
      codesOf(
        validateManifest(pluginJson({}, { recordKinds: [decl("grp.acme-notes.note.synced")] }))
          .issues,
      ),
    ).toEqual(["record_kind_prefix"]);
    expect(
      validateManifest(pluginJson({}, { recordKinds: [decl("x.acme-notes.note.synced")] })).issues,
    ).toEqual([]);
  });
});

describe("validateUsage with plugin entries", () => {
  test("usage is checked against the plugin's own declaration and paths use its index", () => {
    const manifest = validManifest(
      groupJson({
        name: "helm",
        plugins: [
          { layer: "L3", hooks: ["tool.call.before"], usesPost: true },
          { id: "explore", layer: "L3", hooks: ["boundary.step.after"] },
        ],
      }),
    );
    const issues = validateUsage(manifest, pluginAt(manifest, 1), {
      ...noUsage,
      on: ["tool.call.before"],
      post: true,
      drive: true,
    });
    expect(issues.map((i) => [i.code, i.severity, i.path])).toEqual([
      ["hook_undeclared", "error", "/plugins/1/hooks"],
      ["hook_unused", "warning", "/plugins/1/hooks/0"],
      ["post_undeclared", "error", "/plugins/1/usesPost"],
      ["drive_undeclared", "error", "/plugins/1/drives"],
    ]);
  });

  test("drive and post use of the root plugin without declarations report the root paths", () => {
    const manifest = validManifest(groupJson());
    const issues = validateUsage(manifest, pluginAt(manifest, 0), {
      ...noUsage,
      post: true,
      drive: true,
    });
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ["post_undeclared", "/plugins/0/usesPost"],
      ["drive_undeclared", "/plugins/0/drives"],
    ]);
  });

  test("the root plugin's declared hooks are used without issues", () => {
    const manifest = validManifest(
      groupJson({
        name: "helm",
        plugins: [
          { layer: "L3", hooks: ["tool.call.before"] },
          { id: "explore", layer: "L3", hooks: [] },
        ],
      }),
    );
    expect(
      validateUsage(manifest, pluginAt(manifest, 0), { ...noUsage, on: ["tool.call.before"] }),
    ).toEqual([]);
  });
});
