import { describe, expect, test } from "bun:test";
import { extensionPrefix, isGroupExtension, isRecordKindOf } from "../../src/extensions/index.ts";
import { groupJson, pluginJson, validManifest } from "./helpers.ts";

describe("extension prefix", () => {
  test("a manifest with group is a plugin group, prefix grp", () => {
    const group = validManifest(groupJson({ name: "learning" }));
    expect(isGroupExtension(group)).toBe(true);
    expect(extensionPrefix(group)).toBe("grp");
  });

  test("a manifest without group has prefix x", () => {
    const plugin = validManifest(pluginJson());
    expect(isGroupExtension(plugin)).toBe(false);
    expect(extensionPrefix(plugin)).toBe("x");
  });

  test("an empty group object still makes the extension a group", () => {
    expect(extensionPrefix({ group: {} })).toBe("grp");
  });
});

describe("isRecordKindOf", () => {
  const group = { name: "learning", group: {} };
  const plugin = { name: "acme-notes" };

  test("group record kinds use grp.<name>.<area>.<name>", () => {
    expect(isRecordKindOf("grp.learning.skill.proposed", group)).toBe(true);
    expect(isRecordKindOf("grp.learning.skill.proposed.extra", group)).toBe(false);
  });

  test("plugin record kinds use x.<name>.<area>.<name>", () => {
    expect(isRecordKindOf("x.acme-notes.note.synced", plugin)).toBe(true);
    expect(isRecordKindOf("x.acme-notes.note.synced.extra", plugin)).toBe(false);
  });

  test("a wrong prefix is false", () => {
    expect(isRecordKindOf("x.learning.skill.proposed", group)).toBe(false);
    expect(isRecordKindOf("grp.acme-notes.note.synced", plugin)).toBe(false);
    expect(isRecordKindOf("grp.helm.skill.proposed", group)).toBe(false);
  });

  test("a name that only shares a prefix string is false", () => {
    expect(isRecordKindOf("grp.learning-x.skill.proposed", group)).toBe(false);
  });
});
