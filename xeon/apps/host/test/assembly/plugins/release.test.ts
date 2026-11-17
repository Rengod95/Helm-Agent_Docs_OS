import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "@fresnel/contracts";
import {
  createPluginStore,
  reviewStartupPlugins,
  type PluginStore,
} from "../../../src/assembly/plugins/index.ts";
import { passThroughFileLock, removeTree, tempRoot, writeFiles } from "./support.ts";

// M5c §7.4, §7.5: 시작 때 번들을 넣고(release) 설치된 사용자 플러그인을 옮긴다(migration). 두 번째 시작은 아무것도 바꾸지 않는다.

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
  readonly bundleDir: string;
  readonly installedDir: string;
}

function rigOf(): Rig {
  const root = tempRoot("plugin-release-");
  roots.push(root);
  const storeRoot = join(root, "plugin-store");
  return {
    root,
    store: createPluginStore({ root: storeRoot, fileLock: passThroughFileLock }),
    bundleDir: join(root, "bundle"),
    installedDir: join(root, "config", "extensions"),
  };
}

/** 코드 없는 매니페스트 폴더 하나. 버전으로 내용을 바꾼다 */
function manifestFolder(dir: string, name: string, version: string): void {
  writeFiles(dir, {
    ".fresnel-plugin/plugin.json": JSON.stringify({ schemaVersion: 2, name, version }),
  });
}

function startup(rig: Rig, bundledNames: readonly string[]) {
  return reviewStartupPlugins({
    store: rig.store,
    bundleDir: rig.bundleDir,
    bundledNames,
    installedDir: rig.installedDir,
    logger: SILENT,
    now: () => NOW,
  });
}

test("a bundled plugin is released on the first start and not released again on the second", async () => {
  const rig = rigOf();
  manifestFolder(join(rig.bundleDir, "helm"), "helm", "1.0.0");
  const first = await startup(rig, ["helm"]);
  expect(first.released).toEqual(["helm"]);
  const current = await rig.store.current("helm");
  expect(current.ok && current.value?.meta.origin).toBe("bundled");
  expect(current.ok && current.value?.meta.card.review.state).toBe("approved");

  const second = await startup(rig, ["helm"]);
  expect(second.released).toEqual([]);
  expect(second.kept).toEqual(["helm"]);
  const log = await rig.store.readLog();
  expect(log.ok && log.value.map((entry) => [entry.actor, entry.decision, entry.name])).toEqual([
    ["release", "bundled", "helm"],
  ]);
});

test("an installed plugin is migrated when no reviewed copy holds its name, and its folder stays where it is", async () => {
  const rig = rigOf();
  manifestFolder(join(rig.installedDir, "kit"), "kit", "0.3.0");
  const first = await startup(rig, []);
  expect(first.migrated).toEqual(["kit"]);
  expect(existsSync(join(rig.installedDir, "kit", ".fresnel-plugin", "plugin.json"))).toBe(true);
  const current = await rig.store.current("kit");
  expect(current.ok && current.value?.meta.origin).toBe("user");
  const log = await rig.store.readLog();
  expect(log.ok && log.value.map((entry) => [entry.actor, entry.decision])).toEqual([
    ["migration", "migrated"],
  ]);

  // 같은 내용이면 두 번째 시작은 건드리지 않는다
  const second = await startup(rig, []);
  expect(second.migrated).toEqual([]);
  expect(second.kept).toEqual(["kit"]);
});

test("a reviewed user copy keeps the name, so the bundled copy is not released and the conflict is said", async () => {
  const rig = rigOf();
  // 설치본을 먼저 옮긴다(사용자 검토본이 이름을 쥔다)
  manifestFolder(join(rig.installedDir, "helm"), "helm", "2.0.0");
  expect((await startup(rig, [])).migrated).toEqual(["helm"]);
  manifestFolder(join(rig.bundleDir, "helm"), "helm", "1.0.0");
  const report = await startup(rig, ["helm"]);
  expect(report.released).toEqual([]);
  expect(report.kept).toEqual(["helm"]);
  expect(report.diagnostics.map((item) => [item.name, item.code])).toEqual([
    ["helm", "name_conflict"],
  ]);
  const current = await rig.store.current("helm");
  expect(current.ok && current.value?.meta.origin).toBe("user");
});

test("a symbolic link under the installed folder is refused with a diagnostic and the others still migrate", async () => {
  const rig = rigOf();
  const target = join(rig.root, "elsewhere");
  manifestFolder(target, "linked", "1.0.0");
  mkdirSync(rig.installedDir, { recursive: true });
  symlinkSync(target, join(rig.installedDir, "linked"));
  manifestFolder(join(rig.installedDir, "kit"), "kit", "0.3.0");
  const report = await startup(rig, []);
  expect(report.migrated).toEqual(["kit"]);
  expect(report.diagnostics.map((item) => [item.name, item.code])).toEqual([
    ["linked", "symlink_refused"],
  ]);
  const current = await rig.store.current("linked");
  expect(current.ok && current.value).toBe(null);
});
