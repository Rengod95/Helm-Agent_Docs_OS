import {
  appendFile,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  attemptAsync,
  Bug,
  err,
  ok,
  parse,
  parseJson,
  type Result,
  type SchemaProof,
} from "@fresnel/contracts";
import {
  ExtensionNameSchema,
  PluginCardSchema,
  type PluginCard,
} from "@fresnel/contracts/extensions";
import type { FileLock, FileLockError } from "@fresnel/platform-os";
import { Type, type TUnsafe } from "typebox";
import { isLocalId } from "@fresnel/contracts/conversation";
import {
  DraftInfoSchema,
  ReviewItemSchema,
  type DraftInfo,
  type ReviewItem,
} from "@fresnel/contracts/wire";
import { sequentially } from "../../util.ts";
import { compareUtf8, hashPluginTree, type TreeError } from "./content-hash.ts";

// 검토본 저장소(M5c §4.6.2). 앱이 실행하고 읽는 것은 `reviewed/<name>/<current>/tree/`뿐이다.
// 배치: reviewed/<name>/<hex>/{tree/, meta.json}, reviewed/<name>/current, candidates/<hex>/tree/,
// drafts/<draftId>/{tree/, meta.json}, queue/<itemId>.json, review-log.jsonl.
// 쓰기는 모두 `fileLock`으로 한 줄씩 직렬화한다. 공개 해시는 `sha256:<hex>`이고 경로에는 hex만 쓴다.
// 승인 순서는 promote → setCurrent → appendLog다. 중간에 끊기면 current는 옛 검토본이고, log에 없는 검토본은 recover가 치운다.

/** 해시 계산 결과 가운데 복사 중 원본이 바뀐 것을 재시도하는 횟수(M5c §5) */
const SNAPSHOT_TRIES = 3;

const HASH_PATTERN = /^sha256:([0-9a-f]{64})$/;
const HEX_PATTERN = /^[0-9a-f]{64}$/;

const REVIEW_ORIGINS = ["user", "project", "bundled"] as const;
export type ReviewOrigin = (typeof REVIEW_ORIGINS)[number];

/** 검토본 하나의 메타 정보(`meta.json`). 카드는 승인 시점의 값이다 */
export interface PluginReviewMeta {
  readonly name: string;
  readonly version: string;
  readonly contentHash: string;
  readonly approvedAt: string;
  readonly decisionId: string;
  readonly origin: ReviewOrigin;
  readonly inferredManifest: boolean;
  readonly card: PluginCard;
}

const MetaShape = Type.Object({
  name: Type.String(),
  version: Type.String(),
  contentHash: Type.String(),
  approvedAt: Type.String(),
  decisionId: Type.String(),
  origin: Type.Union(REVIEW_ORIGINS.map((origin) => Type.Literal(origin))),
  inferredManifest: Type.Boolean(),
  card: PluginCardSchema,
});
const MetaSchema: TUnsafe<PluginReviewMeta> = Type.Unsafe<PluginReviewMeta>(
  MetaShape satisfies SchemaProof<PluginReviewMeta, typeof MetaShape>,
);

/** 결정 기록 한 줄(M5c §4.7.8)의 결정 값과 행위자 */
const REVIEW_DECISIONS = [
  "approved",
  "sent_back",
  "discarded",
  "superseded",
  "withdrawn",
  "rollback",
  "bundled",
  "migrated",
] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

const REVIEW_ACTORS = ["user", "migration", "release"] as const;
export type ReviewActor = (typeof REVIEW_ACTORS)[number];

/** 결정 기록 한 줄. 시크릿 값과 파일 내용은 싣지 않는다 */
export interface ReviewLogEntry {
  readonly at: string;
  /** 검토 항목 id. 릴리스와 옮김은 `decisionId`와 같은 값을 넣는다(meta.json의 `decisionId`와 대조한다) */
  readonly itemId: string | null;
  readonly name: string;
  readonly kind: "new" | "update" | "remove" | "bundled" | "migrated" | null;
  readonly candidateHash: string | null;
  readonly baseHash: string | null;
  readonly decision: ReviewDecision;
  readonly profileIds: readonly string[];
  readonly actor: ReviewActor;
  readonly provenance: string | null;
  readonly originThreadId: string | null;
}

const LogEntryShape = Type.Object({
  at: Type.String(),
  itemId: Type.Union([Type.String(), Type.Null()]),
  name: Type.String(),
  kind: Type.Union([
    Type.Literal("new"),
    Type.Literal("update"),
    Type.Literal("remove"),
    Type.Literal("bundled"),
    Type.Literal("migrated"),
    Type.Null(),
  ]),
  candidateHash: Type.Union([Type.String(), Type.Null()]),
  baseHash: Type.Union([Type.String(), Type.Null()]),
  decision: Type.Union(REVIEW_DECISIONS.map((decision) => Type.Literal(decision))),
  profileIds: Type.Array(Type.String()),
  actor: Type.Union(REVIEW_ACTORS.map((actor) => Type.Literal(actor))),
  provenance: Type.Union([Type.String(), Type.Null()]),
  originThreadId: Type.Union([Type.String(), Type.Null()]),
});
const LogEntrySchema: TUnsafe<ReviewLogEntry> = Type.Unsafe<ReviewLogEntry>(
  LogEntryShape satisfies SchemaProof<ReviewLogEntry, typeof LogEntryShape>,
);

/** 검토본 하나: 해시, 메타, 실행할 `tree/` 경로 */
export interface ReviewedVersion {
  readonly contentHash: string;
  readonly meta: PluginReviewMeta;
  readonly treePath: string;
}

