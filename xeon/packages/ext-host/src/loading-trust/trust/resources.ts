// Forked from earendil-works/pi packages/coding-agent/src/core/trust-manager.ts (hasTrustRequiringProjectResources)
// at cdaf6c227d4718a72b59ccd02152c9614df44cfc (pi 1.1.0). MIT License, Copyright (c) 2025 Mario Zechner. See LICENSE.pi.
// Changes: see docs/xeon/X/loading-trust/spec.md §4.7.1, §4.7.2 and PATCHES.md.
import { join } from "node:path";
import type { LoaderFs } from "@fresnel/contracts/extensions";

// FRESNEL-PATCH: config-dir-constant
/** 프로젝트 설정 디렉터리 이름. pi는 `../config.ts`의 `CONFIG_DIR_NAME`(`.pi`)을 읽었다 */
const FRESNEL_DIR = ".fresnel";

// FRESNEL-PATCH: resource-list
/**
 * 프로젝트 루트에 있으면 신뢰 판정이 필요한 자원(X.loading-trust.spec §4.7.2 표). 프로젝트 루트 기준 상대 경로다.
 * 전부 `.fresnel` 아래다. 다른 하네스의 `.mcp.json`과 `.agents/skills`는 엔진이 읽지 않으므로 목록에 없다(M5g-2, 가져오기로만 들어온다).
 * 빈 `.fresnel` 디렉터리는 신뢰를 요구하지 않는다. `AGENTS.md` 같은 컨텍스트 파일은 목록에 없다
 */
export const TRUST_REQUIRING_PROJECT_RESOURCES: readonly string[] = [
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

/**
 * 프로젝트 루트에서 신뢰가 필요한 자원을 찾아 목록으로 돌려준다(pi `hasTrustRequiringProjectResources`의 불리언을 목록으로).
 * 파일이 있는지만 확인하고 내용은 읽지 않는다. 목록 순서는 `TRUST_REQUIRING_PROJECT_RESOURCES`를 따른다.
 */
// FRESNEL-PATCH: find-list
export async function findTrustRequiringResources(
  fs: LoaderFs,
  projectRoot: string,
): Promise<readonly string[]> {
  const found = await Promise.all(
    TRUST_REQUIRING_PROJECT_RESOURCES.map(async (relative) =>
      (await fs.exists(join(projectRoot, relative))) ? relative : undefined,
    ),
  );
  return found.filter((name): name is string => name !== undefined);
}
