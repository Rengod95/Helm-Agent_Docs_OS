import type { Dirent, Stats } from "node:fs";
import { appendFile, lstat, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  attemptAsync,
  err,
  ok,
  parse,
  parseJson,
  type Logger,
  type Result,
} from "@fresnel/contracts";
import { isSemVer } from "@fresnel/contracts/capabilities";
import { ExtensionNameSchema } from "@fresnel/contracts/extensions";
import { Type } from "typebox";
import { sequentially } from "../../util.ts";
import { compareUtf8 } from "./content-hash.ts";
import { readPluginFolder } from "./folder-reader.ts";
import { promoteFolder, type PromotePlan } from "./promote.ts";
import type { PluginStore } from "./store.ts";

// 옮김 가운데 설치본의 이전 버전(`.history`)과 느슨한 스킬 폴더(M5c §7.4, §7.5). 시작 때 한 번 돈다.
// 둘 다 검토 항목을 거치지 않는다. 원본은 지우지 않는다. 결과는 `migration.log`에 한 줄씩 남긴다(`appendMigrationLog`).
// 설치본 자체의 옮김(`current`가 없는 설치 폴더)은 `release.ts`가 맡는다.

/** 이전 버전 보관 개수. `version-history.ts`의 기본 보관 개수(5)와 같다 */
const HISTORY_KEEP = 5;
const HISTORY_DIR = ".history";
const PAYLOAD_DIR = "dir";
const META_FILE = "meta.json";
const SKILL_FILE = "SKILL.md";

/** 옮김 결과 한 줄. `migrated`는 검토본에 들어간 것, `skipped`는 옮길 수 없는 이름 따위, `rejected`는 원본 문제로 거절한 것이다 */
export interface MigrationRecord {
  readonly step:
    | "installed"
    | "history"
    | "loose_skill"
    | "loose_skill_profile"
    | "project_review_key";
  readonly name: string;
  readonly outcome: "migrated" | "skipped" | "rejected";
  readonly contentHash: string | null;
  readonly reason: string | null;
}

/** 옮김 단계가 쌓는 결과. `reviewStartupPlugins`가 같은 묶음에 모은다 */
export interface MigrationTally {
  /** 검토본으로 옮긴 플러그인 이름(느슨한 스킬 폴더). `.history`의 이전 버전은 이름이 아니라 기록에만 남는다 */
  readonly migrated: string[];
  readonly diagnostics: {
    readonly name: string;
    readonly code: string;
    readonly message: string;
  }[];
  readonly records: MigrationRecord[];
}

interface MigrationEnv {
  readonly store: PluginStore;
  readonly logger: Logger;
  readonly now: () => string;
}

/** 검토본 키: 이름과 내용 해시. 기록의 `candidateHash`와 맞춘다 */
function keyOf(name: string, contentHash: string): string {
  return `${name} ${contentHash}`;
}

function codeOf(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return undefined;
  return typeof cause.code === "string" ? cause.code : undefined;
}

async function lstatOf(path: string): Promise<Stats | undefined> {
  const found = await attemptAsync(() => lstat(path));
  return found.ok ? found.value : undefined;
}

/** 폴더 항목 목록. 없는 폴더는 빈 목록이다. 다른 입출력 오류는 경고로 남기고 빈 목록을 준다 */
async function entriesOf(path: string, logger: Logger): Promise<readonly Dirent[]> {
  const listed = await attemptAsync(() => readdir(path, { withFileTypes: true }));
  if (listed.ok) return listed.value;
  if (codeOf(listed.error.cause) !== "ENOENT") {
    logger.warn("plugin.migration.list_failed", { code: codeOf(listed.error.cause) ?? "io" });
  }
  return [];
}

/** 이름과 해시 쌍이 `migrated`로 기록되어 있는 것들. 보관 정리로 지운 검토본을 다시 옮기지 않게 본다 */
async function migratedKeysOf(store: PluginStore, logger: Logger): Promise<Set<string>> {
  const log = await store.readLog();
  if (!log.ok) {
    logger.warn("plugin.migration.log_unreadable", { kind: log.error.kind });
    return new Set();
  }
  return new Set(
    log.value.flatMap((entry) =>
      entry.decision === "migrated" && entry.candidateHash !== null
        ? [keyOf(entry.name, entry.candidateHash)]
        : [],
    ),
  );
}

