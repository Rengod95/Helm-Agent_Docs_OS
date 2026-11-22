import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import { KIND_CATALOG, locateTemplateDirs } from "@fresnel/core-authoring";
import type { ContextRef, ThreadId } from "@fresnel/contracts/conversation";
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
import type { DevkitPluginFacts, M4HostEnv, M4PortDeps } from "../../src/assembly/m4/deps.ts";
import type { DevkitPort } from "../../src/handlers/m4/devkit.ts";
import type { DevkitError } from "@fresnel/contracts/services";
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
  // 엔트리가 있는 뼈대는 구성원 생성 파일(`src/members.generated.ts`)을 함께 만든다
  expect(scaffolded.value.files).toEqual([
    ".fresnel-plugin/plugin.json",
    "README.md",
    "src/index.ts",
    "src/members.generated.ts",
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

test("devkit port: isCraftChat says whether the conversation is a test chat, read from the conversation's own marker", async () => {
  const state = fakes("craft-chat");
  const craftThread: ThreadId = fixedIdFactory(704).next("thr");
  const plainThread: ThreadId = fixedIdFactory(705).next("thr");
  const port = createDevkitPort(
    partial<M4PortDeps>({
      ...state.deps,
      threads: {
        ...state.deps.threads,
        isCraftChat: (threadId: ThreadId) => ok(threadId === craftThread),
      },
    }),
    { templates },
  );
  // 상주 판정은 모델이 넘긴 값과 무관하게 이 답을 쓴다(M5c §4.8.6)
  expect(await port.isCraftChat(craftThread)).toEqual(ok(true));
  expect(await port.isCraftChat(plainThread)).toEqual(ok(false));
  expect(await port.isCraftChat("not-a-thread")).toEqual(
    err({ kind: "not_found", message: "not-a-thread is not a conversation" }),
  );
});

test("devkit port: craftContext gives each reference of the conversation, with the evidence bundle only for a finding", async () => {
  const state = fakes("craft-context");
  const refs: ContextRef[] = [
    { kind: "plugin", name: "demo" },
    { kind: "finding", findingId: "fnd_1" },
    { kind: "finding", findingId: "fnd_gone" },
  ];
  const port = createDevkitPort(
    partial<M4PortDeps>({
      ...state.deps,
      findingsBundle: (findingId) =>
        findingId === "fnd_1"
          ? ok({ bundle: { findingId, samples: 2 } })
          : err({ kind: "not_found" }),
    }),
    {
      templates,
      craftContext: () => ({
        read: (threadId) => {
          expect(threadId).toBe(origin);
          return Promise.resolve(ok(refs));
        },
      }),
    },
  );
  const origin: ThreadId = fixedIdFactory(703).next("thr");
  expect(await port.craftContext(origin)).toEqual(
    ok({
      threadId: origin,
      refs: [
        { ref: { kind: "plugin", name: "demo" }, bundle: null },
        {
          ref: { kind: "finding", findingId: "fnd_1" },
          bundle: { findingId: "fnd_1", samples: 2 },
        },
        { ref: { kind: "finding", findingId: "fnd_gone" }, bundle: null },
      ],
    }),
  );
  // 대화 id 모양이 아니면 없는 대화다. 포트가 없으면 입출력 오류다
  expect(await port.craftContext("not-a-thread")).toEqual(
    err({ kind: "not_found", message: "not-a-thread is not a conversation" }),
  );
  expect(await createDevkitPort(state.deps, { templates }).craftContext(origin)).toEqual(
    err({ kind: "io", message: "the craft context is not connected in this host build" }),
  );
});

// AGE-60: 제작 코어는 시스템 모듈이다. 빌더 플러그인이 꺼져 있어도(등록된 확장이 하나도 없고 `authoring` 그룹이 실리지 않았다)
// 드래프트 검사, 리뷰 제출, 테스트 런이 같은 포트로 돈다.
test("devkit port: draft check, review submit and test run work with the builder plugin switched off", async () => {
  const state = fakes("builder-off", []);
  expect(state.deps.extUi?.host.registrations().map((info) => info.extension)).toEqual([]);
  const sent: string[] = [];
  const submitPort: PluginSubmitPort = {
    submit: (request) => {
      sent.push(request.dir);
      return Promise.resolve(ok({ draftId: "draft_9", itemId: "rvw_9" }));
    },
  };
  const port = createDevkitPort(state.deps, { templates, submit: () => submitPort });
  const dir = join(root, "builder-off-src");
  const made = await port.scaffold({ kind: "single-plugin", name: "builder-off", dir });
  expect(made.ok).toBe(true);
  // 드래프트 검사
  expect(await port.validate(dir)).toEqual({ ok: true, value: { ok: true, issues: [] } });
  // 리뷰 제출
  const origin: ThreadId = fixedIdFactory(703).next("thr");
  const evidence: readonly [EvidenceRef] = [{ kind: "turn", threadId: origin, turnId: "t-1" }];
  expect(await port.submit({ dir, originThreadId: origin, evidence })).toEqual(
    ok({ draftId: "draft_9", itemId: "rvw_9" }),
  );
  expect(sent).toEqual([dir]);
  // 테스트 런: 설치되지 않은 대상은 포트가 `not_found`로 답한다(빌더 플러그인의 켜짐에 기대지 않는다)
  expect(await port.testRun({ kind: "testRun", target: "builder-off" })).toEqual(
    err({ kind: "not_found", message: "builder-off is not installed" }),
  );
});

// 구성원 편집(`ext.members.edit`)은 원본 폴더만 고친다. 설치본과 검토본·초안 저장소 안의 폴더는 `denied`로 거절하고 아무 파일도 건드리지 않는다.
// 편집은 설치도 승인도 `plugin.draft.create`도 하지 않는다: 설치본의 기록과 등록 끄기, 검토본과 프로필 파일의 바이트를 값으로 본다.

const MANIFEST = ".fresnel-plugin/plugin.json";

function bytesOf(dir: string, path: string = MANIFEST): string {
  return readFileSync(join(dir, path), "utf8");
}

/** 저장소 폴더와 설정 폴더를 만든다. 설정 폴더에는 프로필 파일이 있다(편집이 건드리면 안 된다) */
function storeOf(name: string): { readonly store: string; readonly config: string } {
  const store = join(root, `${name}-store`);
  const config = join(root, `${name}-config`);
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, "profiles.json"), '{"profiles":[]}\n');
  return { store, config };
}

