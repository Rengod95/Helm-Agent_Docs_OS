// 로더 진단 보관 상한(X.loading-trust.spec §4.3.3): 256개를 넘으면 가장 오래된 것부터 버리고, 남은 것은 오래된 순서로 읽힌다.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import type { BuiltinExtensionModule, LoaderPaths } from "../../src/loading-trust/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { createLoaderHarness, moduleOf } from "./support/harness.ts";
import { makeTempDir, putFile, realLoaderFs } from "./support/real-fs.ts";

let temp: Awaited<ReturnType<typeof makeTempDir>>;

beforeEach(async () => {
  temp = await makeTempDir();
});

afterEach(async () => {
  await temp.cleanup();
});

const signal = new AbortController().signal;

function nameOf(index: number): string {
  return `bnd-${String(index).padStart(3, "0")}`;
}

/** `start`부터 `count`개 확장 이름. 기대값을 적는 데 쓴다 */
function namesFrom(start: number, count: number): string[] {
  return Array.from({ length: count }, (_, offset) => nameOf(start + offset));
}

/**
 * 실패하는 내장 확장 `count`개. 이름은 `bnd-000`부터 이어진다. 선언하지 않은 훅을 setup에서 쓰므로
 * 확장마다 `usage_invalid` 진단이 하나씩 남는다(pipeline 시험과 같은 방식)
 */
function failingModules(count: number): BuiltinExtensionModule[] {
  return Array.from({ length: count }, (_, index) =>
    moduleOf({ name: nameOf(index), hooks: ["tool.call.before"] }, (g) => {
      g.on("tool.call.before", () => undefined);
      g.on("boundary.step.after", () => undefined);
    }),
  );
}

test("300 loader diagnostics leave the newest 256 in order, oldest first", async () => {
  const harness = await createLoaderHarness();
  const report = await harness.loader.loadAll(
    harness.options(failingModules(300), { cwd: "/", projects: "on_demand" }),
  );
  expect(report.diagnostics).toHaveLength(256);
  expect(report.diagnostics.map((entry) => entry.extension)).toEqual(namesFrom(44, 256));
  expect(harness.loader.diagnostics()).toEqual(report.diagnostics);
});

test("below the cap nothing is dropped", async () => {
  const harness = await createLoaderHarness();
  const report = await harness.loader.loadAll(
    harness.options(failingModules(255), { cwd: "/", projects: "on_demand" }),
  );
  expect(report.diagnostics).toHaveLength(255);
  expect(report.diagnostics.map((entry) => entry.extension)).toEqual(namesFrom(0, 255));
  expect(harness.loader.diagnostics()).toEqual(report.diagnostics);
});

test("repeated loadProject calls keep the log at 256 and each report carries its own diagnostic", async () => {
  const harness = await createLoaderHarness();
  await harness.loader.loadAll(
    harness.options([], {
      cwd: "/",
      projects: "on_demand",
      startup: { safeMode: { active: true }, disabled: [] },
    }),
  );
  // 안전 모드의 loadProject는 진단 하나(safe_mode)만 남긴다. 300번 불러도 각 보고서는 자기 것 하나만 가진다
  const codesPerCall: string[][] = [];
  await eachInOrder(Array.from({ length: 300 }), async () => {
    const report = await harness.loader.loadProject({
      projectRoot: "/work",
      mode: "headless",
      trustOverride: true,
      signal,
    });
    codesPerCall.push(report.diagnostics.map((entry) => entry.code));
    return "continue";
  });
  expect(codesPerCall).toEqual(Array.from({ length: 300 }, () => ["safe_mode"]));
  expect(harness.loader.diagnostics().map((entry) => entry.code)).toEqual(
    Array.from({ length: 256 }, () => "safe_mode"),
  );
});

test("once the log is full, a loadProject report still carries only its own diagnostics", async () => {
  const projectRoot = join(temp.dir, "project");
  // 프로젝트 확장이 있어야 신뢰 거부가 진단으로 남는다. 거부된 확장은 엔트리를 import하지 않으므로 매니페스트만 쓴다
  const extensionRoot = join(projectRoot, ".fresnel", "extensions", "proj");
  await putFile(
    join(extensionRoot, ".fresnel-plugin", "plugin.json"),
    JSON.stringify({
      schemaVersion: 2,
      name: "proj",
      version: "1.0.0",
      entry: "./src/index.ts",
      plugins: [{ layer: "plugin", hooks: ["boundary.settle.after"] }],
    }),
  );
  const paths: LoaderPaths = {
    userDir: join(temp.dir, "user"),
    managedDir: null,
    homeDir: join(temp.dir, "home"),
  };
  const harness = await createLoaderHarness({
    loader: { fs: realLoaderFs, paths },
  });
  await harness.loader.loadAll(
    harness.options(failingModules(300), { cwd: "/", projects: "on_demand" }),
  );
  const denied = await harness.loader.loadProject({
    projectRoot,
    mode: "headless",
    trustOverride: false,
    signal,
  });
  expect(denied.diagnostics.map((entry) => entry.code)).toEqual(["trust_denied"]);
  expect(harness.loader.diagnostics()).toHaveLength(256);
  expect(
    harness.loader
      .diagnostics()
      .map((entry) => entry.code)
      .at(-1),
  ).toBe("trust_denied");
});
