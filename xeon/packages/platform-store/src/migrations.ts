import { assertNever, Bug, err, ok, type Clock, type Result } from "@xeon/contracts";
import type {
  MigrationError,
  MigrationReport,
  MigrationRunner,
  MigrationSet,
  MigrationStep,
  SqlTx,
} from "@xeon/contracts/records";
import {
  assertNotInWrite,
  classifySqliteCode,
  createSqlTx,
  createStoreDb,
  type StoreConnections,
} from "./db.ts";
import type { StoreFaultInjector } from "./fault-points.ts";
import { sha256Hex } from "./hash.ts";
import { readOwnerSpec } from "./owner-table.ts";
import { SYS_OWNER, coreOwnerSpecs, createStatementGuard, type OwnerSpec } from "./prefix.ts";
import { columnInt, columnString, toSqlRow } from "./rows.ts";
import { snapshotBeforeMigration, type SnapshotConfig, type SnapshotError } from "./snapshot.ts";
import { asSqliteFailure } from "./sqlite-env.ts";
import type { StoreWarning } from "./types.ts";

export interface MigrationDeps {
  readonly conn: StoreConnections;
  readonly clock: Clock;
  readonly engineVersion: string;
  /** 테스트·디버그 빌드의 EXPLAIN 대조 */
  readonly strict: boolean;
  readonly faults: StoreFaultInjector;
  /** 있으면 기존 스키마를 올리기 전에 DB 스냅샷을 만든다. 없으면 만들지 않는다(시험용) */
  readonly snapshots?: SnapshotConfig;
  /** 테스트 전용. 스냅샷 수단을 바꿔 동료 프로세스와의 끼어들기를 결정적으로 흉내 낸다 */
  readonly takeSnapshot?: typeof snapshotBeforeMigration;
  /** 스냅샷 경고를 모으는 목록. 열기 때 모으는 경고 목록과 같은 것을 넘긴다 */
  readonly warnings?: StoreWarning[];
}

function snapshotFailure(failure: SnapshotError, owner: string, version: number): MigrationError {
  switch (failure.kind) {
    case "busy":
      return { kind: "busy" };
    case "disk_full":
      return { kind: "disk_full" };
    case "io":
      return {
        kind: "migration_failed",
        owner,
        version,
        code: `snapshot_failed:${failure.code}`,
      };
    default:
      return assertNever(failure, "SnapshotError");
  }
}

/** 단계의 체크섬. 공백 정규화를 하지 않는다(L0.store.spec §4.6) */
function stepChecksum(step: MigrationStep): string {
  return sha256Hex(step.sql.join("\n;\n"));
}

function sysOwnerSpec(): OwnerSpec {
  const spec = coreOwnerSpecs().find((candidate) => candidate.owner === SYS_OWNER);
  if (spec === undefined) throw new Bug("store.owner_table_invalid: sys owner is missing");
  return spec;
}

function validateSet(set: MigrationSet): void {
  const last = set.steps[set.steps.length - 1];
  const sequential = set.steps.every((step, index) => step.version === index + 1);
  if (last === undefined || !sequential || last.version !== set.version) {
    throw new Bug(`store.migration_set_invalid: ${set.owner} steps must run 1..${set.version}`);
  }
}

function tableExists(conn: StoreConnections, name: string): boolean {
  return (
    conn.write
      .query<unknown, [string]>(
        "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = ?",
      )
      .get(name) !== null
  );
}

function appliedChecksums(conn: StoreConnections, owner: string): ReadonlyMap<number, string> {
  const applied = new Map<number, string>();
  if (!tableExists(conn, "sys_migrations")) return applied;
  const rows = conn.write
    .query<unknown, [string]>(
      "SELECT version, checksum FROM sys_migrations WHERE owner = ? ORDER BY version",
    )
    .all(owner);
  for (const raw of rows) {
    const cells = toSqlRow(raw);
    applied.set(columnInt(cells, "version"), columnString(cells, "checksum"));
  }
  return applied;
}

