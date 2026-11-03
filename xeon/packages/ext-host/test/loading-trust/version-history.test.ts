import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Bug } from "@fresnel/contracts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import {
  createVersionHistory,
  type RecordVersionInput,
  type RollbackHooks,
  type VersionHistory,
  type VersionHistoryDeps,
  type VersionSource,
} from "../../src/loading-trust/index.ts";
import {
  memoryVersionFs,
  type FsFault,
  type MemoryVersionFs,
} from "./support/memory-version-fs.ts";

const NAME = "helm";
const EXT = "/user/extensions/helm";
const ROOT = "/user/extensions/.history";
const NAME_ROOT = join(ROOT, NAME);

/** 호출마다 1초씩 가는 주입 시계. `rewindTo`로 다음 설치 시각을 과거로 돌린다 */
function clock(): { now(): number; rewindTo(seconds: number): void } {
  let last = 0;
  return {
    now() {
      last += 1000;
      return last;
    },
    rewindTo(seconds) {
      last = seconds * 1000 - 1000;
    },
  };
}

/** 매니페스트 해시는 본문을 감싼 문자열이다. 기대값을 읽기 쉽게 한다 */
function hash(text: string): string {
  return `hash(${text})`;
}

function setup(keep?: number): {
  fs: MemoryVersionFs;
  history: VersionHistory;
  time: ReturnType<typeof clock>;
} {
  const fs = memoryVersionFs();
  const time = clock();
  const deps: VersionHistoryDeps = { fs, historyRoot: ROOT, now: () => time.now(), hash };
  return {
    fs,
    time,
    history: createVersionHistory(keep === undefined ? deps : { ...deps, keep }),
  };
}

/** 기록 입력. 매니페스트 본문은 `m<버전>`이고 출처는 번들이다 */
function input(
  version: string,
  overrides: {
    readonly source?: VersionSource;
    readonly manifestText?: string;
    readonly stateSchemaVersion?: number | null;
  } = {},
): RecordVersionInput {
  return {
    name: NAME,
    version,
    source: "bundled",
    extensionDir: EXT,
    manifestText: `m${version}`,
    stateSchemaVersion: null,
    ...overrides,
  };
}

/** 설치 위치의 내용을 바꾼다. 매니페스트 파일도 함께 둔다(되돌리기가 현재 매니페스트를 읽는다) */
async function installVersion(
  fs: MemoryVersionFs,
  version: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  await fs.removeDir(EXT);
  await fs.writeText(join(EXT, ".fresnel-plugin", "plugin.json"), `m${version}`);
  await Promise.all(
    Object.entries(files).map(([relative, text]) => fs.writeText(join(EXT, relative), text)),
  );
}

type HookName = keyof RollbackHooks;

/** 호출 순서를 기록하는 훅. `failing`에 든 훅은 그 오류로 거부한다 */
function hooksOf(failing: Partial<Record<HookName, Error>> = {}): {
  hooks: RollbackHooks;
  calls: string[];
} {
  const calls: string[] = [];
  const call =
    (hook: HookName) =>
    (name: string): Promise<void> => {
      calls.push(`${hook} ${name}`);
      const failure = failing[hook];
      return failure === undefined ? Promise.resolve() : Promise.reject(failure);
    };
  return {
    calls,
    hooks: { disable: call("disable"), enable: call("enable"), clearState: call("clearState") },
  };
}

/** 손으로 쓴 메타 텍스트. 설치 시각은 고정이다 */
function metaText(version: string): string {
  return JSON.stringify({
    version,
    installedAt: "1970-01-01T00:00:05.000Z",
    source: "bundled",
    manifestHash: "hash(x)",
    stateSchemaVersion: null,
  });
}

/** 목록에서 버전 이름만 뽑는다. 실패면 null */
function versionNames(
  result: Awaited<ReturnType<VersionHistory["list"]>>,
): readonly string[] | null {
  return result.ok ? result.value.versions.map((entry) => entry.version) : null;
}

