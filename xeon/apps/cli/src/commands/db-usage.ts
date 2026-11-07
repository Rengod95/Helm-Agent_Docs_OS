import type { Stats } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { attemptAsync, err, ok, type Result } from "@fresnel/contracts";

// L4.cli.spec §4.13.2. `db usage`의 저장 공간 집계와 `db previous-rm`의 사본 찾기. 엔진을 띄우지 않고 아무것도 쓰지 않는다.
// 집계는 일반 파일만 센다. 심볼릭 링크는 따라가지도 세지도 않는다. 없는 경로는 0이다.
// 없는 경로 말고 입출력 오류는 값으로 돌려준다(throw하지 않는다).

/**
 * 저장소 파일 이름. 호스트가 같은 이름으로 연다(apps/host/src/assemble.ts의 DB_FILE_NAME).
 * 호스트가 이 이름을 내보내지 않아 여기 한 번 더 적는다 [미결: 호스트 공개 API로 옮기면 이 상수를 지운다]
 */
export const DB_FILE_NAME = "fresnel.db";

/** 복원 전 사본이 모이는 폴더(데이터 디렉터리 아래). restore가 `restore-previous/<UTC 시각>/`로 만든다 */
const RESTORE_DIR = "restore-previous";
/** 첨부 블롭 폴더(데이터 디렉터리 아래) */
const BLOBS_DIR = "blobs";
/** 엔진 로그 폴더(상태 디렉터리 아래). 호스트가 `<state>/logs/<mode>.log`로 쓴다 */
const LOGS_DIR = "logs";
/** 대화 저장소 파일과 그 WAL·SHM */
const CONVERSATION_FILES: readonly string[] = [
  DB_FILE_NAME,
  `${DB_FILE_NAME}-wal`,
  `${DB_FILE_NAME}-shm`,
];
/** 측정 저장소 파일과 그 WAL·SHM */
const MEASURE_FILES: readonly string[] = ["measure.db", "measure.db-wal", "measure.db-shm"];

/** 복원 전 사본 폴더 이름 형식: 날짜 8자리, T, 9자리, Z(예: 20261107T123456789Z). 이 형식만 사본으로 본다 */
const COPY_NAME = /^\d{8}T\d{9}Z$/;

/** 이름이 복원 전 사본 형식인가. 경로를 만들기 전에 반드시 거친다 */
export function isCopyName(name: string): boolean {
  return COPY_NAME.test(name);
}

/** 입출력 오류. 경로와 오류 코드(`ENOENT` 같은 것, 모르면 `unknown`)를 담는다 */
export interface UsageIoError {
  readonly path: string;
  readonly code: string;
}

/** 복원 전 사본 하나의 크기 */
interface PreviousCopyUsage {
  readonly name: string;
  readonly bytes: number;
}

/** `db usage`의 결과(L4.cli.spec §4.13.2). 크기는 모두 바이트다 */
export interface UsageReport {
  readonly dataDir: string;
  readonly conversations: number;
  readonly attachments: number;
  readonly measurements: number;
  readonly logs: number;
  readonly restorePrevious: number;
  /** 최신순(이름 내림차순). 형식에 맞고 실제 폴더인 것만 든다 */
  readonly previous: readonly PreviousCopyUsage[];
}

/** 오류 값에서 `code` 필드만 읽는다. 없으면 `unknown`이다 */
export function codeOf(cause: unknown): string {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof cause.code === "string"
  ) {
    return cause.code;
  }
  return "unknown";
}

/** 사람이 읽는 크기. KB, MB, GB 가운데 하나를 소수 한 자리로 쓴다 */
export function formatSize(bytes: number): string {
  const kib = 1024;
  const mib = kib * kib;
  const gib = mib * kib;
  if (bytes < mib) return `${(bytes / kib).toFixed(1)} KB`;
  if (bytes < gib) return `${(bytes / mib).toFixed(1)} MB`;
  return `${(bytes / gib).toFixed(1)} GB`;
}

/** 경로의 상태를 읽는다(심볼릭 링크는 따라가지 않는다). 없으면 null이다. 없음과 폴더 자리의 파일은 정상이다 */
async function statOf(path: string): Promise<Result<Stats | null, UsageIoError>> {
  const found = await attemptAsync(() => lstat(path));
  if (found.ok) return ok(found.value);
  const code = codeOf(found.error.cause);
  if (code === "ENOENT" || code === "ENOTDIR") return ok(null);
  return err({ path, code });
}

/** 폴더의 항목 이름들 */
async function namesOf(path: string): Promise<Result<string[], UsageIoError>> {
  const listed = await attemptAsync(() => readdir(path));
  if (listed.ok) return ok(listed.value);
  return err({ path, code: codeOf(listed.error.cause) });
}

/** 일반 파일 하나의 크기. 파일이 아니면(폴더, 링크 등) 0이다 */
async function fileBytes(path: string): Promise<Result<number, UsageIoError>> {
  const found = await statOf(path);
  if (!found.ok) return found;
  if (found.value === null || !found.value.isFile()) return ok(0);
  return ok(found.value.size);
}

