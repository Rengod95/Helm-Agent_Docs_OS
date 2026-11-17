import type { Dirent } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { attemptAsync, type Logger } from "@fresnel/contracts";
import { sequentially } from "../../util.ts";
import { compareUtf8 } from "./content-hash.ts";
import { readPluginFolder } from "./folder-reader.ts";
import {
  appendMigrationLog,
  migrateHistory,
  migrateLooseSkills,
  type MigrationRecord,
} from "./migrate.ts";
import { promoteFolder, type PromotePlan } from "./promote.ts";
import type { PluginStore } from "./store.ts";

// 시작 때 검토본 저장소에 넣는 것(M5c §7.4, §7.5). 검토 항목을 거치지 않는다.
// - 번들(`bundled`): 릴리스가 든 기본 플러그인 폴더를 `actor: "release"`로 넣는다. 앱 업데이트가 신뢰 근거다.
// - 설치된 사용자 플러그인(`<configDir>/extensions/<name>`): 현재 내용을 `actor: "migration"`으로 넣는다. 원본 폴더는 지우지 않는다.
//   `current`가 없는 이름만 맡는다. 설치 폴더의 `.history`와 느슨한 스킬 폴더는 `migrate.ts`가 맡는다.
// 모두 멱등이다. 같은 해시가 이미 current면 아무것도 하지 않는다. 결과는 `migration.log`에 남는다(옮김 결과만).

const MANIFEST_PATH = join(".fresnel-plugin", "plugin.json");

export interface StartupPluginInput {
  readonly store: PluginStore;
  /** 번들 뿌리(`defaultPluginsDir()`). 아래 `<name>/`이 번들 플러그인이다 */
  readonly bundleDir: string;
  /** 번들로 넣을 이름(`defaultPluginNamesFor`) */
  readonly bundledNames: readonly string[];
  /** `<configDir>/extensions`. 설치된 사용자 플러그인과 그 `.history`가 있는 곳 */
  readonly installedDir: string;
  /** `<configDir>/plugins`. 느슨한 스킬 폴더와 같은 이름이면 옮기지 않는다 */
  readonly userPluginsDir: string;
  /** 느슨한 사용자 스킬 루트(`<OsDirs.data>/skills`). 스킬 폴더 하나가 플러그인 하나다 */
  readonly looseSkillsDir: string;
  /** `migration.log`(호스트 상태 폴더). 옮김 결과를 한 줄씩 덧붙인다 */
  readonly migrationLogPath: string;
  readonly logger: Logger;
  /** 승인 시각(ISO). 호출자가 시계를 준다 */
  readonly now: () => string;
}

interface StartupPluginDiagnostic {
  readonly name: string;
  readonly code: string;
  readonly message: string;
}

export interface StartupPluginReport {
  /** 번들을 새로 넣은 이름(처음이나 번들 갱신) */
  readonly released: readonly string[];
  /** 설치된 사용자 플러그인이나 느슨한 스킬 폴더를 옮긴 이름 */
  readonly migrated: readonly string[];
  /** 이미 검토본이 있어 건드리지 않은 이름 */
  readonly kept: readonly string[];
  /** 건너뛴 플러그인과 이유. 로그에도 남는다 */
  readonly diagnostics: readonly StartupPluginDiagnostic[];
}

/** 코드가 있는 폴더(매니페스트가 있다)인가. 없으면 검토본 대상이 아니다 */
async function hasManifest(dir: string): Promise<boolean> {
  const found = await attemptAsync(() => lstat(join(dir, MANIFEST_PATH)));
  return found.ok && found.value.isFile();
}

/** 결과를 쌓는 가변 묶음. 돌려줄 때 읽기 전용 타입으로 준다 */
interface Build {
  readonly released: string[];
  readonly migrated: string[];
  readonly kept: string[];
  readonly diagnostics: StartupPluginDiagnostic[];
  readonly records: MigrationRecord[];
}

/** 번들 폴더 하나. 같은 해시가 current면 건너뛴다. 사용자 쪽 검토본이 이름을 쥐고 있으면 번들은 진단과 함께 물러난다 */
async function releaseOne(input: StartupPluginInput, name: string, into: Build): Promise<void> {
  const dir = join(input.bundleDir, name);
  if (!(await hasManifest(dir))) return;
  const bundled = readPluginFolder(dir, { origin: "bundled" });
  if (!bundled.ok) {
    into.diagnostics.push({
      name,
      code: bundled.error.kind,
      message: `${name}: the bundle could not be read`,
    });
    return;
  }
  const current = await input.store.current(name);
  if (!current.ok) {
    into.diagnostics.push({
      name,
      code: current.error.kind,
      message: `${name}: the store could not be read`,
    });
    return;
  }
  if (current.value !== null && current.value.contentHash === bundled.value.contentHash) {
    into.kept.push(name);
    return;
  }
  if (current.value !== null && current.value.meta.origin !== "bundled") {
    // 사용자 쪽 검토본이 이름을 쥐고 있다. 번들은 물러나고 진단으로 남는다(M5c §10 17번 기본값)
    into.kept.push(name);
    into.diagnostics.push({
      name,
      code: "name_conflict",
      message: `${name}: a reviewed user copy holds the name; the bundled copy is not released`,
    });
    return;
  }
  const plan: PromotePlan = {
    name,
    origin: "bundled",
    actor: "release",
    decision: "bundled",
    kind: "bundled",
  };
  const now = input.now();
  const result = await promoteFolder(
    input.store,
    dir,
    bundled.value,
    plan,
    { approvedAt: now, logAt: now },
    { current: true },
  );
  if (!result.ok) {
    into.diagnostics.push({ name, code: result.error.code, message: result.error.message });
    return;
  }
  into.released.push(name);
  if (!result.value.logged) {
    into.diagnostics.push({
      name,
      code: "log_failed",
      message: `${name}: the release was not logged`,
    });
  }
}

