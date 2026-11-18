// M5g-2: 스킬 로딩은 `.agents/skills`를 읽지 않는다. 프로젝트 스킬 루트는 `.fresnel/skills` 하나뿐이다.
// 제거 뒤 값으로 고정한다. 루트 계산은 파일 시스템을 보지 않으므로 이 값이 곧 읽는 자리다.
import { describe, expect, test } from "bun:test";
import { resolveSkillRoots } from "../src/skills/roots.ts";

describe("skill roots never include the shared .agents/skills (M5g-2)", () => {
  test("a trusted project gets only .fresnel/skills, even where .agents/skills would sit", () => {
    const roots = resolveSkillRoots({
      projectDir: "/work/proj",
      projectSkills: true,
      projectTrusted: true,
      userDir: "/home/u/.local/share/fresnel/skills",
      paths: [],
      extension: [],
    });
    expect(roots.project).toBe("/work/proj/.fresnel/skills");
    expect(JSON.stringify(roots)).not.toContain(".agents");
  });

  test("the root list has no entry for .agents/skills in the project, its ancestors or the home folder", () => {
    const roots = resolveSkillRoots({
      projectDir: "/home/u/work/proj",
      projectSkills: true,
      projectTrusted: true,
      userDir: "/home/u/.local/share/fresnel/skills",
      paths: ["/settings/skills"],
      extension: [],
    });
    const all = [roots.project, roots.user, ...roots.paths].filter(
      (path): path is string => path !== undefined,
    );
    expect(all.toSorted()).toEqual([
      "/home/u/.local/share/fresnel/skills",
      "/home/u/work/proj/.fresnel/skills",
      "/settings/skills",
    ]);
  });
});
