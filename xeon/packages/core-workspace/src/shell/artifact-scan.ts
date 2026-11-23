import {
  MAX_ARTIFACT_FILES,
  viewableKindOfPath,
  type ArtifactFileEntry,
} from "@fresnel/contracts/capabilities";
import type { CancelScope, WorkspaceEnv } from "@fresnel/contracts/services";

// 셸 산출물 훑기(AGE-77 S-08). `bash` 실행 앞뒤로 작업 폴더의 그려 볼 수 있는 파일을 모아 견주고, 새로 생기거나 바뀐 것을 낸다.
// 목록은 `listDir`이 주는 크기와 수정 시각만 쓴다(파일을 열지 않는다). 심볼릭 링크는 따라가지도 싣지도 않는다.
// 깊이, 파일 수, 시간 가운데 하나라도 넘으면 훑기를 포기한다(null). 일부만 맞는 목록을 내지 않으려는 것이다.

/** 파일이 보이는 깊이(마디 수). 작업 폴더 바로 아래 파일은 1, `a/b/c.svg`는 3 */
const SHELL_SCAN_MAX_DEPTH = 3;
/** 한 번 훑어 세는 파일 수 상한(확장자와 무관하게 센다). 넘으면 포기한다 */
const SHELL_SCAN_MAX_FILES = 5000;
/** 한 번 훑는 시간 상한(ms). 넘으면 포기한다 */
const SHELL_SCAN_TIMEOUT_MS = 1000;

/** 훑기 상한. 기본값은 위의 상수이고, 시험이 작은 값을 넣는다 */
export interface ShellScanLimits {
  readonly maxDepth: number;
  readonly maxFiles: number;
  readonly timeoutMs: number;
}

const SHELL_SCAN_LIMITS: ShellScanLimits = {
  maxDepth: SHELL_SCAN_MAX_DEPTH,
  maxFiles: SHELL_SCAN_MAX_FILES,
  timeoutMs: SHELL_SCAN_TIMEOUT_MS,
};

/** 파일 하나의 자취. 크기와 수정 시각이 같으면 바뀌지 않은 것이다 */
export interface ArtifactStamp {
  readonly size: number;
  readonly mtimeMs: number;
}

/** 절대 경로 → 자취. 그려 볼 수 있는 파일만 든다 */
export type ArtifactSnapshot = ReadonlyMap<string, ArtifactStamp>;

/** 훑지 않는 폴더: `node_modules`와 점으로 시작하는 폴더(`.git` 포함) */
function isSkippedFolder(name: string): boolean {
  return name === "node_modules" || name.startsWith(".");
}

/**
 * 작업 폴더 `root` 아래의 그려 볼 수 있는 파일을 모은다. `isProtected`가 참인 경로는 뺀다.
 * 기준 폴더를 못 읽거나, 상한을 넘거나, 시간이 다 되면 null이다(포기). 아래 폴더를 못 읽으면 그 폴더만 건너뛴다.
 */
export async function snapshotArtifacts(
  env: Pick<WorkspaceEnv, "listDir">,
  root: string,
  isProtected: (path: string) => boolean,
  limits: ShellScanLimits = SHELL_SCAN_LIMITS,
): Promise<ArtifactSnapshot | null> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), limits.timeoutMs);
  const expired = new Promise<null>((resolve) => {
    deadline.signal.addEventListener("abort", () => resolve(null), { once: true });
  });
  try {
    return await Promise.race([walk(env, root, isProtected, limits, deadline.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}

async function walk(
  env: Pick<WorkspaceEnv, "listDir">,
  root: string,
  isProtected: (path: string) => boolean,
  limits: ShellScanLimits,
  abortSignal: AbortSignal,
): Promise<ArtifactSnapshot | null> {
  const found = new Map<string, ArtifactStamp>();
  const scope: CancelScope = { abortSignal };
  const state = { files: 0 };
  // 한 층씩 내려간다. 한 층의 폴더는 함께 읽는다(list.ts와 같은 너비 우선). 상한을 넘거나 기준 폴더를 못 읽으면 false다
  const descend = async (level: readonly string[], depth: number): Promise<boolean> => {
    if (level.length === 0 || depth >= limits.maxDepth) return true;
    const listings = await Promise.all(level.map((dir) => env.listDir(dir, scope)));
    const next: string[] = [];
    for (const listed of listings) {
      if (!listed.ok) {
        if (depth === 0) return false;
        continue;
      }
      for (const entry of listed.value) {
        if (entry.kind === "symlink" || isProtected(entry.path)) continue;
        if (entry.kind === "directory") {
          if (!isSkippedFolder(entry.name)) next.push(entry.path);
          continue;
        }
        state.files += 1;
        if (state.files > limits.maxFiles) return false;
        if (viewableKindOfPath(entry.name) !== null) {
          found.set(entry.path, { size: entry.size, mtimeMs: entry.mtimeMs });
        }
      }
    }
    return descend(next, depth + 1);
  };
  return (await descend([root], 0)) ? found : null;
}

function byPath(
  [left]: readonly [string, ArtifactStamp],
  [right]: readonly [string, ArtifactStamp],
): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/**
 * 전후 목록을 견줘 새로 생긴 파일(`create`)과 크기나 수정 시각이 바뀐 파일(`modify`)을 경로순으로 낸다.
 * 목록은 `MAX_ARTIFACT_FILES`개까지이고, 넘는 뒤쪽은 뺀다.
 */
export function artifactChanges(
  before: ArtifactSnapshot,
  after: ArtifactSnapshot,
): ArtifactFileEntry[] {
  const changed: ArtifactFileEntry[] = [];
  for (const [path, stamp] of [...after].toSorted(byPath)) {
    const prior = before.get(path);
    const op =
      prior === undefined
        ? "create"
        : prior.size !== stamp.size || prior.mtimeMs !== stamp.mtimeMs
          ? "modify"
          : null;
    if (op !== null) {
      changed.push({ path, op, size: stamp.size, mtimeMs: stamp.mtimeMs });
      if (changed.length >= MAX_ARTIFACT_FILES) break;
    }
  }
  return changed;
}
