import type { Result } from "../base/index.ts";
import type { JsonValue } from "../conversation/index.ts";
import type { ChunkMigration } from "./versioning.ts";

export interface MigrationStep {
  /** 1부터 1씩 */
  readonly version: number;
  /** DDL과 작은 DML. 체크섬 대상 */
  readonly sql: readonly string[];
}

export interface MigrationSet {
  /** 소유자 id */
  readonly owner: string;
  /** steps 마지막 version과 같다 */
  readonly version: number;
  readonly steps: readonly MigrationStep[];
}

export type MigrationError =
  | {
      readonly kind: "migration_checksum_mismatch";
      readonly owner: string;
      readonly version: number;
    }
  | {
      readonly kind: "migration_future_version";
      readonly owner: string;
      readonly dbVersion: number;
      readonly codeVersion: number;
    }
  | {
      readonly kind: "migration_gap";
      readonly owner: string;
      readonly expected: number;
      readonly got: number;
    }
  | {
      readonly kind: "migration_failed";
      readonly owner: string;
      readonly version: number;
      readonly code: string;
    }
  | { readonly kind: "busy" }
  | { readonly kind: "disk_full" };

/**
 * 저장소를 열지 못한 이유를 사용자 안내 기준으로 나눈 분류 [결정: m2c G2-06]. 안내 문구와 복구 길이 다르기 때문에 나눈다.
 * - `future_version`: DB가 이 앱보다 새 버전이다(앱을 되돌렸다). 마이그레이션이 DB를 건드리지 않는다. 앱을 올리는 것이 답이다.
 * - `corrupt`: 파일이 망가졌거나(SQLite 손상, 이력 변조·누락) 저장된 행이 스키마와 다르다. 마이그레이션 전 스냅샷이나 백업에서 되살린다.
 * - `migration_failed`: 마이그레이션 단계가 실패했다. 앞 단계는 유지되어 있고 마이그레이션 전 스냅샷으로 돌아간다.
 * - `unavailable`: 그 밖의 열기 실패(잠금, 디스크, 권한, 경로, 다른 프로그램의 DB, FTS5 없음). 환경을 고치면 풀린다.
 */
export const STORE_FAILURE_KINDS: readonly [
  "future_version",
  "corrupt",
  "migration_failed",
  "unavailable",
] = ["future_version", "corrupt", "migration_failed", "unavailable"];
export type StoreFailureKind = (typeof STORE_FAILURE_KINDS)[number];

/** 안내 분류가 `unavailable`이 아닌 오류 kind. 표에 없는 kind는 모두 `unavailable`이다 */
const STORE_FAILURE_BY_KIND: ReadonlyMap<string, StoreFailureKind> = new Map<
  string,
  StoreFailureKind
>([
  ["migration_future_version", "future_version"],
  ["corrupt", "corrupt"],
  ["migration_checksum_mismatch", "corrupt"],
  ["migration_gap", "corrupt"],
  ["row_invalid", "corrupt"],
  ["migration_failed", "migration_failed"],
]);

/**
 * 순수 함수. 저장소 열기 오류의 `kind`(L0.store `StoreOpenError`, 마이그레이션 `MigrationError`, 읽기 `row_invalid`)를 안내 분류로 바꾼다.
 * 이름을 문자열로 받는 이유는 F가 L0의 오류 타입을 import하지 못하기 때문이다. 모르는 이름은 `unavailable`이다.
 */
export function storeFailureKindOf(kind: string): StoreFailureKind {
  return STORE_FAILURE_BY_KIND.get(kind) ?? "unavailable";
}

export interface MigrationReport {
  readonly owner: string;
  readonly from: number;
  readonly to: number;
}

export interface MigrationRunner {
  apply(set: MigrationSet): Result<MigrationReport, MigrationError>;
  /** 청크마다 별도 트랜잭션. 커서를 같은 트랜잭션에 저장한다. 중단 뒤 저장된 커서부터 이어간다 */
  runChunked<C extends JsonValue>(
    owner: string,
    migration: ChunkMigration<C>,
    options?: { readonly maxRows?: number; readonly signal?: AbortSignal },
  ): Promise<Result<{ readonly done: boolean; readonly processed: number }, MigrationError>>;
}

export type ExtensionTableError =
  | {
      readonly kind: "ext_id_invalid";
      readonly name: string;
      readonly reason: "pattern" | "reserved";
    }
  | { readonly kind: "table_not_owned"; readonly name: string; readonly table: string }
  | { readonly kind: "busy" }
  | { readonly kind: "disk_full" }
  | { readonly kind: "io"; readonly code: string };

export interface ExtensionTables {
  /** name은 ExtensionName(하이픈 허용). sys_prefixes에 owner "ext.<name>"과 접두 x_<하이픈→밑줄>_를 등록한다. 이미 있으면 ok */
  register(
    name: string,
  ): Result<{ readonly owner: string; readonly tablePrefix: string }, ExtensionTableError>;
  /** tables에 적힌 정확한 이름만 DROP하고, sys_migrations·sys_migration_cursors·sys_prefixes 행 삭제를 한 트랜잭션에서 한다 */
  drop(
    name: string,
    tables: readonly string[],
  ): Result<{ readonly dropped: readonly string[] }, ExtensionTableError>;
}
