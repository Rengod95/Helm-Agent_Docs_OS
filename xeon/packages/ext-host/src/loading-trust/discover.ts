import type { ExtensionEntry, ExtensionManifest } from "@xeon/contracts/extensions";
import { BUILTIN_LAYER_ORDER, type OrderKey } from "./load-order.ts";
import type { InstallSource } from "./trust/levels.ts";

export type { LoaderFs, LoaderPaths } from "@xeon/contracts/extensions";

/** 내장 패키지(core-*, cap-*, group-*)가 export하는 확장 모듈. 조립 루트(L4 host)가 목록을 넘긴다 */
export interface BuiltinExtensionModule {
  readonly manifest: ExtensionManifest;
  /** 엔트리. 내장 패키지는 named export `extension`으로 둔다 */
  readonly extension: ExtensionEntry;
  /** 참이면 이 확장의 로드 실패가 시작 실패다. 기본 false */
  readonly essential?: boolean;
}

export type CandidateOrigin = "manifest" | "pi";

export interface ExtensionCandidate {
  readonly source: InstallSource;
  readonly origin: CandidateOrigin;
  /** 확장 루트 절대 경로. 내장은 null */
  readonly root: string | null;
  /** `.xeon-plugin/plugin.json` 절대 경로. 내장과 pi 확장은 null */
  readonly manifestPath: string | null;
  /** pi 확장의 엔트리 파일 절대 경로. 그 밖에는 null */
  readonly piEntryPath: string | null;
  /** 내장만 */
  readonly builtin: BuiltinExtensionModule | null;
}

/** 내장 모듈 목록 → 후보(X.loading-trust.spec §4.2.1). 외부 위치 탐색은 M2다 */
export function candidatesFromBuiltins(
  builtins: readonly BuiltinExtensionModule[],
): readonly ExtensionCandidate[] {
  return builtins.map((module) => ({
    source: "builtin",
    origin: "manifest",
    root: null,
    manifestPath: null,
    piEntryPath: null,
    builtin: module,
  }));
}

/** 내장 후보의 순서 키. 층 값이 표에 없으면 plugin 뒤로 둔다 */
export function orderKeyOfBuiltin(manifest: ExtensionManifest): OrderKey {
  const index = BUILTIN_LAYER_ORDER.indexOf(manifest.layer);
  return {
    source: "builtin",
    layerIndex: index < 0 ? BUILTIN_LAYER_ORDER.length : index,
    name: manifest.name,
  };
}
