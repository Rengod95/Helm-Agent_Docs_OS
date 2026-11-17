import { afterAll, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok, type Result } from "@fresnel/contracts";
import { createLocalIdFactory, systemRandom, type FileLock } from "@fresnel/platform-os";
import { buildEngineCatalog } from "../../src/assembly/catalog.ts";
import { createSettingsEngine } from "../../src/assembly/settings-engine.ts";
import {
  MIGRATION_LOG_NAME,
  PRE_PROFILE_BACKUP_NAME,
  runFirstStartMigration,
  type FirstStartMigrationDeps,
} from "../../src/assembly/m4/first-start-migration.ts";
import type { MigrationThread } from "../../src/assembly/m4/implicit-project-migrate.ts";
import type { ScopeRoot } from "../../src/assembly/m4/project-scope.ts";
import { createProjectStore } from "../../src/assembly/m4/project-store.ts";

// M5c §7.1, §7.2, §7.3, §7.6와 §8 수용 37. 임시 폴더 위의 실제 파일을 쓰고, 값을 비교한다. 사용자 폴더는 건드리지 않는다.

const roots: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xh-first-start-"));
  roots.push(dir);
  // macOS의 임시 폴더는 심볼릭 링크 아래에 있으므로 정규 경로로 비교한다
  return realpathSync(dir);
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const NOW_MS = Date.parse("2026-01-05T00:00:00.000Z");
const SIGNAL = new AbortController().signal;
const clock = { now: () => NOW_MS };
// 파일 잠금 대역: 잠금은 항상 얻는다(한 프로세스 시험)
const fileLock: FileLock = {
  scope: "process",
  withLock: async (_path, fn) => ok(await fn()),
  updateText: () => Promise.reject(new Error("updateText is not part of this test")),
};
const built = buildEngineCatalog();
if (!built.ok) throw new Error("the core catalog must build");
const catalog = built.catalog;

interface Layout {
  readonly root: string;
  readonly configDir: string;
  readonly stateDir: string;
  readonly dataDir: string;
  readonly settingsPath: string;
  readonly logPath: string;
  readonly profilesPath: string;
  readonly projectsPath: string;
}

