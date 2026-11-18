import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ok, parseJson, type Logger } from "@fresnel/contracts";
import { createLocalIdFactory, systemRandom } from "@fresnel/platform-os";
import { createExtUiVersionPort } from "../../../src/assembly/m4/ext-ui-version-port.ts";
import type { ExtUiVersionSource } from "../../../src/assembly/m4/ext-ui-version-source.ts";
import {
  createPluginReview,
  createPluginService,
  createPluginStore,
  readPluginFolder,
  reviewStartupPlugins,
  type PluginStore,
} from "../../../src/assembly/plugins/index.ts";
import { partial } from "../../fixtures/unsafe.ts";
import { passThroughFileLock, removeTree, tempRoot, writeFiles } from "./support.ts";

// M5c §7.4, §7.5, §8 수용 38: 설치본의 이전 버전(`.history`), 느슨한 스킬 폴더, 옮김 기록(`migration.log`), 번들 갱신,
// 옮긴 설치본이 같은 내용으로 돌고 원본 변경이 검토 항목이 되는 것, 옮긴 이전 버전이 `ext.versions`에 보이고 `ext.rollback`으로 고르이는 것.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTree(root);
});

const SILENT: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => SILENT,
};

const NOW = "2026-11-18T01:00:00.000Z";

interface Rig {
  readonly root: string;
  readonly store: PluginStore;
  readonly installedDir: string;
  readonly userPluginsDir: string;
  readonly looseDir: string;
  readonly logPath: string;
}

function rigOf(): Rig {
  const root = tempRoot("plugin-migrate-");
  roots.push(root);
  return {
    root,
    store: createPluginStore({ root: join(root, "plugin-store"), fileLock: passThroughFileLock }),
    installedDir: join(root, "config", "extensions"),
    userPluginsDir: join(root, "config", "plugins"),
    looseDir: join(root, "data", "skills"),
    logPath: join(root, "state", "migration.log"),
  };
}

function startup(rig: Rig, bundledNames: readonly string[] = [], at: string = NOW) {
  return reviewStartupPlugins({
    store: rig.store,
    bundleDir: join(rig.root, "bundle"),
    bundledNames,
    installedDir: rig.installedDir,
    userPluginsDir: rig.userPluginsDir,
    looseSkillsDir: rig.looseDir,
    migrationLogPath: rig.logPath,
    logger: SILENT,
    now: () => at,
  });
}

/** 코드 없는 매니페스트 폴더 하나. `extra`로 파일을 더한다 */
function plugin(dir: string, name: string, version: string, extra: Record<string, string> = {}) {
  writeFiles(dir, {
    ".fresnel-plugin/plugin.json": JSON.stringify({ schemaVersion: 2, name, version }),
    ...extra,
  });
}

/** `version-history.ts`가 쓰는 모양의 보관 버전 하나: `<설치 폴더>/.history/<이름>/<버전>/{dir/, meta.json}` */
function historyVersion(
  rig: Rig,
  name: string,
  version: string,
  installedAt: string,
  extra: Record<string, string> = {},
): string {
  const base = join(rig.installedDir, ".history", name, version);
  plugin(join(base, "dir"), name, version, { "notes.md": `notes of ${version}\n`, ...extra });
  writeFiles(base, {
    "meta.json": `${JSON.stringify({
      version,
      installedAt,
      source: "user",
      manifestHash: "sha256:fixture",
      stateSchemaVersion: null,
    })}\n`,
  });
  return join(base, "dir");
}

/** 폴더의 내용 해시. 읽지 못하면 시험이 실패하도록 던진다 */
function hashOf(dir: string): string {
  const read = readPluginFolder(dir, { origin: "user" });
  if (!read.ok) throw new Error(`folder could not be read: ${read.error.kind}`);
  return read.value.contentHash;
}

/** 검토본 해시의 앞 8자. 판 글자와 결정 id에 쓴다 */
function shortOf(contentHash: string): string {
  return contentHash.slice("sha256:".length, "sha256:".length + 8);
}