/** 현재 검토본의 해시와 보관 중인 검토본의 해시. 이것이 있으면 옮길 것이 없다 */
async function knownHashesOf(
  store: PluginStore,
  name: string,
): Promise<Result<Set<string>, string>> {
  const current = await store.current(name);
  if (!current.ok) return err(current.error.kind);
  const versions = await store.versions(name);
  if (!versions.ok) return err(versions.error.kind);
  const hashes = new Set(versions.value.map((row) => row.contentHash));
  if (current.value !== null) hashes.add(current.value.contentHash);
  return ok(hashes);
}

const HistoryMetaShape = Type.Object({
  version: Type.String(),
  installedAt: Type.String({ minLength: 1, maxLength: 40 }),
  source: Type.Union([Type.Literal("bundled"), Type.Literal("user"), Type.Literal("authored")]),
});

interface HistoryVersion {
  readonly version: string;
  readonly dir: string;
  readonly source: "bundled" | "user" | "authored";
  readonly installedAtMs: number;
}

/** `version-history.ts`가 쓴 `meta.json`을 읽는다. 없으면 `meta_missing`, 깨졌으면 `meta_invalid`다 */
async function readHistoryMeta(
  path: string,
): Promise<Result<Omit<HistoryVersion, "dir">, "meta_missing" | "meta_invalid">> {
  const text = await attemptAsync(() => readFile(path, "utf8"));
  if (!text.ok) {
    return err(codeOf(text.error.cause) === "ENOENT" ? "meta_missing" : "meta_invalid");
  }
  const json = parseJson(text.value);
  if (!json.ok) return err("meta_invalid");
  const meta = parse(HistoryMetaShape, json.value);
  if (!meta.ok) return err("meta_invalid");
  const installedAtMs = Date.parse(meta.value.installedAt);
  if (Number.isNaN(installedAtMs)) return err("meta_invalid");
  return ok({ version: meta.value.version, source: meta.value.source, installedAtMs });
}

/** 이름 폴더 하나의 보관 버전 가운데 메타가 읽히는 것. 버전 이름이 버전 형식이 아니면 버전으로 세지 않는다 */
async function historyVersionsOf(
  env: MigrationEnv,
  nameDir: string,
  name: string,
  into: MigrationTally,
): Promise<HistoryVersion[]> {
  const dirs = (await entriesOf(nameDir, env.logger))
    .filter((entry) => entry.isDirectory() && isSemVer(entry.name))
    .toSorted((a, b) => compareUtf8(a.name, b.name));
  // 메타 읽기는 서로 독립이라 함께 읽고, 결과는 버전 이름 순으로 돌아본다
  const metas = await Promise.all(
    dirs.map(async (dir) => ({
      dir: dir.name,
      meta: await readHistoryMeta(join(nameDir, dir.name, META_FILE)),
    })),
  );
  const found: HistoryVersion[] = [];
  for (const { dir, meta } of metas) {
    if (!meta.ok) {
      into.records.push({
        step: "history",
        name,
        outcome: meta.error === "meta_missing" ? "skipped" : "rejected",
        contentHash: null,
        reason: meta.error,
      });
      continue;
    }
    if (meta.value.version !== dir) {
      into.records.push({
        step: "history",
        name,
        outcome: "rejected",
        contentHash: null,
        reason: "version_mismatch",
      });
      continue;
    }
    found.push({ ...meta.value, dir: join(nameDir, dir) });
  }
  return found;
}

/** 옮긴 검토본의 `approvedAt`은 보관 기록의 설치 시각을 정규 ISO 문자열로 바꾼 값이다. 목록 정렬이 이 값을 쓴다 */
function approvedAtOf(version: HistoryVersion): string {
  return new Date(version.installedAtMs).toISOString();
}

