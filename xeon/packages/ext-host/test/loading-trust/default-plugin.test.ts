import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { installDefaultPlugin, type PluginInstallFs } from "../../src/loading-trust/index.ts";
import { makeTempDir, putFile, realInstallFs } from "./support/real-fs.ts";

let temp: Awaited<ReturnType<typeof makeTempDir>>;
let source: string;
let destination: string;
let stagingRoot: string;

beforeEach(async () => {
  temp = await makeTempDir();
  source = join(temp.dir, "bundle", "helm");
  destination = join(temp.dir, "user", "extensions", "helm");
  stagingRoot = join(temp.dir, "user", ".staging");
});

afterEach(async () => {
  await temp.cleanup();
});

async function writeBundle(version: string, marker: string): Promise<void> {
  await putFile(
    join(source, ".xeon-plugin", "plugin.json"),
    JSON.stringify({
      schemaVersion: 1,
      name: "helm",
      version,
      layer: "plugin",
      kind: "plugin",
      entry: "./dist/index.js",
      points: [],
      usesDrive: false,
    }),
  );
  await putFile(join(source, "dist", "index.js"), marker);
  await putFile(join(source, "assets", "nested", "icon.txt"), `icon ${marker}`);
}

async function read(path: string): Promise<string | null> {
  return realInstallFs.readText(path);
}

test("the first run copies the whole bundle", async () => {
  await writeBundle("1.0.0", "v1");
  const result = await installDefaultPlugin({ fs: realInstallFs, source, destination });
  expect(result).toEqual({ ok: true, value: { action: "installed", version: "1.0.0" } });
  expect(await read(join(destination, "dist", "index.js"))).toBe("v1");
  expect(await read(join(destination, "assets", "nested", "icon.txt"))).toBe("icon v1");
  expect(await realInstallFs.listDir(join(stagingRoot, "helm.new"))).toBeNull();
});

test("a second run with the same version leaves the install alone", async () => {
  await writeBundle("1.0.0", "v1");
  await installDefaultPlugin({ fs: realInstallFs, source, destination });
  // 사용자가 설치본을 손봤다. 같은 버전이면 덮어쓰지 않는다
  await putFile(join(destination, "dist", "index.js"), "edited");
  const result = await installDefaultPlugin({ fs: realInstallFs, source, destination });
  expect(result).toEqual({
    ok: true,
    value: { action: "kept", version: "1.0.0", installedVersion: "1.0.0" },
  });
  expect(await read(join(destination, "dist", "index.js"))).toBe("edited");
});

test("a higher bundled version replaces the install and drops removed files", async () => {
  await writeBundle("1.0.0", "v1");
  await installDefaultPlugin({ fs: realInstallFs, source, destination });
  await realInstallFs.removeDir(source);
  await writeBundle("1.1.0", "v2");
  const result = await installDefaultPlugin({ fs: realInstallFs, source, destination });
  expect(result).toEqual({
    ok: true,
    value: { action: "replaced", version: "1.1.0", previousVersion: "1.0.0" },
  });
  expect(await read(join(destination, "dist", "index.js"))).toBe("v2");
  const manifest = await read(join(destination, ".xeon-plugin", "plugin.json"));
  expect(manifest).toContain('"version":"1.1.0"');
});

test("a newer install is not downgraded", async () => {
  await writeBundle("1.0.0", "bundled");
  await installDefaultPlugin({ fs: realInstallFs, source, destination });
  await putFile(
    join(destination, ".xeon-plugin", "plugin.json"),
    JSON.stringify({
      schemaVersion: 1,
      name: "helm",
      version: "2.0.0",
      layer: "plugin",
      kind: "plugin",
      entry: "./dist/index.js",
      points: [],
      usesDrive: false,
    }),
  );
  const result = await installDefaultPlugin({ fs: realInstallFs, source, destination });
  expect(result).toEqual({
    ok: true,
    value: { action: "kept", version: "1.0.0", installedVersion: "2.0.0" },
  });
});