/** `ext.versions`의 판 글자: `<매니페스트 버전>+<해시 앞 8자>` */
function textOf(version: string, contentHash: string): string {
  return `${version}+${shortOf(contentHash)}`;
}

/** `migration.log`의 줄마다 값을 준다. 파일이 없으면 빈 목록이다 */
function logLinesOf(path: string): unknown[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const json = parseJson(line);
      return json.ok ? json.value : line;
    });
}

test("the installed copy and its three previous versions go to the reviewed store, and only the installed copy is current", async () => {
  const rig = rigOf();
  plugin(join(rig.installedDir, "kit"), "kit", "1.1.0", { "notes.md": "notes of 1.1.0\n" });
  const h08dir = historyVersion(rig, "kit", "0.8.0", "2026-08-01T00:00:00.000Z");
  const h09dir = historyVersion(rig, "kit", "0.9.0", "2026-09-01T00:00:00.000Z");
  const h10dir = historyVersion(rig, "kit", "1.0.0", "2026-10-01T00:00:00.000Z");
  const installedHash = hashOf(join(rig.installedDir, "kit"));

  const report = await startup(rig);
  expect(report.migrated).toEqual(["kit"]);

  const current = await rig.store.current("kit");
  expect(current.ok && current.value?.contentHash).toBe(installedHash);
  const versions = await rig.store.versions("kit");
  expect(versions.ok && versions.value.map((row) => [row.version, row.current])).toEqual([
    ["1.1.0", true],
    ["1.0.0", false],
    ["0.9.0", false],
    ["0.8.0", false],
  ]);
  expect(versions.ok && versions.value.map((row) => row.contentHash)).toEqual([
    installedHash,
    hashOf(h10dir),
    hashOf(h09dir),
    hashOf(h08dir),
  ]);

  const log = await rig.store.readLog();
  expect(log.ok && log.value.map((entry) => [entry.actor, entry.decision, entry.kind])).toEqual([
    ["migration", "migrated", "migrated"],
    ["migration", "migrated", "migrated"],
    ["migration", "migrated", "migrated"],
    ["migration", "migrated", "migrated"],
  ]);
  expect(log.ok && log.value.map((entry) => entry.itemId)).toEqual([
    `migration:${shortOf(installedHash)}`,
    `migration:${shortOf(hashOf(h10dir))}`,
    `migration:${shortOf(hashOf(h09dir))}`,
    `migration:${shortOf(hashOf(h08dir))}`,
  ]);

  expect(logLinesOf(rig.logPath)).toEqual([
    {
      at: NOW,
      step: "installed",
      name: "kit",
      outcome: "migrated",
      contentHash: installedHash,
      reason: null,
    },
    {
      at: NOW,
      step: "history",
      name: "kit",
      outcome: "migrated",
      contentHash: hashOf(h10dir),
      reason: null,
    },
    {
      at: NOW,
      step: "history",
      name: "kit",
      outcome: "migrated",
      contentHash: hashOf(h09dir),
      reason: null,
    },
    {
      at: NOW,
      step: "history",
      name: "kit",
      outcome: "migrated",
      contentHash: hashOf(h08dir),
      reason: null,
    },
  ]);
  // 원본은 지우지 않는다
  expect(existsSync(join(rig.installedDir, ".history", "kit", "0.8.0", "meta.json"))).toBe(true);
});

test("a second start changes nothing: the same versions, the same log, and the migration log is not written again", async () => {
  const rig = rigOf();
  plugin(join(rig.installedDir, "kit"), "kit", "1.1.0");
  historyVersion(rig, "kit", "1.0.0", "2026-10-01T00:00:00.000Z");
  await startup(rig);
  const logBefore = readFileSync(rig.logPath, "utf8");
  const reviewedLogBefore = await rig.store.readLog();

  const second = await startup(rig);
  expect(second.migrated).toEqual([]);
  expect(second.kept).toEqual(["kit"]);
  expect(readFileSync(rig.logPath, "utf8")).toBe(logBefore);
  expect(await rig.store.readLog()).toEqual(reviewedLogBefore);
  const versions = await rig.store.versions("kit");
  expect(versions.ok && versions.value.map((row) => row.version)).toEqual(["1.1.0", "1.0.0"]);
});

