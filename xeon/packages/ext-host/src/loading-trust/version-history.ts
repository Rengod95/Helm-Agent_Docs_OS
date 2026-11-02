// 확장 버전 기록 보관(X.loading-trust.spec §3.11, §4.4.8, X-8). 설치본은 `<historyRoot>/<이름>/<버전>/`에
// `dir/`(파일 복사)과 `meta.json`(버전, 설치 시각, 출처, 매니페스트 해시, 상태 스키마 버전)으로 남는다.
// 파일 접근, 시계, 해시는 주입받는다. 되돌리기는 끄기 → 지금 설치본 기록 → 교체 → 상태 비우기 → 켜기 순서다.
import { join } from "node:path";
import {
  attemptAsync,
  Bug,
  err,
  ok,
  parse,
  parseJson,
  type Result,
  type Thrown,
} from "@fresnel/contracts";
import { isSemVer, SemVerSchema } from "@fresnel/contracts/capabilities";
import { ExtensionNameSchema } from "@fresnel/contracts/extensions";
import type { ExtRollbackResult, ExtVersionEntry } from "@fresnel/contracts/wire";
import { Type, type Static } from "typebox";
import { eachInOrder } from "../primitives/sequence.ts";
import { MANIFEST_RELATIVE_PATH } from "./discover.ts";
import { compareVersions } from "./semver.ts";

/** 확장마다 보관하는 개수의 기본값(X.loading-trust.spec §4.4.8) */
const DEFAULT_KEEP = 5;
/** 버전 디렉터리 안의 파일 복사본 이름과 메타 파일 이름 */
const PAYLOAD_DIR = "dir";
const META_FILE = "meta.json";
/** 되돌리기 임시 이름. 점으로 시작하므로 버전 목록이 버전으로 세지 않는다 */
const SWAP_NEW = ".swap.new";
const SWAP_OLD = ".swap.old";

/** `meta.json` 형식. 검증에 실패하면 그 버전을 목록에서 건너뛴다 */
const VersionMetaSchema = Type.Object({
  version: SemVerSchema,
  installedAt: Type.String({ minLength: 1, maxLength: 40 }),
  source: Type.Union([Type.Literal("bundled"), Type.Literal("user"), Type.Literal("authored")]),
  manifestHash: Type.String({ minLength: 1, maxLength: 128 }),
  stateSchemaVersion: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
});
type VersionMeta = Static<typeof VersionMetaSchema>;

/** 보관 항목의 출처. `ExtVersionEntry.source`와 같다 */
export type VersionSource = ExtVersionEntry["source"];

/**
 * 버전 기록의 파일 접근. 구현은 조립 루트(L4 host)가 node:fs로 만들어 넘긴다. 없음은 null이나 false로 돌려주고,
 * 입출력 실패는 거부(throw)로 두면 이 모듈이 `io` 오류 값으로 바꾼다. `copyDir`과 `renameDir`의 `to`는 없어야 한다.
 * `writeText`는 임시 파일에 쓰고 옮겨서 원자적으로 쓴다(X.loading-trust.spec §4.4.8)
 */
