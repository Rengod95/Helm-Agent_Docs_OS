// Plugin UI 로더 통합 시험(X.loading-trust.spec §4.3.4): 실제 임시 디렉터리의 확장과 화면 파일로 5b단계의 결과를 본다.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { LoadOptions, LoaderPaths } from "../../src/loading-trust/index.ts";
import { fakeGroupSdk, SDK, writePlugin } from "./support/plugin-fixture.ts";
import { createLoaderHarness, moduleOf, type LoaderHarness } from "./support/harness.ts";
import { makeTempDir, putFile, realLoaderFs } from "./support/real-fs.ts";

const TEXT_TREE = '{"type":"Text","props":{"text":"hi"}}';
const GRAPH_APP = {
  root: "./ui/graph",
  entry: "index.html",
  bridge: "^1.0.0",
  reason: "canvas graph",
};

/** 깨진 페이지 하나와 맞는 카드 하나 */
const PAGE_AND_CARD = {
  schemaVersion: 1,
  widgets: "^1.0.0",
  items: [
    { id: "page", placement: "page", title: "Page", file: "ui/page.json" },
    { id: "card", placement: "card", title: "Card", forKind: "demo.note", file: "ui/card.json" },
  ],
};

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
  fakeGroupSdk.seen.length = 0;
});

afterEach(async () => {
  await temp.cleanup();
});

function harnessOf(): Promise<LoaderHarness> {
  return createLoaderHarness({ loader: { fs: realLoaderFs, paths, sdkModules: SDK } });
}

function loadOptions(harness: LoaderHarness, extra: Partial<LoadOptions> = {}): LoadOptions {
  return harness.options([], { cwd: project, ...extra });
}

async function fire(harness: LoaderHarness): Promise<void> {
  const thread = harness.t.newThread();
  await harness.t.host.openThread(thread);
  await harness.t.host.dispatch(
    "boundary.settle.after",
    { turnId: harness.t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: "k" },
  );
}

test("a broken screen file leaves the extension active: its hook runs and only that item is invalid", async () => {
  const root = await writePlugin(userExtensions, "demo", { name: "demo", ui: PAGE_AND_CARD });
  await putFile(join(root, "ui", "page.json"), "{");
  await putFile(join(root, "ui", "card.json"), '{"type":"Text"}');
  const harness = await harnessOf();
  const report = await harness.loader.loadAll(loadOptions(harness));
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([["demo", "active"]]);
  expect(
    report.diagnostics.map((entry) => [
      entry.extension,
      entry.stage,
      entry.severity,
      entry.code,
      entry.path,
    ]),
  ).toEqual([["demo", "ui", "error", "ui_invalid", "/ui/items/0/file"]]);
  expect(
    harness.loader
      .uiEntries()
      .map((entry) => [
        entry.extension,
        entry.id,
        entry.state,
        entry.issues.map((issue) => issue.code),
      ]),
  ).toEqual([
    ["demo", "page", "invalid", ["ui_invalid"]],
    ["demo", "card", "ok", []],
  ]);
  await fire(harness);
  expect(fakeGroupSdk.seen).toEqual(["demo:shared:true:true", "demo:fired"]);
});

test("uiEntries carries the manifest version and the install tier", async () => {
  const root = await writePlugin(userExtensions, "demo", {
    name: "demo",
    version: "1.2.3",
    ui: PAGE_AND_CARD,
  });
  await putFile(join(root, "ui", "page.json"), TEXT_TREE);
  await putFile(join(root, "ui", "card.json"), TEXT_TREE);
  const harness = await harnessOf();
  await harness.loader.loadAll(loadOptions(harness));
  expect(harness.loader.uiEntries().map((entry) => [entry.id, entry.version, entry.trust])).toEqual(
    [
      ["page", "1.2.3", "user"],
      ["card", "1.2.3", "user"],
    ],
  );
});

test("a disabled extension's broken screen is still checked, and the extension stays disabled", async () => {
  const root = await writePlugin(userExtensions, "demo", { name: "demo", ui: PAGE_AND_CARD });
  await putFile(join(root, "ui", "page.json"), "{");
  await putFile(join(root, "ui", "card.json"), TEXT_TREE);
  const harness = await harnessOf();
  harness.settings.enabled.set("demo", false);
  const report = await harness.loader.loadAll(loadOptions(harness));
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([["demo", "disabled"]]);
  expect(harness.loader.uiEntries().map((entry) => [entry.id, entry.state])).toEqual([
    ["page", "invalid"],
    ["card", "ok"],
  ]);
});

