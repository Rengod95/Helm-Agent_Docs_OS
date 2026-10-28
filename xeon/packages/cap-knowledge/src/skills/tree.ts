import { basename, join } from "node:path";
import { err, ok, type Result } from "@xeon/contracts";
import { failure, fromFsError, type KnowledgeFailure } from "../errors.ts";
import type { KnowledgeFs } from "../fs/port.ts";
import { compareBytes, sha256Hex } from "../hash.ts";

// L2.knowledge.spec §4.2.3 트리 해시. 스킬 디렉터리 안 파일의 (상대 경로, 내용 sha256)을 경로 바이트 순으로 이은 문자열의
// sha256이다. 점으로 시작하는 항목(보관함 포함)과 일반 파일이 아닌 항목(심볼릭 링크 포함)은 넣지 않는다.

/** 스킬당 파일 수 상한(spec §4.2.2). 모델 출력 `files`도 500개가 상한이다 */
const MAX_TREE_FILES: number = 500;
/** 읽기·캡처가 받는 파일 하나의 상한. 쓰기 한도(1 MiB)와 달리 바깥에서 둔 큰 자원 파일을 받아들이는 여유다 */
const MAX_TREE_FILE_BYTES: number = 16 * 1024 * 1024;
/** 트리 전체 상한 */
const MAX_TREE_BYTES: number = 64 * 1024 * 1024;
const MAX_TREE_DEPTH = 8;

export interface TreeFile {
  /** 트리 루트 기준 `/` 구분 상대 경로 */
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** 경로 바이트 순으로 정렬된 파일 목록 */
export interface Tree {
  readonly files: readonly TreeFile[];
}

export function treeOf(files: readonly TreeFile[]): Tree {
  return { files: files.toSorted((a, b) => compareBytes(a.path, b.path)) };
}

export function treeHash(tree: Tree): string {
  const lines = tree.files.map((file) => `${file.path}\0${sha256Hex(file.bytes)}\n`);
  return sha256Hex(lines.join(""));
}

export function treeBytes(tree: Tree): number {
  return tree.files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
}

async function walk(
  fs: KnowledgeFs,
  dir: string,
  prefix: string,
  depth: number,
): Promise<Result<readonly string[], KnowledgeFailure>> {
  const listed = await fs.list(dir);
  if (!listed.ok) return err(fromFsError(listed.error, "list"));
  const parts = await Promise.all(
    listed.value.map(async (entry): Promise<Result<readonly string[], KnowledgeFailure>> => {
      if (entry.name.startsWith(".")) return ok([]);
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.kind === "file") return ok([relative]);
      if (entry.kind !== "directory") return ok([]);
      if (depth >= MAX_TREE_DEPTH) {
        return err(failure("limit_exceeded", `${join(dir, entry.name)}: nested too deeply`));
      }
      return walk(fs, join(dir, entry.name), relative, depth + 1);
    }),
  );
  const paths: string[] = [];
  for (const part of parts) {
    if (!part.ok) return part;
    paths.push(...part.value);
  }
  return ok(paths);
}

/** 파일 경로 목록을 한도 검사 뒤 읽는다. 크기는 읽기 전에 stat으로 본다 */
async function readFiles(
  fs: KnowledgeFs,
  root: string,
  paths: readonly string[],
): Promise<Result<Tree, KnowledgeFailure>> {
  if (paths.length > MAX_TREE_FILES) {
    return err(failure("limit_exceeded", `${root}: more than ${MAX_TREE_FILES} files`));
  }
  const stats = await Promise.all(paths.map((path) => fs.stat(join(root, path))));
  let total = 0;
  for (const [index, stat] of stats.entries()) {
    if (!stat.ok) return err(fromFsError(stat.error, "stat"));
    if (stat.value.size > MAX_TREE_FILE_BYTES) {
      return err(failure("limit_exceeded", `${paths[index] ?? root}: file is larger than 16 MiB`));
    }
    total += stat.value.size;
  }
  if (total > MAX_TREE_BYTES) {
    return err(failure("limit_exceeded", `${root}: files total more than 64 MiB`));
  }
  const reads = await Promise.all(paths.map((path) => fs.readFile(join(root, path))));
  const files: TreeFile[] = [];
  for (const [index, read] of reads.entries()) {
    if (!read.ok) return err(fromFsError(read.error, "read"));
    files.push({ path: paths[index] ?? "", bytes: read.value });
  }
  return ok(treeOf(files));
}

/** 스킬 디렉터리 트리를 읽는다. 디렉터리가 없으면 not_found */
export async function readDirTree(
  fs: KnowledgeFs,
  dir: string,
): Promise<Result<Tree, KnowledgeFailure>> {
  const paths = await walk(fs, dir, "", 0);
  if (!paths.ok) return paths;
  return readFiles(fs, dir, paths.value);
}

/** 단일 파일 스킬(루트 바로 아래 `.md`)의 트리: 파일 하나 */
export async function readSingleFileTree(
  fs: KnowledgeFs,
  filePath: string,
): Promise<Result<Tree, KnowledgeFailure>> {
  const read = await fs.readFile(filePath);
  if (!read.ok) return err(fromFsError(read.error, "read"));
  return ok(treeOf([{ path: basename(filePath), bytes: read.value }]));
}

/** 이름이 정해진 파일 몇 개의 트리(메모리 저장소). 없는 파일은 건너뛴다. 하나도 없으면 null */
export async function readNamedFiles(
  fs: KnowledgeFs,
  dir: string,
  names: readonly string[],
): Promise<Result<Tree | null, KnowledgeFailure>> {
  const reads = await Promise.all(names.map((name) => fs.readFile(join(dir, name))));
  const files: TreeFile[] = [];
  for (const [index, read] of reads.entries()) {
    if (read.ok) {
      files.push({ path: names[index] ?? "", bytes: read.value });
    } else if (read.error.kind !== "not_found") {
      return err(fromFsError(read.error, "read"));
    }
  }
  return ok(files.length === 0 ? null : treeOf(files));
}
