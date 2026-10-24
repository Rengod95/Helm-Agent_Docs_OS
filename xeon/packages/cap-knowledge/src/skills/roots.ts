import { join } from "node:path";
import type { SkillRoots } from "../upstream/skills.ts";

// L2.knowledge.spec §4.1 경로, §4.2.1 루트 순서. 경로는 `xeon.os`가 준 디렉터리와 설정에서만 만든다(DR-13).

export interface RootsInput {
  /** `OsDirs.data`. 사용자 스킬은 `<data>/skills` */
  readonly dataDir: string;
  /** 엔진이 도는 프로젝트 디렉터리. 없으면 프로젝트 스킬이 없다 */
  readonly projectDir: string | undefined;
  /** `l2.knowledge.skills.projectSkills` */
  readonly projectSkills: boolean;
  /** `l2.knowledge.skills.paths` */
  readonly paths: readonly string[];
  /** `resources_discover`가 알린 확장 제공 스킬 루트 */
  readonly extension: readonly { readonly dir: string; readonly extension: string }[];
}

function userSkillsDir(dataDir: string): string {
  return join(dataDir, "skills");
}

function projectSkillsDir(projectDir: string): string {
  return join(projectDir, ".xeon", "skills");
}

export function resolveSkillRoots(input: RootsInput): SkillRoots {
  return {
    ...(input.projectSkills && input.projectDir !== undefined
      ? { project: projectSkillsDir(input.projectDir) }
      : {}),
    user: userSkillsDir(input.dataDir),
    extension: input.extension,
    paths: input.paths,
  };
}
