import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { ok, parse } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import type { RegistrationToggleSourceOf } from "@fresnel/ext-host";
import {
  createPluginSet,
  type OverlayMark,
  type PluginLifecycle,
} from "../../src/assembly/m4/plugin-set.ts";
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
const HASH_HELM = "sha256:" + "e".repeat(64);

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
  /** 오류로 멈춘 플러그인 이름. 시험이 바꾼다 */
  readonly stoppedNames: Set<string>;
  /** 대화별 드라이브 프레임의 플러그인 이름(주도 스택). 시험이 바꾼다 */
  readonly frames: Map<ThreadId, readonly string[]>;
  /** X가 임대 변화를 알리는 것을 흉내 낸다(`ExtHost.onChange`의 `lease`) */
  readonly leaseChanged: (id: ThreadId) => void;
}

interface FixtureOptions {
  /** 적재와 내리기를 기록하는 로더 연결. 없으면 참조만 센다 */
  readonly lifecycle?: PluginLifecycle;
  /** 공장 기본 프로필의 플러그인(프로필 집합의 구성원) */
  readonly defaults?: readonly string[];
}

function fixtureOf(options: FixtureOptions = {}): Fixture {
  const applyRequests: string[] = [];
  const applyNowCalls: string[] = [];
  const managed = new Set<string>();
  const stoppedNames = new Set<string>();
  const frames = new Map<ThreadId, readonly string[]>();
  const listeners: ((id: ThreadId) => void)[] = [];
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
    defaultPlugins: () => options.defaults ?? [],
    stopped: (name) => stoppedNames.has(name),
    settingsChanged: () => undefined,
    toggles,
    driveFramePlugins: (id) => frames.get(id) ?? [],
    // 시험의 루프는 항상 쉰다
    whenIdle: (_id, fn) => fn(),
    driveFramesChanged: (listener) => {
      listeners.push(listener);
      return () => undefined;
    },
    report: () => undefined,
    ...(options.lifecycle === undefined ? {} : { lifecycle: options.lifecycle }),
  });
  return {
    set,
    applyRequests,
    applyNowCalls,
    managedOff: managed,
    stoppedNames,
    frames,
    leaseChanged: (id) => {
      for (const listener of listeners) listener(id);
    },
  };
}

const MARK: OverlayMark = { plugin: "tools", contentHash: HASH_TOOLS, until: "turn" };
/** 시작 Drive로 얹은 덧씌우기. 프레임이 풀릴 때까지 산다 */
const DRIVE: OverlayMark = { plugin: "helm", contentHash: HASH_HELM, until: "release" };

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
  fixture.applyNowCalls.length = 0;
  fixture.set.port.turnSettled?.(id);
  expect(fixture.applyNowCalls).toEqual([id]);
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
  await fixture.set.cancelOverlay(id, false);
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

// ── 시작 Drive 덧씌우기(M5c §4.3.4): 수명은 프레임이 쥐는 동안이다 ─────────────

test("시작 Drive의 release 표지는 프레임이 쥐고 있는 동안 턴이 정착해도 남고, 집합에 든다", async () => {
  const fixture = fixtureOf();
  await fixture.set.refresh();
  const id = threadId();
  await fixture.set.attachOverlay(id, [DRIVE]);
  // 아직 부여되지 않은 표지도 집합에는 든다(시작 요청이 큐에 있다). 정착하기 전까지 빠지지 않는다
  expect(fixture.set.port.resolve(id)).toMatchObject({
    plugins: ["core-thing", "helm"],
    overlay: [{ plugin: "helm", contentHash: HASH_HELM, until: "release" }],
  });
  fixture.frames.set(id, ["helm"]);
  fixture.leaseChanged(id);
  fixture.set.port.turnSettled?.(id);
  expect(fixture.set.port.resolve(id)).toMatchObject({
    plugins: ["core-thing", "helm"],
    overlay: [{ plugin: "helm", contentHash: HASH_HELM, until: "release" }],
  });
});

test("프레임이 풀리면 release 표지를 빼고 집합을 다시 맞추도록 요청한다. 프레임이 아직 없는 임대 변화는 표지를 건드리지 않는다", async () => {
  const fixture = fixtureOf();
  await fixture.set.refresh();
  const id = threadId();
  await fixture.set.attachOverlay(id, [DRIVE]);
  fixture.frames.set(id, ["helm"]);
  fixture.leaseChanged(id);
  // 다른 플러그인의 임대 변화는 이 표지를 뺄 이유가 아니다
  fixture.leaseChanged(id);
  expect(fixture.set.port.resolve(id).overlay).toEqual([
    { plugin: "helm", contentHash: HASH_HELM, until: "release" },
  ]);
  fixture.applyNowCalls.length = 0;
  fixture.frames.set(id, []);
  fixture.leaseChanged(id);
  expect(fixture.applyNowCalls).toEqual([id]);
  const after = fixture.set.port.resolve(id);
  expect(after.plugins).toEqual(["core-thing"]);
  expect(after.overlay).toBeUndefined();
});

