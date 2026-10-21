import type { Clock, Result, Scheduler } from "@xeon/contracts";
import type { IdFactory } from "@xeon/contracts/conversation";
import type { FaultInjector, MigrationError, StoreDb, StoreService } from "@xeon/contracts/records";
import type { FsKind } from "@xeon/contracts/services";
import type { BlobPins } from "./blob.ts";
import type { StoreFaultInjector } from "./fault-points.ts";
import type { SqliteProbe } from "./sqlite-env.ts";

/**
 * xeon.os에서 받은 판정과 경로. platform-store는 OS를 직접 판정하지 않는다(DR-13).
 * openStore와 임대 판정은 동기 경로라 조립 루트가 xeon.os의 비동기 질의를 미리 풀어 값이나 동기 함수로 넘긴다.
 */
export interface StoreEnvironment {
  readonly platform: "darwin" | "linux" | "win32";
  readonly wsl: boolean;
  /** dirname(dbPath)의 판정. 조립 루트가 OsService.fsKind를 열기 전에 await해 넘긴다. 오류면 "unknown" */
  readonly dbDirFsKind: FsKind;
  /** macOS 동봉 SQLite dylib. OsService.dirs.resource 아래 */
  readonly bundledSqlitePath: string | null;
  /** OsService.machineId. LeaseHolder.host와 같은 값이어야 같은 기계로 판정한다 */
  readonly machineId: string;
  /** OsService.processStartFingerprint(동기). 프로세스가 없으면 null. OS 잠금이 없을 때의 생존 판정 */
  readonly processStartedAt: (pid: number) => number | null;
}

/** l0.store.* 유효 값(L0.store.spec §6) */
export interface StoreSettings {
  readonly heartbeatMs: number;
  readonly leaseTtlMs: number;
  readonly busyTimeoutMs: number;
  readonly blobGraceMs: number;
  readonly requireFts5: boolean;
  readonly macFullFsync: boolean;
  readonly customSqlitePath: string | null;
}

export interface OpenStoreOptions {
  /** 절대 경로 */
  readonly dbPath: string;
  readonly env: StoreEnvironment;
  readonly clock: Clock;
  /** keepAlive 하트비트와 GC 지연 실행에 쓴다 */
  readonly scheduler: Scheduler;
  readonly ids: IdFactory;
  readonly settings: StoreSettings;
  /** 테스트 전용. OpenedStore.faults로 core-persistence 쓰기 경로에 그대로 넘긴다. 운영은 생략 */
  readonly faults?: FaultInjector;
  /** 테스트 전용. 이 패키지 안(블롭, 임대, 마이그레이션)의 장애 주입 */
  readonly storeFaults?: StoreFaultInjector;
  /** 테스트 전용. SQLite 능력 조사를 대신한다(FTS5 없는 SQLite를 흉내 낼 때) */
  readonly probe?: () => SqliteProbe;
  /** 범위 핸들의 EXPLAIN 대조를 강제로 켜거나 끈다. 생략하면 XEON_STORE_STRICT와 NODE_ENV로 정한다 */
  readonly strictPrefix?: boolean;
  readonly engineVersion: string;
}

export type StoreOpenError =
  | { readonly kind: "db_path_invalid"; readonly reason: "not_absolute" | "is_directory" }
  | {
      readonly kind: "unsupported_filesystem";
      readonly fsKind: "network" | "drvfs";
      readonly dir: string;
    }
  | { readonly kind: "permission"; readonly path: string; readonly mode: number }
  | { readonly kind: "foreign_database"; readonly applicationId: number }
  | { readonly kind: "fts5_missing" }
  | { readonly kind: "corrupt"; readonly code: string }
  | { readonly kind: "busy" }
  | { readonly kind: "disk_full" }
  | { readonly kind: "io"; readonly code: string }
  | MigrationError;

export type StoreWarning =
  | { readonly kind: "fs_unknown"; readonly dir: string }
  | { readonly kind: "fts5_missing" }
  | { readonly kind: "lock_provider_none" }
  /** 그룹·기타 권한 비트가 있던 디렉터리나 파일을 0700/0600으로 고쳤다 */
  | {
      readonly kind: "permission_fixed";
      readonly path: string;
      readonly from: number;
      readonly to: number;
    }
  | {
      readonly kind: "checkpoint_incomplete";
      readonly busy: number;
      readonly log: number;
      readonly checkpointed: number;
    };

export interface OpenedStore extends AsyncDisposable {
  /** Cordis xeon.store로 등록한다 */
  readonly service: StoreService;
  /** core-persistence 전용 */
  readonly root: StoreDb;
  /** core-persistence 전용 */
  readonly blobPins: BlobPins;
  /** 열기 때 모인 경고에 close()에서 생긴 경고가 더해진다 */
  readonly warnings: readonly StoreWarning[];
  /** options.faults 그대로. 없으면 아무것도 하지 않는 주입기 */
  readonly faults: FaultInjector;
  /** 종료 절차(L0.store.spec §4.4). 여러 번 불러도 된다 */
  close(): Promise<void>;
}

export type OpenResult = Result<OpenedStore, StoreOpenError>;