test("a previous version with a symbolic link is refused with a diagnostic, and the other versions still move", async () => {
  const rig = rigOf();
  plugin(join(rig.installedDir, "kit"), "kit", "1.1.0");
  historyVersion(rig, "kit", "0.8.0", "2026-08-01T00:00:00.000Z");
  const h09dir = historyVersion(rig, "kit", "0.9.0", "2026-09-01T00:00:00.000Z");
  const outside = join(rig.root, "outside.md");
  writeFileSync(outside, "outside the folder\n");
  symlinkSync(outside, join(h09dir, "linked.md"));
  historyVersion(rig, "kit", "1.0.0", "2026-10-01T00:00:00.000Z");

  const report = await startup(rig);
  expect(report.diagnostics.map((item) => [item.name, item.code])).toEqual([
    ["kit", "tree_rejected"],
  ]);
  const versions = await rig.store.versions("kit");
  expect(versions.ok && versions.value.map((row) => row.version)).toEqual([
    "1.1.0",
    "1.0.0",
    "0.8.0",
  ]);
  expect(logLinesOf(rig.logPath)).toEqual([
    {
      at: NOW,
      step: "installed",
      name: "kit",
      outcome: "migrated",
      contentHash: hashOf(join(rig.installedDir, "kit")),
      reason: null,
    },
    {
      at: NOW,
      step: "history",
      name: "kit",
      outcome: "migrated",
      contentHash: hashOf(join(rig.installedDir, ".history", "kit", "1.0.0", "dir")),
      reason: null,
    },
    {
      at: NOW,
      step: "history",
      name: "kit",
      outcome: "rejected",
      contentHash: null,
      reason: "tree_rejected",
    },
    {
      at: NOW,
      step: "history",
      name: "kit",
      outcome: "migrated",
      contentHash: hashOf(join(rig.installedDir, ".history", "kit", "0.8.0", "dir")),
      reason: null,
    },
  ]);
});

test("a previous version whose payload folder is itself a symbolic link is refused as symlink_refused", async () => {
  const rig = rigOf();
  plugin(join(rig.installedDir, "kit"), "kit", "1.1.0");
  const elsewhere = join(rig.root, "elsewhere-kit");
  plugin(elsewhere, "kit", "0.7.0");
  const base = join(rig.installedDir, ".history", "kit", "0.7.0");
  writeFiles(base, {
    "meta.json": `${JSON.stringify({
      version: "0.7.0",
      installedAt: "2026-07-01T00:00:00.000Z",
      source: "user",
      manifestHash: "sha256:fixture",
      stateSchemaVersion: null,
    })}\n`,
  });
  symlinkSync(elsewhere, join(base, "dir"));

  const report = await startup(rig);
  expect(report.diagnostics.map((item) => [item.name, item.code])).toEqual([
    ["kit", "symlink_refused"],
  ]);
  const versions = await rig.store.versions("kit");
  expect(versions.ok && versions.value.map((row) => row.version)).toEqual(["1.1.0"]);
});

test("a version folder with no current copy of its name never becomes current", async () => {
  const rig = rigOf();
  historyVersion(rig, "ghost", "0.4.0", "2026-07-01T00:00:00.000Z");
  const report = await startup(rig);
  expect(report.migrated).toEqual([]);
  const current = await rig.store.current("ghost");
  expect(current.ok && current.value).toBe(null);
  const versions = await rig.store.versions("ghost");
  expect(versions.ok && versions.value.map((row) => [row.version, row.current])).toEqual([
    ["0.4.0", false],
  ]);
});

