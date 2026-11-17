import { join } from "node:path";
import type { KnowledgeFs } from "../fs/port.ts";
import type { SkillDiagnostic, SkillRoots } from "../upstream/skills.ts";

// L2.knowledge.spec §4.1 경로, §4.2.1 루트 순서. 경로는 `fresnel.os`가 준 디렉터리와 설정에서만 만든다(DR-13).

export interface RootsInput {
  /** `OsDirs.data`. 사용자 스킬은 `<data>/skills` */
  readonly dataDir: string;
  /** 엔진이 도는 프로젝트 디렉터리. 없으면 프로젝트 스킬이 없다 */
  readonly projectDir: string | undefined;
  /** `l2.knowledge.skills.projectSkills` */
  readonly projectSkills: boolean;
  /**
   * 프로젝트가 신뢰되었는가. 신뢰 전에는 프로젝트 스킬 루트를 싣지 않는다: 저장소가 낸 `.fresnel/skills/*`의 설명이 첫 turn 인덱스에
   * 들어가고 `skill_view`가 본문을 돌려주면 신뢰하지 않은 저장소가 모델 지시문을 쓰게 된다(X.loading-trust.spec §4.7.2 표)
   */
  readonly projectTrusted: boolean;
  /** `l2.knowledge.skills.paths` */
  readonly paths: readonly string[];
  /** `thread.resources`가 알린 확장 제공 스킬 루트 */
  readonly extension: readonly { readonly dir: string; readonly extension: string }[];
}

/** 사용자 스킬 루트(`<OsDirs.data>/skills`). 호스트의 느슨한 스킬 옮김이 같은 위치를 읽도록 내보낸다 */
export function userSkillsDir(dataDir: string): string {
  return join(dataDir, "skills");
}

/** 프로젝트 스킬 디렉터리. `X.loading-trust`의 신뢰 필요 자원 `.fresnel/skills`와 같은 위치다 */
export function projectSkillsDir(projectDir: string): string {
  return join(projectDir, ".fresnel", "skills");
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

/** 열기 훅이 낸 스킬 경로 가운데 읽을 수 있는 것만 남긴다. 나머지는 버리고 진단한다(E-13 `skill_path_missing`) [제안] */
export async function existingContributedPaths(
  fs: KnowledgeFs,
  paths: readonly string[],
): Promise<{
  readonly paths: readonly string[];
  readonly diagnostics: readonly SkillDiagnostic[];
}> {
  const checked = await Promise.all(
    paths.map(async (path) => ({ path, found: (await fs.stat(path)).ok })),
  );
  const kept = checked.filter((item) => item.found).map((item) => item.path);
  const diagnostics: SkillDiagnostic[] = checked
    .filter((item) => !item.found)
    .map((item) => ({
      type: "warning",
      message: "skill_path_missing: a skill path from thread.resources cannot be read",
      path: item.path,
    }));
  return { paths: kept, diagnostics };
}
