// 실제 SQLite(bun:sqlite)로 만든 L0 대역. platform-store가 이 패키지에 연결되지 않아(openIssues) 같은 F 인터페이스
// (StoreDb, LeaseService, MigrationRunner)를 최소로 구현한다. 저장소를 배열로 흉내 내지 않는다(TS-07).
import { Database } from "bun:sqlite";
import { Bug, canonicalJson, err, ok, type Result } from "@xeon/contracts";
import type {
  LeaseError,
  LeaseHolder,
  LeaseOwnerInfo,
  LeaseResource,
  LeaseService,
  LeaseToken,
  MigrationError,
  MigrationReport,
  MigrationRunner,
  MigrationSet,
  SqlRow,
  SqlTx,
  SqlValue,
  StoreDb,
  StoreReadError,
  StoreWriteError,
} from "@xeon/contracts/records";
import { sha256Hex } from "../../src/hash.ts";

function toRow(value: unknown): SqlRow {
  if (typeof value !== "object" || value === null) throw new Bug("row must be an object");
  const row: Record<string, SqlValue> = {};
  for (const [key, cell] of Object.entries(value)) {
    if (
      cell === null ||
      typeof cell === "string" ||
      typeof cell === "number" ||
      typeof cell === "bigint" ||
      cell instanceof Uint8Array
    ) {
      row[key] = cell;
    } else {
      throw new Bug(`unsupported cell type in column ${key}`);
    }
  }
  return row;
}

const SCHEMA_STATEMENT = /^\s*(CREATE|DROP|ALTER|PRAGMA)\b/i;

function createTx(raw: Database): SqlTx {
  return {
    run(sql, params = []) {
      if (SCHEMA_STATEMENT.test(sql)) return { changes: raw.run(sql, [...params]).changes };
      return { changes: raw.query<unknown, SqlValue[]>(sql).run(...params).changes };
    },
    get(sql, params = []) {
      const row = raw.query<unknown, SqlValue[]>(sql).get(...params);
      return row === null ? undefined : toRow(row);
    },
    all(sql, params = []) {
      return raw
        .query<unknown, SqlValue[]>(sql)
        .all(...params)
        .map(toRow);
    },
  };
}

const SYS_LEASES_DDL = `CREATE TABLE IF NOT EXISTS sys_leases (
  resource     TEXT PRIMARY KEY,
  holder_id    TEXT NOT NULL,
  epoch        INTEGER NOT NULL CHECK (epoch >= 1),
  kind         TEXT NOT NULL,
  pid          INTEGER NOT NULL,
  started_at   INTEGER NOT NULL,
  host         TEXT NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  released_at  INTEGER
) STRICT`;

const SYS_MIGRATIONS_DDL = `CREATE TABLE IF NOT EXISTS sys_migrations (
  owner TEXT NOT NULL, version INTEGER NOT NULL, checksum TEXT NOT NULL,
  PRIMARY KEY (owner, version)
) STRICT`;

function ownerInfo(row: SqlRow): LeaseOwnerInfo {
  return {
    holderId: String(row["holder_id"]),
    kind: "cli",
    pid: Number(row["pid"]),
    startedAt: Number(row["started_at"]),
    host: String(row["host"]),
    epoch: Number(row["epoch"]),
    heartbeatAt: Number(row["heartbeat_at"]),
    expiresAt: Number(row["expires_at"]),
  };
}

export const TEST_HOLDER_A: LeaseHolder = {
  holderId: "holder-a",
  kind: "cli",
  pid: 1001,
  startedAt: 1_767_571_200_000,
  host: "test-host",
};

export const TEST_HOLDER_B: LeaseHolder = {
  holderId: "holder-b",
  kind: "cli",
  pid: 1002,
  startedAt: 1_767_571_200_000,
  host: "test-host",
};

interface TestLeases extends LeaseService {
  /** 다른 홀더가 임대를 인수한 상황(epoch + 1). 이전 토큰으로 하는 커밋은 ownership_lost여야 한다 */
  takeover(resource: LeaseResource, holder: LeaseHolder): LeaseToken;
  /** keepAlive가 임대를 잃었다고 알리는 상황 */
  loseLease(resource: LeaseResource): void;
}

export interface TestStore {
  readonly raw: Database;
  readonly db: StoreDb;
  readonly leases: TestLeases;
  readonly migrations: MigrationRunner;
  /** 사용자 테이블(sqlite_ 제외)의 행 수 */
  rowCounts(): Readonly<Record<string, number>>;
  /** 사용자 테이블마다 기본 키 정렬 행 해시(행 수와 내용이 같음을 대조한다) */
  tableHashes(): Readonly<Record<string, string>>;
  close(): void;
}

export interface TestStoreOptions {
  /** 생략하면 :memory: */
  readonly path?: string;
  readonly now: () => number;
}

