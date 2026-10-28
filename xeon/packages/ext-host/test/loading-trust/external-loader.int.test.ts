// 외부 확장 로더 통합 시험(M3-REQ-29, 34, 110): 실제 임시 디렉터리의 플러그인을 발견하고 import해 로드한다.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import {
  LoadAbortError,
  type LoadDiagnostic,
  type LoadOptions,
  type LoaderPaths,
} from "../../src/loading-trust/index.ts";
import { fakeGroupKit, SDK, writePlugin } from "./support/plugin-fixture.ts";
import { createLoaderHarness, moduleOf, type LoaderHarness } from "./support/harness.ts";
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

function loadOptions(harness: LoaderHarness, extra: Partial<LoadOptions> = {}): LoadOptions {
  return harness.options([], { cwd: project, ...extra });
}

function codesOf(diagnostics: readonly LoadDiagnostic[], extension: string | null): string[] {
  return diagnostics.filter((entry) => entry.extension === extension).map((entry) => entry.code);
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

test("a user extension loads from <userDir>/extensions and its on handler fires", async () => {
  await writePlugin(userExtensions, "hello", { name: "hello" });
  const harness = await harnessOf();
  const report = await harness.loader.loadAll(loadOptions(harness));
  expect(report.diagnostics).toEqual([]);
  expect(report.extensions.map((info) => [info.name, info.source, info.trust, info.state])).toEqual(
    [["hello", "user", "user", "active"]],
  );
  expect(harness.policy.tiers.get("hello")).toBe("user");
  await fire(harness);
  // 플러그인이 받은 `@xeon/contracts`와 `typebox`는 호스트와 같은 값이고, `@xeon/group-kit`은 호스트 객체다
  expect(fakeGroupKit.seen).toEqual(["hello:shared:true:true", "hello:fired"]);
});

test("safe mode skips user extensions without importing them", async () => {
  await writePlugin(userExtensions, "hello", { name: "hello" });
  const harness = await harnessOf();
  const report = await harness.loader.loadAll(
    loadOptions(harness, { startup: { safeMode: { active: true, source: "flag" }, disabled: [] } }),
  );
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([["hello", "disabled"]]);
  expect(codesOf(report.diagnostics, "hello")).toEqual(["safe_mode"]);
  // 설정 키는 카탈로그에 남는다(X.operations.spec §4.6.3)
  expect(report.settingGroups.map((group) => group.namespace)).toEqual(["ext.hello"]);
  await fire(harness);
  expect(fakeGroupKit.seen).toEqual([]);
  expect(harness.t.host.scope("hello")).toBeUndefined();
});

test("safe mode keeps L1 and L2 built-ins and drops L3 built-in groups", async () => {
  const harness = await harnessOf();
  const report = await harness.loader.loadAll(
    harness.options(
      [
        moduleOf({ name: "core-x", layer: "L1" }),
        moduleOf({ name: "cap-x", layer: "L2" }),
        moduleOf({ name: "group-x", layer: "L3", kind: "group" }),
      ],
      { cwd: project, startup: { safeMode: { active: true }, disabled: [] } },
    ),
  );
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([
    ["core-x", "active"],
    ["cap-x", "active"],
    ["group-x", "disabled"],
  ]);
  expect(codesOf(report.diagnostics, "group-x")).toEqual(["safe_mode"]);
});

test("safe mode does not discover project extensions or ask for project trust", async () => {
  await writePlugin(join(project, ".xeon", "extensions"), "proj", { name: "proj" });
  const harness = await harnessOf();
  const report = await harness.loader.loadAll(
    loadOptions(harness, {
      trustOverride: true,
      startup: { safeMode: { active: true }, disabled: [] },
    }),
  );
  expect(report.extensions).toEqual([]);
  expect(report.projectTrust).toBeNull();
  expect(report.diagnostics.map((entry) => entry.code)).toEqual(["safe_mode"]);
});

test("--disable-ext skips only the named extension", async () => {
  await writePlugin(userExtensions, "one", { name: "one" });
  await writePlugin(userExtensions, "two", { name: "two" });
  const harness = await harnessOf();
  const report = await harness.loader.loadAll(
    loadOptions(harness, { startup: { safeMode: { active: false }, disabled: ["two"] } }),
  );
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([
    ["one", "active"],
    ["two", "disabled"],
  ]);
  expect(codesOf(report.diagnostics, "two")).toEqual(["disabled_flag"]);
});

test("bad manifests give diagnostics and the host continues", async () => {
  await writePlugin(userExtensions, "good", { name: "good" });
  await putFile(join(userExtensions, "broken-json", ".xeon-plugin", "plugin.json"), "{ not json");
  await putFile(
    join(userExtensions, "bad-schema", ".xeon-plugin", "plugin.json"),
    JSON.stringify({ schemaVersion: 1, name: "BAD NAME" }),
  );
  await mkdir(join(userExtensions, "no-manifest"), { recursive: true });
  const harness = await harnessOf();
  const report = await harness.loader.loadAll(loadOptions(harness));
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([
    ["good", "active"],
    ["bad-schema", "rejected"],
    ["broken-json", "rejected"],
  ]);
  expect(codesOf(report.diagnostics, "broken-json")).toEqual(["manifest_parse"]);
  expect(codesOf(report.diagnostics, "bad-schema")).toEqual(["manifest_invalid"]);
  const missing = report.diagnostics.find((entry) => entry.code === "manifest_missing");
  expect(missing).toMatchObject({ extension: null, source: "user", severity: "warning" });
  await fire(harness);
  expect(fakeGroupKit.seen).toEqual(["good:shared:true:true", "good:fired"]);
});

test("entry failures reject only that extension", async () => {
  await writePlugin(userExtensions, "a-missing", { name: "a-missing" });
  await Bun.write(join(userExtensions, "a-missing", "src", "index.ts"), "");
  await Bun.$`rm ${join(userExtensions, "a-missing", "src", "index.ts")}`;
  await writePlugin(userExtensions, "b-nofn", { name: "b-nofn", entry: "export const x = 1;\n" });
  await writePlugin(userExtensions, "c-throws", {
    name: "c-throws",
    entry: 'throw new Error("boom at import");\n',
  });
  await writePlugin(userExtensions, "d-outside", { name: "d-outside" });
  await putFile(join(temp.dir, "outside.ts"), "export const extension = () => {};\n");
  await Bun.$`rm ${join(userExtensions, "d-outside", "src", "index.ts")}`;
  await symlink(join(temp.dir, "outside.ts"), join(userExtensions, "d-outside", "src", "index.ts"));
  await writePlugin(userExtensions, "e-good", { name: "e-good" });
  const harness = await harnessOf();
  const report = await harness.loader.loadAll(loadOptions(harness));
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([
    ["a-missing", "error"],
    ["b-nofn", "error"],
    ["c-throws", "error"],
    ["d-outside", "error"],
    ["e-good", "active"],
  ]);
  expect(codesOf(report.diagnostics, "a-missing")).toEqual(["entry_not_found"]);
  expect(codesOf(report.diagnostics, "b-nofn")).toEqual(["entry_not_function"]);
  expect(codesOf(report.diagnostics, "c-throws")).toEqual(["entry_import_failed"]);
  expect(codesOf(report.diagnostics, "d-outside")).toEqual(["entry_import_failed"]);
  expect(harness.policy.tiers.get("a-missing")).toBeUndefined();
});

test("a user extension cannot ask for the builtin trust level", async () => {
  await writePlugin(userExtensions, "greedy", { name: "greedy", trustLevel: "builtin" });
  const harness = await harnessOf();
  const report = await harness.loader.loadAll(loadOptions(harness));
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([
    ["greedy", "rejected"],
  ]);
  expect(codesOf(report.diagnostics, "greedy")).toEqual(["trust_exceeds_source"]);
  await fire(harness);
  expect(fakeGroupKit.seen).toEqual([]);
});

test("built-in names win over user extensions and user wins over project", async () => {
  await writePlugin(userExtensions, "dup", { name: "dup" });
  await writePlugin(userExtensions, "clash", { name: "clash" });
  await writePlugin(join(project, ".xeon", "extensions"), "clash", { name: "clash" });
  await writePlugin(join(project, ".xeon", "extensions"), "only-project", { name: "only-project" });
  const harness = await harnessOf();
  const report = await harness.loader.loadAll(
    harness.options([moduleOf({ name: "dup" })], { cwd: project, trustOverride: true }),
  );
  expect(report.extensions.map((info) => [info.name, info.source, info.state])).toEqual([
    ["dup", "builtin", "active"],
    ["clash", "user", "active"],
    ["only-project", "project", "active"],
    ["clash~4", "project", "rejected"],
    ["dup~3", "user", "rejected"],
  ]);
  expect(report.extensions.find((info) => info.name === "only-project")?.trust).toBe("project");
  expect(harness.policy.tiers.get("only-project")).toBe("project");
});

test("project extensions need project trust", async () => {
  await writePlugin(join(project, ".xeon", "extensions"), "proj", { name: "proj" });

  const denied = await harnessOf();
  const deniedReport = await denied.loader.loadAll(loadOptions(denied, { trustOverride: false }));
  expect(deniedReport.extensions).toEqual([]);
  expect(deniedReport.projectTrust).toMatchObject({ trusted: false, via: "override" });
  expect(deniedReport.diagnostics.map((entry) => [entry.source, entry.code])).toEqual([
    ["project", "trust_denied"],
  ]);

  // 비대화형이고 결정이 없으면 불신이다
  const headless = await harnessOf();
  const headlessReport = await headless.loader.loadAll(loadOptions(headless));
  expect(headlessReport.extensions).toEqual([]);
  expect(headlessReport.diagnostics.map((entry) => entry.code)).toEqual(["trust_undecided"]);

  const allowed = await harnessOf();
  const allowedReport = await allowed.loader.loadAll(loadOptions(allowed, { trustOverride: true }));
  expect(allowedReport.extensions.map((info) => [info.name, info.source, info.state])).toEqual([
    ["proj", "project", "active"],
  ]);
  await fire(allowed);
  expect(fakeGroupKit.seen).toEqual(["proj:shared:true:true", "proj:fired"]);
});

test("a project without extension resources needs no trust decision", async () => {
  const harness = await harnessOf();
  const report = await harness.loader.loadAll(loadOptions(harness));
  expect(report.projectTrust).toMatchObject({ trusted: true, via: "notRequired", required: false });
  expect(report.diagnostics).toEqual([]);
});

test("extra paths are searched as user extension directories", async () => {
  const extra = join(temp.dir, "shared-extensions");
  await writePlugin(extra, "shared", { name: "shared" });
  const harness = await harnessOf();
  const report = await harness.loader.loadAll(loadOptions(harness, { extraPaths: [extra] }));
  expect(report.extensions.map((info) => [info.name, info.source, info.state])).toEqual([
    ["shared", "user", "active"],
  ]);
});

test("cancelling during an external entry ends loading instead of hanging", async () => {
  await writePlugin(userExtensions, "slow", {
    name: "slow",
    entry: "export const extension = () => new Promise(() => {});\n",
  });
  const harness = await harnessOf();
  const controller = new AbortController();
  const loading = harness.loader.loadAll(loadOptions(harness, { signal: controller.signal }));
  const rejected = loading.then(
    () => undefined,
    (error: unknown) => error,
  );
  await Bun.sleep(100);
  controller.abort();
  const error = await rejected;
  expect(error).toBeInstanceOf(LoadAbortError);
  expect(harness.t.host.scope("slow")).toBeUndefined();
});
