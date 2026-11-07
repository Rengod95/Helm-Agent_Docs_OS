// Forked from earendil-works/pi packages/coding-agent/src/core/trust-manager.ts (hasTrustRequiringProjectResources)
// at cdaf6c227d4718a72b59ccd02152c9614df44cfc (pi 1.1.0). MIT License, Copyright (c) 2025 Mario Zechner. See LICENSE.pi.
// Changes: see docs/xeon/X/loading-trust/spec.md §4.7.1, §4.7.2 and PATCHES.md.
import { dirname, join } from "node:path";
import type { LoaderFs } from "@fresnel/contracts/extensions";

// FRESNEL-PATCH: config-dir-constant
/** 프로젝트 설정 디렉터리 이름. pi는 `../config.ts`의 `CONFIG_DIR_NAME`(`.pi`)을 읽었다 */
const FRESNEL_DIR = ".fresnel";

// FRESNEL-PATCH: resource-list
/** 프로젝트 루트의 Claude Code 형식 MCP 정의. stdio 서버의 실행 명령을 담는다. 로드는 신뢰 뒤에만 읽는다(L2.mcp.spec §4.2). 신뢰 카드 미리 보기(apps/host의 `trust-preview.ts`)만 이름과 명령을 읽는다(X.loading-trust.spec §4.7.4) */
const PROJECT_MCP_JSON = ".mcp.json";

/**
 * 프로젝트 루트에 있으면 신뢰 판정이 필요한 자원(X.loading-trust.spec §4.7.2 표). 프로젝트 루트 기준 상대 경로다. `.mcp.json`은 `.fresnel` 밖의 유일한 항목이다.
 * 빈 `.fresnel` 디렉터리는 신뢰를 요구하지 않는다. `AGENTS.md` 같은 컨텍스트 파일은 목록에 없다
 */
export const TRUST_REQUIRING_PROJECT_RESOURCES: readonly string[] = [
  PROJECT_MCP_JSON,
  `${FRESNEL_DIR}/extensions`,
  `${FRESNEL_DIR}/settings.json`,
  `${FRESNEL_DIR}/settings.local.json`,
  `${FRESNEL_DIR}/mcp.json`,
  `${FRESNEL_DIR}/hooks`,
  `${FRESNEL_DIR}/skills`,
  `${FRESNEL_DIR}/commands`,
  `${FRESNEL_DIR}/prompts`,
  `${FRESNEL_DIR}/agents`,
  `${FRESNEL_DIR}/SYSTEM.md`,
  `${FRESNEL_DIR}/APPEND_SYSTEM.md`,
];

/** 프로젝트 루트와 그 상위 디렉터리의 공유 스킬 위치(pi와 같다) */
const SHARED_SKILLS = ".agents/skills";

/**
 * 프로젝트 루트에서 신뢰가 필요한 자원을 찾아 목록으로 돌려준다(pi `hasTrustRequiringProjectResources`의 불리언을 목록으로).
 * 파일이 있는지만 확인하고 내용은 읽지 않는다. 사용자 홈의 `.agents/skills`는 사용자 자원이라 제외한다(홈이 프로젝트 루트여도 같다).
 * `.agents/skills`가 상위 디렉터리에 있으면 `../.agents/skills`처럼 프로젝트 루트 기준 상대 경로로 적는다
 */
// FRESNEL-PATCH: find-list
export async function findTrustRequiringResources(
  fs: LoaderFs,
  projectRoot: string,
  homeDir: string,
): Promise<readonly string[]> {
  // FRESNEL-PATCH: injected-fs-home
  const found = new Set<string>();
  const checks = TRUST_REQUIRING_PROJECT_RESOURCES.map(async (relative) =>
    (await fs.exists(join(projectRoot, relative))) ? relative : undefined,
  );
  const userSkills = join(homeDir, ".agents", "skills");
  const ancestors: { readonly dir: string; readonly relative: string }[] = [];
  let current = projectRoot;
  let depth = 0;
  for (;;) {
    ancestors.push({
      dir: join(current, ".agents", "skills"),
      relative: [...Array.from({ length: depth }, () => ".."), SHARED_SKILLS].join("/"),
    });
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
    depth += 1;
  }
  const shared = ancestors
    .filter((entry) => entry.dir !== userSkills)
    .map(async (entry) => ((await fs.exists(entry.dir)) ? entry.relative : undefined));
  for (const name of await Promise.all([...checks, ...shared])) {
    if (name !== undefined) found.add(name);
  }
  return [...found];
}
