import { describe, expect, test } from "bun:test";
import {
  isEntryInsideRoot,
  validateManifest,
  validateManifestSet,
  validateUsage,
  type ExtensionUsage,
} from "../../src/extensions/index.ts";
import { RESERVED_SOURCE_KEYS } from "../../src/records/index.ts";
import { codesOf, groupJson, pluginAt, pluginJson, validManifest } from "./helpers.ts";

const noUsage: ExtensionUsage = {
  on: [],
  post: false,
  drive: false,
  capabilities: [],
  recordKinds: [],
  readsRecordKinds: [],
};

describe("validateUsage", () => {
  test("undeclared hook", () => {
    const manifest = validManifest(pluginJson({}, { hooks: ["tool.call.before"] }));
    const issues = validateUsage(manifest, pluginAt(manifest, 0), {
      ...noUsage,
      on: ["tool.call.before", "boundary.step.after"],
    });
    expect(issues.map((i) => [i.code, i.severity, i.path])).toEqual([
      ["hook_undeclared", "error", "/plugins/0/hooks"],
    ]);
  });

  test("unused hook is a warning", () => {
    const manifest = validManifest(
      pluginJson({}, { hooks: ["tool.call.before", "boundary.step.after"] }),
    );
    const issues = validateUsage(manifest, pluginAt(manifest, 0), {
      ...noUsage,
      on: ["tool.call.before"],
    });
    expect(issues.map((i) => [i.code, i.severity, i.path])).toEqual([
      ["hook_unused", "warning", "/plugins/0/hooks/1"],
    ]);
  });

  test("undeclared capability", () => {
    const manifest = validManifest(
      pluginJson(
        {},
        {
          requires: [{ id: "web.search", range: "^1.0.0" }],
          optional: [{ id: "web.fetch", range: "^1.0.0" }],
        },
      ),
    );
    const plugin = pluginAt(manifest, 0);
    const ok = validateUsage(manifest, plugin, {
      ...noUsage,
      capabilities: ["web.search", "web.fetch"],
    });
    expect(ok).toEqual([]);
    const bad = validateUsage(manifest, plugin, { ...noUsage, capabilities: ["knowledge.memory"] });
    expect(bad.map((i) => [i.code, i.path])).toEqual([
      ["capability_undeclared", "/plugins/0/requires"],
    ]);
  });

  test("post and drive need their declarations", () => {
    const manifest = validManifest(groupJson());
    const plugin = pluginAt(manifest, 0);
    expect(
      validateUsage(manifest, plugin, { ...noUsage, post: true }).map((i) => [i.code, i.path]),
    ).toEqual([["post_undeclared", "/plugins/0/usesPost"]]);
    expect(
      validateUsage(manifest, plugin, { ...noUsage, drive: true }).map((i) => [i.code, i.path]),
    ).toEqual([["drive_undeclared", "/plugins/0/drives"]]);
    const declared = validManifest(groupJson({}, { usesPost: true, drives: true }));
    expect(
      validateUsage(declared, pluginAt(declared, 0), { ...noUsage, post: true, drive: true }),
    ).toEqual([]);
  });

  test("record kinds must be declared", () => {
    const manifest = validManifest(
      groupJson(
        {},
        {
          recordKinds: [
            {
              kind: "grp.learning.skill.proposed",
              version: 1,
              description: "d",
              payload: { type: "object" },
            },
          ],
        },
      ),
    );
    const plugin = pluginAt(manifest, 0);
    expect(
      validateUsage(manifest, plugin, { ...noUsage, recordKinds: ["grp.learning.skill.proposed"] }),
    ).toEqual([]);
    expect(
      validateUsage(manifest, plugin, {
        ...noUsage,
        recordKinds: ["grp.learning.skill.saved"],
      }).map((i) => [i.code, i.path]),
    ).toEqual([["record_kind_undeclared", "/plugins/0/recordKinds"]]);
  });

  test("reads are covered by exact kinds and prefix patterns", () => {
    const manifest = validManifest(
      groupJson({}, { readsRecordKinds: ["grp.helm.*", "grp.web.page.fetched"] }),
    );
    const plugin = pluginAt(manifest, 0);
    const ok = validateUsage(manifest, plugin, {
      ...noUsage,
      readsRecordKinds: ["grp.helm.item.tagged", "grp.helm.item.*", "grp.web.page.fetched"],
    });
    expect(ok).toEqual([]);
    const bad = validateUsage(manifest, plugin, {
      ...noUsage,
      readsRecordKinds: ["grp.web.page.opened", "grp.other.*", "grp.web.*"],
    });
    expect(bad.map((i) => [i.code, i.path])).toEqual([
      ["read_kind_undeclared", "/plugins/0/readsRecordKinds"],
      ["read_kind_undeclared", "/plugins/0/readsRecordKinds"],
      ["read_kind_undeclared", "/plugins/0/readsRecordKinds"],
    ]);
  });

  test("own records are read without a declaration", () => {
    const manifest = validManifest(groupJson());
    expect(
      validateUsage(manifest, pluginAt(manifest, 0), {
        ...noUsage,
        readsRecordKinds: ["grp.learning.skill.proposed"],
      }),
    ).toEqual([]);
  });
});

