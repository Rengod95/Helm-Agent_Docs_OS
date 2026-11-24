import { afterEach, expect, test } from "bun:test";
import { chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ok, type Logger, type Result } from "@fresnel/contracts";
import type { ReviewItem } from "@fresnel/contracts/wire";
import { createLocalIdFactory, systemRandom } from "@fresnel/platform-os";
import {
  createPluginReview,
  createPluginService,
  createPluginStore,
  diffCards,
  hashPluginTree,
  type DiscoverProjectRoot,
  type PluginReview,
  type PluginStore,
} from "../../../src/assembly/plugins/index.ts";
import {
  createAppEditLedger,
  type AppEditLedger,
} from "../../../src/assembly/plugins/app-edits.ts";
import { passThroughFileLock, removeTree, tempRoot, writeFiles } from "./support.ts";

// M5c 되돌리기(AGE-76): 플러그인 이력 읽기와 리뷰를 거치는 되돌리기를 임시 폴더에서 돌린다.
// 이력은 결정 기록에서 읽고, 되돌리기는 지난 판을 후보로 올려 일반 승인 길로 보낸다. 승인하면 원본 폴더도 그 판으로 맞춘다.

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
  common: { plugins: [], settings: [], updatedAt: "2026-11-24T00:00:00.000Z", rev: 1 },
  rev: 1,
};

/** 시험의 시각. 호출마다 1초씩 나아가 기록의 시각 순서가 정해진다 */
let tick = 0;
function isoNow(): string {
  tick += 1;
  return new Date(Date.UTC(2026, 10, 24, 1, 0, 0) + tick * 1000).toISOString();
}

interface Rig {
  readonly pluginsDir: string;
  readonly store: PluginStore;
  readonly review: PluginReview;
  /** 앱의 편집 장부. 앱이 쓴 폴더는 `markDir`로 적어야 훑기가 손 수정이 아닌 판으로 본다 */
  readonly appEdits: AppEditLedger;
}

interface RigOptions {
  readonly bundleDir?: string;
  readonly projectRoots?: () => Promise<readonly DiscoverProjectRoot[]>;
}

/** 같은 루트를 여는 검토 서비스 묶음. 검토 시험(`review.test.ts`)의 리그를 이 시험에 필요한 만큼 줄였다 */
function openRig(root: string, options: RigOptions = {}): Rig {
  const store = createPluginStore({
    root: join(root, "plugin-store"),
    fileLock: passThroughFileLock,
  });
  const service = createPluginService({
    configDir: join(root, "config"),
    projectRoots: options.projectRoots ?? (() => Promise.resolve([])),
    managedDir: null,
    bundleDir: options.bundleDir ?? null,
    records: () => [],
    profiles: { list: () => Promise.resolve(ok(EMPTY_LIST)) },
    store,
    log: { info() {} },
  });
  const appEdits = createAppEditLedger();
  const review = createPluginReview({
    store,
    plugins: service,
    profiles: { list: () => Promise.resolve(ok(EMPTY_LIST)) },
    userDir: join(root, "config", "plugins"),
    ids: createLocalIdFactory({ now: () => 1_800_000_000_000 }, systemRandom()),
    now: isoNow,
    log: SILENT,
    appEdits,
  });
  return { pluginsDir: join(root, "config", "plugins"), store, review, appEdits };
}

