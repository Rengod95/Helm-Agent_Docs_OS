// 지연 적재(M5c §4.1.11, LoadOptions.defaultNames): 시작 때는 기본 집합 밖의 외부 확장을 매니페스트 `defaultEnabled`와 무관하게 싣지 않는다.
// 대화가 쓰면 `ensureLoaded`가 검토본 사본에서 싣고, `unload`는 기록을 꺼진 채 남겨 같은 이름을 다시 싣게 한다. 실제 임시 디렉터리와 실제 파이프라인.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { DependencyDecl } from "@fresnel/contracts/extensions";
import { registrationToggleSourceOf } from "../../src/index.ts";
import type {
  BuiltinExtensionModule,
  LoaderPaths,
  ReviewedSource,
  ReviewedSourceEntry,
} from "../../src/loading-trust/index.ts";
import { createLoaderHarness, moduleOf, type LoaderHarness } from "./support/harness.ts";
import { fakeOrchestrationSdk, SDK, writePlugin } from "./support/plugin-fixture.ts";
import { makeTempDir, realLoaderFs } from "./support/real-fs.ts";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const signal = new AbortController().signal;

let temp: Awaited<ReturnType<typeof makeTempDir>>;
let paths: LoaderPaths;
let project: string;
let reviewedRoot: string;

beforeEach(async () => {
  temp = await makeTempDir();
  paths = { userDir: join(temp.dir, "user"), managedDir: null, homeDir: join(temp.dir, "home") };
  project = join(temp.dir, "project");
  reviewedRoot = join(temp.dir, "plugin-store", "reviewed");
  await mkdir(project, { recursive: true });
  fakeOrchestrationSdk.seen.length = 0;
});

afterEach(async () => {
  await temp.cleanup();
});

/** 검토본 `tree/`에 플러그인을 쓰고 그 루트를 돌려준다 */
function reviewedRootOf(name: string, hash: string): Promise<string> {
  return writePlugin(join(reviewedRoot, name, hash.slice("sha256:".length)), "tree", {
    name,
    defaultEnabled: false,
  });
}

/** 목록을 시험 중에 바꾸는 검토본 포트 대역(승인이 current를 바꾸는 것을 흉내 낸다) */
function portOf(state: { entries: ReviewedSourceEntry[] }): ReviewedSource {
  return { list: () => Promise.resolve({ entries: state.entries, diagnostics: [] }) };
}

async function harnessOf(reviewedSource: ReviewedSource): Promise<LoaderHarness> {
  return createLoaderHarness({
    loader: { fs: realLoaderFs, paths, reviewedSource, sdkModules: SDK },
  });
}

/** 대화 하나를 연다(적재 뒤에 연다. 기존 시험 `load-installed`와 같은 순서) */
async function openThread(harness: LoaderHarness): Promise<ThreadId> {
  const thread = harness.t.newThread();
  await harness.t.host.openThread(thread);
  return thread;
}

async function fireIn(harness: LoaderHarness, thread: ThreadId, key: string): Promise<void> {
  await harness.t.host.dispatch(
    "boundary.settle.after",
    { turnId: harness.t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: key },
  );
}

/**
 * 매니페스트 기본이 꺼진 등록은 설치 뒤 꺼진 채 있다. 대화의 E(T)가 켜는 일을 시험에서는 그 대화만의 켜기 요청과 적용으로 흉내 낸다
 * (호스트의 `RegistrationToggleSourceOf`가 같은 경로를 쓴다)
 */
async function profileEnables(
  harness: LoaderHarness,
  thread: ThreadId,
  name: string,
): Promise<void> {
  const toggles = registrationToggleSourceOf(harness.t.host);
  toggles.request(name, true, "request", thread);
  await toggles.applyNow(thread);
}

/** 발화 기록만 본다. 기본 엔트리는 설치 때 `:shared:` 검증 기록도 남긴다 */
function fired(): string[] {
  return fakeOrchestrationSdk.seen.filter((entry) => !entry.includes(":shared:"));
}