test("a project-installed app view is served from its fallback until x.ui.allowProjectApps is on", async () => {
  const ui = {
    schemaVersion: 1,
    widgets: "^1.0.0",
    items: [
      {
        id: "graph",
        placement: "page",
        mode: "app",
        title: "Graph",
        app: GRAPH_APP,
        fallback: "ui/fallback.json",
      },
    ],
  };
  const root = await writePlugin(join(project, ".fresnel", "extensions"), "proj", {
    name: "proj",
    ui,
  });
  await putFile(join(root, "ui", "graph", "index.html"), "<html></html>");
  await putFile(join(root, "ui", "fallback.json"), TEXT_TREE);

  const denied = await harnessOf();
  const deniedReport = await denied.loader.loadAll(loadOptions(denied, { trustOverride: true }));
  expect(deniedReport.extensions.map((info) => [info.name, info.source, info.state])).toEqual([
    ["proj", "project", "active"],
  ]);
  expect(
    denied.loader
      .uiEntries()
      .map((entry) => [
        entry.mode,
        entry.state,
        entry.issues.map((issue) => [issue.severity, issue.code]),
      ]),
  ).toEqual([["native", "ok", [["info", "ui_mode_not_allowed"]]]]);

  const allowed = await harnessOf();
  await allowed.loader.loadAll(
    loadOptions(allowed, { trustOverride: true, uiPolicy: { apps: true, allowProjectApps: true } }),
  );
  expect(
    allowed.loader.uiEntries().map((entry) => [entry.mode, entry.state, entry.issues]),
  ).toEqual([["app", "ok", []]]);
});

test("x.ui.apps off turns a user app view into its fallback, or into a disabled item without one", async () => {
  const ui = {
    schemaVersion: 1,
    widgets: "^1.0.0",
    items: [
      {
        id: "graph",
        placement: "page",
        mode: "app",
        title: "Graph",
        app: GRAPH_APP,
        fallback: "ui/fallback.json",
      },
      { id: "plain", placement: "panel", mode: "app", title: "Plain", app: GRAPH_APP },
    ],
  };
  const root = await writePlugin(userExtensions, "demo", { name: "demo", ui });
  await putFile(join(root, "ui", "graph", "index.html"), "<html></html>");
  await putFile(join(root, "ui", "fallback.json"), TEXT_TREE);

  const harness = await harnessOf();
  // 정책을 주지 않은 기본값도 같다: 실기 확인 전 빌드는 앱을 끈다(ADR-0021 §6 미결 1)
  const byDefault = await harnessOf();
  await byDefault.loader.loadAll(loadOptions(byDefault, {}));
  expect(byDefault.loader.uiEntries().map((entry) => [entry.id, entry.mode, entry.state])).toEqual([
    ["graph", "native", "ok"],
    ["plain", "app", "disabled"],
  ]);
  await harness.loader.loadAll(loadOptions(harness, { uiPolicy: { apps: false } }));
  expect(
    harness.loader
      .uiEntries()
      .map((entry) => [
        entry.id,
        entry.mode,
        entry.state,
        entry.issues.map((issue) => issue.severity),
      ]),
  ).toEqual([
    ["graph", "native", "ok", ["info"]],
    ["plain", "app", "disabled", ["warning"]],
  ]);
});

test("a built-in module's screen is not checked, since it has no extension folder", async () => {
  const harness = await harnessOf();
  await harness.loader.loadAll(
    harness.options([
      moduleOf({ name: "core-screen", layer: "L1", extraManifest: { ui: PAGE_AND_CARD } }),
    ]),
  );
  expect(harness.loader.uiEntries()).toEqual([]);
});

test("uiEntries follows the last load: an extension removed from disk drops its entries", async () => {
  const keep = await writePlugin(userExtensions, "keep", { name: "keep", ui: PAGE_AND_CARD });
  await putFile(join(keep, "ui", "page.json"), TEXT_TREE);
  await putFile(join(keep, "ui", "card.json"), TEXT_TREE);
  const gone = await writePlugin(userExtensions, "gone", { name: "gone", ui: PAGE_AND_CARD });
  await putFile(join(gone, "ui", "page.json"), TEXT_TREE);
  await putFile(join(gone, "ui", "card.json"), TEXT_TREE);
  const harness = await harnessOf();
  await harness.loader.loadAll(loadOptions(harness));
  expect(harness.loader.uiEntries().map((entry) => [entry.extension, entry.id])).toEqual([
    ["gone", "page"],
    ["gone", "card"],
    ["keep", "page"],
    ["keep", "card"],
  ]);
  await rm(gone, { recursive: true, force: true });
  await harness.loader.loadAll(loadOptions(harness));
  expect(harness.loader.uiEntries().map((entry) => [entry.extension, entry.id])).toEqual([
    ["keep", "page"],
    ["keep", "card"],
  ]);
});

test("a rejected extension contributes no screen entries", async () => {
  // 매니페스트가 깨졌으면 화면도 읽지 않는다(진단은 manifest_invalid 하나)
  const root = join(userExtensions, "broken");
  await putFile(join(root, ".fresnel-plugin", "plugin.json"), JSON.stringify({ name: "broken" }));
  await putFile(join(root, "ui", "page.json"), TEXT_TREE);
  const harness = await harnessOf();
  const report = await harness.loader.loadAll(loadOptions(harness));
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([
    ["broken", "rejected"],
  ]);
  expect(harness.loader.uiEntries()).toEqual([]);
});