/** 이전 버전 하나를 옮긴다. 해시나 원본 오류는 그 버전만 건너뛰고 진단을 남긴다 */
async function migrateHistoryVersion(
  env: MigrationEnv,
  name: string,
  version: HistoryVersion,
  known: Set<string>,
  migratedKeys: Set<string>,
  into: MigrationTally,
): Promise<void> {
  const payload = join(version.dir, PAYLOAD_DIR);
  const payloadStat = await lstatOf(payload);
  if (payloadStat?.isSymbolicLink()) {
    into.records.push({
      step: "history",
      name,
      outcome: "rejected",
      contentHash: null,
      reason: "symlink_refused",
    });
    into.diagnostics.push({
      name,
      code: "symlink_refused",
      message: `${name} ${version.version}: a symbolic link is not migrated`,
    });
    return;
  }
  if (payloadStat === undefined || !payloadStat.isDirectory()) {
    into.records.push({
      step: "history",
      name,
      outcome: "skipped",
      contentHash: null,
      reason: "payload_missing",
    });
    return;
  }
  const folder = readPluginFolder(payload, { origin: "user" });
  if (!folder.ok) {
    const detail = folder.error.diagnostics.map((item) => item.message).join("; ");
    into.records.push({
      step: "history",
      name,
      outcome: "rejected",
      contentHash: null,
      reason: folder.error.kind,
    });
    into.diagnostics.push({
      name,
      code: folder.error.kind,
      message: `${name} ${version.version}: not migrated (${detail || folder.error.kind})`,
    });
    return;
  }
  if (folder.value.name !== name) {
    into.records.push({
      step: "history",
      name,
      outcome: "rejected",
      contentHash: folder.value.contentHash,
      reason: "name_mismatch",
    });
    into.diagnostics.push({
      name,
      code: "name_mismatch",
      message: `${name} ${version.version}: the saved manifest names ${folder.value.name}`,
    });
    return;
  }
  const contentHash = folder.value.contentHash;
  // 이미 검토본에 있거나 전에 옮겨 졌던 것(보관 정리로 지운 뒤)은 다시 옮기지 않는다. 이것은 정상 상태라 기록하지 않는다
  if (known.has(contentHash) || migratedKeys.has(keyOf(name, contentHash))) return;
  const plan: PromotePlan = {
    name,
    origin: version.source === "bundled" ? "bundled" : "user",
    actor: "migration",
    decision: "migrated",
    kind: "migrated",
  };
  const promoted = await promoteFolder(
    env.store,
    payload,
    folder.value,
    plan,
    { approvedAt: approvedAtOf(version), logAt: env.now() },
    // 옮긴 이전 버전은 `current`가 되지 않는다(현재 설치본은 설치본 옮김이 맡는다)
    { current: false },
  );
  if (!promoted.ok) {
    into.records.push({
      step: "history",
      name,
      outcome: "rejected",
      contentHash,
      reason: promoted.error.code,
    });
    into.diagnostics.push({ name, code: promoted.error.code, message: promoted.error.message });
    return;
  }
  known.add(contentHash);
  migratedKeys.add(keyOf(name, contentHash));
  into.records.push({ step: "history", name, outcome: "migrated", contentHash, reason: null });
  if (!promoted.value.logged) {
    into.diagnostics.push({
      name,
      code: "log_failed",
      message: `${name} ${version.version}: the migration was not logged`,
    });
  }
}

/**
 * 설치본의 이전 버전을 검토본 저장소로 옮긴다(M5c §7.4 4번). 위치는 `<설치 폴더>/.history/<이름>/<버전>/`이다.
 * 최근 `HISTORY_KEEP`개의 `dir/`을 해시를 다시 계산해 `reviewed/<이름>/<해시>/`로 넣는다. `current`는 바꾸지 않는다.
 * 옮기기 전에 같은 해시가 `current`나 보관 목록에 있으면 건너뛴다(멱등).
 */
export async function migrateHistory(
  input: {
    readonly store: PluginStore;
    readonly installedDir: string;
    readonly logger: Logger;
    readonly now: () => string;
  },
  into: MigrationTally,
): Promise<void> {
  const env: MigrationEnv = { store: input.store, logger: input.logger, now: input.now };
  const historyDir = join(input.installedDir, HISTORY_DIR);
  const names = (await entriesOf(historyDir, input.logger))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .toSorted(compareUtf8);
  if (names.length === 0) return;
  const migratedKeys = await migratedKeysOf(input.store, input.logger);
  await sequentially(names, async (name) => {
    if (!parse(ExtensionNameSchema, name).ok) {
      into.records.push({
        step: "history",
        name,
        outcome: "skipped",
        contentHash: null,
        reason: "name_invalid",
      });
      into.diagnostics.push({
        name,
        code: "name_invalid",
        message: `${name}: the version history folder name is not a valid plugin name`,
      });
      return;
    }
    const nameDir = join(historyDir, name);
    const known = await knownHashesOf(input.store, name);
    if (!known.ok) {
      into.records.push({
        step: "history",
        name,
        outcome: "rejected",
        contentHash: null,
        reason: known.error,
      });
      into.diagnostics.push({
        name,
        code: known.error,
        message: `${name}: the reviewed store could not be read`,
      });
      return;
    }
    const versions = await historyVersionsOf(env, nameDir, name, into);
    const recent = versions
      .toSorted((a, b) => b.installedAtMs - a.installedAtMs || compareUtf8(b.version, a.version))
      .slice(0, HISTORY_KEEP);
    await sequentially(recent, (version) =>
      migrateHistoryVersion(env, name, version, known.value, migratedKeys, into),
    );
  });
}

