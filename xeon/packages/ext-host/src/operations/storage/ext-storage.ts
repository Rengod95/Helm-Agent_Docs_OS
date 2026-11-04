import { assertNever, Bug, err, ok, parse, parseJson, type Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  ExtensionTablesPortKey,
  ProjectorRegistryPortKey,
  ScopedStorePortKey,
  StoreMigrationsPortKey,
  type ExtensionName,
  type PortLookup,
  type RegistrationApi,
} from "@fresnel/contracts/extensions";
import {
  ownerOfKind,
  type DurableEventEnvelope,
  type EventKind,
  type ExtensionTableError,
  type MigrationError,
  type ProjectionTx,
  type Projector,
  type ProjectorFailure,
  type SqlRow,
  type SqlTx,
  type SqlValue,
  type StoreReadError,
} from "@fresnel/contracts/records";
import { scopeInternalsOf } from "../../primitives/host-api.ts";
import type { DispatchPolicy } from "../../primitives/dispatch-types.ts";
import { namesOf, readersOf, writersOf } from "../../erase.ts";
import { LEDGER_MIGRATIONS, LEDGER_TABLE, TOMBSTONE_TABLE } from "./ledger-migrations.ts";
import type { ExtRowError, ExtStorageError } from "./errors.ts";
import { checkStatement } from "./guard.ts";
import type { ExtReaders, ExtWriters, ExtTableReader, ExtTableWriter } from "./table-types.ts";
import {
  columnsOf,
  extTableName,
  extTablePrefix,
  tableDdl,
  THREAD_COLUMN,
  type ColumnType,
  type ExtTableDef,
  type ExtTableDefs,
} from "./tables.ts";

export type { ExtQuery, ExtTableReader, ExtTableWriter } from "./table-types.ts";

/** 확장의 투영. 코어 커밋 트랜잭션 안에서 동기로 실행된다(eng.events.design §5.1 규칙 1·2) */
export interface ExtProjection<D extends ExtTableDefs> {
  /** 올리면 그 확장의 테이블을 지우고 이벤트에서 다시 만든다 */
  readonly version: number;
  /** 관심 kind. 자기 접두 kind와 코어 kind만 쓸 수 있다 */
  readonly kinds: readonly EventKind[];
  /**
   * 순수 함수. 시계·난수·입출력을 쓰지 않는다. 쓰기 오류(`ExtRowError`)는 그대로 돌려준다. 오류를 돌려주거나
   * 예외를 던지면 코어 커밋 전체가 롤백되고 투영기 실패로 보고된다(자동 끄기의 `projection_failed`)
   */
  apply(event: DurableEventEnvelope, tables: ExtWriters<D>): Result<void, ExtRowError>;
}

interface ExtReadOptions {
  /** perThread 테이블을 이 thread로 좁힌다. 없으면 모든 thread의 행을 본다 */
  readonly threadId?: ThreadId;
}

export interface ExtTables<D extends ExtTableDefs> {
  /** 실제 테이블 이름. 진단·삭제 확인 화면용 */
  readonly names: { readonly [K in keyof D]: string };
  /** 읽기 연결의 BEGIN DEFERRED. 트랜잭션 밖 핸들러에서 부른다 */
  read<T>(fn: (tables: ExtReaders<D>) => T, options?: ExtReadOptions): Result<T, ExtStorageError>;
}

export interface ExtStorage {
  readonly extension: ExtensionName;
  /** extTablePrefix(extension) */
  readonly prefix: string;
  /** 확장마다 한 번. 투영기를 등록하고 테이블을 소유 장부에 올린다 */
  defineTables<const D extends ExtTableDefs>(
    defs: D,
    projection: ExtProjection<D>,
  ): Result<ExtTables<D>, ExtStorageError>;
}

/**
 * `ExtProjection.apply`가 오류를 돌려줬을 때 투영기 `apply`가 던지는 값. 코어 커밋을 롤백하고 `ProjectorFailure`로 보고된다.
 * 확장 코드의 결함이 아니라 투영 데이터의 문제를 알리는 통로다
 */
class ProjectionRollback extends Error {
  override readonly name: string = "ProjectionRollback";
  readonly rowError: ExtRowError;

  constructor(rowError: ExtRowError) {
    super(`extension projection rejected a row: ${rowError.kind} in ${rowError.table}`);
    this.rowError = rowError;
  }
}

