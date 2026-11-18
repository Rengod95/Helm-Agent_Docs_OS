import { afterEach, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "@fresnel/contracts";
import { buildPluginCard } from "../../../src/assembly/plugins/card.ts";
import { readPluginFolder } from "../../../src/assembly/plugins/folder-reader.ts";
import {
  createPluginStore,
  createReviewedSource,
  reviewStartupPlugins,
} from "../../../src/assembly/plugins/index.ts";
import { passThroughFileLock, removeTree, tempRoot, writeFiles } from "./support.ts";

// M5c §4.6.3, §4.6.5: 로더의 검토본 목록은 저장소의 current 트리를 준다. 무결성이 어긋난 것은 빼고 진단을 준다.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTree(root);
});

interface Logged {
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

function loggerOf(logged: Logged[]): Logger {
  const logger: Logger = {
    debug() {},
    info() {},
    warn() {},
    error(message, fields) {
      logged.push({ message, fields: fields ?? {} });
    },
    child: () => logger,
  };
  return logger;
}

/** 번들 하나를 검토본으로 넣은 저장소를 만든다 */
async function approvedStore() {
  const root = tempRoot("plugin-reviewed-source-");
  roots.push(root);
  const bundleDir = join(root, "bundle");
  writeFiles(bundleDir, {
    "helm/.fresnel-plugin/plugin.json": JSON.stringify({
      schemaVersion: 2,
      name: "helm",
      version: "1.0.0",
    }),
  });
  const store = createPluginStore({
    root: join(root, "plugin-store"),
    fileLock: passThroughFileLock,
  });
  const silent = loggerOf([]);
  await reviewStartupPlugins({
    store,
    bundleDir,
    bundledNames: ["helm"],
    installedDir: join(root, "config", "extensions"),
    userPluginsDir: join(root, "config", "plugins"),
    looseSkillsDir: join(root, "data", "skills"),
    migrationLogPath: join(root, "state", "migration.log"),
    logger: silent,
    now: () => "2026-11-18T01:00:00.000Z",
  });
  return { root, store };
}

test("the listing offers each approved name with the root of its current tree and its hash", async () => {
  const { store } = await approvedStore();
  const logged: Logged[] = [];
  const listing = await createReviewedSource(store, loggerOf(logged)).list();
  const current = await store.current("helm");
  if (!current.ok || current.value === null) throw new Error("no current helm");
  expect(listing).toEqual({
    entries: [
      {
        name: "helm",
        source: "bundled",
        root: current.value.treePath,
        contentHash: current.value.contentHash,
      },
    ],
    diagnostics: [],
  });
  expect(logged).toEqual([]);
});

test("a reviewed copy whose tree no longer matches its hash is left out and reported as pinned_corrupt", async () => {
  const { store } = await approvedStore();
  const current = await store.current("helm");
  if (!current.ok || current.value === null) throw new Error("no current helm");
  // 검토본 파일의 쓰기 권한을 풀고 고친다(저장소 밖의 손 수정 흉내). 폴더는 읽기 전용이어도 파일만 고치면 된다
  const manifest = join(current.value.treePath, ".fresnel-plugin", "plugin.json");
  chmodSync(manifest, 0o644);
  writeFileSync(manifest, '{"schemaVersion":2,"name":"helm","version":"9.9.9"}');
  const listing = await createReviewedSource(store, loggerOf([])).list();
  expect(listing.entries).toEqual([]);
  expect(listing.diagnostics.map((item) => [item.name, item.source, item.code])).toEqual([
    ["helm", "bundled", "pinned_corrupt"],
  ]);
});

test("a store that cannot be read gives an empty listing and a logged error, not a fake entry", async () => {
  const root = tempRoot("plugin-reviewed-source-broken-");
  roots.push(root);
  // 저장소 루트가 파일이면 그 아래의 `reviewed`를 읽을 수 없다
  writeFiles(root, { "plugin-store": "not a directory" });
  const store = createPluginStore({
    root: join(root, "plugin-store"),
    fileLock: passThroughFileLock,
  });
  const logged: Logged[] = [];
  const listing = await createReviewedSource(store, loggerOf(logged)).list();
  expect(listing).toEqual({ entries: [], diagnostics: [] });
  expect(logged.map((line) => line.message)).toEqual(["plugin.store.list_failed"]);
});

// AGE-41: 프로젝트 출처 검토본은 `projectId`를 싣는다. 같은 이름의 번들 검토본은 싣지 않는다.
test("a project copy is listed with its project id, and the same name's bundled copy keeps none", async () => {
  const { root, store } = await approvedStore();
  const srcDir = join(root, "project-src");
  writeFiles(srcDir, {
    ".fresnel-plugin/plugin.json": JSON.stringify({
      schemaVersion: 2,
      name: "helm",
      version: "2.0.0",
    }),
  });
  const folder = readPluginFolder(srcDir, { origin: "project" });
  if (!folder.ok) throw new Error("fixture folder rejected");
  const snapshot = await store.snapshotCandidate(srcDir);
  if (!snapshot.ok) throw new Error("snapshot failed");
  const contentHash = snapshot.value.contentHash;
  const approvedAt = "2026-11-18T02:00:00.000Z";
  const promoted = await store.promote(contentHash, {
    name: "helm",
    version: "2.0.0",
    contentHash,
    approvedAt,
    decisionId: "project:ffff0001",
    origin: "project",
    inferredManifest: folder.value.inferred,
    card: buildPluginCard({
      folder: folder.value,
      origin: { kind: "project", projectId: "prj_a" },
      review: { state: "approved", currentHash: contentHash, pendingItemId: null, approvedAt },
      usedBy: [],
      health: { state: "idle", lastActiveAt: null, lastError: null },
    }),
  });
  expect(promoted.ok).toBe(true);
  expect((await store.setCurrent("prj_a/helm", contentHash)).ok).toBe(true);
  const listing = await createReviewedSource(store, loggerOf([])).list();
  expect(
    listing.entries.map((entry) => [entry.name, entry.source, entry.projectId ?? null]),
  ).toEqual([
    ["helm", "bundled", null],
    ["helm", "project", "prj_a"],
  ]);
  expect(listing.diagnostics).toEqual([]);
});