test("a loose skill folder becomes a plugin in the reviewed store, and a folder name that is not a plugin name is skipped with a diagnostic", async () => {
  const rig = rigOf();
  writeFiles(join(rig.looseDir, "good-skill"), {
    "SKILL.md": "---\nname: good-skill\ndescription: Writes good notes\n---\nBody\n",
  });
  writeFiles(join(rig.looseDir, "Bad Name"), {
    "SKILL.md": "---\nname: bad\ndescription: Not a plugin name\n---\n",
  });

  const report = await startup(rig);
  expect(report.migrated).toEqual(["good-skill"]);
  expect(report.diagnostics.map((item) => [item.name, item.code])).toEqual([
    ["Bad Name", "name_invalid"],
  ]);
  const current = await rig.store.current("good-skill");
  expect(current.ok && current.value?.meta.origin).toBe("user");
  expect(current.ok && current.value?.meta.card.purpose).toBe("Writes good notes");
  // 원본 스킬 폴더는 그대로이고, 사용자 플러그인 폴더에 새로 만들지 않는다
  expect(existsSync(join(rig.looseDir, "good-skill", "SKILL.md"))).toBe(true);
  expect(existsSync(join(rig.userPluginsDir, "good-skill"))).toBe(false);
  expect(logLinesOf(rig.logPath)).toEqual([
    {
      at: NOW,
      step: "loose_skill",
      name: "Bad Name",
      outcome: "skipped",
      contentHash: null,
      reason: "name_invalid",
    },
    {
      at: NOW,
      step: "loose_skill",
      name: "good-skill",
      outcome: "migrated",
      contentHash: hashOf(join(rig.looseDir, "good-skill")),
      reason: null,
    },
  ]);

  const second = await startup(rig);
  expect(second.migrated).toEqual([]);
  expect(logLinesOf(rig.logPath)).toHaveLength(2);
});

test("a loose skill folder with a plugin of the same name in the user folder is skipped", async () => {
  const rig = rigOf();
  plugin(join(rig.userPluginsDir, "kit"), "kit", "0.1.0");
  writeFiles(join(rig.looseDir, "kit"), {
    "SKILL.md": "---\nname: kit\ndescription: A skill\n---\n",
  });
  const report = await startup(rig);
  expect(report.migrated).toEqual([]);
  const current = await rig.store.current("kit");
  expect(current.ok && current.value).toBe(null);
});

test("a changed bundle becomes a new release that is current at the next start, and the previous release is kept", async () => {
  const rig = rigOf();
  const bundled = join(rig.root, "bundle", "helm");
  plugin(bundled, "helm", "1.0.0", { "notes.md": "release one\n" });
  expect((await startup(rig, ["helm"])).released).toEqual(["helm"]);
  const first = hashOf(bundled);

  plugin(bundled, "helm", "2.0.0", { "notes.md": "release two\n" });
  const report = await startup(rig, ["helm"], "2026-11-18T02:00:00.000Z");
  expect(report.released).toEqual(["helm"]);
  const second = hashOf(bundled);
  expect(second).not.toBe(first);

  const current = await rig.store.current("helm");
  expect(current.ok && [current.value?.contentHash, current.value?.meta.origin]).toEqual([
    second,
    "bundled",
  ]);
  const versions = await rig.store.versions("helm");
  expect(versions.ok && versions.value.map((row) => [row.version, row.current])).toEqual([
    ["2.0.0", true],
    ["1.0.0", false],
  ]);
  const log = await rig.store.readLog();
  expect(
    log.ok && log.value.map((entry) => [entry.actor, entry.decision, entry.candidateHash]),
  ).toEqual([
    ["release", "bundled", first],
    ["release", "bundled", second],
  ]);
  // 릴리스는 옮김 결과가 아니라서 옮김 기록에는 남지 않는다
  expect(existsSync(rig.logPath)).toBe(false);
});

