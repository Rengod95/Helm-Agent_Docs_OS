import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { err, ok, type Clock, type Result } from "@xeon/contracts";
import { sqliteIoFailureOf } from "./db.ts";
import { APPLICATION_ID, readIdentity } from "./pragmas.ts";
import { columnString, toSqlRow } from "./rows.ts";
import { asSqliteFailure, newDatabase, type SqliteConnection } from "./sqlite-env.ts";

// L0.store.spec §4.10. 다른 프로세스가 쓰는 DB도, 미래 버전 DB도 내보낸다. 그래서 읽기 전용 연결만 쓰고 마이그레이션,
// 임대, WAL 설정을 하지 않는다. 원본 DB 파일에는 아무것도 쓰지 않는다.

/** manifest.json의 format. 디렉터리 구조가 바뀌면 올린다 */
const EXPORT_FORMAT = 1;
const EXPORT_SQLITE_FILE = "xeon.sqlite";
const EXPORT_MANIFEST_FILE = "manifest.json";
const EXPORT_BUSY_TIMEOUT_MS = 5000;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export interface ExportOptions {
  /** 내보낼 DB 파일의 절대 경로. 블롭은 이 파일의 디렉터리 아래 `blobs/`에서 읽는다 */
  readonly dbPath: string;
  /** 대상 디렉터리. 없으면 만든다(부모는 있어야 한다). 있으면 비어 있어야 한다 */
  readonly destDir: string;
  readonly clock: Clock;
}

/** 내보내기 결과. `manifest.json`의 내용과 같다 */
export interface ExportReport {
  readonly destDir: string;
  readonly exportedAt: number;
  /** 복사한 블롭 파일 수 */
  readonly blobCount: number;
  /** sys_blobs에 행이 있으나 복사하지 못한 sha256. 파일이 없거나 일반 파일이 아니거나 해시 모양이 아니다 */
  readonly missingBlobs: readonly string[];
}

export type ExportError =
  | { readonly kind: "foreign_database"; readonly applicationId: number }
  | { readonly kind: "not_a_database" }
  | { readonly kind: "dest_not_empty" }
  | { readonly kind: "busy" }
  | { readonly kind: "disk_full" }
  | { readonly kind: "io"; readonly code: string };

/** 이 함수가 만든 파일과 디렉터리. 실패하면 이 목록만 지운다(만든 것의 역순) */
interface Created {
  readonly files: string[];
  readonly dirs: string[];
}

