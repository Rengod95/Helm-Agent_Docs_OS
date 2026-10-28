import { join, sep } from "node:path";
import { attemptAsync } from "@xeon/contracts";
import type {
  ExtensionEntry,
  ExtensionManifest,
  LoaderFs,
  LoaderPaths,
} from "@xeon/contracts/extensions";
import { BUILTIN_LAYER_ORDER, type OrderKey } from "./load-order.ts";
import { eachInOrder } from "../primitives/sequence.ts";
import type { LoadDiagnostic } from "./pipeline.ts";
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

export interface ExtensionCandidate {
  readonly source: InstallSource;
  /** 확장 루트 절대 경로(심볼릭 링크를 푼 경로). 내장은 null */
  readonly root: string | null;
  /** `.xeon-plugin/plugin.json` 절대 경로. 내장은 null */
  readonly manifestPath: string | null;
  /** 내장만 */
  readonly builtin: BuiltinExtensionModule | null;
}

/** 내장 모듈 목록 → 후보(X.loading-trust.spec §4.2.1). 외부 위치 탐색은 `discoverExternal`이다 */
export function candidatesFromBuiltins(
  builtins: readonly BuiltinExtensionModule[],
): readonly ExtensionCandidate[] {
  return builtins.map((module) => ({
    source: "builtin",
    root: null,
    manifestPath: null,
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

/** 외부 확장의 매니페스트 위치. 확장 루트 기준 상대 경로다 */
export const MANIFEST_RELATIVE_PATH: string = join(".xeon-plugin", "plugin.json");

/** 프로젝트 확장 디렉터리. 프로젝트 루트 기준 상대 경로다(X.loading-trust.spec §4.2.1) */
export const PROJECT_EXTENSIONS_DIR: string = join(".xeon", "extensions");

export interface ExternalLocation {
  readonly source: Exclude<InstallSource, "builtin">;
  /** `extensions/` 디렉터리. 아래 한 단계의 디렉터리마다 후보 하나다 */
  readonly dir: string;
}

/** 설치 위치별 탐색 디렉터리. 프로젝트 루트는 신뢰가 허용된 뒤에만 넘긴다 */
export function externalLocations(input: {
  readonly paths: LoaderPaths;
  readonly extraPaths: readonly string[];
  readonly projectRoot: string | null;
  /** 탐색할 위치 종류. 생략하면 managed, user, project 모두 */
  readonly sources?: readonly ExternalLocation["source"][];
}): readonly ExternalLocation[] {
  const wanted = input.sources ?? ["managed", "user", "project"];
  const locations: ExternalLocation[] = [];
  if (wanted.includes("managed") && input.paths.managedDir !== null) {
    locations.push({ source: "managed", dir: join(input.paths.managedDir, "extensions") });
  }
  if (wanted.includes("user")) {
    locations.push({ source: "user", dir: join(input.paths.userDir, "extensions") });
    for (const extra of input.extraPaths) locations.push({ source: "user", dir: extra });
  }
  if (wanted.includes("project") && input.projectRoot !== null) {
    locations.push({ source: "project", dir: join(input.projectRoot, PROJECT_EXTENSIONS_DIR) });
  }
  return locations;
}

function discoverWarning(source: InstallSource, message: string, path: string): LoadDiagnostic {
  return {
    extension: null,
    source,
    stage: "discover",
    severity: "warning",
    code: "manifest_missing",
    message,
    path,
    generation: 0,
  };
}

/**
 * 외부 확장 탐색(X.loading-trust.spec §4.2.1). 위치마다 `<dir>/<이름>/.xeon-plugin/plugin.json`이 있는 디렉터리를
 * 후보로 만든다. 깊이는 한 단계다. 매니페스트가 없는 디렉터리는 `manifest_missing` 경고만 남기고 건너뛴다.
 * 심볼릭 링크는 `realpath`로 풀고 같은 실제 경로는 한 번만 후보가 된다. 매니페스트 내용은 읽지 않는다.
 * 결과는 위치 순서, 이름의 코드 포인트 순이라 파일 시스템 나열 순서와 무관하다
 */
export async function discoverExternal(
  fs: LoaderFs,
  locations: readonly ExternalLocation[],
): Promise<{
  readonly candidates: readonly ExtensionCandidate[];
  readonly diagnostics: readonly LoadDiagnostic[];
}> {
  const candidates: ExtensionCandidate[] = [];
  const diagnostics: LoadDiagnostic[] = [];
  const seen = new Set<string>();

  async function visit(
    source: ExternalLocation["source"],
    declared: string,
    base: string | null,
  ): Promise<"continue"> {
    const resolved = await attemptAsync(() => fs.realpath(declared));
    if (!resolved.ok) {
      diagnostics.push(discoverWarning(source, `cannot resolve ${declared}`, declared));
      return "continue";
    }
    const root = resolved.value;
    // 저장소가 담은 프로젝트 확장은 심볼릭 링크로 `.xeon/extensions` 밖을 가리킬 수 없다
    if (base !== null && !root.startsWith(base.endsWith(sep) ? base : `${base}${sep}`)) {
      diagnostics.push(discoverWarning(source, `${declared} resolves outside ${base}`, declared));
      return "continue";
    }
    if (seen.has(root)) return "continue";
    seen.add(root);
    const manifestPath = join(root, MANIFEST_RELATIVE_PATH);
    const present = await attemptAsync(() => fs.exists(manifestPath));
    if (present.ok && present.value) {
      candidates.push({ source, root, manifestPath, builtin: null });
    } else {
      diagnostics.push(
        discoverWarning(source, `${declared} has no ${MANIFEST_RELATIVE_PATH}`, declared),
      );
    }
    return "continue";
  }

  // 위치와 이름 순서가 결과 순서이므로 하나씩 차례로 본다
  await eachInOrder(locations, async (location) => {
    const listed = await attemptAsync(() => fs.listDir(location.dir));
    if (!listed.ok) {
      diagnostics.push(
        discoverWarning(location.source, `cannot list ${location.dir}`, location.dir),
      );
      return "continue";
    }
    const names = (listed.value ?? [])
      // 점으로 시작하는 디렉터리(`.staging` 등)는 확장이 아니다
      .filter(
        (entry) =>
          (entry.kind === "dir" || entry.kind === "symlink") && !entry.name.startsWith("."),
      )
      .map((entry) => entry.name)
      .toSorted((a, b) => (a === b ? 0 : a < b ? -1 : 1));
    let base: string | null = null;
    if (location.source === "project") {
      const resolvedBase = await attemptAsync(() => fs.realpath(location.dir));
      if (!resolvedBase.ok) return "continue";
      base = resolvedBase.value;
    }
    const containing = base;
    await eachInOrder(names, (name) =>
      visit(location.source, join(location.dir, name), containing),
    );
    return "continue";
  });
  return { candidates, diagnostics };
}
