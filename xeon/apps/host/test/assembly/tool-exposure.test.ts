import { expect, test } from "bun:test";
import { isId, type ThreadId } from "@fresnel/contracts/conversation";
import type { ResourceRecord } from "@fresnel/ext-host";
import {
  createToolExposureOf,
  createToolOwnerIn,
  createToolPluginsOf,
} from "../../src/assembly/m4/tool-exposure.ts";

// L1.tools.spec §3.3.1, X.operations.spec §4.5.1 [결정: 2026-11-19, 사용자, AGE-56]: 대화가 보는 도구 이름과 가시성.

const APPROVED = "commit-msg";
const DRAFT_INTERNAL = "d7abc1-commit-msg";

function tool(scopeId: string, extension: string, name: string, builtin = false): ResourceRecord {
  return { kind: "tool", name, exposed: name, scopeId, extension, builtin, def: null };
}

const RECORDS: readonly ResourceRecord[] = [
  tool("core-web", "core-web", "fetch", true),
  tool(APPROVED, APPROVED, "check"),
  tool(DRAFT_INTERNAL, DRAFT_INTERNAL, "check"),
  tool("other", "other", "check"),
];

function threadOf(text: string): ThreadId {
  if (!isId("thr", text)) throw new Error(`not a thread id: ${text}`);
  return text;
}

const THREADS = {
  normal: threadOf("thr_01HZZZZZZZZZZZZZZZZZZZZZZ1"),
  testRun: threadOf("thr_01HZZZZZZZZZZZZZZZZZZZZZZ2"),
  otherTestRun: threadOf("thr_01HZZZZZZZZZZZZZZZZZZZZZZ3"),
  empty: threadOf("thr_01HZZZZZZZZZZZZZZZZZZZZZZ4"),
} as const;

/** 대화가 실은 플러그인 이름(E(T)) */
const SETS: ReadonlyMap<ThreadId, readonly string[]> = new Map([
  [THREADS.normal, [APPROVED]],
  [THREADS.testRun, [DRAFT_INTERNAL]],
  [THREADS.otherTestRun, [APPROVED, "other"]],
  [THREADS.empty, []],
]);

function exposureFor(set: keyof typeof THREADS) {
  const exposureOf = createToolExposureOf({
    toolRecords: () => RECORDS,
    realNameOf: (extension) => (extension === DRAFT_INTERNAL ? APPROVED : undefined),
    pluginsOf: (threadId) => SETS.get(threadId),
  });
  const exposure = exposureOf(THREADS[set]);
  if (exposure === undefined) throw new Error("no exposure rule");
  return exposure;
}

test("a normal conversation sees the approved tool under its short name even while a draft of the same plugin is loaded (the leak is gone)", () => {
  const exposure = exposureFor("normal");
  expect(exposure.nameOf(APPROVED, "check")).toBe("check");
  expect(exposure.nameOf(DRAFT_INTERNAL, "check")).toBeNull();
  expect(exposure.nameOf("other", "check")).toBeNull();
});

test("a test run sees the draft tool under the name the approved tool has, and not the approved one", () => {
  const exposure = exposureFor("testRun");
  expect(exposure.nameOf(DRAFT_INTERNAL, "check")).toBe("check");
  expect(exposure.nameOf(APPROVED, "check")).toBeNull();
});

test("another test run that loaded two approved plugins with the same short name sees both qualified, and the draft is hidden", () => {
  const exposure = exposureFor("otherTestRun");
  expect(exposure.nameOf(APPROVED, "check")).toBe("commit-msg__check");
  expect(exposure.nameOf("other", "check")).toBe("other__check");
  expect(exposure.nameOf(DRAFT_INTERNAL, "check")).toBeNull();
});

test("a builtin tool is visible everywhere, and a conversation with an empty set sees no external tool", () => {
  for (const set of ["normal", "testRun", "otherTestRun", "empty"] as const) {
    expect(exposureFor(set).nameOf("core-web", "fetch")).toBe("fetch");
  }
  const empty = exposureFor("empty");
  for (const owner of [APPROVED, DRAFT_INTERNAL, "other"]) {
    expect(empty.nameOf(owner, "check")).toBeNull();
  }
});