test("startup leaves a reviewed plugin outside the default set off; the first ensureLoaded loads it from the reviewed copy", async () => {
  const lazyRoot = await reviewedRootOf("lazy-kit", HASH_A);
  const eagerRoot = await writePlugin(join(reviewedRoot, "eager-kit", "a"), "tree", {
    name: "eager-kit",
  });
  const state = {
    entries: [
      { name: "lazy-kit", source: "user" as const, root: lazyRoot, contentHash: HASH_A },
      { name: "eager-kit", source: "user" as const, root: eagerRoot, contentHash: HASH_A },
    ],
  };
  const harness = await harnessOf(portOf(state));
  const report = await harness.loader.loadAll({
    ...harness.options([], { cwd: project }),
    defaultNames: ["eager-kit"],
  });

  // 기본 집합 밖이라 시작 때 싣지 않는다. 기록은 꺼진 채 남고 이유 진단이 있다
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([
    ["eager-kit", "active"],
    ["lazy-kit", "disabled"],
  ]);
  const lazy = report.extensions.find((info) => info.name === "lazy-kit");
  expect(lazy?.diagnostics.map((entry) => entry.code)).toEqual(["lazy_deferred"]);
  const thread = await openThread(harness);
  await fireIn(harness, thread, "startup");
  expect(fired()).toEqual(["eager-kit:fired"]);

  // 대화가 쓰면 검토본 사본에서 싣는다
  const first = await harness.loader.ensureLoaded("lazy-kit", signal);
  expect(first.state).toBe("active");
  expect(first.root).toBe(lazyRoot);
  await profileEnables(harness, thread, "lazy-kit");
  fakeOrchestrationSdk.seen.length = 0;
  await fireIn(harness, thread, "first");
  expect(fired()).toEqual(["eager-kit:fired", "lazy-kit:fired"]);

  // 내리면 기록은 남고, 같은 이름을 다시 싣는다. 세대가 올라간다
  expect(await harness.loader.unload("lazy-kit")).toBe(true);
  expect(harness.loader.list().find((info) => info.name === "lazy-kit")?.state).toBe("disabled");
  fakeOrchestrationSdk.seen.length = 0;
  await fireIn(harness, thread, "off");
  expect(fired()).toEqual(["eager-kit:fired"]);
  const again = await harness.loader.ensureLoaded("lazy-kit", signal);
  expect(again.state).toBe("active");
  expect(again.generation).toBeGreaterThan(first.generation);
  await profileEnables(harness, thread, "lazy-kit");
  fakeOrchestrationSdk.seen.length = 0;
  await fireIn(harness, thread, "again");
  expect(fired()).toEqual(["eager-kit:fired", "lazy-kit:fired"]);
});

test("a copy approved while the plugin was off is the one ensureLoaded runs", async () => {
  const oldRoot = await reviewedRootOf("lazy-kit", HASH_A);
  const state = {
    entries: [{ name: "lazy-kit", source: "user" as const, root: oldRoot, contentHash: HASH_A }],
  };
  const harness = await harnessOf(portOf(state));
  await harness.loader.loadAll({ ...harness.options([], { cwd: project }), defaultNames: [] });
  expect(harness.loader.list().map((info) => info.state)).toEqual(["disabled"]);

  // 승인으로 current가 v2로 바뀌었다. 꺼진 기록은 시작 때 본 v1을 쥐고 있다
  const newRoot = await writePlugin(join(reviewedRoot, "lazy-kit", "b"), "tree", {
    name: "lazy-kit",
    defaultEnabled: false,
    entry: `import * as kit from "${["@fresnel", "orchestration-sdk"].join("/")}";
export const extension = ({ register }) => {
  register("lazy-kit", {}, (g) => {
    g.on("boundary.settle.after", () => { kit.record("lazy-kit:v2"); });
  });
};
`,
  });
  state.entries = [{ name: "lazy-kit", source: "user", root: newRoot, contentHash: HASH_B }];

  const thread = await openThread(harness);
  const loaded = await harness.loader.ensureLoaded("lazy-kit", signal);
  expect(loaded.state).toBe("active");
  expect(loaded.root).toBe(newRoot);
  expect(loaded.contentHash).toBe(HASH_B);
  await profileEnables(harness, thread, "lazy-kit");
  await fireIn(harness, thread, "v2");
  expect(fired()).toEqual(["lazy-kit:v2"]);
});

test("a deferred plugin with no default set is loaded at startup as before", async () => {
  // 기본 집합을 주지 않으면 모두 시작 때 싣는다(이전 동작)
  const root = await reviewedRootOf("lazy-kit", HASH_A);
  const state = {
    entries: [{ name: "lazy-kit", source: "user" as const, root, contentHash: HASH_A }],
  };
  const harness = await harnessOf(portOf(state));
  const report = await harness.loader.loadAll(harness.options([], { cwd: project }));
  expect(report.extensions.map((info) => info.state)).toEqual(["active"]);
});

