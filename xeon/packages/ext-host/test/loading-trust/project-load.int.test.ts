// 서비스 모드의 프로젝트 확장 적재(M3-REQ-38): 작업 폴더를 여는 때 프로젝트 단위로 판정하고 싣는다.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { TrustChoice } from "@xeon/contracts/extensions";
import type { LoaderPaths } from "../../src/loading-trust/index.ts";
import { fakeGroupKit, SDK, writePlugin } from "./support/plugin-fixture.ts";
import { createLoaderHarness, type LoaderHarness } from "./support/harness.ts";
import { makeTempDir, realLoaderFs } from "./support/real-fs.ts";

let temp: Awaited<ReturnType<typeof makeTempDir>>;
let paths: LoaderPaths;
let projectA: string;
let projectB: string;

beforeEach(async () => {
  temp = await makeTempDir();
  paths = { userDir: join(temp.dir, "user"), managedDir: null, homeDir: join(temp.dir, "home") };
  projectA = join(temp.dir, "a");
  projectB = join(temp.dir, "b");
  await mkdir(projectA, { recursive: true });
  await mkdir(projectB, { recursive: true });
  fakeGroupKit.seen.length = 0;
});

afterEach(async () => {
  await temp.cleanup();
});

function harnessOf(extra: Parameters<typeof createLoaderHarness>[0] = {}): Promise<LoaderHarness> {
  return createLoaderHarness({
    ...extra,
    loader: { fs: realLoaderFs, paths, sdkModules: SDK, ...extra.loader },
  });
}

const signal = new AbortController().signal;

test("on_demand loadAll neither judges nor loads the project of cwd", async () => {
  await writePlugin(join(projectA, ".xeon", "extensions"), "proj-a", { name: "proj-a" });
  const harness = await harnessOf();
  const report = await harness.loader.loadAll(
    harness.options([], { cwd: projectA, trustOverride: true, projects: "on_demand" }),
  );
  expect(report.projectTrust).toBeNull();
  expect(report.extensions).toEqual([]);
  expect(harness.loader.list()).toEqual([]);
});

test("loadProject loads a trusted project once and reports alreadyLoaded the second time", async () => {
  await writePlugin(join(projectA, ".xeon", "extensions"), "proj-a", { name: "proj-a" });
  const harness = await harnessOf();
  await harness.loader.loadAll(harness.options([], { cwd: "/", projects: "on_demand" }));
  const first = await harness.loader.loadProject({
    projectRoot: projectA,
    mode: "headless",
    trustOverride: true,
    signal,
  });
  expect(first.alreadyLoaded).toBe(false);
  expect(first.extensions.map((info) => [info.name, info.source, info.state])).toEqual([
    ["proj-a", "project", "active"],
  ]);
  expect(harness.policy.tiers.get("proj-a")).toBe("project");
  const second = await harness.loader.loadProject({
    projectRoot: projectA,
    mode: "headless",
    trustOverride: true,
    signal,
  });
  expect(second.alreadyLoaded).toBe(true);
  expect(second.extensions).toEqual([]);
  expect(harness.loader.list().map((info) => info.name)).toEqual(["proj-a"]);
});

test("each workspace is judged on its own: the trusted one loads and the denied one does not", async () => {
  await writePlugin(join(projectA, ".xeon", "extensions"), "proj-a", { name: "proj-a" });
  await writePlugin(join(projectB, ".xeon", "extensions"), "proj-b", { name: "proj-b" });
  const harness = await harnessOf();
  await harness.loader.loadAll(harness.options([], { cwd: "/", projects: "on_demand" }));
  const allowed = await harness.loader.loadProject({
    projectRoot: projectA,
    mode: "headless",
    trustOverride: true,
    signal,
  });
  const denied = await harness.loader.loadProject({
    projectRoot: projectB,
    mode: "headless",
    trustOverride: false,
    signal,
  });
  expect(allowed.projectTrust).toMatchObject({ trusted: true });
  expect(denied.projectTrust).toMatchObject({ trusted: false });
  expect(denied.extensions).toEqual([]);
  expect(denied.diagnostics.map((entry) => entry.code)).toEqual(["trust_denied"]);
  expect(harness.loader.list().map((info) => info.name)).toEqual(["proj-a"]);
});