/** 보관 중인 검토본 한 줄. `versions`가 준다 */
export interface PluginVersionInfo {
  readonly contentHash: string;
  readonly approvedAt: string;
  readonly current: boolean;
  /** 매니페스트의 `version`(검토본 메타에서 읽는다) */
  readonly version: string;
  /** 검토본의 출처(사용자, 프로젝트, 번들) */
  readonly origin: ReviewOrigin;
}

export type PluginStoreError =
  | { readonly kind: "source_unstable"; readonly path: string }
  | { readonly kind: "tree_rejected"; readonly path: string; readonly error: TreeError }
  | { readonly kind: "not_found"; readonly what: string }
  | {
      readonly kind: "pinned_corrupt";
      readonly name: string;
      readonly contentHash: string;
      /** 지금 다시 계산한 해시. 트리를 계산하지 못했으면 null */
      readonly actual: string | null;
    }
  | { readonly kind: "corrupt"; readonly path: string }
  | { readonly kind: "invalid_name"; readonly name: string }
  | { readonly kind: "invalid_hash"; readonly contentHash: string }
  | { readonly kind: "io"; readonly path: string; readonly cause: unknown }
  | { readonly kind: "lock"; readonly error: FileLockError };

export interface PluginStoreDeps {
  /** 저장소 루트(`OsDirs.data/plugin-store`). 처음 쓸 때 만든다 */
  readonly root: string;
  readonly fileLock: FileLock;
}

export interface PluginStore {
  /** 원본 폴더를 후보 스냅샷으로 복사하고 복사본의 해시를 돌려준다. 원본이 복사 중 바뀌면 다시 복사한다(M5c §5) */
  snapshotCandidate(
    srcDir: string,
  ): Promise<Result<{ readonly contentHash: string }, PluginStoreError>>;
  /** 후보 스냅샷을 `reviewed/<name>/<hex>/`로 옮기고 `meta.json`을 쓴다. 원본은 다시 읽지 않는다. current는 바꾸지 않는다 */
  promote(contentHash: string, meta: PluginReviewMeta): Promise<Result<void, PluginStoreError>>;
  discardCandidate(contentHash: string): Promise<Result<void, PluginStoreError>>;
  setCurrent(name: string, contentHash: string): Promise<Result<void, PluginStoreError>>;
  /** 현재 검토본. 없으면 null */
  current(name: string): Promise<Result<ReviewedVersion | null, PluginStoreError>>;
  /** 검토본 `tree/` 경로. 해시를 주지 않으면 현재 검토본이다 */
  treePath(name: string, contentHash?: string): Promise<Result<string, PluginStoreError>>;
  /** 보관 중인 검토본(최신 승인이 앞). 메타가 없는 폴더(승인 도중 중단)는 세지 않는다 */
  versions(name: string): Promise<Result<readonly PluginVersionInfo[], PluginStoreError>>;
  /** 검토본이 있는 이름들 */
  names(): Promise<Result<readonly string[], PluginStoreError>>;
  /** `tree/`의 해시를 다시 계산해 meta.json과 비교한다. 다르면 `pinned_corrupt` */
  verifyIntegrity(name: string, contentHash: string): Promise<Result<void, PluginStoreError>>;
  /** 최근 `keep`개와 current와 `inUse`를 남기고 나머지를 지운다. 지운 해시를 돌려준다 */
  prune(
    name: string,
    options: { readonly keep: number; readonly inUse: ReadonlySet<string> },
  ): Promise<Result<readonly string[], PluginStoreError>>;
  appendLog(entry: ReviewLogEntry): Promise<Result<void, PluginStoreError>>;
  readLog(): Promise<Result<readonly ReviewLogEntry[], PluginStoreError>>;
  /**
   * 시작 때 정리. 복사 도중 끊긴 임시 폴더를 지우고, log에 없는 검토본(승인 도중 중단)을 지운다.
   * current는 절대 지우지 않는다. 지운 검토본(`<이름>/<hex>`)을 돌려준다
   */
  recover(): Promise<Result<{ readonly removed: readonly string[] }, PluginStoreError>>;
  /** 경로 계산만: 초안 폴더(`drafts/<draftId>`)와 검토 항목 파일(`queue/<itemId>.json`) */
  draftDir(draftId: string): string;
  queueFile(itemId: string): string;
  /** 제거를 승인할 때 현재 검토본을 치운다. 보관 사본은 그대로 둔다. 검토본이 없어도 성공이다 */
  clearCurrent(name: string): Promise<Result<void, PluginStoreError>>;
  /** 후보 스냅샷의 `tree/` 경로(해시 기준). 경로 계산만 한다 */
  candidateTree(contentHash: string): Result<string, PluginStoreError>;
  /** 후보 스냅샷 안 파일의 바이트. 경로는 호출자가 후보의 파일 목록에서 고른다 */
  readCandidateFile(
    contentHash: string,
    path: string,
  ): Promise<Result<Uint8Array, PluginStoreError>>;
  /**
   * 원본 폴더를 초안 스냅샷(`drafts/<draftId>/tree`)으로 복사하고 `meta(contentHash)`를 `meta.json`으로 쓴다.
   * 복사 중 원본이 바뀌면 `source_unstable`이다. 원본은 읽기만 한다
   */
  saveDraft(
    srcDir: string,
    draftId: string,
    meta: (contentHash: string) => DraftInfo,
  ): Promise<Result<DraftInfo, PluginStoreError>>;
  /** 초안 정보 파일을 다시 쓴다(검토 항목을 연결할 때) */
  writeDraft(info: DraftInfo): Promise<Result<void, PluginStoreError>>;
  /** 초안 정보 하나. 없으면 `not_found`, 깨졌으면 `corrupt`다 */
  readDraft(draftId: string): Promise<Result<DraftInfo, PluginStoreError>>;
  /** 저장된 초안 정보 전부(순서 없음) */
  listDrafts(): Promise<Result<readonly DraftInfo[], PluginStoreError>>;
  /** 초안 폴더 하나를 지운다. 없으면 성공이다 */
  removeDraft(draftId: string): Promise<Result<void, PluginStoreError>>;
  /** 검토 항목을 `queue/<itemId>.json`에 쓴다 */
  writeItem(item: ReviewItem): Promise<Result<void, PluginStoreError>>;
  /** 검토 항목 하나. 없으면 `not_found`다 */
  readItem(itemId: string): Promise<Result<ReviewItem, PluginStoreError>>;
  /** 검토 항목 전부(순서 없음) */
  listItems(): Promise<Result<readonly ReviewItem[], PluginStoreError>>;
}

