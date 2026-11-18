import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ok, parse, type Logger, type Result } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import type { MaterialText } from "@fresnel/contracts/extensions";
import type { Profile, ReviewItem } from "@fresnel/contracts/wire";
import { createLocalIdFactory, systemRandom } from "@fresnel/platform-os";
import {
  createPluginReview,
  createPluginService,
  createPluginStore,
  type PluginReview,
  type PluginStore,
} from "../../../src/assembly/plugins/index.ts";
import { approvalHooksOf, type ApprovalHookDeps } from "../../../src/assembly/plugins/approval.ts";
import { createMaterialPort } from "../../../src/assembly/plugins/material-port.ts";
import { readPluginFolder } from "../../../src/assembly/plugins/folder-reader.ts";
import {
  generatedNameOf,
  instructionIssuesOf,
  purposeOf,
} from "../../../src/assembly/plugins/instruction.ts";
import type { PluginEditRequest } from "../../../src/assembly/m4/plugin-edit.ts";
import type { PluginPortFailure } from "../../../src/handlers/m5/plugins.ts";
import { passThroughFileLock, removeTree, tempRoot, writeFiles } from "./support.ts";

// M5c §4.10: 한 줄 지침. 이름 짓기, 원본 폴더, 초안과 `user_instruction` 항목, 승인 한 번, 승인 전후의 재료, 같은 이름의 충돌과 새 버전.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTree(root);
});

const SILENT: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => SILENT,
};

/** 시험의 시각. 호출마다 1초씩 나아간다 */
let tick = 0;
function isoNow(): string {
  tick += 1;
  return new Date(Date.UTC(2026, 10, 18, 2, 0, 0) + tick * 1000).toISOString();
}

/** 재료 포트에 넘길 대화 id. 형식이 맞는 고정 값이다 */
const THREAD: ThreadId = valueOf(parse(ThreadIdSchema, "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV"));

/** 목록에 든 프로필 `work` 하나. 기본 프로필 `default`는 목록에 없어도 있다(§4.1.1) */
const WORK: Profile = {
  id: "work",
  title: "Work",
  builtin: false,
  plugins: [],
  settings: [],
  startDrive: null,
  updatedAt: "2026-11-18T00:00:00.000Z",
  rev: 1,
};
const PROFILES = {
  profiles: [WORK],
  common: { plugins: [], settings: [], updatedAt: "2026-11-18T00:00:00.000Z", rev: 1 },
  rev: 1,
};

interface Edits {
  readonly requests: PluginEditRequest[];
}

interface Rig {
  readonly root: string;
  readonly pluginsDir: string;
  readonly store: PluginStore;
  readonly review: PluginReview;
  readonly edits: Edits;
}

/** 승인 훅을 실제 훅 묶음으로 잇되 프로필은 기록만 한다. 프로필이 실제로 받는 요청을 본다 */
function hooksFor(edits: Edits): ApprovalHookDeps {
  return {
    profiles: {
      checkPluginEdit: () => Promise.resolve(ok(undefined)),
      applyPluginEdit: (request) => {
        edits.requests.push(request);
        return Promise.resolve(ok(request.kind === "add" ? request.profileIds : []));
      },
    },
    loader: () => undefined,
    refreshPluginSet: () => Promise.resolve(),
    log: SILENT,
  };
}

function rigOf(): Rig {
  const root = tempRoot("instruction-");
  roots.push(root);
  const store = createPluginStore({
    root: join(root, "plugin-store"),
    fileLock: passThroughFileLock,
  });
  const service = createPluginService({
    configDir: join(root, "config"),
    projectRoots: () => Promise.resolve([]),
    managedDir: null,
    bundleDir: null,
    records: () => [],
    profiles: { list: () => Promise.resolve(ok(PROFILES)) },
    store,
    log: { info() {} },
  });
  const edits: Edits = { requests: [] };
  const review = createPluginReview({
    store,
    plugins: service,
    profiles: { list: () => Promise.resolve(ok(PROFILES)) },
    userDir: join(root, "config", "plugins"),
    ids: createLocalIdFactory({ now: () => 1_800_000_000_000 }, systemRandom()),
    now: isoNow,
    log: SILENT,
    approvalHooks: approvalHooksOf(hooksFor(edits)),
  });
  return { root, pluginsDir: join(root, "config", "plugins"), store, review, edits };
}

