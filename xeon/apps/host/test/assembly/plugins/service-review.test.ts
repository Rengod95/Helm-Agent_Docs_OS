import { afterEach, expect, test } from "bun:test";
import { rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { ok, type Logger } from "@fresnel/contracts";
import type { ProfileListResult } from "@fresnel/contracts/wire";
import {
  createPluginService,
  createPluginStore,
  reviewStartupPlugins,
  type PluginService,
  type PluginStore,
} from "../../../src/assembly/plugins/index.ts";
import { passThroughFileLock, removeTree, tempRoot, writeFiles } from "./support.ts";

// M5c §4.5.7, §4.6, §3.4: 카드의 검토 칸과 무결성은 저장소에서 오고, 원본이 검토본과 다른지는 `matchesReviewed`와 `changedSources`로 보인다.
// 목록은 캐시를 읽고 `plugin.scan`이 캐시를 바꾼다.

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

const EMPTY_LIST: ProfileListResult = {
  profiles: [],
  common: { plugins: [], settings: [], updatedAt: "2026-11-18T00:00:00.000Z", rev: 1 },
  rev: 1,
};

interface Rig {
  readonly root: string;
  readonly bundleDir: string;
  readonly store: PluginStore;
  readonly service: () => PluginService;
}

/** 번들 폴더 `kit`을 검토본으로 넣은 상태의 서비스. 서비스의 번들 뿌리는 같은 폴더다(원본 폴더와 검토본이 같이 보인다) */
async function releasedRig(): Promise<Rig> {
  const root = tempRoot("plugin-service-review-");
  roots.push(root);
  const bundleDir = join(root, "bundle");
  writeFiles(bundleDir, {
    "kit/.fresnel-plugin/plugin.json": JSON.stringify({
      schemaVersion: 2,
      name: "kit",
      version: "1.0.0",
      purpose: "Keeps the kit",
    }),
  });
  const store = createPluginStore({
    root: join(root, "plugin-store"),
    fileLock: passThroughFileLock,
  });
  await reviewStartupPlugins({
    store,
    bundleDir,
    bundledNames: ["kit"],
    installedDir: join(root, "config", "extensions"),
    userPluginsDir: join(root, "config", "plugins"),
    looseSkillsDir: join(root, "data", "skills"),
    migrationLogPath: join(root, "state", "migration.log"),
    logger: SILENT,
    now: () => "2026-11-18T01:00:00.000Z",
  });
  return { root, bundleDir, store, service: () => serviceOf(root, bundleDir, store) };
}

function serviceOf(root: string, bundleDir: string | null, store: PluginStore): PluginService {
  return createPluginService({
    configDir: join(root, "config"),
    projectRoots: () => Promise.resolve([]),
    managedDir: null,
    bundleDir,
    records: () => [],
    profiles: { list: () => Promise.resolve(ok(EMPTY_LIST)) },
    store,
    log: { info() {} },
  });
}

test("a folder whose hash matches the reviewed copy shows approved, and matchesReviewed is true", async () => {
  const rig = await releasedRig();
  const service = rig.service();
  const got = await service.get("kit");
  expect(got.ok).toBe(true);
  if (!got.ok) return;
  const current = await rig.store.current("kit");
  if (!current.ok || current.value === null) throw new Error("no current kit");
  expect(got.value.card.review).toEqual({
    state: "approved",
    currentHash: current.value.contentHash,
    pendingItemId: null,
    approvedAt: "2026-11-18T01:00:00.000Z",
  });
  expect(got.value.card.health.state).toBe("idle");
  expect(got.value.source).toEqual({ path: join(rig.bundleDir, "kit"), matchesReviewed: true });
  expect(
    got.value.versions.map((item) => [item.hash === current.value?.contentHash, item.current]),
  ).toEqual([[true, true]]);
});

test("the cache changes only on scan: a changed source shows at scan, and changedSources names it", async () => {
  const rig = await releasedRig();
  const service = rig.service();
  expect((await service.list({})).ok).toBe(true);
  writeFiles(join(rig.bundleDir, "kit"), { "extra.md": "added after the review\n" });

  // 캐시가 그대로다: 아직 다르다는 것을 모른다
  const before = await service.get("kit");
  expect(before.ok && before.value.source?.matchesReviewed).toBe(true);
  const changedBefore = await service.changedSources();
  expect(changedBefore).toEqual({ ok: true, value: [] });

  const scanned = await service.scan();
  expect(scanned).toEqual({ ok: true, value: { queued: [] } });
  const after = await service.get("kit");
  expect(after.ok && after.value.source?.matchesReviewed).toBe(false);
  expect(await service.changedSources()).toEqual({ ok: true, value: ["kit"] });
});

test("a reviewed plugin whose folder is gone is still listed, from the metadata card, with no source", async () => {
  const rig = await releasedRig();
  rmSync(join(rig.bundleDir, "kit"), { recursive: true, force: true });
  const service = rig.service();
  const got = await service.get("kit");
  expect(got.ok).toBe(true);
  if (!got.ok) return;
  expect(got.value.card.purpose).toBe("Keeps the kit");
  expect(got.value.card.review.state).toBe("approved");
  expect(got.value.source).toBe(null);
});

test("a reviewed copy that no longer matches its hash shows the integrity health and a pinned_corrupt diagnostic", async () => {
  const rig = await releasedRig();
  const current = await rig.store.current("kit");
  if (!current.ok || current.value === null) throw new Error("no current kit");
  const manifest = join(current.value.treePath, ".fresnel-plugin", "plugin.json");
  chmodSync(manifest, 0o644);
  writeFileSync(manifest, '{"schemaVersion":2,"name":"kit","version":"9.9.9"}');
  const service = rig.service();
  const got = await service.get("kit");
  expect(got.ok && got.value.card.health.state).toBe("integrity");
  const diagnostics = await service.diagnostics();
  expect(diagnostics.ok && diagnostics.value.map((item) => item.code)).toContain("pinned_corrupt");
});

test("a store that cannot be read makes list and get fail with the store error, not an empty answer", async () => {
  const root = tempRoot("plugin-service-review-broken-");
  roots.push(root);
  writeFiles(root, { "plugin-store": "not a directory" });
  const store = createPluginStore({
    root: join(root, "plugin-store"),
    fileLock: passThroughFileLock,
  });
  const service = serviceOf(root, null, store);
  const listed = await service.list({});
  expect(listed.ok).toBe(false);
  if (!listed.ok) expect(listed.error).toEqual({ kind: "store", code: "io" });
  const got = await service.get("kit");
  expect(got.ok).toBe(false);
});
