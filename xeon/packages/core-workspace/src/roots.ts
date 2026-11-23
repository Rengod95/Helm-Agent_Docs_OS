import {
  matchProtectedPath,
  type AllowedRoots,
  type CancelScope,
  type ExecutionEnv,
  type PathAccess,
  type ResolvedPath,
  type RootsDeps,
  type ToolOutputFiles,
} from "@fresnel/contracts/services";
import { WorkspaceFailure } from "@fresnel/contracts/capabilities";
import { getOrThrow } from "./upstream/get-or-throw.ts";
import {
  normalizeToolPath,
  resolveReadToolPath,
  resolveToolPath,
} from "./files/upstream/path-utils.ts";

// L2.workspace.spec §4.3 경로 해석과 탈출 검사. 단계 1~3은 포크한 path-utils, 4~6은 이 파일이 한다.
// 경로 타입의 모양은 F(`@fresnel/contracts/services`)가 정의하고, 이 파일은 기존 경로로 다시 내보낸다.

export type { AllowedRoots, PathAccess, ResolvedPath, RootsDeps };

/**
 * 보통 대화의 쓰기 root에 더하는 루트. 쓰기 범위 제한이 없다는 뜻이다 [결정: 2026-11-20, 사용자, AGE-63 "쓰기도 풀기"].
 * 거부는 보호 경로(Fresnel 자신의 항목과 사용자가 더한 곳)뿐이다. 작업 폴더를 앞에 둬서 `relativeToRoots`가 작업 폴더 기준 상대 경로를 돌려준다
 */
export const WRITE_ANYWHERE = "/";

/** 보통 대화의 허용 root: 읽기는 `env.cwd`의 정규 경로(와 출력 사본), 쓰기는 그 경로와 `/`(제한 없음) */
export async function defaultRoots(
  env: Pick<ExecutionEnv, "cwd" | "canonicalPath">,
  context: CancelScope,
  outputs?: ToolOutputFiles,
): Promise<AllowedRoots> {
  const root = getOrThrow(await env.canonicalPath(env.cwd, context));
  if (outputs === undefined) return { read: [root], write: [root, WRITE_ANYWHERE] };
  return {
    read: [root, await spillReadRoot(env, outputs, context)],
    write: [root, WRITE_ANYWHERE],
  };
}

/**
 * 테스트 대화의 허용 root(M5c §4.8.7). 묶인 플러그인의 원본 폴더 `folder`가 읽기·쓰기 root 하나이고, 출력 사본 폴더는 읽기 root만이다.
 * `folder`가 null이면(아직 묶이지 않았다) 쓰기 root가 없다. 원본 폴더가 아직 없어도 쓰기 root가 없다(빌더가 만든 뒤부터 생긴다).
 */
export async function craftRoots(
  env: Pick<ExecutionEnv, "canonicalPath">,
  context: CancelScope,
  folder: string | null,
  outputs?: ToolOutputFiles,
): Promise<AllowedRoots> {
  const spill = outputs === undefined ? [] : [await spillReadRoot(env, outputs, context)];
  if (folder === null) return { read: spill, write: [] };
  const canonical = await env.canonicalPath(folder, context);
  if (!canonical.ok) return { read: spill, write: [] };
  return { read: [canonical.value, ...spill], write: [canonical.value] };
}

// 출력 사본의 읽기 root. 사본 폴더(`spill/tool-output`)의 부모인 `spill/` 전체다: bash가 넘친 출력도 `read`·`grep`으로 읽힌다.
// 폴더가 아직 없으면(첫 사본 전) 설정된 경로 그대로 둔다. 읽기 직전 복원이 폴더를 만든다
async function spillReadRoot(
  env: Pick<ExecutionEnv, "canonicalPath">,
  outputs: ToolOutputFiles,
  context: CancelScope,
): Promise<string> {
  const spill = parentOf(outputs.dir);
  const canonical = await env.canonicalPath(spill, context);
  return canonical.ok ? canonical.value : spill;
}

/** 마지막 마디를 뺀 부모 경로. 구분자는 `/`와 `\\` 둘 다 본다 */
function parentOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut <= 0 ? trimmed : trimmed.slice(0, cut);
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
 * 프로젝트 없는 대화의 기본 작업 폴더(`<데이터>/default-project/<threadId>`)는 Fresnel 데이터 폴더 안에 있다.
 * 그 대화 자신의 작업 폴더(첫 root) 안만 `fresnel_data` 거부에서 뺀다. 다른 대화의 폴더와 데이터 폴더의 나머지는 그대로 막힌다.
 */
function isOwnDefaultFolder(
  entry: { readonly path: string; readonly reason: string },
  roots: AllowedRoots,
  canonical: string,
): boolean {
  if (entry.reason !== "fresnel_data") return false;
  const own = roots.read[0];
  if (own === undefined || !isWithin(own, canonical)) return false;
  const base = `${entry.path.replace(/[\\/]+$/, "")}/default-project`;
  return own !== base && isWithin(base, own);
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
  options: {
    readonly variants?: boolean;
  } = {},
): Promise<ResolvedPath> {
  const absolute =
    access === "read" && options.variants === true
      ? await resolveReadToolPath(deps.env, requested, context)
      : await resolveToolPath(deps.env, requested, context);

  if (access === "read" && deps.outputs !== undefined) {
    // 안내에 적힌 사본 경로가 재시작이나 정리 뒤에 죽은 경로가 되지 않게, 읽으려는 순간 blob에서 되살린다
    // 되살리지 못하면(blob이 지워졌다 등) 사본이 없는 것과 같다. 아래 not_found 경로가 말한다
    await deps.outputs.restore(absolute);
  }
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
  const protectedEntries = deps.protectedPaths([...roots.read, ...roots.write]);
  const protectedEntry = matchProtectedPath(protectedEntries, canonical, access);
  if (!allowed.some((root) => isWithin(root, canonical))) {
    throw denied("outside_root", requested, canonical);
  }
  if (protectedEntry !== undefined && !isOwnDefaultFolder(protectedEntry, roots, canonical)) {
    throw denied("protected_path", requested, canonical, { protectedBy: protectedEntry.reason });
  }
  return { requested, canonical, exists };
}

/** `path`가 들어 있는 root 기준 상대 경로(`/` 구분). 어느 root에도 없으면 앞의 구분자만 뗀 경로 */
export function relativeToRoots(roots: readonly string[], path: string): string {
  const root = roots.find((candidate) => isWithin(candidate, path));
  const rootLength = root === undefined ? 0 : segmentsOf(root).length;
  return segmentsOf(path).slice(rootLength).join("/");
}
