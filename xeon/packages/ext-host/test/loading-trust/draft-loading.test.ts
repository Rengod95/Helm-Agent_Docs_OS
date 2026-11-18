// 초안 적재(ExtensionLoader.loadDraft, X.loading-trust.spec §4.9.8 [제안]): 초안은 격리 프로세스에서만 돈다.
// 실제 임시 디렉터리의 초안 트리를 싣고, 띄우기 포트는 메모리 파이프로 자식을 돌린다(isolation-loader.test.ts와 같은 대역).
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { EXTENSION_NAME_PATTERN } from "@fresnel/contracts/extensions";
import type { PluginHostSupervisor } from "../../src/isolation/supervisor.ts";
import {
  internalDraftName,
  type LoaderIsolation,
  type LoaderPaths,
} from "../../src/loading-trust/index.ts";
import {
  createFakeProcessPort,
  createManualClock,
  until,
  type FakeProcessPort,
  type ManualClock,
} from "../isolation/support/fake-process.ts";
import { createLoaderHarness, type LoaderHarness } from "./support/harness.ts";
import { writePlugin, type PluginFiles } from "./support/plugin-fixture.ts";
import { makeTempDir, putFile, realLoaderFs } from "./support/real-fs.ts";

const DRAFT_ID = "drf_7f3a9c";
/** `d` + draftId 앞 여섯 글자(영숫자) + `-` + 플러그인 이름 */
const INTERNAL = "ddrf7f3-notes";
/** 내용 해시. 판 식별자는 앞 여덟 글자를 쓴다 */
const HASH = `sha256:abcdef12${"0".repeat(56)}`;
const signal = new AbortController().signal;

/** 검토본(사용자 위치) `notes`의 엔트리. 등록 이름을 직접 적는다 */
const REVIEWED_ENTRY = `export const extension = ({ register }) => {
  register("notes", {}, (g) => {
    g.on("boundary.settle.after", () => {});
  });
};
`;

/** 초안의 엔트리. 등록 이름은 매니페스트에서 읽는다(격리에서 매니페스트 이름은 내부 이름이다) */
const DRAFT_ENTRY = `export const extension = ({ manifest, register }) => {
  register(manifest.name, {}, (g) => {
    g.on("boundary.settle.after", () => {});
  });
};
`;

let temp: Awaited<ReturnType<typeof makeTempDir>>;
let paths: LoaderPaths;
let userExtensions: string;
let project: string;
let draftsDir: string;

beforeEach(async () => {
  temp = await makeTempDir();
  paths = { userDir: join(temp.dir, "user"), managedDir: null, homeDir: join(temp.dir, "home") };
  userExtensions = join(paths.userDir, "extensions");
  project = join(temp.dir, "project");
  draftsDir = join(temp.dir, "store", "drafts");
  await mkdir(project, { recursive: true });
});

afterEach(async () => {
  await temp.cleanup();
});

interface Rig {
  readonly harness: LoaderHarness;
  readonly port: FakeProcessPort;
  readonly clock: ManualClock;
  readonly supervised: { readonly name: string; readonly supervisor: PluginHostSupervisor }[];
}

/** 격리 포트와 띄우기 설정이 있는 로더. `isolated`가 거짓이면 포트를, `isolation`이 거짓이면 띄우기 설정을 주지 않는다 */
async function rigOf(
  options: { readonly isolated?: boolean; readonly isolation?: boolean } = {},
): Promise<Rig> {
  const port = createFakeProcessPort();
  const clock = createManualClock();
  const supervised: Rig["supervised"][number][] = [];
  const isolation: LoaderIsolation = {
    launch: () => ({ command: "plugin-host", args: [], env: {} }),
    setTimer: clock.setTimer,
    initTimeoutMs: 1000,
    onSupervisor: (name, supervisor) => {
      supervised.push({ name, supervisor });
    },
  };
  const harness = await createLoaderHarness({
    loader: {
      fs: realLoaderFs,
      paths,
      ...(options.isolated === false ? {} : { process: port }),
      ...(options.isolation === false ? {} : { isolation }),
    },
  });
  return { harness, port, clock, supervised };
}