function rigOf(): Rig {
  const root = tempRoot("plugin-history-");
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

/** 항목의 후보 해시. 승인 항목은 늘 있다 */
function hashOf(item: ReviewItem): string {
  if (item.candidateHash === null) throw new Error("expected a candidate hash");
  return item.candidateHash;
}

const APPROVE = { kind: "approve", profileIds: [], libraryOnly: true } as const;

interface Version {
  readonly version: string;
  readonly description: string;
  readonly instructions: string;
}

const FIRST: Version = {
  version: "1.0.0",
  description: "Keeps the kit working.",
  instructions: "Use kit v1.",
};
const SECOND: Version = {
  version: "1.1.0",
  description: "Keeps the kit working better.",
  instructions: "Use kit v2.",
};

/** 플러그인 폴더 하나의 내용. 목적은 이름으로 정하고 설명은 판마다 다르다 */
function writeVersion(dir: string, name: string, version: Version): void {
  writeFiles(dir, {
    ".fresnel-plugin/plugin.json": JSON.stringify({
      schemaVersion: 2,
      name,
      version: version.version,
      purpose: `Keeps ${name} working`,
      description: version.description,
    }),
    "instructions.md": version.instructions,
  });
}

/** 빌더가 사용자 폴더의 `kit`을 이 판으로 쓰고(앱 편집 장부에 적는다), 훑어서 나온 새 항목을 승인한다 */
async function publish(rig: Rig, version: Version): Promise<ReviewItem> {
  const dir = join(rig.pluginsDir, "kit");
  writeVersion(dir, "kit", version);
  rig.appEdits.markDir(dir);
  const queued = valueOf(await rig.review.scan()).queued;
  return valueOf(await rig.review.decide(firstOf(queued), APPROVE)).item;
}

// 기록의 승인 줄 두 개(new, update)가 이력에 최신이 앞이고, 지금 판만 current이고, 둘 다 보관본이 남아 있다
test("the history of an approved plugin lists its create and edit lines, newest first, and marks only the current one", async () => {
  const rig = rigOf();
  const created = await publish(rig, FIRST);
  const edited = await publish(rig, SECOND);
  expect(valueOf(await rig.review.history("kit"))).toEqual({
    blocked: null,
    entries: [
      {
        at: expect.any(String),
        event: "edit",
        version: "1.1.0",
        contentHash: hashOf(edited),
        baseHash: hashOf(created),
        itemId: edited.itemId,
        actor: "user",
        summary: SECOND.description,
        current: true,
        kept: true,
      },
      {
        at: expect.any(String),
        event: "create",
        version: "1.0.0",
        contentHash: hashOf(created),
        baseHash: null,
        itemId: created.itemId,
        actor: "user",
        summary: FIRST.description,
        current: false,
        kept: true,
      },
    ],
  });
});

// 되돌리기 요청은 바로 바꾸지 않는다. 대기 항목은 지난 판을 후보로 든 update이고, 같은 요청은 같은 항목을 돌려준다
test("requesting a rollback opens an update item that carries the old version, and leaves the current version as it is", async () => {
  const rig = rigOf();
  const created = await publish(rig, FIRST);
  const edited = await publish(rig, SECOND);

  const { itemId } = valueOf(await rig.review.requestRollback("kit", hashOf(created)));
  const pending = valueOf(await rig.store.readItem(itemId));
  expect(pending).toMatchObject({
    kind: "update",
    state: "pending",
    name: "kit",
    candidateHash: hashOf(created),
    baseHash: hashOf(edited),
    rollback: { fromVersion: "1.1.0", toVersion: "1.0.0", savedState: false },
  });
  expect(pending.files).toEqual(created.files);
  expect(pending.diff).toEqual(
    diffCards(valueOf(await rig.store.current("kit"))?.meta.card ?? null, pending.card),
  );
  // 지금 판은 그대로다
  expect(valueOf(await rig.store.current("kit"))?.contentHash).toBe(hashOf(edited));
  expect(valueOf(await rig.review.requestRollback("kit", hashOf(created)))).toEqual({ itemId });
  expect(valueOf(await rig.review.history("kit")).entries.map((entry) => entry.event)).toEqual([
    "edit",
    "create",
  ]);
});

// 되돌리기 승인: 지난 판이 current가 되고, 기록에 rollback 한 줄이 남고, 사용자 원본 폴더도 그 판의 내용이 된다
test("approving a rollback makes the old version current, logs a rollback line, and mirrors the source folder to it", async () => {
  const rig = rigOf();
  const created = await publish(rig, FIRST);
  const edited = await publish(rig, SECOND);
  const { itemId } = valueOf(await rig.review.requestRollback("kit", hashOf(created)));

  const outcome = valueOf(await rig.review.decide(itemId, APPROVE));
  expect(outcome.item.state).toBe("approved");
  expect(valueOf(await rig.store.current("kit"))?.contentHash).toBe(hashOf(created));
  expect(valueOf(await rig.store.readLog()).at(-1)).toMatchObject({
    decision: "rollback",
    itemId,
    name: "kit",
    kind: "update",
    candidateHash: hashOf(created),
    baseHash: hashOf(edited),
  });

  const history = valueOf(await rig.review.history("kit"));
  expect(history.entries.map((entry) => [entry.event, entry.current, entry.kept])).toEqual([
    ["rollback", true, true],
    ["edit", false, true],
    ["create", false, true],
  ]);
  expect(history.entries[0]).toMatchObject({
    itemId,
    version: "1.0.0",
    contentHash: hashOf(created),
  });
  // 사용자 원본 폴더는 첫 판과 같은 내용이다
  expect(valueOf(hashPluginTree(join(rig.pluginsDir, "kit"))).contentHash).toBe(hashOf(created));
  expect(readFileSync(join(rig.pluginsDir, "kit", "instructions.md"), "utf8")).toBe(
    FIRST.instructions,
  );
});

// 지난 판의 매니페스트에 목적이 없어도(승인 때 결정이 채운 것) 그 판으로 되돌리는 승인은 목적 필수 검사에 걸리지 않는다
test("approving a rollback to a version whose manifest has no purpose is not refused as purpose_required", async () => {
  const rig = rigOf();
  const dir = join(rig.pluginsDir, "kit");
  writeFiles(dir, {
    ".fresnel-plugin/plugin.json": JSON.stringify({
      schemaVersion: 2,
      name: "kit",
      version: "1.0.0",
      description: FIRST.description,
    }),
    "instructions.md": FIRST.instructions,
  });
  rig.appEdits.markDir(dir);
  const queued = valueOf(await rig.review.scan()).queued;
  // 새 제출은 목적이 필요하다: 결정이 목적을 채워 승인한다
  const created = valueOf(
    await rig.review.decide(firstOf(queued), { ...APPROVE, purpose: "Keeps kit working" }),
  ).item;
  await publish(rig, SECOND);
  const { itemId } = valueOf(await rig.review.requestRollback("kit", hashOf(created)));
  const outcome = valueOf(await rig.review.decide(itemId, APPROVE));
  expect(outcome.item.state).toBe("approved");
  expect(valueOf(await rig.store.current("kit"))?.contentHash).toBe(hashOf(created));
});

// 승인이 원본 맞추기보다 먼저 끝난다: 원본 폴더가 없어도 되돌리기 승인은 되돌리지 않는다(로그에만 남는다)
test("approving a rollback still lands when the source folder is gone", async () => {
  const rig = rigOf();
  const created = await publish(rig, FIRST);
  await publish(rig, SECOND);
  rmSync(join(rig.pluginsDir, "kit"), { recursive: true, force: true });
  const { itemId } = valueOf(await rig.review.requestRollback("kit", hashOf(created)));

  valueOf(await rig.review.decide(itemId, APPROVE));
  expect(valueOf(await rig.store.current("kit"))?.contentHash).toBe(hashOf(created));
});

// 지금 판은 `current`, 이력에 없는 해시는 `unknown_version`으로 거절한다
test("a rollback request is refused as current for the current version and as unknown_version for a hash never approved", async () => {
  const rig = rigOf();
  await publish(rig, FIRST);
  const edited = await publish(rig, SECOND);
  expect(errorOf(await rig.review.requestRollback("kit", hashOf(edited)))).toEqual({
    kind: "rollback_unavailable",
    name: "kit",
    reason: "current",
  });
  expect(errorOf(await rig.review.requestRollback("kit", `sha256:${"0".repeat(64)}`))).toEqual({
    kind: "rollback_unavailable",
    name: "kit",
    reason: "unknown_version",
  });
});

// 기록에는 있는데 보관본이 지워진 판은 `not_kept`다. 이력 줄은 `kept`가 거짓이다
test("a version that was approved but is no longer kept is refused as not_kept, and its history line is not kept", async () => {
  const rig = rigOf();
  const created = await publish(rig, FIRST);
  await publish(rig, SECOND);
  removeTree(dirname(valueOf(await rig.store.treePath("kit", hashOf(created)))));

  expect(errorOf(await rig.review.requestRollback("kit", hashOf(created)))).toEqual({
    kind: "rollback_unavailable",
    name: "kit",
    reason: "not_kept",
  });
  const history = valueOf(await rig.review.history("kit"));
  expect(history.entries.map((entry) => [entry.event, entry.kept])).toEqual([
    ["edit", true],
    ["create", false],
  ]);
});

// 보관본의 파일이 해시와 다르면 `integrity`다. 요청은 대기 항목을 만들지 않는다
test("a kept copy whose files no longer match its hash is refused as integrity", async () => {
  const rig = rigOf();
  const created = await publish(rig, FIRST);
  await publish(rig, SECOND);
  const file = join(valueOf(await rig.store.treePath("kit", hashOf(created))), "instructions.md");
  chmodSync(file, 0o644);
  writeFileSync(file, "tampered");

  expect(errorOf(await rig.review.requestRollback("kit", hashOf(created)))).toEqual({
    kind: "rollback_unavailable",
    name: "kit",
    reason: "integrity",
  });
});

// 번들 출처는 되돌리지 않는다. 이력은 빈 목록이고 `blocked`가 번들이다
test("a bundled plugin cannot be rolled back, and its history is blocked as bundled", async () => {
  const root = tempRoot("plugin-history-bundled-");
  roots.push(root);
  writeVersion(join(root, "bundle", "bundled-kit"), "bundled-kit", FIRST);
  const rig = openRig(root, { bundleDir: join(root, "bundle") });
  await rig.review.scan();

  expect(
    errorOf(await rig.review.requestRollback("bundled-kit", `sha256:${"0".repeat(64)}`)),
  ).toEqual({ kind: "rollback_unavailable", name: "bundled-kit", reason: "bundled" });
  expect(valueOf(await rig.review.history("bundled-kit"))).toEqual({
    entries: [],
    blocked: "bundled",
  });
});

// 프로젝트 출처는 되돌리지 않는다. 이력은 그 프로젝트 키의 줄만 보고 `blocked`가 프로젝트다
test("a project plugin cannot be rolled back, and its history is blocked as project", async () => {
  const root = tempRoot("plugin-history-project-");
  roots.push(root);
  const project = join(root, "project");
  writeVersion(join(project, ".fresnel", "plugins", "carried"), "carried", FIRST);
  const rig = openRig(root, {
    projectRoots: () => Promise.resolve([{ root: project, projectId: "prj_alpha" }]),
  });
  const queued = valueOf(await rig.review.scan()).queued;
  const approved = valueOf(await rig.review.decide(firstOf(queued), APPROVE)).item;

  expect(valueOf(await rig.review.history("carried"))).toEqual({
    blocked: "project",
    entries: [
      {
        at: expect.any(String),
        event: "create",
        version: "1.0.0",
        contentHash: hashOf(approved),
        baseHash: null,
        itemId: approved.itemId,
        actor: "user",
        summary: FIRST.description,
        current: true,
        kept: true,
      },
    ],
  });
  expect(errorOf(await rig.review.requestRollback("carried", hashOf(approved)))).toEqual({
    kind: "rollback_unavailable",
    name: "carried",
    reason: "project",
  });
});

test("the history of a plugin that is not installed is unknown_plugin", async () => {
  const rig = rigOf();
  expect(errorOf(await rig.review.history("nope"))).toEqual({
    kind: "unknown_plugin",
    name: "nope",
  });
});