test("record and list show the newest first and mark the installed version", async () => {
  const { fs, history } = setup();
  await installVersion(fs, "1.0.0", { "dist/index.js": "v1" });
  expect(await history.record(input("1.0.0", { stateSchemaVersion: 1 }))).toEqual({
    ok: true,
    value: { pruned: [], pruneFailure: null },
  });
  await installVersion(fs, "1.1.0", { "dist/index.js": "v2" });
  expect(await history.record(input("1.1.0", { source: "user", stateSchemaVersion: 2 }))).toEqual({
    ok: true,
    value: { pruned: [], pruneFailure: null },
  });
  expect(await history.record(input("1.2.0", { source: "authored" }))).toEqual({
    ok: true,
    value: { pruned: [], pruneFailure: null },
  });
  expect(await history.list(NAME, "1.1.0")).toEqual({
    ok: true,
    value: {
      versions: [
        {
          version: "1.2.0",
          installedAt: "1970-01-01T00:00:03.000Z",
          source: "authored",
          manifestHash: "hash(m1.2.0)",
          stateSchemaVersion: null,
          current: false,
        },
        {
          version: "1.1.0",
          installedAt: "1970-01-01T00:00:02.000Z",
          source: "user",
          manifestHash: "hash(m1.1.0)",
          stateSchemaVersion: 2,
          current: true,
        },
        {
          version: "1.0.0",
          installedAt: "1970-01-01T00:00:01.000Z",
          source: "bundled",
          manifestHash: "hash(m1.0.0)",
          stateSchemaVersion: 1,
          current: false,
        },
      ],
      skipped: [],
    },
  });
  expect(fs.filesUnder(join(NAME_ROOT, "1.0.0", "dir"))).toEqual({
    "dist/index.js": "v1",
    ".fresnel-plugin/plugin.json": "m1.0.0",
  });
  expect(await history.list("helm2", "1.0.0")).toEqual({
    ok: true,
    value: { versions: [], skipped: [] },
  });
});

test("recording the same version again replaces its files and its stamp", async () => {
  const { fs, history } = setup();
  await installVersion(fs, "1.0.0", { "dist/index.js": "v1", "old.txt": "old" });
  await history.record(input("1.0.0"));
  await installVersion(fs, "1.0.0", { "dist/index.js": "v1b", "new.txt": "new" });
  expect(await history.record(input("1.0.0", { manifestText: "m1b" }))).toEqual({
    ok: true,
    value: { pruned: [], pruneFailure: null },
  });
  expect(fs.filesUnder(join(NAME_ROOT, "1.0.0", "dir"))).toEqual({
    "dist/index.js": "v1b",
    "new.txt": "new",
    ".fresnel-plugin/plugin.json": "m1.0.0",
  });
  expect(await history.list(NAME, "0.0.0")).toEqual({
    ok: true,
    value: {
      versions: [
        {
          version: "1.0.0",
          installedAt: "1970-01-01T00:00:02.000Z",
          source: "bundled",
          manifestHash: "hash(m1b)",
          stateSchemaVersion: null,
          current: false,
        },
      ],
      skipped: [],
    },
  });
  expect(await fs.exists(join(NAME_ROOT, ".1.0.0.old"))).toBe(false);
});

test("pruning keeps the newest five and reports what it removed", async () => {
  const { fs, history } = setup();
  await installVersion(fs, "1.0.5", { "dist/index.js": "v" });
  const pruned: (readonly string[] | null)[] = [];
  await eachInOrder(["1.0.0", "1.0.1", "1.0.2", "1.0.3", "1.0.4", "1.0.5"], async (version) => {
    const recorded = await history.record(input(version));
    pruned.push(recorded.ok ? recorded.value.pruned : null);
    return "continue";
  });
  expect(pruned).toEqual([[], [], [], [], [], ["1.0.0"]]);
  expect(versionNames(await history.list(NAME, "1.0.5"))).toEqual([
    "1.0.5",
    "1.0.4",
    "1.0.3",
    "1.0.2",
    "1.0.1",
  ]);
  expect(await fs.exists(join(NAME_ROOT, "1.0.0"))).toBe(false);
});

test("the version being recorded is not pruned even when it is the oldest", async () => {
  const { fs, history, time } = setup();
  await installVersion(fs, "0.9.0", { "dist/index.js": "v" });
  await eachInOrder(["1.0.0", "1.0.1", "1.0.2", "1.0.3", "1.0.4"], async (version) => {
    await history.record(input(version));
    return "continue";
  });
  time.rewindTo(0);
  expect(await history.record(input("0.9.0"))).toEqual({
    ok: true,
    value: { pruned: [], pruneFailure: null },
  });
  expect(versionNames(await history.list(NAME, "0.9.0"))).toEqual([
    "1.0.4",
    "1.0.3",
    "1.0.2",
    "1.0.1",
    "1.0.0",
    "0.9.0",
  ]);
});

