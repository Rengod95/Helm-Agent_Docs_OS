import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { attemptAsync, err, ok, parseJson, type Clock, type Result } from "@fresnel/contracts";
import type { LocalIdFactory, ThreadId, ThreadStatus } from "@fresnel/contracts/conversation";
import type { SessionService } from "@fresnel/contracts/records";
import type { SettingCatalog } from "@fresnel/contracts/settings";
import type { FileLock } from "@fresnel/platform-os";
import { fileReadOfText, readSettingsFile } from "../settings-engine.ts";
import { replaceFileAtomically } from "../trust.ts";
import { isLegacyEnabledKey, legacyInputsFromUser, type LegacyInputs } from "./profile-migrate.ts";
import { createProfileStore, type FirstStartProfileOutcome } from "./profile-store.ts";
import type { ScopeRoot } from "./project-scope.ts";

// 첫 시작 옮김 한 번(M5c §7). 호스트가 자리를 잡은 뒤 한 번 돌고 `migration.log`에 표지를 남긴다. 표지가 있으면 아무것도 하지 않는다.
// 순서가 중요하다: (1) 사용자 설정 파일의 값을 읽는다 → (2) 그 값으로 `profiles.json`을 옮긴다(§7.2·§7.3)
// → (3) 옮김이 성공했을 때만 사용자 설정의 `ext.<이름>.enabled`를 `settings.json.pre-profile` 백업 뒤에 지운다(§7.1)
// → (4) 저장소 파일(project·local)의 옛 키를 한 번 진단한다 → (5) 대화 폴더의 암묵 프로젝트를 만든다(§7.6).
// 항목 하나가 실패해도 나머지는 계속한다. 실패가 하나라도 있으면 표지를 쓰지 않아 다음 시작에 다시 본다.
// 원본 파일은 지우지 않는다(백업과 `.v1.bak`만 남긴다).

/** 옮김이 보는 대화 한 개. Test run 대화는 프로젝트 묶음에서 뺀다(§4.8) */
export interface MigrationThread {
  /** 정규 작업 폴더. 없으면 null이다 */
  readonly workspace: string | null;
  readonly status: ThreadStatus;
  /** Test run 대화인가 */
  readonly testRun: boolean;
}

/** 옮김 기록 파일 이름(호스트 상태 폴더 아래) */
export const MIGRATION_LOG_NAME = "migration.log";
/** 사용자 설정 파일을 지우기 전의 백업 이름(같은 폴더, §7.1). 이미 있으면 덮지 않는다 */
export const PRE_PROFILE_BACKUP_NAME = "settings.json.pre-profile";

const FIRST_START_STEP = "first_start";

type LogEntry = Readonly<Record<string, unknown>>;

export interface FirstStartMigrationDeps {
  /** 사용자 설정 폴더(`profiles.json`, `projects.json`이 놓인다) */
  readonly configDir: string;
  /** 호스트 상태 폴더(`migration.log`가 놓인다) */
  readonly stateDir: string;
  /** 사용자 설정 파일의 절대 경로(`settings.json`) */
  readonly settingsPath: string;
  readonly fileLock: FileLock;
  readonly clock: Clock;
  readonly signal: AbortSignal;
  readonly ids: LocalIdFactory;
  readonly catalog: SettingCatalog;
  /** 공장 기본 프로필의 플러그인 이름(코어 포함 가능, 옮김이 뺀다) */
  readonly factoryPlugins: () => readonly string[];
  /** 코어 이름. 옮김이 기본 목록과 사용자 값에서 뺀다 */
  readonly coreNames: () => readonly string[];
  /** 대화 목록(닫힌 것 포함). 프로젝트와 진단의 원천이다 */
  readonly threads: () => readonly MigrationThread[];
  /** 현재 루트 목록(명시 프로젝트와 암묵 기본 폴더). 읽기 실패는 실패 항목이 된다 */
  readonly roots: () => Promise<Result<readonly ScopeRoot[], { readonly kind: string }>>;
  /** 사용자 설정 파일을 메모리 층에 다시 읽힌다(지운 뒤) */
  readonly refreshUserSettings: () => Promise<void>;
}

export interface FirstStartReport {
  /** 이번 시작에 실제로 돌았는가. 표지가 이미 있으면 false */
  readonly ran: boolean;
  /** 실패한 항목. `항목:사유` 형식이다. 빈 배열이면 모두 끝났다 */
  readonly failures: readonly string[];
}

