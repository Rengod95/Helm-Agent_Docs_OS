import {
  closeSync,
  readdirSync,
  unlinkSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { assertNever, Bug, err, ok, type Clock, type Result } from "@xeon/contracts";
import type { IdFactory } from "@xeon/contracts/conversation";
import type { BlobError, BlobRef, SqlTx, StoreWriteError } from "@xeon/contracts/records";
import { assertNotInWrite, createStoreDb, readOnlyRefusal, type StoreConnections } from "./db.ts";
import type { StoreFaultInjector } from "./fault-points.ts";
import { sha256Hex } from "./hash.ts";

/** core-persistence 전용 블롭 참조 기록(L0.store.spec §3.4). 이벤트 커밋과 같은 트랜잭션에서 부른다 */
export interface BlobPins {
  pin(tx: SqlTx, sha256: string, owner: string, refKey: string): void;
  /** 세션 삭제 때 그 ref_key 행을 지운다. 지운 행 수를 돌려준다 */
  unpinAll(tx: SqlTx, owner: string, refKey: string): number;
}

export interface BlobDeps {
  readonly conn: StoreConnections;
  readonly clock: Clock;
  readonly ids: IdFactory;
  /** `<db 디렉터리>/blobs` */
  readonly blobsDir: string;
  readonly faults: StoreFaultInjector;
  /** 목적 디렉터리 fsync(Windows는 없음). select.ts가 정한다 */
  readonly directoryFsync: boolean;
  /** 테스트·디버그 빌드: 읽을 때 해시를 다시 확인한다 */
  readonly verifyHash: boolean;
  /** `l0.store.blobGraceMs`. 이 시간 안에 쓴 참조 없는 블롭은 GC가 지우지 않는다 */
  readonly graceMs: number;
}

/** GC 한 번이 지우는 항목(행·파일) 수 상한(L0.store.spec §4.9) */
const BLOB_GC_MAX_REMOVALS = 1000;

export interface BlobGcOptions {
  /** 조립 루트가 `query.liveBlobRefs()`로 모은 참조 중 해시. `sys_blob_refs`와 합쳐 지우지 않는다 */
  readonly liveRefs: ReadonlySet<string>;
}

export interface BlobGcReport {
  /** 지운 `sys_blobs` 행(과 그 파일) 수 */
  readonly rows: number;
  /** 행 없이 남은 블롭 파일 수 */
  readonly orphanFiles: number;
  /** 지운 임시 파일 수 */
  readonly tmpFiles: number;
  /** 파일 삭제에 실패해 다음 주기로 미룬 수 */
  readonly deferred: number;
  /** 상한 때문에 남은 후보가 있을 수 있다 */
  readonly truncated: boolean;
}

export interface BlobStore {
  putBlob(bytes: Uint8Array, mediaType: string | null): Result<BlobRef, BlobError>;
  readBlob(ref: BlobRef): Result<Uint8Array, BlobError>;
  /** 소유자 검증은 호출 쪽(service.ts)이 끝낸 뒤 부른다 */
  pinRef(sha256: string, owner: string, refKey: string): Result<void, BlobError>;
  unpinRefs(owner: string, refKey: string): Result<number, BlobError>;
  /** 동기 한 번에 끝낸다. 같은 프로세스의 putBlob과 끼어들지 않는다 */
  gc(options: BlobGcOptions): Result<BlobGcReport, BlobError>;
  readonly pins: BlobPins;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

function fsCodeOf(caught: unknown): string | undefined {
  if (typeof caught !== "object" || caught === null) return undefined;
  if (!("code" in caught) || !("syscall" in caught)) return undefined;
  return typeof caught.code === "string" ? caught.code : undefined;
}

function mapFsError(caught: unknown): BlobError | undefined {
  const code = fsCodeOf(caught);
  if (code === undefined) return undefined;
  return code === "ENOSPC" ? { kind: "disk_full" } : { kind: "io", code };
}

function mapWriteError(error: StoreWriteError): BlobError {
  switch (error.kind) {
    case "busy":
      return { kind: "io", code: "SQLITE_BUSY" };
    case "disk_full":
      return { kind: "disk_full" };
    case "io":
      return { kind: "io", code: error.code };
    default:
      return assertNever(error, "StoreWriteError");
  }
}

function blobPath(blobsDir: string, sha256: string): string {
  return join(blobsDir, sha256.slice(0, 2), sha256.slice(2));
}

function writeAll(fd: number, bytes: Uint8Array): void {
  let offset = 0;
  while (offset < bytes.byteLength) {
    offset += writeSync(fd, bytes, offset, bytes.byteLength - offset);
  }
}

function fsyncDirectory(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** 내용 주소(SHA-256) 블롭 파일과 sys_blobs 행(L0.store.spec §4.9). GC는 M2 이후다 */
export function createBlobStore(deps: BlobDeps): BlobStore {
  const { conn, blobsDir } = deps;
  const db = createStoreDb(conn, { internal: true });

  const putBlob = (bytes: Uint8Array, mediaType: string | null): Result<BlobRef, BlobError> => {
    assertNotInWrite(conn.state, "putBlob");
    if (conn.state.phase !== "open") throw new Bug("store.closed: the store is closed");
    // 파일을 쓰기 전에 거절한다. 읽기 전용 열기에서 파일만 남는 일이 없게 한다
    if (conn.state.readOnly) return err(readOnlyRefusal());
    const sha256 = sha256Hex(bytes);
    const size = bytes.byteLength;
    const dest = blobPath(blobsDir, sha256);
    try {
      const present = statOrUndefined(dest);
      // 같은 해시의 파일이 이미 완전하면 다시 쓰지 않는다(행의 last_put_at만 갱신한다)
      if (present === undefined || !present.isFile() || present.size !== size) {
        const tmp = join(blobsDir, "tmp", `${deps.ids.next("evt").slice(4)}.tmp`);
        const fd = openSync(tmp, "wx", 0o600);
        try {
          writeAll(fd, bytes);
          deps.faults.hit("blob_after_tmp_write");
          fsyncSync(fd);
          deps.faults.hit("blob_after_fsync");
        } finally {
          closeSync(fd);
        }
        mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
        renameSync(tmp, dest);
        deps.faults.hit("blob_after_rename");
        if (deps.directoryFsync) fsyncDirectory(dirname(dest));
      }
    } catch (caught) {
      const mapped = mapFsError(caught);
      if (mapped === undefined) throw caught;
      return err(mapped);
    }
    deps.faults.hit("blob_before_row");
    const now = deps.clock.now();
    const written = db.write((tx): void => {
      tx.run(
        `INSERT INTO sys_blobs (sha256, size, media_type, created_at, last_put_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(sha256) DO UPDATE SET last_put_at = excluded.last_put_at`,
        [sha256, size, mediaType, now, now],
      );
    });
    if (!written.ok) return err(mapWriteError(written.error));
    return ok({ type: "blob", sha256, size, mediaType });
  };

  const readBlob = (ref: BlobRef): Result<Uint8Array, BlobError> => {
    // 저장된 참조가 깨졌더라도 경로 조작이 되지 않게 해시 모양을 먼저 본다
    if (!SHA256_HEX.test(ref.sha256)) return err({ kind: "blob_missing", sha256: ref.sha256 });
    const path = blobPath(blobsDir, ref.sha256);
    try {
      const stat = statSync(path);
      if (!stat.isFile() || stat.size !== ref.size) {
        return err({ kind: "blob_corrupt", sha256: ref.sha256, reason: "size" });
      }
      const bytes = readFileSync(path);
      if (deps.verifyHash && sha256Hex(bytes) !== ref.sha256) {
        return err({ kind: "blob_corrupt", sha256: ref.sha256, reason: "hash" });
      }
      return ok(bytes);
    } catch (caught) {
      if (fsCodeOf(caught) === "ENOENT") return err({ kind: "blob_missing", sha256: ref.sha256 });
      const mapped = mapFsError(caught);
      if (mapped === undefined) throw caught;
      return err(mapped);
    }
  };

  const pins: BlobPins = {
    pin(tx: SqlTx, sha256: string, owner: string, refKey: string): void {
      tx.run("INSERT OR IGNORE INTO sys_blob_refs (sha256, owner, ref_key) VALUES (?, ?, ?)", [
        sha256,
        owner,
        refKey,
      ]);
    },
    unpinAll(tx: SqlTx, owner: string, refKey: string): number {
      return tx.run("DELETE FROM sys_blob_refs WHERE owner = ? AND ref_key = ?", [owner, refKey])
        .changes;
    },
  };

  const pinRef = (sha256: string, owner: string, refKey: string): Result<void, BlobError> => {
    const written = db.write((tx): boolean => {
      if (tx.get("SELECT 1 AS one FROM sys_blobs WHERE sha256 = ?", [sha256]) === undefined) {
        return false;
      }
      pins.pin(tx, sha256, owner, refKey);
      return true;
    });
    if (!written.ok) return err(mapWriteError(written.error));
    return written.value ? ok(undefined) : err({ kind: "blob_missing", sha256 });
  };

  const unpinRefs = (owner: string, refKey: string): Result<number, BlobError> => {
    const written = db.write((tx): number => pins.unpinAll(tx, owner, refKey));
    return written.ok ? ok(written.value) : err(mapWriteError(written.error));
  };

  const gc = (options: BlobGcOptions): Result<BlobGcReport, BlobError> => {
    assertNotInWrite(conn.state, "gcBlobs");
    if (conn.state.phase !== "open") throw new Bug("store.closed: the store is closed");
    // 읽기 전용 열기에서는 행도 파일도 지우지 않는다
    if (conn.state.readOnly) return err(readOnlyRefusal());
    const cutoff = deps.clock.now() - deps.graceMs;
    let budget = BLOB_GC_MAX_REMOVALS;
    let deferred = 0;
    let truncated = false;

    // 1. 고아 행. 행을 먼저 지우고 파일을 지운다(행이 파일보다 오래 남는 일이 없게). 중간에 죽으면 2번 규칙이 파일을 거둔다
    const candidates = db.write((tx): readonly string[] => {
      const found: string[] = [];
      const rows = tx.all(
        `SELECT b.sha256 AS sha256 FROM sys_blobs b
         WHERE b.last_put_at < ? AND NOT EXISTS (SELECT 1 FROM sys_blob_refs r WHERE r.sha256 = b.sha256)
         ORDER BY b.last_put_at, b.sha256`,
        [cutoff],
      );
      for (const row of rows) {
        const sha256 = row["sha256"];
        if (typeof sha256 !== "string" || options.liveRefs.has(sha256)) continue;
        if (found.length >= budget) {
          truncated = true;
          break;
        }
        tx.run("DELETE FROM sys_blobs WHERE sha256 = ?", [sha256]);
        found.push(sha256);
      }
      return found;
    });
    if (!candidates.ok) return err(mapWriteError(candidates.error));
    let rows = 0;
    for (const sha256 of candidates.value) {
      budget -= 1;
      if (removeFile(blobPath(blobsDir, sha256))) rows += 1;
      else deferred += 1;
    }

    // 2. 행 없는 파일
    let orphanFiles = 0;
    try {
      const known = db.read(
        (tx) => new Set(tx.all("SELECT sha256 FROM sys_blobs").map((r) => r["sha256"])),
      );
      if (!known.ok)
        return err({
          kind: "io",
          code: known.error.kind === "busy" ? "SQLITE_BUSY" : known.error.code,
        });
      for (const prefix of readdirSync(blobsDir)) {
        if (prefix === "tmp" || !/^[0-9a-f]{2}$/.test(prefix)) continue;
        for (const name of readdirSync(join(blobsDir, prefix))) {
          const sha256 = `${prefix}${name}`;
          if (!SHA256_HEX.test(sha256) || known.value.has(sha256) || options.liveRefs.has(sha256))
            continue;
          const path = join(blobsDir, prefix, name);
          const stat = statOrUndefined(path);
          if (stat === undefined || !stat.isFile() || stat.mtimeMs >= cutoff) continue;
          if (budget <= 0) {
            truncated = true;
            break;
          }
          budget -= 1;
          if (removeFile(path)) orphanFiles += 1;
          else deferred += 1;
        }
      }

      // 3. 임시 파일
      let tmpFiles = 0;
      const tmpDir = join(blobsDir, "tmp");
      for (const name of readdirSync(tmpDir)) {
        if (!name.endsWith(".tmp")) continue;
        const path = join(tmpDir, name);
        const stat = statOrUndefined(path);
        if (stat === undefined || !stat.isFile() || stat.mtimeMs >= cutoff) continue;
        if (budget <= 0) {
          truncated = true;
          break;
        }
        budget -= 1;
        if (removeFile(path)) tmpFiles += 1;
        else deferred += 1;
      }
      return ok({ rows, orphanFiles, tmpFiles, deferred, truncated });
    } catch (caught) {
      const mapped = mapFsError(caught);
      if (mapped === undefined) throw caught;
      return err(mapped);
    }
  };

  return { putBlob, readBlob, pinRef, unpinRefs, gc, pins };
}

/** 파일을 지운다. 없으면 이미 지운 것으로 본다. 그 밖의 실패(사용 중 등)는 false로 다음 주기에 미룬다 */
function removeFile(path: string): boolean {
  try {
    unlinkSync(path);
    return true;
  } catch (caught) {
    return fsCodeOf(caught) === "ENOENT";
  }
}

function statOrUndefined(path: string): ReturnType<typeof statSync> | undefined {
  try {
    return statSync(path);
  } catch (caught) {
    if (fsCodeOf(caught) === "ENOENT") return undefined;
    throw caught;
  }
}