test("an undecided project is judged again on the next call and loads after the decision", async () => {
  await writePlugin(join(projectA, ".xeon", "extensions"), "proj-a", { name: "proj-a" });
  const harness = await harnessOf();
  await harness.loader.loadAll(harness.options([], { cwd: "/", projects: "on_demand" }));
  const undecided = await harness.loader.loadProject({
    projectRoot: projectA,
    mode: "headless",
    signal,
  });
  expect(undecided.projectTrust).toMatchObject({ trusted: false, via: "headless" });
  expect(harness.loader.list()).toEqual([]);
  const decided = await harness.loader.loadProject({
    projectRoot: projectA,
    mode: "headless",
    trustOverride: true,
    signal,
  });
  expect(decided.extensions.map((info) => info.name)).toEqual(["proj-a"]);
});

test("the prompt of a call goes to the prompter passed for that call", async () => {
  await writePlugin(join(projectA, ".xeon", "extensions"), "proj-a", { name: "proj-a" });
  const asked: string[] = [];
  const harness = await harnessOf();
  await harness.loader.loadAll(harness.options([], { cwd: "/", projects: "on_demand" }));
  const choice: TrustChoice = { kind: "session", verdict: "allow" };
  const report = await harness.loader.loadProject({
    projectRoot: projectA,
    mode: "interactive",
    prompter: {
      ask: (request) => {
        asked.push(request.projectRoot);
        return Promise.resolve(choice);
      },
    },
    signal,
  });
  expect(asked).toEqual([projectA]);
  expect(report.projectTrust).toMatchObject({ trusted: true, via: "prompt" });
  expect(report.extensions.map((info) => info.name)).toEqual(["proj-a"]);
});

test("a same-named extension from a second project is rejected with name_conflict", async () => {
  await writePlugin(join(projectA, ".xeon", "extensions"), "shared", { name: "shared" });
  await writePlugin(join(projectB, ".xeon", "extensions"), "shared", { name: "shared" });
  const harness = await harnessOf();
  await harness.loader.loadAll(harness.options([], { cwd: "/", projects: "on_demand" }));
  await harness.loader.loadProject({
    projectRoot: projectA,
    mode: "headless",
    trustOverride: true,
    signal,
  });
  const second = await harness.loader.loadProject({
    projectRoot: projectB,
    mode: "headless",
    trustOverride: true,
    signal,
  });
  expect(second.diagnostics.map((entry) => entry.code)).toContain("name_conflict");
  expect(second.extensions.map((info) => info.state)).toEqual(["rejected"]);
});

test("safe mode makes loadProject a no-op with a safe_mode diagnostic", async () => {
  await writePlugin(join(projectA, ".xeon", "extensions"), "proj-a", { name: "proj-a" });
  const harness = await harnessOf();
  await harness.loader.loadAll(
    harness.options([], {
      cwd: "/",
      projects: "on_demand",
      startup: { safeMode: { active: true }, disabled: [] },
    }),
  );
  const report = await harness.loader.loadProject({
    projectRoot: projectA,
    mode: "headless",
    trustOverride: true,
    signal,
  });
  expect(report.projectTrust).toBeNull();
  expect(report.diagnostics.map((entry) => entry.code)).toEqual(["safe_mode"]);
  expect(harness.loader.list()).toEqual([]);
});

test("a load that is cancelled midway is not remembered and the next call loads the project", async () => {
  await writePlugin(join(projectA, ".xeon", "extensions"), "proj-a", { name: "proj-a" });
  const controller = new AbortController();
  const harness = await harnessOf({
    loader: {
      fs: {
        ...realLoaderFs,
        // 프로젝트 확장 위치를 훑을 때 중단한다
        listDir: (path) => {
          if (path.endsWith(join(".xeon", "extensions"))) controller.abort();
          return realLoaderFs.listDir(path);
        },
      },
    },
  });
  await harness.loader.loadAll(harness.options([], { cwd: "/", projects: "on_demand" }));
  const aborted = await harness.loader
    .loadProject({
      projectRoot: projectA,
      mode: "headless",
      trustOverride: true,
      signal: controller.signal,
    })
    .then(
      () => "loaded",
      () => "cancelled",
    );
  expect(aborted).toBe("cancelled");
  const retry = await harness.loader.loadProject({
    projectRoot: projectA,
    mode: "headless",
    trustOverride: true,
    signal,
  });
  expect(retry.alreadyLoaded).toBe(false);
  expect(retry.extensions.map((info) => info.name)).toEqual(["proj-a"]);
});