function loadOptions(harness: LoaderHarness) {
  return harness.options([], { cwd: project });
}

/** 초안 트리(`<store>/drafts/<draftId>/tree`)를 쓰고 루트를 돌려준다. 시험마다 덮어쓴다 */
function writeDraft(files: Partial<PluginFiles> = {}): Promise<string> {
  return writePlugin(draftsDir, join(DRAFT_ID, "tree"), {
    name: "notes",
    entry: DRAFT_ENTRY,
    ...files,
  });
}

function draftInput(root: string, plugin = "notes") {
  return { plugin, draftId: DRAFT_ID, root, contentHash: HASH };
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

test("internalDraftName keeps a d, the first six letters or digits of the draftId, and the plugin name, within the name pattern", () => {
  expect(internalDraftName("notes", DRAFT_ID)).toBe(INTERNAL);
  expect(internalDraftName("notes", "DRF_7F3A9C")).toBe(INTERNAL);
  const long = internalDraftName("a".repeat(40), DRAFT_ID);
  expect(long).toBe(`ddrf7f3-${"a".repeat(24)}`);
  expect(long.length).toBe(32);
  expect(new RegExp(EXTENSION_NAME_PATTERN).test(long)).toBe(true);
  expect(new RegExp(EXTENSION_NAME_PATTERN).test(INTERNAL)).toBe(true);
});

/** 격리 포트나 띄우기 설정이 없는 로더에서 초안이 `isolation_unavailable`로 거부되고 아무것도 남지 않는지 본다 */
async function expectIsolationUnavailable(rig: Rig): Promise<void> {
  const root = await writeDraft();
  const refused = await rig.harness.loader.loadDraft(draftInput(root), signal);
  if (refused.ok) throw new Error("a draft was loaded without process isolation");
  expect(refused.error.kind).toBe("isolation_unavailable");
  expect(rig.harness.t.host.registrations()).toEqual([]);
  expect(rig.harness.t.host.registration(INTERNAL)).toBeUndefined();
  expect(rig.harness.loader.list()).toEqual([]);
  expect(rig.harness.loader.loadDraftsOf()).toEqual([]);
  expect(rig.port.specs).toEqual([]);
}

test("without the process port or the isolation config a draft is refused as isolation_unavailable and installs nothing", async () => {
  await expectIsolationUnavailable(await rigOf({ isolated: false }));
  await expectIsolationUnavailable(await rigOf({ isolation: false }));
});

test("a none setting and a none manifest do not take a draft out of the isolated process", async () => {
  const rig = await rigOf();
  // 검토본 `notes`의 설정과 초안의 설정 이름 둘 다 엔진 안을 요청한다
  rig.harness.settings.isolation.set("notes", "none");
  rig.harness.settings.isolation.set(INTERNAL, "none");
  const root = await writeDraft({ isolation: "none" });
  const started = await rig.harness.loader.loadDraft(draftInput(root), signal);
  if (!started.ok) throw new Error(`draft refused: ${JSON.stringify(started.error)}`);
  expect(started.value.info.isolation).toBe("process");
  expect(rig.port.specs.map((spec) => spec.readRoot)).toEqual([root]);
  expect(rig.port.children.length).toBe(1);
  await rig.harness.loader.dispose();
});

test("a draft loads under its internal name in its own process, and the reviewed plugin of the same name stays active", async () => {
  const rig = await rigOf();
  await writePlugin(userExtensions, "notes", { name: "notes", entry: REVIEWED_ENTRY });
  const report = await rig.harness.loader.loadAll(loadOptions(rig.harness));
  expect(report.extensions.find((info) => info.name === "notes")?.state).toBe("active");

  const root = await writeDraft();
  const started = await rig.harness.loader.loadDraft(draftInput(root), signal);
  if (!started.ok) throw new Error(`draft refused: ${JSON.stringify(started.error)}`);
  expect(started.value.appliesAt).toBe("now");
  expect(started.value.info).toMatchObject({
    name: INTERNAL,
    state: "active",
    isolation: "process",
    source: "user",
    version: "1.0.0",
    contentHash: HASH,
    draft: { plugin: "notes", draftId: DRAFT_ID },
  });

  // 검토본은 그대로 살아 있다. 두 확장은 서로 다른 등록을 갖는다
  expect(rig.harness.loader.list().map((info) => [info.name, info.state, info.isolation])).toEqual([
    ["notes", "active", "process"],
    [INTERNAL, "active", "process"],
  ]);
  expect(rig.harness.t.host.registration("notes")?.status).toBe("enabled");
  expect(rig.harness.t.host.registration(INTERNAL)?.status).toBe("enabled");

  // 판 식별자는 `draft:<draftId>:<해시 앞 8자>`이고, 자식은 초안 루트에서 읽는다
  expect(rig.port.specs.at(-1)?.label).toBe(`ext:${INTERNAL}:draft:${DRAFT_ID}:abcdef12`);
  expect(rig.port.specs.at(-1)?.readRoot).toBe(root);

  // 초안의 훅은 초안의 자식 프로세스에서 불린다
  await fire(rig.harness);
  expect(rig.port.children.at(-1)?.received()).toContain('"boundary.settle.after"');

  expect(rig.harness.loader.loadDraftsOf()).toEqual([
    { internalName: INTERNAL, plugin: "notes", draftId: DRAFT_ID, contentHash: HASH },
  ]);
  expect(rig.harness.loader.draftOf(INTERNAL)).toEqual({
    internalName: INTERNAL,
    plugin: "notes",
    draftId: DRAFT_ID,
    contentHash: HASH,
  });
  expect(rig.harness.loader.draftOf("notes")).toBeUndefined();
  await rig.harness.loader.dispose();
});

test("loading the same draft again is already_loaded, and unloadDraft takes it out of the host and retires its session", async () => {
  const rig = await rigOf();
  const root = await writeDraft();
  const first = await rig.harness.loader.loadDraft(draftInput(root), signal);
  expect(first.ok).toBe(true);
  const again = await rig.harness.loader.loadDraft(draftInput(root), signal);
  if (again.ok) throw new Error("the same draft was loaded twice");
  expect(again.error.kind).toBe("already_loaded");

  const supervisor = rig.supervised.find((entry) => entry.name === INTERNAL)?.supervisor;
  expect(supervisor?.status().state).toBe("running");
  expect(await rig.harness.loader.unloadDraft(INTERNAL)).toBe(true);
  expect(rig.harness.t.host.registration(INTERNAL)).toBeUndefined();
  expect(rig.harness.loader.list()).toEqual([]);
  expect(rig.harness.loader.loadDraftsOf()).toEqual([]);
  expect(rig.harness.loader.draftOf(INTERNAL)).toBeUndefined();
  await until(() => supervisor?.status().state === "stopped", "the draft session to stop");
  expect(rig.port.children[0]?.received()).toContain('"reason":"disabled"');
  expect(await rig.harness.loader.unloadDraft(INTERNAL)).toBe(false);

  // `unload`도 초안이면 같은 내리기를 한다
  const reloaded = await rig.harness.loader.loadDraft(draftInput(root), signal);
  expect(reloaded.ok).toBe(true);
  expect(await rig.harness.loader.unload(INTERNAL)).toBe(true);
  expect(rig.harness.t.host.registration(INTERNAL)).toBeUndefined();
  expect(rig.harness.loader.draftOf(INTERNAL)).toBeUndefined();
  expect(rig.harness.loader.list()).toEqual([]);
  await rig.harness.loader.dispose();
});

test("reload and reloadFromReviewed refuse a draft name", async () => {
  const rig = await rigOf();
  const root = await writeDraft();
  const started = await rig.harness.loader.loadDraft(draftInput(root), signal);
  expect(started.ok).toBe(true);
  const reloaded = await rig.harness.loader.reload(INTERNAL, signal);
  if (reloaded.ok) throw new Error("a draft was reloaded");
  expect(reloaded.error).toEqual({ kind: "not_reloadable", reason: "draft" });
  const fromReviewed = await rig.harness.loader.reloadFromReviewed(INTERNAL, signal);
  if (fromReviewed.ok) throw new Error("a draft was reloaded from the reviewed copy");
  expect(fromReviewed.error).toEqual({ kind: "not_reloadable", reason: "draft" });
  expect(rig.harness.loader.list().map((info) => info.state)).toEqual(["active"]);
  await rig.harness.loader.dispose();
});

test("a draft with a broken manifest is rejected with diagnostics, leaves no record, and loads after the fix", async () => {
  const rig = await rigOf();
  const root = await writeDraft();
  await putFile(join(root, ".fresnel-plugin", "plugin.json"), "{ not json");
  const refused = await rig.harness.loader.loadDraft(draftInput(root), signal);
  if (refused.ok) throw new Error("a broken draft was loaded");
  expect(refused.error.kind).toBe("not_active");
  if (refused.error.kind !== "not_active") return;
  expect(refused.error.state).toBe("rejected");
  expect(refused.error.diagnostics.map((entry) => entry.code)).toEqual(["manifest_parse"]);
  expect(rig.harness.loader.list()).toEqual([]);
  expect(rig.harness.t.host.registrations()).toEqual([]);
  expect(rig.harness.loader.loadDraftsOf()).toEqual([]);
  expect(rig.port.specs).toEqual([]);

  // 고쳐 쓰면 같은 초안을 다시 싣는다
  await writeDraft();
  const fixed = await rig.harness.loader.loadDraft(draftInput(root), signal);
  expect(fixed.ok).toBe(true);
  await rig.harness.loader.dispose();
});

test("a draft whose manifest names another plugin is rejected as manifest_invalid", async () => {
  const rig = await rigOf();
  const root = await writeDraft({ name: "other" });
  const refused = await rig.harness.loader.loadDraft(draftInput(root), signal);
  if (refused.ok) throw new Error("a draft naming another plugin was loaded");
  expect(refused.error.kind).toBe("not_active");
  if (refused.error.kind !== "not_active") return;
  expect(refused.error.state).toBe("rejected");
  expect(refused.error.diagnostics.map((entry) => entry.code)).toEqual(["manifest_invalid"]);
  expect(rig.harness.loader.list()).toEqual([]);
  expect(rig.harness.t.host.registrations()).toEqual([]);
  expect(rig.port.specs).toEqual([]);
});

test("a draft without an entry is refused as draft_entry_missing and leaves no record", async () => {
  const rig = await rigOf();
  const root = join(draftsDir, DRAFT_ID, "tree");
  await putFile(
    join(root, ".fresnel-plugin", "plugin.json"),
    JSON.stringify({ schemaVersion: 2, name: "notes", version: "1.0.0" }),
  );
  const refused = await rig.harness.loader.loadDraft(draftInput(root), signal);
  if (refused.ok) throw new Error("a draft without an entry was loaded");
  expect(refused.error.kind).toBe("not_active");
  if (refused.error.kind !== "not_active") return;
  expect(refused.error.state).toBe("error");
  expect(refused.error.diagnostics.map((entry) => entry.code)).toEqual(["draft_entry_missing"]);
  expect(rig.harness.loader.list()).toEqual([]);
  expect(rig.harness.t.host.registrations()).toEqual([]);
  expect(rig.port.specs).toEqual([]);
  await rig.harness.loader.dispose();
});
