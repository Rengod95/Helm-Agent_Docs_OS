import type { OrchestrationModule } from "../types.ts";
import type { OrchestrationCatalogPort } from "../ports/catalog.ts";

/** 그룹 모듈 목록으로 만든 카탈로그. 로드 순서는 배열 순서다 */
export function orchestrationCatalogOf(
  modules: readonly OrchestrationModule[],
): OrchestrationCatalogPort {
  return {
    groups: () => modules.map((module, loadIndex) => ({ manifest: module.manifest, loadIndex })),
  };
}
