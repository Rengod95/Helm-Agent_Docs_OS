import {
  matchProtectedPath,
  type CancelScope,
  type ExecutionEnv,
  type ProtectedPathEntry,
} from "@xeon/contracts/services";
import { WorkspaceFailure } from "./errors.ts";
import { getOrThrow } from "./upstream/get-or-throw.ts";
import {
  normalizeToolPath,
  resolveReadToolPath,
  resolveToolPath,
} from "./files/upstream/path-utils.ts";

// L2.workspace.spec §4.3 경로 해석과 탈출 검사. 단계 1~3은 포크한 path-utils, 4~6은 이 파일이 한다.

export type PathAccess = "read" | "write";

/** 허용 root. 정규 경로(심볼릭 링크를 푼 절대 경로) 목록 */
export interface AllowedRoots {
  readonly read: readonly string[];
  readonly write: readonly string[];
}

export interface RootsDeps {
  readonly env: Pick<ExecutionEnv, "absolutePath" | "canonicalPath" | "exists">;
  /**
   * 허용 root를 돌려준다. 허용 root 조회 API는 L1.tools.spec이 정한다(L2.workspace.spec §10 미결 7).
   * 그 전에는 읽기·쓰기 root 모두 `defaultRoots`가 만든 세션 cwd 하나다.
   */
  readonly roots: (context: CancelScope) => Promise<AllowedRoots>;
  /** L0.sandbox 보호 경로 목록. 샌드박스 서비스가 없으면 빈 목록 */
  readonly protectedPaths: () => readonly ProtectedPathEntry[];
}

export interface ResolvedPath {
  /** 입력 경로 그대로 */
  readonly requested: string;
  /** 접근에 쓸 정규 경로. 아직 없는 대상이면 존재하는 가장 가까운 상위의 정규 경로에 나머지 마디를 붙인 값 */
  readonly canonical: string;
  readonly exists: boolean;
}

/** M1의 허용 root: 읽기·쓰기 모두 `env.cwd`의 정규 경로 하나 */
export async function defaultRoots(
  env: Pick<ExecutionEnv, "cwd" | "canonicalPath">,
  context: CancelScope,
): Promise<AllowedRoots> {
  const root = getOrThrow(await env.canonicalPath(env.cwd, context));
  return { read: [root], write: [root] };
}

function segmentsOf(path: string): string[] {
  return path.split(/[\\/]+/).filter((segment) => segment !== "");
}

/** 경로 마디 단위 포함 검사. 문자열 접두 비교를 쓰지 않는다(`/a/bc`는 `/a/b` 안이 아니다) */
export function isWithin(root: string, path: string): boolean {
  const rootSegments = segmentsOf(root);
  const pathSegments = segmentsOf(path);
  if (pathSegments.length < rootSegments.length) return false;
  return rootSegments.every((segment, index) => pathSegments[index] === segment);
}

function separatorOf(path: string): string {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

function joinSegments(base: string, rest: readonly string[]): string {
  if (rest.length === 0) return base;
  const separator = separatorOf(base);
  return base.endsWith(separator)
    ? base + rest.join(separator)
    : base + separator + rest.join(separator);
}

/** 절대 경로를 접두(`/` 또는 `C:\`)와 마디로 나눈다 */
function splitAbsolute(path: string): { readonly prefix: string; readonly segments: string[] } {
  const match = /^(?:[A-Za-z]:)?[\\/]/.exec(path);
  const prefix = match === null ? "" : match[0];
  return { prefix, segments: segmentsOf(path.slice(prefix.length)) };
}

/** `ExecutionEnv.canonicalPath`가 "없음"으로 말하는 오류인가(올라가며 찾는다) */
function isMissing(code: string): boolean {
  return code === "not_found" || code === "not_directory";
}

/** 존재하는 가장 가까운 상위의 정규 경로를 찾아 나머지 마디를 붙인다. 재귀로 올라간다 */
async function climb(
  env: Pick<ExecutionEnv, "canonicalPath">,
  prefix: string,
  segments: readonly string[],
  keep: number,
  context: CancelScope,
): Promise<string | undefined> {
  if (keep < 0) return undefined;
  const candidate =
    keep === 0 && prefix !== "" ? prefix : joinSegments(prefix, segments.slice(0, keep));
  const found = await env.canonicalPath(candidate, context);
  if (found.ok) return joinSegments(found.value, segments.slice(keep));
  if (!isMissing(found.error.code)) throw found.error;
  return climb(env, prefix, segments, keep - 1, context);
}

function denied(
  reason: "outside_root" | "protected_path" | "parent_traversal",
  requested: string,
  resolved: string,
  extra: Readonly<Record<string, string>> = {},
): WorkspaceFailure {
  const message =
    reason === "outside_root"
      ? `Access to ${requested} is denied: it is outside the allowed directories.`
      : reason === "protected_path"
        ? `Access to ${requested} is denied: it is a protected path.`
        : `Access to ${requested} is denied: a missing path segment contains "..".`;
  return new WorkspaceFailure("denied", message, {
    detail: { reason, requested, resolved, ...extra },
  });
}

/**
 * 모델과 그룹 코드가 넘긴 경로를 접근에 쓸 정규 경로로 해석한다(spec §4.3). 위반은 `denied`(WorkspaceFailure)다.
 * 접근은 돌려준 `canonical`로 해야 한다. 검사한 경로와 연 경로가 달라지는 틈(`..`의 어휘적 해석 차이)을 없앤다.
 */
export async function resolveWorkspacePath(
  deps: RootsDeps,
  requested: string,
  access: PathAccess,
  context: CancelScope,
  options: { readonly variants?: boolean } = {},
): Promise<ResolvedPath> {
  const absolute =
    access === "read" && options.variants === true
      ? await resolveReadToolPath(deps.env, requested, context)
      : await resolveToolPath(deps.env, requested, context);

  const direct = await deps.env.canonicalPath(absolute, context);
  let canonical: string;
  let exists = true;
  if (direct.ok) {
    canonical = direct.value;
  } else {
    if (!isMissing(direct.error.code)) throw direct.error;
    const { prefix, segments } = splitAbsolute(absolute);
    const climbed = await climb(deps.env, prefix, segments, segments.length - 1, context);
    if (climbed === undefined) throw direct.error;
    canonical = climbed;
    exists = false;
    // 아직 없는 마디에 `..`가 있으면 어디를 가리킬지 알 수 없다. 거부한다(spec §4.3 4번)
    if (segmentsOf(normalizeToolPath(requested)).includes("..")) {
      throw denied("parent_traversal", requested, canonical);
    }
  }

  const roots = await deps.roots(context);
  const allowed = access === "write" ? roots.write : roots.read;
  if (!allowed.some((root) => isWithin(root, canonical))) {
    throw denied("outside_root", requested, canonical);
  }
  const protectedEntry = matchProtectedPath(deps.protectedPaths(), canonical, access);
  if (protectedEntry !== undefined) {
    throw denied("protected_path", requested, canonical, { protectedBy: protectedEntry.reason });
  }
  return { requested, canonical, exists };
}
