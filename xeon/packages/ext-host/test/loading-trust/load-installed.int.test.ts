// 설치 뒤 새 이름 싣기(ExtensionLoader.loadInstalled, unload, X.loading-trust.spec §4.4.4): 실제 임시 디렉터리와 실제 파이프라인.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { LoaderPaths } from "../../src/loading-trust/index.ts";
import { fakeOrchestrationSdk, SDK, writePlugin } from "./support/plugin-fixture.ts";
import { createLoaderHarness, type LoaderHarness } from "./support/harness.ts";
import { makeTempDir, putFile, realLoaderFs } from "./support/real-fs.ts";

let temp: Awaited<ReturnType<typeof makeTempDir>>;
let paths: LoaderPaths;
let userExtensions: string;
const signal = new AbortController().signal;

beforeEach(async () => {
  temp = await makeTempDir();
  paths = { userDir: join(temp.dir, "user"), managedDir: null, homeDir: join(temp.dir, "home") };
  userExtensions = join(paths.userDir, "extensions");
  await mkdir(userExtensions, { recursive: true });
  fakeOrchestrationSdk.seen.length = 0;
});

afterEach(async () => {
  await temp.cleanup();
});

async function started(): Promise<{
  harness: LoaderHarness;
  thread: ReturnType<LoaderHarness["t"]["newThread"]>;
}> {
  const harness = await createLoaderHarness({
    loader: { fs: realLoaderFs, paths, sdkModules: SDK },
  });
  const project = join(temp.dir, "project");
  await mkdir(project, { recursive: true });
  await harness.loader.loadAll(harness.options([], { cwd: project }));
  const thread = harness.t.newThread();
  await harness.t.host.openThread(thread);
  return { harness, thread };
}

async function fireIn(
  harness: LoaderHarness,
  thread: ReturnType<LoaderHarness["t"]["newThread"]>,
  key: string,
): Promise<void> {
  await harness.t.host.dispatch(
    "boundary.settle.after",
    { turnId: harness.t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: key },
  );
}

test("a new name installed after startup is listed and its hook fires without a restart", async () => {
  const { harness, thread } = await started();
  expect(harness.loader.list()).toEqual([]);
  await writePlugin(userExtensions, "fresh", { name: "fresh" });
  const result = await harness.loader.loadInstalled("fresh", signal);
  if (!result.ok) throw new Error(`load refused: ${JSON.stringify(result.error)}`);
  expect(result.value.appliesAt).toBe("now");
  expect(result.value.info).toMatchObject({
    name: "fresh",
    source: "user",
    trust: "user",
    state: "active",
  });
  // 시작 때와 같은 길이라 tier를 얻는다(우회 없음)
  expect(harness.policy.tiers.get("fresh")).toBe("user");
  expect(harness.loader.list().map((info) => [info.name, info.state])).toEqual([
    ["fresh", "active"],
  ]);
  await fireIn(harness, thread, "k0");
  expect(fakeOrchestrationSdk.seen).toContain("fresh:fired");
});

test("during a running turn the new name turns on at the next step boundary", async () => {
  const { harness, thread } = await started();
  harness.t.loop.setRunning(thread, true);
  await writePlugin(userExtensions, "late", { name: "late" });
  const result = await harness.loader.loadInstalled("late", signal);
  if (!result.ok) throw new Error("load refused");
  expect(result.value.appliesAt).toBe("nextStepBoundary");
  expect(harness.t.host.registration("late")?.status).not.toBe("enabled");
  fakeOrchestrationSdk.seen.length = 0;
  await fireIn(harness, thread, "k0");
  expect(fakeOrchestrationSdk.seen).not.toContain("late:fired");
  await harness.t.boundary(thread).stepEnd();
  await harness.t.settled();
  expect(harness.t.host.registration("late")?.status).toBe("enabled");
  await fireIn(harness, thread, "k1");
  expect(fakeOrchestrationSdk.seen).toContain("late:fired");
});

test("a package whose entry does not import is refused, leaves no record and can be installed again", async () => {
  const { harness } = await started();
  const root = await writePlugin(userExtensions, "broken", {
    name: "broken",
    entry: "export const extension = (;\n",
  });
  const refused = await harness.loader.loadInstalled("broken", signal);
  expect(refused.ok).toBe(false);
  if (refused.ok) return;
  if (refused.error.kind !== "not_active") throw new Error(`unexpected ${refused.error.kind}`);
  expect(refused.error.state).toBe("error");
  expect(refused.error.diagnostics.map((entry) => entry.code)).toEqual(["entry_import_failed"]);
  expect(harness.loader.list()).toEqual([]);
  expect(harness.t.host.registrations()).toEqual([]);
  // 고쳐서 다시 설치하면 실린다
  await putFile(
    join(root, "src", "index.ts"),
    `export const extension = ({ register }) => { register("broken", {}, () => {}); };\n`,
  );
  const again = await harness.loader.loadInstalled("broken", signal);
  expect(again.ok).toBe(true);
});

