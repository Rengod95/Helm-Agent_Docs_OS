import type { Logger } from "@fresnel/contracts";
import type {
  ReviewedSource,
  ReviewedSourceDiagnostic,
  ReviewedSourceEntry,
} from "@fresnel/ext-host";
import type { PluginStore } from "./store.ts";

// 검토본 목록 포트의 구현(M5c §4.6.3, §4.6.5). 로더가 적재할 때마다 부른다.
// 각 이름의 현재 검토본 트리를 다시 해시해 meta.json과 맞춘다. 어긋난 항목은 목록에서 빼고 `pinned_corrupt` 진단을 준다.
// 저장소를 읽지 못하면 목록을 비우고 로그에 남긴다(그 이름들은 이번 시작에 실리지 않는다).

/** 검토본 저장소를 로더의 검토본 목록으로 연다 */
export function createReviewedSource(store: PluginStore, logger: Logger): ReviewedSource {
  return {
    async list() {
      const entries: ReviewedSourceEntry[] = [];
      const diagnostics: ReviewedSourceDiagnostic[] = [];
      const names = await store.names();
      if (!names.ok) {
        logger.error("plugin.store.list_failed", { kind: names.error.kind });
        return { entries, diagnostics };
      }
      // 이름마다 현재 검토본을 읽고, 있는 것은 무결성을 맞춘다. 서로 독립이라 함께 읽는다
      const loaded = await Promise.all(
        names.value.map(async (name) => {
          const current = await store.current(name);
          if (!current.ok || current.value === null) return { name, current, integrity: null };
          const integrity = await store.verifyIntegrity(name, current.value.contentHash);
          return { name, current, integrity };
        }),
      );
      for (const item of loaded) {
        if (!item.current.ok) {
          logger.error("plugin.store.current_failed", {
            name: item.name,
            kind: item.current.error.kind,
          });
          continue;
        }
        const version = item.current.value;
        if (version === null || item.integrity === null) continue;
        if (!item.integrity.ok) {
          if (item.integrity.error.kind !== "pinned_corrupt") {
            logger.error("plugin.store.integrity_failed", {
              name: item.name,
              kind: item.integrity.error.kind,
            });
            continue;
          }
          diagnostics.push({
            name: item.name,
            source: version.meta.origin,
            code: "pinned_corrupt",
            message: `the reviewed copy of ${item.name} no longer matches its recorded hash; it is not loaded`,
          });
          continue;
        }
        entries.push({
          name: item.name,
          source: version.meta.origin,
          root: version.treePath,
          contentHash: version.contentHash,
        });
      }
      return { entries, diagnostics };
    },
  };
}