test("a migrated installed copy runs with the same content, and a later change to its folder becomes an update item", async () => {
  const rig = rigOf();
  plugin(join(rig.installedDir, "kit"), "kit", "1.1.0", { "notes.md": "notes\n" });
  expect((await startup(rig)).migrated).toEqual(["kit"]);
  const migrated = await rig.store.current("kit");
  expect(migrated.ok && migrated.value?.contentHash).toBe(hashOf(join(rig.installedDir, "kit")));

  const service = createPluginService({
    configDir: join(rig.root, "config"),
    projectRoots: () => Promise.resolve([]),
    managedDir: null,
    bundleDir: null,
    records: () => [],
    profiles: {
      list: () =>
        Promise.resolve(
          ok({
            profiles: [],
            common: { plugins: [], settings: [], updatedAt: NOW, rev: 1 },
            rev: 1,
          }),
        ),
    },
    store: rig.store,
    log: { info() {} },
  });
  const review = createPluginReview({
    store: rig.store,
    plugins: service,
    profiles: {
      list: () =>
        Promise.resolve(
          ok({
            profiles: [],
            common: { plugins: [], settings: [], updatedAt: NOW, rev: 1 },
            rev: 1,
          }),
        ),
    },
    userDir: rig.userPluginsDir,
    ids: createLocalIdFactory({ now: () => 1_800_000_000_000 }, systemRandom()),
    now: () => NOW,
    log: SILENT,
  });
  writeFiles(join(rig.installedDir, "kit"), { "extra.md": "changed after the migration\n" });
  const scanned = await review.scan();
  expect(scanned.ok && scanned.value.queued).toHaveLength(1);
  const listed = await review.list({});
  expect(
    listed.ok &&
      listed.value.items.map((item) => [item.kind, item.name, item.state, item.provenance]),
  ).toEqual([["update", "kit", "pending", "unknown"]]);
  expect(listed.ok && listed.value.items.map((item) => item.candidateHash)).toEqual([
    hashOf(join(rig.installedDir, "kit")),
  ]);
});

test("the migrated previous versions are listed by ext.versions, and ext.rollback can select one of them", async () => {
  const rig = rigOf();
  plugin(join(rig.installedDir, "kit"), "kit", "1.1.0");
  historyVersion(rig, "kit", "0.8.0", "2026-08-01T00:00:00.000Z");
  historyVersion(rig, "kit", "1.0.0", "2026-10-01T00:00:00.000Z");
  await startup(rig);
  const installedHash = hashOf(join(rig.installedDir, "kit"));
  const h08 = hashOf(join(rig.installedDir, ".history", "kit", "0.8.0", "dir"));
  const h10 = hashOf(join(rig.installedDir, ".history", "kit", "1.0.0", "dir"));

  const port = createExtUiVersionPort({
    extUi: partial<ExtUiVersionSource>({
      reviewed: {
        store: rig.store,
        now: () => NOW,
        log: SILENT,
        refreshPluginSet: () => Promise.resolve(),
      },
      loader: () => undefined,
      bundle: () => Promise.resolve(null),
    }),
  });
  const listed = await port.versions("kit");
  expect(
    listed.ok && listed.value.versions.map((item) => [item.version, item.current, item.source]),
  ).toEqual([
    [textOf("1.1.0", installedHash), true, "user"],
    [textOf("1.0.0", h10), false, "user"],
    [textOf("0.8.0", h08), false, "user"],
  ]);

  const rolled = await port.rollback({ name: "kit", version: textOf("0.8.0", h08) });
  expect(rolled.ok).toBe(true);
  const current = await rig.store.current("kit");
  expect(current.ok && current.value?.contentHash).toBe(h08);
  const after = await port.versions("kit");
  expect(after.ok && after.value.versions.map((item) => [item.version, item.current])).toEqual([
    [textOf("1.1.0", installedHash), false],
    [textOf("1.0.0", h10), false],
    [textOf("0.8.0", h08), true],
  ]);
});

test("a plugin read from the legacy extensions folder is named in the diagnostics", async () => {
  const rig = rigOf();
  plugin(join(rig.installedDir, "kit"), "kit", "1.1.0");
  await startup(rig);
  const service = createPluginService({
    configDir: join(rig.root, "config"),
    projectRoots: () => Promise.resolve([]),
    managedDir: null,
    bundleDir: null,
    records: () => [],
    profiles: {
      list: () =>
        Promise.resolve(
          ok({
            profiles: [],
            common: { plugins: [], settings: [], updatedAt: NOW, rev: 1 },
            rev: 1,
          }),
        ),
    },
    store: rig.store,
    log: { info() {} },
  });
  const diagnostics = await service.diagnostics();
  expect(
    diagnostics.ok &&
      diagnostics.value.filter((item) => item.code === "legacy_location").map((item) => item.dir),
  ).toEqual([join(rig.installedDir, "kit")]);
});
