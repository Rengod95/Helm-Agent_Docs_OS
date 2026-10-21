import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Bug, err, ok, type Clock, type Result } from "@xeon/contracts";
import type { IdFactory } from "@xeon/contracts/conversation";
import type { BlobError, BlobRef, SqlTx, StoreWriteError } from "@xeon/contracts/records";
import { assertNotInWrite, createStoreDb, type StoreConnections } from "./db.ts";
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
}

export interface BlobStore {
  putBlob(bytes: Uint8Array, mediaType: string | null): Result<BlobRef, BlobError>;
  readBlob(ref: BlobRef): Result<Uint8Array, BlobError>;
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
      throw new Bug("store.write_error_invalid");
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

  return { putBlob, readBlob, pins };
}

function statOrUndefined(path: string): ReturnType<typeof statSync> | undefined {
  try {
    return statSync(path);
  } catch (caught) {
    if (fsCodeOf(caught) === "ENOENT") return undefined;
    throw caught;
  }
}