/** 지역 id 형식이 아니면 파일 경로로 쓰지 않는다(경로 탈출 방지). 형식이 틀린 id는 없는 것으로 본다 */
function localIdOk(prefix: "rvw" | "drf", id: string): boolean {
  return isLocalId(prefix, id);
}

/** 상대 경로가 폴더 밖을 가리키는가. 절대 경로, 역슬래시, `..` 조각은 거절한다 */
function escapesFolder(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\")) return true;
  return path.split("/").some((part) => part === ".." || part === "");
}

/** 이름이 폴더 이름으로 안전한지 본다(검토본 이름은 확장 이름과 같다) */
function validName(name: string): Result<string, PluginStoreError> {
  const parsed = parse(ExtensionNameSchema, name);
  if (!parsed.ok) return err({ kind: "invalid_name", name });
  return ok(name);
}

function hexOf(contentHash: string): Result<string, PluginStoreError> {
  const found = HASH_PATTERN.exec(contentHash);
  const hex = found?.[1];
  if (hex === undefined || !HEX_PATTERN.test(hex))
    return err({ kind: "invalid_hash", contentHash });
  return ok(hex);
}

/** 파일 시스템 오류의 코드(`ENOENT` 따위). 코드가 없으면 undefined */
function codeOf(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return undefined;
  return typeof cause.code === "string" ? cause.code : undefined;
}

function ioOf(path: string, cause: unknown): PluginStoreError {
  return { kind: "io", path, cause };
}

let sequence = 0;

/** 같은 프로세스 안에서 겹치지 않는 임시 이름 */
function tempName(base: string): string {
  sequence += 1;
  return `${base}.${process.pid}.${sequence}.tmp`;
}

/** 항목을 앞에서부터 차례로 처리한다. 앞 항목이 끝나야 다음을 시작하고, 실패가 나오면 거기서 멈춘다 */
function sequenceResults<T>(
  items: readonly T[],
  step: (item: T) => Promise<Result<void, PluginStoreError>>,
): Promise<Result<void, PluginStoreError>> {
  return items.reduce<Promise<Result<void, PluginStoreError>>>(
    async (chain, item) => {
      const done = await chain;
      if (!done.ok) return done;
      return step(item);
    },
    Promise.resolve(ok(undefined)),
  );
}

/** `sequenceResults`와 같되 각 단계가 값을 내고, 모인 값을 돌려준다 */
function collectInOrder<T, U>(
  items: readonly T[],
  step: (item: T) => Promise<Result<readonly U[], PluginStoreError>>,
): Promise<Result<U[], PluginStoreError>> {
  return items.reduce<Promise<Result<U[], PluginStoreError>>>(
    async (chain, item) => {
      const done = await chain;
      if (!done.ok) return done;
      const next = await step(item);
      if (!next.ok) return next;
      return ok([...done.value, ...next.value]);
    },
    Promise.resolve(ok([])),
  );
}

async function pathExists(path: string): Promise<boolean> {
  const found = await attemptAsync(() => lstat(path));
  return found.ok;
}

async function isDirectory(path: string): Promise<boolean> {
  const found = await attemptAsync(() => lstat(path));
  return found.ok && found.value.isDirectory();
}

/** 폴더 안의 항목 이름. 없는 폴더는 빈 목록이다 */
async function namesIn(path: string): Promise<Result<string[], PluginStoreError>> {
  const listed = await attemptAsync(() => readdir(path));
  if (!listed.ok) {
    if (codeOf(listed.error.cause) === "ENOENT") return ok([]);
    return err(ioOf(path, listed.error.cause));
  }
  return ok(listed.value);
}

/** 폴더 트리의 디렉터리 권한을 쓸 수 있게 되돌린다. 읽기 전용 트리를 지우기 전에 쓴다 */
async function makeWritable(path: string): Promise<void> {
  const stat = await lstat(path);
  if (!stat.isDirectory()) return;
  await chmod(path, 0o755);
  await sequentially(await readdir(path), (entry) => makeWritable(join(path, entry)));
}

/** 폴더 또는 파일을 지운다. 읽기 전용 트리도 지운다 */
async function removeTree(path: string): Promise<Result<void, PluginStoreError>> {
  if (!(await pathExists(path))) return ok(undefined);
  const prepared = await attemptAsync(() => makeWritable(path));
  if (!prepared.ok) return err(ioOf(path, prepared.error.cause));
  const removed = await attemptAsync(() => rm(path, { recursive: true, force: true }));
  if (!removed.ok) return err(ioOf(path, removed.error.cause));
  return ok(undefined);
}

/**
 * 검토본 트리를 읽기 전용으로 바꾼다. 파일은 0444, 실행 비트가 있는 파일은 0555다(해시가 실행 비트를 쓰므로 비트를 지우지 않는다).
 * 폴더는 0555다. 아래부터 바꿔 폴더를 잠그기 전에 그 안의 파일을 먼저 바꾼다
 */
