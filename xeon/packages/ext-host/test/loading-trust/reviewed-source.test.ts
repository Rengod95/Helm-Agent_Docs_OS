// 검토본 목록 포트(M5c §4.6): 포트가 있으면 사용자·프로젝트·번들 외부 확장을 원본 폴더 대신 검토본 `tree/`에서 싣고,
// 판 식별자 `versionId`는 내용 해시이며, 무결성 진단은 보고에 남는다. 포트가 없으면 기존 탐색 그대로다(다른 시험이 본다).
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  LoaderIsolation,
  LoaderPaths,
  ReviewedSource,
  ReviewedSourceDiagnostic,
  ReviewedSourceEntry,
} from "../../src/loading-trust/index.ts";
import {
  createFakeProcessPort,
  createManualClock,
  type FakeProcessPort,
  type ManualClock,
} from "../isolation/support/fake-process.ts";
import { createLoaderHarness, type LoaderHarness } from "./support/harness.ts";
import { makeTempDir, putFile, realLoaderFs } from "./support/real-fs.ts";
import { writePlugin } from "./support/plugin-fixture.ts";

/** 빈 등록을 하는 엔트리. 격리 자식이 import해도 호스트 모듈이 필요 없다 */
const ENGINE_ENTRY = `export const extension = ({ register }) => {
  register("iso", {}, (g) => {
    g.on("boundary.settle.after", () => {});
  });
};
`;

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

let temp: Awaited<ReturnType<typeof makeTempDir>>;
let paths: LoaderPaths;
let userExtensions: string;
let project: string;
let reviewedRoot: string;

beforeEach(async () => {
  temp = await makeTempDir();
  paths = { userDir: join(temp.dir, "user"), managedDir: null, homeDir: join(temp.dir, "home") };
  userExtensions = join(paths.userDir, "extensions");
  project = join(temp.dir, "project");
  reviewedRoot = join(temp.dir, "plugin-store", "reviewed");
  await mkdir(project, { recursive: true });
});

afterEach(async () => {
  await temp.cleanup();
});

/** 검토본 `tree/`에 코드 없는 매니페스트를 쓴다(루트 플러그인 하나, 설정과 훅 없음) */
async function reviewedTree(name: string, hash: string): Promise<string> {
  const root = join(reviewedRoot, name, hash.slice("sha256:".length), "tree");
  await putFile(
    join(root, ".fresnel-plugin", "plugin.json"),
    JSON.stringify({ schemaVersion: 2, name, version: "1.0.0" }),
  );
  return root;
}

/** 목록을 시험 중에 바꾸는 검토본 포트 대역 */
function portOf(state: {
  entries: ReviewedSourceEntry[];
  diagnostics?: ReviewedSourceDiagnostic[];
}): ReviewedSource {
  return {
    list: () => Promise.resolve({ entries: state.entries, diagnostics: state.diagnostics ?? [] }),
  };
}

async function harnessOf(reviewedSource: ReviewedSource): Promise<LoaderHarness> {
  return createLoaderHarness({ loader: { fs: realLoaderFs, paths, reviewedSource } });
}

test("with a reviewed source the user folder is not scanned and each reviewed tree loads from its root", async () => {
  // 원본 폴더에 있는 것은 검토본이 없으니 싣지 않는다
  await writePlugin(userExtensions, "ghost", { name: "ghost" });
  const kitRoot = await reviewedTree("kit", HASH_A);
  const bundledRoot = await reviewedTree("helm", HASH_B);
  const harness = await harnessOf(
    portOf({
      entries: [
        { name: "kit", source: "user", root: kitRoot, contentHash: HASH_A },
        { name: "helm", source: "bundled", root: bundledRoot, contentHash: HASH_B },
      ],
    }),
  );
  const report = await harness.loader.loadAll(harness.options([], { cwd: project }));
  expect(report.diagnostics).toEqual([]);
  expect(report.extensions.map((info) => [info.name, info.source, info.state, info.root])).toEqual([
    ["helm", "user", "active", bundledRoot],
    ["kit", "user", "active", kitRoot],
  ]);
});