/** 느슨한 스킬 폴더(`<OsDirs.data>/skills/<이름>/SKILL.md`)를 스킬 폴더 하나당 플러그인 하나로 옮긴다(M5c §7.5) */
export async function migrateLooseSkills(
  input: {
    readonly store: PluginStore;
    readonly looseDir: string;
    readonly installedDir: string;
    readonly userPluginsDir: string;
    readonly logger: Logger;
    readonly now: () => string;
  },
  into: MigrationTally,
): Promise<void> {
  const env: MigrationEnv = { store: input.store, logger: input.logger, now: input.now };
  const entries = (await entriesOf(input.looseDir, input.logger))
    .filter((entry) => !entry.name.startsWith("."))
    .toSorted((a, b) => compareUtf8(a.name, b.name));
  if (entries.length === 0) return;
  const migratedKeys = await migratedKeysOf(input.store, input.logger);
  await sequentially(entries, (entry) => migrateLooseSkill(env, input, entry, migratedKeys, into));
}

async function migrateLooseSkill(
  env: MigrationEnv,
  input: {
    readonly installedDir: string;
    readonly userPluginsDir: string;
    readonly looseDir: string;
  },
  entry: Dirent,
  migratedKeys: Set<string>,
  into: MigrationTally,
): Promise<void> {
  const dir = join(input.looseDir, entry.name);
  const target = entry.isSymbolicLink() ? await attemptAsync(() => stat(dir)) : undefined;
  const isFolder = entry.isSymbolicLink()
    ? target?.ok === true && target.value.isDirectory()
    : entry.isDirectory();
  const skillFile = await lstatOf(join(dir, SKILL_FILE));
  // 스킬 폴더가 아니면 조용히 건너뛴다(단일 `.md` 파일, `SKILL.md`가 없는 폴더)
  if (!isFolder || skillFile === undefined || !skillFile.isFile()) return;
  const name = entry.name;
  if (entry.isSymbolicLink()) {
    into.records.push({
      step: "loose_skill",
      name,
      outcome: "rejected",
      contentHash: null,
      reason: "symlink_refused",
    });
    into.diagnostics.push({
      name,
      code: "symlink_refused",
      message: `${name}: a symbolic link is not migrated`,
    });
    return;
  }
  if (!parse(ExtensionNameSchema, name).ok) {
    into.records.push({
      step: "loose_skill",
      name,
      outcome: "skipped",
      contentHash: null,
      reason: "name_invalid",
    });
    into.diagnostics.push({
      name,
      code: "name_invalid",
      message: `${name}: the skill folder name is not a valid plugin name`,
    });
    return;
  }
  // 검토본이 있거나 같은 이름의 원본 폴더(사용자 플러그인 또는 설치본)가 있으면 건너뛴다
  const current = await env.store.current(name);
  if (!current.ok) {
    into.records.push({
      step: "loose_skill",
      name,
      outcome: "rejected",
      contentHash: null,
      reason: current.error.kind,
    });
    into.diagnostics.push({
      name,
      code: current.error.kind,
      message: `${name}: the store could not be read`,
    });
    return;
  }
  if (current.value !== null) return;
  if (
    (await lstatOf(join(input.userPluginsDir, name))) !== undefined ||
    (await lstatOf(join(input.installedDir, name))) !== undefined
  ) {
    return;
  }
  const folder = readPluginFolder(dir, { origin: "user" });
  if (!folder.ok) {
    const detail = folder.error.diagnostics.map((item) => item.message).join("; ");
    into.records.push({
      step: "loose_skill",
      name,
      outcome: "rejected",
      contentHash: null,
      reason: folder.error.kind,
    });
    into.diagnostics.push({
      name,
      code: folder.error.kind,
      message: `${name}: not migrated (${detail || folder.error.kind})`,
    });
    return;
  }
  const contentHash = folder.value.contentHash;
  if (migratedKeys.has(keyOf(name, contentHash))) return;
  const plan: PromotePlan = {
    name,
    origin: "user",
    actor: "migration",
    decision: "migrated",
    kind: "migrated",
  };
  const promoted = await promoteFolder(
    env.store,
    dir,
    folder.value,
    plan,
    { approvedAt: env.now(), logAt: env.now() },
    { current: true },
  );
  if (!promoted.ok) {
    into.records.push({
      step: "loose_skill",
      name,
      outcome: "rejected",
      contentHash,
      reason: promoted.error.code,
    });
    into.diagnostics.push({ name, code: promoted.error.code, message: promoted.error.message });
    return;
  }
  migratedKeys.add(keyOf(name, contentHash));
  into.migrated.push(name);
  into.records.push({ step: "loose_skill", name, outcome: "migrated", contentHash, reason: null });
  if (!promoted.value.logged) {
    into.diagnostics.push({
      name,
      code: "log_failed",
      message: `${name}: the migration was not logged`,
    });
  }
}

