import { SQLiteError, type Database } from "bun:sqlite";
import { err, ok, type Result } from "@xeon/contracts";
import { classifySqliteCode } from "./db.ts";
import { columnInt, toSqlRow } from "./rows.ts";

/** 'XEON'(0x58454F4E). 새 파일에서만 쓰고 이후 대조한다 */
export const APPLICATION_ID = 1480937294;
const JOURNAL_SIZE_LIMIT = 67_108_864;
const WAL_AUTOCHECKPOINT = 1000;

export type PragmaError = { readonly kind: "io"; readonly code: string };

/** `PRAGMA name` 조회값. 한 행 한 열의 값을 돌려준다 */
function readPragma(db: Database, name: string): unknown {
  const row = db.query<unknown, []>(`PRAGMA ${name}`).get();
  if (typeof row !== "object" || row === null) return undefined;
  return Object.values(row)[0];
}

/**
 * application_id와 스키마 유무를 한 스냅숏에서 읽는다. 다른 프로세스가 같은 순간 새 파일을 초기화해도
 * "표지는 0인데 테이블이 있음"으로 잘못 보지 않는다(표지는 테이블보다 먼저 커밋된다). 열기와 내보내기가 같이 쓴다.
 */
export function readIdentity(db: Database): {
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

function verify(db: Database, name: string, expected: string | number): Result<void, PragmaError> {
  const actual = readPragma(db, name);
  const matches =
    typeof expected === "string"
      ? typeof actual === "string" && actual.toLowerCase() === expected
      : actual === expected;
  return matches ? ok(undefined) : err({ kind: "io", code: `PRAGMA_MISMATCH:${name}` });
}

/** journal_mode 전환 재시도 간격과 횟수(합쳐서 busy_timeout 근처). 전환은 순간적이라 짧게 자주 본다 */
const WAL_RETRY_MS = 20;

/**
 * WAL로 전환한다. 새 파일을 여러 프로세스가 동시에 처음 열면 한쪽이 전환하는 동안 다른 쪽의 전환은
 * busy_timeout을 기다리지 않고 SQLITE_BUSY로 끝날 수 있다(SQLite가 교착 가능성이 있는 잠금 승격에는 대기 처리기를
 * 부르지 않는다). 그 경우 이미 WAL이면 끝이고 아니면 잠시 쉬고 다시 시도한다.
 */
export function enableWal(
  db: Database,
  attempts: number,
  sleep: (ms: number) => void = (ms): void => Bun.sleepSync(ms),
): void {
  for (let attempt = 1; ; attempt += 1) {
    try {
      db.run("PRAGMA journal_mode = WAL");
      return;
    } catch (caught) {
      if (!(caught instanceof SQLiteError) || classifySqliteCode(caught.code) !== "busy")
        throw caught;
      if (attempt >= attempts) throw caught;
      try {
        if (readPragma(db, "journal_mode") === "wal") return;
      } catch (inner) {
        if (!(inner instanceof SQLiteError) || classifySqliteCode(inner.code) !== "busy")
          throw inner;
      }
      sleep(WAL_RETRY_MS);
    }
  }
}

export interface WritePragmaOptions {
  readonly busyTimeoutMs: number;
  /** application_id를 새로 쓴다(새 파일) */
  readonly stampApplicationId: boolean;
  /** macOS: 모든 동기화를 F_FULLFSYNC로 한다 */
  readonly fullFsync: boolean;
  /** macOS에서 fullfsync를 끈 경우 체크포인트만 F_FULLFSYNC */
  readonly checkpointFullFsync: boolean;
}

/**
 * 쓰기 연결 PRAGMA를 적용하고 조회로 검증한다(L0.store.spec §4.3). busy_timeout을 먼저 건다:
 * journal_mode 전환이 다른 프로세스와 겹쳐도 즉시 SQLITE_BUSY가 나지 않게 하려는 것이다.
 */
export function applyWritePragmas(
  db: Database,
  options: WritePragmaOptions,
): Result<void, PragmaError> {
  const steps: readonly (readonly [string, string | number, string | number])[] = [
    ["busy_timeout", options.busyTimeoutMs, options.busyTimeoutMs],
    ["journal_mode", "WAL", "wal"],
    ["synchronous", "FULL", 2],
    ["foreign_keys", "ON", 1],
    ["temp_store", "MEMORY", 2],
    ["wal_autocheckpoint", WAL_AUTOCHECKPOINT, WAL_AUTOCHECKPOINT],
    ["journal_size_limit", JOURNAL_SIZE_LIMIT, JOURNAL_SIZE_LIMIT],
    ["trusted_schema", "OFF", 0],
  ];
  for (const [name, value, expected] of steps) {
    if (name === "journal_mode") {
      enableWal(db, Math.max(1, Math.ceil(options.busyTimeoutMs / WAL_RETRY_MS)));
    } else {
      db.run(`PRAGMA ${name} = ${value}`);
    }
    const checked = verify(db, name, expected);
    if (!checked.ok) {
      return name === "journal_mode" ? err({ kind: "io", code: "WAL_UNAVAILABLE" }) : checked;
    }
  }
  if (options.stampApplicationId) {
    db.run(`PRAGMA application_id = ${APPLICATION_ID}`);
    const checked = verify(db, "application_id", APPLICATION_ID);
    if (!checked.ok) return checked;
  }
  if (options.fullFsync) {
    db.run("PRAGMA fullfsync = ON");
    const checked = verify(db, "fullfsync", 1);
    if (!checked.ok) return checked;
  } else if (options.checkpointFullFsync) {
    db.run("PRAGMA checkpoint_fullfsync = ON");
    const checked = verify(db, "checkpoint_fullfsync", 1);
    if (!checked.ok) return checked;
  }
  return ok(undefined);
}

/** 읽기 연결 PRAGMA(L0.store.spec §4.3). query_only로 쓰기 문장을 막는다 */
export function applyReadPragmas(db: Database, busyTimeoutMs: number): Result<void, PragmaError> {
  const steps: readonly (readonly [string, string | number, string | number])[] = [
    ["busy_timeout", busyTimeoutMs, busyTimeoutMs],
    ["query_only", "ON", 1],
    ["trusted_schema", "OFF", 0],
    ["temp_store", "MEMORY", 2],
  ];
  for (const [name, value, expected] of steps) {
    db.run(`PRAGMA ${name} = ${value}`);
    const checked = verify(db, name, expected);
    if (!checked.ok) return checked;
  }
  return ok(undefined);
}
