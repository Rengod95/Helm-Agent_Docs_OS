import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createGuideReader, locateGuideSkills } from "../src/index.ts";

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "guide-"));
  mkdirSync(join(dir, "alpha", "references"), { recursive: true });
  writeFileSync(
    join(dir, "alpha", "SKILL.md"),
    "---\nname: alpha\ndescription: Use when testing alpha\n---\nBody of alpha\n",
  );
  writeFileSync(join(dir, "alpha", "references", "one.md"), "reference one\n");
  mkdirSync(join(dir, "stray"));
  return dir;
}

test("guide.reader: lists topics with description and reference files, skipping folders without SKILL.md", () => {
  const reader = createGuideReader(fixture());
  expect(reader.topics()).toEqual({
    ok: true,
    value: [{ name: "alpha", description: "Use when testing alpha", files: ["references/one.md"] }],
  });
});

test("guide.reader: reads the body without frontmatter and a reference file as is", () => {
  const reader = createGuideReader(fixture());
  expect(reader.read("alpha")).toEqual({ ok: true, value: "Body of alpha\n" });
  expect(reader.read("alpha", "references/one.md")).toEqual({
    ok: true,
    value: "reference one\n",
  });
});

test("guide.reader: refuses names that leave the guide folder or do not exist", () => {
  const reader = createGuideReader(fixture());
  for (const [topic, file] of [
    ["..", undefined],
    ["alpha", "../../etc/passwd"],
    ["alpha/references", undefined],
    ["missing", undefined],
    ["alpha", "references/none.md"],
  ] as const) {
    expect(reader.read(topic, file)).toMatchObject({ ok: false, error: { kind: "not_found" } });
  }
});

test("guide.locate: the override wins, then the resource folder, then the source folder", () => {
  const dir = fixture();
  expect(locateGuideSkills({ FRESNEL_GUIDE_SKILLS_DIR: dir })).toBe(dir);
  const resource = mkdtempSync(join(tmpdir(), "guide-res-"));
  mkdirSync(join(resource, "guide", "skills"), { recursive: true });
  expect(locateGuideSkills({}, resource)).toBe(join(resource, "guide", "skills"));
  expect(locateGuideSkills({})?.endsWith(join("group-guide", "skills"))).toBe(true);
});
