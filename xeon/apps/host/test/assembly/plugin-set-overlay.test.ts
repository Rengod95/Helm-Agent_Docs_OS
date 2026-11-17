import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { ok, parse } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import type { RegistrationToggleSourceOf } from "@fresnel/ext-host";
import { createPluginSet, type OverlayMark } from "../../src/assembly/m4/plugin-set.ts";
import { createMaterialPort } from "../../src/assembly/plugins/material-port.ts";
import { readPluginFolder } from "../../src/assembly/plugins/folder-reader.ts";
import { removeTree, tempRoot, writeFiles } from "./plugins/support.ts";

// M5c §4.3.3~4: 턴 덧씌우기는 대화의 E(T)에 그 턴 동안만 더해진다. 프로필과 `usedBy`는 그대로다.
// 시험은 집합 포트의 값과 적용 요청을 값으로 비교한다. 재료 포트는 E(T)로 지침을 읽는지 본다.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTree(root);
});

const HASH_TOOLS = "sha256:" + "c".repeat(64);

function threadId(): ThreadId {
  const parsed = parse(ThreadIdSchema, "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV");
  if (!parsed.ok) throw new Error("fixture thread id is invalid");
  return parsed.value;
}

interface Fixture {
  readonly set: ReturnType<typeof createPluginSet>;
  readonly applyRequests: string[];
  readonly applyNowCalls: string[];
  managedOff: Set<string>;
}

function fixtureOf(): Fixture {
  const applyRequests: string[] = [];
  const applyNowCalls: string[] = [];
  const managed = new Set<string>();
  const toggles: RegistrationToggleSourceOf = {
    scopes: () => [],
    request: () => undefined,
    requestApply: (id) => {
      applyRequests.push(id);
    },
    applyNow: (id) => {
      applyNowCalls.push(id);
      return Promise.resolve();
    },
  };
  const set = createPluginSet({
    profiles: {
      list: () =>
        Promise.resolve(
          ok({
            profiles: [],
            common: { plugins: [], settings: [], updatedAt: "2026-11-18T00:00:00.000Z", rev: 1 },
            rev: 1,
          }),
        ),
      onProfilesWritten: () => () => undefined,
    },
    threadProfileId: () => null,
    openThreadIds: () => [threadId()],
    managedOff: (name) => managed.has(name),
    registrations: () => [],
    loadedHash: (name) => (name === "tools" ? HASH_TOOLS : undefined),
    forcedPlugins: () => ["core-thing"],
    defaultPlugins: () => [],
    stopped: () => false,
    settingsChanged: () => undefined,
    toggles,
    report: () => undefined,
  });
  return { set, applyRequests, applyNowCalls, managedOff: managed };
}

const MARK: OverlayMark = { plugin: "tools", contentHash: HASH_TOOLS, until: "turn" };

test("턴 덧씌우기는 집합의 뒤쪽에 들고 표지를 싣고, 적용을 입력 처리 앞에 기다린다", async () => {
  const fixture = fixtureOf();
  await fixture.set.refresh();
  const id = threadId();
  await fixture.set.attachOverlay(id, [MARK]);
  expect(fixture.applyNowCalls).toEqual([id]);
  expect(fixture.set.port.resolve(id)).toEqual({
    plugins: ["core-thing", "tools"],
    profileId: "default",
    profileRev: 0,
    commonRev: 1,
    // 코어 플러그인은 검토본에서 실리지 않아 해시가 없고, 덧씌우기 플러그인은 적재된 판의 해시가 실린다
    pluginHashes: [{ plugin: "tools", contentHash: HASH_TOOLS }],
    overlay: [{ plugin: "tools", contentHash: HASH_TOOLS, until: "turn" }],
  });
});

test("턴이 정착하면 턴 덧씌우기가 빠지고 집합을 다시 맞추도록 요청한다. 프로필의 값은 건드리지 않는다", async () => {
  const fixture = fixtureOf();
  await fixture.set.refresh();
  const id = threadId();
  await fixture.set.attachOverlay(id, [MARK]);
  fixture.applyRequests.length = 0;
  fixture.set.port.turnSettled?.(id);
  expect(fixture.applyRequests).toEqual([id]);
  const after = fixture.set.port.resolve(id);
  expect(after.plugins).toEqual(["core-thing"]);
  expect(after.overlay).toBeUndefined();
});

test("입력이 접수되지 않으면 얹은 덧씌우기를 되돌리고 적용을 기다린다. 같은 이름은 한 번만 얹는다", async () => {
  const fixture = fixtureOf();
  await fixture.set.refresh();
  const id = threadId();
  await fixture.set.attachOverlay(id, [MARK, MARK]);
  expect(fixture.set.port.resolve(id).overlay).toEqual([
    { plugin: "tools", contentHash: HASH_TOOLS, until: "turn" },
  ]);
  await fixture.set.cancelOverlay(id);
  expect(fixture.applyNowCalls).toEqual([id, id]);
  expect(fixture.set.port.resolve(id).plugins).toEqual(["core-thing"]);
});

test("관리 잠금이 걸린 플러그인은 덧씌우기로도 집합에 들지 않고 표지에도 실리지 않는다", async () => {
  const fixture = fixtureOf();
  fixture.managedOff.add("tools");
  await fixture.set.refresh();
  const id = threadId();
  await fixture.set.attachOverlay(id, [MARK]);
  expect(fixture.set.port.resolve(id)).toMatchObject({ plugins: ["core-thing"] });
  expect(fixture.set.port.resolve(id).overlay).toBeUndefined();
});

test("재료 포트는 E(T)로 지침을 읽으므로 덧씌우기 턴에만 지침이 실리고 정착하면 빠진다", async () => {
  const root = tempRoot("plugin-set-overlay-");
  roots.push(root);
  writeFiles(join(root, "tools"), { "instructions.md": "Answer briefly.\n" });
  const folderDir = join(root, "tools");
  const fixture = fixtureOf();
  await fixture.set.refresh();
  const id = threadId();
  const materials = createMaterialPort({
    pluginSet: (threadOf) => fixture.set.port.resolve(threadOf).plugins,
    treeOf: (name) => (name === "tools" ? folderDir : null),
    read: (dir) => readPluginFolder(dir, { origin: "user" }),
    report: () => undefined,
  });
  expect(materials.instructions(id)).toEqual([]);
  await fixture.set.attachOverlay(id, [MARK]);
  expect(materials.instructions(id)).toEqual([
    { key: "plugin:tools:instructions.md", text: "Answer briefly.\n" },
  ]);
  fixture.set.port.turnSettled?.(id);
  expect(materials.instructions(id)).toEqual([]);
});