test("unsafe extension names and version strings are rejected before anything is written", async () => {
  const { fs, history } = setup();
  await installVersion(fs, "1.0.0", { "dist/index.js": "v1" });
  expect([
    await history.record(input("../evil")),
    await history.record(input("1.0")),
    await history.record(input("1.0.0/../x")),
    await history.record({ ...input("1.0.0"), name: "../x" }),
    await history.record({ ...input("1.0.0"), name: "a/b" }),
    await history.record({ ...input("1.0.0"), name: "h" }),
  ]).toEqual([
    { ok: false, error: { kind: "invalid_version", version: "../evil" } },
    { ok: false, error: { kind: "invalid_version", version: "1.0" } },
    { ok: false, error: { kind: "invalid_version", version: "1.0.0/../x" } },
    { ok: false, error: { kind: "invalid_name", name: "../x" } },
    { ok: false, error: { kind: "invalid_name", name: "a/b" } },
    { ok: false, error: { kind: "invalid_name", name: "h" } },
  ]);
  expect(fs.filesUnder(ROOT)).toEqual({});
  expect(await history.list("../x", "1.0.0")).toEqual({
    ok: false,
    error: { kind: "invalid_name", name: "../x" },
  });
});

test("unreadable and inconsistent entries are skipped and reported in version order", async () => {
  const { fs, history } = setup();
  await installVersion(fs, "1.0.0", { "dist/index.js": "v1" });
  await history.record(input("1.0.0"));
  await history.record(input("1.1.0"));
  // 1.1.0: 메타가 JSON이 아니다
  await fs.writeText(join(NAME_ROOT, "1.1.0", "meta.json"), "{ broken");
  // 1.2.0: 메타가 없다
  await fs.writeText(join(NAME_ROOT, "1.2.0", "dir", "x.txt"), "x");
  // 1.3.0: 메타는 있는데 복사본이 없다
  await fs.writeText(join(NAME_ROOT, "1.3.0", "meta.json"), metaText("1.3.0"));
  // 1.4.0: 메타가 다른 버전을 가리킨다
  await fs.writeText(join(NAME_ROOT, "1.4.0", "dir", "x.txt"), "x");
  await fs.writeText(join(NAME_ROOT, "1.4.0", "meta.json"), metaText("1.5.0"));
  // 1.6.0: JSON이지만 형식이 맞지 않는다
  await fs.writeText(join(NAME_ROOT, "1.6.0", "dir", "x.txt"), "x");
  await fs.writeText(join(NAME_ROOT, "1.6.0", "meta.json"), '{"version":"1.6.0"}');
  // 버전 형식이 아닌 임시 디렉터리는 버전으로 세지 않는다
  await fs.writeText(join(NAME_ROOT, ".1.9.0.new", "dir", "x.txt"), "x");
  expect(await history.list(NAME, "1.0.0")).toEqual({
    ok: true,
    value: {
      versions: [
        {
          version: "1.0.0",
          installedAt: "1970-01-01T00:00:01.000Z",
          source: "bundled",
          manifestHash: "hash(m1.0.0)",
          stateSchemaVersion: null,
          current: true,
        },
      ],
      skipped: [
        { version: "1.6.0", reason: "meta_invalid" },
        { version: "1.4.0", reason: "version_mismatch" },
        { version: "1.3.0", reason: "dir_missing" },
        { version: "1.2.0", reason: "meta_missing" },
        { version: "1.1.0", reason: "meta_not_json" },
      ],
    },
  });
});

