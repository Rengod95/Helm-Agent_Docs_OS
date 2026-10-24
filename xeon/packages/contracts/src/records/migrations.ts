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