/** 결과가 값이면 값을 준다. 실패면 시험을 실패시킨다 */
function valueOf<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected a value, got ${JSON.stringify(result.error)}`);
  return result.value;
}

/** 결과가 실패면 실패를 준다. 값이면 시험을 실패시킨다 */
function errorOf<T, E>(result: Result<T, E>): E {
  if (result.ok) throw new Error("expected a failure, got a value");
  return result.error;
}

const APPROVE_ONCE = { kind: "approve", profileIds: [], libraryOnly: false } as const;

/** 재료 포트가 그 대화에서 낸 지침. 검토본이 없으면 `treeOf`가 null이라 재료가 없다 */
async function instructionsOf(rig: Rig, name: string): Promise<readonly MaterialText[]> {
  const reviewed = valueOf(await rig.store.current(name));
  const port = createMaterialPort({
    pluginSet: () => [name],
    treeOf: () => reviewed?.treePath ?? null,
    read: (dir) => readPluginFolder(dir, { origin: "user" }),
    report: () => {},
  });
  return port.instructions(THREAD);
}

test("the generated name is instr- and the first six hex digits of the text's sha256", () => {
  expect(generatedNameOf("Answer in Korean.")).toBe("instr-7ac150");
});

test("the purpose is the first 200 characters with newlines as spaces and the ends trimmed", () => {
  expect(purposeOf("첫 줄\n둘째 줄")).toBe("첫 줄 둘째 줄");
  expect(purposeOf("  hi  ")).toBe("hi");
  expect(purposeOf("a".repeat(250))).toBe("a".repeat(200));
  // 서로게이트 쌍은 두 글자로 세지 않는다. 200 UTF-16 단위를 넘지 않는다
  expect(purposeOf("😀".repeat(150))).toBe("😀".repeat(100));
});

test("the input is checked for length, blank text and the name pattern", () => {
  expect(instructionIssuesOf("", undefined).map((issue) => issue.code)).toEqual(["text_length"]);
  expect(instructionIssuesOf("a".repeat(2001), undefined).map((issue) => issue.code)).toEqual([
    "text_length",
  ]);
  expect(instructionIssuesOf("a".repeat(2000), undefined)).toEqual([]);
  expect(instructionIssuesOf(" \n\t ", undefined).map((issue) => issue.code)).toEqual([
    "text_blank",
  ]);
  expect(instructionIssuesOf("ok", "Bad Name").map((issue) => issue.code)).toEqual([
    "name_invalid",
  ]);
  expect(instructionIssuesOf("ok", "brief-notes")).toEqual([]);
});

test("a new instruction writes the text unchanged and a minimal manifest, and opens a user_instruction item", async () => {
  const rig = rigOf();
  const text = "  Answer in Korean.  \n한 줄 더  ";
  const made = valueOf(await rig.review.fromInstruction({ text }));
  const name = generatedNameOf(text);

  // 폴더와 파일 내용: 지침은 입력 그대로(앞뒤 공백과 개행 포함, 끝 개행 없음)
  expect(readFileSync(join(rig.pluginsDir, name, "instructions.md"), "utf8")).toBe(text);
  const manifest: unknown = JSON.parse(
    readFileSync(join(rig.pluginsDir, name, ".fresnel-plugin", "plugin.json"), "utf8"),
  );
  expect(manifest).toEqual({
    schemaVersion: 2,
    name,
    version: "0.0.0",
    purpose: "Answer in Korean.   한 줄 더",
    components: { instructions: ["instructions.md"] },
  });

  const item: ReviewItem = valueOf(await rig.review.get(made.itemId)).item;
  expect(item.kind).toBe("new");
  expect(item.state).toBe("pending");
  expect(item.provenance).toBe("user_instruction");
  expect(item.originThreadId).toBeNull();
  expect(item.originProfileId).toBe("default");
  expect(item.name).toBe(name);
  expect(item.files.map((file) => file.path)).toEqual([
    ".fresnel-plugin/plugin.json",
    "instructions.md",
  ]);

  // 카드: 지침 칸 하나, 코드와 훅과 Drive가 없고, 권고다
  expect(item.card.purpose).toBe("Answer in Korean.   한 줄 더");
  expect(item.card.does.inject?.instructions.always).toEqual([
    { path: "instructions.md", bytes: Buffer.byteLength(text, "utf8") },
  ]);
  expect(item.card.does.hook).toBeNull();
  expect(item.card.does.drive).toBeNull();
  expect(item.card.runs.code).toBe(false);
  expect(item.card.enforcement).toBe("advisory");

  // 초안은 같은 폴더를 가리키고, 항목과 짝이 된다
  const drafts = valueOf(await rig.review.draftList(name)).drafts;
  expect(drafts.map((draft) => [draft.draftId, draft.submittedItemId])).toEqual([
    [made.draftId, made.itemId],
  ]);
  expect(drafts[0]?.originThreadId).toBeNull();
});

test("before approval the model sees no instruction; one approval puts the plugin in the profile and the text comes back exactly", async () => {
  const rig = rigOf();
  const text = "Answer in Korean.";
  const made = valueOf(await rig.review.fromInstruction({ text, profileId: "work" }));
  const name = generatedNameOf(text);

  expect(await instructionsOf(rig, name)).toEqual([]);

  const outcome = valueOf(await rig.review.decide(made.itemId, APPROVE_ONCE));
  expect(outcome.item.state).toBe("approved");
  // 승인 대상 프로필은 항목의 `originProfileId`다. 승인 한 번이 그 프로필에 넣는다
  expect(outcome.appliedTo).toEqual(["work"]);
  const [request] = rig.edits.requests;
  expect(request?.kind).toBe("add");
  expect(request?.kind === "add" ? request.profileIds : null).toEqual(["work"]);

  expect(await instructionsOf(rig, name)).toEqual([
    { key: `plugin:${name}:instructions.md`, text },
  ]);
});

test("a name the caller leaves out falls back to the default profile, and the approval adds the plugin there", async () => {
  const rig = rigOf();
  const made = valueOf(await rig.review.fromInstruction({ text: "Answer in Korean." }));
  const item = valueOf(await rig.review.get(made.itemId)).item;
  expect(item.originProfileId).toBe("default");
  expect(valueOf(await rig.review.decide(made.itemId, APPROVE_ONCE)).appliedTo).toEqual([
    "default",
  ]);
});

test("a source scan right after the draft and after the approval queues nothing more for the same folder", async () => {
  const rig = rigOf();
  const made = valueOf(
    await rig.review.fromInstruction({ text: "Answer briefly.", name: "brief" }),
  );
  // 원본이 초안과 같으므로 훑기가 `unknown` 항목을 또 만들지 않는다
  expect(valueOf(await rig.review.scan()).queued).toEqual([]);
  valueOf(await rig.review.decide(made.itemId, APPROVE_ONCE));
  expect(valueOf(await rig.review.scan()).queued).toEqual([]);
  expect(valueOf(await rig.review.list({ name: "brief" })).items.map((item) => item.state)).toEqual(
    ["approved"],
  );
});

test("the same text without a name is a plugin.exists refusal, and a pending same-name folder is refused too", async () => {
  const rig = rigOf();
  const text = "Answer in Korean.";
  valueOf(await rig.review.fromInstruction({ text }));
  const again = errorOf(await rig.review.fromInstruction({ text }));
  expect(again).toEqual({ kind: "exists", name: generatedNameOf(text) });

  // 이름을 명시해도 검토본이 없으면(아직 대기 중) 새 버전으로 덮어쓰지 않는다
  valueOf(await rig.review.fromInstruction({ text: "Other.", name: "pending-one" }));
  expect(
    errorOf(await rig.review.fromInstruction({ text: "Again.", name: "pending-one" })),
  ).toEqual({ kind: "exists", name: "pending-one" });
});

test("a named instruction is a new version of the same plugin after approval, with an update item that is approvable", async () => {
  const rig = rigOf();
  const first = valueOf(
    await rig.review.fromInstruction({ text: "Use metric units.", name: "units" }),
  );
  valueOf(await rig.review.decide(first.itemId, APPROVE_ONCE));
  const before = valueOf(await rig.store.current("units"));
  expect(before?.meta.card.purpose).toBe("Use metric units.");

  const second = valueOf(
    await rig.review.fromInstruction({ text: "Use imperial units.", name: "units" }),
  );
  expect(readFileSync(join(rig.pluginsDir, "units", "instructions.md"), "utf8")).toBe(
    "Use imperial units.",
  );
  const update = valueOf(await rig.review.get(second.itemId)).item;
  expect(update.kind).toBe("update");
  expect(update.provenance).toBe("user_instruction");
  expect(update.baseHash).toBe(before?.contentHash ?? null);
  expect(update.originProfileId).toBe("default");

  // 손 수정 판정(`unknown`)이 아니라서 승인할 수 있다. 승인하면 새 검토본이 current다
  const outcome = valueOf(await rig.review.decide(second.itemId, APPROVE_ONCE));
  expect(outcome.item.state).toBe("approved");
  const current = valueOf(await rig.store.current("units"));
  expect(current?.contentHash ?? null).toBe(update.candidateHash);
  expect(await instructionsOf(rig, "units")).toEqual([
    { key: "plugin:units:instructions.md", text: "Use imperial units." },
  ]);
});

test("a same-name folder that is not an instruction plugin is never overwritten, even with a name", async () => {
  const rig = rigOf();
  // 사용자가 손으로 만든 플러그인을 검토해 승인한다
  writeFiles(join(rig.pluginsDir, "kit"), {
    ".fresnel-plugin/plugin.json": JSON.stringify({
      schemaVersion: 2,
      name: "kit",
      version: "1.0.0",
      purpose: "Keeps the kit",
    }),
    "instructions.md": "Use kit.",
  });
  const queued = valueOf(await rig.review.scan()).queued;
  const kitItem = queued[0];
  if (kitItem === undefined) throw new Error("expected the scan to queue the kit");
  valueOf(await rig.review.decide(kitItem, APPROVE_ONCE));

  expect(errorOf(await rig.review.fromInstruction({ text: "Replace.", name: "kit" }))).toEqual({
    kind: "exists",
    name: "kit",
  });
  expect(readFileSync(join(rig.pluginsDir, "kit", "instructions.md"), "utf8")).toBe("Use kit.");
});

test("an approved instruction folder that gained another file is not an instruction plugin any more", async () => {
  const rig = rigOf();
  const made = valueOf(await rig.review.fromInstruction({ text: "Be terse.", name: "terse" }));
  valueOf(await rig.review.decide(made.itemId, APPROVE_ONCE));
  writeFiles(join(rig.pluginsDir, "terse"), { "notes.md": "extra" });

  expect(errorOf(await rig.review.fromInstruction({ text: "Be kind.", name: "terse" }))).toEqual({
    kind: "exists",
    name: "terse",
  });
  expect(existsSync(join(rig.pluginsDir, "terse", "notes.md"))).toBe(true);
});

test("an unknown profile is refused before any folder is written", async () => {
  const rig = rigOf();
  const failure = errorOf(
    await rig.review.fromInstruction({ text: "Be terse.", profileId: "missing" }),
  );
  expect(failure).toEqual({
    kind: "profiles",
    failure: { kind: "not_found", id: "missing" },
  });
  expect(existsSync(join(rig.pluginsDir, generatedNameOf("Be terse.")))).toBe(false);
});

test("invalid input is a plugin.invalid issue list and writes nothing", async () => {
  const rig = rigOf();
  const failure: PluginPortFailure = errorOf(await rig.review.fromInstruction({ text: "  \n " }));
  expect(failure).toEqual({
    kind: "draft_invalid",
    issues: [{ code: "text_blank", severity: "error", path: "/text", message: "text is blank" }],
  });
  expect(errorOf(await rig.review.fromInstruction({ text: "x", name: "Bad Name" })).kind).toBe(
    "draft_invalid",
  );
  expect(existsSync(join(rig.pluginsDir))).toBe(false);
});

test("a folder that cannot be written is a store failure and leaves no draft behind", async () => {
  const rig = rigOf();
  // 사용자 플러그인 폴더 자리에 파일을 둬서 디렉터리를 만들 수 없게 한다
  writeFiles(rig.root, { "config/plugins": "not a folder" });
  const failure = errorOf(await rig.review.fromInstruction({ text: "Be terse." }));
  expect(failure).toEqual({ kind: "store", code: "io" });
  expect(valueOf(await rig.review.list({})).items).toEqual([]);
});
