import { existsSync, lstatSync, readdirSync, rmdirSync, unlinkSync, type Stats } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { attempt, attemptAsync, err, ok, type Result, type Thrown } from "@xeon/contracts";

// L0.exec.spec §3.8.2, §10 4 [결정: M3-REQ-47]. spill 디렉터리의 보관 정리와 사용량 계산.
// 정리는 exec 안에서 돌지 않는다. 조립 루트가 `pruneSpill`을 부른다. 심볼릭 링크는 따라가지도 지우지도 않는다.

/** spill 보관소의 예상 가능한 실패(TY-11). 개별 파일 삭제 실패는 오류가 아니라 보고의 `failed`다 */
export type SpillError =
  | { readonly kind: "unreadable"; readonly path: string; readonly cause: Thrown }
  | { readonly kind: "invalid_max_age"; readonly maxAgeDays: number };

export interface PruneSpillOptions {
  /** spill 디렉터리(`<상태 디렉터리>/spill`). 없으면 지울 것이 없다 */
  readonly dir: string;
  /** 이 일수보다 오래된 파일을 지운다. 0이면 아무것도 지우지 않고 디스크를 건드리지 않는다 */
  readonly maxAgeDays: number;
  /** 기준 시각(epoch ms). 호출자가 준다 */
  readonly now: number;
}

export interface PruneSpillReport {
  /** 지운 파일 수. 비운 `tmp-*` 디렉터리는 세지 않는다 */
  readonly removed: number;
  /** 지운 파일 크기의 합(바이트) */
  readonly bytesFreed: number;
  /** 지우지 못한 항목 수. 하나가 실패해도 나머지는 계속 지운다 */
  readonly failed: number;
}

interface Totals {
  removed: number;
  bytesFreed: number;
  failed: number;
}

const DAY_MS = 86_400_000;
/** spill 임시 디렉터리 이름 접두(`createTempDir`의 기본값, upstream/env/node.ts) */
const TMP_DIR_PREFIX = "tmp-";

/**
 * `dir` 아래 `maxAgeDays`보다 오래된 일반 파일을 지운다. 대상은 `dir`의 파일과 `tmp-*` 디렉터리 안의 파일이다.
 * 심볼릭 링크와 그 밖의 디렉터리는 건드리지 않는다. 비운 `tmp-*` 디렉터리 중 오래된 것은 지운다.
 */
export function pruneSpill(options: PruneSpillOptions): Result<PruneSpillReport, SpillError> {
  const { dir, maxAgeDays, now } = options;
  if (!Number.isInteger(maxAgeDays) || maxAgeDays < 0) {
    return err({ kind: "invalid_max_age", maxAgeDays });
  }
  const totals: Totals = { removed: 0, bytesFreed: 0, failed: 0 };
  // 0은 보존 기본값이다. 디스크를 읽지 않고 빈 보고를 돌려준다
  if (maxAgeDays === 0 || !existsSync(dir)) return ok({ ...totals });
  const cutoff = now - maxAgeDays * DAY_MS;
  const names = attempt(() => readdirSync(dir));
  if (!names.ok) return err({ kind: "unreadable", path: dir, cause: names.error });
  for (const name of names.value) {
    const path = join(dir, name);
    const info = attempt(() => lstatSync(path));
    if (!info.ok) {
      totals.failed += 1;
      continue;
    }
    if (info.value.isFile()) {
      removeIfAged(path, info.value, cutoff, totals);
    } else if (info.value.isDirectory() && name.startsWith(TMP_DIR_PREFIX)) {
      pruneTmpDir(path, info.value, cutoff, totals);
    }
  }
  return ok({ ...totals });
}

/** spill 디렉터리 아래 일반 파일 크기의 합(바이트). 심볼릭 링크는 따라가지도 세지도 않는다. 디렉터리가 없으면 0이다 */
export async function spillUsageBytes(dir: string): Promise<Result<number, SpillError>> {
  if (!existsSync(dir)) return ok(0);
  const total = await bytesUnder(dir);
  if (!total.ok) return err({ kind: "unreadable", path: dir, cause: total.error });
  return ok(total.value);
}

function removeIfAged(path: string, info: Stats, cutoff: number, totals: Totals): void {
  if (info.mtimeMs >= cutoff) return;
  const removal = attempt(() => unlinkSync(path));
  if (!removal.ok) {
    totals.failed += 1;
    return;
  }
  totals.removed += 1;
  totals.bytesFreed += info.size;
}

function pruneTmpDir(path: string, info: Stats, cutoff: number, totals: Totals): void {
  // 안의 파일을 지우면 디렉터리 시각이 바뀌므로, 지우기 전에 잰 시각으로 오래됐는지 본다
  const aged = info.mtimeMs < cutoff;
  const children = attempt(() => readdirSync(path));
  if (!children.ok) {
    totals.failed += 1;
    return;
  }
  for (const child of children.value) {
    const childPath = join(path, child);
    const childInfo = attempt(() => lstatSync(childPath));
    if (!childInfo.ok) {
      totals.failed += 1;
      continue;
    }
    if (childInfo.value.isFile()) removeIfAged(childPath, childInfo.value, cutoff, totals);
  }
  if (!aged) return;
  const remaining = attempt(() => readdirSync(path));
  if (!remaining.ok) {
    totals.failed += 1;
    return;
  }
  if (remaining.value.length > 0) return;
  const removal = attempt(() => rmdirSync(path));
  if (!removal.ok) totals.failed += 1;
}

async function bytesUnder(dir: string): Promise<Result<number, Thrown>> {
  const names = await attemptAsync(() => readdir(dir));
  if (!names.ok) return err(names.error);
  const parts = await Promise.all(names.value.map((name) => entryBytes(join(dir, name))));
  let total = 0;
  for (const part of parts) {
    if (!part.ok) return err(part.error);
    total += part.value;
  }
  return ok(total);
}

/** 항목 하나의 바이트. 일반 파일은 크기, 디렉터리는 안의 합, 심볼릭 링크와 그 밖은 0이다 */
async function entryBytes(path: string): Promise<Result<number, Thrown>> {
  const info = await attemptAsync(() => lstat(path));
  if (!info.ok) return err(info.error);
  if (info.value.isFile()) return ok(info.value.size);
  if (info.value.isDirectory()) return bytesUnder(path);
  return ok(0);
}
