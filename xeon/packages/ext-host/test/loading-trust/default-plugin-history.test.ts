import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import {
  createVersionHistory,
  installDefaultPlugin,
  type VersionHistory,
  type VersionHistoryFs,
} from "../../src/loading-trust/index.ts";
import { makeTempDir, putFile, realInstallFs, realVersionHistoryFs } from "./support/real-fs.ts";

let temp: Awaited<ReturnType<typeof makeTempDir>>;
let source: string;
let destination: string;
let historyRoot: string;

beforeEach(async () => {
  temp = await makeTempDir();
  source = join(temp.dir, "bundle", "helm");
  destination = join(temp.dir, "user", "extensions", "helm");
  historyRoot = join(temp.dir, "user", "extensions", ".history");
});

afterEach(async () => {
  await temp.cleanup();
});

function manifest(version: string): string {
  return JSON.stringify({
    schemaVersion: 2,
    name: "helm",
    version,
    entry: "./dist/index.js",
    plugins: [{ layer: "plugin", hooks: [] }],
  });
}

async function writeBundle(version: string, marker: string): Promise<void> {
  await putFile(join(source, ".fresnel-plugin", "plugin.json"), manifest(version));
  await putFile(join(source, "dist", "index.js"), marker);
}

async function read(path: string): Promise<string | null> {
  return realInstallFs.readText(path);
}

/** 시각은 호출마다 1초씩 간다. 매니페스트 해시는 본문 길이로 정한다 */
function historyWith(fs: VersionHistoryFs): VersionHistory {
  let last = 0;
  return createVersionHistory({
    fs,
    historyRoot,
    now: () => {
      last += 1000;
      return last;
    },
    hash: (text) => `len${text.length}`,
  });
}

test("a replacement records the previous install and the new bundled version", async () => {
  await writeBundle("1.0.0", "v1");
  await installDefaultPlugin({ fs: realInstallFs, source, destination });
  await realInstallFs.removeDir(source);
  await writeBundle("1.1.0", "v2");
  const history = historyWith(realVersionHistoryFs);
  expect(await installDefaultPlugin({ fs: realInstallFs, source, destination, history })).toEqual({
    ok: true,
    value: { action: "replaced", version: "1.1.0", previousVersion: "1.0.0" },
  });
  expect(await history.list("helm", "1.1.0")).toEqual({
    ok: true,
    value: {
      versions: [
        {
          version: "1.1.0",
          installedAt: "1970-01-01T00:00:02.000Z",
          source: "bundled",
          manifestHash: `len${manifest("1.1.0").length}`,
          stateSchemaVersion: null,
          current: true,
        },
        {
          version: "1.0.0",
          installedAt: "1970-01-01T00:00:01.000Z",
          source: "bundled",
          manifestHash: `len${manifest("1.0.0").length}`,
          stateSchemaVersion: null,
          current: false,
        },
      ],
      skipped: [],
    },
  });
  expect(await read(join(destination, "dist", "index.js"))).toBe("v2");
});

test("a previous install already recorded as user keeps that source", async () => {
  await writeBundle("1.0.0", "v1");
  await installDefaultPlugin({ fs: realInstallFs, source, destination });
  const history = historyWith(realVersionHistoryFs);
  await history.record({
    name: "helm",
    version: "1.0.0",
    source: "user",
    extensionDir: destination,
    manifestText: manifest("1.0.0"),
    stateSchemaVersion: null,
  });
  await realInstallFs.removeDir(source);
  await writeBundle("1.1.0", "v2");
  expect(await installDefaultPlugin({ fs: realInstallFs, source, destination, history })).toEqual({
    ok: true,
    value: { action: "replaced", version: "1.1.0", previousVersion: "1.0.0" },
  });
  expect(await history.list("helm", "1.1.0")).toEqual({
    ok: true,
    value: {
      versions: [
        {
          version: "1.1.0",
          installedAt: "1970-01-01T00:00:03.000Z",
          source: "bundled",
          manifestHash: `len${manifest("1.1.0").length}`,
          stateSchemaVersion: null,
          current: true,
        },
        {
          version: "1.0.0",
          installedAt: "1970-01-01T00:00:02.000Z",
          source: "user",
          manifestHash: `len${manifest("1.0.0").length}`,
          stateSchemaVersion: null,
          current: false,
        },
      ],
      skipped: [],
    },
  });
});

test("a corrupt install is replaced and only the new bundled version is recorded", async () => {
  await writeBundle("1.0.0", "v1");
  await installDefaultPlugin({ fs: realInstallFs, source, destination });
  await putFile(join(destination, ".fresnel-plugin", "plugin.json"), "{ broken");
  await realInstallFs.removeDir(source);
  await writeBundle("1.1.0", "v2");
  const history = historyWith(realVersionHistoryFs);
  expect(await installDefaultPlugin({ fs: realInstallFs, source, destination, history })).toEqual({
    ok: true,
    value: { action: "replaced", version: "1.1.0" },
  });
  expect(await history.list("helm", "1.1.0")).toEqual({
    ok: true,
    value: {
      versions: [
        {
          version: "1.1.0",
          installedAt: "1970-01-01T00:00:01.000Z",
          source: "bundled",
          manifestHash: `len${manifest("1.1.0").length}`,
          stateSchemaVersion: null,
          current: true,
        },
      ],
      skipped: [],
    },
  });
});

test("a previous install that cannot be recorded is kept and nothing is replaced", async () => {
  await writeBundle("1.0.0", "v1");
  await installDefaultPlugin({ fs: realInstallFs, source, destination });
  await realInstallFs.removeDir(source);
  await writeBundle("1.1.0", "v2");
  const diskFull = new Error("disk full");
  const failing: VersionHistoryFs = {
    ...realVersionHistoryFs,
    writeText: () => Promise.reject(diskFull),
  };
  const result = await installDefaultPlugin({
    fs: realInstallFs,
    source,
    destination,
    history: historyWith(failing),
  });
  expect(result).toEqual({
    ok: false,
    error: {
      kind: "io",
      message: "cannot record 1.0.0 in the version history",
      cause: { kind: "io", cause: diskFull },
    },
  });
  expect(await read(join(destination, "dist", "index.js"))).toBe("v1");
  expect(await realInstallFs.listDir(join(temp.dir, "user", ".staging", "helm.new"))).toBeNull();
});

test("without a history nothing is recorded", async () => {
  await writeBundle("1.0.0", "v1");
  await installDefaultPlugin({ fs: realInstallFs, source, destination });
  await realInstallFs.removeDir(source);
  await writeBundle("1.1.0", "v2");
  expect(await installDefaultPlugin({ fs: realInstallFs, source, destination })).toEqual({
    ok: true,
    value: { action: "replaced", version: "1.1.0", previousVersion: "1.0.0" },
  });
  expect(await realVersionHistoryFs.listDir(historyRoot)).toBeNull();
});
