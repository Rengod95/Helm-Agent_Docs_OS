import { join } from "node:path";
import { lstat } from "node:fs/promises";
import { attemptAsync, parse, type Logger } from "@fresnel/contracts";
import { ExtensionNameSchema, type ExtensionManifest } from "@fresnel/contracts/extensions";
import type {
  ReviewedSource,
  ReviewedSourceDiagnostic,
  ReviewedSourceEntry,
} from "@fresnel/ext-host";
import { readPluginFolder } from "./folder-reader.ts";
import { parseReviewKey, type ReviewKeyParts } from "./review-key.ts";
import type { PluginStore } from "./store.ts";

const MANIFEST_PATH = join(".fresnel-plugin", "plugin.json");

// 검토본 목록 포트의 구현(M5c §4.6.3, §4.6.5). 로더가 적재할 때마다 부른다.
// 각 키의 현재 검토본 트리를 다시 해시해 meta.json과 맞춘다. 어긋난 항목은 목록에서 빼고 `pinned_corrupt` 진단을 준다.
// 저장소를 읽지 못하면 목록을 비우고 로그에 남긴다(그 이름들은 이번 시작에 실리지 않는다).
// 프로젝트 출처 항목은 `projectId`를 싣는다. 로더는 그 프로젝트를 여는 때만 싣는다(`loadProject`).

/**
 * 매니페스트 파일이 없는 검토본(스킬이나 지침만 든 폴더를 옮긴 것)의 추론 매니페스트(M5c §4.5.4). 파일이 있으면 undefined다(파일이 이긴다).
 * 추론은 폴더를 읽는 쪽과 같다. 폴더 이름은 트리의 이름(`tree`)이라 검토본의 이름으로 바꾼다
 */
async function inferredManifestOf(
  treePath: string,
  name: string,
): Promise<ExtensionManifest | undefined> {
  const file = await attemptAsync(() => lstat(join(treePath, MANIFEST_PATH)));
  if (file.ok) return undefined;
  const folder = readPluginFolder(treePath, { origin: "user" });
  if (!folder.ok || !folder.value.inferred) return undefined;
  const named = parse(ExtensionNameSchema, name);
  if (!named.ok) return undefined;
  return { ...folder.value.manifest, name: named.value };
}

/** 키 하나를 읽은 결과. 무결성이 어긋나면 `integrity`가 실패다 */
interface KeyRead {
  readonly key: string;
  readonly parts: ReviewKeyParts;
  readonly current: Awaited<ReturnType<PluginStore["current"]>>;
  readonly integrity: Awaited<ReturnType<PluginStore["verifyIntegrity"]>> | null;
  readonly manifest: ExtensionManifest | undefined;
}

/** 검토본 저장소를 로더의 검토본 목록으로 연다 */
export function createReviewedSource(store: PluginStore, logger: Logger): ReviewedSource {
  return {
    async list() {
      const entries: ReviewedSourceEntry[] = [];
      const diagnostics: ReviewedSourceDiagnostic[] = [];
      const keys = await store.names();
      if (!keys.ok) {
        logger.error("plugin.store.list_failed", { kind: keys.error.kind });
        return { entries, diagnostics };
      }
      // 키마다 현재 검토본을 읽고, 있는 것은 무결성을 맞춘다. 서로 독립이라 함께 읽는다
      const loaded = await Promise.all(
        keys.value.map(async (key): Promise<KeyRead | undefined> => {
          const parts = parseReviewKey(key);
          if (!parts.ok) {
            logger.error("plugin.store.key_invalid", { key });
            return undefined;
          }
          const current = await store.current(key);
          if (!current.ok || current.value === null) {
            return { key, parts: parts.value, current, integrity: null, manifest: undefined };
          }
          const integrity = await store.verifyIntegrity(key, current.value.contentHash);
          const manifest = integrity.ok
            ? await inferredManifestOf(current.value.treePath, parts.value.name)
            : undefined;
          return { key, parts: parts.value, current, integrity, manifest };
        }),
      );
      for (const item of loaded) {
        if (item === undefined) continue;
        if (!item.current.ok) {
          logger.error("plugin.store.current_failed", {
            key: item.key,
            kind: item.current.error.kind,
          });
          continue;
        }
        const version = item.current.value;
        if (version === null || item.integrity === null) continue;
        if (!item.integrity.ok) {
          if (item.integrity.error.kind !== "pinned_corrupt") {
            logger.error("plugin.store.integrity_failed", {
              key: item.key,
              kind: item.integrity.error.kind,
            });
            continue;
          }
          diagnostics.push({
            name: item.parts.name,
            source: version.meta.origin,
            code: "pinned_corrupt",
            message: `the reviewed copy of ${item.key} no longer matches its recorded hash; it is not loaded`,
          });
          continue;
        }
        entries.push({
          name: item.parts.name,
          source: version.meta.origin,
          root: version.treePath,
          contentHash: version.contentHash,
          ...(item.parts.projectId === null ? {} : { projectId: item.parts.projectId }),
          ...(item.manifest === undefined ? {} : { manifest: item.manifest }),
        });
      }
      return { entries, diagnostics };
    },
  };
}