/** 이미 열린 데이터베이스 파일을 한 번 더 연다(프로세스 재시작 흉내). 같은 파일이면 마이그레이션은 건너뛴다 */
export function openTestStore(options: TestStoreOptions): TestStore {
  const raw = new Database(options.path ?? ":memory:");
  raw.run("PRAGMA journal_mode = WAL");
  raw.run("PRAGMA synchronous = FULL");
  raw.run("PRAGMA busy_timeout = 5000");
  raw.run(SYS_LEASES_DDL);
  raw.run(SYS_MIGRATIONS_DDL);
  const state = { inWrite: false };
  const tx = createTx(raw);

  const db: StoreDb = {
    write<T>(fn: (tx: SqlTx) => T): Result<T, StoreWriteError> {
      if (state.inWrite) throw new Bug("store.nested_write: write inside write");
      state.inWrite = true;
      raw.run("BEGIN IMMEDIATE");
      try {
        const value = fn(tx);
        raw.run("COMMIT");
        return ok(value);
      } catch (caught) {
        raw.run("ROLLBACK");
        throw caught;
      } finally {
        state.inWrite = false;
      }
    },
    read<T>(fn: (tx: SqlTx) => T): Result<T, StoreReadError> {
      return ok(fn(tx));
    },
  };

  const leaseRow = (resource: string): SqlRow | undefined =>
    tx.get("SELECT * FROM sys_leases WHERE resource = ?", [resource]);

  const lostCallbacks = new Map<LeaseResource, () => void>();

  const writeLease = (resource: string, holder: LeaseHolder, epoch: number): void => {
    const now = options.now();
    tx.run(
      `INSERT INTO sys_leases (resource, holder_id, epoch, kind, pid, started_at, host, heartbeat_at, expires_at, released_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(resource) DO UPDATE SET holder_id = excluded.holder_id, epoch = excluded.epoch,
         kind = excluded.kind, pid = excluded.pid, started_at = excluded.started_at, host = excluded.host,
         heartbeat_at = excluded.heartbeat_at, expires_at = excluded.expires_at, released_at = NULL`,
      [
        resource,
        holder.holderId,
        epoch,
        holder.kind,
        holder.pid,
        holder.startedAt,
        holder.host,
        now,
        now + 30_000,
      ],
    );
  };

  const leases: TestLeases = {
    acquire(resource, holder): Result<LeaseToken, LeaseError> {
      const row = leaseRow(resource);
      if (row === undefined) {
        writeLease(resource, holder, 1);
        return ok({ resource, holderId: holder.holderId, epoch: 1 });
      }
      const epoch = Number(row["epoch"]);
      const released = row["released_at"] !== null;
      if (!released && row["holder_id"] === holder.holderId) {
        writeLease(resource, holder, epoch);
        return ok({ resource, holderId: holder.holderId, epoch });
      }
      if (released) {
        writeLease(resource, holder, epoch + 1);
        return ok({ resource, holderId: holder.holderId, epoch: epoch + 1 });
      }
      return err({ kind: "lock_busy", resource, reason: "lease_active", owner: ownerInfo(row) });
    },
    renew(): Result<void, LeaseError> {
      return ok(undefined);
    },
    release(token): Result<void, LeaseError> {
      tx.run(
        "UPDATE sys_leases SET released_at = ? WHERE resource = ? AND holder_id = ? AND epoch = ? AND released_at IS NULL",
        [options.now(), token.resource, token.holderId, token.epoch],
      );
      return ok(undefined);
    },
    holds(inTx, token): boolean {
      const row = inTx.get(
        "SELECT holder_id, epoch, released_at FROM sys_leases WHERE resource = ?",
        [token.resource],
      );
      return (
        row !== undefined &&
        row["holder_id"] === token.holderId &&
        row["epoch"] === token.epoch &&
        row["released_at"] === null
      );
    },
    inspect(resource) {
      const row = leaseRow(resource);
      if (row === undefined || row["released_at"] !== null) return ok(null);
      return ok(ownerInfo(row));
    },
    keepAlive(token, onLost): Disposable {
      lostCallbacks.set(token.resource, () => {
        onLost(token.resource);
      });
      return {
        [Symbol.dispose]: () => {
          lostCallbacks.delete(token.resource);
        },
      };
    },
    takeover(resource, holder): LeaseToken {
      const row = leaseRow(resource);
      const epoch = row === undefined ? 1 : Number(row["epoch"]) + 1;
      writeLease(resource, holder, epoch);
      return { resource, holderId: holder.holderId, epoch };
    },
    loseLease(resource): void {
      lostCallbacks.get(resource)?.();
    },
  };

  const migrations: MigrationRunner = {
    apply(set: MigrationSet): Result<MigrationReport, MigrationError> {
      const applied = tx
        .all("SELECT version FROM sys_migrations WHERE owner = ?", [set.owner])
        .map((row) => Number(row["version"]));
      const from = applied.length === 0 ? 0 : Math.max(...applied);
      for (const step of set.steps) {
        if (step.version <= from) continue;
        db.write((inTx) => {
          for (const sql of step.sql) inTx.run(sql);
          inTx.run("INSERT INTO sys_migrations (owner, version, checksum) VALUES (?, ?, ?)", [
            set.owner,
            step.version,
            sha256Hex(step.sql.join("\n;\n")),
          ]);
        });
      }
      return ok({ owner: set.owner, from, to: set.version });
    },
    runChunked(): Promise<never> {
      return Promise.reject(new Bug("not needed in core-persistence tests"));
    },
  };

  const userTables = (): readonly string[] =>
    tx
      .all(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .map((row) => String(row["name"]));

  return {
    raw,
    db,
    leases,
    migrations,
    rowCounts() {
      return Object.fromEntries(
        userTables().map((table) => [
          table,
          Number(tx.get(`SELECT COUNT(*) AS n FROM ${table}`)?.["n"] ?? 0),
        ]),
      );
    },
    tableHashes() {
      return Object.fromEntries(
        userTables().map((table) => {
          const columns = tx
            .all(`SELECT name FROM pragma_table_info('${table}')`)
            .map((row) => `"${String(row["name"])}"`)
            .join(", ");
          return [
            table,
            sha256Hex(canonicalJson(tx.all(`SELECT * FROM ${table} ORDER BY ${columns}`))),
          ];
        }),
      );
    },
    close(): void {
      raw.close();
    },
  };
}
