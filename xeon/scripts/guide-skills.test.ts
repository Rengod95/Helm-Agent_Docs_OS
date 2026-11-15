import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { copyTree, guideDirOf } from "./guide-skills.ts";

/** Every file under `root`, as sorted paths relative to it. */
function filesUnder(root: string, prefix = ""): string[] {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      return entry.isDirectory() ? filesUnder(join(root, entry.name), relative) : [relative];
    })
    .toSorted();
}

test("guideDirOf reads the guide path and rejects a wrong shape or a path that leaves the repository", () => {
  expect(guideDirOf({ guide: "packages/group-guide/skills" })).toBe("packages/group-guide/skills");
  expect(guideDirOf(null)).toBeNull();
  expect(guideDirOf({})).toBeNull();
  expect(guideDirOf({ guide: 3 })).toBeNull();
  expect(guideDirOf({ guide: "" })).toBeNull();
  expect(guideDirOf({ guide: "../outside" })).toBeNull();
});

test("the committed release bundle names the group-guide skills folder", () => {
  const config: unknown = JSON.parse(
    readFileSync(`${import.meta.dir}/release-bundle.json`, "utf8"),
  );
  expect(guideDirOf(config)).toBe("packages/group-guide/skills");
});

test("copyTree stages the same files as the guide folder: four skill folders, each with SKILL.md", () => {
  const config: unknown = JSON.parse(
    readFileSync(`${import.meta.dir}/release-bundle.json`, "utf8"),
  );
  const guide = guideDirOf(config);
  if (guide === null) throw new Error("release-bundle.json has no guide path");
  const source = join(import.meta.dir, "..", guide);
  const dir = mkdtempSync(join(tmpdir(), "guide-skills-"));
  try {
    const staged = join(dir, "skills");
    copyTree(source, staged);
    expect(filesUnder(staged)).toEqual(filesUnder(source));
    const skills = readdirSync(staged, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted();
    expect(skills).toEqual([
      "fresnel-agent-assets",
      "fresnel-data-and-diagnostics",
      "fresnel-plugin-authoring",
      "fresnel-settings-and-safety",
    ]);
    for (const skill of skills) {
      expect(filesUnder(join(staged, skill))).toContain("SKILL.md");
    }
    expect(readFileSync(join(staged, "fresnel-plugin-authoring", "SKILL.md"), "utf8")).toBe(
      readFileSync(join(source, "fresnel-plugin-authoring", "SKILL.md"), "utf8"),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
