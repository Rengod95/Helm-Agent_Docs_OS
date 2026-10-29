import type { Result } from "../base/index.ts";
import type { BlobRef } from "./blob.ts";
import type { LeaseService } from "./lease.ts";
import type { ExtensionTables, MigrationRunner } from "./migrations.ts";
import type { SqlTx } from "./sql.ts";

export const StoreServiceName = "xeon.store" as const;

export type StoreWriteError =
  | { readonly kind: "busy" }
  | { readonly kind: "disk_full" }
  /** SQLITE_IOERR 계열, SQLITE_READONLY */
  | { readonly kind: "io"; readonly code: string };
export type StoreReadError =
  | { readonly kind: "busy" }
  | { readonly kind: "io"; readonly code: string };

export interface StoreDb {
  /** BEGIN IMMEDIATE … COMMIT. fn은 동기. fn이 던지면 롤백 후 다시 던진다. 중첩 호출은 Bug(store.nested_write) */
  write<T>(fn: (tx: SqlTx) => T): Result<T, StoreWriteError>;
  /** 읽기 연결의 BEGIN DEFERRED. 같은 스냅숏에서 읽는다 */
  read<T>(fn: (tx: SqlTx) => T): Result<T, StoreReadError>;
}

export interface StoreCapabilities {
  /** 프로브 결과. false면 FTS5 가상 테이블을 만들지 않는다 */
  readonly fts5: boolean;
  readonly sqliteVersion: string;
  /** macOS에서 setCustomSQLite로 지정한 경로. 그 밖에는 null */
  readonly customSqlitePath: string | null;
  readonly lockProvider: "flock" | "win32" | "none";
}

export type BlobError =
  | { readonly kind: "blob_missing"; readonly sha256: string }
  | { readonly kind: "blob_corrupt"; readonly sha256: string; readonly reason: "size" | "hash" }
  | { readonly kind: "disk_full" }
  | { readonly kind: "io"; readonly code: string };

export interface StoreService {
  /** "sto_<ULID>" (F.conversation.spec §3.2.1 ①) */
  readonly storeId: string;
  readonly capabilities: StoreCapabilities;
  /** 이 소유자의 테이블만 쓰는 핸들. 소유자가 sys_prefixes에 없으면 Bug(store.prefix_not_owned) */
  scoped(owner: string): StoreDb;
  readonly migrations: MigrationRunner;
  readonly extensions: ExtensionTables;
  readonly leases: LeaseService;
  /** 트랜잭션 밖에서만 부른다(TX-04). 같은 해시면 파일을 다시 쓰지 않는다 */
  putBlob(bytes: Uint8Array, mediaType: string | null): Result<BlobRef, BlobError>;
  readBlob(ref: BlobRef): Result<Uint8Array, BlobError>;
  /**
   * 범위 핸들 소유자(`cap.*`, `ext.*`)가 블롭을 참조한다고 적는다. 참조가 있는 블롭은 GC가 지우지 않는다(M3-REQ-62).
   * 트랜잭션 밖에서 부른다. 블롭 행이 없으면 `blob_missing`. 등록되지 않은 소유자나 루트 전용 소유자는 Bug(store.prefix_not_owned)
   */
  pinBlob(owner: string, sha256: string, refKey: string): Result<void, BlobError>;
  /** `pinBlob`으로 적은 `(owner, refKey)` 참조를 모두 해제한다. 해제한 행 수를 돌려준다 */
  unpinBlob(owner: string, refKey: string): Result<number, BlobError>;
}
