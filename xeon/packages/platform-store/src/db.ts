import { SQLiteError, type Database } from "bun:sqlite";
import { Bug, err, ok, type Result } from "@xeon/contracts";
import type {
  SqlRow,
  SqlTx,
  SqlValue,
  StoreDb,
  StoreReadError,
  StoreWriteError,
} from "@xeon/contracts/records";
import { classifyStatement, type StatementGuard } from "./prefix.ts";
import { toSqlRow } from "./rows.ts";

/** 연결 수명. write/read 래퍼와 임대·블롭이 함께 본다 */
export interface StoreState {
  /** closing이면 내부 경로(임대 반납)만 쓸 수 있다 */
  phase: "open" | "closing" | "closed";
  /** 쓰기 트랜잭션 콜백 안인가. 중첩 write와 트랜잭션 안 블롭·임대 호출을 막는다(TX-04) */
  inWrite: boolean;
}

export function createStoreState(): StoreState {
  return { phase: "open", inWrite: false };
}

export interface StoreConnections {
  readonly write: Database;
  readonly read: Database;
  readonly state: StoreState;
}

function isThenable(value: unknown): boolean {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

type SqliteClass = "busy" | "disk_full" | "io" | "corrupt" | "other";

export function classifySqliteCode(code: string | undefined): SqliteClass {
  if (code === undefined) return "other";
  if (code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED")) return "busy";
  if (code === "SQLITE_FULL") return "disk_full";
  if (
    code.startsWith("SQLITE_IOERR") ||
    code.startsWith("SQLITE_READONLY") ||
    code.startsWith("SQLITE_CANTOPEN")
  ) {
    return "io";
  }
  if (code.startsWith("SQLITE_CORRUPT") || code === "SQLITE_NOTADB") return "corrupt";
  return "other";
}

function mapStorageError(caught: unknown): StoreWriteError | undefined {
  if (!(caught instanceof SQLiteError)) return undefined;
  const code = caught.code;
  switch (classifySqliteCode(code)) {
    case "busy":
      return { kind: "busy" };
    case "disk_full":
      return { kind: "disk_full" };
    case "io":
      return { kind: "io", code: code ?? "SQLITE_IOERR" };
    case "corrupt":
      // 손상된 파일은 코드나 설정이 올바라도 생긴다(수동 편집, 매체 오류). io 오류 값으로 돌려주고 code로 손상을 구분한다
      return { kind: "io", code: code ?? "SQLITE_CORRUPT" };
    case "other":
      return undefined;
    default:
      return undefined;
  }
}

function assertUsable(state: StoreState, internal: boolean): void {
  if (state.phase === "closed" || (state.phase === "closing" && !internal)) {
    throw new Bug("store.closed: the store is closed");
  }
}

/** 쓰기 트랜잭션 밖에서만 부를 수 있는 연산(putBlob, acquire, renew, release, migrations.apply)의 검사 */
export function assertNotInWrite(state: StoreState, what: string): void {
  if (state.inWrite) {
    throw new Bug(`store.nested_write: ${what} cannot run inside a write transaction`);
  }
}

/** bun:sqlite 연결을 SqlTx로 감싼다. guard가 있으면 문장마다 소유 검사를 거친다 */
export function createSqlTx(db: Database, guard?: StatementGuard): SqlTx {
  const prepared = (sql: string): void => {
    if (guard !== undefined) guard.check(sql, db);
  };
  return {
    run(sql: string, params: readonly SqlValue[] = []): { readonly changes: number } {
      prepared(sql);
      // DDL은 한 번 쓰고 버리므로 캐시하지 않는 db.run으로 실행한다
      const changes =
        classifyStatement(sql).kind === "ddl"
          ? db.run(sql, [...params])
          : db.query<unknown, SqlValue[]>(sql).run(...params);
      return { changes: changes.changes };
    },
    get(sql: string, params: readonly SqlValue[] = []): SqlRow | undefined {
      prepared(sql);
      const row = db.query<unknown, SqlValue[]>(sql).get(...params);
      return row === null ? undefined : toSqlRow(row);
    },
    all(sql: string, params: readonly SqlValue[] = []): readonly SqlRow[] {
      prepared(sql);
      return db
        .query<unknown, SqlValue[]>(sql)
        .all(...params)
        .map(toSqlRow);
    },
  };
}

export interface StoreDbOptions {
  readonly guard?: StatementGuard;
  /** closing 단계에서도 쓸 수 있다. 임대 반납 같은 내부 경로 전용 */
  readonly internal?: boolean;
}

/** write/read 트랜잭션 래퍼(L0.store.spec §4.5). 루트 핸들과 범위 핸들이 같은 구현을 쓴다 */
export function createStoreDb(conn: StoreConnections, options: StoreDbOptions = {}): StoreDb {
  const internal = options.internal === true;
  return {
    write<T>(fn: (tx: SqlTx) => T): Result<T, StoreWriteError> {
      assertUsable(conn.state, internal);
      if (conn.state.inWrite) {
        throw new Bug("store.nested_write: write was called inside a write transaction");
      }
      conn.state.inWrite = true;
      try {
        const transaction = conn.write.transaction((): T => {
          const value = fn(createSqlTx(conn.write, options.guard));
          if (isThenable(value)) {
            throw new Bug("store.async_tx: the write callback must be synchronous");
          }
          return value;
        });
        return ok(transaction.immediate());
      } catch (caught) {
        const mapped = mapStorageError(caught);
        if (mapped !== undefined) return err(mapped);
        throw caught;
      } finally {
        conn.state.inWrite = false;
      }
    },
    read<T>(fn: (tx: SqlTx) => T): Result<T, StoreReadError> {
      assertUsable(conn.state, internal);
      try {
        const transaction = conn.read.transaction((): T => {
          const value = fn(createSqlTx(conn.read, options.guard));
          if (isThenable(value)) {
            throw new Bug("store.async_tx: the read callback must be synchronous");
          }
          return value;
        });
        return ok(transaction.deferred());
      } catch (caught) {
        const mapped = mapStorageError(caught);
        if (mapped === undefined) throw caught;
        if (mapped.kind === "disk_full") return err({ kind: "io", code: "SQLITE_FULL" });
        return err(mapped);
      }
    },
  };
}