function membersPort(
  state: Fakes,
  paths: { readonly store: string; readonly config: string },
): DevkitPort {
  return createDevkitPort(
    partial<M4PortDeps>({
      ...state.deps,
      env: partial<M4HostEnv>({ pluginStoreDir: paths.store, configDir: paths.config }),
    }),
    { templates },
  );
}

async function scaffoldAt(port: DevkitPort, dir: string, name: string = "pilot"): Promise<void> {
  const made = await port.scaffold({ kind: "single-plugin", name, dir, layer: "L3" });
  if (!made.ok) throw new Error(made.error.message);
}

test("devkit port: editMembers edits the source folder and reports the member; it installs, approves and drafts nothing", async () => {
  const state = fakes("members-source");
  const paths = storeOf("members-source");
  const port = membersPort(state, paths);
  const source = join(paths.config, "plugins", "pilot");
  await scaffoldAt(port, source);
  // 같은 이름의 설치본과 검토본을 둔다. 편집 뒤에도 바이트가 그대로여야 한다
  const installed = join(state.extensionsDir, "pilot");
  const reviewed = join(paths.store, "reviewed", "pilot", "a".repeat(64), "tree");
  await scaffoldAt(port, installed);
  await scaffoldAt(port, reviewed);
  const keep = (): readonly string[] => [
    bytesOf(installed),
    bytesOf(reviewed),
    bytesOf(paths.config, "profiles.json"),
  ];
  const frozen = keep();
  const edited = await port.editMembers({
    dir: source,
    ops: [{ kind: "add", id: "sync", mode: "hook" }],
  });
  if (!edited.ok) throw new Error(edited.error.message);
  expect(edited.value.members).toEqual([
    {
      id: "sync",
      registrationId: "pilot/sync",
      title: null,
      layer: "L3",
      hooks: ["boundary.settle.after"],
      drives: false,
      defaultEnabled: false,
      blockIds: [],
    },
  ]);
  expect(edited.value.changedFiles).toEqual([
    "src/members/sync.ts",
    "src/members.generated.ts",
    MANIFEST,
  ]);
  expect(edited.value.entryWiring).toBe("generated");
  expect(bytesOf(source)).toContain('"id": "sync"');
  expect(keep()).toEqual(frozen);
  // 설치 기록과 등록 끄기는 그대로다: 편집은 설치도 승인도 하지 않는다
  expect(state.recorded).toEqual([]);
  expect(state.disabled).toEqual([]);
});