test("a reviewed tree without a manifest and without an inferred one from the host is not loaded and raises no diagnostic", async () => {
  // 매니페스트 파일도 호스트의 추론도 없는 검토본은 싣지 않는다. 진단은 남기지 않는다(목록이 이미 거른 것이다)
  const skillRoot = join(reviewedRoot, "skills", HASH_A.slice("sha256:".length), "tree");
  await putFile(join(skillRoot, "SKILL.md"), "---\nname: skills\n---\n");
  const harness = await harnessOf(
    portOf({ entries: [{ name: "skills", source: "user", root: skillRoot, contentHash: HASH_A }] }),
  );
  const report = await harness.loader.loadAll(harness.options([], { cwd: project }));
  expect(report.extensions).toEqual([]);
  expect(report.diagnostics).toEqual([]);
});

test("a reviewed copy with no manifest file loads with the manifest the host infers for it; it runs no code and registers its plugin", async () => {
  // 스킬 폴더에서 옮긴 검토본: 파일이 없고 호스트가 추론 매니페스트를 준다. 엔트리가 없어 코드는 돌지 않고, 선언한 플러그인 하나의 등록이 생긴다
  const skillRoot = join(reviewedRoot, "skills", HASH_A.slice("sha256:".length), "tree");
  await putFile(join(skillRoot, "SKILL.md"), "---\nname: skills\n---\n");
  const inferred = {
    schemaVersion: 2 as const,
    name: "skills",
    version: "0.0.0-aaaaaaaa",
    plugins: [{ layer: "plugin" as const, hooks: [] }],
  };
  const harness = await harnessOf(
    portOf({
      entries: [
        {
          name: "skills",
          source: "user",
          root: skillRoot,
          contentHash: HASH_A,
          manifest: inferred,
        },
      ],
    }),
  );
  const report = await harness.loader.loadAll(harness.options([], { cwd: project }));
  expect(report.diagnostics).toEqual([]);
  expect(report.extensions.map((info) => [info.name, info.source, info.state, info.root])).toEqual([
    ["skills", "user", "active", skillRoot],
  ]);
  expect(harness.loader.list().map((info) => info.manifest?.name)).toEqual(["skills"]);
  expect(harness.t.host.registrations().map((registration) => registration.extension)).toEqual([
    "skills",
  ]);
});

test("integrity diagnostics from the port reach the report and the corrupt entry is not in the list", async () => {
  const diagnostics: ReviewedSourceDiagnostic[] = [
    { name: "bad", source: "user", code: "pinned_corrupt", message: "hash differs from meta.json" },
  ];
  const harness = await harnessOf(portOf({ entries: [], diagnostics }));
  const report = await harness.loader.loadAll(harness.options([], { cwd: project }));
  expect(report.extensions).toEqual([]);
  expect(
    report.diagnostics.map((entry) => [entry.extension, entry.code, entry.severity, entry.source]),
  ).toEqual([["bad", "pinned_corrupt", "error", "user"]]);
});

test("loadInstalled finds the reviewed copy by name and refuses a name the store does not hold", async () => {
  const kitRoot = await reviewedTree("kit", HASH_A);
  const state: { entries: ReviewedSourceEntry[] } = { entries: [] };
  const harness = await harnessOf(portOf(state));
  await harness.loader.loadAll(harness.options([], { cwd: project }));
  expect((await harness.loader.loadInstalled("kit", new AbortController().signal)).ok).toBe(false);

  state.entries = [{ name: "kit", source: "user", root: kitRoot, contentHash: HASH_A }];
  const loaded = await harness.loader.loadInstalled("kit", new AbortController().signal);
  expect(loaded.ok).toBe(true);
  expect(harness.loader.list().map((info) => [info.name, info.state])).toEqual([["kit", "active"]]);

  const missing = await harness.loader.loadInstalled("nope", new AbortController().signal);
  expect(missing.ok).toBe(false);
  if (!missing.ok) expect(missing.error.kind).toBe("not_found");
});

