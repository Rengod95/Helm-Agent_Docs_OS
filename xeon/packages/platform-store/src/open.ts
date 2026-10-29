import { existsSync, closeSync, openSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { assertNever, err, ok, type Result } from "@xeon/contracts";
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
import { createNoneLockProvider } from "./lock/none.ts";
import { createMigrationRunner } from "./migrations.ts";
import { syncCoreOwners } from "./owner-table.ts";
import { APPLICATION_ID, applyReadPragmas, applyWritePragmas, readIdentity } from "./pragmas.ts";
import { isStrictBuild, SYS_OWNER } from "./prefix.ts";
import { createLockProvider, selectPlatformPolicy } from "./select.ts";
import { MIGRATION_SNAPSHOT_KEEP } from "./snapshot.ts";
import { assembleStoreService, createPinOwnerCheck, createScopedFactory } from "./service.ts";
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
  const classified = classifySqliteCode(failure.code);
  switch (classified) {
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
      return assertNever(classified, "SqliteCodeClass");
  }
}

function newStoreId(options: OpenStoreOptions): string {
  // IdPrefix에 sto가 없다(F.wire-settings.spec §10 미결 7). 주입된 IdFactory의 ULID 부분을 빌려 sto_<ULID>를 만든다
  return `sto_${options.ids.next("evt").slice(4)}`;
}

interface SysSnapshot {
  readonly storeId: string;
  /** sys owner의 DB 최대 버전 */
  readonly dbVersion: number;
}

/**
 * 읽기 전용 열기가 읽는 sys 상태를 한 스냅숏에서 읽는다. 읽기 전용은 표를 만들지 않으므로 sys 표나 store_id가 없으면
 * 스키마 손상(corrupt)이다. 읽기 연결의 BEGIN DEFERRED 안에서 읽어 두 값이 같은 순간을 보게 한다
 */
function readSysSnapshot(db: SqliteConnection): Result<SysSnapshot, StoreOpenError> {
  const found = db
    .transaction(
      (): {
        readonly complete: boolean;
        readonly storeId: string | undefined;
        readonly dbVersion: number;
      } => {
        const tables = toSqlRow(
          db
            .query<unknown, []>(
              "SELECT count(*) AS n FROM sqlite_schema WHERE type = 'table' AND name IN ('sys_migrations', 'sys_meta')",
            )
            .get(),
        );
        if (columnInt(tables, "n") < 2)
          return { complete: false, storeId: undefined, dbVersion: 0 };
        const version = toSqlRow(
          db
            .query<unknown, []>(
              "SELECT coalesce(max(version), 0) AS v FROM sys_migrations WHERE owner = 'sys'",
            )
            .get(),
        );
        const meta = db
          .query<unknown, []>("SELECT value FROM sys_meta WHERE key = 'store_id'")
          .get();
        return {
          complete: true,
          storeId: meta === null ? undefined : columnString(toSqlRow(meta), "value"),
          dbVersion: columnInt(version, "v"),
        };
      },
    )
    .deferred();
  if (!found.complete) return err({ kind: "corrupt", code: "SYS_SCHEMA_MISSING" });
  if (found.storeId === undefined) return err({ kind: "corrupt", code: "STORE_ID_MISSING" });
  return ok({ storeId: found.storeId, dbVersion: found.dbVersion });
}

