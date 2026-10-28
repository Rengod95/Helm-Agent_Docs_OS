import { join } from "node:path";
import type { SkillDiagnostic, SkillRoots } from "../upstream/skills.ts";

// L2.knowledge.spec §4.1 경로, §4.2.1 루트 순서. 경로는 `xeon.os`가 준 디렉터리와 설정에서만 만든다(DR-13).

export interface RootsInput {
  /** `OsDirs.data`. 사용자 스킬은 `<data>/skills` */
  readonly dataDir: string;
  /** 엔진이 도는 프로젝트 디렉터리. 없으면 프로젝트 스킬이 없다 */
  readonly projectDir: string | undefined;
  /** `l2.knowledge.skills.projectSkills` */
  readonly projectSkills: boolean;
  /**
   * 프로젝트가 신뢰되었는가. 신뢰 전에는 프로젝트 스킬 루트를 싣지 않는다: 저장소가 낸 `.xeon/skills/*`의 설명이 첫 turn 인덱스에
   * 들어가고 `skill_view`가 본문을 돌려주면 신뢰하지 않은 저장소가 모델 지시문을 쓰게 된다(X.loading-trust.spec §4.7.2 표)
   */
  readonly projectTrusted: boolean;
  /** `l2.knowledge.skills.paths` */
  readonly paths: readonly string[];
  /** `resources_discover`가 알린 확장 제공 스킬 루트 */
  readonly extension: readonly { readonly dir: string; readonly extension: string }[];
}

function userSkillsDir(dataDir: string): string {
  return join(dataDir, "skills");
}

/** 프로젝트 스킬 디렉터리. `X.loading-trust`의 신뢰 필요 자원 `.xeon/skills`와 같은 위치다 */
export function projectSkillsDir(projectDir: string): string {
  return join(projectDir, ".xeon", "skills");
}

export function resolveSkillRoots(input: RootsInput): SkillRoots {
  return {
    ...(input.projectSkills && input.projectTrusted && input.projectDir !== undefined
      ? { project: projectSkillsDir(input.projectDir) }
      : {}),
    user: userSkillsDir(input.dataDir),
    extension: input.extension,
    paths: input.paths,
  };
}

/** 루트와, 루트를 정하며 알게 된 진단(신뢰하지 않은 프로젝트의 스킬을 싣지 않았다는 알림 등) */
export interface RootsResult {
  readonly roots: SkillRoots;
  readonly diagnostics: readonly SkillDiagnostic[];
}
