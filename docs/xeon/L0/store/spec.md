---
id: L0.store.spec
layer: L0
domain: store
kind: spec
status: draft
depends_on: [F.records.spec, F.conversation.spec, F.extensions.spec, X.operations.spec, adr.0004, eng.transactions.design, eng.events.design, eng.toolchain.guide, L0.os.spec, L0.process.spec]
binds: [xeon/packages/platform-store/**]
---

# L0 저장 기반 (store)

이 문서는 L0-e "저장 기반"(`_research/layer-plan-v2.json` L0-e)의 스펙이다. 패키지는 `xeon/packages/platform-store`(`@xeon/platform-store`)이고 Cordis 서비스 `xeon.store`(`StoreService`)를 등록한다(`eng.context-map.design` §5.3).

[결정] `bun:sqlite`는 이 패키지만 import한다(`eng.dependency-rules.guide` DR-07). `better-sqlite3`, `node:sqlite`, `sqlite3`는 모든 패키지에서 금지다. 계획 v2 L0-e 표의 better-sqlite3 서술은 `_research/foundation-plan.md §2` DB 행의 bun:sqlite 결정이 우선한다.

## 1. 목적과 범위

### 1.1 정하는 것

[결정] 단일 SQLite 파일, WAL, 단계 경계 FULL, 한 단계에 커밋 한 번(`_research/foundation-plan.md §2` DB 행, adr.0004 §3.1·§3.2 5번, `eng.transactions.design` §3.2). 이 문서는 그 결정의 L0 쪽 구현을 정한다.

- SQLite 로드 순서와 FTS5 프로브(`eng.toolchain.guide` TC-11, adr.0004 §3.5)
- DB 위치 검사와 파일 권한
- 쓰기·읽기 연결 설정(PRAGMA)과 종료 절차
- `StoreDb.write`/`read` 트랜잭션 래퍼와 오류 매핑
- `sys_*` 테이블 DDL(`sys_meta`, `sys_migrations`, `sys_migration_cursors`, `sys_prefixes`, `sys_leases`, `sys_blobs`, `sys_blob_refs`)
- 마이그레이션 실행기(체크섬, 순서, 청크 마이그레이션 커서)
- 테이블 접두사 소유 검사, 확장 접두사 테이블 등록과 삭제
- 세션 소유 잠금(OS 잠금 + `sys_leases` epoch 펜싱)과 `LockProvider`
- 블롭 저장소(내용 주소 파일, 쓰기 순서, GC)
- 테스트 도우미 `openTestStore`와 저장소 쪽 장애 주입 지점

### 1.2 다루지 않는 것

| 대상 | 정하는 곳 |
|---|---|
| `events`, `requests`, `step_checkpoints`, `projector_state`, `consumer_cursors`, `p_*` 테이블과 DDL | `L1.persistence.spec`(session-core 소유, `eng.context-map.design` §5.2) |
| seq 발급, envelope 완성, 투영 실행, `SessionWriter.commit` | `L1.persistence.spec`, `eng.transactions.design` §4 |
| 세션 head seq 조회와 구간 읽기(`F.wire-settings.spec` §8이 이 문서에 요구한 항목) | `L1.persistence.spec`. 이 문서는 `storeId` 발급과 보관만 맡는다(§3.3) |
| 잠금 실패 때 위임·관찰·분기 선택 | `L0.process.spec`(`LockFallbackPolicy`) |
| 자동 재개 정책과 '이어서 실행' 제시 | `L0.process.spec`, `L1.persistence.spec` |
| 복구 표식(`p_threads`의 `running_since`·`resume_attempts`, 이벤트에서 만드는 투영 열) | `L1.persistence.spec` §2·§4.8.1 |
| 블롭 분리 판단(어느 필드를 언제 블롭으로 옮기는지) | `F.records.spec` §3.4, `eng.events.design` EV-04, `L1.persistence.spec` |
| DB 파일 경로 결정(OS별 데이터 디렉터리) | `L0.os.spec`. 호출자(`apps/host`)가 경로를 구해 넘긴다 |
| 세션 검색 FTS 테이블 | `L2.knowledge.spec`(`cap_knowledge_*`). 이 문서는 FTS5 가용성만 알린다 |

경계 근거: `F.readme` §6("저장 구현(테이블, DDL, PRAGMA, 잠금, blob 파일, seq 발급)은 `L0.store.spec`, `L1.persistence.spec`"), `eng.context-map.design` §5.2(`sys_`는 platform-store, `events`·`p_`는 session-core).

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 쓰기 연결 | 프로세스마다 하나인 읽기·쓰기 `Database`. 모든 `write`가 이 연결을 쓴다 |
| 읽기 연결 | `readonly`로 연 `Database`. `read`가 쓴다 |
| 루트 핸들 | 모든 테이블에 쓸 수 있는 `StoreDb`. 조립 루트(`apps/host`)가 `core-persistence`에만 넘긴다 |
| 범위 핸들 | `scoped(owner)`가 돌려준 `StoreDb`. 그 소유자의 테이블만 쓴다 |
| 소유자(owner) | 테이블 묶음의 소유 컨텍스트 id(`core.persistence`, `cap.knowledge`, `ext.helm` 등). §3.5 |
| 자원(resource) | 임대 대상 이름. `session:<threadId>`, `scheduler`, `service` |
| 임대(lease) | `sys_leases` 행 하나. 소유자 정보와 epoch를 담는다 |
| epoch | 자원의 소유자가 바뀔 때마다 1 오르는 정수. 펜싱 토큰이다 |
| OS 잠금 | 자원 키 사이드카 파일의 `flock`(macOS·Linux). 프로세스가 죽으면 커널이 푼다 |
| 블롭 | 내용 주소(SHA-256) 파일. 이벤트에는 `BlobRef`만 남는다 |
| 고아 블롭 | `sys_blob_refs`에 참조가 없고 유예 시간이 지난 블롭 |

`threadId`는 `F.conversation.spec` §3.2의 `ThreadId`(`thr_<ULID>`)다. `eng.transactions.design`의 `SessionId`는 F 이름으로 읽는다(`F.records.spec` §3.1.2 정본 표, 세션과 thread는 1:1 [가정: `F.wire-settings.spec` §2]).

## 3. 인터페이스

코드 표기는 `F.conversation.spec` §3 머리말을 따른다. 예상 가능한 실패는 `@xeon/contracts`의 `Result<T, E>`로 돌려주고 `E`는 `kind` 판별 유니온이다. 버그는 `Bug`를 던진다(`eng.typescript.guide` TY-11). `Clock`(`now(): number`, epoch ms)과 `Scheduler`(`setTimeout`, `clearTimeout`)는 `L0.os.spec` §3.4의 분리를 따른다. `Clock`은 시각만 주고 타이머는 `Scheduler`가 건다. 두 인터페이스는 F 루트 base에 둔다 [결정: review.decisions-2 U-03, `L0.readme` §9 3번].

### 3.1 F에 둘 인터페이스 초안 (records)

[제안] 아래 타입은 `@xeon/contracts/records`에 둔다(§8.1 FR-S1~FR-S5). `eng.transactions.design` §4.2의 `StoreDb`, `SqlTx`, `StoreService` 초안을 기준으로 임대·표식·마이그레이션·능력 조회를 더했다. records는 wire·capabilities를 import하지 않는다(`F.readme` §3 순서 표).

```ts
// xeon/packages/contracts/src/records/sql.ts
/** eng.events.design §5 projector.ts의 SqlValue와 같은 정의. 한 곳에 둔다(FR-S1) */
export type SqlValue = string | number | bigint | Uint8Array | null;
export type SqlRow = Readonly<Record<string, SqlValue>>;

export interface SqlTx {
  run(sql: string, params?: readonly SqlValue[]): { readonly changes: number };
  get(sql: string, params?: readonly SqlValue[]): SqlRow | undefined;
  all(sql: string, params?: readonly SqlValue[]): readonly SqlRow[];
}
```

`sql.ts`는 다른 records 파일을 import하지 않는다. `store-db.ts`가 `lease.ts`·`migrations.ts`를 import하고 그 둘은 `sql.ts`만 보므로 순환이 없다(`import/no-cycle`).

```ts
// xeon/packages/contracts/src/records/store-db.ts
import type { Result } from "../base/index.ts";
import type { BlobRef } from "./blob.ts";
import type { LeaseService } from "./lease.ts";
import type { ExtensionTables, MigrationRunner } from "./migrations.ts";

import type { SqlTx } from "./sql.ts";

export const StoreServiceName = "xeon.store" as const;

export type StoreWriteError =
  | { readonly kind: "busy" }
  | { readonly kind: "disk_full" }
  | { readonly kind: "io"; readonly code: string };          // SQLITE_IOERR 계열, SQLITE_READONLY
export type StoreReadError = { readonly kind: "busy" } | { readonly kind: "io"; readonly code: string };

export interface StoreDb {
  /** BEGIN IMMEDIATE … COMMIT. fn은 동기. fn이 던지면 롤백 후 다시 던진다. 중첩 호출은 Bug(store.nested_write) */
  write<T>(fn: (tx: SqlTx) => T): Result<T, StoreWriteError>;
  /** 읽기 연결의 BEGIN DEFERRED. 같은 스냅숏에서 읽는다 */
  read<T>(fn: (tx: SqlTx) => T): Result<T, StoreReadError>;
}

export interface StoreCapabilities {
  /** §4.1 프로브 결과. false면 FTS5 가상 테이블을 만들지 않는다 */
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
  readonly storeId: string;                                   // "sto_<ULID>", F.wire-settings §3.4.1 StoreId 모양
  readonly capabilities: StoreCapabilities;
  /** 이 소유자의 테이블만 쓰는 핸들. 소유자가 sys_prefixes에 없으면 Bug(store.prefix_not_owned) */
  scoped(owner: string): StoreDb;
  migrations: MigrationRunner;
  extensions: ExtensionTables;
  leases: LeaseService;
  /** 트랜잭션 밖에서만 부른다(TX-04). 같은 해시면 파일을 다시 쓰지 않는다 */
  putBlob(bytes: Uint8Array, mediaType: string | null): Result<BlobRef, BlobError>;
  readBlob(ref: BlobRef): Result<Uint8Array, BlobError>;
}
```

- `StoreService`는 X 포트 `ScopedStorePort`(`Pick<StoreService, "scoped">`, `F.extensions.spec` §3.2.1)를 그대로 만족한다. X는 `ScopedStorePortKey`(`{ name: "xeon.store" }`)로 이 서비스의 `scoped`만 받는다(`F.capabilities.spec` §3.12 규칙 2, `F.extensions.spec` §9 13). 별도 어댑터는 두지 않는다.
- [제안] `putBlob`/`readBlob`은 `Result`를 돌려준다. `eng.transactions.design` §4.2 초안은 `BlobRef`를 바로 돌려주지만 디스크 부족과 파일 소실은 예상 가능한 실패다(TY-11). 그 문서의 수정 요청은 §8.1 FR-S6이다.
- `BlobRef`의 모양은 F 정본 `{ type: "blob", sha256, size, mediaType }`이다(`F.records.spec` §3.4, §3.1.2 정본 표). `eng.events.design` §4.1의 `{ hash: "sha256:…", size, mime }`는 F 이름으로 읽는다. 내용 주소의 문자열 표기 `sha256:<hex>`는 로그와 자리표시(`blob:sha256:<hex>`, `BLOB_PLACEHOLDER_PREFIX`)에만 쓴다.

```ts
// xeon/packages/contracts/src/records/lease.ts
import type { Result } from "../base/index.ts";
import type { SqlTx } from "./sql.ts";

/** "session:<threadId>" | "scheduler" | "service" */
export type LeaseResource = string;
export const LEASE_RESOURCE_PATTERN: string = "^(session:thr_[0-7][0-9A-HJKMNP-TV-Z]{25}|scheduler|service)$";

export type LeaseKind = "cli" | "app" | "service";

/** 임대를 쥐려는 쪽. 엔진 인스턴스마다 하나 */
export interface LeaseHolder {
  readonly holderId: string;            // 엔진 인스턴스 id. 시작 때 IdFactory로 만든다
  readonly kind: LeaseKind;
  readonly pid: number;
  readonly startedAt: number;           // 프로세스 시작 시각 지문(epoch ms). L0.os가 준다
  readonly host: string;                // 기계 식별자. 같은 기계 판정용
}

/** 쓰기 소유 증표. eng.transactions.design §4.2 LeaseToken의 일반형(FR-S2) */
export interface LeaseToken {
  readonly resource: LeaseResource;
  readonly holderId: string;
  readonly epoch: number;
}

/** sys_leases 행을 옮긴 표시 정보. 판정에 쓰지 않는다 */
export interface LeaseOwnerInfo {
  readonly holderId: string;
  readonly kind: LeaseKind;
  readonly pid: number;
  readonly startedAt: number;
  readonly host: string;
  readonly epoch: number;
  readonly heartbeatAt: number;
  readonly expiresAt: number;
}

/** 잠금 실패 정보. 정책은 L0.process.spec의 LockFallbackPolicy가 정한다 */
export interface LockBusy {
  readonly kind: "lock_busy";
  readonly resource: LeaseResource;
  readonly reason: "os_lock_held" | "lease_active";
  /** 행이 없거나 경합 중 사라졌으면 null */
  readonly owner: LeaseOwnerInfo | null;
}

/** sys_leases 행을 읽을 수 없다(손상, 수동 편집). where는 `sys_leases.<열>`이다. 예상 가능한 실패라 값으로 돌려준다(eng.typescript.guide TY-24) */
export interface LeaseRowInvalid {
  readonly kind: "row_invalid";
  readonly where: string;
}

export type LeaseError =
  | LockBusy
  | { readonly kind: "lease_lost"; readonly resource: LeaseResource }
  | { readonly kind: "busy" }
  | { readonly kind: "disk_full" }
  | { readonly kind: "lock_io"; readonly code: string }
  | LeaseRowInvalid;

export interface LeaseService {
  acquire(resource: LeaseResource, holder: LeaseHolder): Result<LeaseToken, LeaseError>;
  /** 하트비트 한 번. 소유가 바뀌었으면 lease_lost */
  renew(token: LeaseToken): Result<void, LeaseError>;
  /** 행을 반납 상태로 두고 OS 잠금을 푼다. 이미 잃었으면 ok(아무 일 없음) */
  release(token: LeaseToken): Result<void, LeaseError>;
  /** 쓰기 트랜잭션 안에서 행을 새로 읽어 대조한다(TX-10). 캐시를 쓰지 않는다 */
  holds(tx: SqlTx, token: LeaseToken): Result<boolean, LeaseRowInvalid>;
  /** 읽기 연결로 현재 소유 정보를 본다. 표시용 */
  inspect(
    resource: LeaseResource,
  ): Result<LeaseOwnerInfo | null, { readonly kind: "busy" } | LeaseRowInvalid>;
  /** heartbeatMs마다 renew. 실패가 lease_lost면 onLost를 한 번 부르고 멈춘다 */
  keepAlive(token: LeaseToken, onLost: (resource: LeaseResource) => void): Disposable;
}
```

```ts
// xeon/packages/contracts/src/records/migrations.ts
import type { Result } from "../base/index.ts";
import type { JsonValue } from "../conversation/index.ts";
import type { SqlTx } from "./sql.ts";

export interface MigrationStep {
  readonly version: number;             // 1부터 1씩
  readonly sql: readonly string[];      // DDL과 작은 DML. 체크섬 대상
}

export interface MigrationSet {
  readonly owner: string;               // §3.5 소유자 id
  readonly version: number;             // = steps 마지막 version
  readonly steps: readonly MigrationStep[];
}

/** F.records.spec §3.7 ChunkMigration의 개정안(FR-S5). runChunk는 동기이고 tx를 받는다 */
export interface ChunkMigration<C extends JsonValue> {
  readonly id: string;                  // 예: "0003_parts_backfill"
  readonly initialCursor: C;
  runChunk(tx: SqlTx, cursor: C, budget: { readonly maxRows: number }): { readonly next: C | null; readonly processed: number };
}

export type MigrationError =
  | { readonly kind: "migration_checksum_mismatch"; readonly owner: string; readonly version: number }
  | { readonly kind: "migration_future_version"; readonly owner: string; readonly dbVersion: number; readonly codeVersion: number }
  | { readonly kind: "migration_gap"; readonly owner: string; readonly expected: number; readonly got: number }
  | { readonly kind: "migration_failed"; readonly owner: string; readonly version: number; readonly code: string }
  | { readonly kind: "busy" }
  | { readonly kind: "disk_full" };

export interface MigrationReport {
  readonly owner: string;
  readonly from: number;
  readonly to: number;
}

export interface MigrationRunner {
  apply(set: MigrationSet): Result<MigrationReport, MigrationError>;
  /** 청크마다 별도 트랜잭션. 커서를 같은 트랜잭션에 저장한다. 중단 뒤 저장된 커서부터 이어간다 */
  runChunked<C extends JsonValue>(owner: string, m: ChunkMigration<C>, options?: { readonly maxRows?: number; readonly signal?: AbortSignal }): Promise<Result<{ readonly done: boolean; readonly processed: number }, MigrationError>>;
}

export type ExtensionTableError =
  | { readonly kind: "ext_id_invalid"; readonly name: string; readonly reason: "pattern" | "reserved" }
  | { readonly kind: "table_not_owned"; readonly name: string; readonly table: string }
  | { readonly kind: "busy" }
  | { readonly kind: "disk_full" }
  | { readonly kind: "io"; readonly code: string };

export interface ExtensionTables {
  /** name은 F ExtensionName(하이픈 허용). sys_prefixes에 owner "ext.<name>"과 접두 x_<하이픈→밑줄>_를 등록한다. 이미 있으면 ok */
  register(name: string): Result<{ readonly owner: string; readonly tablePrefix: string }, ExtensionTableError>;
  /** tables에 적힌 정확한 이름만 DROP하고, sys_migrations·sys_migration_cursors·sys_prefixes 행 삭제를 한 트랜잭션에서 한다(§4.5) */
  drop(name: string, tables: readonly string[]): Result<{ readonly dropped: readonly string[] }, ExtensionTableError>;
}
```

### 3.2 패키지 공개 API (L0 platform-store)

조립 루트(`apps/host`, DR-14 예외 2)만 아래 함수를 import한다. 다른 컨텍스트는 Cordis 서비스 `xeon.store`로만 쓴다.

```ts
// xeon/packages/platform-store/src/index.ts
import type { Clock, Scheduler } from "@xeon/contracts";           // F 루트 base(review.decisions-2 U-03), L0.os.spec §3.4
import type { FsKind } from "@xeon/contracts/services";            // L0.os.spec §3.3(review.decisions-2 D-04). 값 local | network | drvfs | unknown
import type { IdFactory } from "@xeon/contracts/conversation";
import type { FaultInjector, MigrationError, StoreDb, StoreService } from "@xeon/contracts/records";
import type { BlobPins } from "./blob.ts";
import type { Result } from "@xeon/contracts";

/** xeon.os에서 받은 판정과 경로. platform-store는 OS를 직접 판정하지 않는다(DR-13 선택 지점은 select.ts).
 *  openStore와 임대 판정은 동기 경로라 조립 루트가 xeon.os의 비동기 질의를 미리 풀어 값이나 동기 함수로 넘긴다 */
export interface StoreEnvironment {
  readonly platform: "darwin" | "linux" | "win32";                 // OsService.info.platform
  readonly wsl: boolean;                                           // OsService.info.isWsl
  /** dirname(dbPath)의 판정. 조립 루트가 OsService.fsKind(dir, signal)를 열기 전에 await해 넘긴다. 오류면 "unknown" */
  readonly dbDirFsKind: FsKind;                                    // FR-S8
  readonly bundledSqlitePath: string | null;                       // macOS 동봉 dylib. OsService.dirs.resource 아래
  readonly machineId: string;                                      // OsService.machineId. LeaseHolder.host
  /** OsService.processStartFingerprint(동기). 프로세스가 없으면 null. §4.7.4 후퇴안의 생존 판정 */
  readonly processStartedAt: (pid: number) => number | null;
}

export interface OpenStoreOptions {
  readonly dbPath: string;                                         // 절대 경로
  readonly env: StoreEnvironment;
  readonly clock: Clock;
  readonly scheduler: Scheduler;                                   // keepAlive 하트비트, GC 지연 실행(§4.7.3, §4.9)
  readonly ids: IdFactory;
  readonly settings: StoreSettings;                                // §6 l0.store.* 유효 값
  readonly faults?: FaultInjector;                                 // 테스트 전용. 운영은 생략
  readonly engineVersion: string;
}

export interface StoreSettings {
  readonly heartbeatMs: number;
  readonly leaseTtlMs: number;
  readonly busyTimeoutMs: number;
  readonly blobGraceMs: number;
  readonly requireFts5: boolean;
  readonly macFullFsync: boolean;
  readonly customSqlitePath: string | null;
}

export type StoreOpenError =
  | { readonly kind: "db_path_invalid"; readonly reason: "not_absolute" | "is_directory" }
  | { readonly kind: "unsupported_filesystem"; readonly fsKind: "network" | "drvfs"; readonly dir: string }
  | { readonly kind: "permission"; readonly path: string; readonly mode: number }
  | { readonly kind: "foreign_database"; readonly applicationId: number }
  | { readonly kind: "fts5_missing" }
  | { readonly kind: "sqlite_load_failed"; readonly path: string }   // §4.1 2번: 지정한 커스텀 SQLite dylib을 불러오지 못함
  | { readonly kind: "corrupt"; readonly code: string }
  | { readonly kind: "busy" }
  | { readonly kind: "disk_full" }
  | { readonly kind: "io"; readonly code: string }
  | MigrationError;                                                // owner "sys"와 "core.persistence"의 마이그레이션 실패

export interface OpenedStore extends AsyncDisposable {
  readonly service: StoreService;                                  // Cordis xeon.store로 등록
  readonly root: StoreDb;                                          // core-persistence 전용 (eng.transactions.design §4.2)
  readonly blobPins: BlobPins;                                     // core-persistence 전용 (§3.4)
  readonly warnings: readonly StoreWarning[];
  close(): Promise<void>;                                          // §4.4 종료 절차
}

export type StoreWarning =
  | { readonly kind: "fs_unknown"; readonly dir: string }
  | { readonly kind: "fts5_missing" }
  | { readonly kind: "lock_provider_none" }
  | { readonly kind: "checkpoint_incomplete"; readonly busy: number; readonly log: number; readonly checkpointed: number };

export declare function openStore(options: OpenStoreOptions): Promise<Result<OpenedStore, StoreOpenError>>;

/** L0 등록 단위. setup(ctx)가 ctx.providePort로 opened.service를 xeon.store에 등록한다. 조립 루트가 ExtHost.registerPlatform으로 등록한다(X.primitives.spec §3.2) */
export declare function storePlugin(opened: OpenedStore): PlatformModule;   // name: "platform-store"
```

- 루트 핸들 전달: [제안] 조립 루트가 `core-persistence` 플러그인 설정으로 `root`와 `blobPins`를 넘긴다. 다른 플러그인은 이 값을 받을 수 없다(`eng.transactions.design` §4.2 끝 단락, CM-02). Cordis 설정 전달 방식은 `X.primitives.spec`이 정한다 [가정].

### 3.3 sys 스키마 DDL

[제안] owner `sys`의 마이그레이션을 세 단계로 나눈다. 단계는 구현 마일스톤과 같은 순서로 배포되고, §4.6 규칙대로 한 번 배포한 단계의 SQL은 고치지 않는다. 모든 테이블은 `STRICT`다.

| sys 버전 | 테이블 | 마일스톤 | 작업(`L0.store.plan`) |
|---|---|---|---|
| 1 | `sys_meta`, `sys_migrations`, `sys_migration_cursors`, `sys_prefixes` | M0 | ST-05 |
| 2 | `sys_leases` | M0 | ST-12 |
| 3 | `sys_blobs`, `sys_blob_refs` | M1 | ST-14 |

- 아래 DDL은 세 단계를 합쳐 적은 것이다. 각 테이블 앞 주석이 단계다.
- 단계 번호는 빈칸 없이 오르므로(§4.6 `migration_gap`) 3단계는 2단계 뒤에만 적용된다.
- 복구 표식은 sys 테이블로 두지 않는다. `L1.persistence.spec` §4.8.1이 이벤트에서 만드는 `p_threads` 열(`running_since`, `resume_attempts`)로 정한다(§4.8).

```sql
-- sys v1
CREATE TABLE sys_meta (
  key   TEXT PRIMARY KEY,               -- 'store_id' | 'created_at' | 'created_by' | 'last_opened_by'
  value TEXT NOT NULL
) STRICT;

CREATE TABLE sys_migrations (
  owner          TEXT NOT NULL,         -- 'sys' | 'core.persistence' | 'cap.knowledge' | 'ext.helm' …
  version        INTEGER NOT NULL CHECK (version >= 1),
  checksum       TEXT NOT NULL CHECK (length(checksum) = 64),   -- sha256 hex, §4.6
  applied_at     INTEGER NOT NULL,
  engine_version TEXT NOT NULL,
  PRIMARY KEY (owner, version)
) STRICT;

CREATE TABLE sys_migration_cursors (
  owner        TEXT NOT NULL,
  migration_id TEXT NOT NULL,
  cursor       TEXT,                    -- JSON. NULL이면 완료
  processed    INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (owner, migration_id)
) STRICT;

CREATE TABLE sys_prefixes (
  owner         TEXT PRIMARY KEY,       -- 'cap.knowledge' | 'ext.helm' …
  kind          TEXT NOT NULL CHECK (kind IN ('core', 'extension')),
  names         TEXT NOT NULL,          -- JSON 배열. 접두('cap_knowledge_') 또는 정확한 이름('events')
  registered_at INTEGER NOT NULL
) STRICT;

-- sys v2
CREATE TABLE sys_leases (
  resource     TEXT PRIMARY KEY,        -- 'session:<threadId>' | 'scheduler' | 'service'
  holder_id    TEXT NOT NULL,
  epoch        INTEGER NOT NULL CHECK (epoch >= 1),
  kind         TEXT NOT NULL CHECK (kind IN ('cli', 'app', 'service')),
  pid          INTEGER NOT NULL,
  started_at   INTEGER NOT NULL,        -- 프로세스 시작 시각 지문 (pid 재사용 구분)
  host         TEXT NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  released_at  INTEGER                  -- NULL이면 보유 중
) STRICT;

-- sys v3
CREATE TABLE sys_blobs (
  sha256      TEXT PRIMARY KEY CHECK (length(sha256) = 64),
  size        INTEGER NOT NULL CHECK (size >= 0),
  media_type  TEXT,
  created_at  INTEGER NOT NULL,
  last_put_at INTEGER NOT NULL          -- 같은 해시 재쓰기 요청 시 갱신. GC 유예의 기준
) STRICT;

CREATE TABLE sys_blob_refs (
  sha256  TEXT NOT NULL REFERENCES sys_blobs(sha256),
  owner   TEXT NOT NULL,                -- 'core.persistence' 등
  ref_key TEXT NOT NULL,                -- 'thread:<threadId>' 등. 해제 단위
  PRIMARY KEY (sha256, owner, ref_key)
) STRICT;
CREATE INDEX sys_blob_refs_by_key ON sys_blob_refs (owner, ref_key);
```

- `sys_meta.store_id`: 새 파일을 만들 때 `sto_<ULID>`를 한 번 쓴다. `IdPrefix`에 `sto`가 없어서 [가정] `IdFactory` 대신 L0 내부 ULID 생성기로 만들고, `sto` 추가는 `F.wire-settings.spec` §10 미결 7의 결과를 따른다.
- `sys_leases.released_at`: [제안] 반납 때 행을 지우지 않고 `released_at`만 채운다. `eng.transactions.design` §3.3 규칙 4("정상 종료 때 행을 지운다")와 다르다. 행을 지우면 다음 획득의 epoch가 1로 돌아가므로 epoch 단조성을 지키기 위해 남긴다. 그 문서 수정 요청은 §8.1 FR-S2다.
- `sys_leases.kind`: 별도 소유 테이블을 두지 않고 `sys_leases` 행이 소유 표시를 겸한다(`kind` 열: cli|app|service) [결정: review.decisions-2 U-09]. 소유 판정은 OS 잠금과 epoch가 하고 `kind`·`pid`·`host`는 표시용이며, 표시 정보가 틀려도 안전하다. 이 문장은 `L0.process.spec` §4.5와 같다.
- `sys_blob_refs`: [제안] 블롭 참조 기록이다. `core-persistence`는 `BlobRef`를 담은 이벤트를 커밋하는 같은 트랜잭션에서 `pinBlob(tx, sha256, owner, refKey)`(§3.4)를 부른다. GC는 이 테이블만 보고 판정하므로 이벤트 payload를 훑지 않는다.

### 3.4 내부 연산 시그니처

```ts
// xeon/packages/platform-store/src/blob.ts (루트 핸들 쪽 보조, core-persistence에 OpenedStore로 넘긴다)
export interface BlobPins {
  pin(tx: SqlTx, sha256: string, owner: string, refKey: string): void;
  /** 세션 삭제 때 그 ref_key 행을 지운다 */
  unpinAll(tx: SqlTx, owner: string, refKey: string): number;
}
```

- [제안] `OpenedStore.blobPins`로 `core-persistence`에만 넘긴다. 범위 핸들 소유자(`cap.*`, `ext.*`)가 블롭을 참조할 때는 `StoreService`에 `pinBlob(owner, …)`을 열지 [미결 S-7]이다. M1 범위의 블롭 소비자는 `core-persistence`뿐이다.

```ts
// xeon/packages/platform-store/src/lock/provider.ts
export interface LockHandle {
  readonly key: string;
  release(): void;
}
export type LockAcquireError =
  | { readonly kind: "held" }
  | { readonly kind: "unsupported" }
  | { readonly kind: "io"; readonly code: string };

/** OS provider. 프로세스가 죽으면 OS가 잠금을 푼다. 블로킹하지 않는다(LOCK_NB) */
export interface LockProvider {
  readonly kind: "flock" | "win32" | "none";
  tryAcquire(key: string): Result<LockHandle, LockAcquireError>;
}
```

- `select.ts`가 `env.platform`으로 provider를 고른다(DR-13, `L0.readme` §3.1 선택 지점 한 곳). `darwin`·`linux` → `posix.ts`(bun:ffi `flock`), `win32` → `win32.ts`(M2 이후, 수단 [미결 S-5]), 로드 실패 → `none`(DB 임대만, §4.7.4 후퇴안).

## 4. 동작 규칙

### 4.1 SQLite 로드와 FTS5 프로브

[결정] 시작 시 FTS5를 검사하고, macOS는 `Database.setCustomSQLite`로 FTS5가 든 SQLite를 지정한다(adr.0004 §3.5, TC-11). 순서는 아래로 고정한다(adr.0004 §3.5 [제안]을 이 문서가 확정한다).

1. 경로 결정. `env.platform === "darwin"`이면 `settings.customSqlitePath ?? env.bundledSqlitePath`를 쓴다. 다른 플랫폼은 커스텀 경로를 쓰지 않는다(Bun이 정적 링크한 SQLite, `_research/stack-status.md §7-D`).
2. 첫 `new Database()` 전에 `Database.setCustomSQLite(path)`를 한 번 부른다. 반환값으로 성공을 판정하지 않는다(Bun 1.4.3은 비-macOS에서도, 없는 경로에도 `true`, TC-11). 이미 로드된 뒤 다른 경로를 지정하면 "SQLite already loaded" 오류가 난다(adr.0004 §3.5 2번). 그래서 `sqlite-env.ts`는 모듈 상태 `loaded: { path: string | null } | undefined`를 두고, `Database` 생성은 모두 이 모듈의 `newDatabase()`를 거친다. 다른 경로로 두 번째 초기화를 부르면 `Bug(store.sqlite_already_loaded)`다. 이 패키지 밖은 `bun:sqlite`를 import하지 않으므로(DR-07) 프로세스 안 첫 `Database`는 이 함수가 만든다. **macOS 실측(2026-10-25, macOS 26.5.2, Apple silicon, Bun 1.4.3)**: 없는 경로(`/nonexistent/libsqlite3.dylib`)를 주면 `setCustomSQLite`가 dlopen 오류를 던진다("true를 돌려준다"는 비-macOS 관찰이다). 사용자나 배포가 정한 dylib을 못 불러오는 것은 예상된 실패이므로 `initSqlite`는 던지지 않고 `err({ kind: "sqlite_load_failed", path })`를 돌려주고 `openStore`는 그대로 열기 실패로 돌려준다. 번들 SQLite로 조용히 되돌리지 않는다(지정한 FTS5·버전 가정이 깨지므로 알려야 한다). 실패하면 `loaded`를 남기지 않아 올바른 경로로 다시 부를 수 있다. 테스트는 `OpenStoreOptions.loadCustomSqlite`(테스트 전용)로 dlopen 실패를 어느 OS에서나 흉내 낸다.
3. 임시 `:memory:` 연결에서 `CREATE VIRTUAL TABLE temp.fts5_probe USING fts5(x)`, 한 행 삽입, `MATCH` 질의 결과 `n === 1`을 본다. 이 단계가 판정 기준이다(필수). 코드는 `eng.toolchain.guide` TC-11 좋은 예와 `eng.anti-patterns.guide`의 `probeFts5(db): Result<void, {kind:"fts5_missing"}>`를 그대로 쓴다.
4. 진단으로 `PRAGMA compile_options`에서 `ENABLE_FTS5`를, `select sqlite_version()`을 기록한다. 판정에는 쓰지 않는다.
5. 결과를 `capabilities.fts5`, `sqliteVersion`, `customSqlitePath`에 담는다.

프로브 실패 때 운영 시작 동작(TC-11이 이 문서에 넘긴 [미결]):

| 상황 | 동작 | 표지 |
|---|---|---|
| 운영 시작, `requireFts5 = false`(기본) | 저장소는 연다. `capabilities.fts5 = false`, `warnings`에 `fts5_missing`. FTS5를 쓰는 기능(세션 검색 `cap_knowledge_*` FTS)만 끈다 | [제안] |
| 운영 시작, `requireFts5 = true` | `err({ kind: "fts5_missing" })`로 열기 실패 | [제안] |
| 개발 환경 검사(`just status`, 테스트 preload) | 종료코드 2(환경 문제). 메시지에 SQLite 경로와 `compile_options` 진단을 담는다 | [제안] TC-11 |

- [실측: macOS 26.5.2, Apple silicon, Bun 1.4.3, 2026-10-25] 시스템 `bun:sqlite`는 SQLite 3.51.0이고 `create virtual table … using fts5(x, tokenize="trigram")`가 성공해 프로브가 참이다. 따라서 macOS 26에서는 동봉 dylib 없이도 FTS5가 있다. 동봉 dylib(ST-21)은 대비책으로 남기며, 낮은 macOS 버전은 미실측이다. Homebrew sqlite(`/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib`)는 있으나 자동 탐색하지 않는다.
- 근거: 세션 저장의 핵심(이벤트, 재개)은 FTS5 없이 동작한다. 검색이 빠진 상태로라도 대화를 이어 쓸 수 있는 편이 사용자 손실이 작다. 확정은 [미결 S-4]다.
- FTS5 소비자 규칙: `CREATE VIRTUAL TABLE … USING fts5`를 담은 마이그레이션 단계는 `capabilities.fts5`가 거짓이면 그 소유자가 건너뛸 수 있게 `MigrationSet`을 두 벌(FTS 있음·없음) 선언하지 않고, 소유자가 FTS 테이블을 별도 owner(예: `cap.knowledge.fts`)로 나눠 조건부로 `apply`한다 [제안].
- macOS 배포: FTS5를 포함해 빌드한 SQLite dylib을 앱 리소스 디렉터리에 동봉하고, 경로는 `xeon.os`의 리소스 디렉터리 질의로 얻는다(`env.bundledSqlitePath`) [제안]. 동봉 빌드 방법과 서명은 `L4.desktop.plan`, CLI 배포 경로는 `L4.cli.plan`이 정한다. Homebrew 경로 자동 탐색은 하지 않는다(재현성). 사용자가 다른 dylib을 쓰려면 설정 `l0.store.customSqlitePath`를 쓴다(adr.0004 §6 미결 "dylib 경로 지정 방식"에 대한 제안).
- [제안] 프로세스 안에서 `bun:sqlite` 외 SQLite 로더(`node:sqlite` 등)를 쓰지 않는다(adr.0004 §3.5 [제안], `eng.dependency-rules.guide` DR-07 금지 목록). macOS에서 두 모듈이 같은 라이브러리를 공유하기 때문이다.

### 4.2 DB 위치와 환경 검사

- 경로는 호출자(`apps/host`)가 `xeon.os`에서 얻어 `openStore({ dbPath })`로 넘긴다. 상대 경로면 `db_path_invalid`다. platform-store는 데이터 디렉터리를 정하지 않는다.
- 디렉터리는 없으면 0700으로 만든다. 있으면 모드를 검사해 그룹·기타 권한 비트가 있으면 `warnings`에 남기고 0700으로 고친다 [제안]. 소유자가 현재 사용자가 아니면 `permission`이다.
- 파일 존재 검사: bun:sqlite의 `fileMustExist` 옵션은 쓰지 않는다(Bun 1.4.3에서 오류, TC-11). 열기 전에 `fs.statSync`로 존재를 확인하고 새 파일 여부를 기억한다.
- 새 파일이면 열고 첫 PRAGMA 전에 `chmod 0600`을 한다. 기존 파일은 모드를 검사해 고친다. `-wal`, `-shm` 파일은 SQLite가 DB 파일 권한에 맞춰 만든다 [가정: SQLite 문서 미대조]. 열기 뒤 두 파일의 모드도 검사한다.
- 파일시스템 판정은 `env.dbDirFsKind`(조립 루트가 `xeon.os`의 `fsKind`로 미리 푼 값, §3.2)로 받는다. 값 집합은 F `FsKind`(`L0.os.spec` §3.3)다. 판정은 아래와 같다 [제안].

| `fsKind` | 예 | 동작 |
|---|---|---|
| `local` | ext4, APFS, NTFS(로컬) | 연다 |
| `network` | SMB, NFS, AFP | `unsupported_filesystem`으로 거부. WAL은 공유 메모리(`-shm`)를 쓰므로 네트워크 파일시스템에서 동작하지 않는다(SQLite WAL 문서) |
| `drvfs` | WSL의 `/mnt/<drive>`(drvfs·9p) | 거부. flock·fsync 동작이 확인되지 않았다(`_research/notes/L0-2.md §2.7`) |
| `unknown` | 판정 실패, FUSE 등 `xeon.os` 분류 표에 없는 값 | 연다. `warnings`에 `fs_unknown` |

### 4.3 연결 설정

[제안] 쓰기 연결은 항상 `synchronous=FULL`이다. 단계 경계 FULL([결정], `_research/foundation-plan.md` §2 DB 행)의 구현 방식은 adr.0004 §3.2가 이 문서에 넘겼다. 이 문서는 `eng.transactions.design` §3.2의 "항상 FULL" 권고를 채택한다. 근거:

- 커밋마다 모드를 바꾸면 전환 코드가 오류의 자리가 된다. 단계 경계 커밋을 NORMAL로 잘못 두면 "응답한 것은 잃지 않는다"(adr.0004 §4.1)가 깨진다.
- 단계 경계가 아닌 커밋(임대 하트비트, 입력 수락, 블롭 행 기록)은 빈도가 낮다. 하트비트는 세션마다 5초에 한 번이다. 추가 fsync 비용이 작다.
- WAL에서 FULL은 커밋마다 WAL 파일을 한 번 더 동기화해 정전에도 커밋을 보존한다. NORMAL도 일관성은 같고 내구성만 다르다(SQLite `pragma.html` synchronous 절).

쓰기 연결 PRAGMA(순서대로 적용, 적용 뒤 조회로 검증):

| PRAGMA | 값 | 근거 |
|---|---|---|
| `journal_mode` | `WAL` | adr.0004 §3.1. 읽기 여럿 + 쓰기 하나. 반환값이 `wal`이 아니면 `io`(`code: "WAL_UNAVAILABLE"`)로 열기 실패 |
| `synchronous` | `FULL`(2) | 위 근거. 조회값 2를 수용 기준으로 둔다(`eng.transactions.design` §10 기준 9) |
| `busy_timeout` | `5000`(`l0.store.busyTimeoutMs`) | Bun 기본값 0. 명시하지 않으면 다른 프로세스 쓰기와 즉시 `SQLITE_BUSY`(TC-11) |
| `foreign_keys` | `ON` | 연결마다 기본 꺼짐. `sys_blob_refs` 참조 무결성 |
| `temp_store` | `MEMORY` | 임시 테이블·정렬을 공유 임시 디렉터리 파일에 두지 않는다 |
| `wal_autocheckpoint` | `1000` | 페이지 1000개(기본 4 KiB면 약 4 MiB)마다 자동 체크포인트. SQLite 기본값과 같은 값을 명시해 고정한다 |
| `journal_size_limit` | `67108864`(64 MiB) | 체크포인트 뒤 남는 WAL 파일 크기 상한. 기본값 -1(무제한)이면 한 번 커진 WAL이 줄지 않는다(SQLite `pragma.html`) |
| `trusted_schema` | `OFF` | SQLite가 모든 연결에 권장한다. 스키마에 든 함수·가상 테이블을 신뢰하지 않으므로 조작된 DB 파일의 영향을 줄인다 |
| `application_id` | `1480937294`(0x58454F4E 'XEON') | 새 파일에서만 설정한다. 기존 파일은 조회값을 대조하고 0이 아닌 다른 값이면 `foreign_database`. 0이면서 `sqlite_schema`가 비어 있으면 새 파일로 본다 |
| `fullfsync` | macOS에서 `ON` [제안], 그 밖은 설정하지 않음 | 아래 macOS 항목 |

읽기 연결:

- `new Database(path, { readonly: true })`로 연다. 열기 전에 파일 존재를 검사한다. 쓰기 연결이 WAL을 만든 뒤에 연다.
- `PRAGMA query_only = ON`, `busy_timeout = 5000`, `trusted_schema = OFF`, `temp_store = MEMORY`를 건다.
- 연결 수는 하나다 [제안]. 장시간 읽기 트랜잭션은 체크포인트를 막아 WAL을 키우므로 `read`의 콜백은 동기이고 짧아야 한다(§5 WAL 증가 행).

macOS `fullfsync` [제안]:

- macOS의 `fsync`는 드라이브 쓰기 캐시를 비우지 않는다. SQLite는 `F_FULLFSYNC` 방식을 `PRAGMA fullfsync`로 켠다. 기본값은 꺼짐이고 macOS만 지원한다. `fullfsync`가 켜지면 모든 동기화가 `F_FULLFSYNC`를 쓰고 `checkpoint_fullfsync` 설정은 의미가 없다(SQLite `pragma.html` fullfsync·checkpoint_fullfsync 절, 2026-10-21 확인).
- 제안: macOS 쓰기 연결에 `fullfsync = ON`을 건다. 설정 `l0.store.macFullFsync`(기본 true)로 끌 수 있다. 끄면 `checkpoint_fullfsync = ON`만 건다.
- 비용: 커밋마다 `F_FULLFSYNC` 한 번이 든다. 한 모델 단계의 커밋 수는 도구 호출 수를 n이라 할 때 `3 + 3n`(도구마다 E1 의도, E2 실행 시작, E3 결과 커밋, `eng.transactions.design` §3.2, `L1.persistence.spec`)이다 [결정: review.decisions-2 U-10]. 이 수는 모델 호출 시간에 비해 작다고 본다 [가정]. 측정은 `L0.store.plan` ST-17이다. Apple 시스템 SQLite나 동봉 SQLite의 컴파일 기본값이 다를 수 있으므로 적용 뒤 조회로 확인한다 [가정].

### 4.4 열기와 종료 절차

열기(`openStore`):

1. §4.1 SQLite 로드와 프로브
2. §4.2 경로·권한·파일시스템 검사
3. 쓰기 연결 열기, §4.3 PRAGMA 적용과 조회 검증
4. owner `sys` 마이그레이션 적용(§4.6). `PRAGMA user_version`은 sys 버전과 같게 둔다(외부 도구 확인용)
5. 새 파일이면 `sys_meta`에 `store_id`, `created_at`, `created_by` 기록. `last_opened_by` 갱신
6. 코어 접두사 소유표 등록(§4.5). `TABLE_PREFIX_OWNERS`의 코어 행을 `sys_prefixes`에 맞춘다
7. 읽기 연결 열기
8. `LockProvider` 선택(`select.ts`). `none`이면 `warnings`에 `lock_provider_none`
9. 블롭 디렉터리(`<db 디렉터리>/blobs`, `blobs/tmp`) 0700 확인
10. `StoreService` 객체 조립

종료(`close`):

1. 새 `write` 호출을 `Bug(store.closed)`로 막는다
2. 이 프로세스가 쥔 임대를 모두 `release`한다(keepAlive 정지 포함)
3. 쓰기 연결에서 `PRAGMA wal_checkpoint(TRUNCATE)`. 결과 `busy`가 0이 아니면 `checkpoint_incomplete` 경고만 남긴다(다른 프로세스가 읽는 중일 수 있다)
4. 읽기 연결, 쓰기 연결 순서로 닫는다
5. OS 잠금 핸들을 모두 푼다

### 4.5 트랜잭션과 접두사 소유 검사

`write`:

- [제안] `db.transaction(fn).immediate()`로 구현한다. 안쪽 `write` 호출은 저장점이 되므로 막는다. 연결 객체마다 `inWrite` 표지를 두고 이미 켜져 있으면 `Bug(store.nested_write)`다. `putBlob`, `acquire`, `renew`, `release`, `migrations.apply`를 `write` 콜백 안에서 부르는 것도 같은 Bug다(TX-04). 직접 `BEGIN IMMEDIATE` 문장으로 갈지는 `eng.transactions.design` 미결 T-2를 따른다.
- 콜백이 Promise를 돌려주면 `Bug(store.async_tx)`다(TX-01). 반환값이 thenable인지 검사한다.
- 오류 매핑은 `SQLiteError.code`로 한다. 메시지 문자열로 판정하지 않는다(TS-07).

| SQLite 코드 | 결과 |
|---|---|
| `SQLITE_BUSY`, `SQLITE_BUSY_*`, `SQLITE_LOCKED` | `err({ kind: "busy" })` |
| `SQLITE_FULL` | `err({ kind: "disk_full" })` |
| `SQLITE_IOERR*`, `SQLITE_READONLY*`, `SQLITE_CANTOPEN` | `err({ kind: "io", code })` |
| `SQLITE_CORRUPT*`, `SQLITE_NOTADB` | `err({ kind: "io", code })`. 손상은 코드나 설정이 올바라도 생기는 예상 가능한 실패라 `Bug`가 아니다(`eng.typescript.guide` TY-24). 열기 중이면 `StoreOpenError` `corrupt` |
| `SQLITE_CONSTRAINT*`, `SQLITE_ERROR`(SQL 오류) | 콜백 예외로 보고 그대로 다시 던진다(호출자 버그) |
| 콜백이 던진 값 | 롤백 후 그대로 다시 던진다 |

접두사 소유:

- 소유자 id와 테이블 이름 집합은 `TABLE_PREFIX_OWNERS`(`eng.context-map.design` §5.4)와 `sys_prefixes`가 정한다.

| 소유자 id | 이름 | 등록 |
|---|---|---|
| `sys` | `sys_` | 이 패키지. 범위 핸들 없음 |
| `core.persistence` | `events`, `requests`, `step_checkpoints`, `projector_state`, `consumer_cursors`, `p_` | 루트 핸들만. `scoped("core.persistence")`는 Bug |
| `xh` | `xh_` | 코어 |
| `core.models`, `core.tools` | `core_models_`, `core_tools_` | 코어 |
| `cap.<도메인>` | `cap_<도메인>_` | 코어(L2 layout 도메인 8개) |
| `ext.<확장 이름>` | `x_<확장 이름의 하이픈을 밑줄로 바꾼 값>_` | `extensions.register(name)` |

- 확장 이름 규칙 [제안]: `register(name)`은 `F.extensions.spec`의 `ExtensionName`(`EXTENSION_NAME_PATTERN`, `^[a-z][a-z0-9-]{1,31}$`, 하이픈 허용, 밑줄 없음)을 받는다 [결정: review.decisions-2 U-18]. 어기면 `ext_id_invalid{reason:"pattern"}`이다. 예약어 `core`, `cap`, `xh`, `sys`, `ext`(`RESERVED_EXT_IDS`, `eng.context-map.design` §5.4)는 `ext_id_invalid{reason:"reserved"}`다. 테이블 접두는 `x_<확장 이름의 하이픈을 밑줄로 바꾼 값>_`이다(U-18, `eng.context-map.design` §5.2 `extTablePrefix`). 예: `acme-notes` → `x_acme_notes_`. 이 변환은 일대일이다(확장 이름에 밑줄이 없다). `eng.context-map.design` §5.2·CM-07도 같은 규칙이다(U-18).
- 확장 테이블 소유 판정 [제안]: 접두 문자열 일치만으로 판정하지 않는다. 확장 `ab`의 접두 `x_ab_`는 확장 `ab-cd`의 테이블 `x_ab_cd_ef`의 앞부분과도 같기 때문이다. 테이블 이름 `t`가 확장 `E`의 것이려면 `t`가 `E`의 접두로 시작하고 나머지(지역 이름)가 `^[a-z][a-z0-9]{0,31}$`(밑줄 없음)이어야 한다. `X.operations.spec` §3.4 `parseExtTableName`과 같은 규칙이고, L0는 X를 import할 수 없으므로(DR-02) 같은 규칙을 이 패키지 안에 따로 구현한다. 이 규칙으로 `x_ab_cd_ef`의 소유 확장은 `ab-cd` 하나로 정해진다. 그래서 `ab`와 `ab-cd`는 둘 다 등록할 수 있다(`X.operations.spec` §9 18번과 같다). 범위 핸들의 문장 검사(아래 표)와 `drop`의 대상 검사가 이 판정을 쓴다.
- 문장 검사 [제안]:

| 빌드 | 검사 | 방법 |
|---|---|---|
| 테스트·디버그(`XEON_STORE_STRICT=1` 또는 `NODE_ENV !== "production"`) | 범위 핸들의 모든 문장이 소유 테이블만 읽고 쓰는지 | 문장을 처음 볼 때 `EXPLAIN <sql>`을 실행해 `OpenRead`·`OpenWrite`의 `p2`(루트 페이지)를 `sqlite_schema.rootpage`에 대조하고 `tbl_name`을 얻는다. 소유 밖 이름이면 `Bug(store.prefix_not_owned)`. 결과는 SQL 문자열별로 캐시하고 `PRAGMA schema_version`이 바뀌면 루트 페이지 표를 다시 읽는다. 루트 페이지 1(`sqlite_schema`) 읽기는 허용한다 |
| 운영 | DDL 문장만 | 문장 앞머리가 `CREATE`·`DROP`·`ALTER`·`ATTACH`·`DETACH`·`PRAGMA`면 대상 이름을 어휘 분석으로 뽑아 소유를 확인한다. `ATTACH`·`DETACH`와 쓰기 `PRAGMA`는 범위 핸들에서 항상 Bug |

- 비용 근거: `EXPLAIN`은 문장마다 한 번 더 준비(prepare)하고 결과 행을 훑는다. 캐시로 같은 문장은 한 번만 하지만 동적 SQL이 많으면 비용이 남는다. 운영 빌드에 켤지는 ST-07 측정(문장 1만 개, 캐시 적중률) 뒤 정한다 [미결 S-8]. 가상 테이블(FTS5)의 그림자 테이블 접근은 `VOpen`/`VFilter` 안에서 일어나 `EXPLAIN`의 `OpenRead`로 보이지 않는다 [가정]. 가상 테이블 자체 이름은 `VOpen`의 대상 테이블로 확인한다 [가정: 실측 필요].
- 범위 핸들의 DDL은 마이그레이션(§4.6) 안에서만 허용한다. 그 밖의 `write`에서 DDL이면 `Bug(store.ddl_outside_migration)`.
- 확장 테이블 삭제(`extensions.drop(name, tables)`) [제안]: `tables`는 등록된 정확한 테이블 이름 목록이다. 호출자는 `X.operations.spec` §4.4.7의 `dropExtension`이고, 그 확장 이름으로 소유 장부 `xh_ext_tables`에 오른 이름을 넘긴다. store는 각 이름이 위 소유 판정으로 `name`의 것인지 먼저 모두 확인하고, 하나라도 아니면 아무것도 지우지 않고 `table_not_owned`를 돌려준다. 확인을 마치면 한 `write`에서 `sqlite_schema`에 있는 이름만 `DROP`한다(없는 이름은 건너뛴다. FTS5 가상 테이블을 지우면 그림자 테이블도 지워진다). 이어서 `sys_migrations`, `sys_migration_cursors`, `sys_prefixes`의 그 owner 행을 지운다. `LIKE` 같은 접두 패턴 삭제는 하지 않는다. 이벤트(`x.<name>.*`)는 남긴다(`eng.context-map.design` §5.2 끝 항목).

### 4.6 마이그레이션 실행기

- `apply(set)`:
  1. `set.owner`가 `sys_prefixes`에 있어야 한다(sys는 예외). 없으면 `Bug(store.prefix_not_owned)`.
  2. `steps`의 version이 1부터 빈칸 없이 오르고 마지막이 `set.version`인지 확인한다. 아니면 `Bug(store.migration_set_invalid)`.
  3. `sys_migrations`에서 그 owner의 행을 읽는다. 각 행의 `checksum`을 코드 단계의 체크섬과 대조한다. 다르면 `migration_checksum_mismatch`. DB 최대 버전이 `set.version`보다 크면 `migration_future_version`. 행 사이에 빈칸이 있으면 `migration_gap`.
  4. 남은 단계를 하나씩 별도 `write`(BEGIN IMMEDIATE)에서 실행한다. 단계의 모든 문장, 그 단계의 `sys_migrations` 행 삽입이 한 트랜잭션이다. 문장 하나가 실패하면 그 단계만 롤백되고 `migration_failed`를 돌려준다. 앞 단계는 남는다.
  5. 모든 DDL 문장은 §4.5 접두사 검사를 운영 빌드에서도 거친다.
  6. 남은 단계가 있고 그 owner의 DB 버전이 1 이상이면(기존 스키마를 올리는 경우) 4번 전에 §4.6.1의 스냅샷을 만든다. 만들지 못하면 어떤 단계도 실행하지 않고 오류를 돌려준다.
- 체크섬: `sha256Hex(steps[i].sql.join("\n;\n"))`. 공백 정규화를 하지 않는다. 한 번 배포한 단계의 SQL은 고치지 않고 새 단계를 더한다.
- 처리 정책 [제안]: owner가 `sys`·`core.persistence`면 오류는 열기 실패다(호출자가 읽기 전용 열기를 고를 수 있게 `migration_future_version`은 따로 구분한다). `cap.*`, `ext.*`면 호출자(X 로딩, L2 플러그인)가 그 능력이나 확장을 끄고 나머지는 계속 연다.
- 청크 마이그레이션 `runChunked(owner, m)`: `sys_migration_cursors`에서 커서를 읽고(없으면 `initialCursor`), 청크마다 `write` 안에서 `m.runChunk(tx, cursor, {maxRows})`와 커서 갱신을 한 트랜잭션으로 한다. `next === null`이면 `cursor = NULL`로 완료를 기록한다. 청크 사이에 `await`로 이벤트 루프를 양보하고 `signal`을 확인한다. 기본 `maxRows`는 500 [제안]. `F.records.spec` §3.7 규칙 6을 구현한다.

#### 4.6.1 마이그레이션 전 스냅샷 [결정: m2 마감 G2-06]

프리뷰 사용자의 DB를 지키기 위한 최소 안전장치다. 내보내기와 복구 런북은 M3다.

- 시점: `apply`가 남은 단계를 실행하기 직전, 그 owner에 적용된 버전이 1 이상일 때만 만든다. 처음 만드는 DB, owner의 첫 등록, 이미 최신인 호출은 만들지 않는다. 열 때의 `sys` 마이그레이션과 소비자가 부르는 `cap.*`·`core.persistence` 마이그레이션이 같은 규칙이다.
- 수단: 쓰기 연결의 `VACUUM INTO '<경로>'`다(WAL 내용을 포함한 일관된 복사). 쓰기 트랜잭션 밖에서만 돈다.
- 위치와 이름: `<db 디렉터리의 realpath>/backups/<db 파일>.pre-<UTC 시각>-<owner>-v<from>-to-v<to>.sqlite`. 시각은 `YYYYMMDDTHHMMSSmmmZ`라 이름순이 시간순이다. 디렉터리는 0700, 파일은 0600이다. 경고의 `path`도 realpath 기준이다(macOS는 `/var/folders/…`가 `/private/var/folders/…`로 나온다. 2026-10-25 macOS 실측). 호출자가 넘긴 `dbPath` 문자열은 바꾸지 않는다.
- 보관: 같은 DB의 스냅샷은 최근 3개(`MIGRATION_SNAPSHOT_KEEP`)만 남기고, 새 스냅샷을 만든 뒤 오래된 것을 지운다. 지우지 못하면 경고 `snapshot_prune_failed`만 남기고 계속한다.
- 알림: 만들 때마다 열기 경고 목록(`OpenedStore.warnings`)에 `migration_snapshot { path, owner, from, to }`를 더한다. 호스트가 이를 로그와 진단에 싣는다.
- 실패: 스냅샷을 만들지 못하면 단계를 하나도 실행하지 않는다. `busy`는 `busy`, `disk_full`(SQLITE_FULL, ENOSPC)은 `disk_full`, 그 밖은 `migration_failed { version: 첫 남은 단계, code: "snapshot_failed:<코드>" }`다. 전용 오류 kind(`migration_snapshot_failed`)는 F 요청이다 [미결 S-12].
- 동시에 처음 여는 프로세스들 [결정: macOS 실측 2026-10-25, 4개 프로세스 첫 열기에서 `migration_failed snapshot_failed:EEXIST`와 `snapshot_failed:SQLITE_ERROR` 관찰]: 스냅샷 여부는 적용 버전을 스냅샷 직전에 다시 읽어 정한다(그 사이 동료가 이미 올렸으면 만들지 않는다). 같은 ms에 같은 전환의 같은 이름 스냅샷이 이미 있으면 동료가 만든 것이므로 만든 것으로 본다. 스냅샷이 실패하면 적용 버전을 한 번 더 읽어, 동료가 그 사이 올렸으면(동료의 마이그레이션이 `VACUUM INTO`와 겹쳐 실패할 수 있다) 새 상태로 다시 정한다. 올리지 않았으면 위 실패 규칙 그대로다: 사용자의 기존 DB는 스냅샷 없이 올리지 않는다.

### 4.7 세션 소유 잠금

#### 4.7.1 판정 장치 [결정: review.decisions-2 U-09]

판정은 두 장치를 함께 쓴다. OS 잠금(생존 판정)과 `sys_leases.epoch` 펜싱이다(`eng.transactions.design` §3.3, `_research/notes/L0-2.md §4.2`). OS 잠금만으로는 잠금을 잃은 옛 소유자의 늦은 쓰기를 막지 못하므로 커밋마다 epoch를 대조한다. adr.0004 §3.4(세션 id 키 OS 잠금만)는 이에 맞게 개정한다.

| 장치 | 맡는 일 | 근거 |
|---|---|---|
| OS 잠금(세션 id 키 `flock`) | 생존 판정. 소유 프로세스가 죽으면 커널이 즉시 풀어 바로 인수한다 | Bun 1.4.3 Linux 실측에서 SIGKILL 뒤 약 10 ms에 재획득(`_research/notes/L0-2.md §2.1`) |
| `sys_leases.epoch` 펜싱 | 늦게 깨어난 이전 소유자의 쓰기 차단. 모든 세션 쓰기 트랜잭션이 `BEGIN IMMEDIATE` 직후 행을 새로 읽어 대조한다(TX-10) | OS 잠금은 SQLite 트랜잭션 안에서 확인할 수 없다(`eng.transactions.design` §3.3). 잠금 디렉터리가 다른 프로세스와는 잠금이 공유되지 않는다(`_research/notes/L0-2.md §2.5`) |

이 판정은 `L0.process.spec` §4.5와 같은 문장이다. adr.0004 §3.4와 adr.0006의 개정은 decisions 문서 담당이 한다.

- 알려진 한계 [결정: review.decisions-2 U-09]: OS 잠금(flock)이 있으면 멈춘 소유자(잠자기, SIGSTOP)는 잠금을 계속 쥔다. 그 프로세스가 깨어나거나 죽을 때까지 세션은 잠긴 채이고, 다른 프로세스의 `acquire`는 `sys_leases.expires_at`이 지나도 `os_lock_held`다. 사용자는 위임·관찰·분기(`L0.process.spec` §4.5 `LockFallbackPolicy`)로 진행하거나 멈춘 프로세스를 끝낸다. 늦은 쓰기를 epoch로 막아야 하는 경우는 OS 잠금을 잃었거나 공유하지 않는 경우다. 예: OS 잠금이 없는 후퇴안(§4.7.4)에서 만료로 인수당한 소유자, 잠금 디렉터리가 다른 프로세스.

#### 4.7.2 OS 잠금 (posix provider)

- 수단: bun:ffi로 libc `flock(fd, LOCK_EX | LOCK_NB)`을 부른다(`_research/notes/L0-2.md §4.1` 1안). Linux는 `dlopen("libc.so.6")`, macOS는 `dlopen("libSystem.B.dylib")` [미확인: macOS 실측 없음].
- 키 파일: `<db 디렉터리>/locks/<hex>.lock`. `hex`는 `sha256Hex(resource)` 앞 32자다. 디렉터리는 0700이고 현재 사용자 소유인지 검사한다(omp `session-storage.ts:620-629` 규칙 차용).
- 잠금 디렉터리를 DB 파일 옆에 둔다 [제안]. 같은 DB 파일을 여는 프로세스는 홈 디렉터리 설정과 무관하게 같은 키 파일을 본다. DB 경로는 `realpath`로 정규화한 뒤 쓴다.
- 키 파일은 지우지 않는다. flock 파일을 unlink하면 옛 inode 보유자와 새 inode 생성자가 한 자원을 둘로 나눠 쥘 수 있다(omp `session-storage.ts:617-618`).
- fd는 `fs.openSync(path, "a+", 0o600)`로 연다. Bun 1.4.3은 O_CLOEXEC로 열어 자식 프로세스가 fd를 물려받지 않는다(실측, `_research/notes/L0-2.md §2.3`). 획득 직후 FD_CLOEXEC를 확인하는 테스트를 둔다.
- 같은 프로세스 안에서 같은 자원을 두 번 획득하면 독립 fd끼리 경합하므로(flock(2)) provider가 프로세스 안 표를 두고 두 번째 요청을 `held`로 돌려준다.
- bun:ffi는 Bun 문서에서 실험 기능으로 표시된다는 요약이 있다 [미확인: 원문 대조 전]. FFI 호출은 `lock/posix.ts` 한 파일에 가두고, 로드 실패는 `none` provider로 내려간다.

#### 4.7.3 획득·갱신·반납

`acquire(resource, holder)`:

1. `resource`가 `LEASE_RESOURCE_PATTERN`에 맞지 않으면 `Bug(store.lease_resource_invalid)`.
2. `lockProvider.tryAcquire(resource)`. `held`면 읽기 연결로 행을 읽어 `err(LockBusy{ reason: "os_lock_held", owner })`. `io`면 `lock_io`.
3. `write`(BEGIN IMMEDIATE)에서 행을 읽는다.
   - 행이 없음 → `epoch = 1`로 넣는다.
   - `released_at`이 있음, 또는 `expires_at < now` → `epoch + 1`로 쓴다.
   - 행의 `host`가 자기와 같음 → OS 잠금을 이미 얻었으므로 이전 소유자는 살아 있지 않다. `epoch + 1`로 즉시 인수한다.
   - `host`가 다르고 만료 전 → OS 잠금을 풀고 `err(LockBusy{ reason: "lease_active", owner })`.
   - 같은 `holder_id`의 보유 중 행 → epoch를 유지하고 만료만 늘린다(`eng.transactions.design` §3.3 규칙 1).
4. 쓴 행의 `holder_id`, `epoch`로 `LeaseToken`을 돌려준다. OS 잠금 핸들은 provider 표에 토큰과 함께 둔다.

`renew(token)`: `write`에서 `holder_id`·`epoch`가 토큰과 같고 `released_at IS NULL`이면 `heartbeat_at = now`, `expires_at = now + leaseTtlMs`. 다르면 `lease_lost`와 함께 OS 잠금을 푼다.

`release(token)`: `write`에서 토큰이 맞으면 `released_at = now`. OS 잠금을 푼다. 토큰이 맞지 않으면 아무것도 바꾸지 않고 `ok`다.

`holds(tx, token)`: `SELECT holder_id, epoch, released_at FROM sys_leases WHERE resource = ?`를 같은 `tx`에서 읽는다. 시각을 비교하지 않는다(`eng.transactions.design` §3.3 규칙 3).

`keepAlive`: `heartbeatMs`(기본 5000)마다 `renew`. `busy`는 다음 주기에 다시 시도하고, 연속 실패 시간이 `leaseTtlMs`를 넘으면 `onLost`를 부른다. `lease_lost`면 바로 `onLost`. 타이머는 주입된 `Scheduler`(`OpenStoreOptions.scheduler`)로 건다. `Clock`은 시각만 준다(`L0.os.spec` §3.4).

- 잠금 실패 때 위임·관찰·분기는 호출자(`L0.process.spec` `LockFallbackPolicy`)가 고른다. store는 `LockBusy{ owner }` 정보만 돌려준다.
- `scheduler`, `service` 자원도 같은 규칙이다. `service` 자원은 `L0.process.spec` §4.4 서비스 기동 경합의 보조 장치로 쓴다.

#### 4.7.4 OS 잠금이 없을 때의 후퇴안

`lockProvider.kind === "none"`(Windows M2 이전, FFI 로드 실패)이면 DB 임대만으로 판정한다(`eng.transactions.design` T-4 (a)안).

- 획득 3단계의 "같은 host 즉시 인수"를 "같은 host이고 `pid`·`started_at` 프로세스가 살아 있지 않으면 인수"로 바꾼다. 생존 확인은 `env.processStartedAt(pid)`(`xeon.os` `processStartFingerprint`)가 `null`이거나 행의 `started_at`과 다를 때 "살아 있지 않음"이다(§8.1 FR-S8).
- 같은 host에서 죽은 소유자는 위 규칙으로 바로 인수한다. 기록된 `pid`와 프로세스 시작 지문 `started_at`으로 판정하고 만료를 기다리지 않는다(`platform-store/src/lease.ts` `decide`).
- 만료(`leaseTtlMs`, 기본 30초)를 기다리는 경우는 둘이다. 소유자가 살아 있지만 멈춰서 하트비트가 끊긴 경우(같은 host), 그리고 다른 host이거나 생존 확인이 불가한 경우다. 정합성은 epoch 펜싱으로 같고, 비용은 이 경우의 인수 지연 최대 30초와 PID 검사 코드다(`_research/notes/L0-2.md §4.3`). 크래시(죽은 소유자)는 지연이 없다 [결정: review.decisions-2 U-09 정정].

### 4.8 복구 표식

- [결정] 복구 표식은 이 패키지가 저장하지 않는다. `L1.persistence.spec` §2·§4.8.1이 정본이다. 표식은 투영 `p_threads`의 열(`running_since`, `resume_attempts`)이고 별도 쓰기 없이 이벤트에서 나온다. `turn.started` 커밋이 `running_since`를 세우고 `turn.completed`가 지우며, `resume_attempts`는 `thread.resumed` 수다. 그래서 표식은 재생으로 다시 만들어지고 `SessionWriter.commit` 한 번에 함께 바뀐다.
- 읽는 경로는 `xeon.session`의 `RecoveryMarker`(`OpenReport.marker`, `ProjectionQuery.thread(threadId).marker`)다. `L0.process.spec` §4.6의 '이어서 실행' 제시는 호스트(L4)가 이 값을 넘겨받아 만든다.
- 이 패키지가 맡는 것은 세션 소유 판정(§4.7)뿐이다. 표식이 남은 세션을 지금 다른 프로세스가 쥐고 있는지는 `leases.inspect`로 본다.

### 4.9 블롭 저장소

- 위치: `<db 디렉터리>/blobs/<ab>/<cdef…>`. `ab`는 SHA-256 hex 앞 2자, 파일 이름은 나머지 62자다. 임시 파일은 `blobs/tmp/<ULID>.tmp`다 [제안].
- 해시: Bun 내장 `Bun.CryptoHasher("sha256")` [가정: Bun 1.4.3 API, 실측 전].
- `putBlob(bytes, mediaType)` 순서(TX-04):
  1. 트랜잭션 안이면 `Bug(store.nested_write)`.
  2. 해시를 계산한다.
  3. 목적 파일이 있고 크기가 같으면 파일 쓰기를 건너뛴다. 4~7단계를 생략하고 8단계로 간다.
  4. 임시 파일을 `wx` 모드, 0600으로 열고 전부 쓴다.
  5. `fsync(fd)` 후 닫는다.
  6. `rename(임시, 목적)`. 목적 디렉터리 `blobs/<ab>`가 없으면 먼저 0700으로 만든다.
  7. 목적 디렉터리를 열어 `fsync`한다(디렉터리 항목 내구화). Windows는 디렉터리 fsync가 없으므로 건너뛴다 [가정].
  8. `write`에서 `sys_blobs`에 `INSERT … ON CONFLICT(sha256) DO UPDATE SET last_put_at = excluded.last_put_at`.
  9. `ok(BlobRef{ type: "blob", sha256, size, mediaType })`.
- 이벤트 커밋 전에 블롭 쓰기가 끝나야 한다. 이벤트 envelope 256 KiB 초과 값은 블롭으로 옮긴다(EV-04, `F.records.spec` §3.4 규칙 3·4). 필드별 분리 기준(EV-04의 16 KiB 제안)과 분리 실행은 `L1.persistence.spec` 몫이다. adr.0004 §6 미결 "블롭 분리 임계 크기와 해시 함수" 중 해시 함수는 이 문서가 SHA-256으로 정한다 [제안].
- `readBlob(ref)`: 파일이 없으면 `blob_missing`. 크기가 `ref.size`와 다르면 `blob_corrupt{size}`. 해시 재검증은 테스트·디버그 빌드에서만 하고 다르면 `blob_corrupt{hash}` [제안].
- 읽기 실패 정책: store는 오류만 돌려준다. 컨텍스트 조립(L1 context)이 `[xeon:blob_missing sha256:<hex>]` 같은 자리 문장으로 바꿔 모델에 보내고 재생은 멈추지 않는다 [제안, `L1.context.spec` 확인 필요].

GC [제안] (oh-my-pi `blob-store.ts`의 쓰기 유예와 임시 파일 규칙만 차용, `_research/packages.md §2.3`):

1. 고아 행: `sys_blobs` 중 `sys_blob_refs`에 행이 없고 `last_put_at < now - blobGraceMs`인 것. 파일을 지운 뒤 행을 지운다.
2. 행 없는 파일: `blobs/<ab>/*` 중 `sys_blobs`에 없고 mtime이 `now - blobGraceMs`보다 오래된 것. 블롭을 쓰고 8단계 전에 죽은 경우다.
3. 임시 파일: `blobs/tmp/*.tmp` 중 mtime이 `blobGraceMs`보다 오래된 것.
- 유예 시간 동안은 참조 없는 블롭도 지우지 않는다. 블롭 선쓰기 뒤 이벤트 커밋 전인 블롭을 지우지 않기 위해서다. 같은 해시를 다시 `putBlob`하면 `last_put_at`이 갱신되어 유예가 다시 시작된다(omp의 mtime 갱신 규칙에 해당).
- 실행 시점: 열기 뒤 한 번(지연 실행)과 하루 한 번. `scheduler` 임대를 쥔 프로세스만 한다 [제안]. 한 번에 지우는 수 상한 1000개.
- 파일 삭제와 행 삭제 사이에 크래시가 나면 다음 GC가 1번 규칙에서 `blob_missing` 없이 행만 지운다(파일 없음은 무시한다).

## 5. 실패와 경계 사례

| 경우 | 동작 |
|---|---|
| 다른 Xeon 버전이 만든 DB, sys 버전이 코드보다 높음 | `migration_future_version`. 호출자는 읽기 전용 열기를 고를 수 있다 |
| `application_id`가 다른 파일 | `foreign_database`. 파일을 바꾸지 않는다 |
| 다른 앱이 SQLite DB를 같은 경로에 둠(`application_id` 0, 테이블 있음) | `foreign_database`(`applicationId: 0`) |
| 쓰기 중 디스크 가득 | `disk_full`. 롤백되어 행 변화 없음. 같은 `requestId`로 재시도(TX-05) |
| `busy_timeout` 초과 | `busy` |
| `-wal` 파일만 남은 크래시 | SQLite가 다음 열기에서 복구한다. 별도 처리 없음 |
| 장시간 읽기 트랜잭션 | 체크포인트가 진행되지 않아 WAL이 커진다. `read` 콜백은 동기라 길게 잡을 수 없다. 다른 프로세스의 읽기는 막을 수 없으므로 `wal_checkpoint` 결과를 진단에 남긴다 |
| 늦게 깨어난 이전 소유자의 커밋 | `holds`가 거짓 → `lease_lost`, 행 변화 없음 |
| 같은 자원을 같은 프로세스 두 엔진 인스턴스가 획득 | provider 표가 두 번째를 `held`로 돌려준다 → `LockBusy` |
| 잠금 디렉터리가 네트워크 파일시스템 | §4.2 검사에서 DB와 함께 거부된다 |
| 블롭 선쓰기 뒤 커밋 실패 | 블롭은 참조 없이 남고 유예 뒤 GC가 지운다 |
| 블롭 파일을 사용자가 지움 | `readBlob`이 `blob_missing`. 행은 GC 1번 규칙으로 정리된다(참조가 남아 있으면 남는다) |
| 확장 마이그레이션 체크섬 불일치 | `migration_checksum_mismatch`. 그 확장만 꺼진다(호출자 정책) |
| macOS 동봉 dylib 없음 | `setCustomSQLite`는 성공처럼 보일 수 있다. 프로브가 거짓이면 §4.1 표를 따른다 |

### 5.1 플랫폼별 제약

| 항목 | macOS | Linux(WSL2 포함) | Windows(이후) |
|---|---|---|---|
| SQLite | 시스템 SQLite. FTS5·확장 지원 보장 없음(`_research/stack-status.md §7-D`). 동봉 dylib을 `setCustomSQLite`로 지정 | Bun 정적 링크 SQLite. Linux x64 3.53.4에서 FTS5 실측(TC-11). arm64는 [가정] | Bun 정적 링크 SQLite. FTS5 [가정] |
| WAL | 로컬 파일시스템 필요 | 로컬 파일시스템 필요. WSL `/mnt/*`(drvfs)는 거부 | 로컬 NTFS. 네트워크 드라이브 거부 |
| 내구성 | `fsync`가 드라이브 캐시를 비우지 않음. `fullfsync` 사용 [제안] | `fsync`로 충분 [가정] | `FlushFileBuffers` [가정] |
| OS 잠금 | bun:ffi `flock` [가정: 미실측] | bun:ffi `flock`(실측) | named mutex 또는 `LockFileEx` [미결 S-5]. 그 전까지 `none`(DB 임대만) |
| 파일 삭제·이름 변경 | POSIX | POSIX | 열린 파일은 삭제·이름 변경이 막힐 수 있다. 블롭 GC는 실패를 다음 주기로 미룬다. `rename`으로 덮어쓰기 대신 목적 파일이 있으면 건너뛴다(내용 주소라 같다) [가정] |
| 디렉터리 fsync | 지원 | 지원 | 없음. 건너뛴다 [가정] |
| 권한 | 0600/0700 | 0600/0700 | POSIX 모드 없음. ACL 처리는 `L0.os.spec` [가정] |
| 경로 길이 | 1024바이트(`PATH_MAX`) [가정] | 4096바이트 | 260자 제한. `\\?\` 접두 또는 긴 경로 설정 필요 [가정] |

## 6. 설정 노출

`defineSettings("l0.store", …)`로 선언한다(`F.wire-settings.spec` §3.8). 모두 `layer: "L0"`, `since: "0.1.0"`이다.

| 키 | 타입 | 기본값 | range | runtimeChange | allowedScopes | L4 노출 |
|---|---|---|---|---|---|---|
| `l0.store.heartbeatMs` | integer | 5000 | 1000~60000 | restart | managed, user | `advanced` 탭, 파일 |
| `l0.store.leaseTtlMs` | integer | 30000 | 3000~600000, `heartbeatMs`의 3배 이상(카탈로그 검사) | restart | managed, user | `advanced` 탭 |
| `l0.store.busyTimeoutMs` | integer | 5000 | 0~60000 | restart | managed, user | 파일만 |
| `l0.store.blobGraceMs` | integer | 86400000(24시간) [제안] | 600000~2592000000 | live | managed, user | `sessions` 탭 |
| `l0.store.requireFts5` | boolean | false | - | restart | managed, user | `advanced` 탭 |
| `l0.store.macFullFsync` | boolean | true [제안] | - | restart | managed, user | `advanced` 탭(macOS만 표시) |
| `l0.store.customSqlitePath` | string \| null | null | 절대 경로 | restart | managed, user | 파일만 |

- `project`, `local`, `session` 범위는 허용하지 않는다. DB는 사용자 단위 자원이다.
- 주기 값(5초, 30초)을 설정 키로 노출하는 것은 `eng.transactions.design` 미결 T-6에 대한 이 문서의 답이다 [제안].
- `blobGraceMs` 기본값 근거: 블롭 선쓰기와 커밋 사이 시간은 보통 1초 안이지만 승인 대기처럼 커밋이 늦는 경로를 넉넉히 덮는다 [가정].

## 7. 확장 지점

- 이 도메인은 on·post·drive·scope 지점을 선언하지 않는다.
- 확장(L3 그룹, 사용자 플러그인)과의 관계는 둘이다.
  - 확장 접두사 테이블: X 로딩(`X.loading-trust.spec`)이 확장을 켤 때 `extensions.register(name)`과 `migrations.apply`를 부르고, 확장을 제거할 때 X(`X.operations.spec` §4.4.7 `dropExtension`)가 소유 장부 `xh_ext_tables`의 이름 목록으로 `extensions.drop(name, tables)`를 부른다.
  - 확장 투영기는 §4.5 소유 판정으로 그 확장의 것인 `x_` 테이블만 쓴다(TX-03). 확장은 `@xeon/platform-store`를 import할 수 없다(DR-14). 범위 핸들이나 투영 트랜잭션 핸들만 받는다.

## 8. 다른 문서와의 인터페이스

제공:

| 이름 | 쓰는 문서 |
|---|---|
| `StoreService`, `StoreServiceName`(`xeon.store`), `StoreDb`, `SqlTx`, `StoreCapabilities` | L1.persistence.spec, L2.knowledge.spec, L2.web.spec, L2.mcp.spec, L2.schedule.spec, L2.artifacts.spec |
| 루트 핸들, `BlobPins`(`OpenedStore`) | L1.persistence.spec, L4.host-service.spec(조립) |
| `LeaseService`, `LeaseToken`, `LeaseHolder`, `LockBusy`, `LeaseOwnerInfo` | L1.persistence.spec, L0.process.spec, L2.schedule.spec(`scheduler`) |
| `MigrationRunner`, `MigrationSet`, `ExtensionTables` | L1.persistence.spec, X.loading-trust.spec, X.operations.spec, L2 각 spec |
| `putBlob`, `readBlob`, `BlobError` | L1.persistence.spec, L1.context.spec, L1.tools.spec |
| `storeId` | L4.host-service.spec(`host.hello`의 `storeId`) |
| `openTestStore`, `TestStore`, `StoreFaultPoint` | eng.testing.guide TS-07·TS-08, 모든 저장 테스트 |
| 확장 저장 영역 계약 스위트(실제 bun:sqlite 팩토리) | X.operations.spec(확장 저장 영역). 시나리오 정본은 X `test/operations/storage/ext-storage.contract.ts`이고, 이 패키지 테스트가 그 시나리오를 `openTestStore` 기반 팩토리로 돌린다 [결정: review.decisions-2 D-05, U-17] |
| 설정 `l0.store.*` | L4.settings-ui.spec |

요구:

| 이름 | 출처 |
|---|---|
| `BlobRef`, `ChunkMigration`, `JsonValue`, `FaultInjector`, `FaultPoint` | F.records.spec §3.4·§3.7, eng.transactions.design §4.2 |
| `ThreadId`, `IdFactory` | F.conversation.spec §3.2 |
| `Result`, `Bug` | F.readme §3 루트 |
| `TABLE_PREFIX_OWNERS`, `RESERVED_EXT_IDS` | eng.context-map.design §5.4 |
| `EXTENSION_NAME_PATTERN`(`ExtensionName`) | F.extensions.spec |
| 확장 테이블 이름 변환과 지역 이름 규칙, 소유 장부 `xh_ext_tables` | X.operations.spec §3.4·§4.4.2·§4.4.7 |
| `defineSettings` | F.wire-settings.spec §3.8 |
| DB 경로(`dirs.data`), 파일시스템 종류(`fsKind`), 리소스 디렉터리(`dirs.resource`), 프로세스 시작 시각 지문(`processStartFingerprint`), 기계 식별자(`machineId`), `Clock`·`Scheduler`(`time`) | L0.os.spec §3.2·§3.3·§3.10(서비스 `xeon.os`) |

### 8.1 F와 다른 문서에 요청

| id | 대상 | 요청 | 이유 |
|---|---|---|---|
| FR-S1 | F.records.spec(새 파일 `sql.ts`, `store-db.ts`) | §3.1의 `StoreServiceName`, `StoreService`, `StoreDb`, `SqlTx`, `SqlValue`, `SqlRow`, `StoreWriteError`, `StoreReadError`, `StoreCapabilities`, `BlobError`를 둔다. `SqlValue`는 `eng.events.design`의 `projector.ts`와 한 곳에 둔다 | 같은 층 import 금지(DR-02). 소비자가 F 타입으로 주입받는다 |
| FR-S2 | F.records.spec(새 파일 `lease.ts`), eng.transactions.design §3.3·§4.2 | `LeaseResource`, `LEASE_RESOURCE_PATTERN`, `LeaseKind`, `LeaseHolder`, `LeaseToken`(`sessionId` 대신 `resource`), `LeaseOwnerInfo`, `LockBusy`, `LeaseError`, `LeaseService`를 둔다. 반납 때 행을 지우지 않고 `released_at`을 채우는 규칙으로 §3.3 규칙 4를 고친다 | store와 process가 서로 import하지 못한다(DR-02). epoch 단조성 |
| FR-S3 | (철회) | `run-marks.ts`, `RunMark`, `RunMarks`를 F에 두지 않는다 | 복구 표식은 `L1.persistence.spec` §4.8.1의 `p_threads` 열이 정본이다(§4.8). process는 `RecoveryMarker`를 읽는다 |
| FR-S4 | F.records.spec(새 파일 `migrations.ts`) | `MigrationStep`, `MigrationSet`, `MigrationError`, `MigrationReport`, `MigrationRunner`, `ExtensionTables`, `ExtensionTableError`를 둔다 | L1·L2·X가 마이그레이션을 선언한다 |
| FR-S5 | F.records.spec §3.7 | `ChunkMigration.runChunk`를 `(tx: SqlTx, cursor, budget) => {next, processed}`(동기)로 바꾼다 | 현재 시그니처는 Promise이고 트랜잭션 핸들이 없어 "청크와 커서를 한 트랜잭션"(규칙 6)을 구현할 수 없다(TX-01) |
| FR-S6 | eng.transactions.design §4.2, eng.events.design §4.1 | `putBlob`/`readBlob`의 반환을 `Result<…, BlobError>`로, `BlobRef` 예시를 F 모양으로 고친다 | TY-11, `F.records.spec` §3.1.2 정본 표 |
| FR-S7 | eng.context-map.design §5.2·§5.4, CM-07 | (반영됨, review.decisions-2 U-18) 확장 id `^[a-z][a-z0-9-]{1,31}$`, 테이블 접두 `x_<하이픈→밑줄>_`, 지역 이름 밑줄 금지로 소유를 판정한다 | 이 문서와 X가 하이픈 허용 이름을 쓴다. 접두 일치만으로는 확장 `a`의 삭제가 `a-b`의 테이블을 지운다 |
| FR-S8 | L0.os.spec | `fsKind(path, signal)`, `dirs.resource`(macOS 동봉 dylib), `processStartFingerprint(pid)`(동기), `machineId`를 `OsService`에 둔다(반영됨: `L0.os.spec` §3.3·§3.10). 비동기인 `fsKind`는 조립 루트가 미리 풀어 `StoreEnvironment.dbDirFsKind`로 넘긴다 | DR-13. store는 OS를 판정하지 않는다 |
| FR-S9 | F.conversation.spec §3.2 | `IdPrefix`에 `sto`를 더할지(`F.wire-settings.spec` §10 미결 7) | `storeId` 발급 |

## 9. 수용 기준

1. 쓰기 연결의 `PRAGMA journal_mode` 조회값은 `wal`, `synchronous`는 2, `busy_timeout`은 설정값(기본 5000), `foreign_keys`는 1, `trusted_schema`는 0, `application_id`는 1480937294다. 읽기 연결의 `query_only`는 1이다.
2. 존재하지 않는 경로로 `readonly` 연결을 여는 코드 경로가 없다(열기 전 존재 검사). `fileMustExist` 옵션 문자열이 패키지 소스에 없다.
3. 크래시 모사: `FaultInjector`의 10지점(`eng.transactions.design` §4.2) 각각에서 예외를 던지면, 커밋 전 9지점은 모든 테이블 행 수와 행 해시가 주입 전과 같고 `after_commit`은 모든 행이 남는다. `PRAGMA integrity_check`가 `ok`다.
4. 자식 프로세스 두 개가 같은 `session:<threadId>`를 동시에 `acquire`하면 정확히 하나가 `ok`, 다른 하나가 `LockBusy`다.
5. 소유 프로세스를 SIGKILL한 뒤 다른 프로세스의 `acquire`는 `leaseTtlMs`를 기다리지 않고 성공하고 epoch가 1 오른다(posix provider).
6. 인수당한 이전 소유자의 토큰으로 `write` 안에서 `holds`를 부르면 거짓이다. 그 토큰의 `renew`는 `lease_lost`다.
7. `release` 뒤 다시 `acquire`하면 epoch가 이전 값보다 크다.
8. FTS5가 없는 SQLite(흉내 방법은 `L0.store.plan` §5)에서 `probeFts5`는 거짓이고, `requireFts5 = false`면 `openStore`가 성공하며 `capabilities.fts5 === false`다. `requireFts5 = true`면 `fts5_missing`이다.
9. `setCustomSQLite` 초기화 뒤 다른 경로로 다시 초기화하면 `Bug(store.sqlite_already_loaded)`다.
10. `write` 안에서 `write`를 부르면 `Bug(store.nested_write)`이고 바깥 트랜잭션도 롤백된다.
11. 다른 쓰기 연결이 `BEGIN IMMEDIATE`를 쥔 동안 `busyTimeoutMs = 0`으로 `write`하면 `err({ kind: "busy" })`다.
12. 테스트 빌드에서 `scoped("cap.knowledge")`로 `p_turns`를 읽거나 쓰면 `Bug(store.prefix_not_owned)`다.
13. `putBlob`을 같은 바이트로 두 번 부르면 파일 쓰기는 한 번이고 `last_put_at`만 갱신된다. 블롭 선쓰기 뒤 커밋을 실패시키면, 유예 시간을 지나 수동 시계로 GC를 돌렸을 때 파일과 행이 모두 사라진다. 유예 시간 전에는 남는다.
14. 블롭 파일을 지운 뒤 `readBlob`은 `blob_missing`이다.
15. 이미 적용된 마이그레이션 단계의 SQL을 바꾸면 `apply`가 `migration_checksum_mismatch`이고 아무 DDL도 실행되지 않는다.
16. `extensions.register("Helm")`, `register("ext")`, `register("a_b")`는 `ext_id_invalid`다. `register("acme-notes")`의 `tablePrefix`는 `x_acme_notes_`다. 확장 `ab`(`x_ab_cd`)와 `ab-cd`(`x_ab_cd_ef`)를 둘 다 등록한 뒤 `drop("ab", ["x_ab_cd"])`는 `x_ab_cd`만 지우고 `x_ab_cd_ef`와 `events` 행 수는 그대로다. `drop("ab", ["x_ab_cd_ef"])`는 `table_not_owned`이고 아무것도 지우지 않는다.
17. `bun:sqlite` import가 `platform-store` 밖에 없다(DR-07 검사).
18. X의 확장 저장 영역 계약 시나리오(`ext-storage.contract.ts`)가 이 패키지의 실제 bun:sqlite 팩토리로 통과한다. 장애 주입 롤백 시나리오(`after_ext_projection:<n>`)에서 확장 테이블 행 해시가 바뀌지 않는다 [결정: review.decisions-2 D-05]. X 테스트는 L0를 import하지 않으므로 bun:sqlite 실행은 이 스위트만 맡는다.

## 10. 미결 사항

- [결정: review.decisions-2 U-09] S-1. 세션 소유 판정은 OS 잠금 + `sys_leases` epoch 펜싱이다. adr.0004 §3.4 개정 대상이다. `L0.process.spec` P-1과 같은 항목이다.
- [결정: review.decisions-2 U-09] S-2. adr.0006 §3.6 규칙 4의 `session_owner`는 두지 않고 `sys_leases` 행이 표시를 겸한다. `L0.process.spec` P-2와 같은 항목이다.
- [미결 S-4] FTS5 프로브 실패 시 운영 시작 동작. 권고는 저장소를 열고 `capabilities.fts5 = false`로 검색만 끄는 것이다(TC-11, adr.0004 §6).
- [미결 S-5] Windows `LockProvider` 수단: named mutex(`CreateMutexW`) 또는 `LockFileEx`. bun:ffi 실측 뒤 정한다(`_research/notes/L0-2.md §6`).
- [미결 S-7] 범위 핸들 소유자(`cap.*`, `ext.*`)에게 블롭 참조 기록(`pinBlob`)을 열지.
- [미결 S-8] 접두사 밖 문장 거부를 운영 빌드에도 켤지. `EXPLAIN` 대조 비용 측정(ST-07) 뒤 정한다.
- [미결 S-9] macOS `fullfsync` 기본값. 제안은 켬이고 성능 측정(ST-17) 뒤 확정한다.
- [미결 S-10] bun:ffi 안정성. Bun 문서의 실험 기능 경고 원문을 확인하고, 문제가 있으면 `none` provider(DB 임대만)를 기본으로 둘지 정한다.
- [미결 S-11] 블롭 해시 재검증을 운영 빌드에서도 할지(읽기 비용).
- [미결 S-12] F 요청, 스냅샷 실패 전용 오류 kind. 지금은 `migration_failed`의 `code: "snapshot_failed:<코드>"`로 돌려준다(§4.6.1). `MigrationError`에 `migration_snapshot_failed`를 더하고, 손상(`corrupt`)과 미래 버전(`migration_future_version`) 오류를 사용자 안내 문구로 나누는 일은 F·host가 맡는다 [마감 G2-06].
- [가정] macOS에서 bun:ffi `flock`, `libSystem.B.dylib` 이름, O_CLOEXEC 동작은 실측하지 않았다. Windows 전 구간, WSL `/mnt/c`의 flock도 실측하지 않았다(`_research/notes/L0-2.md §5`).