test("devkit port: editMembers refuses an installed or stored copy as denied, the store folder itself too, and writes nothing there", async () => {
  const state = fakes("members-denied");
  const paths = storeOf("members-denied");
  const port = membersPort(state, paths);
  const installed = join(state.extensionsDir, "pilot");
  const draft = join(paths.store, "drafts", "drf_1", "tree");
  const reviewed = join(paths.store, "reviewed", "pilot", "b".repeat(64), "tree");
  await Promise.all([installed, draft, reviewed].map((dir) => scaffoldAt(port, dir)));
  const frozen = [installed, draft, reviewed].map((dir) => bytesOf(dir));
  const denied: DevkitError = {
    kind: "denied",
    message:
      "the folder is an installed or stored copy, not a source folder; edit the source folder instead",
  };
  const refusals = await Promise.all(
    [installed, draft, reviewed, paths.store].map((dir) =>
      port.editMembers({ dir, ops: [{ kind: "add", id: "sync" }] }),
    ),
  );
  expect(refusals).toEqual([err(denied), err(denied), err(denied), err(denied)]);
  expect([installed, draft, reviewed].map((dir) => bytesOf(dir))).toEqual(frozen);
  expect(existsSync(join(draft, "src", "members"))).toBe(false);
  // 이름이 접두로만 같은 형제 폴더(`<저장소>-old`)는 저장소 안이 아니라서 편집된다
  const sibling = join(root, "members-denied-store-old", "pilot");
  await scaffoldAt(port, sibling);
  const edited = await port.editMembers({ dir: sibling, ops: [{ kind: "add", id: "sync" }] });
  expect(edited.ok).toBe(true);
});

test("devkit port: editMembers and readMembers refuse a relative folder before any file is written", async () => {
  const state = fakes("members-relative");
  const port = membersPort(state, storeOf("members-relative"));
  const relative: DevkitError = { kind: "invalid_input", message: "dir must be an absolute path" };
  expect(await port.editMembers({ dir: "pilot", ops: [] })).toEqual(err(relative));
  expect(await port.readMembers("pilot")).toEqual(err(relative));
});

test("devkit port: readMembers lists the members and writes nothing; a refused op leaves every file as it was", async () => {
  const state = fakes("members-read");
  const paths = storeOf("members-read");
  const port = membersPort(state, paths);
  const source = join(paths.config, "plugins", "pilot");
  await scaffoldAt(port, source);
  const added = await port.editMembers({ dir: source, ops: [{ kind: "add", id: "sync" }] });
  if (!added.ok) throw new Error(added.error.message);
  const frozen = bytesOf(source);
  expect(await port.readMembers(source)).toEqual(ok(added.value.members));
  expect(bytesOf(source)).toBe(frozen);
  // 두 번째 건이 실패하면 앞 건도 쓰지 않는다: 새 구성원 코드 파일이 생기지 않고 매니페스트도 그대로다
  const refused = await port.editMembers({
    dir: source,
    ops: [
      { kind: "add", id: "lead" },
      { kind: "remove", id: "nope" },
    ],
  });
  expect(refused).toEqual(
    err({ kind: "not_found", message: 'plugin "nope" is not a member of this extension' }),
  );
  expect(bytesOf(source)).toBe(frozen);
  expect(existsSync(join(source, "src", "members", "lead.ts"))).toBe(false);
  // 저장소 안의 사본은 읽을 수 있다(읽기는 거절하지 않는다)
  const reviewed = join(paths.store, "reviewed", "pilot", "c".repeat(64), "tree");
  await scaffoldAt(port, reviewed);
  expect((await port.readMembers(reviewed)).ok).toBe(true);
});
