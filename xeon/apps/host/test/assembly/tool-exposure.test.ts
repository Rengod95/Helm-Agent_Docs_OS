import { expect, test } from "bun:test";
import { isId, type ThreadId } from "@fresnel/contracts/conversation";
import type { ResourceRecord } from "@fresnel/ext-host";
import { createToolExposureOf } from "../../src/assembly/m4/tool-exposure.ts";

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

test("when the plugin set cannot be read, every loaded external tool is visible (nothing is hidden by a failed read)", () => {
  const exposureOf = createToolExposureOf({
    toolRecords: () => [tool(APPROVED, APPROVED, "check"), tool("other", "other", "list")],
    realNameOf: () => undefined,
    pluginsOf: () => undefined,
  });
  const exposure = exposureOf(null);
  expect(exposure?.nameOf(APPROVED, "check")).toBe("check");
  expect(exposure?.nameOf("other", "list")).toBe("list");
});
