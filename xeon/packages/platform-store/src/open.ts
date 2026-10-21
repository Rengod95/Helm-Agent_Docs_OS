import { existsSync, closeSync, openSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { err, ok, type Result } from "@xeon/contracts";
import type { FaultInjector, StoreCapabilities } from "@xeon/contracts/records";
import { createBlobStore } from "./blob.ts";
import {
  classifySqliteCode,
  createStoreDb,
  createStoreState,
  type StoreConnections,
} from "./db.ts";
import { createExtensionTables } from "./ext-tables.ts";
import { NO_STORE_FAULTS } from "./fault-points.ts";
import { ensurePrivateDir, ensurePrivateFile } from "./fs-private.ts";
import { createLeaseService } from "./lease.ts";
import { createMigrationRunner } from "./migrations.ts";
import { syncCoreOwners } from "./owner-table.ts";
import { APPLICATION_ID, applyReadPragmas, applyWritePragmas, readPragma } from "./pragmas.ts";
import { isStrictBuild } from "./prefix.ts";
import { createLockProvider, selectPlatformPolicy } from "./select.ts";
import { assembleStoreService, createScopedFactory } from "./service.ts";
import {
  asSqliteFailure,
  initSqlite,
  loadedSqlitePath,
  newDatabase,
  probeSqlite,
  type SqliteConnection,
} from "./sqlite-env.ts";
import { columnInt, columnString, toSqlRow } from "./rows.ts";
import { SYS_MIGRATION_SET } from "./sys-schema.ts";
import type {
  OpenedStore,
  OpenResult,
  OpenStoreOptions,
  StoreOpenError,
  StoreWarning,
} from "./types.ts";

const NO_FAULTS: FaultInjector = { hit: (): void => {} };

function fsCode(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

/** SQLiteError를 열기 오류로 바꾼다. 그 밖의 예외는 undefined(호출자가 다시 던진다) */
function openErrorOf(caught: unknown): StoreOpenError | undefined {
  const failure = asSqliteFailure(caught);
  if (failure === undefined) return undefined;
  const code = failure.code ?? "SQLITE_ERROR";
  switch (classifySqliteCode(failure.code)) {
    case "busy":
      return { kind: "busy" };
    case "disk_full":
      return { kind: "disk_full" };
    case "io":
      return { kind: "io", code };
    case "corrupt":
      return { kind: "corrupt", code };
    case "other":
      return undefined;
    default:
      return undefined;
  }
}

function newStoreId(options: OpenStoreOptions): string {
  // IdPrefix에 sto가 없다(F.wire-settings.spec §10 미결 7). 주입된 IdFactory의 ULID 부분을 빌려 sto_<ULID>를 만든다
  return `sto_${options.ids.next("evt").slice(4)}`;
}

/**
 * application_id와 스키마 유무를 한 스냅숏에서 읽는다. 다른 프로세스가 같은 순간 새 파일을 초기화해도
 * "표지는 0인데 테이블이 있음"으로 잘못 보지 않는다(표지는 테이블보다 먼저 커밋된다).
 */
function readIdentity(db: SqliteConnection): {
  readonly applicationId: number;
  readonly hasSchema: boolean;
} {
  return db
    .transaction(() => {
      const id = readPragma(db, "application_id");
      const row = db.query<unknown, []>("SELECT count(*) AS n FROM sqlite_schema").get();
      return {
        applicationId: typeof id === "number" ? id : 0,
        hasSchema: columnInt(toSqlRow(row), "n") > 0,
      };
    })
    .deferred();
}

/** 열기 절차(L0.store.spec §4.4). 쓰기 연결 PRAGMA 뒤 바로 읽기 연결을 연다(WAL이 이미 만들어져 있다) */
function openStoreSync(options: OpenStoreOptions): OpenResult {
  const warnings: StoreWarning[] = [];
  const policy = selectPlatformPolicy(options.env.platform);

  if (!isAbsolute(options.dbPath)) return err({ kind: "db_path_invalid", reason: "not_absolute" });
  if (existsSync(options.dbPath) && statSync(options.dbPath).isDirectory()) {
    return err({ kind: "db_path_invalid", reason: "is_directory" });
  }

  // 1. SQLite 로드와 FTS5 프로브
  initSqlite(
    policy.customSqlite
      ? (options.settings.customSqlitePath ?? options.env.bundledSqlitePath)
      : null,
  );
  const probe = (options.probe ?? probeSqlite)();
  if (!probe.fts5) {
    if (options.settings.requireFts5) return err({ kind: "fts5_missing" });
    warnings.push({ kind: "fts5_missing" });
  }

  // 2. 경로·권한·파일시스템 검사
  const dir = dirname(options.dbPath);
  const fsKind = options.env.dbDirFsKind;
  if (fsKind === "network" || fsKind === "drvfs") {
    return err({ kind: "unsupported_filesystem", fsKind, dir });
  }
  if (fsKind === "unknown") warnings.push({ kind: "fs_unknown", dir });
  const dirReady = ensurePrivateDir(dir, policy.posixPermissions, warnings);
  if (!dirReady.ok) return dirReady;
  const realDir = realpathSync(dir);
  const isNewFile = !existsSync(options.dbPath);
  try {
    // 새 파일은 0600으로 먼저 만든다. SQLite가 -wal, -shm을 이 파일의 모드에 맞춘다
    if (isNewFile) closeSync(openSync(options.dbPath, "wx", 0o600));
  } catch (caught) {
    // 다른 프로세스가 같은 순간에 먼저 만들었다. 있는 파일로 계속한다
    if (fsCode(caught) !== "EEXIST") return err({ kind: "io", code: fsCode(caught) });
  }
  const fileReady = ensurePrivateFile(options.dbPath, policy.posixPermissions, warnings);
  if (!fileReady.ok) return fileReady;

  const opened: SqliteConnection[] = [];
  const closeAll = (): void => {
    for (const db of opened) db.close();
  };
  try {
    // 3. 쓰기 연결 열기, application_id 대조, PRAGMA 적용과 검증
    const write = newDatabase(options.dbPath, { create: true });
    opened.push(write);
    // 다른 프로세스가 같은 순간 초기화하고 있을 수 있으므로 첫 읽기 전에 대기 시간부터 건다
    write.run(`PRAGMA busy_timeout = ${options.settings.busyTimeoutMs}`);
    const { applicationId, hasSchema } = readIdentity(write);
    if (
      (applicationId !== 0 && applicationId !== APPLICATION_ID) ||
      (applicationId === 0 && hasSchema)
    ) {
      closeAll();
      return err({ kind: "foreign_database", applicationId });
    }
    const written = applyWritePragmas(write, {
      busyTimeoutMs: options.settings.busyTimeoutMs,
      stampApplicationId: applicationId === 0,
      fullFsync: policy.fullFsync && options.settings.macFullFsync,
      checkpointFullFsync: policy.fullFsync && !options.settings.macFullFsync,
    });
    if (!written.ok) {
      closeAll();
      return err(written.error);
    }
    const read = newDatabase(options.dbPath, { readonly: true });
    opened.push(read);
    const readReady = applyReadPragmas(read, options.settings.busyTimeoutMs);
    if (!readReady.ok) {
      closeAll();
      return err(readReady.error);
    }
    for (const suffix of ["-wal", "-shm"]) {
      if (existsSync(`${options.dbPath}${suffix}`)) {
        const sidecar = ensurePrivateFile(
          `${options.dbPath}${suffix}`,
          policy.posixPermissions,
          warnings,
        );
        if (!sidecar.ok) {
          closeAll();
          return sidecar;
        }
      }
    }

    const state = createStoreState();
    const conn: StoreConnections = { write, read, state };
    const faults = options.storeFaults ?? NO_STORE_FAULTS;
    const strict = options.strictPrefix ?? isStrictBuild(process.env);

    // 4. owner sys 마이그레이션
    const migrations = createMigrationRunner({
      conn,
      clock: options.clock,
      engineVersion: options.engineVersion,
      strict,
      faults,
    });
    const migrated = migrations.apply(SYS_MIGRATION_SET);
    if (!migrated.ok) {
      closeAll();
      return err(migrated.error);
    }

    // 5~6. sys_meta 기록과 코어 접두사 소유표 등록
    const internal = createStoreDb(conn, { internal: true });
    const now = options.clock.now();
    const stamped = internal.write((tx): string => {
      const existing = tx.get("SELECT value FROM sys_meta WHERE key = 'store_id'");
      let id: string;
      if (existing === undefined) {
        id = newStoreId(options);
        tx.run("INSERT INTO sys_meta (key, value) VALUES ('store_id', ?)", [id]);
        tx.run("INSERT INTO sys_meta (key, value) VALUES ('created_at', ?)", [String(now)]);
        tx.run("INSERT INTO sys_meta (key, value) VALUES ('created_by', ?)", [
          options.engineVersion,
        ]);
      } else {
        id = columnString(existing, "value");
      }
      tx.run(
        "INSERT INTO sys_meta (key, value) VALUES ('last_opened_by', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [options.engineVersion],
      );
      syncCoreOwners(tx, now);
      return id;
    });
    if (!stamped.ok) {
      closeAll();
      return err(stamped.error);
    }
    const storeId = stamped.value;

    // 8. LockProvider 선택
    const locksDir = join(realDir, "locks");
    const locksReady = ensurePrivateDir(locksDir, policy.posixPermissions, warnings);
    if (!locksReady.ok) {
      closeAll();
      return locksReady;
    }
    const locks = createLockProvider(policy.lock, locksDir);
    if (locks.kind === "none") warnings.push({ kind: "lock_provider_none" });

    // 9. 블롭 디렉터리
    const blobsDir = join(realDir, "blobs");
    for (const path of [blobsDir, join(blobsDir, "tmp")]) {
      const ready = ensurePrivateDir(path, policy.posixPermissions, warnings);
      if (!ready.ok) {
        closeAll();
        return ready;
      }
    }

    // 10. StoreService 조립
    const leases = createLeaseService({
      conn,
      clock: options.clock,
      scheduler: options.scheduler,
      locks,
      settings: options.settings,
      processStartedAt: options.env.processStartedAt,
      faults,
    });
    const blobs = createBlobStore({
      conn,
      clock: options.clock,
      ids: options.ids,
      blobsDir,
      faults,
      directoryFsync: policy.directoryFsync,
      verifyHash: strict,
    });
    const capabilities: StoreCapabilities = {
      fts5: probe.fts5,
      sqliteVersion: probe.sqliteVersion,
      customSqlitePath: loadedSqlitePath(),
      lockProvider: locks.kind,
    };
    const service = assembleStoreService({
      storeId,
      capabilities,
      scoped: createScopedFactory(conn, strict),
      migrations,
      extensions: createExtensionTables({ conn, clock: options.clock }),
      leases,
      blobs,
    });

    const closeNow = (): void => {
      if (state.phase !== "open") return;
      state.phase = "closing";
      leases.releaseAll();
      try {
        const row = toSqlRow(write.query<unknown, []>("PRAGMA wal_checkpoint(TRUNCATE)").get());
        const busy = columnInt(row, "busy");
        if (busy !== 0) {
          warnings.push({
            kind: "checkpoint_incomplete",
            busy,
            log: columnInt(row, "log"),
            checkpointed: columnInt(row, "checkpointed"),
          });
        }
      } catch (caught) {
        if (asSqliteFailure(caught) === undefined) throw caught;
        warnings.push({ kind: "checkpoint_incomplete", busy: 1, log: 0, checkpointed: 0 });
      }
      read.close();
      write.close();
      state.phase = "closed";
    };
    const close = (): Promise<void> => Promise.resolve().then(closeNow);

    const store: OpenedStore = {
      service,
      root: createStoreDb(conn),
      blobPins: blobs.pins,
      warnings,
      faults: options.faults ?? NO_FAULTS,
      close,
      [Symbol.asyncDispose]: close,
    };
    return ok(store);
  } catch (caught) {
    closeAll();
    const mapped = openErrorOf(caught);
    if (mapped === undefined) throw caught;
    return err(mapped);
  }
}

/** 저장소를 연다. 예상 가능한 실패는 StoreOpenError로 돌려주고 버그는 던진다 */
export function openStore(options: OpenStoreOptions): Promise<Result<OpenedStore, StoreOpenError>> {
  return Promise.resolve(options).then(openStoreSync);
}
