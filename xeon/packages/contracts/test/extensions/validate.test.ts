import { describe, expect, test } from "bun:test";
import {
  isEntryInsideRoot,
  validateManifest,
  validateManifestSet,
  validateUsage,
  type ExtensionUsage,
} from "../../src/extensions/index.ts";
import { RESERVED_SOURCE_KEYS } from "../../src/records/index.ts";
import { codesOf, groupJson, pluginJson, validManifest } from "./helpers.ts";

const noUsage: ExtensionUsage = {
  on: [],
  post: false,
  drive: false,
  capabilities: [],
  recordKinds: [],
  readsRecordKinds: [],
};

describe("validateUsage", () => {
  test("undeclared point", () => {
    const manifest = validManifest(pluginJson({ points: ["tool.call.before"] }));
    const issues = validateUsage(manifest, {
      ...noUsage,
      on: ["tool.call.before", "boundary.step.after"],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("point_undeclared");
    expect(issues[0]?.severity).toBe("error");
  });

  test("unused point is a warning", () => {
    const manifest = validManifest(
      pluginJson({ points: ["tool.call.before", "boundary.step.after"] }),
    );
    const issues = validateUsage(manifest, { ...noUsage, on: ["tool.call.before"] });
    expect(issues.map((i) => [i.code, i.severity, i.path])).toEqual([
      ["point_unused", "warning", "/points/1"],
    ]);
  });

  test("undeclared capability", () => {
    const manifest = validManifest(
      pluginJson({
        requires: [{ id: "web.search", range: "^1.0.0" }],
        optional: [{ id: "web.fetch", range: "^1.0.0" }],
      }),
    );
    const ok = validateUsage(manifest, { ...noUsage, capabilities: ["web.search", "web.fetch"] });
    expect(ok).toEqual([]);
    const bad = validateUsage(manifest, { ...noUsage, capabilities: ["knowledge.memory"] });
    expect(codesOf(bad)).toEqual(["capability_undeclared"]);
  });

  test("post and drive need their declarations", () => {
    const manifest = validManifest(groupJson());
    expect(codesOf(validateUsage(manifest, { ...noUsage, post: true }))).toEqual([
      "post_undeclared",
    ]);
    expect(codesOf(validateUsage(manifest, { ...noUsage, drive: true }))).toEqual([
      "drive_undeclared",
    ]);
    const declared = validManifest(groupJson({ usesPost: true, usesDrive: true }));
    expect(validateUsage(declared, { ...noUsage, post: true, drive: true })).toEqual([]);
  });

  test("record kinds must be declared", () => {
    const manifest = validManifest(
      groupJson({
        recordKinds: [
          {
            kind: "grp.learning.skill.proposed",
            version: 1,
            description: "d",
            payload: { type: "object" },
          },
        ],
      }),
    );
    expect(
      validateUsage(manifest, { ...noUsage, recordKinds: ["grp.learning.skill.proposed"] }),
    ).toEqual([]);
    expect(
      codesOf(validateUsage(manifest, { ...noUsage, recordKinds: ["grp.learning.skill.saved"] })),
    ).toEqual(["record_kind_undeclared"]);
  });

  test("reads are covered by exact kinds and prefix patterns", () => {
    const manifest = validManifest(
      groupJson({ readsRecordKinds: ["grp.helm.*", "grp.web.page.fetched"] }),
    );
    const ok = validateUsage(manifest, {
      ...noUsage,
      readsRecordKinds: ["grp.helm.item.tagged", "grp.helm.item.*", "grp.web.page.fetched"],
    });
    expect(ok).toEqual([]);
    const bad = validateUsage(manifest, {
      ...noUsage,
      readsRecordKinds: ["grp.web.page.opened", "grp.other.*", "grp.web.*"],
    });
    expect(codesOf(bad)).toEqual([
      "read_kind_undeclared",
      "read_kind_undeclared",
      "read_kind_undeclared",
    ]);
  });

  test("own records are read without a declaration", () => {
    const manifest = validManifest(groupJson());
    expect(
      validateUsage(manifest, { ...noUsage, readsRecordKinds: ["grp.learning.skill.proposed"] }),
    ).toEqual([]);
  });
});

describe("validateManifest rules", () => {
  test("drive rules", () => {
    const plugin = validateManifest(pluginJson({ usesDrive: true }));
    expect(codesOf(plugin.issues)).toEqual(["drive_requires_group"]);
    expect(validateManifest(groupJson({ usesDrive: true })).issues).toEqual([]);
  });

  test("layer kind", () => {
    expect(codesOf(validateManifest(groupJson({ layer: "L2" })).issues)).toEqual([
      "layer_kind_mismatch",
    ]);
    expect(codesOf(validateManifest(pluginJson({ layer: "L3" })).issues)).toEqual([
      "layer_kind_mismatch",
    ]);
  });

  test("reserved names", () => {
    for (const name of ["web", "core", "xeon", "workspace"]) {
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

  test("point duplicate", () => {
    const result = validateManifest(
      pluginJson({ points: ["tool.call.before", "tool.call.before"] }),
    );
    expect(codesOf(result.issues)).toEqual(["point_duplicate"]);
    expect(result.issues[0]?.path).toBe("/points/1");
  });

  test("provides reserved", () => {
    const result = validateManifest(pluginJson({ provides: [{ id: "core.x", version: "1.0.0" }] }));
    expect(codesOf(result.issues)).toEqual(["provides_reserved"]);
    expect(
      validateManifest(pluginJson({ provides: [{ id: "web.search", version: "1.0.0" }] })).issues,
    ).toEqual([]);
  });

  test("capability duplicates and overlap", () => {
    const dup = validateManifest(
      pluginJson({
        requires: [
          { id: "web.search", range: "^1.0.0" },
          { id: "web.search", range: "^1.1.0" },
        ],
      }),
    );
    expect(codesOf(dup.issues)).toEqual(["capability_duplicate"]);
    const both = validateManifest(
      pluginJson({
        requires: [{ id: "web.search", range: "^1.0.0" }],
        optional: [{ id: "web.search", range: "^1.0.0" }],
      }),
    );
    expect(codesOf(both.issues)).toEqual(["capability_both"]);
    const badId = validateManifest(pluginJson({ requires: [{ id: "Web", range: "^1.0.0" }] }));
    expect(codesOf(badId.issues)).toContain("capability_invalid");
  });

  test("record kind duplicate", () => {
    const decl = { kind: "grp.learning.skill.proposed", version: 1, description: "d", payload: {} };
    const result = validateManifest(groupJson({ recordKinds: [decl, decl] }));
    expect(codesOf(result.issues)).toEqual(["record_kind_duplicate"]);
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

describe("validateManifestSet", () => {
  test("name conflict", () => {
    const a = validManifest(pluginJson());
    const b = validManifest(pluginJson({ version: "2.0.0" }));
    const issues = validateManifestSet([a, b]);
    expect(codesOf(issues)).toEqual(["name_conflict"]);
    expect(issues[0]?.path).toBe("acme-notes/name");
  });

  test("drive conflict", () => {
    const helm = validManifest(groupJson({ name: "helm", usesDrive: true }));
    const other = validManifest(groupJson({ name: "other", usesDrive: true }));
    const issues = validateManifestSet([helm, other]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("drive_conflict");
    expect(issues[0]?.severity).toBe("warning");

    const disabled = validManifest(
      groupJson({ name: "other", usesDrive: true, defaultEnabled: false }),
    );
    expect(validateManifestSet([helm, disabled])).toEqual([]);
    const learning = validManifest(groupJson({ name: "learning" }));
    expect(validateManifestSet([helm, learning])).toEqual([]);
  });

  test("capability unprovided", () => {
    const needs = validManifest(
      pluginJson({ name: "needs", requires: [{ id: "web.search", range: "^1.0.0" }] }),
    );
    const issues = validateManifestSet([needs]);
    expect(codesOf(issues)).toEqual(["capability_unprovided"]);
    expect(issues[0]?.severity).toBe("warning");
    expect(issues[0]?.path).toBe("needs/requires/0");
    const provider = validManifest(
      pluginJson({ name: "provider", provides: [{ id: "web.search", version: "1.0.0" }] }),
    );
    expect(validateManifestSet([needs, provider])).toEqual([]);
  });
});