test("rollback restores the exact files of the target and keeps the current install in history", async () => {
  const { fs, history } = setup();
  const { hooks, calls } = hooksOf();
  await installVersion(fs, "1.0.0", { "dist/index.js": "v1", "assets/icon.txt": "icon v1" });
  await history.record(input("1.0.0"));
  await installVersion(fs, "1.1.0", { "dist/index.js": "v2", "new.txt": "only in v2" });
  await history.record(input("1.1.0"));
  expect(
    await history.rollback({
      name: NAME,
      version: "1.0.0",
      extensionDir: EXT,
      currentVersion: "1.1.0",
      currentStateSchemaVersion: null,
      hooks,
    }),
  ).toEqual({ ok: true, value: { appliesAt: "nextStepBoundary", stateCleared: false } });
  expect(calls).toEqual(["disable helm", "enable helm"]);
  expect(fs.filesUnder(EXT)).toEqual({
    "dist/index.js": "v1",
    "assets/icon.txt": "icon v1",
    ".fresnel-plugin/plugin.json": "m1.0.0",
  });
  expect(await history.list(NAME, "1.0.0")).toEqual({
    ok: true,
    value: {
      versions: [
        {
          version: "1.1.0",
          installedAt: "1970-01-01T00:00:03.000Z",
          source: "bundled",
          manifestHash: "hash(m1.1.0)",
          stateSchemaVersion: null,
          current: false,
        },
        {
          version: "1.0.0",
          installedAt: "1970-01-01T00:00:01.000Z",
          source: "bundled",
          manifestHash: "hash(m1.0.0)",
          stateSchemaVersion: null,
          current: true,
        },
      ],
      skipped: [],
    },
  });
  // 되돌린 뒤 다시 앞으로 간다
  expect(
    await history.rollback({
      name: NAME,
      version: "1.1.0",
      extensionDir: EXT,
      currentVersion: "1.0.0",
      currentStateSchemaVersion: null,
      hooks,
    }),
  ).toEqual({ ok: true, value: { appliesAt: "nextStepBoundary", stateCleared: false } });
  expect(fs.filesUnder(EXT)).toEqual({
    "dist/index.js": "v2",
    "new.txt": "only in v2",
    ".fresnel-plugin/plugin.json": "m1.1.0",
  });
  expect(calls).toEqual(["disable helm", "enable helm", "disable helm", "enable helm"]);
});

test("a lower target state schema is refused until the state is cleared", async () => {
  const { fs, history } = setup();
  const { hooks, calls } = hooksOf();
  await installVersion(fs, "1.0.0", { "dist/index.js": "v1" });
  await history.record(input("1.0.0", { stateSchemaVersion: 1 }));
  await installVersion(fs, "1.1.0", { "dist/index.js": "v2" });
  await history.record(input("1.1.0", { stateSchemaVersion: 2 }));
  expect(
    await history.rollback({
      name: NAME,
      version: "1.0.0",
      extensionDir: EXT,
      currentVersion: "1.1.0",
      currentStateSchemaVersion: 2,
      hooks,
    }),
  ).toEqual({
    ok: false,
    error: { kind: "state_schema_mismatch", targetSchemaVersion: 1, currentSchemaVersion: 2 },
  });
  expect(calls).toEqual([]);
  expect(fs.filesUnder(EXT)).toEqual({
    "dist/index.js": "v2",
    ".fresnel-plugin/plugin.json": "m1.1.0",
  });
  expect(
    await history.rollback({
      name: NAME,
      version: "1.0.0",
      clearState: true,
      extensionDir: EXT,
      currentVersion: "1.1.0",
      currentStateSchemaVersion: 2,
      hooks,
    }),
  ).toEqual({ ok: true, value: { appliesAt: "nextStepBoundary", stateCleared: true } });
  expect(calls).toEqual(["disable helm", "clearState helm", "enable helm"]);
  expect(fs.filesUnder(EXT)).toEqual({
    "dist/index.js": "v1",
    ".fresnel-plugin/plugin.json": "m1.0.0",
  });
});

test("without hot reload the rollback applies on the next start", async () => {
  const { fs, history } = setup();
  const { hooks } = hooksOf();
  await installVersion(fs, "1.0.0", { "dist/index.js": "v1" });
  await history.record(input("1.0.0"));
  await installVersion(fs, "1.1.0", { "dist/index.js": "v2" });
  expect(
    await history.rollback({
      name: NAME,
      version: "1.0.0",
      extensionDir: EXT,
      currentVersion: "1.1.0",
      currentStateSchemaVersion: null,
      hotReload: false,
      hooks,
    }),
  ).toEqual({ ok: true, value: { appliesAt: "restart", stateCleared: false } });
});

