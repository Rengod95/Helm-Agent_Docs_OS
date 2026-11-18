import { expect, test } from "bun:test";
import { ok, parse } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import type { Profile } from "@fresnel/contracts/wire";
import type { RegistrationToggleSourceOf } from "@fresnel/ext-host";
import {
  createPluginSet,
  type FixedDraftMark,
  type PluginLifecycle,
} from "../../src/assembly/m4/plugin-set.ts";

// M5c §4.8.1 테스트 실행의 고정 구성(시험 값). 초안은 같은 이름의 검토본 자리에 놓이고, 없는 이름은 뒤에 붙는다. 덧씌우기가 아니라서
// `PluginSetView.overlay`에 없고 턴이 정착해도 남는다. 하위 대화는 부모의 기준 프로필과 고정 초안을 물려받는다(규칙 9).

const PARENT = threadOf("thr_01ARZ3NDEKTSV4RRFFQ69G5FA1");
const CHILD = threadOf("thr_01ARZ3NDEKTSV4RRFFQ69G5FA2");
const PLAIN = threadOf("thr_01ARZ3NDEKTSV4RRFFQ69G5FA3");
const SIBLING = threadOf("thr_01ARZ3NDEKTSV4RRFFQ69G5FA4");

const HASH_DEMO = `sha256:${"d".repeat(64)}`;
const HASH_ZETA = `sha256:${"e".repeat(64)}`;

function threadOf(text: string): ThreadId {
  const parsed = parse(ThreadIdSchema, text);
  if (!parsed.ok) throw new Error("fixture thread id is invalid");
  return parsed.value;
}

/** 기준 프로필 `work`: 알파, 데모, 베타 순서다. 검토본 `zeta`는 프로필에 없다 */
const WORK: Profile = {
  id: "work",
  title: "Work",
  builtin: false,
  plugins: [{ name: "alpha" }, { name: "demo" }, { name: "beta" }],
  settings: [],
  startDrive: null,
  updatedAt: "2026-11-18T00:00:00.000Z",
  rev: 2,
};

function fixtureOf(): {
  readonly set: ReturnType<typeof createPluginSet>;
  readonly loads: string[];
  readonly unloads: string[];
} {
  const loads: string[] = [];
  const unloads: string[] = [];
  const toggles: RegistrationToggleSourceOf = {
    scopes: () => [],
    request: () => undefined,
    requestApply: () => undefined,
    applyNow: () => Promise.resolve(),
  };
  const lifecycle: PluginLifecycle = {
    ensureLoaded: (name) => {
      loads.push(name);
      return Promise.resolve(undefined);
    },
    unload: (name) => {
      unloads.push(name);
      return Promise.resolve(true);
    },
  };
  const set = createPluginSet({
    profiles: {
      list: () =>
        Promise.resolve(
          ok({
            profiles: [WORK],
            common: { plugins: [], settings: [], updatedAt: "2026-11-18T00:00:00.000Z", rev: 1 },
            rev: 1,
          }),
        ),
      onProfilesWritten: () => () => undefined,
    },
    threadProfileId: (threadId) => (threadId === PARENT ? "work" : null),
    parentOf: (threadId) => (threadId === CHILD ? PARENT : undefined),
    openThreadIds: () => [PARENT, CHILD],
    managedOff: () => false,
    registrations: () => [],
    loadedHash: () => undefined,
    forcedPlugins: () => [],
    defaultPlugins: () => [],
    stopped: () => false,
    settingsChanged: () => undefined,
    toggles,
    driveFramePlugins: () => [],
    whenIdle: (_id, fn) => fn(),
    driveFramesChanged: () => () => undefined,
    report: () => undefined,
    lifecycle,
  });
  return { set, loads, unloads };
}

/** 묶는 초안 둘: `demo`의 자리를 `ddrf1-demo`가 잇고, 검토본이 없는 `zeta`는 뒤에 든다 */
const FIXED: readonly FixedDraftMark[] = [
  { plugin: "ddrf1-demo", draftId: "drf-1", contentHash: HASH_DEMO, replaces: "demo" },
  { plugin: "ddrf2-zeta", draftId: "drf-2", contentHash: HASH_ZETA, replaces: "zeta" },
];

/** 초안의 내부 이름만 고른다. 프로필의 검토본 적재는 시험의 관심이 아니다 */
function draftsOf(names: readonly string[]): string[] {
  return names.filter((name) => name.startsWith("ddrf")).toSorted();
}

/** 매크로태스크 한 바퀴를 세 번 기다린다(대기 중인 비동기 작업이 모두 돌도록) */
async function settle(): Promise<void> {
  await tick();
  await tick();
  await tick();
}