describe("validateManifest rules", () => {
  test("drives is a plugin field, accepted without a group at the schema level", () => {
    expect(validateManifest(pluginJson({}, { drives: true })).issues).toEqual([]);
    expect(validateManifest(groupJson({}, { drives: true })).issues).toEqual([]);
  });

  test("usesDrive is a legacy field and is rejected", () => {
    const result = validateManifest(pluginJson({ usesDrive: true }));
    expect(codesOf(result.issues)).toEqual(["legacy_field"]);
    expect(result.manifest).toBeUndefined();
  });

  test("a group is not tied to one layer (layer_kind_mismatch is no longer raised)", () => {
    expect(validateManifest(groupJson({}, { layer: "L2" })).issues).toEqual([]);
    expect(validateManifest(pluginJson({}, { layer: "L3" })).issues).toEqual([]);
  });

  test("reserved names", () => {
    for (const name of ["web", "core", "fresnel", "workspace"]) {
      expect(codesOf(validateManifest(pluginJson({ name })).issues)).toEqual(["name_reserved"]);
    }
    const builtin = pluginJson({ name: "web", trust: { level: "builtin" } });
    expect(validateManifest(builtin).issues).toEqual([]);
  });

  test("input source keys are reserved for every trust level (U-13)", () => {
    for (const name of RESERVED_SOURCE_KEYS) {
      expect(codesOf(validateManifest(pluginJson({ name })).issues)).toEqual(["name_reserved"]);
      const builtin = pluginJson({ name, trust: { level: "builtin" } });
      expect(codesOf(validateManifest(builtin).issues)).toEqual(["name_reserved"]);
      expect(codesOf(validateManifest(groupJson({ name })).issues)).toEqual(["name_reserved"]);
    }
  });

  test("entry outside root", () => {
    for (const entry of ["/abs/index.ts", "../x.ts", "src/../../x.ts", "C:\\x.ts", "\\\\host\\x"]) {
      expect(codesOf(validateManifest(pluginJson({ entry })).issues)).toEqual(["entry_invalid"]);
    }
    for (const entry of ["./src/index.ts", "src/index.ts", "a/../b.ts"]) {
      expect(validateManifest(pluginJson({ entry })).issues).toEqual([]);
    }
    expect(isEntryInsideRoot("")).toBe(false);
  });

  test("hook duplicate", () => {
    const result = validateManifest(
      pluginJson({}, { hooks: ["tool.call.before", "tool.call.before"] }),
    );
    expect(codesOf(result.issues)).toEqual(["hook_duplicate"]);
    expect(result.issues[0]?.path).toBe("/plugins/0/hooks/1");
  });

  test("provides reserved", () => {
    const result = validateManifest(
      pluginJson({}, { provides: [{ id: "core.x", version: "1.0.0" }] }),
    );
    expect(codesOf(result.issues)).toEqual(["provides_reserved"]);
    expect(result.issues[0]?.path).toBe("/plugins/0/provides/0/id");
    expect(
      validateManifest(pluginJson({}, { provides: [{ id: "web.search", version: "1.0.0" }] }))
        .issues,
    ).toEqual([]);
  });

  test("capability duplicates and overlap", () => {
    const dup = validateManifest(
      pluginJson(
        {},
        {
          requires: [
            { id: "web.search", range: "^1.0.0" },
            { id: "web.search", range: "^1.1.0" },
          ],
        },
      ),
    );
    expect(codesOf(dup.issues)).toEqual(["capability_duplicate"]);
    const both = validateManifest(
      pluginJson(
        {},
        {
          requires: [{ id: "web.search", range: "^1.0.0" }],
          optional: [{ id: "web.search", range: "^1.0.0" }],
        },
      ),
    );
    expect(codesOf(both.issues)).toEqual(["capability_both"]);
    const badId = validateManifest(pluginJson({}, { requires: [{ id: "Web", range: "^1.0.0" }] }));
    expect(codesOf(badId.issues)).toContain("capability_invalid");
  });

  test("record kind duplicate", () => {
    const decl = { kind: "grp.learning.skill.proposed", version: 1, description: "d", payload: {} };
    const result = validateManifest(groupJson({}, { recordKinds: [decl, decl] }));
    expect(codesOf(result.issues)).toEqual(["record_kind_duplicate"]);
    expect(result.issues[0]?.path).toBe("/plugins/0/recordKinds/1/kind");
  });

  test("user config invalid", () => {
    const result = validateManifest(
      pluginJson({ userConfig: { token: { setting: "", title: "Token" } } }),
    );
    expect(codesOf(result.issues)).toContain("user_config_invalid");
    expect(
      validateManifest(
        pluginJson({ userConfig: { token: { setting: "ext.acme-notes.token", title: "Token" } } }),
      ).issues,
    ).toEqual([]);
  });

  test("isolation and trust values", () => {
    expect(codesOf(validateManifest(pluginJson({ isolation: "vm" })).issues)).toEqual([
      "isolation_invalid",
    ]);
    expect(codesOf(validateManifest(pluginJson({ trust: { level: "root" } })).issues)).toContain(
      "trust_invalid",
    );
    expect(
      validateManifest(pluginJson({ isolation: "process", trust: { level: "user" } })).issues,
    ).toEqual([]);
  });
});

