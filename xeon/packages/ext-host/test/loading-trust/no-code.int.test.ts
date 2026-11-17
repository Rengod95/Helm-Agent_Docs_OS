// 코드가 없는 외부 확장(§4.5.4): 매니페스트에 entry가 없으면 엔트리를 import하지 않고, 선언한 플러그인마다
// 설정도 훅도 없는 Registration 하나를 만든다. plugins도 없으면 루트 플러그인 하나를 추론한다.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { LoaderPaths } from "../../src/loading-trust/index.ts";
import { SDK } from "./support/plugin-fixture.ts";
import { createLoaderHarness } from "./support/harness.ts";
import { makeTempDir, putFile, realLoaderFs } from "./support/real-fs.ts";

let temp: Awaited<ReturnType<typeof makeTempDir>>;
let paths: LoaderPaths;
let userExtensions: string;
let project: string;

beforeEach(async () => {
  temp = await makeTempDir();
  paths = { userDir: join(temp.dir, "user"), managedDir: null, homeDir: join(temp.dir, "home") };
  userExtensions = join(paths.userDir, "extensions");
  project = join(temp.dir, "project");
  await mkdir(project, { recursive: true });
});

afterEach(async () => {
  await temp.cleanup();
});

async function writeManifest(dir: string, manifest: Record<string, unknown>): Promise<void> {
  await putFile(
    join(userExtensions, dir, ".fresnel-plugin", "plugin.json"),
    JSON.stringify({ schemaVersion: 2, version: "1.0.0", ...manifest }),
  );
}

test("a manifest without entry or plugins loads as one code-less root plugin", async () => {
  await writeManifest("notes", { name: "notes" });
  const harness = await createLoaderHarness({
    loader: { fs: realLoaderFs, paths, sdkModules: SDK },
  });
  const report = await harness.loader.loadAll(harness.options([], { cwd: project }));
  expect(report.diagnostics).toEqual([]);
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([["notes", "active"]]);
  expect(harness.t.host.registrations().map((entry) => entry.id)).toEqual(["notes"]);
});

test("a manifest without entry registers each declared plugin without running code", async () => {
  await writeManifest("kit", {
    name: "kit",
    plugins: [
      { layer: "L2", hooks: [] },
      { id: "extra", layer: "L2", hooks: [] },
    ],
  });
  const harness = await createLoaderHarness({
    loader: { fs: realLoaderFs, paths, sdkModules: SDK },
  });
  const report = await harness.loader.loadAll(harness.options([], { cwd: project }));
  expect(report.diagnostics).toEqual([]);
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([["kit", "active"]]);
  expect(harness.t.host.registrations().map((entry) => entry.id)).toEqual(["kit", "kit/extra"]);
});
