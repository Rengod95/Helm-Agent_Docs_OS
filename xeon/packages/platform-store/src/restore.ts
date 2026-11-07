import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { err, ok, parseJson, type Clock, type Result } from "@fresnel/contracts";
import { sqliteIoFailureOf } from "./db.ts";
import { sha256Hex } from "./hash.ts";
import { APPLICATION_ID, readIdentity } from "./pragmas.ts";
import { columnInt, columnString, toSqlRow } from "./rows.ts";
import { asSqliteFailure, newDatabase, type SqliteConnection } from "./sqlite-env.ts";
import { SYS_MIGRATION_SET } from "./sys-schema.ts";

// L0.store.spec §4.10.1. `exportDatabase`가 만든 사본을 데이터 디렉터리로 되돌린다. 엔진이 떠 있으면 거절하고, 사본을 먼저
// 검증하고, 현재 DB는 복원이 끝난 뒤에도 `restore-previous/`에 남긴다. 설정 파일과 age 키는 사본에 없고 이 함수도 건드리지 않는다.

/** `exportDatabase`가 쓰는 manifest.json의 format. 같은 값만 받는다 */
const SUPPORTED_EXPORT_FORMAT = 1;
const SQLITE_FILE = "fresnel.sqlite";
const MANIFEST_FILE = "manifest.json";
const STAGING_SUFFIX = ".restore-staging";
const JOURNAL_SUFFIX = ".restore-journal";
const PREVIOUS_DIR = "restore-previous";
/** 되돌리기 전 DB를 이만큼 남긴다(마이그레이션 스냅샷과 같은 수) */
const PREVIOUS_KEEP = 3;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const SIDE_SUFFIXES = ["", "-wal", "-shm"] as const;

export interface RestoreOptions {
  /** 복원할 데이터베이스 파일의 절대 경로. 블롭은 이 파일의 디렉터리 아래 `blobs/`에 둔다 */
  readonly dbPath: string;
  /** `exportDatabase`가 만든 폴더 */
  readonly backupDir: string;
  readonly clock: Clock;
  /** true면 사본만 검증하고 현재 DB·블롭을 건드리지 않는다. 보고서는 `blobsAdded` 0, `previousDir` null이다 */
  readonly verifyOnly?: boolean;
  /** 테스트가 단계 사이에서 멈추려고 쓴다. 운영은 넘기지 않는다 */
  readonly hit?: (point: RestorePoint) => void;
}

/** 복원이 멈추는 지점. 이 지점마다 되돌릴 수 있거나 이어 끝낼 수 있어야 한다 */
export type RestorePoint =
  | "after_blobs"
  | "after_staged"
  | "after_journal_moving"
  | "after_move_db"
  | "after_move_wal"
  | "after_move_shm"
  | "after_journal_moved"
  | "after_swap";

export interface RestoreReport {
  readonly dbPath: string;
  readonly backupDir: string;
  /** 새로 데이터 디렉터리에 놓은 블롭 수. 이미 있던 같은 블롭은 세지 않는다 */
  readonly blobsAdded: number;
  /** 사본이 담지 못한(manifest의 missingBlobs) sha256 */
  readonly missingBlobs: readonly string[];
  /** 복원 전 DB를 옮겨 둔 폴더. 현재 DB가 없었으면 null */
  readonly previousDir: string | null;
  /** 이전 복원이 중간에 멈춘 흔적을 이번에 정리했으면 그 방향 */
  readonly recovered: "rolled_back" | "rolled_forward" | null;
}

export type RestoreError =
  | { readonly kind: "backup_not_found" }
  | { readonly kind: "backup_invalid"; readonly reason: BackupInvalidReason }
  | { readonly kind: "foreign_database"; readonly applicationId: number }
  | { readonly kind: "not_a_database" }
  | {
      readonly kind: "future_version";
      readonly backupVersion: number;
      readonly codeVersion: number;
    }
  | { readonly kind: "engine_running" }
  | { readonly kind: "disk_full" }
  | { readonly kind: "io"; readonly code: string };

export type BackupInvalidReason =
  | "manifest"
  | "format"
  | "integrity"
  | "schema"
  | "blob_missing"
  | "blob_hash";