test("when the plugin set cannot be read, only builtin tools are visible: no approved, draft or test-run-only tool, under any name", () => {
  const exposureOf = createToolExposureOf({
    toolRecords: () => RECORDS,
    realNameOf: (extension) => (extension === DRAFT_INTERNAL ? APPROVED : undefined),
    pluginsOf: () => undefined,
  });
  for (const threadId of [null, THREADS.normal]) {
    const exposure = exposureOf(threadId);
    // 요청한 이름으로도, 주인으로 센 실제 이름과 내부 이름으로도 보이지 않는다
    for (const owner of [APPROVED, DRAFT_INTERNAL, "other"]) {
      expect(exposure?.nameOf(owner, "check")).toBeNull();
    }
    expect(exposure?.nameOf("core-web", "fetch")).toBe("fetch");
    // 정식 이름(`<플러그인>__<도구>`)과 옛 내부 이름(`d<태그>-…`)을 이름 자리에 넣어도 닿지 않는다
    expect(exposure?.nameOf(APPROVED, "commit-msg__check")).toBeNull();
    expect(exposure?.nameOf(DRAFT_INTERNAL, `${DRAFT_INTERNAL}__check`)).toBeNull();
  }
});

test("an unreadable set is not an empty set: an empty set hides external tools because the conversation loaded none, and both show builtin tools", () => {
  const read = createToolExposureOf({
    toolRecords: () => RECORDS,
    realNameOf: () => undefined,
    pluginsOf: () => [],
  })(THREADS.empty);
  expect(read?.nameOf("core-web", "fetch")).toBe("fetch");
  expect(read?.nameOf(APPROVED, "check")).toBeNull();
});

function pluginsOfWith(options: {
  readonly ready: boolean;
  readonly parents?: ReadonlyMap<string, ThreadId | null>;
}) {
  return createToolPluginsOf({
    ready: () => options.ready,
    isThread: (id): id is ThreadId => isId("thr", id),
    parentOf: (threadId) => options.parents?.get(threadId),
    resolve: (threadId) => SETS.get(threadId) ?? [],
  });
}

test("the plugin set is read only when the engine ports and the profile copy are ready, the id is a thread, and the parent lookup works", () => {
  expect(pluginsOfWith({ ready: false })(THREADS.normal)).toBeUndefined();
  expect(pluginsOfWith({ ready: true })("not-a-thread")).toBeUndefined();
  expect(pluginsOfWith({ ready: true })(THREADS.normal)).toEqual([APPROVED]);
  // 빈 집합은 읽은 값이다
  expect(pluginsOfWith({ ready: true })(THREADS.empty)).toEqual([]);
  // 부모 조회가 실패하면(null) 읽지 못한 것이다
  const failing = new Map<string, ThreadId | null>([[THREADS.otherTestRun, null]]);
  expect(pluginsOfWith({ ready: true, parents: failing })(THREADS.otherTestRun)).toBeUndefined();
  // 하위 대화는 맨 위 부모의 집합을 쓴다
  const child = threadOf("thr_01HZZZZZZZZZZZZZZZZZZZZZZ5");
  const links = new Map<string, ThreadId | null>([[child, THREADS.testRun]]);
  expect(pluginsOfWith({ ready: true, parents: links })(child)).toEqual([DRAFT_INTERNAL]);
  // 부모 사슬이 돌면 한도에서 읽지 못한 것이다
  const loop = new Map<string, ThreadId | null>([
    [child, THREADS.normal],
    [THREADS.normal, child],
  ]);
  expect(pluginsOfWith({ ready: true, parents: loop })(child)).toBeUndefined();
});

test("the tool owner is the one the conversation sees even when two owners register the same tool name", () => {
  const records = [tool(APPROVED, APPROVED, "check"), tool("other", "other", "check")];
  const dependencies = {
    toolRecords: () => records,
    realNameOf: () => undefined,
    pluginsOf: (threadId: ThreadId) => SETS.get(threadId),
  };
  const ownerIn = createToolOwnerIn({
    ...dependencies,
    exposureOf: createToolExposureOf(dependencies),
  });
  // 둘이 함께 실린 대화에서는 둘 다 정식 이름이다. 먼저 등록된 쪽이 이름 `check`의 주인이 아니다
  expect(ownerIn("check", THREADS.otherTestRun)?.extension).toBeUndefined();
  expect(ownerIn("commit-msg__check", THREADS.otherTestRun)?.extension).toBe(APPROVED);
  expect(ownerIn("other__check", THREADS.otherTestRun)?.extension).toBe("other");
  // 한 쪽만 실은 대화는 짧은 이름이다
  expect(ownerIn("check", THREADS.normal)?.extension).toBe(APPROVED);
  // 대화가 싣지 않은 도구와 읽지 못하는 대화는 주인이 없다
  expect(ownerIn("check", THREADS.empty)).toBeUndefined();
});