export interface VersionHistoryFs {
  /** 없으면 null */
  readText(path: string): Promise<string | null>;
  /** 부모 디렉터리가 없으면 만든다 */
  writeText(path: string, text: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** 없으면 null. 항목 이름은 정렬하지 않은 원본 */
  listDir(
    path: string,
  ): Promise<
    readonly { readonly name: string; readonly kind: "file" | "dir" | "symlink" }[] | null
  >;
  /** 재귀 복사. 중간 디렉터리를 만든다. 심볼릭 링크는 가리키는 내용을 복사한다 */
  copyDir(from: string, to: string): Promise<void>;
  /** 디렉터리와 그 아래를 지운다. 없어도 오류가 아니다 */
  removeDir(path: string): Promise<void>;
  /** `from`을 `to`로 옮긴다. 같은 파일 시스템이어야 한다 */
  renameDir(from: string, to: string): Promise<void>;
}

export interface VersionHistoryDeps {
  readonly fs: VersionHistoryFs;
  /** `<사용자 데이터>/extensions/.history`. 확장 탐색 밖이어야 한다(점으로 시작) */
  readonly historyRoot: string;
  /** 설치 시각(ms). 주입한다(TY-21) */
  now(): number;
  /** 매니페스트 텍스트의 해시. 빈 문자열을 주면 안 된다. 호스트는 sha256 16진수를 준다 */
  hash(text: string): string;
  /** 확장마다 보관할 개수. 생략하면 5. 1 이상의 정수가 아니면 `Bug`다 */
  readonly keep?: number;
}

/** 기록 입력. `extensionDir`의 내용이 이 버전의 설치본이다 */
export interface RecordVersionInput {
  readonly name: string;
  readonly version: string;
  readonly source: VersionSource;
  readonly extensionDir: string;
  readonly manifestText: string;
  readonly stateSchemaVersion: number | null;
}

export interface VersionRecordOutcome {
  /** 보관 개수를 넘어 지운 버전(새 것부터) */
  readonly pruned: readonly string[];
  /** 정리가 첫 실패에서 멈췄으면 그 원인. 기록은 이미 끝났고, 남은 버전은 다음 기록 때 다시 본다 */
  readonly pruneFailure: { readonly cause: unknown } | null;
}

/** 목록에서 건너뛴 이유. 이름이 버전 형식이 아닌 디렉터리는 버전이 아니므로 세지 않는다 */
export type VersionSkipReason =
  | "dir_missing"
  | "meta_missing"
  | "meta_not_json"
  | "meta_invalid"
  | "version_mismatch";

export interface VersionListing {
  /** 설치 시각이 늦은 것부터. 같으면 버전 번호가 높은 것이 앞이다 */
  readonly versions: readonly ExtVersionEntry[];
  /** 읽지 못했거나 깨진 버전. 버전 번호 순으로 정렬한다 */
  readonly skipped: readonly { readonly version: string; readonly reason: VersionSkipReason }[];
}

/** 되돌리기가 부르는 호스트 훅. 끄기와 켜기는 확장 등록 상태를, 상태 비우기는 확장 상태 저장소를 바꾼다 */
export interface RollbackHooks {
  disable(name: string): Promise<void>;
  enable(name: string): Promise<void>;
  clearState(name: string): Promise<void>;
}

export interface RollbackVersionInput {
  readonly name: string;
  /** 되돌릴 보관 버전 */
  readonly version: string;
  /** 참이면 상태를 비우고 되돌린다. 내려가는 마이그레이션이 없을 때만 쓴다 */
  readonly clearState?: boolean;
  /** 지금 설치본 디렉터리 `<extensions>/<이름>` */
  readonly extensionDir: string;
  /** 지금 설치본의 버전. 되돌리기 전에 보관한다 */
  readonly currentVersion: string;
  /** 지금 상태 문서 스키마 버전. 모르면 null */
  readonly currentStateSchemaVersion: number | null;
  /** 참이면 다음 단계 경계에 적용된다. 거짓이면 재시작해야 적용된다. 생략하면 참 */
  readonly hotReload?: boolean;
  readonly hooks: RollbackHooks;
}

export type VersionHistoryError =
  | { readonly kind: "invalid_name"; readonly name: string }
  | { readonly kind: "invalid_version"; readonly version: string }
  /** 파일 읽기나 쓰기가 실패했다 */
  | { readonly kind: "io"; readonly cause: unknown }
  /** 보관 목록에 없거나 깨진 버전이다 */
  | { readonly kind: "not_found"; readonly version: string }
  /** 대상의 상태 스키마가 지금보다 낮다. 내려가는 마이그레이션이 없으면 상태를 비워야 한다 */
  | {
      readonly kind: "state_schema_mismatch";
      readonly targetSchemaVersion: number;
      readonly currentSchemaVersion: number;
    }
  /** 끄기 훅이 실패했다. 파일은 바뀌지 않았다 */
  | { readonly kind: "disable_failed"; readonly cause: unknown }
  /**
   * 기록부터 교체까지 어느 단계가 실패했다. `restored`는 파일을 처음 상태로 되돌렸는지, `reenabled`는 다시 켰는지다.
   * 되돌리는 일이나 켜는 일도 실패했으면 `followUps`에 그 원인을 담는다
   */
  | {
      readonly kind: "swap_failed";
      readonly step: "record" | "stage" | "move_current" | "place";
      readonly cause: unknown;
      readonly restored: boolean;
      readonly reenabled: boolean;
      readonly followUps: readonly {
        readonly step: "restore" | "enable";
        readonly cause: unknown;
      }[];
    }
  /** 교체는 끝났고 상태 비우기가 실패했다. 확장은 꺼진 채 남는다 */
  | { readonly kind: "clear_state_failed"; readonly cause: unknown }
  /** 교체와 상태 비우기는 끝났고 켜기가 실패했다. 확장은 꺼진 채 남는다 */
  | { readonly kind: "enable_failed"; readonly cause: unknown };

export interface VersionHistory {
  /** 설치본을 기록한다. 같은 버전은 바꿔 쓰고, 기록 뒤 보관 개수를 넘은 버전을 지운다 */
  record(input: RecordVersionInput): Promise<Result<VersionRecordOutcome, VersionHistoryError>>;
  /** 보관된 버전을 새 것부터 돌려준다. `currentVersion`이 `current`다 */
  list(name: string, currentVersion: string): Promise<Result<VersionListing, VersionHistoryError>>;
  /** 보관된 버전으로 되돌린다(X.loading-trust.spec §4.4.8). 끄기 → 지금 설치본 기록 → 교체 → 상태 비우기 → 켜기 */
  rollback(input: RollbackVersionInput): Promise<Result<ExtRollbackResult, VersionHistoryError>>;
}

/** 메타와 디렉터리가 맞는 보관 항목 하나 */
interface Stored {
  readonly version: string;
  readonly meta: VersionMeta;
  /** 설치 시각(ms). 정렬에 쓴다 */
  readonly atMs: number;
}

type ReadEntry =
  | { readonly kind: "stored"; readonly stored: Stored }
  | { readonly kind: "skipped"; readonly reason: VersionSkipReason };

interface Ctx {
  readonly deps: VersionHistoryDeps;
  /** `createVersionHistory`가 기본값을 채운 보관 개수 */
  readonly keep: number;
}

/** 교체 단계의 실패. `abortSwap`이 다시 켜고 오류 값으로 바꾼다 */
interface SwapFailure {
  readonly step: "record" | "stage" | "move_current" | "place";
  readonly cause: unknown;
  readonly restored: boolean;
  readonly followUps: readonly {
    readonly step: "restore" | "enable";
    readonly cause: unknown;
  }[];
}

function nameError(name: string): VersionHistoryError | undefined {
  return parse(ExtensionNameSchema, name).ok ? undefined : { kind: "invalid_name", name };
}

function entryOf(stored: Stored, currentVersion: string): ExtVersionEntry {
  return {
    version: stored.version,
    installedAt: new Date(stored.atMs).toISOString(),
    source: stored.meta.source,
    manifestHash: stored.meta.manifestHash,
    stateSchemaVersion: stored.meta.stateSchemaVersion,
    current: stored.version === currentVersion,
  };
}

/** 버전 디렉터리 하나를 읽는다. 메타가 없거나 깨졌거나 복사본이 없으면 건너뛴다. 입출력 실패만 오류다 */
async function readEntry(
  fs: VersionHistoryFs,
  nameRoot: string,
  version: string,
): Promise<Result<ReadEntry, VersionHistoryError>> {
  const meta = await attemptAsync(() => fs.readText(join(nameRoot, version, META_FILE)));
  if (!meta.ok) return err({ kind: "io", cause: meta.error.cause });
  if (meta.value === null) return ok({ kind: "skipped", reason: "meta_missing" });
  const payload = await attemptAsync(() => fs.exists(join(nameRoot, version, PAYLOAD_DIR)));
  if (!payload.ok) return err({ kind: "io", cause: payload.error.cause });
  if (!payload.value) return ok({ kind: "skipped", reason: "dir_missing" });
  const json = parseJson(meta.value);
  if (!json.ok) return ok({ kind: "skipped", reason: "meta_not_json" });
  const checked = parse(VersionMetaSchema, json.value);
  if (!checked.ok) return ok({ kind: "skipped", reason: "meta_invalid" });
  if (checked.value.version !== version) return ok({ kind: "skipped", reason: "version_mismatch" });
  const atMs = Date.parse(checked.value.installedAt);
  if (Number.isNaN(atMs)) return ok({ kind: "skipped", reason: "meta_invalid" });
  return ok({ kind: "stored", stored: { version, meta: checked.value, atMs } });
}

type Skipped = { readonly version: string; readonly reason: VersionSkipReason };

/** 이름 디렉터리의 버전들을 읽는다. 새 것부터 정렬한다(설치 시각, 같으면 버전 번호) */
async function readAll(
  fs: VersionHistoryFs,
  nameRoot: string,
): Promise<
  Result<
    { readonly stored: readonly Stored[]; readonly skipped: readonly Skipped[] },
    VersionHistoryError
  >
> {
  const listing = await attemptAsync(() => fs.listDir(nameRoot));
  if (!listing.ok) return err({ kind: "io", cause: listing.error.cause });
  if (listing.value === null) return ok({ stored: [], skipped: [] });
  const names = listing.value
    .filter((entry) => entry.kind === "dir" && isSemVer(entry.name))
    .map((entry) => entry.name);
  const reads = await Promise.all(
    names.map(async (version) => ({ version, read: await readEntry(fs, nameRoot, version) })),
  );
  const stored: Stored[] = [];
  const skipped: Skipped[] = [];
  for (const { version, read } of reads) {
    if (!read.ok) return err(read.error);
    if (read.value.kind === "stored") stored.push(read.value.stored);
    else skipped.push({ version, reason: read.value.reason });
  }
  return ok({
    stored: stored.toSorted(
      (a, b) => b.atMs - a.atMs || (compareVersions(b.version, a.version) ?? 0),
    ),
    skipped: skipped.toSorted((a, b) => compareVersions(b.version, a.version) ?? 0),
  });
}

/**
 * 보관 개수(`keep`)를 넘은 버전을 오래된 것부터 지운다. `keepVersion`(방금 기록한 설치본, 곧 지금 설치본)은 보관 개수
 * 밖이어도 지우지 않는다. 첫 실패에서 멈추고 원인을 돌려준다
 */
async function prune(
  fs: VersionHistoryFs,
  nameRoot: string,
  keep: number,
  keepVersion: string,
): Promise<Pick<VersionRecordOutcome, "pruned" | "pruneFailure">> {
  const read = await readAll(fs, nameRoot);
  if (!read.ok) return { pruned: [], pruneFailure: { cause: read.error } };
  const kept = new Set([
    keepVersion,
    ...read.value.stored.slice(0, keep).map((entry) => entry.version),
  ]);
  const outcome: { pruned: string[]; pruneFailure: { readonly cause: unknown } | null } = {
    pruned: [],
    pruneFailure: null,
  };
  await eachInOrder(
    read.value.stored.filter((entry) => !kept.has(entry.version)),
    async (entry) => {
      const removed = await attemptAsync(() => fs.removeDir(join(nameRoot, entry.version)));
      if (!removed.ok) {
        outcome.pruneFailure = { cause: removed.error.cause };
        return "stop";
      }
      outcome.pruned.push(entry.version);
      return "continue";
    },
  );
  return outcome;
}

/**
 * 임시 디렉터리를 자리에 놓는다. 자리에 있던 버전은 `trash`로 옮겼다가 새 것이 놓이면 지우고, 놓지 못하면 되돌린다.
 * 되돌리기가 실패하면 옛 기록은 `trash`에 남고 다음 기록이 지운다
 */
async function placeStaged(
  fs: VersionHistoryFs,
  staged: string,
  finalDir: string,
  trash: string,
): Promise<Result<void, Thrown>> {
  const cleared = await attemptAsync(() => fs.removeDir(trash));
  if (!cleared.ok) return cleared;
  const existing = await attemptAsync(() => fs.exists(finalDir));
  if (!existing.ok) return existing;
  if (existing.value) {
    const moved = await attemptAsync(() => fs.renameDir(finalDir, trash));
    if (!moved.ok) return moved;
  }
  const placed = await attemptAsync(() => fs.renameDir(staged, finalDir));
  if (!placed.ok) {
    if (existing.value) await attemptAsync(() => fs.renameDir(trash, finalDir));
    return placed;
  }
  if (existing.value) await attemptAsync(() => fs.removeDir(trash));
  return ok(undefined);
}

/** 설치본을 기록한다(§4.4.8). 임시 디렉터리에 다 만든 뒤 옮기므로, 실패하면 같은 버전의 옛 기록이 그대로 남는다 */
async function recordVersion(
  ctx: Ctx,
  input: RecordVersionInput,
): Promise<Result<VersionRecordOutcome, VersionHistoryError>> {
  const problem = nameError(input.name);
  if (problem !== undefined) return err(problem);
  if (!isSemVer(input.version)) return err({ kind: "invalid_version", version: input.version });
  const { fs } = ctx.deps;
  const nameRoot = join(ctx.deps.historyRoot, input.name);
  const meta: VersionMeta = {
    version: input.version,
    installedAt: new Date(ctx.deps.now()).toISOString(),
    source: input.source,
    manifestHash: ctx.deps.hash(input.manifestText),
    stateSchemaVersion: input.stateSchemaVersion,
  };
  const staged = join(nameRoot, `.${input.version}.new`);
  const staging = await attemptAsync(async () => {
    await fs.removeDir(staged);
    await fs.copyDir(input.extensionDir, join(staged, PAYLOAD_DIR));
    await fs.writeText(join(staged, META_FILE), `${JSON.stringify(meta, null, 2)}\n`);
  });
  if (!staging.ok) {
    // 남은 임시 디렉터리는 다음 기록이 먼저 지운다(§4.4.8)
    await attemptAsync(() => fs.removeDir(staged));
    return err({ kind: "io", cause: staging.error.cause });
  }
  const placed = await placeStaged(
    fs,
    staged,
    join(nameRoot, input.version),
    join(nameRoot, `.${input.version}.old`),
  );
  if (!placed.ok) return err({ kind: "io", cause: placed.error.cause });
  return ok(await prune(fs, nameRoot, ctx.keep, input.version));
}

async function listVersions(
  ctx: Ctx,
  name: string,
  currentVersion: string,
): Promise<Result<VersionListing, VersionHistoryError>> {
  const problem = nameError(name);
  if (problem !== undefined) return err(problem);
  const read = await readAll(ctx.deps.fs, join(ctx.deps.historyRoot, name));
  if (!read.ok) return err(read.error);
  return ok({
    versions: read.value.stored.map((entry) => entryOf(entry, currentVersion)),
    skipped: read.value.skipped,
  });
}

/**
 * 되돌리기 전에 지금 설치본을 기록한다. 출처는 이미 기록된 것을 따르고, 기록이 없으면 사용자 설치로 본다.
 * 정리 실패(`pruneFailure`)는 되돌리기 결과를 바꾸지 않는다(§4.4.8)
 */
async function recordCurrent(
  ctx: Ctx,
  input: RollbackVersionInput,
  nameRoot: string,
): Promise<Result<VersionRecordOutcome, VersionHistoryError>> {
  const prior = await readEntry(ctx.deps.fs, nameRoot, input.currentVersion);
  if (!prior.ok) return err(prior.error);
  const source = prior.value.kind === "stored" ? prior.value.stored.meta.source : "user";
  const manifest = await attemptAsync(() =>
    ctx.deps.fs.readText(join(input.extensionDir, MANIFEST_RELATIVE_PATH)),
  );
  if (!manifest.ok) return err({ kind: "io", cause: manifest.error.cause });
  return recordVersion(ctx, {
    name: input.name,
    version: input.currentVersion,
    source,
    extensionDir: input.extensionDir,
    manifestText: manifest.value ?? "",
    stateSchemaVersion: input.currentStateSchemaVersion,
  });
}

/**
 * 교체. 대상 복사본을 임시 디렉터리에 먼저 만든 뒤(옮기기 전이라 실패해도 설치본은 그대로다), 설치본을 백업으로 옮기고,
 * 임시 디렉터리를 설치 위치로 옮긴다. 마지막 옮기기가 실패하면 백업을 되돌린다
 */
async function swapIn(
  fs: VersionHistoryFs,
  extensionDir: string,
  targetDir: string,
  swapNew: string,
  swapOld: string,
): Promise<Result<void, SwapFailure>> {
  const copied = await attemptAsync(() => fs.copyDir(targetDir, swapNew));
  if (!copied.ok) {
    await attemptAsync(() => fs.removeDir(swapNew));
    return err({ step: "stage", cause: copied.error.cause, restored: true, followUps: [] });
  }
  const moved = await attemptAsync(() => fs.renameDir(extensionDir, swapOld));
  if (!moved.ok) {
    await attemptAsync(() => fs.removeDir(swapNew));
    return err({ step: "move_current", cause: moved.error.cause, restored: true, followUps: [] });
  }
  const placed = await attemptAsync(() => fs.renameDir(swapNew, extensionDir));
  if (placed.ok) return ok(undefined);
  const back = await attemptAsync(() => fs.renameDir(swapOld, extensionDir));
  await attemptAsync(() => fs.removeDir(swapNew));
  return err({
    step: "place",
    cause: placed.error.cause,
    restored: back.ok,
    followUps: back.ok ? [] : [{ step: "restore", cause: back.error.cause }],
  });
}

/**
 * 되돌리기가 중간에 끊긴 흔적을 치운다(§4.4.8). 임시 복사본은 지운다. 백업만 남고 설치 위치가 없으면(교체 도중 끊김)
 * 백업을 설치 위치로 되돌린다. 설치 위치가 있으면 백업은 옛 설치본이고 기록에 이미 있으니 지운다
 */
async function clearLeftovers(
  fs: VersionHistoryFs,
  extensionDir: string,
  swapNew: string,
  swapOld: string,
): Promise<Result<void, Thrown>> {
  return attemptAsync(async () => {
    await fs.removeDir(swapNew);
    if (!(await fs.exists(swapOld))) return;
    if (await fs.exists(extensionDir)) await fs.removeDir(swapOld);
    else await fs.renameDir(swapOld, extensionDir);
  });
}

/** 교체가 실패한 뒤 다시 켠다. 켜지 못하면 그 원인도 값에 담는다 */
async function abortSwap(
  hooks: RollbackHooks,
  name: string,
  failure: SwapFailure,
): Promise<Result<never, VersionHistoryError>> {
  const enabled = await attemptAsync(() => hooks.enable(name));
  return err({
    kind: "swap_failed",
    step: failure.step,
    cause: failure.cause,
    restored: failure.restored,
    reenabled: enabled.ok,
    followUps: enabled.ok
      ? failure.followUps
      : [...failure.followUps, { step: "enable", cause: enabled.error.cause }],
  });
}

async function rollbackVersion(
  ctx: Ctx,
  input: RollbackVersionInput,
): Promise<Result<ExtRollbackResult, VersionHistoryError>> {
  const problem = nameError(input.name);
  if (problem !== undefined) return err(problem);
  if (!isSemVer(input.version)) return err({ kind: "invalid_version", version: input.version });
  if (!isSemVer(input.currentVersion)) {
    return err({ kind: "invalid_version", version: input.currentVersion });
  }
  const { fs } = ctx.deps;
  const { hooks, name } = input;
  const nameRoot = join(ctx.deps.historyRoot, name);
  const swapNew = join(nameRoot, SWAP_NEW);
  const swapOld = join(nameRoot, SWAP_OLD);

  // 1. 대상이 보관되어 있는지 본다. 없거나 깨졌으면 아무것도 바꾸지 않는다
  const target = await readEntry(fs, nameRoot, input.version);
  if (!target.ok) return err(target.error);
  if (target.value.kind === "skipped") return err({ kind: "not_found", version: input.version });
  const targetSchema = target.value.stored.meta.stateSchemaVersion;

  // 2. 상태 스키마 검사. 내려가는 마이그레이션은 없으므로 상태를 비우는 되돌리기만 허용한다
  const currentSchema = input.currentStateSchemaVersion;
  if (
    targetSchema !== null &&
    currentSchema !== null &&
    currentSchema > targetSchema &&
    input.clearState !== true
  ) {
    return err({
      kind: "state_schema_mismatch",
      targetSchemaVersion: targetSchema,
      currentSchemaVersion: currentSchema,
    });
  }

  // 3. 끊긴 되돌리기의 흔적을 치운다
  const cleaned = await clearLeftovers(fs, input.extensionDir, swapNew, swapOld);
  if (!cleaned.ok) return err({ kind: "io", cause: cleaned.error.cause });

  // 4. 끄기. 실패하면 파일을 건드리기 전이다
  const disabled = await attemptAsync(() => hooks.disable(name));
  if (!disabled.ok) return err({ kind: "disable_failed", cause: disabled.error.cause });

  // 5. 지금 설치본을 기록한다. 되돌리기도 다시 되돌릴 수 있어야 한다
  const recorded = await recordCurrent(ctx, input, nameRoot);
  if (!recorded.ok) {
    return abortSwap(hooks, name, {
      step: "record",
      cause: recorded.error,
      restored: true,
      followUps: [],
    });
  }

  // 6. 교체
  const swapped = await swapIn(
    fs,
    input.extensionDir,
    join(nameRoot, input.version, PAYLOAD_DIR),
    swapNew,
    swapOld,
  );
  if (!swapped.ok) return abortSwap(hooks, name, swapped.error);

  // 7. 상태 비우기, 켜기. 백업 삭제는 맨 뒤다. 삭제가 실패해도 되돌리기 결과는 같고 남은 백업은 다음 되돌리기가 지운다(§4.4.8)
  const clearState = input.clearState === true;
  if (clearState) {
    const cleared = await attemptAsync(() => hooks.clearState(name));
    if (!cleared.ok) return err({ kind: "clear_state_failed", cause: cleared.error.cause });
  }
  const enabled = await attemptAsync(() => hooks.enable(name));
  if (!enabled.ok) return err({ kind: "enable_failed", cause: enabled.error.cause });
  await attemptAsync(() => fs.removeDir(swapOld));
  return ok({
    appliesAt: input.hotReload === false ? "restart" : "nextStepBoundary",
    stateCleared: clearState,
  });
}

/**
 * 버전 기록 보관을 만든다(X.loading-trust.spec §3.11). 파일 접근, 시계, 해시는 호출자가 넘기고, 예상 가능한 실패는
 * 모두 `Result`의 오류 값으로 돌아온다. 보관 개수가 1 이상의 정수가 아니면 조립 결함이므로 `Bug`다
 */
export function createVersionHistory(deps: VersionHistoryDeps): VersionHistory {
  const keep = deps.keep ?? DEFAULT_KEEP;
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Bug(`version history keep must be an integer of at least 1, got ${keep}`);
  }
  const ctx: Ctx = { deps, keep };
  return {
    record: (input) => recordVersion(ctx, input),
    list: (name, currentVersion) => listVersions(ctx, name, currentVersion),
    rollback: (input) => rollbackVersion(ctx, input),
  };
}
