import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { assertNever, err, ok, type Result } from "@xeon/contracts";
import { classifySqliteCode } from "./db.ts";
import { asSqliteFailure, type SqliteConnection } from "./sqlite-env.ts";

// L0.store.spec §4.6.1. 스키마를 올리기 전에 DB 전체를 `VACUUM INTO`로 복사해 둔다. 마이그레이션이 사용자 데이터를 망쳐도
// 직전 상태로 돌아갈 수 있게 하는 최소 안전장치다(내보내기와 복구 런북은 M3).

/** 보관하는 스냅샷 수. 이보다 오래된 것은 새 스냅샷을 만든 뒤 지운다 */
export const MIGRATION_SNAPSHOT_KEEP = 3;

export interface SnapshotConfig {
  /** 스냅샷 디렉터리(DB 디렉터리 아래 `backups`). 없으면 0700으로 만든다 */
  readonly dir: string;
  /** DB 파일 이름(디렉터리 제외). 스냅샷 이름의 앞부분이다 */
  readonly dbFileName: string;
  readonly keep: number;
  /** 0600/0700이 의미 있는 플랫폼 */
  readonly posix: boolean;
}

export type SnapshotError =
  | { readonly kind: "busy" }
  | { readonly kind: "disk_full" }
  | { readonly kind: "io"; readonly code: string };

export interface SnapshotInput {
  readonly owner: string;
  readonly from: number;
  readonly to: number;
  /** epoch ms. 이름에 들어간다 */
  readonly at: number;
}

export interface SnapshotTaken {
  readonly path: string;
  /** 보관 수를 넘어 지운 옛 스냅샷 */
  readonly pruned: readonly string[];
  /** 지우지 못한 옛 스냅샷과 errno */
  readonly pruneFailed: readonly { readonly path: string; readonly code: string }[];
}

function fsCode(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

/** `20260115T093000123Z`. 이름을 시간순으로 정렬할 수 있다 */
function compactTimestamp(at: number): string {
  return new Date(at).toISOString().replaceAll(/[-:.]/g, "");
}

function safeOwner(owner: string): string {
  return owner.replaceAll(/[^A-Za-z0-9._-]/g, "_");
}

/**
 * 이름: `<db>.pre-<시각>-<owner>-v<from>-to-v<to>.sqlite`. 같은 DB의 스냅샷만 앞부분(`<db>.pre-`)으로 골라 시각순으로 센다.
 * 쓰기 연결에서 쓰기 트랜잭션 밖일 때만 부른다(`VACUUM`은 트랜잭션 안에서 못 돈다).
 */
export function snapshotBeforeMigration(
  db: SqliteConnection,
  config: SnapshotConfig,
  input: SnapshotInput,
): Result<SnapshotTaken, SnapshotError> {
  try {
    mkdirSync(config.dir, { recursive: true, mode: 0o700 });
  } catch (caught) {
    return err(
      fsCode(caught) === "ENOSPC" ? { kind: "disk_full" } : { kind: "io", code: fsCode(caught) },
    );
  }
  const prefix = `${config.dbFileName}.pre-`;
  const name = `${prefix}${compactTimestamp(input.at)}-${safeOwner(input.owner)}-v${String(input.from)}-to-v${String(input.to)}.sqlite`;
  const path = join(config.dir, name);
  // 같은 이름이 이미 있으면 같은 ms에 같은 전환(owner, from, to)의 스냅샷을 다른 프로세스가 먼저 만든 것이다.
  // 동시에 처음 열 때 일어난다(macOS 실측 2026-10-25). 그 파일이 이 전환의 스냅샷이므로 만든 것으로 본다
  if (existsSync(path)) return ok({ path, pruned: [], pruneFailed: [] });
  try {
    db.run("VACUUM INTO ?", [path]);
    if (config.posix) chmodSync(path, 0o600);
  } catch (caught) {
    // 만들다 만 파일이 남으면 다음 시도를 EEXIST로 막는다
    if (existsSync(path)) rmSync(path, { force: true });
    const failure = asSqliteFailure(caught);
    if (failure === undefined) {
      const code = fsCode(caught);
      return err(code === "ENOSPC" ? { kind: "disk_full" } : { kind: "io", code });
    }
    const classified = classifySqliteCode(failure.code);
    switch (classified) {
      case "busy":
        return err({ kind: "busy" });
      case "disk_full":
        return err({ kind: "disk_full" });
      case "io":
      case "corrupt":
      case "other":
        return err({ kind: "io", code: failure.code ?? "SQLITE_ERROR" });
      default:
        return assertNever(classified, "SqliteCodeClass");
    }
  }
  return ok({ path, ...prune(config, prefix) });
}

function prune(
  config: SnapshotConfig,
  prefix: string,
): Pick<SnapshotTaken, "pruned" | "pruneFailed"> {
  const pruned: string[] = [];
  const pruneFailed: { path: string; code: string }[] = [];
  let names: string[];
  try {
    names = readdirSync(config.dir);
  } catch (caught) {
    return { pruned, pruneFailed: [{ path: config.dir, code: fsCode(caught) }] };
  }
  const snapshots = names
    .filter((entry) => entry.startsWith(prefix) && entry.endsWith(".sqlite"))
    .toSorted();
  for (const old of snapshots.slice(0, Math.max(0, snapshots.length - config.keep))) {
    const target = join(config.dir, basename(old));
    try {
      rmSync(target);
      pruned.push(target);
    } catch (caught) {
      pruneFailed.push({ path: target, code: fsCode(caught) });
    }
  }
  return { pruned, pruneFailed };
}