function fsCodeOf(caught: unknown): string | undefined {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code = caught.code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/** 예외를 내보내기 오류 값으로 바꾼다. SQLite도 파일 시스템도 아니면 undefined(버그이므로 호출자가 다시 던진다) */
function failureOf(caught: unknown): ExportError | undefined {
  const sqlite = sqliteIoFailureOf(caught);
  if (sqlite !== undefined) return sqlite;
  const code = fsCodeOf(caught);
  if (code === undefined) return undefined;
  return code === "ENOSPC" ? { kind: "disk_full" } : { kind: "io", code };
}

/** DB 파일을 읽을 때는 SQLITE_NOTADB를 "DB가 아님"으로 본다 */
function sourceFailureOf(caught: unknown): ExportError | undefined {
  if (asSqliteFailure(caught)?.code === "SQLITE_NOTADB") return { kind: "not_a_database" };
  return failureOf(caught);
}

/** fn을 실행하고 예상 가능한 실패를 Result 값으로 바꾼다. 분류되지 않는 예외는 버그이므로 다시 던진다 */
function attemptIo<T>(
  fn: () => T,
  classify: (caught: unknown) => ExportError | undefined = failureOf,
): Result<T, ExportError> {
  try {
    return ok(fn());
  } catch (caught) {
    const failure = classify(caught);
    if (failure === undefined) throw caught;
    return err(failure);
  }
}

/** 대상 디렉터리 상태. 없으면 true(absent), 비어 있으면 false, 그 밖은 dest_not_empty다 */
function checkDestination(destDir: string): Result<boolean, ExportError> {
  const state = attemptIo((): "absent" | "empty" | "not_empty" => {
    if (!existsSync(destDir)) return "absent";
    const empty = statSync(destDir).isDirectory() && readdirSync(destDir).length === 0;
    return empty ? "empty" : "not_empty";
  });
  if (!state.ok) return state;
  if (state.value === "not_empty") return err({ kind: "dest_not_empty" });
  return ok(state.value === "absent");
}

/** 읽기 전용 연결을 연다. 잠금 대기 시간만 건다. query_only는 걸지 않는다(VACUUM INTO가 그 설정에서 거절된다) */
function openReadOnly(path: string): Result<SqliteConnection, ExportError> {
  return attemptIo((): SqliteConnection => {
    const db = newDatabase(path, { readonly: true });
    try {
      db.run(`PRAGMA busy_timeout = ${EXPORT_BUSY_TIMEOUT_MS}`);
    } catch (caught) {
      db.close();
      throw caught;
    }
    return db;
  }, sourceFailureOf);
}

/** 원본 DB를 읽기 전용으로 연다. 파일이 없으면 not_a_database다 */
function openSource(dbPath: string): Result<SqliteConnection, ExportError> {
  if (!existsSync(dbPath)) return err({ kind: "not_a_database" });
  return openReadOnly(dbPath);
}

/** 원본의 표지를 본다. Xeon 표지가 아니면 다른 앱의 DB(foreign_database)다. 표지 0과 스키마 없음은 빈 파일이다 */
function checkIdentity(db: SqliteConnection): Result<void, ExportError> {
  const identity = attemptIo(() => readIdentity(db), sourceFailureOf);
  if (!identity.ok) return identity;
  const { applicationId, hasSchema } = identity.value;
  if (applicationId === APPLICATION_ID) return ok(undefined);
  if (applicationId === 0 && !hasSchema) return err({ kind: "not_a_database" });
  return err({ kind: "foreign_database", applicationId });
}

/** 새 파일을 0600으로 만든다(data가 있으면 그 내용을 쓴다). 이미 있으면 io(EEXIST)다. 만든 파일만 정리 목록에 넣는다 */
function createFile(path: string, created: Created, data?: string): Result<void, ExportError> {
  return attemptIo(() => {
    const fd = openSync(path, "wx", 0o600);
    created.files.push(path);
    try {
      if (data !== undefined) writeFileSync(fd, data);
    } finally {
      closeSync(fd);
    }
  });
}

/** 디렉터리를 0700으로 만든다. 이미 있으면 그대로 둔다 */
function makeDirIfMissing(path: string, created: Created): Result<void, ExportError> {
  if (existsSync(path)) return ok(undefined);
  return attemptIo(() => {
    mkdirSync(path, { mode: 0o700 });
    created.dirs.push(path);
  });
}

/** 복사본의 sys_blobs에서 sha256 목록을 읽는다. 원본이 아니라 복사본을 읽어 내보낸 행과 목록이 같은 내용을 보게 한다 */
function listBlobs(sqlitePath: string): Result<readonly string[], ExportError> {
  const copy = openReadOnly(sqlitePath);
  if (!copy.ok) return copy;
  const db = copy.value;
  try {
    return attemptIo(
      () =>
        db
          .query<unknown, []>("SELECT sha256 FROM sys_blobs ORDER BY sha256")
          .all()
          .map((row) => columnString(toSqlRow(row), "sha256")),
      sourceFailureOf,
    );
  } finally {
    db.close();
  }
}

/**
 * 블롭 하나를 `<destDir>/blobs/<ab>/<rest>`로 복사한다. 원본이 일반 파일이 아니면(없음, 심볼릭 링크 포함) 복사하지 않고 false다.
 * 원본 경로는 lstat으로 본다. 심볼릭 링크를 따라가지 않는다
 */
function copyBlob(
  dbDir: string,
  destDir: string,
  sha256: string,
  created: Created,
): Result<boolean, ExportError> {
  const shard = sha256.slice(0, 2);
  const from = join(dbDir, "blobs", shard, sha256.slice(2));
  const regular = attemptIo(() => existsSync(from) && lstatSync(from).isFile());
  if (!regular.ok) return regular;
  if (!regular.value) return ok(false);
  const blobsDir = join(destDir, "blobs");
  const made = makeDirIfMissing(blobsDir, created);
  if (!made.ok) return made;
  const shardDir = join(blobsDir, shard);
  const shardMade = makeDirIfMissing(shardDir, created);
  if (!shardMade.ok) return shardMade;
  const to = join(shardDir, sha256.slice(2));
  const reserved = createFile(to, created);
  if (!reserved.ok) return reserved;
  const copied = attemptIo(() => {
    copyFileSync(from, to);
    chmodSync(to, 0o600);
  });
  if (!copied.ok) return copied;
  return ok(true);
}

/** 원본을 복사해 내보낸다. 실패하면 이 호출이 만든 것만 지운다 */
function writeExport(
  options: ExportOptions,
  db: SqliteConnection,
  createDest: boolean,
): Result<ExportReport, ExportError> {
  const created: Created = { files: [], dirs: [] };
  const fail = (error: ExportError): Result<never, ExportError> => err(cleanup(created, error));

  if (createDest) {
    const made = attemptIo(() => {
      mkdirSync(options.destDir, { mode: 0o700 });
      created.dirs.push(options.destDir);
    });
    if (!made.ok) return made;
  }

  const sqlitePath = join(options.destDir, EXPORT_SQLITE_FILE);
  const sqlite = createFile(sqlitePath, created);
  if (!sqlite.ok) return fail(sqlite.error);
  // VACUUM INTO는 WAL 안의 내용까지 담은 일관된 복사본을 만든다. 쓰기 트랜잭션 밖에서 돈다
  const vacuumed = attemptIo(() => {
    db.run("VACUUM INTO ?", [sqlitePath]);
  }, sourceFailureOf);
  if (!vacuumed.ok) return fail(vacuumed.error);

  const hashes = listBlobs(sqlitePath);
  if (!hashes.ok) return fail(hashes.error);
  const missingBlobs: string[] = [];
  let blobCount = 0;
  for (const sha256 of hashes.value) {
    // 해시 모양을 먼저 본다. 모양이 틀리면 경로를 만들지 않고 누락으로 적는다
    if (!SHA256_HEX.test(sha256)) {
      missingBlobs.push(sha256);
      continue;
    }
    const copied = copyBlob(dirname(options.dbPath), options.destDir, sha256, created);
    if (!copied.ok) return fail(copied.error);
    if (copied.value) blobCount += 1;
    else missingBlobs.push(sha256);
  }

  const exportedAt = options.clock.now();
  const manifest = {
    format: EXPORT_FORMAT,
    exportedAt,
    sqliteFile: EXPORT_SQLITE_FILE,
    blobCount,
    missingBlobs,
  };
  const manifestPath = join(options.destDir, EXPORT_MANIFEST_FILE);
  const written = createFile(manifestPath, created, `${JSON.stringify(manifest, null, 2)}\n`);
  if (!written.ok) return fail(written.error);
  return ok({ destDir: options.destDir, exportedAt, blobCount, missingBlobs });
}

/** 실패한 내보내기가 만든 것만 지운다. 정리가 실패하면 원래 오류 대신 정리 오류를 돌려준다(ExportError에 원인 필드가 없다) */
function cleanup(created: Created, original: ExportError): ExportError {
  const removed = attemptIo(() => {
    for (const file of created.files.toReversed()) rmSync(file, { force: true });
    for (const dir of created.dirs.toReversed()) rmdirSync(dir);
  });
  return removed.ok ? original : removed.error;
}

/**
 * DB를 `destDir`로 내보낸다(L0.store.spec §4.10). 동기 함수다. 원본 DB는 읽기 전용으로만 연다.
 * 결과 디렉터리: `xeon.sqlite`(VACUUM INTO 복사본), `blobs/<ab>/<rest>`(sys_blobs의 파일), `manifest.json`.
 */
export function exportDatabase(options: ExportOptions): Result<ExportReport, ExportError> {
  const createDest = checkDestination(options.destDir);
  if (!createDest.ok) return createDest;
  const source = openSource(options.dbPath);
  if (!source.ok) return source;
  const db = source.value;
  try {
    const identity = checkIdentity(db);
    if (!identity.ok) return identity;
    return writeExport(options, db, createDest.value);
  } finally {
    db.close();
  }
}
