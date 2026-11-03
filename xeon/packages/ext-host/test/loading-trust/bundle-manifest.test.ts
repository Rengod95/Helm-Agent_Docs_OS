import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { err, ok } from "@fresnel/contracts";
import { readBundleManifest, type PluginInstallFs } from "../../src/loading-trust/index.ts";
import { makeTempDir, putFile, realInstallFs } from "./support/real-fs.ts";

// 번들 매니페스트 읽기(`readBundleManifest`). 기본 플러그인 설치가 쓰는 검증과 같은 검증을 거친다.

let temp: Awaited<ReturnType<typeof makeTempDir>>;
let bundle: string;

beforeEach(async () => {
  temp = await makeTempDir();
  bundle = join(temp.dir, "bundle", "helm");
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

test("a valid bundle manifest gives its version and the exact text", async () => {
  const text = manifest("1.2.0");
  await putFile(join(bundle, ".fresnel-plugin", "plugin.json"), text);
  expect(await readBundleManifest(realInstallFs, bundle)).toEqual(
    ok({ version: "1.2.0", manifestText: text }),
  );
});

test("a bundle without a manifest is null, not an error", async () => {
  await putFile(join(bundle, "dist", "index.js"), "x");
  expect(await readBundleManifest(realInstallFs, bundle)).toEqual(ok(null));
});

test("a manifest that is not JSON or fails validation is null", async () => {
  await putFile(join(bundle, ".fresnel-plugin", "plugin.json"), "{ broken");
  expect(await readBundleManifest(realInstallFs, bundle)).toEqual(ok(null));
  await putFile(join(bundle, ".fresnel-plugin", "plugin.json"), manifest("not-a-version"));
  expect(await readBundleManifest(realInstallFs, bundle)).toEqual(ok(null));
});

test("a read that fails is an io error carrying the cause", async () => {
  const cause = new Error("permission denied");
  const failing: PluginInstallFs = {
    ...realInstallFs,
    readText: () => Promise.reject(cause),
  };
  expect(await readBundleManifest(failing, bundle)).toEqual(err({ kind: "io", cause }));
});
