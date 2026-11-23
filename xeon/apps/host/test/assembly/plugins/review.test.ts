import { afterEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { err, ok, parse, type Logger, type Result } from "@fresnel/contracts";
import { ThreadIdSchema } from "@fresnel/contracts/conversation";
import type { CardDependencies } from "@fresnel/contracts/extensions";
import type { ProfilePlan, ReviewItem } from "@fresnel/contracts/wire";
import { createLocalIdFactory, systemRandom } from "@fresnel/platform-os";
import {
  createPluginReview,
  createPluginService,
  createPluginStore,
  type ApprovalHooks,
  type DiscoverProjectRoot,
  type PluginReview,
  type PluginService,
  type PluginStore,
} from "../../../src/assembly/plugins/index.ts";
import type { PluginFact } from "../../../src/assembly/m4/plugin-fact.ts";
import type { PluginEditIssue, PluginEditRequest } from "../../../src/assembly/m4/plugin-edit.ts";
import { approvalHooksOf } from "../../../src/assembly/plugins/approval.ts";
import type { DraftSubmitExtra } from "../../../src/assembly/plugins/review.ts";
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
  projectRoots: () => Promise<readonly DiscoverProjectRoot[]> = () => Promise.resolve([]),
  facts?: () => readonly PluginFact[],
  pluginData?: { readonly keys: number },
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
    ...(facts === undefined ? {} : { facts }),
    ...(pluginData === undefined
      ? {}
      : { pluginData: { usage: () => Promise.resolve(ok({ keys: pluginData.keys, bytes: 0 })) } }),
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

/** 설치된 플러그인 사실을 시험이 정하는 검토 서비스 한 벌(의존 검사용) */
function rigWithFacts(facts: () => readonly PluginFact[]): Rig {
  const root = tempRoot("plugin-review-");
  roots.push(root);
  return openRig(root, undefined, undefined, facts);
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

/** 매니페스트 한 줄. 설명은 기본으로 채워 승인 경로가 설명 때문에 막히지 않게 한다. 설명이 없는 경우를 시험하려면 `""`를 준다 */
function manifestOf(
  name: string,
  purpose?: string,
  description = `Does what ${name} says.`,
): string {
  return JSON.stringify({
    schemaVersion: 2,
    name,
    version: "1.0.0",
    ...(purpose === undefined ? {} : { purpose }),
    description,
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
    ".fresnel-plugin/plugin.json": manifestOf("kit", "Keeps the kit", "Keeps the kit working."),
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
  const rig = openRig(root, undefined, () =>
    Promise.resolve([{ root: project, projectId: "prj_alpha" }]),
  );
  const queued = valueOf(await rig.review.scan()).queued;
  expect(queued.length).toBe(1);
  const item = valueOf(await rig.review.get(firstOf(queued))).item;
  expect(item).toMatchObject({ name: "carried", provenance: "project", state: "pending" });
  expect(valueOf(await rig.store.current("prj_alpha/carried"))).toBeNull();

  valueOf(await rig.review.decide(item.itemId, APPROVE));
  // 프로젝트 출처 검토본은 `<projectId>/<이름>` 키로 남는다(AGE-41)
  expect(valueOf(await rig.store.current("prj_alpha/carried"))).not.toBeNull();
  expect(valueOf(await rig.store.current("carried"))).toBeNull();
});

// AGE-41: 같은 이름을 다른 프로젝트가 승인해도 섞이지 않는다. B의 `foo`는 A의 `foo`와 비교하지 않는다.
test("a same-named plugin of another project is a new item with no base, and approving it leaves the first project's copy alone", async () => {
  const root = tempRoot("plugin-review-two-projects-");
  roots.push(root);
  const projectA = join(root, "project-a");
  const projectB = join(root, "project-b");
  writeFiles(join(projectA, ".fresnel", "plugins", "foo"), {
    ".fresnel-plugin/plugin.json": manifestOf("foo", "Project A's foo"),
    "instructions.md": "Rule of A.",
  });
  // 발견은 이름당 한 폴더만 준다. 그래서 A를 승인한 뒤에는 A를 루트에서 빼고 B를 넣는다
  let visible: readonly DiscoverProjectRoot[] = [{ root: projectA, projectId: "prj_a" }];
  const rig = openRig(root, undefined, () => Promise.resolve(visible));
  const firstItem = valueOf(
    await rig.review.get(firstOf(valueOf(await rig.review.scan()).queued)),
  ).item;
  valueOf(await rig.review.decide(firstItem.itemId, APPROVE));
  const aCopy = valueOf(await rig.store.current("prj_a/foo"));
  expect(aCopy?.contentHash ?? null).toBe(firstItem.candidateHash);

  visible = [{ root: projectB, projectId: "prj_b" }];
  writeFiles(join(projectB, ".fresnel", "plugins", "foo"), {
    ".fresnel-plugin/plugin.json": manifestOf("foo", "Project B's foo"),
    "instructions.md": "Rule of B.",
  });
  const bItem = valueOf(
    await rig.review.get(firstOf(valueOf(await rig.review.scan()).queued)),
  ).item;
  expect(bItem).toMatchObject({ kind: "new", baseHash: null, name: "foo", state: "pending" });
  expect(bItem.card.origin).toEqual({ kind: "project", projectId: "prj_b" });

  valueOf(await rig.review.decide(bItem.itemId, APPROVE));
  expect(valueOf(await rig.store.current("prj_b/foo"))?.contentHash ?? null).toBe(
    bItem.candidateHash,
  );
  // A의 검토본은 그대로다(해시도, 현재 검토본 자리도)
  expect(valueOf(await rig.store.current("prj_a/foo"))?.contentHash ?? null).toBe(
    firstItem.candidateHash,
  );
  const logged = valueOf(await rig.store.readLog()).filter(
    (entry) => entry.itemId === bItem.itemId,
  );
  expect(logged.map((entry) => [entry.decision, entry.projectId])).toEqual([["approved", "prj_b"]]);
});

// 사용자 결정 2026-11-18(AGE-41): 승인하면 실행될 stdio 명령이 프로젝트 출처 검토 항목의 카드에 실린다. env 값은 실리지 않는다.
test("a project plugin's stdio server shows the command it will run on approval, with env names and no values", async () => {
  const root = tempRoot("plugin-review-project-mcp-");
  roots.push(root);
  const project = join(root, "project");
  writeFiles(join(project, ".fresnel", "plugins", "wired"), {
    ".fresnel-plugin/plugin.json": manifestOf("wired", "Wired to a server"),
    "mcp.json": JSON.stringify({
      mcpServers: {
        notes: { command: "node", args: ["notes.js"], env: { TOKEN: "s3cr3t-value" } },
      },
    }),
  });
  const rig = openRig(root, undefined, () =>
    Promise.resolve([{ root: project, projectId: "prj_alpha" }]),
  );
  const queued = valueOf(await rig.review.scan()).queued;
  const item = valueOf(await rig.review.get(firstOf(queued))).item;
  expect(item).toMatchObject({ provenance: "project", state: "pending" });
  expect(item.card.does.inject?.mcpServers).toEqual([
    {
      name: "notes",
      transport: "stdio",
      launch: { command: "node", args: ["notes.js"], envNames: ["TOKEN"], cwd: null },
    },
  ]);
  expect(JSON.stringify(item)).not.toContain("s3cr3t-value");
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
    ".fresnel-plugin/plugin.json": manifestOf("kit", "Keeps the kit", "Keeps the kit working."),
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

test("a purpose the manifest already has stays on the approved card when the decision carries a drafted purpose", async () => {
  const rig = rigOf();
  writeFiles(join(rig.pluginsDir, "owned"), {
    ".fresnel-plugin/plugin.json": manifestOf("owned", "Tracks movies to watch.", "Tracks movies."),
  });
  const itemId = firstOf(valueOf(await rig.review.scan()).queued);
  const outcome = valueOf(
    await rig.review.decide(itemId, {
      kind: "approve",
      profileIds: [],
      libraryOnly: true,
      purpose: "Adds one movie. Uses the same function as the add method of the screen.",
    }),
  );
  expect(outcome.item.card.purpose).toBe("Tracks movies to watch.");
  const current = valueOf(await rig.store.current("owned"));
  expect(current?.meta.card.purpose).toBe("Tracks movies to watch.");
});

test("approval without a description is refused with description_required; a purpose does not stand in for it", async () => {
  const rig = rigOf();
  writeFiles(join(rig.pluginsDir, "no-text"), {
    ".fresnel-plugin/plugin.json": manifestOf("no-text", "Has a purpose.", ""),
  });
  const itemId = firstOf(valueOf(await rig.review.scan()).queued);
  const item = valueOf(await rig.review.get(itemId)).item;
  expect(item.card.purpose).toBe("Has a purpose.");
  expect(item.card.description).toBeUndefined();
  expect(errorOf(await rig.review.decide(itemId, APPROVE))).toEqual({
    kind: "description_required",
    itemId,
  });
  // 실패한 승인은 아무것도 바꾸지 않는다
  expect(valueOf(await rig.review.get(itemId)).item.state).toBe("pending");

  // 설명을 고쳐 다시 올리면 승인되고, 카드가 그 설명을 싣는다
  writeFiles(join(rig.pluginsDir, "no-text"), {
    ".fresnel-plugin/plugin.json": manifestOf("no-text", "Has a purpose.", "Says what it does."),
  });
  const fixed = firstOf(valueOf(await rig.review.scan()).queued);
  const approved = valueOf(await rig.review.decide(fixed, APPROVE));
  expect(approved.item.state).toBe("approved");
  expect(approved.item.card.description).toBe("Says what it does.");
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

async function removePreviewStateOf(keys: number): Promise<unknown> {
  const root = tempRoot("plugin-review-");
  roots.push(root);
  const rig = openRig(root, undefined, undefined, undefined, { keys });
  await approvedKit(rig);
  valueOf(await rig.review.requestRemove("kit"));
  const pending = valueOf(await rig.review.list({ state: "pending" })).items;
  return pending[0]?.removal?.removes;
}

test("a remove preview says the stored data goes too only when the plugin store holds keys", async () => {
  expect(await removePreviewStateOf(3)).toEqual({ state: true, records: null });
  expect(await removePreviewStateOf(0)).toEqual({ state: false, records: null });
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

test("a remove request that a hard dependent still needs is refused with the dependent, and makes no item", async () => {
  // AGE-33: `app`이 `kit`에 hard로 기댄다. 제거 요청은 항목을 만들지 않고 거절 값을 준다
  const app: PluginFact = {
    name: "app",
    version: "1.0.0",
    replaces: [],
    drives: false,
    requiredKeys: [],
    manifest: {
      schemaVersion: 2,
      name: "app",
      version: "1.0.0",
      plugins: [{ layer: "plugin", hooks: [], dependsOn: [{ plugin: "kit", kind: "hard" }] }],
    },
    declared: { code: false, root: "", tools: [], instructions: [], skills: [] },
  };
  const rig = rigWithFacts(() => [app]);
  await approvedKit(rig);
  expect(errorOf(await rig.review.requestRemove("kit"))).toEqual({
    kind: "dependency",
    reason: "required_by",
    plugin: "kit",
    items: [
      {
        from: "app",
        target: "kit",
        kind: "hard",
        range: null,
        problem: "depended_on",
        found: null,
      },
    ],
  });
  expect(valueOf(await rig.review.list({ state: "pending" })).items).toEqual([]);
  // 검토본은 그대로 돈다
  expect(valueOf(await rig.store.current("kit"))).not.toBeNull();
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

test("a plugin approved from a draft or an outside folder is not removed when no user folder holds it", async () => {
  const rig = rigOf();
  const folder = join(rig.root, "work", "outside-kit");
  writeFiles(folder, { ".fresnel-plugin/plugin.json": manifestOf("outside-kit", "Runs the tool") });
  const draftId = valueOf(await rig.review.draftCreate(folder, undefined)).draftId;
  const itemId = valueOf(await rig.review.submitDraft(draftId)).itemId;
  expect(valueOf(await rig.review.decide(itemId, APPROVE)).item.state).toBe("approved");
  expect(valueOf(await rig.store.current("outside-kit"))).not.toBeNull();

  // 사용자 플러그인 폴더에는 없지만 초안에서 온 판이라 제거 항목이 생기지 않는다
  expect(valueOf(await rig.review.scan()).queued).toEqual([]);
  expect(valueOf(await rig.review.list({ state: "pending" })).items).toEqual([]);
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
    ".fresnel-plugin/plugin.json": manifestOf("kit", "Keeps the kit", "Keeps the kit working."),
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

/** 승인된 `kit`을 `edit`로 고친 초안을 제출해 대기 중인 갱신 항목을 만든다(출처 `assistant`라 승인할 수 있다) */
async function pendingUpdate(
  rig: Rig,
  edit: (folder: string) => void,
): Promise<{ readonly item: ReviewItem; readonly approved: ReviewItem }> {
  const approved = await approvedKit(rig);
  const folder = join(rig.pluginsDir, "kit");
  edit(folder);
  const draftId = valueOf(await rig.review.draftCreate(folder, undefined)).draftId;
  const itemId = valueOf(await rig.review.submitDraft(draftId)).itemId;
  return { item: valueOf(await rig.review.get(itemId)).item, approved };
}

test("an update item lists the base version's files, and file reads the base side and the new side by value", async () => {
  const rig = rigOf();
  const { item, approved } = await pendingUpdate(rig, (folder) => {
    writeFiles(folder, { "instructions.md": "Use kit, carefully.", "notes.md": "New file." });
  });
  expect(item.kind).toBe("update");
  expect(item.baseHash).toBe(approved.candidateHash);
  expect(item.baseFiles?.map((file) => file.path).toSorted()).toEqual([
    ".fresnel-plugin/plugin.json",
    "instructions.md",
  ]);
  expect(item.files.map((file) => file.path).toSorted()).toEqual([
    ".fresnel-plugin/plugin.json",
    "instructions.md",
    "notes.md",
  ]);
  expect(valueOf(await rig.review.file(item.itemId, "instructions.md", "base"))).toEqual({
    path: "instructions.md",
    text: "Use kit.",
    truncated: false,
  });
  expect(valueOf(await rig.review.file(item.itemId, "instructions.md"))).toEqual({
    path: "instructions.md",
    text: "Use kit, carefully.",
    truncated: false,
  });
  expect(valueOf(await rig.review.file(item.itemId, "instructions.md", "candidate")).text).toBe(
    "Use kit, carefully.",
  );
  // 새 파일은 지난 판에 없고, 지난 판에만 있는 파일은 새 판에 없다
  expect(errorOf(await rig.review.file(item.itemId, "notes.md", "base")).kind).toBe("path_invalid");
  expect(valueOf(await rig.review.file(item.itemId, "notes.md")).text).toBe("New file.");
});

test("a file only the old version had is readable on the base side and is path_invalid on the new side", async () => {
  const rig = rigOf();
  const { item } = await pendingUpdate(rig, (folder) => {
    writeFiles(folder, { "extra.md": "Extra." });
  });
  const removedAfter = await pendingUpdateFrom(rig, item);
  expect(removedAfter.baseFiles?.map((file) => file.path)).toContain("extra.md");
  expect(valueOf(await rig.review.file(removedAfter.itemId, "extra.md", "base")).text).toBe(
    "Extra.",
  );
  expect(errorOf(await rig.review.file(removedAfter.itemId, "extra.md")).kind).toBe("path_invalid");
});

/** 대기 항목을 승인한 뒤 `extra.md`를 지운 새 초안을 제출해 갱신 항목을 만든다 */
async function pendingUpdateFrom(rig: Rig, first: ReviewItem): Promise<ReviewItem> {
  valueOf(await rig.review.decide(first.itemId, APPROVE));
  const folder = join(rig.pluginsDir, "kit");
  rmSync(join(folder, "extra.md"), { force: true });
  const draftId = valueOf(await rig.review.draftCreate(folder, undefined)).draftId;
  const itemId = valueOf(await rig.review.submitDraft(draftId)).itemId;
  return valueOf(await rig.review.get(itemId)).item;
}

test("a new plugin item has no base files and refuses the base side", async () => {
  const rig = rigOf();
  writeFiles(join(rig.pluginsDir, "kit"), {
    ".fresnel-plugin/plugin.json": manifestOf("kit", "Keeps the kit", "Keeps the kit working."),
    "instructions.md": "Use kit.",
  });
  const item = valueOf(await rig.review.get(firstOf(valueOf(await rig.review.scan()).queued))).item;
  expect(item.baseHash).toBeNull();
  expect(item.baseFiles).toBeUndefined();
  expect(errorOf(await rig.review.file(item.itemId, "instructions.md", "base")).kind).toBe(
    "path_invalid",
  );
});

test("after approval the new side is read from the approved copy and the base side from the old copy", async () => {
  const rig = rigOf();
  const { item } = await pendingUpdate(rig, (folder) => {
    writeFiles(folder, { "instructions.md": "Use kit, carefully." });
  });
  const decided = valueOf(await rig.review.decide(item.itemId, APPROVE)).item;
  expect(decided.state).toBe("approved");
  expect(valueOf(await rig.review.file(item.itemId, "instructions.md")).text).toBe(
    "Use kit, carefully.",
  );
  expect(valueOf(await rig.review.file(item.itemId, "instructions.md", "base")).text).toBe(
    "Use kit.",
  );
});

test("a discarded item's new side and a pruned base are answered as missing, not as an error", async () => {
  const rig = rigOf();
  const { item } = await pendingUpdate(rig, (folder) => {
    writeFiles(folder, { "instructions.md": "Use kit, carefully." });
  });
  valueOf(await rig.review.decide(item.itemId, { kind: "discard" }));
  expect(valueOf(await rig.review.file(item.itemId, "instructions.md"))).toEqual({
    path: "instructions.md",
    text: null,
    truncated: false,
    missing: true,
  });
  // 지난 판이 보관 한도를 넘어 지워지면 base 쪽은 missing이다
  const folder = join(rig.pluginsDir, "kit");
  const draftId = valueOf(await rig.review.draftCreate(folder, undefined)).draftId;
  const pending = valueOf(
    await rig.review.get(valueOf(await rig.review.submitDraft(draftId)).itemId),
  ).item;
  expect(pending.baseHash).not.toBeNull();
  await inOrder(6, async (position) => {
    writeFiles(folder, { "instructions.md": `Use kit, version ${position}.` });
    const id = valueOf(await rig.review.draftCreate(folder, undefined)).draftId;
    valueOf(await rig.review.decide(valueOf(await rig.review.submitDraft(id)).itemId, APPROVE));
  });
  expect(valueOf(await rig.review.file(pending.itemId, "instructions.md", "base"))).toEqual({
    path: "instructions.md",
    text: null,
    truncated: false,
    missing: true,
  });
});

test("file applies the same limit to both sides: binary is null text, a large file is cut at 256 KiB and marked truncated", async () => {
  const rig = rigOf();
  const big = "x".repeat(262144 + 10);
  const { item } = await pendingUpdate(rig, () => {});
  valueOf(await rig.review.decide(item.itemId, APPROVE));
  const folder = join(rig.pluginsDir, "kit");
  writeFiles(folder, { "big.txt": big });
  writeFileSync(join(folder, "bin.dat"), Uint8Array.from([1, 0, 2, 3]));
  const first = valueOf(
    await rig.review.submitDraft(valueOf(await rig.review.draftCreate(folder, undefined)).draftId),
  ).itemId;
  valueOf(await rig.review.decide(first, APPROVE));
  writeFiles(folder, { "big.txt": `${big}y` });
  writeFileSync(join(folder, "bin.dat"), Uint8Array.from([9, 0, 9]));
  const next = valueOf(
    await rig.review.get(
      valueOf(
        await rig.review.submitDraft(
          valueOf(await rig.review.draftCreate(folder, undefined)).draftId,
        ),
      ).itemId,
    ),
  ).item;
  const base = valueOf(await rig.review.file(next.itemId, "big.txt", "base"));
  expect(base.truncated).toBe(true);
  expect(base.text?.length).toBe(262144);
  const fresh = valueOf(await rig.review.file(next.itemId, "big.txt"));
  expect(fresh.truncated).toBe(true);
  expect(valueOf(await rig.review.file(next.itemId, "bin.dat", "base"))).toEqual({
    path: "bin.dat",
    text: null,
    truncated: false,
  });
  expect(valueOf(await rig.review.file(next.itemId, "bin.dat")).text).toBeNull();
});

test("an item card carries the manifest version, and path escapes stay refused on the base side", async () => {
  const rig = rigOf();
  const { item } = await pendingUpdate(rig, (folder) => {
    writeFiles(folder, { "instructions.md": "Use kit, carefully." });
  });
  expect(item.card.version).toBe("1.0.0");
  expect(errorOf(await rig.review.file(item.itemId, "../kit/instructions.md", "base")).kind).toBe(
    "path_invalid",
  );
  expect(errorOf(await rig.review.file(item.itemId, "/etc/hosts", "base")).kind).toBe(
    "path_invalid",
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
    ".fresnel-plugin/plugin.json": manifestOf("kit", "Keeps the kit", "Keeps the kit working."),
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
      return Promise.resolve(ok({ profileIds: ["p1"], missingPlugins: [] }));
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

// AGE-72: 제출이 준 기본 프로필과 합치기 계획은 대기 항목에 실리고, 승인이 그것을 프로필 편집으로 넘긴다.

const MERGE_PLAN: ProfilePlan = { swapOut: ["helm", "kit"], placeAfter: null, driveFrom: null };

/** 초안을 만들어 검토함으로 보낸다. 항목 id를 돌려준다 */
async function submitMerged(rig: Rig, name: string, extra?: DraftSubmitExtra): Promise<string> {
  const folder = join(rig.root, "src", name);
  writeFiles(folder, { ".fresnel-plugin/plugin.json": manifestOf(name, "Runs both") });
  const draftId = valueOf(await rig.review.draftCreate(folder, "thr_maker")).draftId;
  return valueOf(await rig.review.submitDraft(draftId, extra)).itemId;
}

/** 편집 요청에서 값만 본다. 사실 객체는 비교하지 않는다 */
function summaryOf(request: PluginEditRequest): unknown {
  return request.kind === "add"
    ? { kind: "add", profileIds: request.profileIds, plan: request.plan ?? null }
    : { kind: request.kind };
}

test("submitDraft stores the origin profile and the merge plan on the pending item; a later submit with values updates that item, and one without keeps them", async () => {
  const rig = rigOf();
  const folder = join(rig.root, "src", "merged-kit");
  writeFiles(folder, { ".fresnel-plugin/plugin.json": manifestOf("merged-kit", "Runs both") });
  const draftId = valueOf(await rig.review.draftCreate(folder, "thr_maker")).draftId;
  const itemId = valueOf(await rig.review.submitDraft(draftId)).itemId;
  expect(valueOf(await rig.review.get(itemId)).item.profilePlan).toBeUndefined();
  expect(
    valueOf(
      await rig.review.submitDraft(draftId, { originProfileId: "p1", profilePlan: MERGE_PLAN }),
    ).itemId,
  ).toBe(itemId);
  const stored = valueOf(await rig.review.get(itemId)).item;
  expect([stored.originProfileId, stored.profilePlan]).toEqual(["p1", MERGE_PLAN]);
  expect(valueOf(await rig.review.submitDraft(draftId, {})).itemId).toBe(itemId);
  expect(valueOf(await rig.review.get(itemId)).item).toEqual(stored);
});

test("an approval hands the item's merge plan to the profile edit; sending back or discarding edits no profile", async () => {
  const checked: PluginEditRequest[] = [];
  const applied: PluginEditRequest[] = [];
  const rig = hookedRigOf(
    approvalHooksOf({
      profiles: {
        checkPluginEdit: (request) => {
          checked.push(request);
          return Promise.resolve(ok(undefined));
        },
        applyPluginEdit: (request) => {
          applied.push(request);
          return Promise.resolve(ok({ profileIds: ["p1"], missingPlugins: [] }));
        },
      },
      loader: () => undefined,
      refreshPluginSet: () => Promise.resolve(),
      facts: () => [],
      pluginDataStore: { clear: () => Promise.resolve(ok(undefined)) },
      log: SILENT,
    }),
  );
  const approvedItem = await submitMerged(rig, "merged-a", {
    originProfileId: "p1",
    profilePlan: MERGE_PLAN,
  });
  const outcome = valueOf(
    await rig.review.decide(approvedItem, {
      kind: "approve",
      profileIds: [],
      libraryOnly: false,
      purpose: "Runs both",
    }),
  );
  expect(outcome.appliedTo).toEqual(["p1"]);
  expect(applied.map(summaryOf)).toEqual([{ kind: "add", profileIds: ["p1"], plan: MERGE_PLAN }]);

  const sentBack = await submitMerged(rig, "merged-b", {
    originProfileId: "p1",
    profilePlan: MERGE_PLAN,
  });
  expect(
    (await rig.review.decide(sentBack, { kind: "sendBack", reason: "Narrow the merge." })).ok,
  ).toBe(true);
  const discarded = await submitMerged(rig, "merged-c", {
    originProfileId: "p1",
    profilePlan: MERGE_PLAN,
  });
  expect((await rig.review.decide(discarded, { kind: "discard" })).ok).toBe(true);
  expect(checked.map(summaryOf)).toEqual([{ kind: "add", profileIds: ["p1"], plan: MERGE_PLAN }]);
  expect(applied.map(summaryOf)).toEqual([{ kind: "add", profileIds: ["p1"], plan: MERGE_PLAN }]);
});

// AGE-35: 초안 한 버전의 파일을 읽기만 하는 길(`draftFiles`, `draftFile`). 초안은 `drafts/<id>/tree`에 남아 있어 검토 항목이 닫혀도 읽힌다.
const sha256Of = (text: string): string =>
  new Bun.CryptoHasher("sha256").update(text).digest("hex");

test("a draft version lists its files with sizes and hashes and reads each one, and two versions differ by their hashes", async () => {
  const rig = rigOf();
  const folder = join(rig.root, "src", "cmp-kit");
  writeFiles(folder, {
    ".fresnel-plugin/plugin.json": manifestOf("cmp-kit", "Compare"),
    "keep.md": "same",
    "edit.md": "before",
    "gone.md": "removed later",
  });
  const first = valueOf(await rig.review.draftCreate(folder, undefined)).draftId;
  rmSync(join(folder, "gone.md"));
  writeFiles(folder, { "edit.md": "after", "new.md": "added" });
  const second = valueOf(await rig.review.draftCreate(folder, undefined)).draftId;

  const one = valueOf(await rig.review.draftFiles(first));
  const two = valueOf(await rig.review.draftFiles(second));
  expect(one.name).toBe("cmp-kit");
  expect(one.files.find((file) => file.path === "edit.md")).toEqual({
    path: "edit.md",
    bytes: 6,
    sha256: sha256Of("before"),
  });
  expect(two.files.map((file) => file.path)).toEqual([
    ".fresnel-plugin/plugin.json",
    "edit.md",
    "keep.md",
    "new.md",
  ]);
  expect(valueOf(await rig.review.draftFile(first, "edit.md"))).toEqual({
    path: "edit.md",
    text: "before",
    truncated: false,
  });
  expect(valueOf(await rig.review.draftFile(second, "edit.md")).text).toBe("after");
  expect(valueOf(await rig.review.draftFile(first, "gone.md")).text).toBe("removed later");
  const hashOf = (files: typeof one.files, path: string): string | undefined =>
    files.find((file) => file.path === path)?.sha256;
  expect(hashOf(one.files, "keep.md")).toBe(hashOf(two.files, "keep.md"));
  expect(hashOf(one.files, "edit.md")).not.toBe(hashOf(two.files, "edit.md"));
  expect(hashOf(two.files, "gone.md")).toBeUndefined();
});

test("submitting a later draft closes the earlier item and drops its review snapshot, but both draft versions stay readable", async () => {
  // m6T2가 본 "리뷰에 올린 버전의 보관 폴더가 비어 있음"의 재현: 다른 버전을 올리면 앞 항목이 superseded가 되고 그 후보 스냅샷이 지워진다
  const rig = rigOf();
  const folder = join(rig.root, "src", "snap-kit");
  writeFiles(folder, {
    ".fresnel-plugin/plugin.json": manifestOf("snap-kit", "Snap"),
    "notes.md": "v-one",
  });
  const first = valueOf(await rig.review.draftCreate(folder, undefined)).draftId;
  writeFiles(folder, { "notes.md": "v-two" });
  const second = valueOf(await rig.review.draftCreate(folder, undefined)).draftId;

  const firstItem = valueOf(await rig.review.submitDraft(first)).itemId;
  expect(valueOf(await rig.review.file(firstItem, "notes.md")).text).toBe("v-one");
  const secondItem = valueOf(await rig.review.submitDraft(second)).itemId;
  expect(valueOf(await rig.review.get(firstItem)).item.state).toBe("superseded");
  expect(valueOf(await rig.review.file(firstItem, "notes.md"))).toEqual({
    path: "notes.md",
    text: null,
    truncated: false,
    missing: true,
  });
  expect(valueOf(await rig.review.file(secondItem, "notes.md")).text).toBe("v-two");
  // 초안 쪽은 그대로다
  expect(valueOf(await rig.review.draftFile(first, "notes.md")).text).toBe("v-one");
  expect(valueOf(await rig.review.draftFile(second, "notes.md")).text).toBe("v-two");
});

test("reading a draft refuses unknown drafts, paths outside the list, escapes, absolute paths and links", async () => {
  const rig = rigOf();
  const folder = join(rig.root, "src", "neg-kit");
  writeFiles(folder, {
    ".fresnel-plugin/plugin.json": manifestOf("neg-kit", "Negative"),
    "notes.md": "inside",
  });
  const other = join(rig.root, "src", "other-kit");
  writeFiles(other, {
    ".fresnel-plugin/plugin.json": manifestOf("other-kit", "Other"),
    "secret.md": "other plugin",
  });
  const draftId = valueOf(await rig.review.draftCreate(folder, undefined)).draftId;
  const otherId = valueOf(await rig.review.draftCreate(other, undefined)).draftId;

  expect(errorOf(await rig.review.draftFiles("drf_not_there")).kind).toBe("draft_not_found");
  expect(errorOf(await rig.review.draftFiles("../../etc")).kind).toBe("draft_not_found");
  expect(errorOf(await rig.review.draftFile("drf_not_there", "notes.md")).kind).toBe(
    "draft_not_found",
  );
  // 다른 플러그인의 파일은 이 초안의 목록에 없다
  expect(errorOf(await rig.review.draftFile(draftId, "secret.md")).kind).toBe("path_invalid");
  expect(valueOf(await rig.review.draftFile(otherId, "secret.md")).text).toBe("other plugin");
  const refused = await Promise.all(
    ["../notes.md", "../../x", "/etc/passwd", "a\\b", "notes.md/..", ""].map((path) =>
      rig.review.draftFile(draftId, path),
    ),
  );
  expect(refused.map((result) => errorOf(result).kind)).toEqual([
    "path_invalid",
    "path_invalid",
    "path_invalid",
    "path_invalid",
    "path_invalid",
    "path_invalid",
  ]);
  // 저장소 안의 스냅샷에 링크가 생겼으면 목록을 주지 않는다(링크를 따라 읽지 않는다)
  const tree = join(rig.store.draftDir(draftId), "tree");
  symlinkSync("/etc/hosts", join(tree, "link.md"));
  expect(errorOf(await rig.review.draftFiles(draftId)).kind).toBe("symlink_refused");
  expect(errorOf(await rig.review.draftFile(draftId, "link.md")).kind).toBe("symlink_refused");
});

test("a draft file is cut at 256 KiB, a binary file has no text, and a draft changed on disk is draft_changed", async () => {
  const rig = rigOf();
  const folder = join(rig.root, "src", "big-kit");
  writeFiles(folder, {
    ".fresnel-plugin/plugin.json": manifestOf("big-kit", "Big"),
    "big.md": "a".repeat(262144 + 10),
  });
  writeFileSync(join(folder, "data.bin"), new Uint8Array([1, 0, 2, 3]));
  const draftId = valueOf(await rig.review.draftCreate(folder, undefined)).draftId;
  const big = valueOf(await rig.review.draftFile(draftId, "big.md"));
  expect(big.truncated).toBe(true);
  expect(big.text?.length).toBe(262144);
  expect(valueOf(await rig.review.draftFile(draftId, "data.bin"))).toEqual({
    path: "data.bin",
    text: null,
    truncated: false,
  });
  writeFileSync(join(rig.store.draftDir(draftId), "tree", "big.md"), "tampered");
  const changed = errorOf(await rig.review.draftFiles(draftId));
  expect(changed).toEqual({ kind: "store", code: "draft_changed" });
});

// AGE-33 enDep: 목록과 항목 응답의 카드 의존 칸은 설치된 사실로 다시 채운다. 저장된 항목은 매니페스트 값 그대로다.
test("get and list answer the card's dependency cell from the installed facts, and the stored item keeps the manifest values", async () => {
  const root = tempRoot("plugin-review-deps-");
  roots.push(root);
  // `kit`은 2.0.0이라 `^1.0.0`을 어긴다. `tool`은 `app`에 hard로 기댄다
  const kit: PluginFact = {
    name: "kit",
    version: "2.0.0",
    replaces: [],
    drives: false,
    requiredKeys: [],
    manifest: { schemaVersion: 2, name: "kit", version: "2.0.0" },
    declared: { code: false, root: "", tools: [], instructions: [], skills: [] },
  };
  const tool: PluginFact = {
    name: "tool",
    version: "1.0.0",
    replaces: [],
    drives: false,
    requiredKeys: [],
    manifest: {
      schemaVersion: 2,
      name: "tool",
      version: "1.0.0",
      plugins: [{ layer: "plugin", hooks: [], dependsOn: [{ plugin: "app", kind: "hard" }] }],
    },
    declared: { code: false, root: "", tools: [], instructions: [], skills: [] },
  };
  const rig = openRig(root, undefined, undefined, () => [kit, tool]);
  writeFiles(join(rig.pluginsDir, "app"), {
    ".fresnel-plugin/plugin.json": JSON.stringify({
      schemaVersion: 2,
      name: "app",
      version: "1.0.0",
      purpose: "Uses kit",
      description: "Uses the kit in a profile.",
      plugins: [
        {
          layer: "plugin",
          hooks: [],
          dependsOn: [{ plugin: "kit", kind: "hard", range: "^1.0.0" }, { plugin: "ghost" }],
        },
      ],
    }),
  });
  const itemId = firstOf(valueOf(await rig.review.scan()).queued);

  const expected: CardDependencies = {
    dependsOn: [
      { from: "app", target: "kit", kind: "hard", range: "^1.0.0", problem: "range_unmet" },
      { from: "app", target: "ghost", kind: "soft", range: null, problem: "target_missing" },
    ],
    dependents: [{ from: "tool", target: "app", kind: "hard", range: null, problem: null }],
  };
  expect(valueOf(await rig.review.get(itemId)).item.card.dependencies).toEqual(expected);
  expect(
    valueOf(await rig.review.list({ state: "pending" })).items.map(
      (item) => item.card.dependencies,
    ),
  ).toEqual([expected]);

  // 설치 사실을 주지 않은 서비스는 저장된 값(매니페스트만 본 problem null, dependents 빈 목록)을 그대로 준다
  const stored = valueOf(await openRig(root).review.get(itemId)).item;
  expect(stored.card.dependencies).toEqual({
    dependsOn: [
      { from: "app", target: "kit", kind: "hard", range: "^1.0.0", problem: null },
      { from: "app", target: "ghost", kind: "soft", range: null, problem: null },
    ],
    dependents: [],
  });
});