/** 열기 절차(L0.store.spec §4.4). 쓰기 연결 PRAGMA 뒤 바로 읽기 연결을 연다(WAL이 이미 만들어져 있다) */
function openStoreSync(options: OpenStoreOptions): OpenResult {
  const warnings: StoreWarning[] = [];
  const readOnly = options.readOnly === true;
  const policy = selectPlatformPolicy(options.env.platform);

  if (!isAbsolute(options.dbPath)) return err({ kind: "db_path_invalid", reason: "not_absolute" });
  if (existsSync(options.dbPath) && statSync(options.dbPath).isDirectory()) {
    return err({ kind: "db_path_invalid", reason: "is_directory" });
  }

  // 1. SQLite 로드와 FTS5 프로브
  const sqliteLoad = initSqlite(
    policy.customSqlite
      ? (options.settings.customSqlitePath ?? options.env.bundledSqlitePath)
      : null,
    options.loadCustomSqlite,
  );
  if (!sqliteLoad.ok) return err(sqliteLoad.error);
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
  // 읽기 전용은 파일을 만들지 않는다. 없는 파일은 SQLite가 읽기 전용으로 열 때와 같은 오류다
  if (readOnly && !existsSync(options.dbPath)) {
    return err({ kind: "io", code: "SQLITE_CANTOPEN" });
  }
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
    // 3. 쓰기 연결 열기, application_id 대조, PRAGMA 적용과 검증. 읽기 전용은 readonly로 열고 질의 전용 설정만 건다
    const write = newDatabase(options.dbPath, readOnly ? { readonly: true } : { create: true });
    opened.push(write);
    // 다른 프로세스가 같은 순간 초기화하고 있을 수 있으므로 첫 읽기 전에 대기 시간부터 건다
    write.run(`PRAGMA busy_timeout = ${options.settings.busyTimeoutMs}`);
    const { applicationId, hasSchema } = readIdentity(write);
    // 읽기 전용은 빈 파일을 초기화할 수 없으므로 표지가 Xeon이 아니면 모두 다른 파일이다
    const foreign = readOnly
      ? applicationId !== APPLICATION_ID
      : (applicationId !== 0 && applicationId !== APPLICATION_ID) ||
        (applicationId === 0 && hasSchema);
    if (foreign) {
      closeAll();
      return err({ kind: "foreign_database", applicationId });
    }
    const sealed = readOnly
      ? applyReadPragmas(write, options.settings.busyTimeoutMs)
      : applyWritePragmas(write, {
          busyTimeoutMs: options.settings.busyTimeoutMs,
          stampApplicationId: applicationId === 0,
          fullFsync: policy.fullFsync && options.settings.macFullFsync,
          checkpointFullFsync: policy.fullFsync && !options.settings.macFullFsync,
        });
    if (!sealed.ok) {
      closeAll();
      return err(sealed.error);
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

    const state = createStoreState(readOnly);
    const conn: StoreConnections = { write, read, state };
    const faults = options.storeFaults ?? NO_STORE_FAULTS;
    const strict = options.strictPrefix ?? isStrictBuild(process.env);

    const migrations = createMigrationRunner({
      conn,
      clock: options.clock,
      engineVersion: options.engineVersion,
      strict,
      faults,
      snapshots: {
        dir: join(realDir, "backups"),
        dbFileName: basename(options.dbPath),
        keep: MIGRATION_SNAPSHOT_KEEP,
        posix: policy.posixPermissions,
      },
      warnings,
      ...(options.takeSnapshot === undefined ? {} : { takeSnapshot: options.takeSnapshot }),
    });
    let storeId: string;
    if (readOnly) {
      // 읽기 전용: 마이그레이션도 표지 기록도 하지 않는다. 버전만 읽어 코드보다 높으면 경고를 남기고 연다(L0.store.spec §5)
      const sys = readSysSnapshot(read);
      if (!sys.ok) {
        closeAll();
        return err(sys.error);
      }
      storeId = sys.value.storeId;
      if (sys.value.dbVersion > SYS_MIGRATION_SET.version) {
        warnings.push({
          kind: "read_only",
          reason: "future_version",
          owner: SYS_OWNER,
          dbVersion: sys.value.dbVersion,
          codeVersion: SYS_MIGRATION_SET.version,
        });
      }
    } else {
      // 4. owner sys 마이그레이션
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
      storeId = stamped.value;
    }

    // 8. LockProvider 선택. 읽기 전용은 임대를 쓰지 않으므로 잠금 디렉터리를 만들지 않고 잠금 제공자도 고르지 않는다
    const locksDir = join(realDir, "locks");
    if (!readOnly) {
      const locksReady = ensurePrivateDir(locksDir, policy.posixPermissions, warnings);
      if (!locksReady.ok) {
        closeAll();
        return locksReady;
      }
    }
    const locks = readOnly ? createNoneLockProvider() : createLockProvider(policy.lock, locksDir);
    if (!readOnly && locks.kind === "none") warnings.push({ kind: "lock_provider_none" });

    // 9. 블롭 디렉터리
    const blobsDir = join(realDir, "blobs");
    const blobDirs = readOnly ? [] : [blobsDir, join(blobsDir, "tmp")];
    for (const path of blobDirs) {
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
      graceMs: options.settings.blobGraceMs,
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
      assertPinOwner: createPinOwnerCheck(conn),
    });

    const closeNow = (): void => {
      if (state.phase !== "open") return;
      state.phase = "closing";
      leases.releaseAll();
      // 읽기 전용은 체크포인트도 파일을 쓴다(WAL을 DB에 옮긴다). 하지 않는다
      if (!readOnly) {
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
      gcBlobs: (gcOptions) => blobs.gc(gcOptions),
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
