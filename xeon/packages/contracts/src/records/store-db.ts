import type { Result } from "../base/index.ts";
import type { BlobRef } from "./blob.ts";
import type { LeaseService } from "./lease.ts";
import type { ExtensionTables, MigrationRunner } from "./migrations.ts";
import type { SqlTx } from "./sql.ts";

export const StoreServiceName = "fresnel.store" as const;

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
  /** 바이트 수가 `l0.store.maxBlobBytes`(limit)를 넘는다. 파일도 행도 만들지 않으며 자르지 않는다 */
  | { readonly kind: "blob_too_large"; readonly size: number; readonly limit: number }
  | { readonly kind: "disk_full" }
  | { readonly kind: "io"; readonly code: string };

/** 대화 하나가 참조하는 블롭 수와 바이트 합. 같은 블롭을 두 대화가 참조하면 두 대화에 각각 든다 */
export interface BlobUsageByThread {
  readonly threadId: string;
  readonly blobs: number;
  readonly bytes: number;
}

/** `blobUsage()`의 결과. total은 `sys_blobs` 전체(참조 없이 유예 중인 블롭 포함)이고 같은 해시는 한 번만 센다 */
export interface BlobUsage {
  readonly total: { readonly blobs: number; readonly bytes: number };
  readonly byThread: readonly BlobUsageByThread[];
}

/**
 * 큰 블롭을 조각으로 쓰는 원천(`putBlobStream`). 전체를 한 버퍼로 만들지 않는다.
 * `size`는 `produce`가 `sink`로 넘길 바이트의 정확한 합이며 미리 안다. 다르면 저장소가 Bug(store.blob_stream_size)다.
 * `produce`는 `sink`를 동기로 여러 번 부를 수 있다. 조각(`chunk`)은 `sink` 호출 동안만 유효하다. 생산자가 한 버퍼를 되풀이해 쓸 수 있다.
 */
export type BlobStreamSource = {
  readonly size: number;
  produce(sink: (chunk: Uint8Array) => void): void;
};

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
  /**
   * `putBlob`과 같은 결과(같은 블롭 참조, 같은 행, 같은 오류)를 내되 바이트를 조각으로 받아 해시를 조각마다 갱신하며 파일에 쓴다.
   * 큰 값을 옮길 때 입력 전체의 사본을 만들지 않는다(L0.store.spec §4.9). 트랜잭션 밖에서만 부른다(TX-04).
   * `source.size`를 넘거나 모자라게 쓰면 Bug(store.blob_stream_size)다. 한도(`blob_too_large`)는 `putBlob`과 같이 파일을 쓰기 전에 본다.
   */
  putBlobStream(source: BlobStreamSource, mediaType: string | null): Result<BlobRef, BlobError>;
  readBlob(ref: BlobRef): Result<Uint8Array, BlobError>;
  /**
   * 블롭의 `[offset, offset + length)` 바이트만 읽는다. 파일 전체를 읽지 않는다. 크기 대조는 `readBlob`과 같고
   * 해시는 대조하지 않는다. 범위가 `ref.size`를 넘거나 음수·정수가 아니면 호출자 결함이라 Bug(store.blob_range_out_of_bounds)다
   */
  readBlobRange(ref: BlobRef, offset: number, length: number): Result<Uint8Array, BlobError>;
  /** 자리표시 `blob:sha256:<hex>`처럼 해시만 아는 호출자용. 크기 대조 없이 해시로 읽는다. 오류는 `readBlob`과 같다 */
  readBlobByHash(sha256: string): Result<Uint8Array, BlobError>;
  /** 블롭 사용량. `owner = 'thread'` 참조를 `ref_key`(대화 id)별로 센다(L0.store.spec §4.9) */
  blobUsage(): Result<BlobUsage, BlobError>;
  /**
   * 범위 핸들 소유자(`cap.*`, `ext.*`)가 블롭을 참조한다고 적는다. 참조가 있는 블롭은 GC가 지우지 않는다(M3-REQ-62).
   * 트랜잭션 밖에서 부른다. 블롭 행이 없으면 `blob_missing`. 등록되지 않은 소유자나 루트 전용 소유자는 Bug(store.prefix_not_owned)
   */
  pinBlob(owner: string, sha256: string, refKey: string): Result<void, BlobError>;
  /** `pinBlob`으로 적은 `(owner, refKey)` 참조를 모두 해제한다. 해제한 행 수를 돌려준다 */
  unpinBlob(owner: string, refKey: string): Result<number, BlobError>;
}