test("a version that is not kept is refused before anything is disabled", async () => {
  const { fs, history } = setup();
  const { hooks, calls } = hooksOf();
  await installVersion(fs, "1.1.0", { "dist/index.js": "v2" });
  expect(
    await history.rollback({
      name: NAME,
      version: "9.9.9",
      extensionDir: EXT,
      currentVersion: "1.1.0",
      currentStateSchemaVersion: null,
      hooks,
    }),
  ).toEqual({ ok: false, error: { kind: "not_found", version: "9.9.9" } });
  expect(calls).toEqual([]);
  expect(fs.filesUnder(EXT)).toEqual({
    "dist/index.js": "v2",
    ".fresnel-plugin/plugin.json": "m1.1.0",
  });
});

test("a failed swap restores the original directory and turns the extension back on", async () => {
  const { fs, history } = setup();
  const { hooks, calls } = hooksOf();
  await installVersion(fs, "1.0.0", { "dist/index.js": "v1" });
  await history.record(input("1.0.0"));
  await installVersion(fs, "1.1.0", { "dist/index.js": "v2" });
  const injected = new Error("rename failed");
  const fault: FsFault = (op, path) =>
    op === "renameDir" && path === join(NAME_ROOT, ".swap.new") ? injected : undefined;
  fs.setFault(fault);
  expect(
    await history.rollback({
      name: NAME,
      version: "1.0.0",
      extensionDir: EXT,
      currentVersion: "1.1.0",
      currentStateSchemaVersion: null,
      hooks,
    }),
  ).toEqual({
    ok: false,
    error: {
      kind: "swap_failed",
      step: "place",
      cause: injected,
      restored: true,
      reenabled: true,
      followUps: [],
    },
  });
  expect(calls).toEqual(["disable helm", "enable helm"]);
  expect(fs.filesUnder(EXT)).toEqual({
    "dist/index.js": "v2",
    ".fresnel-plugin/plugin.json": "m1.1.0",
  });
  expect(await fs.exists(join(NAME_ROOT, ".swap.old"))).toBe(false);
  expect(await fs.exists(join(NAME_ROOT, ".swap.new"))).toBe(false);
});

test("a failed copy of the target leaves the installed directory untouched", async () => {
  const { fs, history } = setup();
  const { hooks, calls } = hooksOf();
  await installVersion(fs, "1.0.0", { "dist/index.js": "v1" });
  await history.record(input("1.0.0"));
  await installVersion(fs, "1.1.0", { "dist/index.js": "v2" });
  const injected = new Error("disk full");
  fs.setFault((op, path) =>
    op === "copyDir" && path === join(NAME_ROOT, "1.0.0", "dir") ? injected : undefined,
  );
  expect(
    await history.rollback({
      name: NAME,
      version: "1.0.0",
      extensionDir: EXT,
      currentVersion: "1.1.0",
      currentStateSchemaVersion: null,
      hooks,
    }),
  ).toEqual({
    ok: false,
    error: {
      kind: "swap_failed",
      step: "stage",
      cause: injected,
      restored: true,
      reenabled: true,
      followUps: [],
    },
  });
  expect(calls).toEqual(["disable helm", "enable helm"]);
  expect(fs.filesUnder(EXT)).toEqual({
    "dist/index.js": "v2",
    ".fresnel-plugin/plugin.json": "m1.1.0",
  });
});

test("a failed record of the current install re-enables and changes nothing", async () => {
  const { fs, history } = setup();
  const { hooks, calls } = hooksOf();
  await installVersion(fs, "1.0.0", { "dist/index.js": "v1" });
  await history.record(input("1.0.0"));
  await installVersion(fs, "1.1.0", { "dist/index.js": "v2" });
  const injected = new Error("disk full");
  fs.setFault((op, path) =>
    op === "writeText" && path === join(NAME_ROOT, ".1.1.0.new", "meta.json")
      ? injected
      : undefined,
  );
  expect(
    await history.rollback({
      name: NAME,
      version: "1.0.0",
      extensionDir: EXT,
      currentVersion: "1.1.0",
      currentStateSchemaVersion: null,
      hooks,
    }),
  ).toEqual({
    ok: false,
    error: {
      kind: "swap_failed",
      step: "record",
      cause: { kind: "io", cause: injected },
      restored: true,
      reenabled: true,
      followUps: [],
    },
  });
  expect(calls).toEqual(["disable helm", "enable helm"]);
  expect(fs.filesUnder(EXT)).toEqual({
    "dist/index.js": "v2",
    ".fresnel-plugin/plugin.json": "m1.1.0",
  });
  expect(versionNames(await history.list(NAME, "1.1.0"))).toEqual(["1.0.0"]);
});