test("an invalid manifest and a missing install are refused", async () => {
  const { harness } = await started();
  await putFile(join(userExtensions, "bad", ".fresnel-plugin", "plugin.json"), "{ not json");
  const bad = await harness.loader.loadInstalled("bad", signal);
  expect(bad.ok).toBe(false);
  if (bad.ok) return;
  if (bad.error.kind !== "not_active") throw new Error(`unexpected ${bad.error.kind}`);
  expect(bad.error.diagnostics.map((entry) => entry.code)).toEqual(["manifest_parse"]);
  const missing = await harness.loader.loadInstalled("nothing", signal);
  expect(missing.ok).toBe(false);
  if (missing.ok) return;
  expect(missing.error.kind).toBe("not_found");
  expect(harness.loader.list()).toEqual([]);
});

test("a name that is already loaded is left to reload", async () => {
  await writePlugin(userExtensions, "hello", { name: "hello" });
  const { harness } = await started();
  const result = await harness.loader.loadInstalled("hello", signal);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.kind).toBe("already_loaded");
});

test("unload takes the extension out of the host, keeps a disabled record, and ensureLoaded brings it back", async () => {
  const { harness, thread } = await started();
  await writePlugin(userExtensions, "gone", { name: "gone" });
  const installed = await harness.loader.loadInstalled("gone", signal);
  if (!installed.ok) throw new Error(`load refused: ${JSON.stringify(installed.error)}`);
  const before = installed.value.info.generation;
  expect(await harness.loader.unload("gone")).toBe(true);
  expect(harness.loader.list().map((info) => [info.name, info.state])).toEqual([
    ["gone", "disabled"],
  ]);
  expect(harness.t.host.registration("gone")).toBeUndefined();
  expect(harness.policy.tiers.get("gone")).toBeUndefined();
  fakeOrchestrationSdk.seen.length = 0;
  await fireIn(harness, thread, "k0");
  expect(fakeOrchestrationSdk.seen).not.toContain("gone:fired");
  // 같은 이름의 `ensureLoaded`는 기록이 있으니 `unknown_extension`으로 멈추지 않고, 새 세대로 다시 싣는다
  const again = await harness.loader.ensureLoaded("gone", signal);
  expect(again.state).toBe("active");
  expect(again.generation).toBeGreaterThan(before);
  await fireIn(harness, thread, "k1");
  expect(fakeOrchestrationSdk.seen).toContain("gone:fired");
});

test("a package that throws while loading, then is fixed in place, loads on the second install", async () => {
  const { harness, thread } = await started();
  const root = await writePlugin(userExtensions, "flaky", {
    name: "flaky",
    entry: `throw new Error("flaky cannot load");\n`,
  });
  const first = await harness.loader.loadInstalled("flaky", signal);
  expect(first.ok).toBe(false);
  // 같은 경로를 고쳐 쓰면 Bun의 모듈 캐시가 아니라 새로 평가한 코드가 실린다
  await putFile(
    join(root, "src", "index.ts"),
    `import * as kit from "${["@fresnel", "group-sdk"].join("/")}";
export const extension = ({ register }) => {
  register("flaky", {}, (g) => {
    g.on("boundary.settle.after", () => { kit.record("flaky:fixed"); });
  });
};
`,
  );
  const second = await harness.loader.loadInstalled("flaky", signal);
  if (!second.ok) throw new Error(`load refused: ${JSON.stringify(second.error)}`);
  await fireIn(harness, thread, "k0");
  expect(fakeOrchestrationSdk.seen).toContain("flaky:fixed");
  // 내리고 고쳐 다시 실어도 새 코드가 돈다
  expect(await harness.loader.unload("flaky")).toBe(true);
  await putFile(
    join(root, "src", "index.ts"),
    `import * as kit from "${["@fresnel", "group-sdk"].join("/")}";
export const extension = ({ register }) => {
  register("flaky", {}, (g) => {
    g.on("boundary.settle.after", () => { kit.record("flaky:third"); });
  });
};
`,
  );
  expect((await harness.loader.ensureLoaded("flaky", signal)).state).toBe("active");
  fakeOrchestrationSdk.seen.length = 0;
  await fireIn(harness, thread, "k1");
  expect(fakeOrchestrationSdk.seen).toEqual(["flaky:third"]);
});

test("deferStart records a disabled entry without running the code, and ensureLoaded loads it the first time", async () => {
  const { harness, thread } = await started();
  await writePlugin(userExtensions, "approved", { name: "approved" });
  const recorded = await harness.loader.loadInstalled("approved", signal, { deferStart: true });
  expect(recorded.ok).toBe(false);
  if (recorded.ok) return;
  expect(recorded.error.kind).toBe("not_active");
  if (recorded.error.kind !== "not_active") return;
  expect(recorded.error.state).toBe("disabled");
  expect(harness.loader.list().map((info) => [info.name, info.state])).toEqual([
    ["approved", "disabled"],
  ]);
  // 코드는 싣지 않았다: 호스트에 등록이 없고 훅이 불리지 않는다
  expect(harness.t.host.registration("approved")).toBeUndefined();
  expect(harness.policy.tiers.get("approved")).toBeUndefined();
  fakeOrchestrationSdk.seen.length = 0;
  await fireIn(harness, thread, "k0");
  expect(fakeOrchestrationSdk.seen).not.toContain("approved:fired");
  // 처음 대화의 집합에 들 때 `ensureLoaded`가 싣는다
  const loaded = await harness.loader.ensureLoaded("approved", signal);
  expect(loaded.state).toBe("active");
  await fireIn(harness, thread, "k1");
  expect(fakeOrchestrationSdk.seen).toContain("approved:fired");
});
