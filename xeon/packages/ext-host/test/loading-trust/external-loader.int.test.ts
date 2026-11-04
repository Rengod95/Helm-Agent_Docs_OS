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
import { fakeGroupSdk, SDK, writePlugin } from "./support/plugin-fixture.ts";
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
  fakeGroupSdk.seen.length = 0;
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
  // 플러그인이 받은 `@fresnel/contracts`와 `typebox`는 호스트와 같은 값이고, `@fresnel/group-sdk`은 호스트 객체다
  expect(fakeGroupSdk.seen).toEqual(["hello:shared:true:true", "hello:fired"]);
});

test("a plugin importing a contracts subpath gets the host's module without the host registering it", async () => {
  // 조립 루트는 group-sdk만 넘긴다. `@fresnel/contracts/*` 하위 경로는 X가 등록해 `instanceof CapabilityError`가 호스트와 맞는다
  const kitSpecifier = ["@fresnel", "group-sdk"].join("/");
  await writePlugin(userExtensions, "sub", {
    name: "sub",
    hooks: [],
    entry: `import * as kit from "${kitSpecifier}";
import { CapabilityError } from "@fresnel/contracts/capabilities";
import { ok } from "@fresnel/contracts";
export const extension = ({ register }) => {
  register("sub", {}, (g) => {
    kit.record("sub:error:" + String(CapabilityError === kit.capabilityError));
    kit.record("sub:ok:" + String(typeof ok));
  });
};
`,
  });
  const harness = await harnessOf({
    loader: { sdkModules: { "@fresnel/group-sdk": fakeGroupSdk } },
  });
  const report = await harness.loader.loadAll(loadOptions(harness));
  expect(report.diagnostics).toEqual([]);
  expect(fakeGroupSdk.seen).toEqual(["sub:error:true", "sub:ok:function"]);
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
  expect(fakeGroupSdk.seen).toEqual([]);
  expect(harness.t.host.registration("hello")).toBeUndefined();
});