/**
 * 설치된 사용자 플러그인을 옮긴다. 검토본이 이미 있는 이름은 건드리지 않는다. 원본이 그 뒤에 바뀌었다면 검토 항목이 맡는다
 * (M5c §4.7.1). 심볼릭 링크와 읽기 오류는 그 플러그인만 건너뛴다
 */
async function migrateInstalled(input: StartupPluginInput, into: Build): Promise<void> {
  const listed = await attemptAsync(() => readdir(input.installedDir, { withFileTypes: true }));
  if (!listed.ok) return;
  const entries = listed.value.toSorted((a, b) => compareUtf8(a.name, b.name));
  await sequentially(entries, (entry) => migrateOne(input, entry, into));
}

/** 설치된 폴더 하나를 옮긴다. 건너뛸 때는 진단을 남기고 돌아온다 */
async function migrateOne(input: StartupPluginInput, entry: Dirent, into: Build): Promise<void> {
  if (entry.name.startsWith(".")) return;
  const dir = join(input.installedDir, entry.name);
  if (entry.isSymbolicLink()) {
    into.diagnostics.push({
      name: entry.name,
      code: "symlink_refused",
      message: `${entry.name}: a symbolic link is not migrated`,
    });
    into.records.push({
      step: "installed",
      name: entry.name,
      outcome: "rejected",
      contentHash: null,
      reason: "symlink_refused",
    });
    return;
  }
  if (!entry.isDirectory() || !(await hasManifest(dir))) return;
  const folder = readPluginFolder(dir, { origin: "user" });
  if (!folder.ok) {
    into.diagnostics.push({
      name: entry.name,
      code: folder.error.kind,
      message: `${entry.name}: not migrated (${folder.error.kind})`,
    });
    into.records.push({
      step: "installed",
      name: entry.name,
      outcome: "rejected",
      contentHash: null,
      reason: folder.error.kind,
    });
    return;
  }
  const name = folder.value.name;
  const current = await input.store.current(name);
  if (!current.ok) {
    into.diagnostics.push({
      name,
      code: current.error.kind,
      message: `${name}: the store could not be read`,
    });
    return;
  }
  // 검토본이 있으면 이미 옮긴 것이다(정상 상태라 기록하지 않는다)
  if (current.value !== null) {
    into.kept.push(name);
    return;
  }
  const now = input.now();
  const result = await promoteFolder(
    input.store,
    dir,
    folder.value,
    { name, origin: "user", actor: "migration", decision: "migrated", kind: "migrated" },
    { approvedAt: now, logAt: now },
    { current: true },
  );
  if (!result.ok) {
    into.diagnostics.push({ name, code: result.error.code, message: result.error.message });
    into.records.push({
      step: "installed",
      name,
      outcome: "rejected",
      contentHash: folder.value.contentHash,
      reason: result.error.code,
    });
    return;
  }
  into.migrated.push(name);
  into.records.push({
    step: "installed",
    name,
    outcome: "migrated",
    contentHash: folder.value.contentHash,
    reason: null,
  });
  if (!result.value.logged) {
    into.diagnostics.push({
      name,
      code: "log_failed",
      message: `${name}: the migration was not logged`,
    });
  }
}

/**
 * 시작 때 한 번: 번들을 넣고(릴리스), 설치된 사용자 플러그인을 옮기고(옮김), 이전 버전과 느슨한 스킬 폴더를 옮긴다.
 * 번들을 먼저 넣으므로 같은 이름의 설치본이 번들과 같은 해시면 옮김이 건너뛴다. 건너뛴 이유는 돌려주고 로그에도 남긴다.
 * 옮김 결과는 `migration.log`에 한 줄씩 적는다. 같은 줄이 이미 있으면 다시 적지 않는다
 */
export async function reviewStartupPlugins(
  input: StartupPluginInput,
): Promise<StartupPluginReport> {
  const into: Build = { released: [], migrated: [], kept: [], diagnostics: [], records: [] };
  await sequentially(input.bundledNames, (name) => releaseOne(input, name, into));
  await migrateInstalled(input, into);
  const tally = { migrated: into.migrated, diagnostics: into.diagnostics, records: into.records };
  await migrateHistory(
    { store: input.store, installedDir: input.installedDir, logger: input.logger, now: input.now },
    tally,
  );
  await migrateLooseSkills(
    {
      store: input.store,
      looseDir: input.looseSkillsDir,
      installedDir: input.installedDir,
      userPluginsDir: input.userPluginsDir,
      logger: input.logger,
      now: input.now,
    },
    tally,
  );
  for (const item of into.diagnostics) {
    input.logger.warn("plugin.startup.skipped", {
      name: item.name,
      code: item.code,
      message: item.message,
    });
  }
  await appendMigrationLog(input.migrationLogPath, into.records, input.now(), input.logger);
  // 한 이름이 번들과 설치본 양쪽에서 물러날 수 있다. 보고는 이름당 한 번이다
  return {
    released: into.released,
    migrated: into.migrated,
    kept: [...new Set(into.kept)],
    diagnostics: into.diagnostics,
  };
}
