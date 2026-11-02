import { describe, expect, test } from "bun:test";
import { parse } from "../../src/base/index.ts";
import {
  CompositionDeclSchema,
  validateComposition,
  validateManifest,
  type CompositionDecl,
  type PluginDecl,
} from "../../src/extensions/index.ts";
import { codesOf, groupJson, pluginJson } from "./helpers.ts";

const detect = { id: "detect", stage: "detect", op: "on", hooks: ["input.user.before"] } as const;
const machine = { id: "machine", stage: "machine", op: "drive" } as const;
const phases = {
  initial: "plan",
  nodes: [
    { id: "plan", kind: "turn" },
    { id: "confirm", kind: "human", askTitle: "confirm.title" },
    { id: "done", kind: "end" },
  ],
  transitions: [
    { from: "plan", to: "confirm", event: "plan.ready" },
    { from: "confirm", to: "done" },
  ],
} as const;

function declOf(input: unknown): CompositionDecl {
  const parsed = parse(CompositionDeclSchema, input);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error.issues));
  return parsed.value;
}

describe("CompositionDecl schema", () => {
  test("round trips a full declaration by value", () => {
    const input: unknown = {
      blocks: [
        {
          ...detect,
          title: "Detect",
          summary: "finds signals",
          produces: [
            { kind: "record", recordKind: "grp.learning.signal.seen" },
            { kind: "post" },
            { kind: "state" },
          ],
        },
        { ...machine, consumes: ["web.search"] },
      ],
      phases,
    };
    const actual: unknown = declOf(input);
    expect(actual).toEqual(input);
  });

  test("rejects unknown op, unknown hook, empty blocks and extra keys", () => {
    expect(parse(CompositionDeclSchema, { blocks: [] }).ok).toBe(false);
    expect(parse(CompositionDeclSchema, { blocks: [{ ...detect, op: "fold" }] }).ok).toBe(false);
    expect(
      parse(CompositionDeclSchema, { blocks: [{ ...detect, hooks: ["no.such.hook"] }] }).ok,
    ).toBe(false);
    expect(parse(CompositionDeclSchema, { blocks: [detect], extra: 1 }).ok).toBe(false);
  });
});