describe("plugin replaces", () => {
  test("a declared built-in tool name is accepted and kept on the plugin", () => {
    const result = validateManifest(pluginJson({}, { replaces: ["read", "ls"] }));
    expect(result.issues).toEqual([]);
    expect(result.manifest?.plugins[0]?.replaces).toEqual(["read", "ls"]);
  });

  test("a name that is not a tool name is rejected", () => {
    const result = validateManifest(pluginJson({}, { replaces: ["acme__read"] }));
    expect(result.issues.map((i) => [i.code, i.severity, i.path])).toEqual([
      ["replaces_invalid", "error", "/plugins/0/replaces/0"],
    ]);
    expect(result.manifest).toBeUndefined();
  });

  test("the same tool listed twice is rejected", () => {
    const result = validateManifest(pluginJson({}, { replaces: ["read", "read"] }));
    expect(result.issues.map((i) => [i.code, i.path])).toEqual([
      ["replaces_duplicate", "/plugins/0/replaces/1"],
    ]);
  });

  test("two extensions replacing one tool is a conflict error", () => {
    const first = validManifest(pluginJson({ name: "alpha" }, { replaces: ["read"] }));
    const second = validManifest(pluginJson({ name: "beta" }, { replaces: ["ls", "read"] }));
    const issues = validateManifestSet([first, second]);
    expect(issues.map((i) => [i.code, i.severity, i.path])).toEqual([
      ["replace_conflict", "error", "beta/plugins/0/replaces/1"],
    ]);
    expect(issues[0]?.message).toContain('"alpha"');
    const other = validManifest(pluginJson({ name: "gamma" }, { replaces: ["write"] }));
    expect(validateManifestSet([first, other])).toEqual([]);
  });
});

describe("validateManifestSet", () => {
  test("name conflict", () => {
    const a = validManifest(pluginJson());
    const b = validManifest(pluginJson({ version: "2.0.0" }));
    const issues = validateManifestSet([a, b]);
    expect(codesOf(issues)).toEqual(["name_conflict"]);
    expect(issues[0]?.path).toBe("acme-notes/name");
  });

  test("drive conflict", () => {
    const helm = validManifest(groupJson({ name: "helm" }, { drives: true }));
    const other = validManifest(groupJson({ name: "other" }, { drives: true }));
    const issues = validateManifestSet([helm, other]);
    expect(issues.map((i) => [i.code, i.severity, i.path])).toEqual([
      ["drive_conflict", "warning", "helm/plugins/0/drives"],
    ]);
    expect(issues[0]?.message).toContain("helm, other");

    const disabled = validManifest(
      groupJson({ name: "other", defaultEnabled: false }, { drives: true }),
    );
    expect(validateManifestSet([helm, disabled])).toEqual([]);
    const learning = validManifest(groupJson({ name: "learning" }));
    expect(validateManifestSet([helm, learning])).toEqual([]);
  });

  test("a non-root driver is off by default and does not conflict", () => {
    const helm = validManifest(groupJson({ name: "helm" }, { drives: true }));
    const sync = validManifest(
      groupJson({
        name: "other",
        plugins: [
          { layer: "L3", hooks: [] },
          { id: "sync", layer: "L3", hooks: [], drives: true },
        ],
      }),
    );
    expect(validateManifestSet([helm, sync])).toEqual([]);
  });

  test("capability unprovided", () => {
    const needs = validManifest(
      pluginJson({ name: "needs" }, { requires: [{ id: "web.search", range: "^1.0.0" }] }),
    );
    const issues = validateManifestSet([needs]);
    expect(codesOf(issues)).toEqual(["capability_unprovided"]);
    expect(issues[0]?.severity).toBe("warning");
    expect(issues[0]?.path).toBe("needs/plugins/0/requires/0");
    const provider = validManifest(
      pluginJson({ name: "provider" }, { provides: [{ id: "web.search", version: "1.0.0" }] }),
    );
    expect(validateManifestSet([needs, provider])).toEqual([]);
  });
});
