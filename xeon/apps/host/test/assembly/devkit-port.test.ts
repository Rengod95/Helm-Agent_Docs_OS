import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { DevkitError } from "@fresnel/contracts/services";
import { KIND_CATALOG, locateTemplateDirs } from "@fresnel/plugin-builder";
import type { RegistrationHandle } from "@fresnel/contracts/extensions";
import type { LoadedExtensionInfo, RecordVersionInput, RegistrationInfo } from "@fresnel/ext-host";
import { createDevkitPort } from "../../src/assembly/m4/devkit-port.ts";
import type { M4HostEnv, M4PortDeps } from "../../src/assembly/m4/deps.ts";
import type { ExtUiVersionSource } from "../../src/assembly/m4/ext-ui-version-source.ts";
import { partial } from "../fixtures/unsafe.ts";

// 제작 포트(`assembly/m4/devkit-port.ts`)를 실제 파일 위에서 본다. 확장 위치, 버전 기록, 등록은 가짜다.

const root = mkdtempSync(join(tmpdir(), "devkit-port-"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const templates = locateTemplateDirs({});

interface Fakes {
  readonly deps: M4PortDeps;
  readonly recorded: RecordVersionInput[];
  readonly disabled: string[];
  readonly extensionsDir: string;
}

interface Gate {
  safeMode?: boolean;
  locked?: readonly string[];
}

function fakes(name: string, running: readonly string[] = [], gate: Gate = {}): Fakes {
  const extensionsDir = join(root, `${name}-extensions`);
  const recorded: RecordVersionInput[] = [];
  const disabled: string[] = [];
  const deps = partial<M4PortDeps>({
    extUi: {
      extensionsDir,
      bundle: () => Promise.resolve(null),
      history: {
        record: (input) => {
          recorded.push(input);
          return Promise.resolve(ok({ pruned: [], pruneFailure: null }));
        },
        list: () => Promise.reject(new Error("not used")),
        rollback: () => Promise.reject(new Error("not used")),
      },
      stateSchemaVersion: () => null,
      installGate: {
        safeMode: () => gate.safeMode === true,
        managedLocked: (extension) => gate.locked?.includes(extension) === true,
      },
      loader: () => undefined,
      heldThreads: () => [],
      hash: () => "hash",
      host: partial<ExtUiVersionSource["host"]>({
        registrations: () =>
          running.map((extension) => partial<RegistrationInfo>({ id: extension, extension })),
        registration: (id) =>
          partial<RegistrationHandle>({
            disable: () => {
              disabled.push(id);
            },
          }),
      }),
    },
  });
  return { deps, recorded, disabled, extensionsDir };
}

test("devkit port: kinds are the catalog, and scaffold, validate, package and install run end to end", async () => {
  const state = fakes("flow");
  const port = createDevkitPort(state.deps, { templates });
  expect(await port.kinds()).toEqual(KIND_CATALOG);
  const dir = join(root, "flow-src");
  const scaffolded = await port.scaffold({ kind: "single-plugin", name: "flow-demo", dir });
  if (!scaffolded.ok) throw new Error(scaffolded.error.message);
  expect(scaffolded.value.files).toEqual([
    ".fresnel-plugin/plugin.json",
    "README.md",
    "src/index.ts",
  ]);
  expect(await port.validate(dir)).toEqual({ ok: true, value: { ok: true, issues: [] } });
  const packed = await port.pack({ dir });
  if (!packed.ok) throw new Error(packed.error.message);
  expect(packed.value.files).toEqual([".fresnel-plugin/plugin.json", "README.md", "dist/index.js"]);
  const installed = await port.install({ source: packed.value.path });
  expect(installed).toEqual({
    ok: true,
    value: {
      name: "flow-demo",
      version: "0.1.0",
      location: join(state.extensionsDir, "flow-demo"),
      appliesAt: "restart",
      loadFailure: { reason: "loader_unavailable", diagnostics: [] },
    },
  });
  // 첫 설치는 버전 기록에 남기지 않는다
  expect(state.recorded).toEqual([]);
});

test("devkit port: installing over an installed version records the previous install first", async () => {
  const state = fakes("replace");
  const port = createDevkitPort(state.deps, { templates });
  const dir = join(root, "replace-src");
  const made = await port.scaffold({ kind: "single-plugin", name: "replace-demo", dir });
  if (!made.ok) throw new Error(made.error.message);
  const first = await port.pack({ dir });
  if (!first.ok) throw new Error(first.error.message);
  await port.install({ source: first.value.path });

  const manifestPath = join(dir, ".fresnel-plugin", "plugin.json");
  writeFileSync(manifestPath, readFileSync(manifestPath, "utf8").replace("0.1.0", "0.2.0"));
  const second = await port.pack({ dir });
  if (!second.ok) throw new Error(second.error.message);
  const installed = await port.install({ source: second.value.path });
  expect(installed.ok && installed.value.version).toBe("0.2.0");
  expect(
    state.recorded.map((input) => [input.name, input.version, input.source, input.extensionDir]),
  ).toEqual([["replace-demo", "0.1.0", "user", join(state.extensionsDir, "replace-demo")]]);
  expect(state.recorded[0]?.manifestText).toContain('"version": "0.1.0"');
});

test("devkit port: remove takes a loaded extension down at once; an unknown one asks its registrations to disable", async () => {
  const state = fakes("remove", ["remove-demo"]);
  mkdirSync(join(state.extensionsDir, "remove-demo", ".fresnel-plugin"), { recursive: true });
  const port = createDevkitPort(state.deps, { templates });
  expect(await port.remove("remove-demo")).toEqual({
    ok: true,
    value: { name: "remove-demo", appliesAt: "nextStepBoundary" },
  });
  expect(state.disabled).toEqual(["remove-demo"]);
  expect(await port.remove("remove-demo")).toMatchObject({
    ok: false,
    error: { kind: "not_found" },
  });
  const unloaded: string[] = [];
  const source = state.deps.extUi;
  if (source === undefined) throw new Error("fake has no extUi");
  const loader = partial<NonNullable<ReturnType<ExtUiVersionSource["loader"]>>>({
    unload: (name) => {
      unloaded.push(name);
      return Promise.resolve(true);
    },
  });
  mkdirSync(join(state.extensionsDir, "loaded-demo", ".fresnel-plugin"), { recursive: true });
  const loaded = createDevkitPort(
    partial<M4PortDeps>({ extUi: { ...source, loader: () => loader } }),
    {
      templates,
    },
  );
  expect(await loaded.remove("loaded-demo")).toEqual({
    ok: true,
    value: { name: "loaded-demo", appliesAt: "now" },
  });
  expect(unloaded).toEqual(["loaded-demo"]);
});

test("devkit port: without a user extensions location install and remove are refused, and missing templates refuse scaffold", async () => {
  const port = createDevkitPort(partial<M4PortDeps>({}), { templates: null });
  const refusal = err<DevkitError>({
    kind: "io",
    message: "the user extensions location is not available",
  });
  expect(await port.install({ source: "/x" })).toEqual(refusal);
  expect(await port.remove("demo")).toEqual(refusal);
  expect(await port.scaffold({ kind: "single-plugin", name: "demo", dir: "/x" })).toEqual({
    ok: false,
    error: { kind: "io", message: "the extension templates are missing" },
  });
});

test("devkit port: validateComposition reports composition issues against the given plugin declarations", () => {
  const port = createDevkitPort(partial<M4PortDeps>({}), { templates });
  const draft = {
    blocks: [
      { id: "guard", stage: "guard", op: "on" as const, hooks: ["tool.call.before" as const] },
    ],
  };
  expect(
    port.validateComposition({
      composition: draft,
      plugins: [{ layer: "L3", hooks: ["tool.call.before"] }],
    }),
  ).toEqual({ issues: [] });
  const bad = port.validateComposition({
    composition: draft,
    plugins: [{ layer: "L3", hooks: ["boundary.settle.after"] }],
  });
  expect(bad.issues.length).toBeGreaterThan(0);
  expect(bad.issues.every((found) => found.severity === "error")).toBe(true);
});

async function packedDemo(name: string, state: Fakes): Promise<{ path: string; sha256: string }> {
  const port = createDevkitPort(state.deps, { templates });
  const dir = join(root, `${name}-src`);
  const made = await port.scaffold({ kind: "single-plugin", name, dir });
  if (!made.ok) throw new Error(made.error.message);
  const packed = await port.pack({ dir });
  if (!packed.ok) throw new Error(packed.error.message);
  return packed.value;
}

test("devkit port: the preview shows the pack's values and writes nothing", async () => {
  const state = fakes("pv");
  const port = createDevkitPort(state.deps, { templates });
  const packed = await packedDemo("pv-demo", state);
  const preview = await port.installPreview({ source: packed.path });
  expect(preview).toMatchObject({
    ok: true,
    value: {
      name: "pv-demo",
      version: "0.1.0",
      source: packed.path,
      sha256: packed.sha256,
      installedVersion: null,
      network: [],
      files: [],
      shell: [],
    },
  });
  expect(existsSync(state.extensionsDir)).toBe(false);
});

test("devkit port: install refuses a changed folder, safe mode and a managed lock, and writes nothing", async () => {
  const open = fakes("gate");
  const packed = await packedDemo("gate-demo", open);
  const port = createDevkitPort(open.deps, { templates });
  const preview = await port.installPreview({ source: packed.path });
  if (!preview.ok) throw new Error(preview.error.message);

  writeFileSync(join(packed.path, "README.md"), "edited after the preview\n");
  const changed = await port.install({ source: packed.path, expectedSha256: preview.value.sha256 });
  expect(changed).toMatchObject({ ok: false, error: { kind: "source_changed" } });
  expect(existsSync(join(open.extensionsDir, "gate-demo"))).toBe(false);

  const safe = fakes("gate-safe", [], { safeMode: true });
  const refusedSafe = await createDevkitPort(safe.deps, { templates }).install({
    source: packed.path,
  });
  expect(refusedSafe).toMatchObject({ ok: false, error: { kind: "safe_mode_active" } });
  expect(existsSync(safe.extensionsDir)).toBe(false);

  const locked = fakes("gate-locked", [], { locked: ["gate-demo"] });
  const refusedLocked = await createDevkitPort(locked.deps, { templates }).install({
    source: packed.path,
  });
  expect(refusedLocked).toMatchObject({ ok: false, error: { kind: "managed_locked" } });
  expect(existsSync(locked.extensionsDir)).toBe(false);
});

test("devkit port: replacing a running extension applies at the next step boundary, a new name is loaded at once, a failed load is reported", async () => {
  const state = fakes("reload");
  const packed = await packedDemo("reload-demo", state);
  const source = state.deps.extUi;
  if (source === undefined) throw new Error("fake has no extUi");
  const withLoader = (
    loader: Partial<NonNullable<ReturnType<ExtUiVersionSource["loader"]>>>,
  ): ReturnType<typeof createDevkitPort> =>
    createDevkitPort(
      partial<M4PortDeps>({
        env: partial<M4HostEnv>({ signal: new AbortController().signal }),
        extUi: {
          ...source,
          loader: () => partial<NonNullable<ReturnType<ExtUiVersionSource["loader"]>>>(loader),
        },
      }),
      { templates },
    );
  const running = withLoader({
    list: () => [partial<LoadedExtensionInfo>({ name: "reload-demo", state: "active" })],
  });
  expect(await running.install({ source: packed.path })).toMatchObject({
    ok: true,
    value: { appliesAt: "nextStepBoundary", needsReload: true },
  });
  const loadedNames: string[] = [];
  const fresh = withLoader({
    list: () => [],
    loadInstalled: (name) => {
      loadedNames.push(name);
      return Promise.resolve(
        ok({ appliesAt: "now", info: partial<LoadedExtensionInfo>({ name }) }),
      );
    },
  });
  const loaded = await fresh.install({ source: packed.path });
  expect(loaded).toMatchObject({ ok: true, value: { appliesAt: "now" } });
  expect(loaded.ok && loaded.value.loadFailure).toBeUndefined();
  expect(loadedNames).toEqual(["reload-demo"]);
  const deferred = withLoader({
    list: () => [],
    loadInstalled: (name) =>
      Promise.resolve(
        ok({ appliesAt: "nextStepBoundary", info: partial<LoadedExtensionInfo>({ name }) }),
      ),
  });
  const waiting = await deferred.install({ source: packed.path });
  expect(waiting).toMatchObject({ ok: true, value: { appliesAt: "nextStepBoundary" } });
  expect(waiting.ok && waiting.value.needsReload).toBeUndefined();
  const refusedLoad = withLoader({
    list: () => [],
    loadInstalled: () =>
      Promise.resolve(
        err({
          kind: "not_active",
          state: "error",
          diagnostics: [
            {
              extension: "reload-demo",
              source: "user",
              stage: "entry",
              severity: "error",
              code: "entry_import_failed",
              message: "cannot import",
              generation: 0,
            },
          ],
        }),
      ),
  });
  expect(await refusedLoad.install({ source: packed.path })).toEqual({
    ok: true,
    value: {
      name: "reload-demo",
      version: "0.1.0",
      location: join(state.extensionsDir, "reload-demo"),
      appliesAt: "restart",
      loadFailure: {
        reason: "error",
        diagnostics: [{ severity: "error", code: "entry_import_failed", message: "cannot import" }],
      },
    },
  });
});

test("devkit port: the removal preview lists the stored tables, is empty without storage, and an uninstalled name is not_found", async () => {
  const state = fakes("preview");
  mkdirSync(join(state.extensionsDir, "preview-demo", ".fresnel-plugin"), { recursive: true });
  const source = state.deps.extUi;
  if (source === undefined) throw new Error("fake has no extUi");
  const storage = partial<NonNullable<ExtUiVersionSource["storage"]>>({
    preview: () => ok({ tables: [{ name: "x_preview_demo_pins", rows: 3 }] }),
  });
  const withStorage = createDevkitPort(partial<M4PortDeps>({ extUi: { ...source, storage } }), {
    templates,
  });
  expect(await withStorage.removePreview("preview-demo")).toEqual(
    ok({ name: "preview-demo", tables: [{ name: "x_preview_demo_pins", rows: 3 }] }),
  );
  const bare = createDevkitPort(state.deps, { templates });
  expect(await bare.removePreview("preview-demo")).toEqual(
    ok({ name: "preview-demo", tables: [] }),
  );
  expect(await bare.removePreview("ghost")).toMatchObject({
    ok: false,
    error: { kind: "not_found" },
  });
});

test("devkit port: remove with dropData unloads, drops the stored data, then removes the folder; a failed drop keeps the folder for a retry", async () => {
  const state = fakes("drop");
  const source = state.deps.extUi;
  if (source === undefined) throw new Error("fake has no extUi");
  const folder = join(state.extensionsDir, "drop-demo");
  mkdirSync(join(folder, ".fresnel-plugin"), { recursive: true });
  const calls: string[] = [];
  const loader = partial<NonNullable<ReturnType<ExtUiVersionSource["loader"]>>>({
    unload: (name) => {
      calls.push(`unload:${name}`);
      return Promise.resolve(true);
    },
  });
  const failing = partial<NonNullable<ExtUiVersionSource["storage"]>>({
    drop: (name) => {
      calls.push(`drop:${name}`);
      return err({ kind: "busy" });
    },
  });
  const failed = createDevkitPort(
    partial<M4PortDeps>({ extUi: { ...source, loader: () => loader, storage: failing } }),
    { templates },
  );
  expect(await failed.remove("drop-demo", { dropData: true })).toMatchObject({
    ok: false,
    error: { kind: "io" },
  });
  // 데이터를 못 지웠으면 폴더를 남겨 같은 요청을 다시 보낼 수 있게 한다
  expect(existsSync(folder)).toBe(true);
  const dropping = partial<NonNullable<ExtUiVersionSource["storage"]>>({
    drop: (name) => {
      calls.push(`drop:${name}`);
      return ok({ dropped: ["x_drop_demo_marks", "x_drop_demo_pins"] });
    },
  });
  const retried = createDevkitPort(
    partial<M4PortDeps>({ extUi: { ...source, loader: () => loader, storage: dropping } }),
    { templates },
  );
  expect(await retried.remove("drop-demo", { dropData: true })).toEqual(
    ok({ name: "drop-demo", appliesAt: "now", dataDropped: 2 }),
  );
  expect(existsSync(folder)).toBe(false);
  expect(calls).toEqual([
    "unload:drop-demo",
    "drop:drop-demo",
    "unload:drop-demo",
    "drop:drop-demo",
  ]);
});

test("devkit port: remove without dropData keeps the stored data, and dropData without storage is io and touches nothing", async () => {
  const state = fakes("keep");
  const source = state.deps.extUi;
  if (source === undefined) throw new Error("fake has no extUi");
  mkdirSync(join(state.extensionsDir, "keep-demo", ".fresnel-plugin"), { recursive: true });
  const dropped: string[] = [];
  const storage = partial<NonNullable<ExtUiVersionSource["storage"]>>({
    drop: (name) => {
      dropped.push(name);
      return ok({ dropped: [] });
    },
  });
  const port = createDevkitPort(partial<M4PortDeps>({ extUi: { ...source, storage } }), {
    templates,
  });
  expect(await port.remove("keep-demo")).toEqual(ok({ name: "keep-demo", appliesAt: "restart" }));
  expect(dropped).toEqual([]);
  const plain = createDevkitPort(state.deps, { templates });
  mkdirSync(join(state.extensionsDir, "nostore-demo", ".fresnel-plugin"), { recursive: true });
  expect(await plain.remove("nostore-demo", { dropData: true })).toEqual(
    err({ kind: "io", message: "extension storage is not available" }),
  );
  expect(existsSync(join(state.extensionsDir, "nostore-demo"))).toBe(true);
});