/** 결과 목록의 합. 첫 실패를 그대로 돌려준다 */
function sumOf(results: readonly Result<number, UsageIoError>[]): Result<number, UsageIoError> {
  let total = 0;
  for (const result of results) {
    if (!result.ok) return result;
    total += result.value;
  }
  return ok(total);
}

/** 이름 목록의 일반 파일 크기 합(데이터 디렉터리 바로 아래) */
async function filesTotal(
  dir: string,
  names: readonly string[],
): Promise<Result<number, UsageIoError>> {
  return sumOf(await Promise.all(names.map((name) => fileBytes(join(dir, name)))));
}

/**
 * 폴더 아래 모든 일반 파일의 합. 경로가 없으면 0이다. 심볼릭 링크는 따라가지도 세지도 않는다.
 * 파일 하나면 그 크기다.
 */
export async function treeBytes(path: string): Promise<Result<number, UsageIoError>> {
  const found = await statOf(path);
  if (!found.ok) return found;
  const stat = found.value;
  if (stat === null) return ok(0);
  if (stat.isFile()) return ok(stat.size);
  if (!stat.isDirectory()) return ok(0);
  const listed = await namesOf(path);
  if (!listed.ok) return listed;
  return sumOf(await Promise.all(listed.value.map((name) => treeBytes(join(path, name)))));
}

/** 사본 하나의 크기. 실제 폴더가 아니면(파일, 링크) null이다 */
async function copyUsage(
  root: string,
  name: string,
): Promise<Result<PreviousCopyUsage | null, UsageIoError>> {
  const path = join(root, name);
  const found = await statOf(path);
  if (!found.ok) return found;
  if (found.value === null || !found.value.isDirectory()) return ok(null);
  const bytes = await treeBytes(path);
  if (!bytes.ok) return bytes;
  return ok({ name, bytes: bytes.value });
}

/** 최신순 정렬. 이름 형식이 고정 폭이라 사전순이 시간순이다 */
function newestFirst(a: PreviousCopyUsage, b: PreviousCopyUsage): number {
  if (a.name === b.name) return 0;
  return a.name < b.name ? 1 : -1;
}

/** `restore-previous`의 바로 아래 사본들(형식에 맞는 실제 폴더만) */
async function previousCopies(root: string): Promise<Result<PreviousCopyUsage[], UsageIoError>> {
  const found = await statOf(root);
  if (!found.ok) return found;
  if (found.value === null || !found.value.isDirectory()) return ok([]);
  const listed = await namesOf(root);
  if (!listed.ok) return listed;
  const sized = await Promise.all(
    listed.value.filter(isCopyName).map((name) => copyUsage(root, name)),
  );
  const copies: PreviousCopyUsage[] = [];
  for (const entry of sized) {
    if (!entry.ok) return entry;
    if (entry.value !== null) copies.push(entry.value);
  }
  return ok(copies.toSorted(newestFirst));
}

/**
 * 데이터 디렉터리와 상태 디렉터리의 저장 공간(L4.cli.spec §4.13.2). 상태 디렉터리가 null이면 로그는 0이다.
 * 엔진을 띄우지 않고 아무것도 쓰지 않는다.
 */
export async function collectUsage(
  dataDir: string,
  stateDir: string | null,
): Promise<Result<UsageReport, UsageIoError>> {
  const conversations = await filesTotal(dataDir, CONVERSATION_FILES);
  if (!conversations.ok) return conversations;
  const attachments = await treeBytes(join(dataDir, BLOBS_DIR));
  if (!attachments.ok) return attachments;
  const measurements = await filesTotal(dataDir, MEASURE_FILES);
  if (!measurements.ok) return measurements;
  const logs = stateDir === null ? ok(0) : await treeBytes(join(stateDir, LOGS_DIR));
  if (!logs.ok) return logs;
  const restoreRoot = join(dataDir, RESTORE_DIR);
  const restorePrevious = await treeBytes(restoreRoot);
  if (!restorePrevious.ok) return restorePrevious;
  const previous = await previousCopies(restoreRoot);
  if (!previous.ok) return previous;
  return ok({
    dataDir,
    conversations: conversations.value,
    attachments: attachments.value,
    measurements: measurements.value,
    logs: logs.value,
    restorePrevious: restorePrevious.value,
    previous: previous.value,
  });
}

/**
 * 지울 사본의 경로. 이름이 형식에 맞고, `restore-previous`와 그 아래 항목이 모두 실제 폴더일 때만 경로를 돌려준다.
 * 없으면 null이다(사본 없음). 링크로 밖을 가리키는 사본은 없는 것으로 본다.
 */
export async function findCopy(
  dataDir: string,
  name: string,
): Promise<Result<string | null, UsageIoError>> {
  if (!isCopyName(name)) return ok(null);
  const root = join(dataDir, RESTORE_DIR);
  const rootFound = await statOf(root);
  if (!rootFound.ok) return rootFound;
  if (rootFound.value === null || !rootFound.value.isDirectory()) return ok(null);
  const path = join(root, name);
  const found = await statOf(path);
  if (!found.ok) return found;
  if (found.value === null || !found.value.isDirectory()) return ok(null);
  return ok(path);
}