test("a failed disable changes nothing", async () => {
  const { fs, history } = setup();
  const disableFailure = new Error("registry busy");
  const { hooks, calls } = hooksOf({ disable: disableFailure });
  await installVersion(fs, "1.0.0", { "dist/index.js": "v1" });
  await history.record(input("1.0.0"));
  await installVersion(fs, "1.1.0", { "dist/index.js": "v2" });
  expect(
    await history.rollback({
      name: NAME,
      version: "1.0.0",
      extensionDir: EXT,
      currentVersion: "1.1.0",
      currentStateSchemaVersion: null,
      hooks,
    }),
  ).toEqual({ ok: false, error: { kind: "disable_failed", cause: disableFailure } });
  expect(calls).toEqual(["disable helm"]);
  expect(fs.filesUnder(EXT)).toEqual({
    "dist/index.js": "v2",
    ".fresnel-plugin/plugin.json": "m1.1.0",
  });
});

test("a failed enable after the swap reports enable_failed and keeps the restored files", async () => {
  const { fs, history } = setup();
  const enableFailure = new Error("registry closed");
  const { hooks, calls } = hooksOf({ enable: enableFailure });
  await installVersion(fs, "1.0.0", { "dist/index.js": "v1" });
  await history.record(input("1.0.0"));
  await installVersion(fs, "1.1.0", { "dist/index.js": "v2" });
  expect(
    await history.rollback({
      name: NAME,
      version: "1.0.0",
      extensionDir: EXT,
      currentVersion: "1.1.0",
      currentStateSchemaVersion: null,
      hooks,
    }),
  ).toEqual({ ok: false, error: { kind: "enable_failed", cause: enableFailure } });
  expect(calls).toEqual(["disable helm", "enable helm"]);
  expect(fs.filesUnder(EXT)).toEqual({
    "dist/index.js": "v1",
    ".fresnel-plugin/plugin.json": "m1.0.0",
  });
});

test("a failed state clear keeps the extension off", async () => {
  const { fs, history } = setup();
  const clearFailure = new Error("state store locked");
  const { hooks, calls } = hooksOf({ clearState: clearFailure });
  await installVersion(fs, "1.0.0", { "dist/index.js": "v1" });
  await history.record(input("1.0.0", { stateSchemaVersion: 1 }));
  await installVersion(fs, "1.1.0", { "dist/index.js": "v2" });
  await history.record(input("1.1.0", { stateSchemaVersion: 2 }));
  expect(
    await history.rollback({
      name: NAME,
      version: "1.0.0",
      clearState: true,
      extensionDir: EXT,
      currentVersion: "1.1.0",
      currentStateSchemaVersion: 2,
      hooks,
    }),
  ).toEqual({ ok: false, error: { kind: "clear_state_failed", cause: clearFailure } });
  expect(calls).toEqual(["disable helm", "clearState helm"]);
  expect(fs.filesUnder(EXT)).toEqual({
    "dist/index.js": "v1",
    ".fresnel-plugin/plugin.json": "m1.0.0",
  });
});

test("a keep count below one is an assembly defect", async () => {
  const fs = memoryVersionFs();
  expect(() =>
    createVersionHistory({ fs, historyRoot: ROOT, now: () => 0, hash, keep: 0 }),
  ).toThrow(Bug);
});

test("rollback with a full archive keeps its own target when it records the installed version (LT-04)", async () => {
  const { fs, history } = setup(5);
  const { hooks } = hooksOf();
  // 보관 5개(1.0.0~1.0.4)가 가득 차 있고 설치본 9.9.9는 기록되어 있지 않다
  await eachInOrder(["1.0.0", "1.0.1", "1.0.2", "1.0.3", "1.0.4"], async (version) => {
    await installVersion(fs, version, { "dist/index.js": `code ${version}` });
    await history.record(input(version));
    return "continue";
  });
  await installVersion(fs, "9.9.9", { "dist/index.js": "code 9.9.9" });
  const rolled = await history.rollback({
    name: NAME,
    version: "1.0.0",
    extensionDir: EXT,
    currentVersion: "9.9.9",
    currentStateSchemaVersion: null,
    hooks,
  });
  expect(rolled).toEqual({
    ok: true,
    value: { appliesAt: "nextStepBoundary", stateCleared: false },
  });
  expect(fs.filesUnder(EXT)).toEqual({
    "dist/index.js": "code 1.0.0",
    ".fresnel-plugin/plugin.json": "m1.0.0",
  });
  // 되돌릴 대상은 지워지지 않았고 방금 기록한 9.9.9가 더해졌다
  const names = versionNames(await history.list(NAME, "1.0.0"));
  expect(names).toContain("1.0.0");
  expect(names).toContain("9.9.9");
});