/** `migration.log` 한 줄 가운데 옮김 결과의 칸. 프로필 옮김 줄은 이 모양이 아니라 건너뛴다 */
const LogLineShape = Type.Object({
  step: Type.String(),
  name: Type.String(),
  outcome: Type.String(),
  contentHash: Type.Union([Type.String(), Type.Null()]),
  reason: Type.Union([Type.String(), Type.Null()]),
});
/** `migration.log`의 옮김 결과 한 줄(모양 검사를 통과한 값) */
export interface MigrationLogLine {
  readonly step: string;
  readonly name: string;
  readonly outcome: string;
  readonly contentHash: string | null;
  readonly reason: string | null;
}

/**
 * `migration.log`의 옮김 결과 줄들. 파일이 없으면 빈 목록이다. 읽지 못하면 `undefined`다.
 * 옮김 결과 모양이 아닌 줄(프로필 옮김 줄 따위)은 건너뛴다
 */
export async function readMigrationLines(
  path: string,
  logger: Logger,
): Promise<readonly MigrationLogLine[] | undefined> {
  const text = await attemptAsync(() => readFile(path, "utf8"));
  if (!text.ok) {
    if (codeOf(text.error.cause) === "ENOENT") return [];
    logger.error("plugin.migration.log_unreadable", { code: codeOf(text.error.cause) ?? "io" });
    return undefined;
  }
  const lines: MigrationLogLine[] = [];
  for (const line of text.value.split("\n")) {
    if (line.length === 0) continue;
    const json = parseJson(line);
    if (!json.ok) continue;
    const shaped = parse(LogLineShape, json.value);
    if (shaped.ok) lines.push(shaped.value);
  }
  return lines;
}

/** 기록 한 줄이 같은 줄인지 가리는 키. 시각은 빼고 결과 내용만 본다 */
function lineKeyOf(line: MigrationLogLine): string {
  return JSON.stringify([line.step, line.name, line.outcome, line.contentHash, line.reason]);
}

/** 이미 적힌 줄의 키. 파일이 없으면 빈 집합이다. 읽지 못하면 `undefined`(적지 않는다) */
async function seenLinesOf(path: string, logger: Logger): Promise<Set<string> | undefined> {
  const lines = await readMigrationLines(path, logger);
  if (lines === undefined) return undefined;
  return new Set(lines.map(lineKeyOf));
}

/**
 * 옮김 결과를 `migration.log`(호스트 상태 폴더)에 덧붙인다. 프로필 옮김과 같은 파일, 같은 줄 모양(JSON 한 줄, `at` 먼저)이다.
 * 같은 결과가 이미 적혀 있으면 다시 적지 않는다. 두 번째 시작에 새로 옮긴 것이 없으면 아무것도 쓰지 않는다.
 */
export async function appendMigrationLog(
  path: string,
  records: readonly MigrationRecord[],
  at: string,
  logger: Logger,
): Promise<void> {
  if (records.length === 0) return;
  const seen = await seenLinesOf(path, logger);
  if (seen === undefined) return;
  const fresh: MigrationRecord[] = [];
  for (const record of records) {
    const key = lineKeyOf(record);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(record);
  }
  if (fresh.length === 0) return;
  const text = fresh.map((record) => `${JSON.stringify({ at, ...record })}\n`).join("");
  const written = await attemptAsync(async () => {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, text);
  });
  if (!written.ok) {
    logger.error("plugin.migration.log_failed", { code: codeOf(written.error.cause) ?? "io" });
  }
}
