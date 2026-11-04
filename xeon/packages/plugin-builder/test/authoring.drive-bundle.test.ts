import { cp, mkdir, readdir, readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { ok } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  createExtensionLoader,
  type ExtensionLoader,
  type LoaderFs,
  type LoaderPaths,
  type SdkModules,
} from "@fresnel/ext-host";
import { createTestHost } from "@fresnel/ext-host/testing";
import * as kit from "@fresnel/group-sdk";
import { scanDriveSource } from "@fresnel/group-sdk/testing";
import { packExtension, scaffoldExtension, validateExtensionDir } from "../src/index.ts";
import { readManifest, tempRoot, templateDirs } from "./support.ts";

// 플러그인 그룹(drive)을 한 파일로 묶고 외부 로더로 실제로 불러 drive가 도는지 본다(Y8). 단일 플러그인 묶음 시험은 validate-pack 시험에 있다.

async function drain(
  t: Awaited<ReturnType<typeof createTestHost>>,
  thread: ThreadId,
  rounds: number,
): Promise<void> {
  if (rounds <= 0) return;
  await t.boundary(thread).turnSettled();
  await t.settled();
  await drain(t, thread, rounds - 1);
}

const root = tempRoot();
const templates = templateDirs();
const NAME = "bundle-drive";

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

const realLoaderFs: LoaderFs = {
  async readText(path) {
    try {
      return await readFile(path, "utf8");
    } catch (caught) {
      if (isMissing(caught)) return null;
      throw caught;
    }
  },
  async listDir(path) {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        kind: entry.isSymbolicLink() ? "symlink" : entry.isDirectory() ? "dir" : "file",
      }));
    } catch (caught) {
      if (isMissing(caught)) return null;
      throw caught;
    }
  },
  async exists(path) {
    try {
      await stat(path);
      return true;
    } catch (caught) {
      if (isMissing(caught)) return false;
      throw caught;
    }
  },
  realpath: (path) => realpath(path),
};

const SDK_MODULES: SdkModules = { "@fresnel/group-sdk": kit };

test("authoring.drive-bundle: a drive group packed as one file loads from the user location and its drive runs", async () => {
  // 1. 뼈대 → 검사 → 한 파일 묶음
  const dir = root.path("src-group");
  const made = await scaffoldExtension({ kind: "plugin-group", name: NAME, dir }, { templates });
  if (!made.ok) throw new Error(made.error.message);
  expect(await validateExtensionDir(dir, { scanDrive: scanDriveSource })).toEqual({
    ok: true,
    value: { ok: true, issues: [] },
  });
  const packed = await packExtension({ dir });
  if (!packed.ok) throw new Error(packed.error.message);
  expect(packed.value.files).toEqual([".fresnel-plugin/plugin.json", "README.md", "dist/index.js"]);
  const manifest = readManifest(packed.value.path);
  expect(manifest.entry).toBe("./dist/index.js");
  expect(manifest.plugins.map((plugin) => [plugin.layer, plugin.drives])).toEqual([["L3", true]]);
  const bundle = await readFile(join(packed.value.path, "dist", "index.js"), "utf8");
  expect(bundle).not.toContain('from "./');

  // 2. 사용자 확장 위치에 두고 외부 로더로 불러온다
  const paths: LoaderPaths = {
    userDir: join(root.path("run"), "user"),
    managedDir: null,
    homeDir: join(root.path("run"), "home"),
  };
  await mkdir(join(paths.userDir, "extensions"), { recursive: true });
  await cp(packed.value.path, join(paths.userDir, "extensions", NAME), { recursive: true });
  const t = await createTestHost();
  const loader: ExtensionLoader = createExtensionLoader({
    host: t.host,
    policy: { admit: () => ok("user"), forget: () => {} },
    fs: realLoaderFs,
    paths,
    trustBackend: {
      read: () => Promise.resolve({ ok: true, text: null }),
      update: () => Promise.resolve(),
    },
    clock: { now: t.timers.now },
    // 템플릿 그룹은 기본이 꺼짐이라 설정으로 켠다
    settings: { enabled: () => true, hasValue: () => false },
    sdkModules: SDK_MODULES,
  });
  const report = await loader.loadAll({
    builtins: [],
    cwd: root.path("run"),
    mode: "headless",
    signal: new AbortController().signal,
  });
  expect(report.diagnostics).toEqual([]);
  expect(report.extensions.map((info) => [info.name, info.source, info.trust, info.state])).toEqual(
    [[NAME, "user", "user", "active"]],
  );

  // 3. drive가 한 번 돈다: 단계마다 turn을 내고 상태를 커밋한다
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  await drain(t, thread, 4);
  expect(t.loop.turns.length).toBeGreaterThan(0);
  const committed = t.records
    .events(thread)
    .filter((event) => event.kind === `grp.${NAME}.state.committed`);
  expect(committed.length).toBeGreaterThan(0);
  await loader.dispose();
});
