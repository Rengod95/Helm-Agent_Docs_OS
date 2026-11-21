import { describe, expect, test } from "bun:test";
import {
  effectiveLayer,
  pluginDeclsOf,
  pluginsOf,
  validateManifest,
} from "../../src/extensions/index.ts";
import { codesOf, pluginJson, validManifest } from "./helpers.ts";

// M5c-1 매니페스트 변경(docs/xeon/review/m5/profile-project-loader.md §3.1, §4.5.4, §4.5.6): entry와 plugins는 선택,
// purpose·components.instructions·tools·commands를 더한다. 옛 매니페스트는 그대로 유효하다.

const bare = { schemaVersion: 2, name: "acme-notes", version: "1.0.0" };

/** 한 실패가 같은 코드의 이슈를 여러 개 낼 수 있어(닫힌 객체의 여러 경로) 종류만 본다 */
function distinctCodes(issues: Parameters<typeof codesOf>[0]): string[] {
  return [...new Set(codesOf(issues))];
}

describe("manifest with optional entry and plugins (M5c-1)", () => {
  test("neither entry nor plugins is valid, and one root plugin is inferred", () => {
    const result = validateManifest(bare);
    expect(result.issues).toEqual([]);
    const manifest = validManifest(bare);
    expect(manifest.entry).toBeUndefined();
    expect(manifest.plugins).toBeUndefined();
    expect(pluginDeclsOf(manifest)).toEqual([{ layer: "plugin", hooks: [] }]);
    expect(pluginsOf(manifest)).toEqual([
      expect.objectContaining({ registrationId: "acme-notes", root: true, inOrchestration: false }),
    ]);
    expect(effectiveLayer(manifest)).toBe("plugin");
  });

  test("entry alone is valid, and an old manifest with plugins is still valid unchanged", () => {
    expect(validateManifest({ ...bare, entry: "./src/index.ts" }).issues).toEqual([]);
    const old = validateManifest(pluginJson());
    expect(old.issues).toEqual([]);
    expect(old.manifest?.plugins).toEqual([{ layer: "plugin", hooks: [] }]);
    expect(old.manifest?.entry).toBe("./src/index.ts");
  });

  test("an entry that leaves the root is still refused although entry is optional", () => {
    expect(codesOf(validateManifest({ ...bare, entry: "../escape.ts" }).issues)).toEqual([
      "entry_invalid",
    ]);
  });

  test("an empty plugins array is still refused (minItems stays 1 when present)", () => {
    expect(codesOf(validateManifest({ ...bare, plugins: [] }).issues)).toEqual(["schema"]);
  });

  test("the declared plugins are used when present, not the inferred one", () => {
    const manifest = validManifest({
      ...bare,
      entry: "./src/index.ts",
      plugins: [{ id: "sync", layer: "L3", hooks: [] }],
    });
    expect(pluginDeclsOf(manifest)).toEqual([{ id: "sync", layer: "L3", hooks: [] }]);
    expect(effectiveLayer(manifest)).toBe("L3");
  });
});

describe("purpose, components.instructions, tools and commands (M5c-1)", () => {
  test("purpose is an optional string of at most 200 characters", () => {
    expect(validateManifest({ ...bare, purpose: "Keep notes." }).issues).toEqual([]);
    expect(validateManifest({ ...bare, purpose: "a".repeat(200) }).issues).toEqual([]);
    expect(codesOf(validateManifest({ ...bare, purpose: "a".repeat(201) }).issues)).toEqual([
      "schema",
    ]);
  });

  test("components.instructions lists instruction paths and the components object stays closed", () => {
    expect(
      validateManifest({ ...bare, components: { instructions: ["instructions.md"] } }).issues,
    ).toEqual([]);
    expect(
      codesOf(
        validateManifest({ ...bare, components: { instructions: "instructions.md" } }).issues,
      ),
    ).toEqual(["schema"]);
    expect(
      distinctCodes(validateManifest({ ...bare, components: { instruction: ["x.md"] } }).issues),
    ).toEqual(["schema"]);
  });

  test("tools take a tool-name-pattern name and a description, and nothing else", () => {
    expect(
      validateManifest({ ...bare, tools: [{ name: "note_add", description: "Add a note" }] })
        .issues,
    ).toEqual([]);
    expect(
      codesOf(
        validateManifest({ ...bare, tools: [{ name: "note-add", description: "d" }] }).issues,
      ),
    ).toEqual(["schema"]);
    expect(codesOf(validateManifest({ ...bare, tools: [{ name: "note_add" }] }).issues)).toEqual([
      "schema",
    ]);
    expect(
      distinctCodes(
        validateManifest({ ...bare, tools: [{ name: "note_add", description: "d", extra: 1 }] })
          .issues,
      ),
    ).toEqual(["schema"]);
  });

  test("commands take a command-name-pattern name (hyphen and colon allowed)", () => {
    const commands = [
      { name: "review-pr", description: "Review a pull request" },
      { name: "git:status", description: "Show status" },
    ];
    expect(validateManifest({ ...bare, commands }).issues).toEqual([]);
    expect(
      codesOf(
        validateManifest({ ...bare, commands: [{ name: "Review", description: "d" }] }).issues,
      ),
    ).toEqual(["schema"]);
  });
});

describe("duplicate tool and command names are errors (M5c-1)", () => {
  test("a repeated tool name is tool_duplicate at the later index and no manifest is returned", () => {
    const result = validateManifest({
      ...bare,
      tools: [
        { name: "a_one", description: "d" },
        { name: "b_two", description: "d" },
        { name: "a_one", description: "e" },
      ],
    });
    expect(result.manifest).toBeUndefined();
    expect(result.issues.map((issue) => [issue.severity, issue.code, issue.path])).toEqual([
      ["error", "tool_duplicate", "/tools/2/name"],
    ]);
  });

  test("a repeated command name is command_duplicate", () => {
    const result = validateManifest({
      ...bare,
      commands: [
        { name: "review-pr", description: "d" },
        { name: "review-pr", description: "e" },
      ],
    });
    expect(result.manifest).toBeUndefined();
    expect(result.issues.map((issue) => [issue.severity, issue.code, issue.path])).toEqual([
      ["error", "command_duplicate", "/commands/1/name"],
    ]);
  });

  test("a tool and a command may share a name, because the two lists are separate", () => {
    const result = validateManifest({
      ...bare,
      tools: [{ name: "review_pr", description: "d" }],
      commands: [{ name: "review-pr", description: "d" }],
    });
    expect(result.issues).toEqual([]);
  });
});
