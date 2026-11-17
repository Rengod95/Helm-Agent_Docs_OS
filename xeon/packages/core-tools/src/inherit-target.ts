import { err, ok, type Result } from "@fresnel/contracts";
import type { JsonObject } from "@fresnel/contracts/conversation";
import type { FileSystem } from "@fresnel/contracts/services";

// hooks-core-boundary U-11: 승인 상속은 승인 카드가 사용자에게 보여 준 대상에만 쓴다. 경로는 대화의 작업 폴더 기준 실제 경로(링크를 푼
// 절대 경로)로 풀어 비교한다. 풀 수 없거나 작업 폴더 밖을 가리키면 상속하지 않는다.

/** 경로를 풀 때 쓰는 실행 환경의 파일 시스템 부분. 대화의 작업 폴더로 만든 env를 넘긴다 */
export type InheritPathEnv = Pick<
  FileSystem,
  "cwd" | "absolutePath" | "canonicalPath" | "fileInfo"
>;

/** 경로를 실제 경로로 풀 수 없다: 파일 시스템 오류, 파일이 아닌 부모, 끊긴 링크, 부모가 없는 경로 */
interface UnresolvedPath {
  readonly kind: "unresolved";
  readonly path: string;
}

const NO_CANCEL = { abortSignal: undefined };

/** 마지막 구분자로 부모와 이름을 나눈다. 드라이브 루트(`C:\`)와 루트(`/`)의 부모는 그 루트 자신이다 */
function splitLast(
  path: string,
): { readonly parent: string; readonly name: string; readonly sep: string } | undefined {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (index < 0) return undefined;
  const name = path.slice(index + 1);
  if (name === "") return undefined;
  const sep = path.charAt(index);
  const parent =
    index === 0 || path.charAt(index - 1) === ":" ? path.slice(0, index + 1) : path.slice(0, index);
  return { parent, name, sep };
}

function joinWith(parent: string, name: string, sep: string): string {
  return parent.endsWith(sep) ? `${parent}${name}` : `${parent}${sep}${name}`;
}

/** `root` 아래(root 자신은 아님)의 상대 경로. 아니면 undefined */
function within(root: string, path: string): string | undefined {
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!path.startsWith(prefix) || path.length === prefix.length) return undefined;
  return path.slice(prefix.length);
}

/**
 * 절대 경로를 실제 경로로 푼다. 있는 경로는 링크를 따라간 실제 경로다. 없는 경로는 존재하는 가장 가까운 부모까지 풀고 남은 이름을 잇는다.
 * 끊긴 링크(항목은 있는데 대상이 없다)는 대상을 알 수 없으므로 풀지 않는다
 */
async function realOf(
  env: InheritPathEnv,
  absolute: string,
): Promise<Result<string, UnresolvedPath>> {
  const unresolved: UnresolvedPath = { kind: "unresolved", path: absolute };
  const real = await env.canonicalPath(absolute, NO_CANCEL);
  if (real.ok) return ok(real.value);
  if (real.error.code !== "not_found") return err(unresolved);
  const entry = await env.fileInfo(absolute, NO_CANCEL);
  if (entry.ok || entry.error.code !== "not_found") return err(unresolved);
  const split = splitLast(absolute);
  if (split === undefined) return err(unresolved);
  const parent = await realOf(env, split.parent);
  if (!parent.ok) return parent;
  return ok(joinWith(parent.value, split.name, split.sep));
}

/** 입력 경로를 작업 폴더 기준으로 절대화한 뒤 실제 경로로 푼다 */
/** 경로가 가리키는 항목이 링크가 아닌 디렉터리인가(마지막 조각만 본다) */
async function isRealDirectory(env: InheritPathEnv, path: string): Promise<boolean> {
  const absolute = await env.absolutePath(path, NO_CANCEL);
  if (!absolute.ok) return false;
  const entry = await env.fileInfo(absolute.value, NO_CANCEL);
  return entry.ok && entry.value.kind === "directory";
}

