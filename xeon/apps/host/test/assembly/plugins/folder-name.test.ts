import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { ok, type Logger, type Result } from "@fresnel/contracts";
import { createLocalIdFactory, systemRandom } from "@fresnel/platform-os";
import {
  createPluginReview,
  createPluginService,
  createPluginStore,
  type DiscoverProjectRoot,
  type PluginReview,
  type PluginService,
  type PluginStore,
} from "../../../src/assembly/plugins/index.ts";
import { readPluginFolder } from "../../../src/assembly/plugins/folder-reader.ts";
import { passThroughFileLock, removeTree, tempRoot, writeFiles } from "./support.ts";

// AGE-34 항목 6: 매니페스트가 없는 플러그인 폴더의 이름은 원본 폴더 이름이다. 검토 항목과 검토본 키가 `tree`(후보 스냅샷 폴더)가 되면 안 된다.
// 시험은 값으로 비교한다(항목의 이름, 검토본 키, 검토본 메타 이름).

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

let tick = 0;
function isoNow(): string {
  tick += 1;
  return new Date(Date.UTC(2026, 10, 22, 1, 0, 0) + tick * 1000).toISOString();
}

interface Rig {
  readonly pluginsDir: string;
  readonly store: PluginStore;
  readonly service: PluginService;
  readonly review: PluginReview;
}

function openRig(root: string, projectRoots: readonly DiscoverProjectRoot[]): Rig {
  const store = createPluginStore({
    root: join(root, "plugin-store"),
    fileLock: passThroughFileLock,
  });
  const service = createPluginService({
    configDir: join(root, "config"),
    projectRoots: () => Promise.resolve(projectRoots),
    managedDir: null,
    bundleDir: null,
    records: () => [],
    profiles: { list: () => Promise.resolve(ok(EMPTY_LIST)) },
    store,
    log: { info() {} },
  });
  const review = createPluginReview({
    store,
    plugins: service,
    profiles: { list: () => Promise.resolve(ok(EMPTY_LIST)) },
    userDir: join(root, "config", "plugins"),
    ids: createLocalIdFactory({ now: () => 1_800_000_000_000 }, systemRandom()),
    now: isoNow,
    log: SILENT,
    notifyOrigin: () => Promise.resolve(true),
  });
  return { pluginsDir: join(root, "config", "plugins"), store, service, review };
}