function layoutOf(root: string): Layout {
  const configDir = join(root, "config");
  const stateDir = join(root, "state");
  mkdirSync(configDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  return {
    root,
    configDir,
    stateDir,
    dataDir: join(root, "data"),
    settingsPath: join(configDir, "settings.json"),
    logPath: join(stateDir, MIGRATION_LOG_NAME),
    profilesPath: join(configDir, "profiles.json"),
    projectsPath: join(configDir, "projects.json"),
  };
}

/** 프로젝트 목록과 기본 폴더 루트를 합친 루트 목록(포트의 `roots()`와 같은 모양) */
async function rootsOf(layout: Layout): Promise<Result<readonly ScopeRoot[], { kind: string }>> {
  const store = createProjectStore({
    path: layout.projectsPath,
    fileLock,
    clock,
    signal: SIGNAL,
  });
  const snapshot = await store.read();
  if (!snapshot.ok) return err({ kind: snapshot.error.kind });
  return ok([
    ...snapshot.value.projects.map((project) => ({
      projectId: project.projectId,
      root: project.root,
      name: project.name,
    })),
    { projectId: "prj_default", root: join(layout.dataDir, "default-project"), name: null },
  ]);
}

function depsOf(
  layout: Layout,
  threads: readonly MigrationThread[],
  onRefresh: () => void = () => undefined,
): FirstStartMigrationDeps {
  return {
    configDir: layout.configDir,
    stateDir: layout.stateDir,
    settingsPath: layout.settingsPath,
    fileLock,
    clock,
    signal: SIGNAL,
    ids: createLocalIdFactory(clock, systemRandom()),
    catalog,
    factoryPlugins: () => ["helm", "lint"],
    coreNames: () => ["core-tools"],
    threads: () => threads,
    roots: () => rootsOf(layout),
    refreshUserSettings: async () => {
      onRefresh();
    },
  };
}

function idle(workspace: string | null): MigrationThread {
  return { workspace, status: "idle", testRun: false };
}

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

/** 로그 줄을 값으로 읽는다. 빈 줄은 없다 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function logOf(layout: Layout): Readonly<Record<string, unknown>>[] {
  if (!existsSync(layout.logPath)) return [];
  return readText(layout.logPath)
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line): unknown => JSON.parse(line))
    .filter(isRecord);
}

function stepsOf(layout: Layout, step: string): Readonly<Record<string, unknown>>[] {
  return logOf(layout).filter((entry) => entry["step"] === step);
}

/** 사용자 설정 원문 */
const USER_SETTINGS = JSON.stringify(
  {
    "ext.helm.enabled": false,
    "ext.notes.enabled": true,
    "ext.core-tools.enabled": false,
    "l1.tools.permissionMode": "acceptEdits",
    "l1.loop.maxSteps": 7,
  },
  null,
  2,
);

test("the user's enabled values move into default, the keys leave settings.json behind a backup, and the other keys stay", async () => {
  const layout = layoutOf(tempDir());
  writeFileSync(layout.settingsPath, USER_SETTINGS);
  let refreshed = 0;
  const report = await runFirstStartMigration(depsOf(layout, [], () => (refreshed += 1)));

  expect(report).toEqual({ ran: true, failures: [] });
  expect(refreshed).toBe(1);
  // 기본 = 값이 없는 기본 설치(lint) ∪ 값이 참인 것(notes). helm은 값이 거짓이고 core-tools는 코어라 빠진다
  expect(JSON.parse(readText(layout.profilesPath))).toMatchObject({
    schemaVersion: 2,
    common: { plugins: [], settings: [] },
    profiles: [
      {
        id: "default",
        builtin: true,
        plugins: [{ name: "lint" }, { name: "notes" }],
        settings: [{ key: "l1.tools.permissionMode", value: "acceptEdits" }],
      },
    ],
  });
  expect(JSON.parse(readText(layout.settingsPath))).toEqual({
    "l1.tools.permissionMode": "acceptEdits",
    "l1.loop.maxSteps": 7,
  });
  expect(readText(join(layout.configDir, PRE_PROFILE_BACKUP_NAME))).toBe(USER_SETTINGS);
  expect(stepsOf(layout, "user_enabled_moved")).toMatchObject([
    { removed: 3, backupCreated: true },
  ]);
  expect(stepsOf(layout, "default_added")).toMatchObject([{ profileId: "default", plugins: 2 }]);
  expect(stepsOf(layout, "first_start")).toEqual([
    { at: new Date(NOW_MS).toISOString(), step: "first_start", status: "done" },
  ]);
});

test("a second start changes nothing: every file keeps its bytes and the run reports ran false", async () => {
  const layout = layoutOf(tempDir());
  writeFileSync(layout.settingsPath, USER_SETTINGS);
  await runFirstStartMigration(depsOf(layout, [idle(null)]));
  const files = [layout.profilesPath, layout.settingsPath, layout.logPath];
  const before = files.map(readText);
  const backupBefore = readText(join(layout.configDir, PRE_PROFILE_BACKUP_NAME));
  let refreshed = 0;

  const again = await runFirstStartMigration(depsOf(layout, [idle(null)], () => (refreshed += 1)));

  expect(again).toEqual({ ran: false, failures: [] });
  expect(files.map(readText)).toEqual(before);
  expect(readText(join(layout.configDir, PRE_PROFILE_BACKUP_NAME))).toBe(backupBefore);
  expect(refreshed).toBe(0);
});

test("an existing settings.json.pre-profile is never overwritten, and the keys are still removed", async () => {
  const layout = layoutOf(tempDir());
  writeFileSync(layout.settingsPath, USER_SETTINGS);
  const backup = join(layout.configDir, PRE_PROFILE_BACKUP_NAME);
  writeFileSync(backup, "EARLIER BACKUP");

  const report = await runFirstStartMigration(depsOf(layout, []));

  expect(report).toEqual({ ran: true, failures: [] });
  expect(readText(backup)).toBe("EARLIER BACKUP");
  expect(JSON.parse(readText(layout.settingsPath))).toEqual({
    "l1.tools.permissionMode": "acceptEdits",
    "l1.loop.maxSteps": 7,
  });
  expect(stepsOf(layout, "user_enabled_moved")).toMatchObject([{ backupCreated: false }]);
});

test("the permission mode carried into default is the one the engine reads: a retired plan becomes default, an unknown value falls back to bypass", async () => {
  const retired = layoutOf(tempDir());
  writeFileSync(
    retired.settingsPath,
    JSON.stringify({ "ext.notes.enabled": true, "l1.tools.permissionMode": "plan" }),
  );
  await runFirstStartMigration(depsOf(retired, []));
  expect(JSON.parse(readText(retired.profilesPath))).toMatchObject({
    profiles: [{ id: "default", settings: [{ key: "l1.tools.permissionMode", value: "default" }] }],
  });

  const unknown = layoutOf(tempDir());
  writeFileSync(
    unknown.settingsPath,
    JSON.stringify({ "ext.notes.enabled": true, "l1.tools.permissionMode": 5 }),
  );
  await runFirstStartMigration(depsOf(unknown, []));
  expect(JSON.parse(readText(unknown.profilesPath))).toMatchObject({
    profiles: [{ id: "default", settings: [{ key: "l1.tools.permissionMode", value: "bypass" }] }],
  });
});

test("a v1 profile and the user's values give the expected plugin sets: default ∪ enable − disable", async () => {
  const layout = layoutOf(tempDir());
  const v1 = JSON.stringify(
    {
      schemaVersion: 1,
      profiles: [
        {
          id: "review",
          title: "Review",
          enable: ["extra"],
          disable: ["lint"],
          settings: [{ key: "ext.notes.enabled", value: false }],
          driver: null,
          updatedAt: "2025-12-01T00:00:00.000Z",
          rev: 4,
        },
      ],
    },
    null,
    2,
  );
  writeFileSync(layout.profilesPath, v1);
  writeFileSync(
    layout.settingsPath,
    JSON.stringify({ "ext.notes.enabled": true, "ext.helm.enabled": false }),
  );

  const report = await runFirstStartMigration(depsOf(layout, []));

  expect(report).toEqual({ ran: true, failures: [] });
  // default 옮김 결과: 값이 없는 lint, 참인 notes. helm은 값이 거짓이라 빠진다.
  // review: default ∪ enable(extra) − disable(lint) = notes, extra
  expect(JSON.parse(readText(layout.profilesPath))).toMatchObject({
    profiles: [
      { id: "default", plugins: [{ name: "lint" }, { name: "notes" }] },
      { id: "review", plugins: [{ name: "notes" }, { name: "extra" }], driver: null },
    ],
  });
  // v1 원문은 백업으로 남는다. 옮김 기록에 버린 ext 키 한 개가 적힌다
  expect(readText(join(layout.configDir, "profiles.json.v1.bak"))).toBe(v1);
  expect(stepsOf(layout, "first_start")).toHaveLength(1);
  expect(logOf(layout).filter((entry) => entry["profileId"] === "review")).toMatchObject([
    { plugins: 2, droppedEnabledKeys: 1 },
  ]);
  expect(JSON.parse(readText(layout.settingsPath))).toEqual({});
});

test("project and local files with the old key get one diagnostic per file, the files stay as they are, and a later run adds nothing", async () => {
  const layout = layoutOf(tempDir());
  const dirA = join(layout.root, "work", "a");
  const dirB = join(layout.root, "work", "b");
  mkdirSync(join(dirA, ".fresnel"), { recursive: true });
  mkdirSync(join(dirB, ".fresnel"), { recursive: true });
  const projectA = join(dirA, ".fresnel", "settings.json");
  const localA = join(dirA, ".fresnel", "settings.local.json");
  const projectB = join(dirB, ".fresnel", "settings.json");
  writeFileSync(projectA, JSON.stringify({ "ext.notes.enabled": true, "l1.loop.maxSteps": 3 }));
  writeFileSync(localA, JSON.stringify({ "ext.lint.enabled": false }));
  writeFileSync(projectB, JSON.stringify({ "l1.loop.maxSteps": 2 }));
  const files = [projectA, localA, projectB];
  const before = files.map(readText);

  // 같은 폴더가 두 대화에 있어도 진단은 파일마다 한 번이다
  const threads = [idle(dirA), idle(dirA), idle(dirB)];
  await runFirstStartMigration(depsOf(layout, threads));

  const diagnostics = stepsOf(layout, "legacy_enabled_key_ignored");
  expect(diagnostics.map((entry) => [entry["scope"], entry["file"], entry["keys"]])).toEqual([
    ["project", projectA, 1],
    ["local", localA, 1],
  ]);
  expect(files.map(readText)).toEqual(before);

  // 표지가 있으면 다시 쓰지 않는다
  await runFirstStartMigration(depsOf(layout, threads));
  expect(stepsOf(layout, "legacy_enabled_key_ignored")).toHaveLength(2);
});

test("a diagnostic already in migration.log is not written again when the first start was not completed", async () => {
  const layout = layoutOf(tempDir());
  const dirA = join(layout.root, "work", "a");
  mkdirSync(join(dirA, ".fresnel"), { recursive: true });
  const projectA = join(dirA, ".fresnel", "settings.json");
  writeFileSync(projectA, JSON.stringify({ "ext.notes.enabled": true }));
  const earlier = JSON.stringify({
    at: new Date(NOW_MS).toISOString(),
    step: "legacy_enabled_key_ignored",
    scope: "project",
    file: projectA,
    keys: 1,
  });
  writeFileSync(layout.logPath, `${earlier}\n`);

  const report = await runFirstStartMigration(depsOf(layout, [idle(dirA)]));

  expect(report).toEqual({ ran: true, failures: [] });
  expect(stepsOf(layout, "legacy_enabled_key_ignored")).toHaveLength(1);
});

test("a corrupt profiles.json fails only the profile item: settings keep their keys, the projects are still made, and no completion mark is written", async () => {
  const layout = layoutOf(tempDir());
  writeFileSync(layout.settingsPath, USER_SETTINGS);
  writeFileSync(layout.profilesPath, "this is not json");
  const dirA = join(layout.root, "work", "a");
  mkdirSync(dirA, { recursive: true });

  const first = await runFirstStartMigration(depsOf(layout, [idle(dirA)]));

  expect(first).toEqual({ ran: true, failures: ["profiles:corrupt"] });
  expect(JSON.parse(readText(layout.settingsPath))).toEqual(JSON.parse(USER_SETTINGS));
  expect(existsSync(join(layout.configDir, PRE_PROFILE_BACKUP_NAME))).toBe(false);
  expect(readText(layout.profilesPath)).toBe("this is not json");
  expect(stepsOf(layout, "first_start")).toEqual([]);
  expect(stepsOf(layout, "implicit_project")).toMatchObject([{ root: dirA }]);

  // 다음 시작에도 실패는 그대로 남고, 프로젝트는 두 번 만들어지지 않는다
  const projectsBefore = readText(layout.projectsPath);
  const second = await runFirstStartMigration(depsOf(layout, [idle(dirA)]));
  expect(second).toEqual({ ran: true, failures: ["profiles:corrupt"] });
  expect(readText(layout.projectsPath)).toBe(projectsBefore);
});

test("an unreadable settings.json skips the profile move and the key removal, records the reason, and keeps the file", async () => {
  const layout = layoutOf(tempDir());
  const broken = '{ "ext.notes.enabled": true, ';
  writeFileSync(layout.settingsPath, broken);
  const dirA = join(layout.root, "work", "a");
  mkdirSync(dirA, { recursive: true });

  const report = await runFirstStartMigration(depsOf(layout, [idle(dirA)]));

  expect(report).toEqual({ ran: true, failures: ["settings:invalid_json"] });
  expect(readText(layout.settingsPath)).toBe(broken);
  expect(existsSync(layout.profilesPath)).toBe(false);
  expect(existsSync(join(layout.configDir, PRE_PROFILE_BACKUP_NAME))).toBe(false);
  expect(stepsOf(layout, "implicit_project")).toHaveLength(1);
});

test("a leftover ext key after the move is only an unknown key: it blocks neither the next start nor the settings load", async () => {
  const layout = layoutOf(tempDir());
  writeFileSync(layout.settingsPath, USER_SETTINGS);
  await runFirstStartMigration(depsOf(layout, []));
  // 사용자가 다시 손으로 넣은 옛 키. 카탈로그에 없어서 알 수 없는 키다
  writeFileSync(
    layout.settingsPath,
    JSON.stringify({ "l1.tools.permissionMode": "acceptEdits", "ext.gone.enabled": true }),
  );

  const again = await runFirstStartMigration(depsOf(layout, []));
  expect(again).toEqual({ ran: false, failures: [] });
  expect(JSON.parse(readText(layout.settingsPath))).toEqual({
    "l1.tools.permissionMode": "acceptEdits",
    "ext.gone.enabled": true,
  });

  const engine = createSettingsEngine(catalog);
  await engine.loadUserFile(layout.settingsPath);
  expect(engine.userProblem()).toBeUndefined();
  expect(engine.diagnostics).toEqual([]);
  expect(engine.value("l1.tools.permissionMode")).toBe("acceptEdits");
  expect(engine.value("ext.gone.enabled")).toBeUndefined();
});