async function makeReadOnly(path: string): Promise<void> {
  const stat = await lstat(path);
  if (stat.isDirectory()) {
    await sequentially(await readdir(path), (entry) => makeReadOnly(join(path, entry)));
    await chmod(path, 0o555);
    return;
  }
  await chmod(path, (stat.mode & 0o111) !== 0 ? 0o555 : 0o444);
}

/** 임시 파일에 쓰고 이름을 바꾼다(M5c §4.6.2 `current`) */
async function writeAtomic(path: string, text: string): Promise<Result<void, PluginStoreError>> {
  const dir = dirname(path);
  const made = await attemptAsync(() => mkdir(dir, { recursive: true }));
  if (!made.ok) return err(ioOf(dir, made.error.cause));
  const temp = tempName(path);
  const written = await attemptAsync(() => writeFile(temp, text, { mode: 0o600 }));
  if (!written.ok) return err(ioOf(temp, written.error.cause));
  const renamed = await attemptAsync(() => rename(temp, path));
  if (!renamed.ok) return err(ioOf(path, renamed.error.cause));
  return ok(undefined);
}

/** 메타 파일을 읽는다. 없으면 `not_found`, 못 읽으면 `corrupt`다 */
async function readMeta(path: string): Promise<Result<PluginReviewMeta, PluginStoreError>> {
  const text = await attemptAsync(() => readFile(path, "utf8"));
  if (!text.ok) {
    return codeOf(text.error.cause) === "ENOENT"
      ? err({ kind: "not_found", what: path })
      : err(ioOf(path, text.error.cause));
  }
  const json = parseJson(text.value);
  if (!json.ok) return err({ kind: "corrupt", path });
  const meta = parse(MetaSchema, json.value);
  if (!meta.ok) return err({ kind: "corrupt", path });
  return ok(meta.value);
}

/** 결정 기록 파일을 읽는다. 없으면 빈 목록이다 */
async function readLogFile(path: string): Promise<Result<ReviewLogEntry[], PluginStoreError>> {
  const text = await attemptAsync(() => readFile(path, "utf8"));
  if (!text.ok) {
    return codeOf(text.error.cause) === "ENOENT" ? ok([]) : err(ioOf(path, text.error.cause));
  }
  const entries: ReviewLogEntry[] = [];
  for (const line of text.value.split("\n")) {
    if (line.length === 0) continue;
    const json = parseJson(line);
    if (!json.ok) return err({ kind: "corrupt", path });
    const entry = parse(LogEntrySchema, json.value);
    if (!entry.ok) return err({ kind: "corrupt", path });
    entries.push(entry.value);
  }
  return ok(entries);
}

/** 복사 원본의 파일을 스냅샷 폴더로 옮긴다. 해시에 든 파일만 복사하고 실행 비트를 보존한다 */
function copyFiles(
  srcDir: string,
  dstDir: string,
  files: readonly { readonly path: string; readonly executable: boolean }[],
): Promise<Result<void, PluginStoreError>> {
  return sequenceResults(files, async (file) => {
    const from = join(srcDir, file.path);
    const to = join(dstDir, file.path);
    const made = await attemptAsync(() => mkdir(dirname(to), { recursive: true }));
    if (!made.ok) return err(ioOf(dirname(to), made.error.cause));
    const copied = await attemptAsync(() => copyFile(from, to));
    if (!copied.ok) return err(ioOf(from, copied.error.cause));
    const mode = await attemptAsync(() => chmod(to, file.executable ? 0o755 : 0o644));
    if (!mode.ok) return err(ioOf(to, mode.error.cause));
    return ok(undefined);
  });
}

/** 보관 목록 한 줄. 정리는 폴더 이름(hex)이 필요해 따로 든다 */
interface VersionRow extends PluginVersionInfo {
  readonly hex: string;
}

/** 승인 시각이 최근인 것부터 */
function newestFirst(
  a: { readonly approvedAt: string },
  b: { readonly approvedAt: string },
): number {
  if (a.approvedAt === b.approvedAt) return 0;
  return a.approvedAt < b.approvedAt ? 1 : -1;
}

/** 메타가 없거나 읽지 못한 검토본이 기록과 맞는가. 맞지 않으면 승인 도중 끊긴 흔적이다 */
function interruptedOf(
  meta: Result<PluginReviewMeta, PluginStoreError>,
  decided: ReadonlySet<string | null>,
): boolean {
  if (!meta.ok) return meta.error.kind === "not_found";
  return !decided.has(meta.value.decisionId);
}

/** 초안 정보 파일을 읽는다. 없으면 `not_found`, 깨졌으면 `corrupt`다 */
async function readDraftFile(path: string): Promise<Result<DraftInfo, PluginStoreError>> {
  const text = await attemptAsync(() => readFile(path, "utf8"));
  if (!text.ok) {
    return codeOf(text.error.cause) === "ENOENT"
      ? err({ kind: "not_found", what: path })
      : err(ioOf(path, text.error.cause));
  }
  const json = parseJson(text.value);
  if (!json.ok) return err({ kind: "corrupt", path });
  const info = parse(DraftInfoSchema, json.value);
  if (!info.ok) return err({ kind: "corrupt", path });
  return ok(info.value);
}

async function readItemFile(path: string): Promise<Result<ReviewItem, PluginStoreError>> {
  const text = await attemptAsync(() => readFile(path, "utf8"));
  if (!text.ok) {
    return codeOf(text.error.cause) === "ENOENT"
      ? err({ kind: "not_found", what: path })
      : err(ioOf(path, text.error.cause));
  }
  const json = parseJson(text.value);
  if (!json.ok) return err({ kind: "corrupt", path });
  const item = parse(ReviewItemSchema, json.value);
  if (!item.ok) return err({ kind: "corrupt", path });
  return ok(item.value);
}