describe("validateComposition", () => {
  test("a valid composition has no issues", () => {
    expect(validateComposition(declOf({ blocks: [detect, machine], phases }))).toEqual([]);
  });

  test("two drive blocks: drive_duplicate at the second", () => {
    const issues = validateComposition(declOf({ blocks: [machine, { ...machine, id: "m2" }] }));
    expect(issues).toEqual([
      {
        severity: "error",
        code: "drive_duplicate",
        path: "/blocks/1",
        message: expect.any(String),
      },
    ]);
  });

  test("on block calling a capability: on_capability_call", () => {
    const issues = validateComposition(
      declOf({ blocks: [{ ...detect, consumes: ["web.search"] }] }),
    );
    expect(codesOf(issues)).toEqual(["on_capability_call"]);
    expect(issues[0]?.path).toBe("/blocks/0/consumes");
  });

  test("on needs hooks and others must not list them; duplicate block ids", () => {
    const issues = validateComposition(
      declOf({
        blocks: [
          { id: "a", stage: "x", op: "on" },
          { id: "a", stage: "x", op: "record", hooks: ["input.user.before"] },
        ],
      }),
    );
    expect(codesOf(issues)).toEqual([
      "composition_hooks",
      "composition_duplicate",
      "composition_hooks",
    ]);
  });

  test("manifest context checks the block's own plugin: hook, capability, drive and post", () => {
    const manifest: { plugins: PluginDecl[] } = {
      plugins: [
        { layer: "L3", hooks: [], requires: [], optional: [] },
        { id: "sync", layer: "L3", hooks: ["input.user.before"], drives: true, usesPost: true },
      ],
    };
    const issues = validateComposition(
      declOf({
        blocks: [
          { ...detect, produces: [{ kind: "post" }] },
          { ...machine, consumes: ["web.search"] },
          { ...detect, id: "own", plugin: "sync", produces: [{ kind: "post" }] },
          { ...machine, id: "m2", plugin: "sync" },
        ],
      }),
      { manifest },
    );
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ["hook_undeclared", "/blocks/0/hooks/0"],
      ["post_undeclared", "/blocks/0"],
      ["capability_undeclared", "/blocks/1/consumes/0"],
      ["drive_undeclared", "/blocks/1"],
      ["drive_duplicate", "/blocks/3"],
    ]);
  });

  test("a block names a plugin that does not exist: composition_plugin_unknown", () => {
    const manifest: { plugins: PluginDecl[] } = {
      plugins: [{ id: "sync", layer: "L3", hooks: [] }],
    };
    const issues = validateComposition(
      declOf({
        blocks: [
          { ...machine, plugin: "ghost" },
          { ...machine, id: "root" },
        ],
      }),
      { manifest },
    );
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ["composition_plugin_unknown", "/blocks/0/plugin"],
      ["composition_plugin_unknown", "/blocks/1/plugin"],
      ["drive_duplicate", "/blocks/1"],
    ]);
  });

  test("capability_missing is a warning for required capabilities without a provider", () => {
    const manifest: { plugins: PluginDecl[] } = {
      plugins: [
        {
          layer: "L3",
          hooks: [],
          drives: true,
          requires: [{ id: "web.search", range: "^1.0.0" }],
          optional: [{ id: "web.fetch", range: "^1.0.0" }],
        },
      ],
    };
    const decl = declOf({ blocks: [{ ...machine, consumes: ["web.search", "web.fetch"] }] });
    const none = validateComposition(decl, { manifest, providers: [] });
    expect(none.map((i) => [i.severity, i.code, i.path])).toEqual([
      ["warning", "capability_missing", "/blocks/0/consumes/0"],
    ]);
    expect(validateComposition(decl, { manifest, providers: ["web.search"] })).toEqual([]);
    expect(validateComposition(decl, { manifest })).toEqual([]);
  });

  test("phases: unknown ids, duplicate nodes, end with outgoing, unreachable, no drive", () => {
    const bad = declOf({
      blocks: [machine],
      phases: {
        initial: "start",
        nodes: [
          { id: "a", kind: "phase" },
          { id: "a", kind: "end" },
          { id: "orphan", kind: "phase" },
        ],
        transitions: [{ from: "a", to: "ghost" }],
      },
    });
    const issues = validateComposition(bad);
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ["phase_invalid", "/phases/nodes/1/id"],
      ["phase_invalid", "/phases/initial"],
      ["phase_invalid", "/phases/transitions/0/to"],
      ["phase_invalid", "/phases/transitions/0/from"],
    ]);
    const noDrive = validateComposition(declOf({ blocks: [detect], phases }));
    expect(codesOf(noDrive)).toEqual(["phases_without_drive"]);
    const unreachable = validateComposition(
      declOf({
        blocks: [machine],
        phases: {
          initial: "a",
          nodes: [
            { id: "a", kind: "phase" },
            { id: "b", kind: "end" },
          ],
          transitions: [],
        },
      }),
    );
    expect(unreachable.map((i) => [i.severity, i.code, i.path])).toEqual([
      ["warning", "phase_unreachable", "/phases/nodes/1"],
    ]);
    const endOut = validateComposition(
      declOf({
        blocks: [machine],
        phases: {
          initial: "a",
          nodes: [
            { id: "a", kind: "end" },
            { id: "b", kind: "phase" },
          ],
          transitions: [{ from: "a", to: "b" }],
        },
      }),
    );
    expect(codesOf(endOut)).toEqual(["phase_invalid"]);
  });
});

describe("manifest group.composition", () => {
  const plugins = [{ layer: "L3", hooks: ["input.user.before"], drives: true }];

  test("a group with a matching composition is valid", () => {
    const result = validateManifest(
      groupJson({ plugins, group: { composition: { blocks: [detect, machine], phases } } }),
    );
    expect(result.issues).toEqual([]);
    expect(result.manifest?.group?.composition?.blocks.map((b) => b.id)).toEqual([
      "detect",
      "machine",
    ]);
  });

  test("issues carry the /group/composition prefix and mismatches against the plugin", () => {
    const result = validateManifest(
      groupJson({
        plugins: [{ layer: "L3", hooks: [], drives: true }],
        group: { composition: { blocks: [detect, machine] } },
      }),
    );
    expect(result.issues.map((i) => [i.code, i.path])).toEqual([
      ["hook_undeclared", "/group/composition/blocks/0/hooks/0"],
    ]);
  });

  test("blocks are checked against their own plugin in a multi-plugin group", () => {
    const result = validateManifest(
      groupJson({
        plugins: [
          { layer: "L3", hooks: [] },
          { id: "sync", layer: "L3", hooks: ["input.user.before"], drives: true },
        ],
        group: {
          composition: {
            blocks: [
              { ...detect, plugin: "sync" },
              { ...machine, plugin: "sync" },
            ],
          },
        },
      }),
    );
    expect(result.issues).toEqual([]);
  });

  test("top-level composition is rejected with a pointer to group.composition", () => {
    const plugin = validateManifest(pluginJson({ composition: { blocks: [machine] } }));
    expect(plugin.issues.map((i) => [i.code, i.path])).toEqual([["legacy_field", "/composition"]]);
    expect(plugin.issues[0]?.message).toContain("group.composition");
    const shape = validateManifest(groupJson({ group: { composition: { blocks: [] } } }));
    expect(codesOf(shape.issues)).toEqual(["composition_invalid"]);
  });

  test("a plugin without group has no place for composition: schema rejects", () => {
    const result = validateManifest(pluginJson({ group: undefined }));
    expect(result.manifest?.group).toBeUndefined();
  });
});