test("safe mode keeps L1 and L2 built-ins and drops L3 built-in groups", async () => {
  const harness = await harnessOf();
  const report = await harness.loader.loadAll(
    harness.options(
      [
        moduleOf({ name: "core-x", layer: "L1" }),
        moduleOf({ name: "cap-x", layer: "L2" }),
        moduleOf({ name: "group-x", layer: "L3", group: {} }),
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
  await writePlugin(join(project, ".fresnel", "extensions"), "proj", { name: "proj" });
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
  await putFile(
    join(userExtensions, "broken-json", ".fresnel-plugin", "plugin.json"),
    "{ not json",
  );
  await putFile(
    join(userExtensions, "bad-schema", ".fresnel-plugin", "plugin.json"),
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
  expect(fakeGroupSdk.seen).toEqual(["good:shared:true:true", "good:fired"]);
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
  expect(fakeGroupSdk.seen).toEqual([]);
});

test("a user extension named with the host's hook unit prefix is rejected by name and gets no unit, tier or registration", async () => {
  await writePlugin(userExtensions, "hooks-look-alike", { name: "fresnel-hooks-x" });
  const harness = await harnessOf();
  const report = await harness.loader.loadAll(loadOptions(harness));
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([
    ["hooks-look-alike", "rejected"],
  ]);
  expect(report.diagnostics.find((entry) => entry.extension === "hooks-look-alike")).toMatchObject({
    code: "manifest_invalid",
    issues: [
      {
        severity: "error",
        code: "name_reserved",
        path: "/name",
        message:
          'extension name "fresnel-hooks-x" starts with "fresnel-hooks-", a prefix the host reserves for its own units',
      },
    ],
  });
  expect(harness.policy.tiers.get("fresnel-hooks-x")).toBeUndefined();
  expect(harness.t.host.registration("fresnel-hooks-x")).toBeUndefined();
});

test("a user extension named like a guard package gets the user tier, never guard", async () => {
  // guard tier는 내장 위치의 허용 목록(GUARD_EXTENSIONS)만 받는다. 설치로 놓인 확장은 이름이 같아도 user tier다(X.operations.spec §4.1.2)
  await writePlugin(userExtensions, "core-tools", { name: "core-tools" });
  const harness = await harnessOf();
  const report = await harness.loader.loadAll(loadOptions(harness));
  expect(report.extensions.map((info) => [info.name, info.source, info.trust, info.state])).toEqual(
    [["core-tools", "user", "user", "active"]],
  );
  expect(harness.policy.tiers.get("core-tools")).toBe("user");
});

test("built-in names win over user extensions and user wins over project", async () => {
  await writePlugin(userExtensions, "dup", { name: "dup" });
  await writePlugin(userExtensions, "clash", { name: "clash" });
  await writePlugin(join(project, ".fresnel", "extensions"), "clash", { name: "clash" });
  await writePlugin(join(project, ".fresnel", "extensions"), "only-project", {
    name: "only-project",
  });
  const harness = await harnessOf();
  const report = await harness.loader.loadAll(
    harness.options([moduleOf({ name: "dup" })], { cwd: project, trustOverride: true }),
  );
  // 거부된 쪽의 내부 이름 접미(`~<번호>`)는 비교에서 뗀다
  const summary = report.extensions
    .map((info) => `${info.name.replace(/~\d+$/, "")}:${info.source}:${info.state}`)
    .toSorted();
  expect(summary).toEqual([
    "clash:project:rejected",
    "clash:user:active",
    "dup:builtin:active",
    "dup:user:rejected",
    "only-project:project:active",
  ]);
  expect(report.extensions.find((info) => info.name === "only-project")?.trust).toBe("project");
  expect(harness.policy.tiers.get("only-project")).toBe("project");
});

test("project extensions need project trust", async () => {
  await writePlugin(join(project, ".fresnel", "extensions"), "proj", { name: "proj" });

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
  expect(fakeGroupSdk.seen).toEqual(["proj:shared:true:true", "proj:fired"]);
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
  expect(harness.t.host.registration("slow")).toBeUndefined();
});

test("a dot directory such as a leftover .staging is not an extension", async () => {
  await writePlugin(userExtensions, "real", { name: "real" });
  await writePlugin(userExtensions, ".staging", { name: "real" });
  const harness = await harnessOf();
  const report = await harness.loader.loadAll(loadOptions(harness));
  expect(report.diagnostics).toEqual([]);
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([["real", "active"]]);
});

test("an entry that resolves into a sibling directory sharing the root prefix is refused", async () => {
  await writePlugin(userExtensions, "plug", { name: "plug" });
  await putFile(
    join(userExtensions, "plug-evil", "index.ts"),
    "export const extension = () => {};\n",
  );
  await Bun.$`rm ${join(userExtensions, "plug", "src", "index.ts")}`;
  await symlink(
    join(userExtensions, "plug-evil", "index.ts"),
    join(userExtensions, "plug", "src", "index.ts"),
  );
  const harness = await harnessOf();
  const report = await harness.loader.loadAll(loadOptions(harness));
  const ext = report.extensions.find((info) => info.name === "plug");
  expect(ext?.state).toBe("error");
  expect(codesOf(report.diagnostics, "plug")).toEqual(["entry_import_failed"]);
});

test("a project extension directory that links outside .fresnel/extensions is not discovered", async () => {
  const outside = join(temp.dir, "elsewhere");
  await writePlugin(outside, "linked", { name: "linked" });
  await mkdir(join(project, ".fresnel", "extensions"), { recursive: true });
  await symlink(join(outside, "linked"), join(project, ".fresnel", "extensions", "linked"));
  const harness = await harnessOf();
  const report = await harness.loader.loadAll(loadOptions(harness, { trustOverride: true }));
  expect(report.extensions).toEqual([]);
  expect(report.diagnostics.map((entry) => [entry.source, entry.code])).toEqual([
    ["project", "manifest_missing"],
  ]);
  expect(fakeGroupSdk.seen).toEqual([]);
});

// ── 다시 읽기(ExtensionLoader.reload, §4.4.4) ──────────────────────────────

const reloadSignal = new AbortController().signal;

/** 엔트리를 바꿔 쓴다. 매니페스트는 그대로다 */
async function rewriteEntry(root: string, entry: string): Promise<void> {
  await putFile(join(root, "src", "index.ts"), entry);
}

/** 호출될 때 `<tag>`를 기록하는 엔트리 */
function taggedEntry(name: string, tag: string): string {
  const kit = ["@fresnel", "group-sdk"].join("/");
  return `import * as kit from "${kit}";
export const extension = ({ register }) => {
  register(${JSON.stringify(name)}, {}, (g) => {
    g.on("boundary.settle.after", () => {
      kit.record(${JSON.stringify(tag)});
    });
  });
};
`;
}

async function loadedHello(): Promise<{
  harness: LoaderHarness;
  root: string;
  thread: ReturnType<LoaderHarness["t"]["newThread"]>;
}> {
  const root = await writePlugin(userExtensions, "hello", {
    name: "hello",
    entry: taggedEntry("hello", "v1"),
  });
  const harness = await harnessOf();
  const report = await harness.loader.loadAll(loadOptions(harness));
  expect(report.diagnostics).toEqual([]);
  const thread = harness.t.newThread();
  await harness.t.host.openThread(thread);
  return { harness, root, thread };
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

test("reload re-imports the edited entry and an open idle thread uses it at once", async () => {
  const { harness, root, thread } = await loadedHello();
  await fireIn(harness, thread, "k0");
  await rewriteEntry(root, taggedEntry("hello", "v2"));
  const started = await harness.loader.reload("hello", reloadSignal);
  if (!started.ok) throw new Error(`reload refused: ${JSON.stringify(started.error)}`);
  expect(started.value.appliesAt).toBe("now");
  const applied = await started.value.applied;
  expect(applied).toMatchObject({ status: "applied", statesCleared: 0 });
  await harness.t.settled();
  fakeGroupSdk.seen.length = 0;
  await fireIn(harness, thread, "k1");
  expect(fakeGroupSdk.seen).toContain("v2");
  expect(fakeGroupSdk.seen).not.toContain("v1");
  expect(harness.loader.list().map((info) => [info.name, info.state, info.generation])).toEqual([
    ["hello", "active", 1],
  ]);
});

test("reload during a running turn leaves the old version to finish the step", async () => {
  const { harness, root, thread } = await loadedHello();
  harness.t.loop.setRunning(thread, true);
  await rewriteEntry(root, taggedEntry("hello", "v2"));
  const started = await harness.loader.reload("hello", reloadSignal);
  if (!started.ok) throw new Error("reload refused");
  expect(started.value.appliesAt).toBe("nextStepBoundary");
  fakeGroupSdk.seen.length = 0;
  await fireIn(harness, thread, "k0");
  expect(fakeGroupSdk.seen).toEqual(["v1"]);
  await harness.t.boundary(thread).stepEnd();
  await harness.t.settled();
  expect(await started.value.applied).toMatchObject({ status: "applied" });
  fakeGroupSdk.seen.length = 0;
  await fireIn(harness, thread, "k1");
  expect(fakeGroupSdk.seen).toEqual(["v2"]);
});

test("a reload whose entry does not import is rejected and the old version keeps running", async () => {
  const { harness, root, thread } = await loadedHello();
  await rewriteEntry(root, "export const extension = (;\n");
  const started = await harness.loader.reload("hello", reloadSignal);
  expect(started.ok).toBe(false);
  if (started.ok) return;
  expect(started.error.kind).toBe("rejected");
  if (started.error.kind !== "rejected") return;
  expect(started.error.diagnostics.map((entry) => entry.code)).toEqual(["entry_import_failed"]);
  fakeGroupSdk.seen.length = 0;
  await fireIn(harness, thread, "k0");
  expect(fakeGroupSdk.seen).toEqual(["v1"]);
  expect(harness.loader.list().map((info) => [info.state, info.generation])).toEqual([
    ["active", 0],
  ]);
});

test("a reload with an invalid or renamed manifest is rejected before any import", async () => {
  const { harness, root, thread } = await loadedHello();
  await putFile(join(root, ".fresnel-plugin", "plugin.json"), "{ not json");
  const broken = await harness.loader.reload("hello", reloadSignal);
  expect(broken.ok ? "ok" : broken.error).toMatchObject({ kind: "rejected" });
  await putFile(
    join(root, ".fresnel-plugin", "plugin.json"),
    JSON.stringify({
      schemaVersion: 2,
      name: "renamed",
      version: "1.0.0",
      entry: "./src/index.ts",
      plugins: [{ layer: "plugin", hooks: ["boundary.settle.after"] }],
    }),
  );
  const renamed = await harness.loader.reload("hello", reloadSignal);
  expect(renamed.ok ? "ok" : renamed.error).toMatchObject({ kind: "rejected" });
  fakeGroupSdk.seen.length = 0;
  await fireIn(harness, thread, "k0");
  expect(fakeGroupSdk.seen).toEqual(["v1"]);
});

test("a setup that throws in the new version is reported through applied and the old one runs", async () => {
  const { harness, root, thread } = await loadedHello();
  const kit = ["@fresnel", "group-sdk"].join("/");
  await rewriteEntry(
    root,
    `import * as kit from "${kit}";
export const extension = ({ register }) => {
  register("hello", {}, () => {
    kit.record("v2-setup");
    throw new Error("v2 cannot start");
  });
};
`,
  );
  const started = await harness.loader.reload("hello", reloadSignal);
  if (!started.ok) throw new Error("reload refused");
  const applied = await started.value.applied;
  expect(applied).toMatchObject({ status: "failed", restored: true });
  if (applied.status !== "failed") return;
  expect(applied.diagnostics.map((entry) => entry.code)).toEqual(["reload_failed"]);
  expect(harness.loader.diagnostics().map((entry) => entry.code)).toContain("reload_failed");
  await harness.t.settled();
  fakeGroupSdk.seen.length = 0;
  await fireIn(harness, thread, "k0");
  expect(fakeGroupSdk.seen).toEqual(["v1"]);
  expect(harness.loader.list().map((info) => [info.state, info.generation])).toEqual([
    ["active", 0],
  ]);
});

test("reload refuses unknown, built-in and not-active extensions", async () => {
  await writePlugin(userExtensions, "hello", { name: "hello" });
  const harness = await harnessOf();
  await harness.loader.loadAll(
    loadOptions(harness, { startup: { safeMode: { active: true, source: "flag" }, disabled: [] } }),
  );
  const unknown = await harness.loader.reload("nope", reloadSignal);
  expect(unknown.ok ? "ok" : unknown.error).toEqual({ kind: "unknown_extension" });
  const disabled = await harness.loader.reload("hello", reloadSignal);
  expect(disabled.ok ? "ok" : disabled.error).toEqual({
    kind: "not_reloadable",
    reason: "not_active",
  });
});
