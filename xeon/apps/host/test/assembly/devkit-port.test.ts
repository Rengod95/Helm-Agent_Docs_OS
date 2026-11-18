import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import { KIND_CATALOG, locateTemplateDirs } from "@fresnel/plugin-builder";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type {
  EvidenceRef,
  PluginCard,
  PluginSubmitPort,
  RegistrationHandle,
} from "@fresnel/contracts/extensions";
import type { RecordVersionInput, RegistrationInfo } from "@fresnel/ext-host";
import type { DraftInfo, PluginGetResult } from "@fresnel/contracts/wire";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { createDevkitPort } from "../../src/assembly/m4/devkit-port.ts";
import { hashPluginTree } from "../../src/assembly/plugins/content-hash.ts";
import type { DevkitPluginFacts, M4PortDeps } from "../../src/assembly/m4/deps.ts";
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

test("devkit port: submit goes to the plugin submit port, maps its refusals to reasons, and is io without the port", async () => {
  const state = fakes("submit");
  const sent: string[] = [];
  const submitPort: PluginSubmitPort = {
    submit: (request) => {
      sent.push(request.dir);
      if (request.dir === "/bad") {
        return Promise.resolve(
          err({
            kind: "invalid",
            issues: [{ severity: "error", code: "schema", path: "/plugins/0", message: "bad" }],
          }),
        );
      }
      return Promise.resolve(ok({ draftId: "draft_1", itemId: "rvw_1" }));
    },
  };
  const origin: ThreadId = fixedIdFactory(702).next("thr");
  const evidence: readonly [EvidenceRef] = [{ kind: "turn", threadId: origin, turnId: "t-1" }];
  const withPort = createDevkitPort(state.deps, { templates, submit: () => submitPort });
  expect(await withPort.submit({ dir: "/ok", originThreadId: origin, evidence })).toEqual(
    ok({ draftId: "draft_1", itemId: "rvw_1" }),
  );
  expect(await withPort.submit({ dir: "/bad", originThreadId: origin, evidence })).toEqual(
    err({
      kind: "invalid_input",
      message: "the plugin folder is not valid",
      reasons: [{ code: "schema", field: "plugins/0", message: "bad" }],
    }),
  );
  expect(sent).toEqual(["/ok", "/bad"]);
  const withoutPort = createDevkitPort(state.deps, { templates });
  expect(await withoutPort.submit({ dir: "/ok", originThreadId: origin, evidence })).toEqual(
    err({ kind: "io", message: "the plugin review flow is not connected" }),
  );
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

// 원본 폴더와 초안 목록은 플러그인 서비스·검토 서비스의 읽기 면이다. 여기서는 그 면을 가짜로 두고 빌더가 받을 값을 본다.

const SOURCE_PATH = join(root, "config", "plugins", "demo");

/** 원본 폴더 하나를 실제로 만든다. 검토본 해시가 이 폴더와 같은지는 카드의 `currentHash`가 정한다 */
function sourceFolder(path: string): string {
  mkdirSync(join(path, ".fresnel-plugin"), { recursive: true });
  writeFileSync(join(path, ".fresnel-plugin", "plugin.json"), '{"name":"demo"}\n');
  const hashed = hashPluginTree(path);
  if (!hashed.ok) throw new Error(`the fixture folder cannot be hashed: ${hashed.error.kind}`);
  return hashed.value.contentHash;
}

function pluginFacts(): DevkitPluginFacts {
  const here = sourceFolder(SOURCE_PATH);
  // 검토본과 같은 원본 폴더(`same`)는 같은 해시를 카드에 싣는다
  const same = partial<PluginGetResult>({
    card: partial<PluginCard>({
      origin: { kind: "user" },
      review: partial<PluginCard["review"]>({ currentHash: here }),
    }),
    source: { path: SOURCE_PATH, matchesReviewed: true },
  });
  const user = partial<PluginGetResult>({
    card: partial<PluginCard>({
      origin: { kind: "user" },
      review: partial<PluginCard["review"]>({ currentHash: null }),
    }),
    source: { path: SOURCE_PATH, matchesReviewed: false },
  });
  const built = partial<PluginGetResult>({
    card: partial<PluginCard>({ origin: { kind: "bundled" } }),
    source: null,
  });
  const userOnly = partial<PluginGetResult>({
    card: partial<PluginCard>({ origin: { kind: "user" } }),
    source: null,
  });
  const drafts: DraftInfo[] = [
    {
      draftId: "drf_2",
      name: "demo",
      contentHash: "sha256:b",
      parent: "drf_1",
      createdAt: "2026-11-18T01:00:00.000Z",
      originThreadId: null,
      label: null,
      submittedItemId: "rvw_2",
    },
    {
      draftId: "drf_1",
      name: "demo",
      contentHash: "sha256:a",
      parent: null,
      createdAt: "2026-11-18T00:00:00.000Z",
      originThreadId: "thr_test",
      label: null,
      submittedItemId: null,
    },
  ];
  return {
    get: (name) => {
      if (name === "demo") return Promise.resolve(ok(user));
      if (name === "same") return Promise.resolve(ok(same));
      if (name === "built") return Promise.resolve(ok(built));
      if (name === "gone") return Promise.resolve(ok(userOnly));
      return Promise.resolve(err({ kind: "unknown_plugin", name }));
    },
    draftList: (name) =>
      Promise.resolve(name === "demo" ? ok({ drafts }) : err({ kind: "unknown_plugin", name })),
  };
}

test("devkit port: sourceOf gives the source folder and whether it differs, and refuses a built-in plugin without one as bundled_not_editable", async () => {
  const state = fakes("source-of");
  const port = createDevkitPort(partial<M4PortDeps>({ ...state.deps, plugins: pluginFacts() }), {
    templates,
  });
  // 검토본이 없으면(해시가 null) 원본은 검토본과 다르다
  expect(await port.sourceOf("demo")).toEqual(
    ok({ dir: SOURCE_PATH, bundled: false, differsFromReviewed: true }),
  );
  // 카드의 검토본 해시가 지금 폴더 해시와 같으면 같다. 원본을 고치면 다시 다르다(캐시를 쓰지 않는다)
  expect(await port.sourceOf("same")).toEqual(
    ok({ dir: SOURCE_PATH, bundled: false, differsFromReviewed: false }),
  );
  expect(await port.sourceOf("built")).toEqual(
    err({
      kind: "bundled_not_editable",
      message: "built is built in and has no source folder",
    }),
  );
  // 원본 폴더가 없는 사용자 플러그인은 없는 것이다(`not_found`)
  expect(await port.sourceOf("gone")).toEqual(
    err({ kind: "not_found", message: "gone has no source folder" }),
  );
  expect(await port.sourceOf("ghost")).toEqual(
    err({ kind: "not_found", message: "ghost is not known" }),
  );
  // 플러그인 사실이 연결되지 않은 빌드는 입출력 오류다
  expect(await createDevkitPort(state.deps, { templates }).sourceOf("demo")).toEqual(
    err({ kind: "io", message: "the plugin facts are not connected in this host build" }),
  );
});

test("devkit port: draftList gives the drafts newest first with their parent, and an unknown plugin is not_found", async () => {
  const state = fakes("draft-list");
  const port = createDevkitPort(partial<M4PortDeps>({ ...state.deps, plugins: pluginFacts() }), {
    templates,
  });
  expect(await port.draftList("demo")).toEqual(
    ok({
      drafts: [
        {
          draftId: "drf_2",
          parent: "drf_1",
          contentHash: "sha256:b",
          createdAt: "2026-11-18T01:00:00.000Z",
          originThreadId: null,
          submittedItemId: "rvw_2",
        },
        {
          draftId: "drf_1",
          parent: null,
          contentHash: "sha256:a",
          createdAt: "2026-11-18T00:00:00.000Z",
          originThreadId: "thr_test",
          submittedItemId: null,
        },
      ],
    }),
  );
  expect(await port.draftList("ghost")).toEqual(
    err({ kind: "not_found", message: "ghost is not known" }),
  );
});
