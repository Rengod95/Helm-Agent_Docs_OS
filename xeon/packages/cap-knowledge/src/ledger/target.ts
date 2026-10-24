import { basename, dirname, join } from "node:path";
import { err, ok, eachAsync, type Clock, type Result } from "@xeon/contracts";
import { failure, fromFsError, type KnowledgeFailure } from "../errors.ts";
import type { KnowledgeFs } from "../fs/port.ts";
import { sha256Hex } from "../hash.ts";
import { readDirTree, readNamedFiles, treeHash, type Tree } from "../skills/tree.ts";
import type { LedgerTargetRef } from "./rows.ts";

// 변경 대상(스킬 디렉터리 또는 메모리 저장소 파일)의 읽기, 해시, 새 내용 반영. 원장 실행기와 롤백이 같이 쓴다.

const MAX_ARCHIVE_SUFFIX = 98;

export type ChangeTarget = LedgerTargetRef;

/** 대상이 없으면 null. 스킬 디렉터리가 없거나 메모리 파일이 없는 경우다 */
export async function readTarget(
  fs: KnowledgeFs,
  target: ChangeTarget,
): Promise<Result<Tree | null, KnowledgeFailure>> {
  if (target.kind === "memory") {
    return readNamedFiles(fs, dirname(target.path), [basename(target.path)]);
  }
  const tree = await readDirTree(fs, target.path);
  if (tree.ok) return tree;
  if (tree.error.kind === "not_found") return ok(null);
  return tree;
}

/** 스킬은 트리 해시, 메모리는 파일 내용 해시. 대상이 없으면 null */
export function hashOfTarget(kind: "skill" | "memory", tree: Tree | null): string | null {
  if (tree === null) return null;
  if (kind === "skill") return treeHash(tree);
  const file = tree.files[0];
  return file === undefined ? null : sha256Hex(file.bytes);
}

/** 보관함 디렉터리 이름에 쓰는 UTC 시각 `20261024T031500Z` */
function utcStamp(clock: Clock): string {
  return new Date(clock.now())
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}

function archivePath(target: ChangeTarget, clock: Clock): string {
  return join(dirname(target.path), ".archive", `${target.name}-${utcStamp(clock)}`);
}

async function writeFiles(
  fs: KnowledgeFs,
  root: string,
  current: Tree | null,
  next: Tree,
): Promise<Result<void, KnowledgeFailure>> {
  const before = new Map(current?.files.map((file) => [file.path, file.bytes]));
  const stopped = await eachAsync(next.files, async (file) => {
    const old = before.get(file.path);
    if (old !== undefined && Buffer.compare(old, file.bytes) === 0) return undefined;
    const target = join(root, file.path);
    const made = await fs.mkdirp(dirname(target));
    if (!made.ok) return { value: fromFsError(made.error, "mkdir") };
    const written = await fs.writeAtomic(target, file.bytes);
    return written.ok ? undefined : { value: fromFsError(written.error, "write") };
  });
  if (stopped !== undefined) return err(stopped.value);
  const keep = new Set(next.files.map((file) => file.path));
  const stale = (current?.files ?? []).filter((file) => !keep.has(file.path));
  const removed = await eachAsync(stale, async (file) => {
    const gone = await fs.remove(join(root, file.path), { recursive: false });
    return gone.ok ? undefined : { value: fromFsError(gone.error, "remove") };
  });
  return removed === undefined ? ok(undefined) : err(removed.value);
}

/**
 * `current`에서 `next`로 대상을 바꾼다. next가 null이면 스킬은 보관함으로 옮기거나(archive) 지우고, 메모리 파일은 지운다.
 * 파일마다 임시 파일 + rename으로 쓰므로 파일 하나는 반쯤 쓰인 채 남지 않는다. 여러 파일 사이의 원자성은 없다:
 * 중간에 실패하면 호출자가 `current`로 되돌린다(`applyTree(fs, target, partial, current, ...)`).
 */
export async function applyTree(
  fs: KnowledgeFs,
  target: ChangeTarget,
  current: Tree | null,
  next: Tree | null,
  removal: "archive" | "delete",
  clock: Clock,
): Promise<Result<void, KnowledgeFailure>> {
  if (target.kind === "memory") {
    if (next === null) {
      if (current === null) return ok(undefined);
      const gone = await fs.remove(target.path, { recursive: false });
      return gone.ok ? ok(undefined) : err(fromFsError(gone.error, "remove"));
    }
    const made = await fs.mkdirp(dirname(target.path));
    if (!made.ok) return err(fromFsError(made.error, "mkdir"));
    const bytes = next.files[0]?.bytes ?? new Uint8Array();
    const written = await fs.writeAtomic(target.path, bytes);
    return written.ok ? ok(undefined) : err(fromFsError(written.error, "write"));
  }
  if (next === null) {
    if (current === null) return ok(undefined);
    if (removal === "delete") {
      const gone = await fs.remove(target.path, { recursive: true });
      return gone.ok ? ok(undefined) : err(fromFsError(gone.error, "remove"));
    }
    const base = archivePath(target, clock);
    const made = await fs.mkdirp(dirname(base));
    if (!made.ok) return err(fromFsError(made.error, "mkdir"));
    // 같은 초에 같은 이름을 두 번 보관하면 이름이 겹친다. 번호를 붙여 비어 있는 이름을 찾는다
    const candidates = [
      base,
      ...Array.from({ length: MAX_ARCHIVE_SUFFIX }, (_, i) => `${base}-${i + 2}`),
    ];
    const moved = await eachAsync(
      candidates,
      async (destination): Promise<{ value: Result<void, KnowledgeFailure> } | undefined> => {
        const renamed = await fs.rename(target.path, destination);
        if (renamed.ok) return { value: ok(undefined) };
        if (renamed.error.kind === "exists") return undefined;
        return { value: err(fromFsError(renamed.error, "archive")) };
      },
    );
    return (
      moved?.value ?? err(failure("internal", `${base}: too many archives with the same name`))
    );
  }
  const made = await fs.mkdirp(target.path);
  if (!made.ok) return err(fromFsError(made.error, "mkdir"));
  return writeFiles(fs, target.path, current, next);
}
