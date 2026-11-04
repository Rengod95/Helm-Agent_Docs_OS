import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { DevkitError } from "@fresnel/contracts/services";
import { KIND_CATALOG, locateTemplateDirs } from "@fresnel/plugin-builder";
import type { RegistrationHandle } from "@fresnel/contracts/extensions";
import type { RecordVersionInput, RegistrationInfo } from "@fresnel/ext-host";
import { createDevkitPort } from "../../src/assembly/m4/devkit-port.ts";
import type { M4PortDeps } from "../../src/assembly/m4/deps.ts";
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

function fakes(name: string, running: readonly string[] = []): Fakes {
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
  ).toEqual([["replace-demo", "0.1.0", "authored", join(state.extensionsDir, "replace-demo")]]);
  expect(state.recorded[0]?.manifestText).toContain('"version": "0.1.0"');
});

test("devkit port: remove deletes the folder and asks running registrations to disable", async () => {
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