test("시작 요청이 버려져 프레임이 한 번도 없었던 release 표지는 턴이 정착할 때 빠진다", async () => {
  const fixture = fixtureOf();
  await fixture.set.refresh();
  const id = threadId();
  await fixture.set.attachOverlay(id, [DRIVE]);
  // 다른 플러그인의 프레임이 보여도 이 표지는 부여된 것이 아니다
  fixture.frames.set(id, ["tools"]);
  fixture.leaseChanged(id);
  expect(fixture.set.port.resolve(id).overlay).toEqual([
    { plugin: "helm", contentHash: HASH_HELM, until: "release" },
  ]);
  fixture.applyNowCalls.length = 0;
  fixture.set.port.turnSettled?.(id);
  expect(fixture.applyNowCalls).toEqual([id]);
  expect(fixture.set.port.resolve(id)).toMatchObject({ plugins: ["core-thing"] });
  expect(fixture.set.port.resolve(id).overlay).toBeUndefined();
});

test("턴 표지와 release 표지는 함께 든다. 정착하면 턴 표지만 빠지고 프레임이 쥔 release 표지는 남는다", async () => {
  const fixture = fixtureOf();
  await fixture.set.refresh();
  const id = threadId();
  await fixture.set.attachOverlay(id, [MARK]);
  await fixture.set.attachOverlay(id, [DRIVE]);
  fixture.frames.set(id, ["helm"]);
  fixture.leaseChanged(id);
  expect(fixture.set.port.resolve(id).overlay).toEqual([
    { plugin: "tools", contentHash: HASH_TOOLS, until: "turn" },
    { plugin: "helm", contentHash: HASH_HELM, until: "release" },
  ]);
  fixture.set.port.turnSettled?.(id);
  expect(fixture.set.port.resolve(id)).toMatchObject({
    plugins: ["core-thing", "helm"],
    overlay: [{ plugin: "helm", contentHash: HASH_HELM, until: "release" }],
  });
});

test("입력이 접수되지 않으면 되돌리되 프레임이 쥔 release 표지는 남기고, 부여되지 않은 것은 뺀다", async () => {
  const fixture = fixtureOf();
  await fixture.set.refresh();
  const id = threadId();
  await fixture.set.attachOverlay(id, [DRIVE]);
  fixture.frames.set(id, ["helm"]);
  fixture.leaseChanged(id);
  await fixture.set.attachOverlay(id, [MARK]);
  await fixture.set.cancelOverlay(id, false);
  expect(fixture.set.port.resolve(id).overlay).toEqual([
    { plugin: "helm", contentHash: HASH_HELM, until: "release" },
  ]);
  // 부여되지 않은 release 표지는 되돌림으로 빠진다
  fixture.frames.set(id, []);
  fixture.leaseChanged(id);
  await fixture.set.attachOverlay(id, [DRIVE]);
  await fixture.set.cancelOverlay(id, false);
  expect(fixture.set.port.resolve(id).overlay).toBeUndefined();
});

test("입력이 주도 프레임에 넘어가 `keepDrive`로 되돌리면 턴 표지만 빠지고 부여되지 않은 release 표지는 남는다", async () => {
  const fixture = fixtureOf();
  await fixture.set.refresh();
  const id = threadId();
  await fixture.set.attachOverlay(id, [MARK]);
  await fixture.set.attachOverlay(id, [DRIVE]);
  await fixture.set.cancelOverlay(id, true);
  expect(fixture.set.port.resolve(id).overlay).toEqual([
    { plugin: "helm", contentHash: HASH_HELM, until: "release" },
  ]);
  // 그 표지는 부여된 뒤 프레임이 풀리면 빠진다
  fixture.frames.set(id, ["helm"]);
  fixture.leaseChanged(id);
  fixture.frames.set(id, []);
  fixture.leaseChanged(id);
  expect(fixture.set.port.resolve(id).overlay).toBeUndefined();
});

test("시작 Drive 덧씌우기가 끝나도 프로필과 프로필의 사용 기록(viewOfProfile)은 그대로다", async () => {
  const fixture = fixtureOf();
  await fixture.set.refresh();
  const id = threadId();
  const before = fixture.set.viewOfProfile("default");
  await fixture.set.attachOverlay(id, [DRIVE]);
  fixture.frames.set(id, ["helm"]);
  fixture.leaseChanged(id);
  fixture.frames.set(id, []);
  fixture.leaseChanged(id);
  fixture.set.port.turnSettled?.(id);
  expect(fixture.set.viewOfProfile("default")).toEqual(before);
  expect(fixture.set.port.resolve(id).overlay).toBeUndefined();
});

// ── 재시작 복원(M5c §4.3.5): 열린 임대의 Drive 프레임을 release 표지로 되살린다 ─────────