function tick(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

test("a fixed draft takes the reviewed plugin's place in the set, and a name with no reviewed plugin goes to the end", async () => {
  const { set } = fixtureOf();
  await set.refresh();
  await set.setTestRunDrafts(PARENT, FIXED);
  expect(set.port.resolve(PARENT).plugins).toEqual(["alpha", "ddrf1-demo", "beta", "ddrf2-zeta"]);
  // 같은 이름의 검토본은 집합에서 빠진다
  expect(set.port.resolve(PARENT).plugins).not.toContain("demo");
});

test("a fixed draft is not listed as an overlay and stays after the turn settles", async () => {
  const { set } = fixtureOf();
  await set.refresh();
  await set.setTestRunDrafts(PARENT, FIXED);
  expect(set.viewOf(PARENT).overlay).toBeUndefined();
  set.port.turnSettled?.(PARENT);
  await settle();
  expect(set.port.resolve(PARENT).plugins).toEqual(["alpha", "ddrf1-demo", "beta", "ddrf2-zeta"]);
  expect(set.viewOf(PARENT).overlay).toBeUndefined();
});

test("the fixed drafts load while the test run uses them, and unload when the thread is forgotten", async () => {
  const { set, loads, unloads } = fixtureOf();
  await set.refresh();
  await set.setTestRunDrafts(PARENT, FIXED);
  await set.opened(PARENT);
  expect(draftsOf(loads)).toEqual(["ddrf1-demo", "ddrf2-zeta"]);
  expect(draftsOf(unloads)).toEqual([]);
  set.forget(PARENT);
  await settle();
  expect(draftsOf(unloads)).toEqual(["ddrf1-demo", "ddrf2-zeta"]);
  // 묶은 구성은 대화를 잊으면 함께 사라진다(다시 열면 기록에서 되살린다)
  expect(set.testRunDraftsOf(PARENT)).toBeUndefined();
});

test("a child of the test run inherits the parent's base profile and fixed drafts", async () => {
  const { set, loads } = fixtureOf();
  await set.refresh();
  await set.setTestRunDrafts(PARENT, FIXED);
  expect(set.port.resolve(CHILD).plugins).toEqual(["alpha", "ddrf1-demo", "beta", "ddrf2-zeta"]);
  expect(set.port.resolve(CHILD).profileId).toBe("work");
  // 물려받은 구성은 자식이 쓰는 참조로도 센다: 자식이 열리면 같은 초안을 실린 채 둔다
  await set.opened(CHILD);
  expect(draftsOf(loads)).toEqual(["ddrf1-demo", "ddrf2-zeta"]);
  // 자식 자신의 고정 구성은 없다(물려받은 것은 묶인 구성으로 세지 않는다)
  expect(set.testRunDraftsOf(CHILD)).toBeUndefined();
});

test("an ordinary thread with no test run keeps the default set, even when it is a child", async () => {
  const { set } = fixtureOf();
  await set.refresh();
  await set.setTestRunDrafts(PARENT, FIXED);
  expect(set.port.resolve(PLAIN).plugins).toEqual([]);
  expect(set.port.resolve(PLAIN).profileId).toBe("default");
});

test("the draft approval auto belongs to the test run it was bound with: its child inherits it, a sibling test run and an ordinary thread do not, and forgetting the run clears it", async () => {
  const { set } = fixtureOf();
  await set.refresh();
  await set.setTestRunDrafts(PARENT, FIXED, "auto");
  await set.setTestRunDrafts(SIBLING, FIXED);
  expect(set.testRunApprovalOf(PARENT)).toBe("auto");
  expect(set.testRunApprovalOf(CHILD)).toBe("auto");
  expect(set.testRunApprovalOf(SIBLING)).toBeUndefined();
  expect(set.testRunApprovalOf(PLAIN)).toBeUndefined();
  // 잊으면 승인 방식도 사라진다(자식도 부모가 없어 `ask`가 된다)
  set.forget(PARENT);
  expect(set.testRunApprovalOf(PARENT)).toBeUndefined();
  expect(set.testRunApprovalOf(CHILD)).toBeUndefined();
});

test("binding the same test run again without auto makes it ask, and a child then has no approval", async () => {
  const { set } = fixtureOf();
  await set.refresh();
  await set.setTestRunDrafts(PARENT, FIXED, "auto");
  await set.setTestRunDrafts(PARENT, FIXED);
  expect(set.testRunApprovalOf(PARENT)).toBeUndefined();
  expect(set.testRunApprovalOf(CHILD)).toBeUndefined();
});