/** 검토본 저장소를 연다. 디렉터리는 쓸 때 만든다 */
export function createPluginStore(deps: PluginStoreDeps): PluginStore {
  const root = deps.root;
  const reviewedDir = join(root, "reviewed");
  const candidatesDir = join(root, "candidates");
  const draftsDir = join(root, "drafts");
  const queueDir = join(root, "queue");
  const logPath = join(root, "review-log.jsonl");

  /** 쓰기는 저장소 잠금 하나로 줄을 세운다. 안에서 다시 잠그지 않는다 */
  async function locked<T>(
    fn: () => Promise<Result<T, PluginStoreError>>,
  ): Promise<Result<T, PluginStoreError>> {
    const made = await attemptAsync(() => mkdir(root, { recursive: true }));
    if (!made.ok) return err(ioOf(root, made.error.cause));
    const result = await deps.fileLock.withLock(join(root, "store.lock"), fn);
    if (!result.ok) return err({ kind: "lock", error: result.error });
    return result.value;
  }

  function versionDirOf(name: string, hex: string): string {
    return join(reviewedDir, name, hex);
  }

  /** 현재 검토본의 hex. 없으면 null, 형식이 틀리면 손상이다 */
  async function currentHex(name: string): Promise<Result<string | null, PluginStoreError>> {
    const path = join(reviewedDir, name, "current");
    const text = await attemptAsync(() => readFile(path, "utf8"));
    if (!text.ok) {
      return codeOf(text.error.cause) === "ENOENT" ? ok(null) : err(ioOf(path, text.error.cause));
    }
    const hex = text.value.trim();
    if (!HEX_PATTERN.test(hex)) return err({ kind: "corrupt", path });
    return ok(hex);
  }

  /** 보관 목록 전체(메타가 있는 것만). 이름이 안전하지 않으면 거절한다 */
  async function listVersions(name: string): Promise<Result<VersionRow[], PluginStoreError>> {
    const valid = validName(name);
    if (!valid.ok) return err(valid.error);
    const listed = await namesIn(join(reviewedDir, name));
    if (!listed.ok) return err(listed.error);
    const currentValue = await currentHex(name);
    if (!currentValue.ok) return err(currentValue.error);
    const hexes = listed.value.filter((entry) => HEX_PATTERN.test(entry)).toSorted(compareUtf8);
    const loaded = await Promise.all(
      hexes.map(async (hex) => ({
        hex,
        meta: await readMeta(join(versionDirOf(name, hex), "meta.json")),
      })),
    );
    const rows: VersionRow[] = [];
    for (const item of loaded) {
      if (!item.meta.ok) {
        // 메타가 없는 폴더는 승인 도중 끊긴 흔적이라 세지 않는다. 읽지 못하는 메타는 손상이다
        if (item.meta.error.kind === "not_found") continue;
        return err(item.meta.error);
      }
      rows.push({
        hex: item.hex,
        contentHash: `sha256:${item.hex}`,
        approvedAt: item.meta.value.approvedAt,
        current: currentValue.value === item.hex,
        version: item.meta.value.version,
        origin: item.meta.value.origin,
      });
    }
    return ok(rows);
  }

  async function snapshotOnce(
    srcDir: string,
  ): Promise<Result<{ readonly contentHash: string } | null, PluginStoreError>> {
    const source = hashPluginTree(srcDir);
    if (!source.ok) return err({ kind: "tree_rejected", path: srcDir, error: source.error });
    const staging = join(candidatesDir, tempName(".staging"));
    const stagingTree = join(staging, "tree");
    const copied = await copyFiles(srcDir, stagingTree, source.value.files);
    if (!copied.ok) {
      await removeTree(staging);
      return err(copied.error);
    }
    const copy = hashPluginTree(stagingTree);
    if (!copy.ok) {
      await removeTree(staging);
      return err({ kind: "tree_rejected", path: stagingTree, error: copy.error });
    }
    if (copy.value.contentHash !== source.value.contentHash) {
      // 복사하는 동안 원본이 바뀌었다. 복사본을 버리고 호출자가 다시 하게 한다
      await removeTree(staging);
      return ok(null);
    }
    const hex = hexOf(copy.value.contentHash);
    if (!hex.ok) {
      await removeTree(staging);
      return err(hex.error);
    }
    const target = join(candidatesDir, hex.value);
    if (!(await isDirectory(join(target, "tree")))) {
      const made = await attemptAsync(() => mkdir(target, { recursive: true }));
      if (!made.ok) return err(ioOf(target, made.error.cause));
      const moved = await attemptAsync(() => rename(stagingTree, join(target, "tree")));
      if (!moved.ok) return err(ioOf(target, moved.error.cause));
    }
    // 같은 내용의 후보가 이미 있으면 이 복사본은 쓸모가 없다
    const dropped = await removeTree(staging);
    if (!dropped.ok) return err(dropped.error);
    return ok({ contentHash: copy.value.contentHash });
  }

  /** 복사를 세 번까지 다시 한다(M5c §5). 그래도 원본이 안정되지 않으면 `source_unstable`이다 */
  async function snapshotWithRetry(
    srcDir: string,
    attemptNo: number,
  ): Promise<Result<{ readonly contentHash: string }, PluginStoreError>> {
    const attempt = await snapshotOnce(srcDir);
    if (!attempt.ok) return err(attempt.error);
    if (attempt.value !== null) return ok(attempt.value);
    if (attemptNo >= SNAPSHOT_TRIES) return err({ kind: "source_unstable", path: srcDir });
    return snapshotWithRetry(srcDir, attemptNo + 1);
  }

  async function snapshotCandidate(
    srcDir: string,
  ): Promise<Result<{ readonly contentHash: string }, PluginStoreError>> {
    return locked(() => snapshotWithRetry(srcDir, 1));
  }

  async function promote(
    contentHash: string,
    meta: PluginReviewMeta,
  ): Promise<Result<void, PluginStoreError>> {
    if (meta.contentHash !== contentHash) {
      // 호출자가 두 값을 함께 만든다. 다르면 호출 쪽 버그다
      throw new Bug(
        "plugin store: promote received a meta whose contentHash differs from the candidate",
      );
    }
    const hex = hexOf(contentHash);
    if (!hex.ok) return err(hex.error);
    const name = validName(meta.name);
    if (!name.ok) return err(name.error);
    return locked(async () => {
      const candidateTree = join(candidatesDir, hex.value, "tree");
      if (!(await isDirectory(candidateTree))) {
        return err({ kind: "not_found", what: `candidate ${contentHash}` });
      }
      const versionDir = versionDirOf(meta.name, hex.value);
      const tree = join(versionDir, "tree");
      const existing = (await pathExists(tree)) ? hashPluginTree(tree) : undefined;
      if (existing !== undefined && existing.ok && existing.value.contentHash === contentHash) {
        // 같은 내용의 검토본이 이미 있다. 실행 중일 수 있어 트리는 건드리지 않고 후보만 버린다
        const dropped = await removeTree(join(candidatesDir, hex.value));
        if (!dropped.ok) return err(dropped.error);
      } else {
        // 트리가 없거나 내용이 다르면(승인 도중 끊긴 흔적) 버리고 후보를 옮긴다
        const cleared = await removeTree(versionDir);
        if (!cleared.ok) return err(cleared.error);
        const made = await attemptAsync(() => mkdir(versionDir, { recursive: true }));
        if (!made.ok) return err(ioOf(versionDir, made.error.cause));
        const moved = await attemptAsync(() => rename(candidateTree, tree));
        if (!moved.ok) return err(ioOf(candidateTree, moved.error.cause));
        const dropped = await removeTree(join(candidatesDir, hex.value));
        if (!dropped.ok) return err(dropped.error);
        const sealed = await attemptAsync(() => makeReadOnly(tree));
        if (!sealed.ok) return err(ioOf(tree, sealed.error.cause));
      }
      return writeAtomic(join(versionDir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
    });
  }

  async function discardCandidate(contentHash: string): Promise<Result<void, PluginStoreError>> {
    const hex = hexOf(contentHash);
    if (!hex.ok) return err(hex.error);
    return locked(() => removeTree(join(candidatesDir, hex.value)));
  }

  async function setCurrent(
    name: string,
    contentHash: string,
  ): Promise<Result<void, PluginStoreError>> {
    const valid = validName(name);
    if (!valid.ok) return err(valid.error);
    const hex = hexOf(contentHash);
    if (!hex.ok) return err(hex.error);
    return locked(async () => {
      if (!(await pathExists(join(versionDirOf(name, hex.value), "meta.json")))) {
        return err({ kind: "not_found", what: `reviewed ${name} ${contentHash}` });
      }
      return writeAtomic(join(reviewedDir, name, "current"), `${hex.value}\n`);
    });
  }

  async function current(name: string): Promise<Result<ReviewedVersion | null, PluginStoreError>> {
    const valid = validName(name);
    if (!valid.ok) return err(valid.error);
    const hex = await currentHex(name);
    if (!hex.ok) return err(hex.error);
    if (hex.value === null) return ok(null);
    const dir = versionDirOf(name, hex.value);
    const meta = await readMeta(join(dir, "meta.json"));
    if (!meta.ok) {
      // current가 가리키는 검토본의 메타가 없거나 깨졌다. 손상이다
      return err(meta.error.kind === "not_found" ? { kind: "corrupt", path: dir } : meta.error);
    }
    return ok({
      contentHash: `sha256:${hex.value}`,
      meta: meta.value,
      treePath: join(dir, "tree"),
    });
  }

  async function treePath(
    name: string,
    contentHash?: string,
  ): Promise<Result<string, PluginStoreError>> {
    const valid = validName(name);
    if (!valid.ok) return err(valid.error);
    if (contentHash !== undefined) {
      const hex = hexOf(contentHash);
      if (!hex.ok) return err(hex.error);
      return ok(join(versionDirOf(name, hex.value), "tree"));
    }
    const version = await current(name);
    if (!version.ok) return err(version.error);
    if (version.value === null) return err({ kind: "not_found", what: `current ${name}` });
    return ok(version.value.treePath);
  }

  async function versions(
    name: string,
  ): Promise<Result<readonly PluginVersionInfo[], PluginStoreError>> {
    const rows = await listVersions(name);
    if (!rows.ok) return err(rows.error);
    return ok(
      rows.value
        .map((row) => ({
          contentHash: row.contentHash,
          approvedAt: row.approvedAt,
          current: row.current,
          version: row.version,
          origin: row.origin,
        }))
        .toSorted(newestFirst),
    );
  }

  async function names(): Promise<Result<readonly string[], PluginStoreError>> {
    const listed = await namesIn(reviewedDir);
    if (!listed.ok) return err(listed.error);
    const candidates = listed.value
      .filter((entry) => parse(ExtensionNameSchema, entry).ok)
      .toSorted(compareUtf8);
    const checked = await Promise.all(
      candidates.map(async (entry) => ({
        entry,
        dir: await isDirectory(join(reviewedDir, entry)),
      })),
    );
    return ok(checked.filter((item) => item.dir).map((item) => item.entry));
  }

  async function verifyIntegrity(
    name: string,
    contentHash: string,
  ): Promise<Result<void, PluginStoreError>> {
    const valid = validName(name);
    if (!valid.ok) return err(valid.error);
    const hex = hexOf(contentHash);
    if (!hex.ok) return err(hex.error);
    const dir = versionDirOf(name, hex.value);
    const meta = await readMeta(join(dir, "meta.json"));
    if (!meta.ok) return err(meta.error);
    const actual = hashPluginTree(join(dir, "tree"));
    const actualHash = actual.ok ? actual.value.contentHash : null;
    if (actualHash !== contentHash || meta.value.contentHash !== contentHash) {
      return err({ kind: "pinned_corrupt", name, contentHash, actual: actualHash });
    }
    return ok(undefined);
  }

  async function prune(
    name: string,
    options: { readonly keep: number; readonly inUse: ReadonlySet<string> },
  ): Promise<Result<readonly string[], PluginStoreError>> {
    return locked(async () => {
      const listed = await listVersions(name);
      if (!listed.ok) return err(listed.error);
      // 최근 승인 순서로 `keep`개까지 남기고, 현재 것과 쓰이는 것은 순서와 무관하게 남긴다
      const kept = new Set(
        listed.value
          .toSorted(newestFirst)
          .slice(0, options.keep)
          .map((row) => row.contentHash),
      );
      for (const row of listed.value) {
        if (row.current || options.inUse.has(row.contentHash)) kept.add(row.contentHash);
      }
      const doomed = listed.value.filter((row) => !kept.has(row.contentHash));
      const dropped = await sequenceResults(doomed, (row) =>
        removeTree(versionDirOf(name, row.hex)),
      );
      if (!dropped.ok) return err(dropped.error);
      return ok(doomed.map((row) => row.contentHash));
    });
  }

  async function appendLog(entry: ReviewLogEntry): Promise<Result<void, PluginStoreError>> {
    return locked(async () => {
      const made = await attemptAsync(() => mkdir(root, { recursive: true }));
      if (!made.ok) return err(ioOf(root, made.error.cause));
      const appended = await attemptAsync(() => appendFile(logPath, `${JSON.stringify(entry)}\n`));
      if (!appended.ok) return err(ioOf(logPath, appended.error.cause));
      return ok(undefined);
    });
  }

  async function readLog(): Promise<Result<readonly ReviewLogEntry[], PluginStoreError>> {
    return readLogFile(logPath);
  }

  async function recover(): Promise<
    Result<{ readonly removed: readonly string[] }, PluginStoreError>
  > {
    return locked(async () => {
      // 복사 도중 끊긴 임시 폴더
      const staging = await namesIn(candidatesDir);
      if (!staging.ok) return err(staging.error);
      const dropped = await sequenceResults(
        staging.value.filter((entry) => entry.startsWith(".staging")),
        (entry) => removeTree(join(candidatesDir, entry)),
      );
      if (!dropped.ok) return err(dropped.error);
      // 기록에 없는 검토본은 승인이 끝나지 않은 것이다. 현재 검토본은 기록과 상관없이 남긴다
      const log = await readLogFile(logPath);
      if (!log.ok) return err(log.error);
      const decided: ReadonlySet<string | null> = new Set(log.value.map((entry) => entry.itemId));
      const owners = await namesIn(reviewedDir);
      if (!owners.ok) return err(owners.error);
      const removed = await collectInOrder(
        owners.value.filter((name) => parse(ExtensionNameSchema, name).ok).toSorted(compareUtf8),
        async (name) => {
          const currentValue = await currentHex(name);
          if (!currentValue.ok) return err(currentValue.error);
          const listed = await namesIn(join(reviewedDir, name));
          if (!listed.ok) return err(listed.error);
          const hexes = listed.value
            .filter((hex) => HEX_PATTERN.test(hex) && hex !== currentValue.value)
            .toSorted(compareUtf8);
          const flagged = await Promise.all(
            hexes.map(async (hex) => ({
              hex,
              interrupted: interruptedOf(
                await readMeta(join(versionDirOf(name, hex), "meta.json")),
                decided,
              ),
            })),
          );
          const doomed = flagged.filter((item) => item.interrupted).map((item) => item.hex);
          const cleared = await sequenceResults(doomed, (hex) =>
            removeTree(versionDirOf(name, hex)),
          );
          if (!cleared.ok) return err(cleared.error);
          return ok(doomed.map((hex) => `${name}/${hex}`));
        },
      );
      if (!removed.ok) return err(removed.error);
      return ok({ removed: removed.value });
    });
  }

  async function clearCurrent(name: string): Promise<Result<void, PluginStoreError>> {
    const valid = validName(name);
    if (!valid.ok) return err(valid.error);
    return locked(async () => {
      const path = join(reviewedDir, name, "current");
      const removed = await attemptAsync(() => rm(path, { force: true }));
      if (!removed.ok) return err(ioOf(path, removed.error.cause));
      return ok(undefined);
    });
  }

  function candidateTreeOf(contentHash: string): Result<string, PluginStoreError> {
    const hex = hexOf(contentHash);
    if (!hex.ok) return err(hex.error);
    return ok(join(candidatesDir, hex.value, "tree"));
  }

  async function readCandidateFile(
    contentHash: string,
    path: string,
  ): Promise<Result<Uint8Array, PluginStoreError>> {
    const tree = candidateTreeOf(contentHash);
    if (!tree.ok) return err(tree.error);
    if (escapesFolder(path)) return err({ kind: "not_found", what: `candidate file ${path}` });
    const file = join(tree.value, path);
    const bytes = await attemptAsync(() => readFile(file));
    if (!bytes.ok) {
      return codeOf(bytes.error.cause) === "ENOENT"
        ? err({ kind: "not_found", what: `candidate file ${path}` })
        : err(ioOf(file, bytes.error.cause));
    }
    return ok(new Uint8Array(bytes.value));
  }

  function draftPathOf(draftId: string): string {
    return join(draftsDir, draftId);
  }

  async function saveDraft(
    srcDir: string,
    draftId: string,
    meta: (contentHash: string) => DraftInfo,
  ): Promise<Result<DraftInfo, PluginStoreError>> {
    if (!localIdOk("drf", draftId)) return err({ kind: "invalid_name", name: draftId });
    return locked(async () => {
      const source = hashPluginTree(srcDir);
      if (!source.ok) return err({ kind: "tree_rejected", path: srcDir, error: source.error });
      const dir = draftPathOf(draftId);
      const staging = join(candidatesDir, tempName(".staging"));
      const stagingTree = join(staging, "tree");
      const copied = await copyFiles(srcDir, stagingTree, source.value.files);
      if (!copied.ok) {
        await removeTree(staging);
        return err(copied.error);
      }
      const copy = hashPluginTree(stagingTree);
      if (!copy.ok || copy.value.contentHash !== source.value.contentHash) {
        await removeTree(staging);
        return err({ kind: "source_unstable", path: srcDir });
      }
      const made = await attemptAsync(() => mkdir(dir, { recursive: true }));
      if (!made.ok) return err(ioOf(dir, made.error.cause));
      const moved = await attemptAsync(() => rename(stagingTree, join(dir, "tree")));
      if (!moved.ok) return err(ioOf(dir, moved.error.cause));
      const dropped = await removeTree(staging);
      if (!dropped.ok) return err(dropped.error);
      const info = meta(source.value.contentHash);
      const written = await writeAtomic(
        join(dir, "meta.json"),
        `${JSON.stringify(info, null, 2)}\n`,
      );
      if (!written.ok) return err(written.error);
      return ok(info);
    });
  }

  async function writeDraft(info: DraftInfo): Promise<Result<void, PluginStoreError>> {
    if (!localIdOk("drf", info.draftId)) return err({ kind: "invalid_name", name: info.draftId });
    return locked(() =>
      writeAtomic(
        join(draftPathOf(info.draftId), "meta.json"),
        `${JSON.stringify(info, null, 2)}\n`,
      ),
    );
  }

  async function readDraft(draftId: string): Promise<Result<DraftInfo, PluginStoreError>> {
    if (!localIdOk("drf", draftId)) return err({ kind: "not_found", what: `draft ${draftId}` });
    return readDraftFile(join(draftPathOf(draftId), "meta.json"));
  }

  async function listDrafts(): Promise<Result<readonly DraftInfo[], PluginStoreError>> {
    const listed = await namesIn(draftsDir);
    if (!listed.ok) return err(listed.error);
    const ids = listed.value.filter((entry) => localIdOk("drf", entry)).toSorted(compareUtf8);
    const loaded = await Promise.all(
      ids.map((id) => readDraftFile(join(draftPathOf(id), "meta.json"))),
    );
    const infos: DraftInfo[] = [];
    for (const item of loaded) {
      if (!item.ok) {
        // 메타가 없는 폴더는 저장 도중 끊긴 흔적이라 세지 않는다. 읽지 못하는 메타는 손상이다
        if (item.error.kind === "not_found") continue;
        return err(item.error);
      }
      infos.push(item.value);
    }
    return ok(infos);
  }

  async function removeDraft(draftId: string): Promise<Result<void, PluginStoreError>> {
    if (!localIdOk("drf", draftId)) return err({ kind: "not_found", what: `draft ${draftId}` });
    return locked(() => removeTree(draftPathOf(draftId)));
  }

  async function writeItem(item: ReviewItem): Promise<Result<void, PluginStoreError>> {
    if (!localIdOk("rvw", item.itemId)) return err({ kind: "invalid_name", name: item.itemId });
    return locked(() =>
      writeAtomic(join(queueDir, `${item.itemId}.json`), `${JSON.stringify(item, null, 2)}\n`),
    );
  }

  async function readItem(itemId: string): Promise<Result<ReviewItem, PluginStoreError>> {
    if (!localIdOk("rvw", itemId)) return err({ kind: "not_found", what: `item ${itemId}` });
    return readItemFile(join(queueDir, `${itemId}.json`));
  }

  async function listItems(): Promise<Result<readonly ReviewItem[], PluginStoreError>> {
    const listed = await namesIn(queueDir);
    if (!listed.ok) return err(listed.error);
    const files = listed.value.filter((entry) => entry.endsWith(".json")).toSorted(compareUtf8);
    const loaded = await Promise.all(files.map((file) => readItemFile(join(queueDir, file))));
    const items: ReviewItem[] = [];
    for (const item of loaded) {
      if (!item.ok) return err(item.error);
      items.push(item.value);
    }
    return ok(items);
  }

  return {
    snapshotCandidate,
    promote,
    discardCandidate,
    setCurrent,
    current,
    treePath,
    versions,
    names,
    verifyIntegrity,
    prune,
    appendLog,
    readLog,
    recover,
    draftDir: (draftId) => join(draftsDir, draftId),
    queueFile: (itemId) => join(queueDir, `${itemId}.json`),
    clearCurrent,
    candidateTree: candidateTreeOf,
    readCandidateFile,
    saveDraft,
    writeDraft,
    readDraft,
    listDrafts,
    removeDraft,
    writeItem,
    readItem,
    listItems,
  };
}