/** 적재와 내리기를 기록하는 로더 연결. `ensureLoaded`는 `gate`가 풀릴 때까지 끝나지 않는다 */
function lifecycleSpy(gate: Promise<void> = Promise.resolve()): PluginLifecycle & {
  readonly loaded: string[];
  readonly unloaded: string[];
} {
  const loaded: string[] = [];
  const unloaded: string[] = [];
  return {
    loaded,
    unloaded,
    async ensureLoaded(name) {
      loaded.push(name);
      await gate;
      return undefined;
    },
    async unload(name) {
      unloaded.push(name);
      return undefined;
    },
  };
}

/** 마이크로태스크를 모두 비운다. 그 뒤에도 끝나지 않은 일은 기다리는 중이다 */
function flushed(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

test("재시작 복원: 되살린 Drive 표지는 적재가 끝난 뒤에 돌아오고, 집합에 release 표지로 든다", async () => {
  const gate = Promise.withResolvers<void>();
  const spy = lifecycleSpy(gate.promise);
  const fixture = fixtureOf({ lifecycle: spy });
  await fixture.set.refresh();
  const id = threadId();
  const restoring = fixture.set.restoreOverlay(id, [DRIVE]);
  const finished = restoring.then((): "finished" => "finished");
  await flushed();
  // 적재가 끝나기 전에는 돌아오지 않는다(`ext.openThread`가 scope를 찾아야 프레임이 산다)
  expect(spy.loaded).toEqual(["helm"]);
  expect(await Promise.race([finished, Promise.resolve<"pending">("pending")])).toBe("pending");
  gate.resolve();
  await restoring;
  expect(await finished).toBe("finished");
  // 열기 전이라 적용을 요청하지 않는다. 적용은 열 때의 첫 경계가 한다
  expect(fixture.applyNowCalls).toEqual([]);
  expect(fixture.set.port.resolve(id)).toMatchObject({
    plugins: ["core-thing", "helm"],
    overlay: [{ plugin: "helm", contentHash: HASH_HELM, until: "release" }],
  });
});

test("재시작 복원: 프로필에 든 이름, 코어 이름, 관리 잠금, 오류 정지, 턴 표지는 되살리지 않는다", async () => {
  const spy = lifecycleSpy();
  const fixture = fixtureOf({ lifecycle: spy, defaults: ["helm"] });
  fixture.managedOff.add("managed-drive");
  fixture.stoppedNames.add("stopped-drive");
  await fixture.set.refresh();
  const id = threadId();
  await fixture.set.restoreOverlay(id, [
    // 공장 기본 프로필에 든 이름
    DRIVE,
    // 코어 이름
    { plugin: "core-thing", contentHash: HASH_HELM, until: "release" },
    // 관리 잠금과 오류 정지
    { plugin: "managed-drive", contentHash: HASH_HELM, until: "release" },
    { plugin: "stopped-drive", contentHash: HASH_HELM, until: "release" },
    // 턴 표지는 프레임과 무관하다
    { plugin: "tools", contentHash: HASH_TOOLS, until: "turn" },
  ]);
  await flushed();
  // 적재는 프로필의 helm만 한다(E(T)의 구성원이라 `refresh`가 싣는다). 되살리기가 더한 적재는 없다
  expect(spy.loaded).toEqual(["helm"]);
  expect(fixture.set.port.resolve(id).overlay).toBeUndefined();
  expect(fixture.set.port.resolve(id).plugins).toEqual(["core-thing", "helm"]);
});

test("재시작 복원: 되살린 표지는 프레임이 풀리면 빠지고, 집합을 맞추도록 요청하고, 적재를 내린다", async () => {
  const spy = lifecycleSpy();
  const fixture = fixtureOf({ lifecycle: spy });
  await fixture.set.refresh();
  const id = threadId();
  await fixture.set.restoreOverlay(id, [DRIVE]);
  // 프레임이 쥐고 있는 동안은 표지도 적재도 남는다
  fixture.frames.set(id, ["helm"]);
  fixture.leaseChanged(id);
  await flushed();
  expect(fixture.set.port.resolve(id).overlay).toEqual([
    { plugin: "helm", contentHash: HASH_HELM, until: "release" },
  ]);
  expect(spy.unloaded).toEqual([]);
  fixture.applyNowCalls.length = 0;
  fixture.frames.set(id, []);
  fixture.leaseChanged(id);
  await flushed();
  expect(fixture.applyNowCalls).toEqual([id]);
  expect(fixture.set.port.resolve(id).overlay).toBeUndefined();
  expect(spy.unloaded).toEqual(["helm"]);
});

test("재시작 복원: 열린 대화를 닫으면 되살린 표지의 적재 참조가 놓인다", async () => {
  const spy = lifecycleSpy();
  const fixture = fixtureOf({ lifecycle: spy });
  await fixture.set.refresh();
  const id = threadId();
  await fixture.set.restoreOverlay(id, [DRIVE]);
  await flushed();
  expect(spy.loaded).toEqual(["helm"]);
  fixture.set.forget(id);
  await flushed();
  expect(spy.unloaded).toEqual(["helm"]);
  expect(fixture.set.port.resolve(id).overlay).toBeUndefined();
});