/** `reload` 훅을 가진 훅 묶음. 호출 순서와 받은 `clearState`를 기록한다 */
function hotHooks(outcome: { stateCleared: boolean } | Error): {
  hooks: RollbackHooks;
  calls: string[];
} {
  const base = hooksOf();
  return {
    calls: base.calls,
    hooks: {
      ...base.hooks,
      reload: (name, options) => {
        base.calls.push(`reload ${name} clearState=${String(options.clearState)}`);
        return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
      },
    },
  };
}

describe("hot rollback", () => {
  test("a hot rollback swaps the files and reloads without disabling or enabling", async () => {
    const { fs, history } = setup();
    const { hooks, calls } = hotHooks({ stateCleared: true });
    await installVersion(fs, "1.0.0", { "dist/index.js": "v1" });
    await history.record(input("1.0.0"));
    await installVersion(fs, "1.1.0", { "dist/index.js": "v2" });
    const rolled = await history.rollback({
      name: NAME,
      version: "1.0.0",
      clearState: true,
      extensionDir: EXT,
      currentVersion: "1.1.0",
      currentStateSchemaVersion: null,
      hooks,
    });
    expect(rolled).toEqual({
      ok: true,
      value: { appliesAt: "nextStepBoundary", stateCleared: true },
    });
    expect(calls).toEqual(["reload helm clearState=true"]);
    expect(fs.filesUnder(EXT)).toEqual({
      "dist/index.js": "v1",
      ".fresnel-plugin/plugin.json": "m1.0.0",
    });
  });

  test("a hot rollback whose reload fails puts the installed files back and reports it", async () => {
    const { fs, history } = setup();
    const { hooks, calls } = hotHooks(new Error("new version does not start"));
    await installVersion(fs, "1.0.0", { "dist/index.js": "v1" });
    await history.record(input("1.0.0"));
    await installVersion(fs, "1.1.0", { "dist/index.js": "v2", "extra.txt": "only v2" });
    const rolled = await history.rollback({
      name: NAME,
      version: "1.0.0",
      extensionDir: EXT,
      currentVersion: "1.1.0",
      currentStateSchemaVersion: null,
      hooks,
    });
    expect(rolled.ok).toBe(false);
    if (rolled.ok) return;
    expect(rolled.error).toMatchObject({ kind: "reload_failed", restored: true });
    expect(calls).toEqual(["reload helm clearState=false"]);
    // 도는 코드는 1.1.0 그대로이고 파일도 1.1.0이다. 1.0.0 보관본은 남아 있다
    expect(fs.filesUnder(EXT)).toEqual({
      "dist/index.js": "v2",
      "extra.txt": "only v2",
      ".fresnel-plugin/plugin.json": "m1.1.0",
    });
    expect(versionNames(await history.list(NAME, "1.1.0"))).toContain("1.0.0");
  });

  test("hotReload false keeps the disable and enable path even when a reload hook exists", async () => {
    const { fs, history } = setup();
    const { hooks, calls } = hotHooks({ stateCleared: false });
    await installVersion(fs, "1.0.0", { "dist/index.js": "v1" });
    await history.record(input("1.0.0"));
    await installVersion(fs, "1.1.0", { "dist/index.js": "v2" });
    const rolled = await history.rollback({
      name: NAME,
      version: "1.0.0",
      hotReload: false,
      extensionDir: EXT,
      currentVersion: "1.1.0",
      currentStateSchemaVersion: null,
      hooks,
    });
    expect(rolled).toEqual({ ok: true, value: { appliesAt: "restart", stateCleared: false } });
    expect(calls).toEqual(["disable helm", "enable helm"]);
  });
});
