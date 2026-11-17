// 대화 열기 훅(thread.resources)이 낸 스킬 경로를 스킬 탐색 입력에 넣는 자리(H-7, E-13).
import { describe, expect, test } from "bun:test";
import { existingContributedPaths, resolveSkillRoots } from "../src/skills/roots.ts";
import { createMemoryFs } from "./support/memory-fs.ts";

const SETTINGS_PATHS = ["/settings/skills"] as const;

describe("skill paths contributed at conversation open", () => {
  test("a path that exists is kept and a missing one is dropped with a diagnostic", async () => {
    const fs = createMemoryFs();
    fs.put("/kit/skills/a.md", "# a");
    const result = await existingContributedPaths(fs, ["/kit/skills/a.md", "/kit/missing"]);
    expect(result.paths).toEqual(["/kit/skills/a.md"]);
    expect(result.diagnostics).toEqual([
      {
        type: "warning",
        message: "skill_path_missing: a skill path from thread.resources cannot be read",
        path: "/kit/missing",
      },
    ]);
  });

  test("the discovery input carries the contributed path after the settings paths", async () => {
    const fs = createMemoryFs();
    fs.put("/kit/skills/a.md", "# a");
    const contributed = await existingContributedPaths(fs, ["/kit/skills/a.md"]);
    const roots = resolveSkillRoots({
      projectDir: undefined,
      projectSkills: false,
      projectTrusted: false,
      paths: [...SETTINGS_PATHS, ...contributed.paths],
      extension: [],
    });
    expect(roots.paths).toEqual(["/settings/skills", "/kit/skills/a.md"]);
  });

  test("with no contribution the discovery input is the settings paths alone", async () => {
    const fs = createMemoryFs();
    const contributed = await existingContributedPaths(fs, []);
    expect(contributed).toEqual({ paths: [], diagnostics: [] });
    const withoutContribution = resolveSkillRoots({
      projectDir: undefined,
      projectSkills: false,
      projectTrusted: false,
      paths: [...SETTINGS_PATHS, ...contributed.paths],
      extension: [],
    });
    const settingsOnly = resolveSkillRoots({
      projectDir: undefined,
      projectSkills: false,
      projectTrusted: false,
      paths: SETTINGS_PATHS,
      extension: [],
    });
    expect(withoutContribution).toEqual(settingsOnly);
  });
});
