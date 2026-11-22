import { mkdir, readdir, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { attemptAsync, err, ok, type Result } from "@fresnel/contracts";
import type { DevkitError } from "@fresnel/contracts/services";
import { io, mapAll, refusal } from "./errors.ts";
import { MANIFEST_PATH } from "./validate.ts";

// 떼기(members-detach.ts)와 합치기(members-merge.ts)가 새 폴더(`outDir`)에 쓰는 공용 부분(AGE-33).
// 출력 폴더를 검사하고, 계획한 파일을 쓰고, 중간에 실패하면 우리가 쓴 파일과 만든 폴더만 지운다.
// 원본 폴더는 읽기만 하므로 이 모듈은 건드리지 않는다. 매니페스트는 파일 목록의 마지막에 쓴다.

/** 계획한 파일 하나. `path`는 새 폴더 기준 상대 경로이고 `bytes`는 쓸 내용이다 */
export interface PlannedFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/**
 * 출력 폴더 검사. 원본 폴더 가운데 하나를 포함하거나 그 안에 있으면 거절하고, 이미 있으면 빈 폴더여야 한다.
 * 없는 폴더는 괜찮다(쓸 때 만든다). 설치본이나 저장소 폴더 거절은 포트가 한다
 */
export async function checkOutDir(
  outDir: string,
  sourceDirs: readonly string[],
): Promise<Result<void, DevkitError>> {
  const inside = sourceDirs.find((dir) => isInside(dir, outDir));
  if (inside !== undefined)
    return err(
      refusal("out_dir_inside_source", "outDir", `outDir is inside the source folder ${inside}`),
    );
  const found = await io(outDir, () => stat(outDir));
  if (!found.ok) return found.error.kind === "not_found" ? ok(undefined) : found;
  if (!found.value.isDirectory())
    return err(refusal("out_dir_not_folder", "outDir", `${outDir} is not a folder`));
  const children = await io(outDir, () => readdir(outDir));
  if (!children.ok) return children;
  return children.value.length === 0
    ? ok(undefined)
    : err(refusal("out_dir_not_empty", "outDir", `${outDir} is not empty`));
}

/**
 * 계획한 파일을 새 폴더에 쓴다. 없는 폴더는 얕은 것부터 만들고(있던 폴더는 건드리지 않는다), 매니페스트는 마지막에 쓴다.
 * 중간에 실패하면 우리가 쓴 파일과 만든 폴더만 지운다. 지우지 못한 것은 오류 글에 남긴다
 */
export async function writeOutDir(
  outDir: string,
  files: readonly PlannedFile[],
): Promise<Result<void, DevkitError>> {
  const fresh = await freshDirs(outDir, files);
  if (!fresh.ok) return fresh;
  const ordered = [
    ...files.filter((file) => file.path !== MANIFEST_PATH),
    ...files.filter((file) => file.path === MANIFEST_PATH),
  ];
  const made: string[] = [];
  const wrote: string[] = [];
  const failure = await writeSteps(outDir, fresh.value, ordered, made, wrote);
  if (failure === undefined) return ok(undefined);
  return err(await failedWith(failure, outDir, wrote, made));
}

/** `inner`이 `outer`와 같거나 그 안에 있는가. 이름만 접두로 같은 형제 폴더는 안이 아니다 */
function isInside(outer: string, inner: string): boolean {
  const rel = relative(outer, inner);
  return rel === "" || (rel.split(sep)[0] !== ".." && !isAbsolute(rel));
}

/**
 * 만들어야 할 폴더 가운데 아직 없는 것. `outDir`과 그 위의 폴더, 파일이 들어갈 하위 폴더를 낸다.
 * 얕은 것부터 돌려주므로 차례로 만들면 된다. 있는 폴더가 파일이면 `out_dir_not_folder`로 거절한다
 */
async function freshDirs(
  outDir: string,
  files: readonly PlannedFile[],
): Promise<Result<string[], DevkitError>> {
  const dirs = new Set<string>([outDir, ...ancestorsOf(outDir)]);
  for (const file of files) {
    const parts = file.path.split("/");
    for (let depth = 1; depth < parts.length; depth += 1)
      dirs.add(join(outDir, ...parts.slice(0, depth)));
  }
  const ordered = [...dirs].toSorted((left, right) => left.length - right.length);
  const existing = await mapAll(ordered, existingFolder);
  if (!existing.ok) return existing;
  return ok(ordered.filter((_, index) => existing.value[index] !== true));
}

/** 폴더가 있는가. 없으면 거짓이고, 있는데 폴더가 아니면 거절한다 */
async function existingFolder(dir: string): Promise<Result<boolean, DevkitError>> {
  const found = await io(dir, () => stat(dir));
  if (!found.ok) return found.error.kind === "not_found" ? ok(false) : found;
  return found.value.isDirectory()
    ? ok(true)
    : err(refusal("out_dir_not_folder", "outDir", `${dir} is not a folder`));
}

/** 경로의 위쪽 폴더들(가까운 것부터). 루트는 넣지 않는다 */
function ancestorsOf(path: string): string[] {
  const up: string[] = [];
  for (let at = dirname(path); at !== dirname(at); at = dirname(at)) up.push(at);
  return up;
}

/**
 * 폴더를 만들고 파일을 쓴다. 처음 실패에서 멈추고 그 오류를 돌려준다. 만든 폴더는 `made`에, 쓰려고 기록한 파일은 `wrote`에 남긴다.
 * 파일은 쓰기 전에 기록하므로 쓰다 실패해 생긴 부분 파일도 지운다
 */
async function writeSteps(
  outDir: string,
  dirs: readonly string[],
  files: readonly PlannedFile[],
  made: string[],
  wrote: string[],
): Promise<DevkitError | undefined> {
  for (const dir of dirs) {
    // oxlint-disable-next-line no-await-in-loop -- 폴더는 얕은 것부터 차례로 만든다 (eng.typescript.guide TY-22)
    const done = await io(dir, () => mkdir(dir));
    if (!done.ok) return done.error;
    made.push(dir);
  }
  for (const file of files) {
    const target = join(outDir, file.path);
    wrote.push(target);
    // oxlint-disable-next-line no-await-in-loop -- 파일은 계획한 순서대로 쓴다 (eng.typescript.guide TY-22)
    const done = await io(file.path, () => writeFile(target, file.bytes));
    if (!done.ok) return done.error;
  }
  return undefined;
}

/** 실패 오류 글. 지우지 못한 파일과 폴더를 새 폴더 기준으로 알린다 */
async function failedWith(
  error: DevkitError,
  outDir: string,
  wrote: readonly string[],
  made: readonly string[],
): Promise<DevkitError> {
  const leftovers = await undo(wrote, made);
  if (leftovers.length === 0) return error;
  const kept = leftovers.map((path) => relative(outDir, path) || ".");
  return {
    ...error,
    message: `${error.message}; kept because they could not be removed: ${kept.join(", ")}`,
  };
}

/** 우리가 쓴 파일을 지우고, 우리가 만든 폴더를 안쪽부터 비울 때만 지운다. 지우지 못한 경로를 돌려준다 */
async function undo(wrote: readonly string[], made: readonly string[]): Promise<string[]> {
  const removed = await Promise.all(
    wrote.map(async (path) =>
      (await attemptAsync(() => rm(path, { force: true }))).ok ? undefined : path,
    ),
  );
  const leftovers = removed.filter((path): path is string => path !== undefined);
  for (const dir of made.toReversed()) {
    // oxlint-disable-next-line no-await-in-loop -- 폴더는 안쪽부터 지워야 한다 (eng.typescript.guide TY-22)
    const gone = await attemptAsync(() => rmdir(dir));
    if (!gone.ok) leftovers.push(dir);
  }
  return leftovers;
}