/**
 * `..` 조각마다 그 앞의 경로가 존재하는 링크가 아닌 디렉터리여야 한다. 그래야 어휘적으로 지운 `..`가 OS의 해석과 같은 자리에 간다.
 * 앞 조각이 없거나, 파일이거나, 링크면 해석 결과가 안전하지 않으므로 상속하지 않는다
 */
async function dotdotIsSafe(env: InheritPathEnv, path: string): Promise<boolean> {
  const parts = path.split(/[\\/]/);
  const dotdots = parts.flatMap((part, index) => (part === ".." ? [index] : []));
  const verdicts = await Promise.all(
    dotdots.map((index) => isRealDirectory(env, parts.slice(0, index).join("/"))),
  );
  return verdicts.every((verdict) => verdict);
}

/** 입력 경로를 작업 폴더 기준으로 절대화한 뒤 실제 경로로 푼다. `..`가 안전하지 않으면 풀지 않는다 */
async function realOfPath(
  env: InheritPathEnv,
  path: string,
): Promise<Result<string, UnresolvedPath>> {
  const absolute = await env.absolutePath(path, NO_CANCEL);
  if (!absolute.ok || !(await dotdotIsSafe(env, path))) return err({ kind: "unresolved", path });
  return realOf(env, absolute.value);
}

/**
 * 카드에 실제 이름으로 올라 있는가. 보여 준 경로 `path`가 링크라면 그 실제 경로는 카드에 실제 이름으로 올라 있어야 한다(목록 밖의
 * 파일을 가리키는 링크는 카드가 보여 준 대상이 아니다). `real`은 `path`를 푼 실제 경로다
 */
async function namesItself(
  env: InheritPathEnv,
  path: string,
  real: string,
  workdir: string,
): Promise<boolean> {
  const absolute = await env.absolutePath(path, NO_CANCEL);
  if (!absolute.ok) return false;
  const lexical = within(env.cwd, absolute.value);
  if (lexical === undefined) return false;
  const sep = workdir.includes("\\") && !workdir.includes("/") ? "\\" : "/";
  return real === joinWith(workdir, lexical, sep);
}

/**
 * 쓰려는 경로 `input`이 보여 준 경로 `shown` 가운데 하나와 같은 실제 파일을 가리키고, 그 실제 파일이 보여 준 목록에 실제 이름으로
 * 올라 있으며, 작업 폴더 안에 있는가. 어느 경로든 풀 수 없으면 아니다.
 * [제안 기본값] 카드가 실제 경로로 올린 파일을 링크로 가리키는 쓰기는 같은 대상이므로 지난다.
 */
async function sameTarget(
  env: InheritPathEnv,
  input: string,
  shown: readonly string[],
): Promise<boolean> {
  if (input === "") return false;
  const workdir = await realOfPath(env, env.cwd);
  if (!workdir.ok) return false;
  const target = await realOfPath(env, input);
  if (!target.ok || within(workdir.value, target.value) === undefined) return false;
  const matches = await Promise.all(
    shown.map(async (path) => {
      if (path === "") return false;
      const real = await realOfPath(env, path);
      if (!real.ok || real.value !== target.value) return false;
      return namesItself(env, path, real.value, workdir.value);
    }),
  );
  return matches.includes(true);
}

function pathOf(input: JsonObject): string | undefined {
  const value = input["path"];
  return typeof value === "string" ? value : undefined;
}

/** 쓰기 입력의 `path`가 검토 카드가 보여 준 파일 목록 가운데 같은 실제 파일을 가리키는가 */
export async function pathInCard(
  env: InheritPathEnv,
  input: JsonObject,
  files: readonly { readonly path: string }[],
): Promise<boolean> {
  const path = pathOf(input);
  if (path === undefined) return false;
  return sameTarget(
    env,
    path,
    files.map((file) => file.path),
  );
}

/** 안쪽 호출의 `path`가 바깥 도구 호출 인자가 카드에 보여 준 `path`와 같은 실제 파일을 가리키는가 */
export async function samePathAsOuter(
  env: InheritPathEnv,
  inner: JsonObject,
  outer: JsonObject,
): Promise<boolean> {
  const path = pathOf(inner);
  const shown = pathOf(outer);
  if (path === undefined || shown === undefined) return false;
  return sameTarget(env, path, [shown]);
}