export function createMigrationRunner(deps: MigrationDeps): MigrationRunner {
  const { conn } = deps;

  const resolveSpec = (owner: string): OwnerSpec => {
    if (owner === SYS_OWNER) return sysOwnerSpec();
    const spec = readOwnerSpec(conn.write, owner);
    if (spec === undefined) {
      throw new Bug(`store.prefix_not_owned: ${owner} is not registered in sys_prefixes`);
    }
    return spec;
  };

  const runStep = (
    set: MigrationSet,
    step: MigrationStep,
    spec: OwnerSpec,
  ): Result<void, MigrationError> => {
    const guard = createStatementGuard({ spec, strict: deps.strict, allowDdl: true });
    const db = createStoreDb(conn, { internal: true });
    try {
      const written = db.write((tx: SqlTx): void => {
        if (tableExists(conn, "sys_migrations")) {
          const prior = tx.get(
            "SELECT checksum FROM sys_migrations WHERE owner = ? AND version = ?",
            [set.owner, step.version],
          );
          // 다른 프로세스가 같은 단계를 먼저 적용했다. 같은 체크섬이면 건너뛴다
          if (prior !== undefined) return;
        }
        const guarded = createSqlTx(conn.write, guard);
        for (const sql of step.sql) guarded.run(sql);
        tx.run(
          "INSERT INTO sys_migrations (owner, version, checksum, applied_at, engine_version) VALUES (?, ?, ?, ?, ?)",
          [set.owner, step.version, stepChecksum(step), deps.clock.now(), deps.engineVersion],
        );
      });
      if (!written.ok) {
        if (written.error.kind === "io") {
          return err({
            kind: "migration_failed",
            owner: set.owner,
            version: step.version,
            code: written.error.code,
          });
        }
        return err(written.error);
      }
      return ok(undefined);
    } catch (caught) {
      // 단계의 SQL 오류(제약, 문법)는 그 단계만 롤백되고 migration_failed로 알린다
      const failure = asSqliteFailure(caught);
      if (failure !== undefined && classifySqliteCode(failure.code) === "other") {
        return err({
          kind: "migration_failed",
          owner: set.owner,
          version: step.version,
          code: failure.code ?? "SQLITE_ERROR",
        });
      }
      throw caught;
    }
  };

  return {
    apply(set: MigrationSet): Result<MigrationReport, MigrationError> {
      assertNotInWrite(conn.state, "migrations.apply");
      validateSet(set);
      const spec = resolveSpec(set.owner);
      const applied = appliedChecksums(conn, set.owner);
      const versions = [...applied.keys()].toSorted((a, b) => a - b);
      for (const [index, version] of versions.entries()) {
        if (version !== index + 1) {
          return err({
            kind: "migration_gap",
            owner: set.owner,
            expected: index + 1,
            got: version,
          });
        }
      }
      for (const step of set.steps) {
        const stored = applied.get(step.version);
        if (stored !== undefined && stored !== stepChecksum(step)) {
          return err({
            kind: "migration_checksum_mismatch",
            owner: set.owner,
            version: step.version,
          });
        }
      }
      let dbVersion = versions[versions.length - 1] ?? 0;
      if (dbVersion > set.version) {
        return err({
          kind: "migration_future_version",
          owner: set.owner,
          dbVersion,
          codeVersion: set.version,
        });
      }
      // 스냅샷은 이 프로세스가 실제로 기존 스키마에 단계를 적용하려 할 때만 만든다. 결정과 스냅샷 사이에 다른 프로세스가
      // 같은 DB를 올릴 수 있으므로(동시에 처음 여는 프로세스들) 매번 적용 버전을 다시 읽어 결정한다. 스냅샷이 실패했을 때도
      // 다시 읽어, 동료가 그 사이 버전을 올렸으면(동료의 마이그레이션이 VACUUM INTO와 겹쳐 실패할 수 있다) 새 상태로 다시 정한다.
      // 올리지 않았으면 실패 그대로다: 사용자의 기존 DB를 스냅샷 없이 올리지 않는다(spec §4.6.1)
      const takeSnapshot = deps.takeSnapshot ?? snapshotBeforeMigration;
      while (deps.snapshots !== undefined) {
        dbVersion = Math.max(dbVersion, ...appliedChecksums(conn, set.owner).keys());
        if (dbVersion === 0 || dbVersion >= set.version) break;
        const taken = takeSnapshot(conn.write, deps.snapshots, {
          owner: set.owner,
          from: dbVersion,
          to: set.version,
          at: deps.clock.now(),
        });
        if (taken.ok) {
          deps.warnings?.push({
            kind: "migration_snapshot",
            path: taken.value.path,
            owner: set.owner,
            from: dbVersion,
            to: set.version,
          });
          for (const failed of taken.value.pruneFailed) {
            deps.warnings?.push({ kind: "snapshot_prune_failed", ...failed });
          }
          break;
        }
        const after = Math.max(dbVersion, ...appliedChecksums(conn, set.owner).keys());
        if (after > dbVersion) continue;
        return err(snapshotFailure(taken.error, set.owner, dbVersion + 1));
      }
      for (const step of set.steps) {
        if (step.version <= dbVersion) continue;
        const done = runStep(set, step, spec);
        if (!done.ok) return done;
        deps.faults.hit("migration_after_step");
      }
      if (set.owner === SYS_OWNER) conn.write.run(`PRAGMA user_version = ${set.version}`);
      return ok({ owner: set.owner, from: dbVersion, to: set.version });
    },
    runChunked(): Promise<never> {
      // 청크 마이그레이션은 M2 이후다(L0.store.plan ST-19). F 인터페이스를 채우기 위한 자리다
      return Promise.reject(
        new Bug("store.not_implemented: runChunked is scheduled for M2 (ST-19)"),
      );
    },
  };
}