test("project entries load only after the project is trusted, and the project folder is not scanned", async () => {
  await writePlugin(join(project, ".fresnel", "extensions"), "folder-ghost", {
    name: "folder-ghost",
  });
  const projectRoot = await reviewedTree("pj", HASH_B);
  const harness = await harnessOf(
    portOf({
      entries: [{ name: "pj", source: "project", root: projectRoot, contentHash: HASH_B }],
    }),
  );
  // 신뢰 판정 전에는 프로젝트 확장을 싣지 않는다
  const before = await harness.loader.loadAll(harness.options([], { cwd: project }));
  expect(before.extensions.map((info) => info.name)).toEqual([]);

  const loaded = await harness.loader.loadProject({
    projectRoot: project,
    mode: "headless",
    trustOverride: true,
    signal: new AbortController().signal,
  });
  expect(loaded.extensions.map((info) => [info.name, info.source, info.state])).toEqual([
    ["pj", "project", "active"],
  ]);
});

test("the isolated process key is the content hash of the reviewed copy, not the manifest version", async () => {
  const launches: string[] = [];
  const port: FakeProcessPort = createFakeProcessPort();
  const clock: ManualClock = createManualClock();
  const isolation: LoaderIsolation = {
    launch: (info) => {
      launches.push(info.versionId);
      return { command: "plugin-host", args: [], env: {} };
    },
    setTimer: clock.setTimer,
    initTimeoutMs: 1000,
  };
  // 코드가 있는 검토본: 엔트리를 가진 트리를 검토본 자리에 쓴다
  const root = await writePlugin(
    join(reviewedRoot, "iso", HASH_A.slice("sha256:".length)),
    "tree",
    {
      name: "iso",
      entry: ENGINE_ENTRY,
    },
  );
  const harness = await createLoaderHarness({
    loader: {
      fs: realLoaderFs,
      paths,
      process: port,
      isolation,
      reviewedSource: portOf({
        entries: [{ name: "iso", source: "user", root, contentHash: HASH_A }],
      }),
    },
  });
  const report = await harness.loader.loadAll(harness.options([], { cwd: project }));
  expect(report.extensions.map((info) => [info.name, info.isolation])).toEqual([
    ["iso", "process"],
  ]);
  expect(launches).toEqual([HASH_A]);
  await harness.loader.dispose();
});

test("reloadFromReviewed reads the copy the list names now, and the loaded record takes its version and content hash", async () => {
  const oldRoot = await reviewedTree("kit", HASH_A);
  const state: { entries: ReviewedSourceEntry[] } = {
    entries: [{ name: "kit", source: "user", root: oldRoot, contentHash: HASH_A }],
  };
  const harness = await harnessOf(portOf(state));
  await harness.loader.loadAll(harness.options([], { cwd: project }));
  // 승인으로 검토본이 새 판이 되었다. 목록이 새 `tree/`를 가리키고 다시 읽기가 그것을 싣는다
  const newRoot = join(reviewedRoot, "kit", HASH_B.slice("sha256:".length), "tree");
  await putFile(
    join(newRoot, ".fresnel-plugin", "plugin.json"),
    JSON.stringify({ schemaVersion: 2, name: "kit", version: "1.1.0" }),
  );
  state.entries = [{ name: "kit", source: "user", root: newRoot, contentHash: HASH_B }];
  const started = await harness.loader.reloadFromReviewed("kit", new AbortController().signal);
  expect(started.ok).toBe(true);
  if (!started.ok) return;
  expect((await started.value.applied).status).toBe("applied");
  const loaded = harness.loader.list().find((info) => info.name === "kit");
  expect([loaded?.version, loaded?.contentHash, loaded?.root]).toEqual(["1.1.0", HASH_B, newRoot]);
});

test("reloadFromReviewed of a name the reviewed list no longer names is rejected and the running copy keeps running", async () => {
  const oldRoot = await reviewedTree("kit", HASH_A);
  const state: { entries: ReviewedSourceEntry[] } = {
    entries: [{ name: "kit", source: "user", root: oldRoot, contentHash: HASH_A }],
  };
  const harness = await harnessOf(portOf(state));
  await harness.loader.loadAll(harness.options([], { cwd: project }));
  state.entries = [];
  const started = await harness.loader.reloadFromReviewed("kit", new AbortController().signal);
  expect(started.ok ? "accepted" : started.error.kind).toBe("rejected");
  const loaded = harness.loader.list().find((info) => info.name === "kit");
  expect([loaded?.contentHash, loaded?.root]).toEqual([HASH_A, oldRoot]);
});
