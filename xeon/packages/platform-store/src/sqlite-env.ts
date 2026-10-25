import { Database, SQLiteError } from "bun:sqlite";
import { attempt, Bug, err, ok, type Result } from "@xeon/contracts";

/**
 * SQLite 로드 상태(L0.store.spec §4.1 2번). Database.setCustomSQLite는 프로세스에서 첫 Database를 만들기 전에
 * 한 번만 부를 수 있으므로 이 모듈 상태가 "이미 로드됨"을 기억한다. 프로세스 전역일 수밖에 없는 SQLite 로더의 상태다.
 */
let loaded: { readonly path: string | null } | undefined;

/**
 * 첫 Database 전에 SQLite 경로를 정한다. path가 null이면 번들 SQLite를 쓴다(setCustomSQLite를 부르지 않는다).
 * 지정한 dylib을 못 불러오면 err(sqlite_load_failed)다(번들로 조용히 되돌리지 않는다. 사용자가 정한 경로이므로 알려야 한다). 같은 경로로 다시 부르면 아무 일도 없다. 다른 경로로 부르면 Bug(store.sqlite_already_loaded)다.
 * Bun 1.4.3은 반환값이 항상 true이므로 성공 판정에 쓰지 않는다(eng.toolchain.guide TC-11).
 */
export function initSqlite(
  path: string | null,
  loadCustom: (path: string) => unknown = (target) => Database.setCustomSQLite(target),
): Result<void, SqliteLoadError> {
  if (loaded !== undefined) {
    if (loaded.path === path) return ok(undefined);
    throw new Bug(
      `store.sqlite_already_loaded: SQLite is already loaded (${loaded.path ?? "bundled"}), cannot switch to ${path ?? "bundled"}`,
    );
  }
  if (path !== null) {
    // macOS의 Bun은 dylib을 바로 dlopen하므로 없는 경로면 여기서 던진다(실측 2026-10-25, Bun 1.4.3). 사용자가 정한 경로의
    // 실패는 예상된 실패다. loaded를 남기지 않아 올바른 경로로 다시 부를 수 있다
    const loadedOk = attempt(() => loadCustom(path));
    if (!loadedOk.ok) return err({ kind: "sqlite_load_failed", path });
  }
  loaded = { path };
  return ok(undefined);
}

export type SqliteLoadError = { readonly kind: "sqlite_load_failed"; readonly path: string };

/** 이 프로세스에서 지정한 커스텀 SQLite 경로. 번들이면 null */
export function loadedSqlitePath(): string | null {
  return loaded?.path ?? null;
}

/** 연결 타입. bun:sqlite import를 이 패키지의 정해진 파일에만 두려고 여기서 이름을 내보낸다(L0.store.plan §2) */
export type SqliteConnection = Database;

export interface SqliteFailure {
  /** 예: "SQLITE_BUSY". 확장 코드가 없으면 undefined */
  readonly code: string | undefined;
}

/** SQLiteError이면 그 코드를 돌려주고 아니면 undefined. 오류 판정은 메시지가 아니라 code로 한다(TS-07) */
export function asSqliteFailure(caught: unknown): SqliteFailure | undefined {
  return caught instanceof SQLiteError ? { code: caught.code } : undefined;
}

export interface NewDatabaseOptions {
  readonly create?: boolean;
  readonly readonly?: boolean;
}

/** 이 패키지에서 Database를 만드는 유일한 길(L0.store.plan §2). strict 모드로 연다 */
export function newDatabase(filename: string, options: NewDatabaseOptions = {}): Database {
  if (loaded === undefined) {
    const init = initSqlite(null);
    if (!init.ok) throw new Bug(`store.sqlite_init: ${init.error.kind}`);
  }
  return new Database(filename, { ...options, strict: true });
}

/** probeFts5가 쓰는 좁은 인터페이스. 테스트는 FTS5 없는 SQLite를 이 인터페이스로 흉내 낸다 */
export interface ProbeDriver {
  run(sql: string): void;
  query(sql: string): unknown;
}

export type Fts5ProbeError = { readonly kind: "fts5_missing" };

function hasCountOfOne(row: unknown): boolean {
  return typeof row === "object" && row !== null && "n" in row && row.n === 1;
}

/**
 * FTS5 가용성 프로브(필수 판정 단계). 임시 FTS5 가상 테이블을 만들어 한 행을 넣고 MATCH 질의가 한 건을 돌려주는지 본다.
 * count(*)는 일치가 0건이어도 한 행(n = 0)을 돌려주므로 n === 1을 본다(eng.toolchain.guide TC-11).
 */
export function probeFts5(driver: ProbeDriver): Result<void, Fts5ProbeError> {
  const probed = attempt(() => {
    driver.run("CREATE VIRTUAL TABLE temp.fts5_probe USING fts5(x)");
    driver.run("INSERT INTO temp.fts5_probe(x) VALUES ('xeon')");
    return driver.query("SELECT count(*) AS n FROM temp.fts5_probe WHERE fts5_probe MATCH 'xeon'");
  });
  // no such module: fts5 등 어떤 SQLite 오류든 능력 없음으로 본다. 판정은 예외가 아니라 값으로 돌려준다
  if (!probed.ok) return err({ kind: "fts5_missing" });
  return hasCountOfOne(probed.value) ? ok(undefined) : err({ kind: "fts5_missing" });
}

export interface SqliteProbe {
  /** probeFts5 결과. 판정 기준 */
  readonly fts5: boolean;
  readonly sqliteVersion: string;
  /** PRAGMA compile_options에 ENABLE_FTS5가 있는지. 진단용이고 판정에 쓰지 않는다 */
  readonly compileOptionFts5: boolean;
}

/** 임시 :memory: 연결로 SQLite 능력을 조사한다 */
export function probeSqlite(): SqliteProbe {
  const db = newDatabase(":memory:");
  try {
    const driver: ProbeDriver = {
      run: (sql): void => {
        db.run(sql);
      },
      query: (sql): unknown => db.query<unknown, []>(sql).get(),
    };
    const fts5 = probeFts5(driver).ok;
    const versionRow = db.query<unknown, []>("SELECT sqlite_version() AS v").get();
    const sqliteVersion =
      typeof versionRow === "object" &&
      versionRow !== null &&
      "v" in versionRow &&
      typeof versionRow.v === "string"
        ? versionRow.v
        : "unknown";
    const options = db.query<unknown, []>("PRAGMA compile_options").all();
    const compileOptionFts5 = options.some(
      (row) =>
        typeof row === "object" &&
        row !== null &&
        "compile_options" in row &&
        typeof row.compile_options === "string" &&
        row.compile_options.includes("ENABLE_FTS5"),
    );
    return { fts5, sqliteVersion, compileOptionFts5 };
  } finally {
    db.close();
  }
}
