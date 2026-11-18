import { afterEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { err, ok, parse, type Logger, type Result } from "@fresnel/contracts";
import { ThreadIdSchema } from "@fresnel/contracts/conversation";
import type { ReviewItem } from "@fresnel/contracts/wire";
import { createLocalIdFactory, systemRandom } from "@fresnel/platform-os";
import {
  createPluginReview,
  createPluginService,
  createPluginStore,
  type ApprovalHooks,
  type PluginReview,
  type PluginService,
  type PluginStore,
} from "../../../src/assembly/plugins/index.ts";
import type { PluginFact } from "../../../src/assembly/m4/plugin-fact.ts";
import type { PluginEditIssue } from "../../../src/assembly/m4/plugin-edit.ts";
import type { PluginPortFailure } from "../../../src/handlers/m5/plugins.ts";
import type { PluginChange } from "../../../src/handlers/m5/plugin-review.ts";
import { passThroughFileLock, removeTree, tempRoot, writeFiles } from "./support.ts";

// M5c §4.7, §4.9, §8 수용 27~33: 검토 항목의 전 과정을 임시 폴더에서 돌린다.
// 새 항목, 수정 항목, 손 수정 거절과 되돌리기, 대체, 버리기, 목적 문장, 재시작, 제거, 돌려보내기, 초안, 제출, 경로 탈출, 보관 개수.

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

const EMPTY_LIST = {
  profiles: [],
  common: { plugins: [], settings: [], updatedAt: "2026-11-18T00:00:00.000Z", rev: 1 },
  rev: 1,
};

/** 시험의 시각. 호출마다 1초씩 나아가 항목의 생성 순서가 정해진다 */
let tick = 0;
function isoNow(): string {
  tick += 1;
  return new Date(Date.UTC(2026, 10, 18, 1, 0, 0) + tick * 1000).toISOString();
}

interface Rig {
  readonly root: string;
  readonly pluginsDir: string;
  readonly store: PluginStore;
  readonly service: PluginService;
  readonly review: PluginReview;
  readonly notified: PluginChange[];
  readonly origins: { threadId: string; reason: string; itemId: string }[];
}

/** 같은 루트를 여는 검토 서비스 묶음. 재시작 시험은 같은 루트로 다시 연다 */
function openRig(
  root: string,
  hooks?: ApprovalHooks,
  projectRoots: () => Promise<readonly string[]> = () => Promise.resolve([]),
): Rig {
  const store = createPluginStore({
    root: join(root, "plugin-store"),
    fileLock: passThroughFileLock,
  });
  const service = createPluginService({
    configDir: join(root, "config"),
    projectRoots,
    managedDir: null,
    bundleDir: null,
    records: () => [],
    profiles: { list: () => Promise.resolve(ok(EMPTY_LIST)) },
    store,
    log: { info() {} },
  });
  const origins: { threadId: string; reason: string; itemId: string }[] = [];
  const review = createPluginReview({
    store,
    plugins: service,
    profiles: { list: () => Promise.resolve(ok(EMPTY_LIST)) },
    userDir: join(root, "config", "plugins"),
    ids: createLocalIdFactory({ now: () => 1_800_000_000_000 }, systemRandom()),
    now: isoNow,
    log: SILENT,
    notifyOrigin: async (input) => {
      origins.push(input);
      return true;
    },
    ...(hooks === undefined ? {} : { approvalHooks: hooks }),
  });
  const notified: PluginChange[] = [];
  review.onChanged((change) => notified.push(change));
  return {
    root,
    pluginsDir: join(root, "config", "plugins"),
    store,
    service,
    review,
    notified,
    origins,
  };
}

function rigOf(): Rig {
  const root = tempRoot("plugin-review-");
  roots.push(root);
  return openRig(root);
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

function firstOf<T>(items: readonly T[]): T {
  const [first] = items;
  if (first === undefined) throw new Error("expected one item");
  return first;
}

function manifestOf(name: string, purpose?: string): string {
  return JSON.stringify({
    schemaVersion: 2,
    name,
    version: "1.0.0",
    ...(purpose === undefined ? {} : { purpose }),
  });
}

const APPROVE = { kind: "approve", profileIds: [], libraryOnly: true } as const;

/** `count`번 `step`을 차례로 부른다. 앞 단계가 끝나야 다음을 시작한다(루프 안 await 대신) */
function inOrder(count: number, step: (index: number) => Promise<void>): Promise<void> {
  return Array.from({ length: count }, (_, index) => index).reduce<Promise<void>>(
    (chain, index) => chain.then(() => step(index)),
    Promise.resolve(),
  );
}

/** 제출 포트의 `originThreadId`는 대화 id 형식이다. 형식이 맞는 고정 값을 쓴다 */
const BUILDER_THREAD = valueOf(parse(ThreadIdSchema, "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV"));

/** 사용자 폴더에 플러그인 `kit`을 만들고 scan으로 새 항목을 만든 뒤 승인한다 */
async function approvedKit(rig: Rig): Promise<ReviewItem> {
  writeFiles(join(rig.pluginsDir, "kit"), {
    ".fresnel-plugin/plugin.json": manifestOf("kit", "Keeps the kit"),
    "instructions.md": "Use kit.",
  });
  const itemId = firstOf(valueOf(await rig.review.scan()).queued);
  return valueOf(await rig.review.decide(itemId, APPROVE)).item;
}

// M5c §4.4.10, §4.5.2, §4.7.9: 등록된 프로젝트 루트의 동반 플러그인은 `project` 출처 검토 항목이다. 승인 전에는 검토본이 없다.
test("a plugin carried by a registered project root is a project review item, with no reviewed copy until approved", async () => {
  const root = tempRoot("plugin-review-project-");
  roots.push(root);
  const project = join(root, "project");
  writeFiles(join(project, ".fresnel", "plugins", "carried"), {
    ".fresnel-plugin/plugin.json": manifestOf("carried", "Carried by the project"),
    "instructions.md": "Project rule.",
  });
  const rig = openRig(root, undefined, () => Promise.resolve([project]));
  const queued = valueOf(await rig.review.scan()).queued;
  expect(queued.length).toBe(1);
  const item = valueOf(await rig.review.get(firstOf(queued))).item;
  expect(item).toMatchObject({ name: "carried", provenance: "project", state: "pending" });
  expect(valueOf(await rig.store.current("carried"))).toBeNull();

  valueOf(await rig.review.decide(item.itemId, APPROVE));
  expect(valueOf(await rig.store.current("carried"))).not.toBeNull();
});

test("a project folder that is not a registered root is not scanned", async () => {
  const root = tempRoot("plugin-review-project-");
  roots.push(root);
  writeFiles(join(root, "project", ".fresnel", "plugins", "stray"), {
    ".fresnel-plugin/plugin.json": manifestOf("stray", "Not registered"),
  });
  const rig = openRig(root, undefined, () => Promise.resolve([]));
  expect(valueOf(await rig.review.scan()).queued).toEqual([]);
});

test("a new plugin folder is queued as a new item, and approving it makes the reviewed copy current", async () => {
  const rig = rigOf();
  writeFiles(join(rig.pluginsDir, "kit"), {
    ".fresnel-plugin/plugin.json": manifestOf("kit", "Keeps the kit"),
    "instructions.md": "Use kit.",
  });
  const queued = valueOf(await rig.review.scan()).queued;
  expect(queued.length).toBe(1);
  const item = valueOf(await rig.review.get(firstOf(queued))).item;
  expect(item.kind).toBe("new");
  expect(item.state).toBe("pending");
  expect(item.provenance).toBe("unknown");
  expect(item.baseHash).toBeNull();
  expect(item.card.purpose).toBe("Keeps the kit");
  expect(item.diff.added.some((entry) => entry.what === "instruction:instructions.md")).toBe(true);
  expect(item.diff.removed).toEqual([]);
  expect(item.files.map((file) => file.path)).toEqual([
    ".fresnel-plugin/plugin.json",
    "instructions.md",
  ]);

  const outcome = valueOf(await rig.review.decide(item.itemId, APPROVE));
  expect(outcome.item.state).toBe("approved");
  expect(outcome.appliedTo).toEqual([]);
  const current = valueOf(await rig.store.current("kit"));
  expect(current?.contentHash ?? null).toBe(item.candidateHash);
  const log = valueOf(await rig.store.readLog());
  expect(log.map((entry) => [entry.decision, entry.actor, entry.itemId])).toEqual([
    ["approved", "user", item.itemId],
  ]);
  expect(valueOf(await rig.service.get("kit")).card.review.state).toBe("approved");
  expect(rig.notified).toContainEqual({ kind: "plugin", name: "kit" });
});

test("an edit after approval is an update that cannot be approved as a hand edit, and revert restores the source and withdraws it", async () => {
  const rig = rigOf();
  const approved = await approvedKit(rig);
  writeFiles(join(rig.pluginsDir, "kit"), { "instructions.md": "Use kit, carefully." });
  const update = valueOf(
    await rig.review.get(firstOf(valueOf(await rig.review.scan()).queued)),
  ).item;
  expect(update.kind).toBe("update");
  expect(update.provenance).toBe("unknown");
  expect(update.baseHash).toBe(approved.candidateHash);
  expect(update.diff.changed.some((entry) => entry.what === "instruction:instructions.md")).toBe(
    true,
  );
  expect(errorOf(await rig.review.decide(update.itemId, APPROVE)).kind).toBe("hand_edit");

  const restored = valueOf(await rig.review.revert("kit"));
  expect(restored.restored).toBe(true);
  expect(readFileSync(join(rig.pluginsDir, "kit", "instructions.md"), "utf8")).toBe("Use kit.");
  expect(valueOf(await rig.review.get(update.itemId)).item.state).toBe("withdrawn");
});

test("a second edit supersedes the first pending item, and a discarded hash is not queued again until the source changes", async () => {
  const rig = rigOf();
  await approvedKit(rig);
  writeFiles(join(rig.pluginsDir, "kit"), { "instructions.md": "Use kit, once." });
  const first = firstOf(valueOf(await rig.review.scan()).queued);
  writeFiles(join(rig.pluginsDir, "kit"), { "instructions.md": "Use kit, twice." });
  const second = firstOf(valueOf(await rig.review.scan()).queued);
  expect(valueOf(await rig.review.get(first)).item.state).toBe("superseded");
  expect(valueOf(await rig.review.get(second)).item.state).toBe("pending");

  expect(valueOf(await rig.review.decide(second, { kind: "discard" })).item.state).toBe(
    "discarded",
  );
  // 원본이 그대로면 버린 내용을 다시 올리지 않는다
  expect(valueOf(await rig.review.scan()).queued).toEqual([]);

  writeFiles(join(rig.pluginsDir, "kit"), { "instructions.md": "Use kit, three times." });
  expect(valueOf(await rig.review.scan()).queued.length).toBe(1);
});

test("approval without a purpose is refused, and a purpose in the decision is recorded without changing the hash", async () => {
  const rig = rigOf();
  writeFiles(join(rig.pluginsDir, "bare"), { ".fresnel-plugin/plugin.json": manifestOf("bare") });
  const itemId = firstOf(valueOf(await rig.review.scan()).queued);
  const item = valueOf(await rig.review.get(itemId)).item;
  expect(item.card.purpose).toBeNull();
  expect(errorOf(await rig.review.decide(itemId, APPROVE)).kind).toBe("purpose_required");

  const outcome = valueOf(
    await rig.review.decide(itemId, {
      kind: "approve",
      profileIds: [],
      libraryOnly: true,
      purpose: "A bare plugin.",
    }),
  );
  expect(outcome.item.card.purpose).toBe("A bare plugin.");
  const current = valueOf(await rig.store.current("bare"));
  expect(current?.meta.card.purpose).toBe("A bare plugin.");
  expect(current?.contentHash ?? null).toBe(item.candidateHash);
});

test("pending items and the reviewed copies survive a restart of the services", async () => {
  const rig = rigOf();
  writeFiles(join(rig.pluginsDir, "late"), {
    ".fresnel-plugin/plugin.json": manifestOf("late", "Late"),
  });
  const itemId = firstOf(valueOf(await rig.review.scan()).queued);
  const again = openRig(rig.root);
  const listed = valueOf(await again.review.list({ state: "pending" })).items;
  expect(listed.map((item) => item.itemId)).toEqual([itemId]);
});

test("a remove request is an item that stays pending until approved, and approving it clears the reviewed current", async () => {
  const rig = rigOf();
  await approvedKit(rig);
  const itemId = valueOf(await rig.review.requestRemove("kit")).itemId;
  const pending = valueOf(await rig.review.list({ state: "pending" })).items;
  expect(pending.map((item) => [item.kind, item.name])).toEqual([["remove", "kit"]]);
  expect(pending[0]?.candidateHash).toBeNull();
  expect(pending[0]?.removal?.baseCard.name).toBe("kit");
  // 승인 전에는 검토본이 그대로 돈다
  expect(valueOf(await rig.store.current("kit"))).not.toBeNull();

  const outcome = valueOf(await rig.review.decide(itemId, APPROVE));
  expect(outcome.item.state).toBe("approved");
  expect(valueOf(await rig.store.current("kit"))).toBeNull();
  expect(errorOf(await rig.review.requestRemove("nothing")).kind).toBe("unknown_plugin");
});

test("a user folder that disappears becomes a remove item, and a discarded remove is not made again", async () => {
  const rig = rigOf();
  writeFiles(join(rig.pluginsDir, "gone"), {
    ".fresnel-plugin/plugin.json": manifestOf("gone", "Gone"),
  });
  const approvedItem = valueOf(
    await rig.review.decide(firstOf(valueOf(await rig.review.scan()).queued), APPROVE),
  ).item;
  expect(approvedItem.state).toBe("approved");

  removeTree(join(rig.pluginsDir, "gone"));
  const removal = valueOf(
    await rig.review.get(firstOf(valueOf(await rig.review.scan()).queued)),
  ).item;
  expect(removal.kind).toBe("remove");
  expect(removal.provenance).toBe("unknown");
  expect(valueOf(await rig.review.decide(removal.itemId, { kind: "discard" })).item.state).toBe(
    "discarded",
  );
  expect(valueOf(await rig.review.scan()).queued).toEqual([]);
});

test("sendBack keeps the reason on the item and sends it to the origin conversation", async () => {
  const rig = rigOf();
  const folder = join(rig.root, "work", "helper-kit");
  writeFiles(folder, { ".fresnel-plugin/plugin.json": manifestOf("helper-kit", "Runs the tool") });
  const draftId = valueOf(await rig.review.draftCreate(folder, "thr_origin")).draftId;
  const itemId = valueOf(await rig.review.submitDraft(draftId)).itemId;
  expect(valueOf(await rig.review.get(itemId)).item.originThreadId).toBe("thr_origin");

  const outcome = valueOf(
    await rig.review.decide(itemId, { kind: "sendBack", reason: "Add a test." }),
  );
  expect(outcome.item.state).toBe("sent_back");
  expect(outcome.item.reason).toBe("Add a test.");
  expect(valueOf(await rig.review.get(itemId)).item.reason).toBe("Add a test.");
  expect(rig.origins).toEqual([{ threadId: "thr_origin", reason: "Add a test.", itemId }]);
});

test("drafts are listed newest first with their parent, and at most twenty are kept per plugin", async () => {
  const rig = rigOf();
  const folder = join(rig.root, "src", "work");
  // 초안은 차례대로 만들어야 부모 관계가 정해진다
  const ids: string[] = [];
  await inOrder(21, async (index) => {
    writeFiles(folder, {
      ".fresnel-plugin/plugin.json": manifestOf("notes-kit", "Work"),
      "notes.md": `version ${index}`,
    });
    ids.push(valueOf(await rig.review.draftCreate(folder, undefined)).draftId);
  });
  const listed = valueOf(await rig.review.draftList("notes-kit")).drafts;
  expect(listed.length).toBe(20);
  expect(listed[0]?.draftId).toBe(ids[20]);
  expect(listed[0]?.parent).toBe(ids[19]);
  expect(listed.some((draft) => draft.draftId === ids[0])).toBe(false);
  expect(errorOf(await rig.review.draftList("nothing")).kind).toBe("unknown_plugin");
});

test("discarding a draft removes it from the list, and an unknown draft is draft_not_found", async () => {
  const rig = rigOf();
  const folder = join(rig.root, "src", "pair");
  writeFiles(folder, { ".fresnel-plugin/plugin.json": manifestOf("pair-kit", "Pair") });
  const first = valueOf(await rig.review.draftCreate(folder, undefined)).draftId;
  writeFiles(folder, { "notes.md": "changed" });
  const second = valueOf(await rig.review.draftCreate(folder, undefined)).draftId;
  valueOf(await rig.review.draftDiscard(first));
  expect(
    valueOf(await rig.review.draftList("pair-kit")).drafts.map((draft) => draft.draftId),
  ).toEqual([second]);
  expect(errorOf(await rig.review.draftDiscard("drf_not_there")).kind).toBe("draft_not_found");
});

test("submitDraft makes an assistant item linked from the draft, and sending the same draft again gives the same item", async () => {
  const rig = rigOf();
  const folder = join(rig.root, "src", "helper-kit");
  writeFiles(folder, { ".fresnel-plugin/plugin.json": manifestOf("helper-kit", "Runs the tool") });
  const draftId = valueOf(await rig.review.draftCreate(folder, "thr_maker")).draftId;
  const itemId = valueOf(await rig.review.submitDraft(draftId)).itemId;
  const item = valueOf(await rig.review.get(itemId)).item;
  expect(item.provenance).toBe("assistant");
  expect(item.kind).toBe("new");
  expect(item.originThreadId).toBe("thr_maker");
  expect(valueOf(await rig.review.draftList("helper-kit")).drafts[0]?.submittedItemId).toBe(itemId);
  expect(valueOf(await rig.review.submitDraft(draftId)).itemId).toBe(itemId);
});

test("the submit port makes a draft and an assistant item with the given evidence and purpose", async () => {
  const rig = rigOf();
  const folder = join(rig.root, "src", "kit2");
  writeFiles(folder, { ".fresnel-plugin/plugin.json": manifestOf("kit2") });
  const result = valueOf(
    await rig.review.submitPort.submit({
      dir: folder,
      originThreadId: BUILDER_THREAD,
      evidence: [{ kind: "turn", threadId: BUILDER_THREAD, turnId: "trn_1" }],
      purpose: "Helps",
    }),
  );
  expect(result.draftId.startsWith("drf_")).toBe(true);
  const item = valueOf(await rig.review.get(result.itemId)).item;
  expect(item.provenance).toBe("assistant");
  expect(item.evidence.length).toBe(1);
  expect(item.card.purpose).toBe("Helps");

  const empty = join(rig.root, "src", "empty");
  mkdirSync(empty, { recursive: true });
  const refused = errorOf(
    await rig.review.submitPort.submit({
      dir: empty,
      originThreadId: BUILDER_THREAD,
      evidence: [{ kind: "turn", threadId: BUILDER_THREAD, turnId: "trn_2" }],
    }),
  );
  expect(refused.kind).toBe("invalid");
});

test("file reads stay inside the reviewed snapshot", async () => {
  const rig = rigOf();
  writeFiles(join(rig.pluginsDir, "kit"), {
    ".fresnel-plugin/plugin.json": manifestOf("kit", "Keeps the kit"),
    "instructions.md": "Use kit.",
  });
  const itemId = firstOf(valueOf(await rig.review.scan()).queued);
  const file = valueOf(await rig.review.file(itemId, "instructions.md"));
  expect(file.text).toBe("Use kit.");
  expect(file.truncated).toBe(false);
  expect(errorOf(await rig.review.file(itemId, "../kit/instructions.md")).kind).toBe(
    "path_invalid",
  );
  expect(errorOf(await rig.review.file(itemId, "/etc/hosts")).kind).toBe("path_invalid");
  expect(errorOf(await rig.review.file(itemId, "missing.md")).kind).toBe("path_invalid");
  expect(errorOf(await rig.review.file("rvw_NOPE", "instructions.md")).kind).toBe(
    "review_not_found",
  );
});

test("a symbolic link in a draft folder is refused, and a broken manifest is refused with its issues", async () => {
  const rig = rigOf();
  const linked = join(rig.root, "src", "linked");
  writeFiles(linked, { ".fresnel-plugin/plugin.json": manifestOf("linked-kit", "x") });
  symlinkSync(join(linked, ".fresnel-plugin", "plugin.json"), join(linked, "link.md"));
  expect(errorOf(await rig.review.draftCreate(linked, undefined)).kind).toBe("symlink_refused");

  const broken = join(rig.root, "src", "broken");
  writeFiles(broken, { ".fresnel-plugin/plugin.json": "{not json" });
  const failure = errorOf(await rig.review.draftCreate(broken, undefined));
  if (failure.kind !== "draft_invalid")
    throw new Error(`expected draft_invalid, got ${failure.kind}`);
  expect(failure.issues.length).toBeGreaterThan(0);
});

test("an unknown item is review_not_found, and a closed item cannot be decided again", async () => {
  const rig = rigOf();
  expect(
    errorOf(await rig.review.decide("rvw_00000000000000000000000000", { kind: "discard" })).kind,
  ).toBe("review_not_found");
  writeFiles(join(rig.pluginsDir, "once"), {
    ".fresnel-plugin/plugin.json": manifestOf("once", "Once"),
  });
  const itemId = firstOf(valueOf(await rig.review.scan()).queued);
  valueOf(await rig.review.decide(itemId, APPROVE));
  expect(errorOf(await rig.review.decide(itemId, APPROVE)).kind).toBe("not_pending");
});

test("approving the same plugin again and again keeps the five newest reviewed versions", async () => {
  const rig = rigOf();
  await approvedKit(rig);
  const folder = join(rig.pluginsDir, "kit");
  // 차례대로 승인해야 보관 순서가 정해진다. 손으로 고친 원본은 승인할 수 없으므로 초안으로 보낸다(출처 `assistant`)
  await inOrder(6, async (position) => {
    const index = position + 1;
    writeFiles(folder, { "instructions.md": `Use kit, version ${index}.` });
    const draftId = valueOf(await rig.review.draftCreate(folder, undefined)).draftId;
    const itemId = valueOf(await rig.review.submitDraft(draftId)).itemId;
    valueOf(await rig.review.decide(itemId, APPROVE));
  });
  const versions = valueOf(await rig.store.versions("kit"));
  expect(versions.length).toBe(5);
  expect(versions.filter((version) => version.current).length).toBe(1);
});

// 승인의 프로필 반영 훅(M5c §4.7.3): 커밋 전 검사, 커밋 뒤 프로필 쓰기, 실행 중인 판 맞추기가 검토 서비스의 순서대로 돈다.

function hookedRigOf(hooks: ApprovalHooks): Rig {
  const root = tempRoot("plugin-review-hooks-");
  roots.push(root);
  return openRig(root, hooks);
}

/** 사용자 폴더에 `kit`을 만들고 scan으로 새 항목 하나를 받는다. 항목 id를 돌려준다 */
async function queuedKit(rig: Rig): Promise<string> {
  writeFiles(join(rig.pluginsDir, "kit"), {
    ".fresnel-plugin/plugin.json": manifestOf("kit", "Keeps the kit"),
    "instructions.md": "Use kit.",
  });
  return firstOf(valueOf(await rig.review.scan()).queued);
}

test("a profile check that fails before the commit leaves current, the log, and the item as they were", async () => {
  const issues: PluginEditIssue[] = [
    { profile: "p1", code: "plugin_not_reviewed", severity: "error", plugin: "kit" },
  ];
  const failure: PluginPortFailure = { kind: "profile_invalid", issues };
  const rig = hookedRigOf({
    beforeCommit: () => Promise.resolve(err(failure)),
  });
  const itemId = await queuedKit(rig);
  expect(errorOf(await rig.review.decide(itemId, APPROVE))).toEqual(failure);
  expect(valueOf(await rig.store.current("kit"))).toBeNull();
  expect(valueOf(await rig.store.readLog())).toEqual([]);
  expect(valueOf(await rig.review.get(itemId)).item.state).toBe("pending");
});

test("a failing profile write after the swap puts the previous current back and records nothing", async () => {
  const failure: PluginPortFailure = {
    kind: "profiles",
    failure: { kind: "io", path: "profiles.json", code: "EIO" },
  };
  const rig = hookedRigOf({
    afterCommit: () => Promise.resolve(err(failure)),
  });
  const itemId = await queuedKit(rig);
  expect(errorOf(await rig.review.decide(itemId, APPROVE))).toEqual(failure);
  expect(valueOf(await rig.store.current("kit"))).toBeNull();
  expect(valueOf(await rig.store.readLog())).toEqual([]);
  expect(valueOf(await rig.review.get(itemId)).item.state).toBe("pending");
});

test("the hooks see the candidate facts, the log names the applied profiles, and reflect runs after the commit", async () => {
  const seen: string[] = [];
  const facts: PluginFact[] = [];
  const rig = hookedRigOf({
    beforeCommit: (context) => {
      seen.push(`before:${context.item.name}`);
      if (context.facts !== null) facts.push(context.facts);
      return Promise.resolve(ok(undefined));
    },
    afterCommit: (context) => {
      seen.push(`after:${context.item.name}`);
      return Promise.resolve(ok(["p1"]));
    },
    reflect: (context) => {
      seen.push(`reflect:${context.item.name}`);
      return Promise.resolve();
    },
  });
  const itemId = await queuedKit(rig);
  const outcome = valueOf(
    await rig.review.decide(itemId, {
      kind: "approve",
      profileIds: [],
      libraryOnly: false,
      purpose: "Keeps the kit",
    }),
  );
  expect(outcome.appliedTo).toEqual(["p1"]);
  expect(seen).toEqual(["before:kit", "after:kit", "reflect:kit"]);
  expect(facts.map((fact) => [fact.name, fact.replaces, fact.drives, fact.requiredKeys])).toEqual([
    ["kit", [], false, []],
  ]);
  expect(
    valueOf(await rig.store.readLog()).map((entry) => [entry.decision, entry.profileIds]),
  ).toEqual([["approved", ["p1"]]]);
});