// ── SQL 생성 ──────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

function quote(identifier: string): string {
  return `"${identifier}"`;
}

interface Codec {
  readonly table: string;
  readonly def: ExtTableDef;
  readonly columns: readonly { readonly name: string; readonly type: ColumnType }[];
  readonly byName: ReadonlyMap<string, ColumnType>;
}

interface SqlRunner {
  run(sql: string, params: readonly SqlValue[]): void;
  get(sql: string, params: readonly SqlValue[]): SqlRow | undefined;
  all(sql: string, params: readonly SqlValue[]): readonly SqlRow[];
}

function encode(type: ColumnType, value: unknown): SqlValue {
  if (value === undefined || value === null) return null;
  if (type.boolean) return value === true ? 1 : 0;
  if (type.json) return JSON.stringify(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  throw new Bug(`ext_storage.unsupported_value: ${typeof value}`);
}

/** 저장된 열 값을 행 값으로 되살린다. JSON 열이 JSON이 아니면 err(손상) */
function decode(type: ColumnType, value: SqlValue | undefined): Result<unknown, "corrupt"> {
  if (value === null || value === undefined) return ok(type.acceptsNull ? null : undefined);
  if (type.boolean) return ok(value === 1 || value === 1n);
  if (type.json && typeof value === "string") {
    const decoded = parseJson(value);
    return decoded.ok ? ok(decoded.value) : err("corrupt");
  }
  return ok(value);
}

function codecOf(
  extension: ExtensionName,
  local: string,
  def: ExtTableDef,
): Result<Codec, ExtStorageError> {
  const table = extTableName(extension, local);
  const columns = columnsOf(def, table);
  if (!columns.ok) return columns;
  return ok({
    table,
    def,
    columns: columns.value,
    byName: new Map(columns.value.map((column) => [column.name, column.type])),
  });
}

function whereClause(
  codec: Codec,
  where: Readonly<Record<string, unknown>> | undefined,
  threadId: ThreadId | undefined,
): { readonly sql: string; readonly params: SqlValue[] } {
  const parts: string[] = [];
  const params: SqlValue[] = [];
  if (codec.def.perThread && threadId !== undefined) {
    parts.push(`${quote(THREAD_COLUMN)} = ?`);
    params.push(threadId);
  }
  for (const [column, value] of Object.entries(where ?? {})) {
    if (value === undefined) continue;
    const type = codec.byName.get(column);
    if (type === undefined) throw new Bug(`ext_storage.unknown_column: ${column}`);
    if (value === null) {
      parts.push(`${quote(column)} IS NULL`);
    } else {
      parts.push(`${quote(column)} = ?`);
      params.push(encode(type, value));
    }
  }
  return { sql: parts.length === 0 ? "" : ` WHERE ${parts.join(" AND ")}`, params };
}

function writerFor(
  codec: Codec,
  runner: SqlRunner,
  threadId: ThreadId | undefined,
  guard: ((sql: string) => void) | undefined,
  onRowError: (error: ExtRowError) => void,
): ExtTableWriter<Readonly<Record<string, unknown>>> {
  const exec = (sql: string, params: readonly SqlValue[]): void => {
    guard?.(sql);
    runner.run(sql, params);
  };
  const reader = readerFor(codec, runner, threadId, guard);

  function rowValues(row: Readonly<Record<string, unknown>>): Result<
    {
      readonly names: string[];
      readonly values: SqlValue[];
    },
    ExtRowError
  > {
    if (!parse(codec.def.row, row).ok) return err({ kind: "row_invalid", table: codec.table });
    const names: string[] = [];
    const values: SqlValue[] = [];
    if (codec.def.perThread) {
      if (threadId === undefined) throw new Bug(`ext_storage.thread_required: ${codec.table}`);
      names.push(THREAD_COLUMN);
      values.push(threadId);
    }
    for (const column of codec.columns) {
      names.push(column.name);
      values.push(encode(column.type, row[column.name]));
    }
    return ok({ names, values });
  }

  function write(
    verb: "INSERT" | "INSERT OR REPLACE",
    row: Readonly<Record<string, unknown>>,
  ): Result<void, ExtRowError> {
    const prepared = rowValues(row);
    if (!prepared.ok) {
      // 확장이 돌려받은 Result를 버려도 행 손실이 조용히 지나가지 않도록 apply 쪽에 알린다
      onRowError(prepared.error);
      return prepared;
    }
    const { names, values } = prepared.value;
    exec(
      `${verb} INTO ${quote(codec.table)} (${names.map(quote).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
      values,
    );
    return ok(undefined);
  }

  return {
    ...reader,
    insert: (row) => write("INSERT", row),
    upsert: (row) => write("INSERT OR REPLACE", row),
    update(key, patch) {
      const target = whereClause(codec, key, threadId);
      const matched = reader.count(key);
      const sets: string[] = [];
      const params: SqlValue[] = [];
      for (const [column, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        const type = codec.byName.get(column);
        if (type === undefined) throw new Bug(`ext_storage.unknown_column: ${column}`);
        sets.push(`${quote(column)} = ?`);
        params.push(encode(type, value));
      }
      if (sets.length === 0 || matched === 0) return 0;
      exec(`UPDATE ${quote(codec.table)} SET ${sets.join(", ")}${target.sql}`, [
        ...params,
        ...target.params,
      ]);
      return matched;
    },
    delete(key) {
      const target = whereClause(codec, key, threadId);
      const matched = reader.count(key);
      if (matched === 0) return 0;
      exec(`DELETE FROM ${quote(codec.table)}${target.sql}`, target.params);
      return matched;
    },
  };
}

function readerFor(
  codec: Codec,
  runner: SqlRunner,
  threadId: ThreadId | undefined,
  guard: ((sql: string) => void) | undefined,
): ExtTableReader<Readonly<Record<string, unknown>>> {
  function decodeRow(row: SqlRow): Result<Readonly<Record<string, unknown>>, ExtRowError> {
    const out: Record<string, unknown> = {};
    for (const column of codec.columns) {
      const decoded = decode(column.type, row[column.name]);
      // 손상된 JSON 열도 선언과 다른 행이다
      if (!decoded.ok) return err({ kind: "row_corrupt", table: codec.table });
      if (decoded.value !== undefined) out[column.name] = decoded.value;
    }
    if (!parse(codec.def.row, out).ok) return err({ kind: "row_corrupt", table: codec.table });
    return ok(out);
  }

  const select = (sql: string, params: readonly SqlValue[]): readonly SqlRow[] => {
    guard?.(sql);
    return runner.all(sql, params);
  };

  return {
    get(key) {
      const where = whereClause(codec, key, threadId);
      const [row] = select(`SELECT * FROM ${quote(codec.table)}${where.sql} LIMIT 1`, where.params);
      return row === undefined ? ok(undefined) : decodeRow(row);
    },
    list(query) {
      const where = whereClause(codec, query?.where, threadId);
      const order = (query?.orderBy ?? []).map((item) => {
        if (!codec.byName.has(item.column))
          throw new Bug(`ext_storage.unknown_column: ${item.column}`);
        return `${quote(item.column)} ${item.dir === "desc" ? "DESC" : "ASC"}`;
      });
      const limit = Math.min(Math.max(Math.trunc(query?.limit ?? DEFAULT_LIMIT), 0), MAX_LIMIT);
      const offset = Math.max(Math.trunc(query?.offset ?? 0), 0);
      const sql =
        `SELECT * FROM ${quote(codec.table)}${where.sql}` +
        `${order.length === 0 ? "" : ` ORDER BY ${order.join(", ")}`} LIMIT ? OFFSET ?`;
      const rows: Readonly<Record<string, unknown>>[] = [];
      for (const raw of select(sql, [...where.params, limit, offset])) {
        const decoded = decodeRow(raw);
        if (!decoded.ok) return decoded;
        rows.push(decoded.value);
      }
      return ok(rows);
    },
    count(where) {
      const clause = whereClause(codec, where, threadId);
      const [row] = select(
        `SELECT COUNT(*) AS "n" FROM ${quote(codec.table)}${clause.sql}`,
        clause.params,
      );
      const n = row?.["n"];
      return typeof n === "number" ? n : 0;
    },
  };
}

// ── 제거 미리 보기와 삭제 ─────────────────────────────────────────────────

/** 저장소에 그 이름의 테이블이 있는가(`sqlite_schema`). 장부에 행만 남은 이름을 건너뛰려고 본다 */
const TABLE_PRESENT_SQL = `SELECT 1 AS "present" FROM sqlite_schema WHERE type = 'table' AND name = ?`;

/** 소유 장부에서 확장의 테이블 이름을 읽는다. 장부 테이블이 아직 없으면 빈 목록이다 */
/** 마지막으로 지운 시점의 이벤트 위치. 지운 적이 없으면 0 */
function droppedSeqOf(tx: SqlTx, extension: ExtensionName): number {
  if (tx.get(TABLE_PRESENT_SQL, [TOMBSTONE_TABLE]) === undefined) return 0;
  const row = tx.get(`SELECT * FROM ${quote(TOMBSTONE_TABLE)} WHERE "extension" = ?`, [extension]);
  const seq = row?.["dropped_seq"];
  return typeof seq === "number" ? seq : 0;
}

function ledgerTablesOf(tx: SqlTx, extension: ExtensionName): readonly string[] {
  if (tx.get(TABLE_PRESENT_SQL, [LEDGER_TABLE]) === undefined) return [];
  const rows = tx.all(`SELECT * FROM ${quote(LEDGER_TABLE)} WHERE "extension" = ?`, [extension]);
  const names: string[] = [];
  for (const row of rows) {
    const table = row["table"];
    if (typeof table === "string") names.push(table);
  }
  return names.toSorted();
}

function rowCountOf(tx: SqlTx, table: string): number {
  const row = tx.get(`SELECT COUNT(*) AS "n" FROM ${quote(table)}`, []);
  const n = row?.["n"];
  if (typeof n === "number") return n;
  if (typeof n === "bigint") return Number(n);
  throw new Bug(`ext_storage.count_invalid: ${table}`);
}

/** 저장소 호출의 실패(삭제 포트, 읽기·쓰기 핸들)를 `ExtStorageError` 값으로 옮긴다 */
function storageErrorOf(error: ExtensionTableError | StoreReadError): ExtStorageError {
  switch (error.kind) {
    case "ext_id_invalid":
      return { kind: "identifier_invalid", name: error.name };
    case "table_not_owned":
      return { kind: "table_not_owned", table: error.table };
    case "busy":
      return { kind: "busy" };
    case "disk_full":
      return { kind: "io", code: "disk_full" };
    case "io":
      return { kind: "io", code: error.code };
    default:
      return assertNever(error, "ExtensionTableError");
  }
}

/** 소유 장부 마이그레이션의 실패를 `ExtStorageError`로 옮긴다. 재시도할 수 있는 것만 busy·io로 나누고 나머지는 코드 이름을 싣는다 */
function migrationFailure(error: MigrationError): ExtStorageError {
  switch (error.kind) {
    case "busy":
      return { kind: "busy" };
    case "disk_full":
      return { kind: "io", code: "disk_full" };
    case "migration_checksum_mismatch":
    case "migration_future_version":
    case "migration_gap":
    case "migration_failed":
      return { kind: "io", code: error.kind };
    default:
      return assertNever(error, "MigrationError");
  }
}

// ── 관리자 ────────────────────────────────────────────────────────────────

export interface ExtStorageDeps {
  readonly ports: PortLookup;
  readonly now: () => number;
  /** 참이면 생성한 모든 문장에 checkStatement를 적용한다(테스트·디버그 빌드) */
  readonly guard: boolean;
  /** 투영기 apply 예외 통지를 확장 단위로 받는다(자동 끄기 연결, X.operations.spec §5 6번) */
  readonly onProjectionFailure: (extension: ExtensionName, failure: ProjectorFailure) => void;
}

/** 제거 확인 화면이 보이는 테이블 하나와 그 행 수 */
interface ExtStorageTableCount {
  /** 실제 테이블 이름(`x_<확장>_<지역 이름>`) */
  readonly name: string;
  readonly rows: number;
}

interface ExtStoragePreview {
  /** 소유 장부에 오르고 저장소에 실제로 있는 테이블. 이름 순이다 */
  readonly tables: readonly ExtStorageTableCount[];
}

export interface ExtStorageManager {
  /** 확장마다 하나. isolated가 참이면 defineTables는 isolated 오류다 */
  storageFor(extension: ExtensionName, options: { readonly isolated: boolean }): ExtStorage;
  /** 확장 제거 때 투영기를 해제한다. 테이블은 남는다 */
  release(extension: ExtensionName): void;
  /** 제거 확인용. 소유 장부에서 그 확장의 테이블과 행 수를 읽는다. 아무것도 쓰지 않는다. 장부가 없으면 빈 목록이다 */
  preview(extension: ExtensionName): Result<ExtStoragePreview, ExtStorageError>;
  /**
   * 제거 때 그 확장의 소유 테이블을 지우고 장부 행을 뺀다(X.operations.spec §4.4.7). 먼저 투영기를 해제해 지워질
   * 테이블에 아무도 쓰지 않게 한다. 이벤트는 남고, 지운 시점의 이벤트 위치를 기록해 다시 설치해도 그 이전 이벤트로 표를 채우지 않는다. 지운 테이블 이름을 돌려준다
   */
  drop(extension: ExtensionName): Result<{ readonly dropped: readonly string[] }, ExtStorageError>;
}

interface Defined {
  readonly dispose: () => void;
  readonly unsubscribe: () => void;
}

export function createExtStorageManager(deps: ExtStorageDeps): ExtStorageManager {
  const storages = new Map<ExtensionName, ExtStorage>();
  const defined = new Map<ExtensionName, Defined>();

  function build(extension: ExtensionName, isolated: boolean): ExtStorage {
    const prefix = extTablePrefix(extension);
    const guardFn = deps.guard
      ? (sql: string): void => {
          const violations = checkStatement(sql, prefix);
          if (violations.length > 0) {
            throw new Bug(`ext_storage.guard: ${JSON.stringify(violations)} in ${sql}`);
          }
        }
      : undefined;

    return {
      extension,
      prefix,
      defineTables<const D extends ExtTableDefs>(
        defs: D,
        projection: ExtProjection<D>,
      ): Result<ExtTables<D>, ExtStorageError> {
        if (isolated) return err({ kind: "isolated" });
        if (defined.has(extension)) return err({ kind: "already_defined" });
        const registry = deps.ports.get(ProjectorRegistryPortKey);
        const store = deps.ports.get(ScopedStorePortKey);
        if (registry === undefined)
          return err({ kind: "port_unavailable", port: "fresnel.session" });
        if (store === undefined) return err({ kind: "port_unavailable", port: "fresnel.store" });

        const codecs = new Map<string, Codec>();
        const ddl: string[] = [];
        for (const [local, def] of Object.entries(defs)) {
          const statements = tableDdl(extension, local, def);
          if (!statements.ok) return statements;
          ddl.push(...statements.value);
          const codec = codecOf(extension, local, def);
          if (!codec.ok) return codec;
          codecs.set(local, codec.value);
        }
        for (const eventKind of projection.kinds) {
          const owner = ownerOfKind(eventKind);
          const foreign =
            owner !== undefined && owner.startsWith("ext.") && owner !== `ext.${extension}`;
          if (owner === undefined || foreign) return err({ kind: "kind_not_owned", eventKind });
        }
        const tables = [...codecs.values()].map((codec) => codec.table);
        if (guardFn !== undefined) for (const statement of ddl) guardFn(statement);

        // 소유 장부에서 이미 다른 확장이 가진 이름인지 본다
        const tablesPort = deps.ports.get(ExtensionTablesPortKey);
        if (tablesPort === undefined)
          return err({ kind: "port_unavailable", port: "fresnel.store" });
        const migrations = deps.ports.get(StoreMigrationsPortKey);
        if (migrations === undefined)
          return err({ kind: "port_unavailable", port: "fresnel.store" });
        const migrated = migrations.apply(LEDGER_MIGRATIONS);
        if (!migrated.ok) return err(migrationFailure(migrated.error));
        // `scoped("ext.<이름>")`은 접두가 등록된 확장에만 핸들을 준다. 이미 등록돼 있으면 그대로 둔다
        const registeredPrefix = tablesPort.register(extension);
        if (!registeredPrefix.ok) return err(storageErrorOf(registeredPrefix.error));
        const ledger = store.scoped("xh");
        const owned = ledger.write((tx) => {
          for (const table of tables) {
            const row = tx.get(`SELECT * FROM ${quote(LEDGER_TABLE)} WHERE "table" = ?`, [table]);
            const owner = row?.["extension"];
            if (typeof owner === "string" && owner !== extension) return { table, owner };
          }
          return undefined;
        });
        if (!owned.ok) return err({ kind: "busy" });
        if (owned.value !== undefined) {
          return err({ kind: "table_owned", table: owned.value.table, owner: owned.value.owner });
        }

        // 지운 시점(이벤트 위치) 이하 이벤트는 재생에서 건너뛴다. 이벤트는 남아 있고 표만 지운 시점부터 다시 쌓인다
        const floored = ledger.read((tx) => droppedSeqOf(tx, extension));
        if (!floored.ok) return err({ kind: "busy" });
        const floor = floored.value;

        const projector: Projector = {
          name: `ext.${extension}`,
          version: projection.version,
          tables,
          ddl,
          kinds: projection.kinds,
          apply(tx: ProjectionTx, event: DurableEventEnvelope): void {
            if (floor > 0 && event.seq <= floor) return;
            const runner: SqlRunner = {
              run: (sql, params) => {
                tx.run(sql, params);
              },
              get: (sql, params) => tx.get(sql, params),
              all: (sql, params) => tx.all(sql, params),
            };
            let firstRowError: ExtRowError | undefined;
            const writers = writersOf(defs, (local) => {
              const codec = codecs.get(local);
              if (codec === undefined) throw new Bug(`ext_storage.unknown_table: ${local}`);
              return writerFor(codec, runner, event.threadId, guardFn, (error) => {
                firstRowError ??= error;
              });
            });
            const applied = projection.apply(event, writers);
            // Projector.apply는 던져서 코어 커밋을 롤백하고 투영기 실패로 보고된다(F.records.spec §3.9). 값 오류를 그 통로로 옮긴다.
            // 쓰기 도중 거절된 행이 있으면 apply가 무엇을 돌려줬든 롤백한다(Result를 무시한 투영이 행을 잃지 않게 한다)
            if (firstRowError !== undefined) throw new ProjectionRollback(firstRowError);
            if (!applied.ok) throw new ProjectionRollback(applied.error);
          },
        };
        const registered = registry.register(projector);
        if (!registered.ok) {
          const failure = registered.error;
          switch (failure.kind) {
            case "name_taken":
              return err({ kind: "already_defined" });
            case "name_reserved":
              return err({ kind: "identifier_invalid", name: failure.name });
            case "table_not_owned":
              return err({ kind: "table_not_owned", table: failure.table });
            case "table_taken":
              return err({ kind: "table_owned", table: failure.table, owner: failure.owner });
            default:
              return assertNever(failure, "ProjectorRegisterError");
          }
        }
        const recorded = ledger.write((tx) => {
          for (const [local, codec] of codecs) {
            tx.run(
              `INSERT OR REPLACE INTO ${quote(LEDGER_TABLE)} ("table", "extension", "local", "projection_version", "created_at") VALUES (?, ?, ?, ?, ?)`,
              [codec.table, extension, local, projection.version, deps.now()],
            );
          }
        });
        if (!recorded.ok) {
          registered.value.dispose();
          return err({ kind: "busy" });
        }
        const unsubscribe = registry.onFailure((failure) => {
          if (failure.projector === `ext.${extension}`)
            deps.onProjectionFailure(extension, failure);
        });
        defined.set(extension, { dispose: () => registered.value.dispose(), unsubscribe });

        const reader = store.scoped(`ext.${extension}`);
        return ok({
          names: namesOf(defs, (local) => extTableName(extension, local)),
          read<T>(fn: (tables: ExtReaders<D>) => T, options?: ExtReadOptions) {
            const result = reader.read((tx: SqlTx) => {
              const runner: SqlRunner = {
                run: () => {
                  throw new Bug("ext_storage.write_in_read_callback");
                },
                get: (sql, params) => tx.get(sql, params),
                all: (sql, params) => tx.all(sql, params),
              };
              const readers = readersOf(defs, (local) => {
                const codec = codecs.get(local);
                if (codec === undefined) throw new Bug(`ext_storage.unknown_table: ${local}`);
                return readerFor(codec, runner, options?.threadId, guardFn);
              });
              return fn(readers);
            });
            return result.ok ? ok(result.value) : err({ kind: "busy" as const });
          },
        });
      },
    };
  }

  function releaseExtension(extension: ExtensionName): void {
    const found = defined.get(extension);
    if (found !== undefined) {
      found.unsubscribe();
      found.dispose();
      defined.delete(extension);
    }
    storages.delete(extension);
  }

  return {
    storageFor(extension, options) {
      let storage = storages.get(extension);
      if (storage === undefined) {
        storage = build(extension, options.isolated);
        storages.set(extension, storage);
      }
      return storage;
    },
    release: releaseExtension,
    preview(extension) {
      const store = deps.ports.get(ScopedStorePortKey);
      if (store === undefined) return err({ kind: "port_unavailable", port: "fresnel.store" });
      // 장부에 오르고 저장소에 남은 이름만 센다. 삭제가 중간에 끊겨 행만 남은 이름은 건너뛴다
      const present = store
        .scoped("xh")
        .read((tx) =>
          ledgerTablesOf(tx, extension).filter(
            (table) => tx.get(TABLE_PRESENT_SQL, [table]) !== undefined,
          ),
        );
      if (!present.ok) return err(storageErrorOf(present.error));
      if (present.value.length === 0) return ok({ tables: [] });
      // 행 수는 그 확장의 접두 핸들로 읽는다. 장부 핸들(`xh`)은 확장 테이블을 쓸 수 없다
      const counted = store.scoped(`ext.${extension}`).read((tx) =>
        present.value.map((table): ExtStorageTableCount => ({
          name: table,
          rows: rowCountOf(tx, table),
        })),
      );
      if (!counted.ok) return err(storageErrorOf(counted.error));
      return ok({ tables: counted.value });
    },
    drop(extension) {
      const store = deps.ports.get(ScopedStorePortKey);
      const tables = deps.ports.get(ExtensionTablesPortKey);
      if (store === undefined) return err({ kind: "port_unavailable", port: "fresnel.store" });
      if (tables === undefined) return err({ kind: "port_unavailable", port: "fresnel.store" });
      const listed = store.scoped("xh").read((tx) => ledgerTablesOf(tx, extension));
      if (!listed.ok) return err(storageErrorOf(listed.error));
      // 지우기 전에 투영기를 내린다. 남은 투영기가 지워진 테이블에 쓰지 않게 한다. 다시 설치하면 새로 등록된다
      releaseExtension(extension);
      const dropped = tables.drop(extension, listed.value);
      if (!dropped.ok) return err(storageErrorOf(dropped.error));
      const cleared = store.scoped("xh").write((tx) => {
        if (tx.get(TABLE_PRESENT_SQL, [LEDGER_TABLE]) === undefined) return;
        tx.run(`DELETE FROM ${quote(LEDGER_TABLE)} WHERE "extension" = ?`, [extension]);
        // 지운 시점을 같은 트랜잭션에 남긴다. 다시 설치하면 이 위치 뒤 이벤트만 표에 쌓는다
        if (tx.get(TABLE_PRESENT_SQL, [TOMBSTONE_TABLE]) === undefined) return;
        tx.run(
          `INSERT OR REPLACE INTO ${quote(TOMBSTONE_TABLE)} ("extension", "dropped_seq", "dropped_at") VALUES (?, ?, ?)`,
          [extension, dropped.value.headSeq, deps.now()],
        );
      });
      if (!cleared.ok) return err(storageErrorOf(cleared.error));
      return ok({ dropped: dropped.value.dropped });
    },
  };
}

/** 정책이 저장 관리자를 들고 있을 때의 모양 */
interface StorageHost {
  readonly storage: ExtStorageManager;
}

function hasStorage(policy: DispatchPolicy): policy is DispatchPolicy & StorageHost {
  return "storage" in policy;
}

/**
 * 확장 코드가 자기 저장 영역을 얻는 함수 [제안]. hostOf(g)와 같은 방식으로 setup이 받은 g를 받는다.
 * ext-host가 만든 g가 아니면 PrimitiveError("no_context"). 격리 확장이면 defineTables가 isolated 오류를 낸다
 */
export function storageOf<S>(g: RegistrationApi<S>): ExtStorage {
  const internals = scopeInternalsOf(g);
  const policy = internals.core.deps.policy;
  if (!hasStorage(policy)) {
    throw new Bug("storageOf needs a host created with createOperationsPolicy as its policy");
  }
  return policy.storage.storageFor(internals.record.extension, {
    isolated: internals.record.manifest.isolation === "process",
  });
}