test("a default-off plugin is held off only by a lock; with no lock its first ensureLoaded loads it (the manifest default is not a lock)", async () => {
  // 매니페스트 기본이 꺼진 확장도 잠기지 않았으면 대화가 쓰는 순간 싣는다. 잠금(거짓)만 막는다(M5c §4.1.10)
  const root = await reviewedRootOf("lazy-kit", HASH_A);
  const state = {
    entries: [{ name: "lazy-kit", source: "user" as const, root, contentHash: HASH_A }],
  };
  const harness = await harnessOf(portOf(state));
  await harness.loader.loadAll({ ...harness.options([], { cwd: project }), defaultNames: [] });
  expect(harness.loader.list().map((info) => info.state)).toEqual(["disabled"]);

  harness.settings.enabled.set("lazy-kit", false);
  const locked = await harness.loader.ensureLoaded("lazy-kit", signal);
  expect(locked.state).toBe("disabled");
  expect(locked.diagnostics.map((entry) => entry.code)).toEqual(["disabled_by_setting"]);

  harness.settings.enabled.delete("lazy-kit");
  const unlocked = await harness.loader.ensureLoaded("lazy-kit", signal);
  expect(unlocked.state).toBe("active");
  expect(unlocked.diagnostics).toEqual([]);
});

test("startup does not load an outside-the-default-set plugin even when its manifest says defaultEnabled true", async () => {
  const onRoot = await writePlugin(join(reviewedRoot, "on-kit", "a"), "tree", {
    name: "on-kit",
    defaultEnabled: true,
  });
  const state = {
    entries: [{ name: "on-kit", source: "user" as const, root: onRoot, contentHash: HASH_A }],
  };
  const harness = await harnessOf(portOf(state));
  const report = await harness.loader.loadAll({
    ...harness.options([], { cwd: project }),
    defaultNames: [],
  });
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([
    ["on-kit", "disabled"],
  ]);
  const thread = await openThread(harness);
  await fireIn(harness, thread, "startup");
  expect(fired()).toEqual([]);
});

// AGE-33 enDep: 기본 집합의 확장이 hard로 기대는 대상은 시작 때 미루지 않는다. 미루면 기대는 쪽이 `dependency_missing`으로 멈춘다.
// soft로만 기대는 대상은 기본 집합 밖이면 미룬 채 두고(경고만 남는다), hard 닫힘의 대상만 기본 집합에 더해 싣는다.

/** `dependsOn`을 가진 내장 확장 한 개. 설치될 때마다 `installed`에 이름을 남긴다 */
function dependentOf(
  name: string,
  dependsOn: readonly DependencyDecl[],
  installed: string[],
): BuiltinExtensionModule {
  return moduleOf(
    {
      name,
      manifest: {
        schemaVersion: 2,
        name,
        version: "1.0.0",
        entry: "./src/index.ts",
        plugins: [{ layer: "plugin", hooks: [], dependsOn: [...dependsOn] }],
      },
    },
    () => {
      installed.push(name);
    },
  );
}

test("a default-set plugin's hard target outside the default set is loaded at startup, target first", async () => {
  const harness = await createLoaderHarness();
  const installed: string[] = [];
  const report = await harness.loader.loadAll(
    harness.options(
      [
        dependentOf("app-kit", [{ plugin: "core-kit", kind: "hard" }], installed),
        dependentOf("core-kit", [], installed),
      ],
      { defaultNames: ["app-kit"] },
    ),
  );
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([
    ["app-kit", "active"],
    ["core-kit", "active"],
  ]);
  expect(report.diagnostics).toEqual([]);
  expect(installed).toEqual(["core-kit", "app-kit"]);
});

test("the hard closure of a default-set plugin is pulled in transitively", async () => {
  const harness = await createLoaderHarness();
  const installed: string[] = [];
  const report = await harness.loader.loadAll(
    harness.options(
      [
        dependentOf("app-kit", [{ plugin: "mid-kit", kind: "hard" }], installed),
        dependentOf("mid-kit", [{ plugin: "base-kit", kind: "hard" }], installed),
        dependentOf("base-kit", [], installed),
        dependentOf("other-kit", [], installed),
      ],
      { defaultNames: ["app-kit"] },
    ),
  );
  // 보고는 로드 순서(이름순)다. 설치 순서(hard 대상이 먼저)는 아래에서 따로 본다
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([
    ["app-kit", "active"],
    ["base-kit", "active"],
    ["mid-kit", "active"],
    ["other-kit", "disabled"],
  ]);
  expect(installed).toEqual(["base-kit", "mid-kit", "app-kit"]);
});

test("a soft target outside the default set stays deferred and the default-set plugin only warns", async () => {
  const harness = await createLoaderHarness();
  const installed: string[] = [];
  const report = await harness.loader.loadAll(
    harness.options(
      [
        dependentOf("app-kit", [{ plugin: "core-kit", kind: "soft" }], installed),
        dependentOf("core-kit", [], installed),
      ],
      { defaultNames: ["app-kit"] },
    ),
  );
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([
    ["app-kit", "active"],
    ["core-kit", "disabled"],
  ]);
  expect(report.diagnostics.map((entry) => [entry.extension, entry.code, entry.severity])).toEqual([
    ["core-kit", "lazy_deferred", "info"],
    ["app-kit", "dependency_missing", "warning"],
  ]);
  expect(installed).toEqual(["app-kit"]);
});