function valueOf<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected a value, got ${JSON.stringify(result.error)}`);
  return result.value;
}

function firstOf<T>(items: readonly T[]): T {
  const [first] = items;
  if (first === undefined) throw new Error("expected one item");
  return first;
}

// 목적 문장이 없으면 승인할 수 없다(R6). 지침만 든 폴더는 카드에 목적이 없어서 승인 결정에 목적을 준다
const APPROVE = {
  kind: "approve",
  profileIds: [],
  libraryOnly: true,
  purpose: "Keeps notes.",
} as const;

// 매니페스트가 없고 지침 파일만 있는 프로젝트 플러그인. 검토 항목의 이름은 폴더 이름이어야 한다
test("a project plugin folder without a manifest is named by its folder, for a new item and for the approved copy", async () => {
  const root = tempRoot("plugin-folder-name-project-");
  roots.push(root);
  const project = join(root, "project");
  // 설명은 스킬 머리말이 채운다(매니페스트가 없어도 카드 설명이 있어 승인할 수 있다)
  writeFiles(join(project, ".fresnel", "plugins", "notes-kit"), {
    "instructions.md": "Project notes rule.",
    "SKILL.md": "---\nname: notes-kit\ndescription: Keeps project notes.\n---\nBody\n",
  });
  const rig = openRig(root, [{ root: project, projectId: "prj_alpha" }]);

  const item = valueOf(await rig.review.get(firstOf(valueOf(await rig.review.scan()).queued))).item;
  expect(item).toMatchObject({ name: "notes-kit", kind: "new", provenance: "project" });

  valueOf(await rig.review.decide(item.itemId, APPROVE));
  const copy = valueOf(await rig.store.current("prj_alpha/notes-kit"));
  expect(copy?.meta.name ?? null).toBe("notes-kit");
  expect(valueOf(await rig.store.current("prj_alpha/tree"))).toBeNull();
});

// 승인된 검토본이 있는 사용자 플러그인(매니페스트 없음)을 고치면 갱신 항목이고, 그 이름도 폴더 이름이다
test("a user plugin folder without a manifest keeps its folder name on the update item after approval", async () => {
  const root = tempRoot("plugin-folder-name-user-");
  roots.push(root);
  const rig = openRig(root, []);
  writeFiles(join(rig.pluginsDir, "plain-folder"), {
    "instructions.md": "First rule.",
    "SKILL.md": "---\nname: plain-folder\ndescription: Keeps plain rules.\n---\nBody\n",
  });

  const first = valueOf(
    await rig.review.get(firstOf(valueOf(await rig.review.scan()).queued)),
  ).item;
  expect(first).toMatchObject({ name: "plain-folder", kind: "new" });
  valueOf(await rig.review.decide(first.itemId, APPROVE));

  writeFiles(join(rig.pluginsDir, "plain-folder"), { "more.md": "Second rule." });
  const update = valueOf(
    await rig.review.get(firstOf(valueOf(await rig.review.scan()).queued)),
  ).item;
  expect(update).toMatchObject({ name: "plain-folder", kind: "update", state: "pending" });
  expect(valueOf(await rig.store.current("plain-folder"))?.meta.name ?? null).toBe("plain-folder");
  expect(valueOf(await rig.store.current("tree"))).toBeNull();
});

// 폴더 읽기 옵션의 `name`: 후보와 검토본 사본처럼 폴더 이름이 `tree`인 곳은 이름을 따로 받는다
test("the name option names a manifest-less folder, and falls back to the folder name without it", () => {
  const root = tempRoot("plugin-folder-name-option-");
  roots.push(root);
  const tree = join(root, "tree");
  writeFiles(tree, { "instructions.md": "Keep it short." });

  const named = valueOf(readPluginFolder(tree, { origin: "user", name: "kept-kit" }));
  expect(named).toMatchObject({ name: "kept-kit", inferred: true });
  expect(named.manifest.name).toBe("kept-kit");

  const plainDir = join(root, "plain-folder");
  writeFiles(plainDir, { "instructions.md": "Keep it short." });
  const plain = valueOf(readPluginFolder(plainDir, { origin: "user" }));
  expect(plain).toMatchObject({ name: "plain-folder", inferred: true });
});

test("the name option also names the skill that a root SKILL.md without a name falls back to", () => {
  const root = tempRoot("plugin-folder-name-skill-");
  roots.push(root);
  const tree = join(root, "tree");
  writeFiles(tree, {
    "SKILL.md": "---\ndescription: Tidy notes\n---\nBody text.",
  });

  const folder = valueOf(readPluginFolder(tree, { origin: "user", name: "skill-kit" }));
  expect(folder.name).toBe("skill-kit");
  expect(folder.materials.skills.map((skill) => skill.name)).toEqual(["skill-kit"]);
});

test("a folder with a manifest keeps the manifest name whatever the name option says", () => {
  const root = tempRoot("plugin-folder-name-manifest-");
  roots.push(root);
  const tree = join(root, "tree");
  writeFiles(tree, {
    ".fresnel-plugin/plugin.json": JSON.stringify({
      schemaVersion: 2,
      name: "manifest-kit",
      version: "1.0.0",
    }),
    "instructions.md": "Rule.",
  });

  const folder = valueOf(readPluginFolder(tree, { origin: "user", name: "other-name" }));
  expect(folder).toMatchObject({ name: "manifest-kit", inferred: false });
  expect(folder.manifest.name).toBe("manifest-kit");
});
