import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Logger } from "@fresnel/contracts";
import { installDefaultPlugins } from "../../src/assembly/default-plugins.ts";
import {
  createExtUiVersionHistory,
  nodeVersionHistoryFs,
} from "../../src/assembly/m4/ext-ui-version-fs.ts";

// 버전 기록의 node:fs 구현과 기본 플러그인 교체의 기록 연결(HS-108). 모든 경로는 임시 디렉터리 안이다.

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ext-ui-version-fs-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test("readText is null for a missing file and the text for an existing one", async () => {
  const file = join(root, "absent.txt");
  expect(await nodeVersionHistoryFs.readText(file)).toBeNull();
  writeFileSync(file, "present");
  expect(await nodeVersionHistoryFs.readText(file)).toBe("present");
});

test("writeText creates the parent folders and leaves no temporary file behind", async () => {
  const file = join(root, "a", "b", "meta.json");
  await nodeVersionHistoryFs.writeText(file, '{"version":"0.1.0"}');
  expect(readFileSync(file, "utf8")).toBe('{"version":"0.1.0"}');
  expect(existsSync(`${file}.tmp`)).toBe(false);
});

test("listDir names the files and folders by kind and is null for a missing folder", async () => {
  mkdirSync(join(root, "versions", "0.1.0"), { recursive: true });
  writeFileSync(join(root, "versions", "note.txt"), "x");
  // 나열 순서는 파일 시스템이 정한다(계약은 정렬하지 않은 원본이라고 한다). 이름순으로 맞춰 본다
  const listed = await nodeVersionHistoryFs.listDir(join(root, "versions"));
  expect(listed?.toSorted((a, b) => (a.name < b.name ? -1 : 1))).toEqual([
    { name: "0.1.0", kind: "dir" },
    { name: "note.txt", kind: "file" },
  ]);
  expect(await nodeVersionHistoryFs.listDir(join(root, "missing"))).toBeNull();
  expect(await nodeVersionHistoryFs.exists(join(root, "versions"))).toBe(true);
  expect(await nodeVersionHistoryFs.exists(join(root, "missing"))).toBe(false);
});

test("copyDir copies the tree, dereferences a link, and refuses to overwrite an existing target", async () => {
  const from = join(root, "from");
  mkdirSync(join(from, "dist"), { recursive: true });
  writeFileSync(join(from, "dist", "index.js"), "export {};\n");
  writeFileSync(join(root, "real.txt"), "linked content");
  symlinkSync(join(root, "real.txt"), join(from, "link.txt"));
  const to = join(root, "copies", "dir");

  await nodeVersionHistoryFs.copyDir(from, to);

  expect(readFileSync(join(to, "dist", "index.js"), "utf8")).toBe("export {};\n");
  expect(readFileSync(join(to, "link.txt"), "utf8")).toBe("linked content");
  expect(lstatSync(join(to, "link.txt")).isSymbolicLink()).toBe(false);
  const refused = await nodeVersionHistoryFs.copyDir(from, to).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(refused).toBeInstanceOf(Error);
});

test("renameDir moves a folder and removeDir ignores a path that is not there", async () => {
  const from = join(root, "staged");
  mkdirSync(from, { recursive: true });
  writeFileSync(join(from, "meta.json"), "{}");
  await nodeVersionHistoryFs.renameDir(from, join(root, "final"));
  expect(existsSync(from)).toBe(false);
  expect(readFileSync(join(root, "final", "meta.json"), "utf8")).toBe("{}");
  await nodeVersionHistoryFs.removeDir(join(root, "final"));
  await nodeVersionHistoryFs.removeDir(join(root, "never-there"));
  expect(existsSync(join(root, "final"))).toBe(false);
});

test("the history keeps a version under .history with a sha256 manifest hash and the injected time", async () => {
  const extensionsDir = join(root, "extensions");
  const source = join(root, "source");
  mkdirSync(join(source, "dist"), { recursive: true });
  writeFileSync(join(source, "dist", "index.js"), "export {};\n");
  const history = createExtUiVersionHistory({
    extensionsDir,
    clock: { now: () => Date.UTC(2026, 10, 2) },
  });

  const recorded = await history.record({
    name: "helm",
    version: "0.1.0",
    source: "bundled",
    extensionDir: source,
    manifestText: "{}",
    stateSchemaVersion: null,
  });

  expect(recorded.ok).toBe(true);
  expect(
    readFileSync(
      join(extensionsDir, ".history", "helm", "0.1.0", "dir", "dist", "index.js"),
      "utf8",
    ),
  ).toBe("export {};\n");
  const listing = await history.list("helm", "0.1.0");
  expect(listing).toEqual({
    ok: true,
    value: {
      versions: [
        {
          version: "0.1.0",
          installedAt: "2026-11-02T00:00:00.000Z",
          source: "bundled",
          manifestHash: createHash("sha256").update("{}").digest("hex"),
          stateSchemaVersion: null,
          current: true,
        },
      ],
      skipped: [],
    },
  });
});

/** 번들 디렉터리에 버전 하나를 쓴다. 기본 플러그인 설치가 읽을 수 있는 매니페스트를 갖는다 */
function writeBundle(bundleDir: string, version: string): void {
  const dir = join(bundleDir, "helm");
  mkdirSync(join(dir, ".fresnel-plugin"), { recursive: true });
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(
    join(dir, ".fresnel-plugin", "plugin.json"),
    JSON.stringify({
      schemaVersion: 2,
      name: "helm",
      version,
      entry: "./dist/index.js",
      group: {},
      plugins: [{ layer: "L3", hooks: [] }],
    }),
  );
  writeFileSync(join(dir, "dist", "index.js"), `export const version = "${version}";\n`);
}

const logger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => logger,
};

test("a bundle upgrade through installDefaultPlugins records the replaced installed version in the history", async () => {
  const bundleDir = join(root, "bundle");
  const extensionsDir = join(root, "config", "extensions");
  const stateDir = join(root, "state");
  let tick = 0;
  const history = createExtUiVersionHistory({
    extensionsDir,
    clock: {
      now: () => {
        tick += 1;
        return Date.UTC(2026, 10, 1) + tick * 1000;
      },
    },
  });
  const deps = { bundleDir, extensionsDir, stateDir, logger, history };

  writeBundle(bundleDir, "0.1.0");
  expect(await installDefaultPlugins(deps, ["helm"])).toEqual([
    { name: "helm", action: "installed", version: "0.1.0" },
  ]);
  writeBundle(bundleDir, "0.2.0");
  expect(await installDefaultPlugins(deps, ["helm"])).toEqual([
    { name: "helm", action: "replaced", version: "0.2.0" },
  ]);

  const listing = await history.list("helm", "0.2.0");
  expect(listing.ok).toBe(true);
  if (listing.ok) {
    expect(
      listing.value.versions.map((entry) => [entry.version, entry.source, entry.current]),
    ).toEqual([
      ["0.2.0", "bundled", true],
      ["0.1.0", "bundled", false],
    ]);
  }
});