test("an install with an unreadable manifest is replaced", async () => {
  await writeBundle("1.0.0", "v1");
  await putFile(join(destination, ".xeon-plugin", "plugin.json"), "{ broken");
  await putFile(join(destination, "stale.txt"), "stale");
  const result = await installDefaultPlugin({ fs: realInstallFs, source, destination });
  expect(result).toEqual({ ok: true, value: { action: "replaced", version: "1.0.0" } });
  expect(await read(join(destination, "stale.txt"))).toBeNull();
  expect(await read(join(destination, "dist", "index.js"))).toBe("v1");
});

test("a bundle without a valid manifest is a source error and changes nothing", async () => {
  await putFile(join(source, "dist", "index.js"), "x");
  await putFile(join(destination, "keep.txt"), "keep");
  const result = await installDefaultPlugin({ fs: realInstallFs, source, destination });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.kind).toBe("source_invalid");
  expect(await read(join(destination, "keep.txt"))).toBe("keep");
});

test("a copy that fails midway keeps the previous install and leaves no staging directory", async () => {
  await writeBundle("1.0.0", "v1");
  await installDefaultPlugin({ fs: realInstallFs, source, destination });
  await realInstallFs.removeDir(source);
  await writeBundle("1.1.0", "v2");
  const failing: PluginInstallFs = {
    ...realInstallFs,
    writeBytes: (path, bytes) =>
      path.endsWith("icon.txt")
        ? Promise.reject(new Error("disk full"))
        : realInstallFs.writeBytes(path, bytes),
  };
  const result = await installDefaultPlugin({ fs: failing, source, destination });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.kind).toBe("io");
  expect(await read(join(destination, "dist", "index.js"))).toBe("v1");
  expect(await realInstallFs.listDir(join(stagingRoot, "helm.new"))).toBeNull();
});

test("a rename that fails while placing the new copy restores the previous install", async () => {
  await writeBundle("1.0.0", "v1");
  await installDefaultPlugin({ fs: realInstallFs, source, destination });
  await realInstallFs.removeDir(source);
  await writeBundle("1.1.0", "v2");
  const failing: PluginInstallFs = {
    ...realInstallFs,
    rename: (from, to) =>
      from.endsWith("helm.new")
        ? Promise.reject(new Error("rename failed"))
        : realInstallFs.rename(from, to),
  };
  const result = await installDefaultPlugin({ fs: failing, source, destination });
  expect(result.ok).toBe(false);
  expect(await read(join(destination, "dist", "index.js"))).toBe("v1");
  expect(await realInstallFs.listDir(join(stagingRoot, "helm.old"))).toBeNull();
  expect(await realInstallFs.listDir(join(stagingRoot, "helm.new"))).toBeNull();
});

test("a crash between the two renames is repaired on the next run", async () => {
  await writeBundle("1.0.0", "v1");
  await installDefaultPlugin({ fs: realInstallFs, source, destination });
  // 교체 도중 끊긴 상태: 대상이 없고 이전 설치본이 .old에, 반쯤 복사된 새 것이 .new에 있다
  await realInstallFs.rename(destination, join(stagingRoot, "helm.old"));
  await putFile(join(stagingRoot, "helm.new", "partial.txt"), "partial");
  const result = await installDefaultPlugin({ fs: realInstallFs, source, destination });
  expect(result).toEqual({
    ok: true,
    value: { action: "kept", version: "1.0.0", installedVersion: "1.0.0" },
  });
  expect(await read(join(destination, "dist", "index.js"))).toBe("v1");
  expect(await realInstallFs.listDir(join(stagingRoot, "helm.new"))).toBeNull();
  expect(await realInstallFs.listDir(join(stagingRoot, "helm.old"))).toBeNull();
});

test("staging lives outside the extensions directory", async () => {
  await writeBundle("1.0.0", "v1");
  await installDefaultPlugin({ fs: realInstallFs, source, destination });
  const names = (await realInstallFs.listDir(join(temp.dir, "user", "extensions")))?.map(
    (entry) => entry.name,
  );
  expect(names).toEqual(["helm"]);
});