function errorCode(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

function isLogEntry(value: unknown): value is LogEntry {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 옮김 기록을 읽는다. 없으면 빈 목록이다. JSON이 아닌 줄은 건너뛴다(기록은 추가만 하고 고치지 않는다) */
async function readLog(path: string): Promise<Result<readonly LogEntry[], string>> {
  const read = await attemptAsync(() => readFile(path, "utf8"));
  if (!read.ok) {
    const code = errorCode(read.error.cause);
    return code === "ENOENT" ? ok([]) : err(code);
  }
  const entries: LogEntry[] = [];
  for (const line of read.value.split("\n")) {
    if (line.trim() === "") continue;
    const json = parseJson(line);
    if (json.ok && isLogEntry(json.value)) entries.push(json.value);
  }
  return ok(entries);
}

/** 옮김 기록에 줄을 덧붙인다. 줄마다 `at`을 붙인다 */
async function appendLog(
  path: string,
  clock: Clock,
  entries: readonly LogEntry[],
): Promise<Result<void, string>> {
  const at = new Date(clock.now()).toISOString();
  const text = entries.map((entry) => `${JSON.stringify({ at, ...entry })}\n`).join("");
  const written = await attemptAsync(async () => {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, text);
  });
  return written.ok ? ok(undefined) : err(errorCode(written.error.cause));
}

/** 사용자 설정 파일에서 옮김 뒤 지운 결과 */
type SettingsMove =
  | { readonly kind: "none" }
  | { readonly kind: "moved"; readonly removed: number; readonly backupCreated: boolean };

/**
 * 사용자 설정 파일의 `ext.<이름>.enabled`를 지운다(§7.1). 잠금 안에서 다시 읽고, 원문을 백업(`wx`, 있으면 덮지 않는다)한 뒤
 * 나머지 키를 쓴다. 쓰는 형식은 설정 쓰기(`settings-store.ts`의 `writeKey`)와 같다: 들여쓰기 2칸, 끝 줄바꿈 하나, 키 순서 유지.
 */
async function moveUserEnabledKeys(
  settingsPath: string,
  lock: FileLock,
  signal: AbortSignal,
): Promise<Result<SettingsMove, string>> {
  const backupPath = join(dirname(settingsPath), PRE_PROFILE_BACKUP_NAME);
  const locked = await lock.withLock(
    settingsPath,
    async (): Promise<Result<SettingsMove, string>> => {
      const read = await attemptAsync(() => readFile(settingsPath, "utf8"));
      if (!read.ok) {
        const code = errorCode(read.error.cause);
        return code === "ENOENT" ? ok({ kind: "none" }) : err(`read:${code}`);
      }
      const text = read.value;
      if (text.trim() === "") return ok({ kind: "none" });
      const parsed = fileReadOfText(text);
      if (parsed.kind !== "ok") return err(`settings_${parsed.kind}`);
      const keys = [...parsed.values.keys()].filter(isLegacyEnabledKey);
      if (keys.length === 0) return ok({ kind: "none" });
      const backup = await attemptAsync(() => writeFile(backupPath, text, { flag: "wx" }));
      if (!backup.ok && errorCode(backup.error.cause) !== "EEXIST") {
        return err(`backup:${errorCode(backup.error.cause)}`);
      }
      const next = new Map(parsed.values);
      for (const key of keys) next.delete(key);
      const replaced = await attemptAsync(() =>
        replaceFileAtomically(
          settingsPath,
          `${JSON.stringify(Object.fromEntries(next), null, 2)}\n`,
          `${String(process.pid)}-first-start`,
        ),
      );
      if (!replaced.ok) return err(`write:${errorCode(replaced.error.cause)}`);
      return ok({ kind: "moved", removed: keys.length, backupCreated: backup.ok });
    },
    { signal },
  );
  if (!locked.ok) return err(`lock:${locked.error.kind}`);
  return locked.value;
}

/** 프로필 옮김(§7.2·§7.3). 옛 목록이면 옮기고 기본 행이 없으면 더한다. 실패는 사유 코드로 돌려준다 */
async function moveProfiles(
  deps: FirstStartMigrationDeps,
  inputs: LegacyInputs,
): Promise<Result<FirstStartProfileOutcome, string>> {
  const store = createProfileStore({
    path: join(deps.configDir, "profiles.json"),
    migrationLogPath: join(deps.stateDir, MIGRATION_LOG_NAME),
    fileLock: deps.fileLock,
    clock: deps.clock,
    signal: deps.signal,
    legacy: () => inputs,
  });
  const done = await store.migrateFirstStart(inputs);
  return done.ok ? ok(done.value) : err(done.error.kind);
}

/** 저장소 파일의 진단 대상. 신뢰 판정 전이라도 읽는 것은 키 이름만이다(값은 쓰지 않는다) */
const REPOSITORY_FILES: readonly { readonly scope: "project" | "local"; readonly file: string }[] =
  [
    { scope: "project", file: "settings.json" },
    { scope: "local", file: "settings.local.json" },
  ];

/**
 * 저장소 파일(project·local)에 남은 `ext.<이름>.enabled`를 한 번 진단한다(§7.1). 파일은 지우지 않고 값도 쓰지 않는다.
 * 이미 기록한 파일 경로는 다시 적지 않는다. 파일이 없거나 JSON이 아니면 진단하지 않는다.
 */
async function projectDiagnostics(
  folders: readonly string[],
  alreadyLogged: ReadonlySet<string>,
): Promise<readonly LogEntry[]> {
  const targets = folders.flatMap((folder) =>
    REPOSITORY_FILES.map((target) => ({
      scope: target.scope,
      path: join(folder, ".fresnel", target.file),
    })),
  );
  const reads = await Promise.all(
    targets
      .filter((target) => !alreadyLogged.has(target.path))
      .map(async (target) => ({
        scope: target.scope,
        path: target.path,
        read: await readSettingsFile(target.path),
      })),
  );
  const entries: LogEntry[] = [];
  for (const item of reads) {
    if (item.read.kind !== "ok") continue;
    const keys = [...item.read.values.keys()].filter(isLegacyEnabledKey);
    if (keys.length === 0) continue;
    entries.push({
      step: "legacy_enabled_key_ignored",
      scope: item.scope,
      file: item.path,
      keys: keys.length,
    });
  }
  return entries;
}

/** 대화 목록을 읽는다(닫힌 것 포함). Test run 표지는 호출자가 준 함수로 본다 */
export function threadRowsOf(
  session: Pick<SessionService, "threads">,
  isTestRun: (threadId: ThreadId) => boolean,
): readonly MigrationThread[] {
  const rows: MigrationThread[] = [];
  let cursor: string | undefined;
  do {
    const page = session.threads.list({
      includeClosed: true,
      includeCraft: true,
      limit: 200,
      ...(cursor === undefined ? {} : { cursor }),
    });
    for (const row of page.threads) {
      rows.push({
        workspace: row.workspace ?? null,
        status: row.status,
        testRun: isTestRun(row.threadId),
      });
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return rows;
}

/** 첫 시작 옮김을 돌린다. 표지가 있으면 아무 일도 하지 않는다 */
export async function runFirstStartMigration(
  deps: FirstStartMigrationDeps,
): Promise<FirstStartReport> {
  const logPath = join(deps.stateDir, MIGRATION_LOG_NAME);
  const existing = await readLog(logPath);
  if (!existing.ok) return { ran: false, failures: [`migration_log:${existing.error}`] };
  if (existing.value.some((entry) => entry.step === FIRST_START_STEP && entry.status === "done")) {
    return { ran: false, failures: [] };
  }

  const failures: string[] = [];
  const note = async (entries: readonly LogEntry[]): Promise<void> => {
    if (entries.length === 0) return;
    const written = await appendLog(logPath, deps.clock, entries);
    if (!written.ok) failures.push(`migration_log:${written.error}`);
  };
  const fail = async (item: string, reason: string): Promise<void> => {
    failures.push(`${item}:${reason}`);
    await note([{ step: "failed", item, reason }]);
  };

  // (1)~(3) 사용자 설정 파일과 프로필. 두 값은 같은 읽기에서 나온다
  const probe = await readSettingsFile(deps.settingsPath);
  if (probe.kind === "ok") {
    const inputs = legacyInputsFromUser({
      values: probe.values,
      defaultEnabled: deps.factoryPlugins(),
      coreNames: new Set(deps.coreNames()),
      profileAllows: (key) => deps.catalog.get(key)?.allowedScopes.includes("profile") === true,
    });
    const profiles = await moveProfiles(deps, inputs);
    if (!profiles.ok) {
      await fail("profiles", profiles.error);
    } else {
      // 옮김이 끝난 뒤에만 지운다. 옮김이 실패하면 사용자 값이 남아 다음 시작에 다시 옮긴다
      const moved = await moveUserEnabledKeys(deps.settingsPath, deps.fileLock, deps.signal);
      if (!moved.ok) {
        await fail("user_enabled", moved.error);
      } else if (moved.value.kind === "moved") {
        await note([
          {
            step: "user_enabled_moved",
            removed: moved.value.removed,
            backup: PRE_PROFILE_BACKUP_NAME,
            backupCreated: moved.value.backupCreated,
          },
        ]);
        await deps.refreshUserSettings();
      }
    }
  } else {
    const reason = probe.kind === "invalid" ? probe.reason : `unreadable:${probe.code}`;
    await fail("settings", reason);
  }

  // (4)~(5) 대화 폴더와 루트. 루트를 읽지 못하면 두 항목 모두 실패로 남는다
  const threads = deps.threads();
  const roots = await deps.roots();
  if (!roots.ok) {
    await fail("projects", roots.error.kind);
  }
  const folders = [
    ...new Set([
      ...threads.flatMap((thread) => (thread.workspace === null ? [] : [thread.workspace])),
      ...(roots.ok ? roots.value.map((root) => root.root) : []),
    ]),
  ].toSorted();
  const alreadyLogged = new Set(
    existing.value.flatMap((entry) =>
      entry.step === "legacy_enabled_key_ignored" && typeof entry.file === "string"
        ? [entry.file]
        : [],
    ),
  );
  await note(await projectDiagnostics(folders, alreadyLogged));

  // 옛 대화의 작업 폴더로 프로젝트를 저절로 만들지 않는다(프로젝트는 사용자가 만들 때만 생긴다, §4.4.3). 이미 만들어진 프로젝트는 그대로 둔다 [결정: 2026-11-22 사용자]

  if (failures.length === 0) await note([{ step: FIRST_START_STEP, status: "done" }]);
  return { ran: true, failures };
}