interface Manifest {
  readonly missingBlobs: readonly string[];
}

interface Journal {
  readonly phase: "moving" | "moved";
  /** `restore-previous/` 아래 폴더 이름 */
  readonly previous: string;
}

function fsCodeOf(caught: unknown): string | undefined {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code = caught.code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

function failureOf(caught: unknown): RestoreError | undefined {
  if (asSqliteFailure(caught)?.code === "SQLITE_NOTADB") return { kind: "not_a_database" };
  const sqlite = sqliteIoFailureOf(caught);
  if (sqlite !== undefined) {
    // 현재 DB를 다른 연결이 쥐고 있다는 신호(SQLITE_BUSY)는 엔진이 떠 있다는 뜻이다
    return sqlite.kind === "busy" ? { kind: "engine_running" } : sqlite;
  }
  const code = fsCodeOf(caught);
  if (code === undefined) return undefined;
  return code === "ENOSPC" ? { kind: "disk_full" } : { kind: "io", code };
}

/** fn을 실행하고 예상 가능한 실패를 값으로 바꾼다. 분류되지 않는 예외는 버그이므로 다시 던진다 */
function attemptIo<T>(fn: () => T): Result<T, RestoreError> {
  try {
    return ok(fn());
  } catch (caught) {
    const failure = failureOf(caught);
    if (failure === undefined) throw caught;
    return err(failure);
  }
}

function invalid(reason: BackupInvalidReason): Result<never, RestoreError> {
  return err({ kind: "backup_invalid", reason });
}

function readManifest(backupDir: string): Result<Manifest, RestoreError> {
  const path = join(backupDir, MANIFEST_FILE);
  const present = attemptIo(() => existsSync(path) && existsSync(join(backupDir, SQLITE_FILE)));
  if (!present.ok) return present;
  if (!present.value) return err({ kind: "backup_not_found" });
  const text = attemptIo(() => readFileSync(path, "utf8"));
  if (!text.ok) return text;
  const json = parseJson(text.value);
  if (!json.ok) return invalid("manifest");
  const parsed = json.value;
  if (typeof parsed !== "object" || parsed === null) return invalid("manifest");
  const format = "format" in parsed ? parsed.format : undefined;
  if (format !== SUPPORTED_EXPORT_FORMAT) return invalid("format");
  const missing = "missingBlobs" in parsed ? parsed.missingBlobs : undefined;
  if (!Array.isArray(missing)) return invalid("manifest");
  const missingBlobs: string[] = [];
  for (const entry of missing) {
    if (typeof entry !== "string") return invalid("manifest");
    missingBlobs.push(entry);
  }
  return ok({ missingBlobs });
}

function openReadOnly(path: string): Result<SqliteConnection, RestoreError> {
  return attemptIo(() => newDatabase(path, { readonly: true }));
}

/**
 * 사본을 읽기 전용으로 열어 표지, 무결성, 스키마 버전을 본다. 사본 sys 버전이 이 빌드의 코드 버전보다 높으면 거절한다
 * (옛 빌드가 새 빌드의 DB를 열지 못하는 `future_version`과 같은 기준이다). 돌려주는 값은 sys_blobs의 sha256 목록이다.
 */
function verifySqlite(sqlitePath: string): Result<readonly string[], RestoreError> {
  const opened = openReadOnly(sqlitePath);
  if (!opened.ok) return opened;
  const db = opened.value;
  try {
    const identity = attemptIo(() => readIdentity(db));
    if (!identity.ok) return identity;
    const { applicationId, hasSchema } = identity.value;
    if (applicationId !== APPLICATION_ID) {
      if (applicationId === 0 && !hasSchema) return err({ kind: "not_a_database" });
      return err({ kind: "foreign_database", applicationId });
    }
    const checked = attemptIo(() =>
      columnString(
        toSqlRow(db.query<unknown, []>("PRAGMA integrity_check").get()),
        "integrity_check",
      ),
    );
    if (!checked.ok) return checked;
    if (checked.value !== "ok") return invalid("integrity");
    const version = attemptIo(() =>
      columnInt(
        toSqlRow(
          db
            .query<unknown, []>(
              "SELECT coalesce(max(version), 0) AS v FROM sys_migrations WHERE owner = 'sys'",
            )
            .get(),
        ),
        "v",
      ),
    );
    // sys 표가 없으면 사본이 Fresnel 스키마가 아니다. SQL 오류는 io 코드로 오므로 schema로 바꾼다
    if (!version.ok) return version.error.kind === "io" ? invalid("schema") : version;
    if (version.value > SYS_MIGRATION_SET.version) {
      return err({
        kind: "future_version",
        backupVersion: version.value,
        codeVersion: SYS_MIGRATION_SET.version,
      });
    }
    return attemptIo(() =>
      db
        .query<unknown, []>("SELECT sha256 FROM sys_blobs ORDER BY sha256")
        .all()
        .map((row) => columnString(toSqlRow(row), "sha256")),
    );
  } finally {
    db.close();
  }
}

function blobPath(root: string, sha256: string): string {
  return join(root, "blobs", sha256.slice(0, 2), sha256.slice(2));
}

function isRegularFile(path: string): boolean {
  return existsSync(path) && lstatSync(path).isFile();
}

/** 사본의 블롭을 모두 검사한다. 파일이 없으면 manifest가 누락으로 적은 것만 허용하고, 있으면 내용 해시가 이름과 같아야 한다 */
function verifyBlobs(
  backupDir: string,
  hashes: readonly string[],
  manifest: Manifest,
): Result<readonly string[], RestoreError> {
  const present: string[] = [];
  const known = new Set(manifest.missingBlobs);
  for (const sha256 of hashes) {
    if (!SHA256_HEX.test(sha256)) {
      if (known.has(sha256)) continue;
      return invalid("blob_missing");
    }
    const path = blobPath(backupDir, sha256);
    const regular = attemptIo(() => isRegularFile(path));
    if (!regular.ok) return regular;
    if (!regular.value) {
      if (known.has(sha256)) continue;
      return invalid("blob_missing");
    }
    const bytes = attemptIo(() => readFileSync(path));
    if (!bytes.ok) return bytes;
    if (sha256Hex(bytes.value) !== sha256) return invalid("blob_hash");
    present.push(sha256);
  }
  return ok(present);
}

function fsyncPath(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function ensurePrivateDir(path: string): void {
  if (existsSync(path)) return;
  mkdirSync(path, { recursive: true, mode: 0o700 });
}

/** 사본의 블롭을 데이터 디렉터리에 더한다. 같은 이름의 파일이 이미 있고 해시가 맞으면 건너뛴다. 이름이 내용 해시이므로 더하기는 안전하다 */
function addBlobs(
  backupDir: string,
  dataDir: string,
  hashes: readonly string[],
): Result<number, RestoreError> {
  let added = 0;
  for (const sha256 of hashes) {
    const to = blobPath(dataDir, sha256);
    const needed = attemptIo(() => !isRegularFile(to) || sha256Hex(readFileSync(to)) !== sha256);
    if (!needed.ok) return needed;
    if (!needed.value) continue;
    const copied = attemptIo(() => {
      ensurePrivateDir(join(dataDir, "blobs"));
      ensurePrivateDir(dirname(to));
      const tmp = `${to}.restore-tmp`;
      copyFileSync(blobPath(backupDir, sha256), tmp);
      chmodSync(tmp, 0o600);
      fsyncPath(tmp);
      renameSync(tmp, to);
    });
    if (!copied.ok) return copied;
    added += 1;
  }
  return ok(added);
}

/**
 * 현재 DB를 다른 연결이 쥐고 있는지 본다. 파일이 없으면 쥔 것이 없다. WAL 모드 DB를 DELETE 모드로 바꾸는 일은 다른 연결이 하나도
 * 없을 때만 되고(SQLite 규칙), 되면 WAL을 DB에 합친다. 다른 연결이 있으면 SQLITE_BUSY라 엔진이 떠 있는 것으로 본다.
 * 이 호출은 복원 직전 한 번뿐이다. 이후 엔진을 띄우지 않는 것은 사용자의 몫이다(문서에 적는다).
 */
function ensureNoEngine(dbPath: string): Result<void, RestoreError> {
  if (!existsSync(dbPath)) return ok(undefined);
  return attemptIo(() => {
    try {
      const db = newDatabase(dbPath, { create: false });
      try {
        db.run("PRAGMA busy_timeout = 0");
        db.run("PRAGMA journal_mode = DELETE");
        // 쓰기 잠금까지 받아 다른 프로세스의 마지막 쓰기도 없음을 확인한다
        db.run("BEGIN EXCLUSIVE");
        db.run("ROLLBACK");
      } finally {
        db.close();
      }
    } catch (caught) {
      // 현재 DB가 손상됐거나 SQLite 파일이 아니면(0바이트는 빈 DB라 해당 없음) 엔진이 쓸 수 없는 파일이다.
      // 이 상태가 복원이 고쳐야 할 대상이므로 막지 않고 옛 파일을 restore-previous로 옮기는 단계로 간다
      if (isUnusableCurrentDatabase(caught)) return;
      throw caught;
    }
  });
}

function isUnusableCurrentDatabase(caught: unknown): boolean {
  const code = asSqliteFailure(caught)?.code;
  return code === "SQLITE_NOTADB" || code === "SQLITE_CORRUPT";
}

function sideFiles(dbPath: string): readonly string[] {
  return SIDE_SUFFIXES.map((suffix) => `${dbPath}${suffix}`);
}

function writeJournal(path: string, journal: Journal): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(journal)}\n`, { mode: 0o600 });
  fsyncPath(tmp);
  renameSync(tmp, path);
}

function readJournal(path: string): Journal | null {
  // 저널은 임시 파일을 쓴 뒤 rename하므로 이 경로에는 완성본만 온다. 읽을 수 없으면 아직 아무것도 옮기지 않았다
  const json = parseJson(readFileSync(path, "utf8"));
  if (!json.ok) return null;
  const parsed = json.value;
  if (typeof parsed !== "object" || parsed === null) return null;
  const phase = "phase" in parsed ? parsed.phase : undefined;
  const previous = "previous" in parsed ? parsed.previous : undefined;
  if ((phase !== "moving" && phase !== "moved") || typeof previous !== "string") return null;
  return { phase, previous };
}

/**
 * 이전 복원이 중간에 멈췄으면 정리한다. 옮기는 중(moving)이면 옮긴 파일을 되돌리고, 다 옮겼으면(moved) 준비한 DB를 놓아 끝낸다.
 * 저널이 없으면 준비만 하다 멈춘 것이라 준비 파일만 지운다. 현재 DB는 어느 쪽에서도 지워지지 않는다.
 */
function recover(dbPath: string): Result<RestoreReport["recovered"], RestoreError> {
  return attemptIo(() => {
    const journalPath = `${dbPath}${JOURNAL_SUFFIX}`;
    const staging = `${dbPath}${STAGING_SUFFIX}`;
    const journal = existsSync(journalPath) ? readJournal(journalPath) : null;
    if (journal === null) {
      rmSync(staging, { force: true });
      rmSync(`${journalPath}.tmp`, { force: true });
      rmSync(journalPath, { force: true });
      return null;
    }
    const previousDir = join(dirname(dbPath), PREVIOUS_DIR, journal.previous);
    if (journal.phase === "moving") {
      for (const target of sideFiles(dbPath)) {
        const moved = join(previousDir, target.slice(dirname(dbPath).length + 1));
        if (existsSync(moved)) {
          rmSync(target, { force: true });
          renameSync(moved, target);
        }
      }
      rmSync(staging, { force: true });
      rmSync(journalPath, { force: true });
      return "rolled_back";
    }
    if (existsSync(staging)) {
      for (const target of sideFiles(dbPath)) rmSync(target, { force: true });
      renameSync(staging, dbPath);
      rmSync(journalPath, { force: true });
      return "rolled_forward";
    }
    rmSync(journalPath, { force: true });
    return null;
  });
}

function stampOf(at: number): string {
  return new Date(at).toISOString().replaceAll(/[-:.]/g, "");
}

function prunePrevious(root: string): void {
  if (!existsSync(root)) return;
  const names = readdirSync(root)
    .filter((name) => statSync(join(root, name)).isDirectory())
    .toSorted();
  for (const name of names.slice(0, Math.max(0, names.length - PREVIOUS_KEEP))) {
    rmSync(join(root, name), { recursive: true, force: true });
  }
}

/**
 * `exportDatabase` 사본을 `dbPath`로 되돌린다(L0.store.spec §4.10.1). 동기 함수다.
 * 순서: 사본 검증 → 엔진 확인 → 이전 복원 정리 → 블롭 더하기 → 준비 파일 만들기와 재검증 → 현재 DB(`-wal`, `-shm` 포함)를
 * `restore-previous/`로 옮기기 → 준비 파일을 `dbPath`로 바꾸기. 어느 단계에서 멈춰도 다시 부르면 정리하고 이어 간다.
 * 사본의 DB는 저널 모드가 delete라 옮긴 뒤에 남는 `-wal`/`-shm`은 없다. 현재 쪽의 `-wal`/`-shm`은 옛 DB와 함께 옮겨 새 DB와 짝이 되지 않게 한다.
 */
export function restoreDatabase(options: RestoreOptions): Result<RestoreReport, RestoreError> {
  const { dbPath, backupDir } = options;
  const hit = options.hit ?? ((): void => {});
  const dataDir = dirname(dbPath);

  const manifest = readManifest(backupDir);
  if (!manifest.ok) return manifest;
  const hashes = verifySqlite(join(backupDir, SQLITE_FILE));
  if (!hashes.ok) return hashes;
  const present = verifyBlobs(backupDir, hashes.value, manifest.value);
  if (!present.ok) return present;
  if (options.verifyOnly === true) {
    return ok({
      dbPath,
      backupDir,
      blobsAdded: 0,
      missingBlobs: manifest.value.missingBlobs,
      previousDir: null,
      recovered: null,
    });
  }

  const quiet = ensureNoEngine(dbPath);
  if (!quiet.ok) return quiet;
  const recovered = recover(dbPath);
  if (!recovered.ok) return recovered;

  const dirReady = attemptIo(() => ensurePrivateDir(dataDir));
  if (!dirReady.ok) return dirReady;
  const added = addBlobs(backupDir, dataDir, present.value);
  if (!added.ok) return added;
  hit("after_blobs");

  const staging = `${dbPath}${STAGING_SUFFIX}`;
  const journalPath = `${dbPath}${JOURNAL_SUFFIX}`;
  const staged = attemptIo(() => {
    rmSync(staging, { force: true });
    copyFileSync(join(backupDir, SQLITE_FILE), staging);
    chmodSync(staging, 0o600);
    fsyncPath(staging);
  });
  if (!staged.ok) return staged;
  // 복사한 파일을 다시 검증한다. 복사 중 손상이 있으면 현재 DB를 건드리기 전에 멈춘다
  const again = verifySqlite(staging);
  if (!again.ok) {
    rmSync(staging, { force: true });
    return again;
  }
  hit("after_staged");

  const hadCurrent = sideFiles(dbPath).some((path) => existsSync(path));
  const previous = stampOf(options.clock.now());
  const previousRoot = join(dataDir, PREVIOUS_DIR);
  const previousDir = join(previousRoot, previous);
  const swapped = attemptIo(() => {
    if (hadCurrent) {
      ensurePrivateDir(previousRoot);
      ensurePrivateDir(previousDir);
      writeJournal(journalPath, { phase: "moving", previous });
      hit("after_journal_moving");
      const points = ["after_move_db", "after_move_wal", "after_move_shm"] as const;
      for (const [index, path] of sideFiles(dbPath).entries()) {
        if (existsSync(path)) renameSync(path, join(previousDir, path.slice(dataDir.length + 1)));
        hit(points[index] ?? "after_move_db");
      }
      writeJournal(journalPath, { phase: "moved", previous });
      hit("after_journal_moved");
    }
    renameSync(staging, dbPath);
    fsyncPath(dataDir);
    hit("after_swap");
    rmSync(journalPath, { force: true });
    prunePrevious(previousRoot);
  });
  if (!swapped.ok) return swapped;
  return ok({
    dbPath,
    backupDir,
    blobsAdded: added.value,
    missingBlobs: manifest.value.missingBlobs,
    previousDir: hadCurrent ? previousDir : null,
    recovered: recovered.value,
  });
}
