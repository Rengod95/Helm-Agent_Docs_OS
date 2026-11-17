import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { ok } from "@fresnel/contracts";
import { KIND_CATALOG, locateTemplateDirs } from "@fresnel/plugin-builder";
import type { RegistrationHandle } from "@fresnel/contracts/extensions";
import type { RecordVersionInput, RegistrationInfo } from "@fresnel/ext-host";
import { createDevkitPort } from "../../src/assembly/m4/devkit-port.ts";
import type { M4PortDeps } from "../../src/assembly/m4/deps.ts";
import type {
  ExtUiVersionSource,
  ReviewedVersions,
} from "../../src/assembly/m4/ext-ui-version-source.ts";
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
      reviewed: partial<ReviewedVersions>({}),
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

test("devkit port: kinds are the catalog, and scaffold, validate and package run end to end", async () => {
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
