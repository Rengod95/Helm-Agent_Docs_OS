import { expect, test } from "bun:test";
import type { Logger } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { openMeasureStore, type MeasureStore } from "../../../src/assembly/measure/store.ts";
import {
  createTestRunMarks,
  decodeTestRunDrafts,
  encodeTestRunDrafts,
} from "../../../src/assembly/measure/test-run-marks.ts";

// M5c §4.8.1: 테스트 실행의 묶음 id(`runGroupId`)는 표지와 함께 측정 저장소에 적히고, 다시 쓸 때 지켜진다.
// 재시작 뒤 표지를 되살릴 때 이 값을 `recall`로 읽는다. 값은 저장소에서 다시 읽어 비교한다.

const ids = fixedIdFactory();
const THREAD: ThreadId = ids.next("thr");
const clock = { now: () => 1_700_000_000_000 };
const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
};

function memory(): MeasureStore {
  const opened = openMeasureStore(":memory:");
  if (!opened.ok) throw new Error("the in-memory measure store must open");
  return opened.value;
}

test("a test mark keeps the run group id it was written with, and a later mark without one keeps the stored value", () => {
  const store = memory();
  const marks = createTestRunMarks({ store: () => store, clock, logger });
  expect(marks.remember(THREAD, "work", "test", "grp-1")).toBe(true);
  expect(marks.recall(THREAD)).toMatchObject({
    threadId: THREAD,
    scopeKind: "test",
    testBaseProfile: "work",
    runGroupId: "grp-1",
  });
  // 묶음 id를 주지 않은 표지는 있는 값을 지킨다
  expect(marks.remember(THREAD, "work")).toBe(true);
  expect(marks.recall(THREAD)?.runGroupId).toBe("grp-1");
  store.close();
});

test("a mark written without a run group id has none, and the base profile is recorded as given", () => {
  const store = memory();
  const marks = createTestRunMarks({ store: () => store, clock, logger });
  expect(marks.remember(THREAD, null)).toBe(true);
  expect(marks.recall(THREAD)).toMatchObject({ testBaseProfile: null, runGroupId: null });
  store.close();
});

test("the approval rides in draft_json: auto is written and read back, ask is not written, and an old row without it reads as ask", () => {
  // `auto`만 적는다. 기록이 없거나 `ask`를 쓰지 않은 옛 행은 `ask`로 읽는다(§4.8.1 항목 10)
  const auto = encodeTestRunDrafts([], "auto");
  expect(auto).toBe('{"drafts":[],"approval":"auto"}');
  expect(decodeTestRunDrafts(auto)).toEqual({ ok: true, value: { drafts: [], approval: "auto" } });
  expect(encodeTestRunDrafts([])).toBe('{"drafts":[]}');
  expect(decodeTestRunDrafts('{"drafts":[]}')).toEqual({ ok: true, value: { drafts: [] } });
  expect(decodeTestRunDrafts(null)).toEqual({ ok: true, value: { drafts: [] } });
  // 승인 칸은 `auto`만 받는다. 다른 값은 깨진 기록이다
  expect(decodeTestRunDrafts('{"drafts":[],"approval":"ask"}').ok).toBe(false);
  // 초안과 함께 쓴 `auto`도 읽힌다
  const withDraft = encodeTestRunDrafts(
    [{ plugin: "widget", draftId: "drf-1", contentHash: "sha256:a" }],
    "auto",
  );
  expect(decodeTestRunDrafts(withDraft)).toEqual({
    ok: true,
    value: {
      drafts: [{ plugin: "widget", draftId: "drf-1", contentHash: "sha256:a" }],
      approval: "auto",
    },
  });
  // 측정 저장소의 `draft_json`을 거쳐도 `auto`가 남는다(재시작 뒤 되살리기의 원천)
  const store = memory();
  const marks = createTestRunMarks({ store: () => store, clock, logger });
  expect(marks.remember(THREAD, "work", "test", "grp-1", auto)).toBe(true);
  const stored = marks.recall(THREAD);
  expect(stored).toBeDefined();
  expect(decodeTestRunDrafts(stored?.draftJson ?? null)).toEqual({
    ok: true,
    value: { drafts: [], approval: "auto" },
  });
  store.close();
});

test("a draft record keeps its start-Drive flag through draft_json; a plain draft writes no flag, and an old row without it reads as a plain draft", () => {
  const text = encodeTestRunDrafts([
    { plugin: "widget", draftId: "drf-1", contentHash: "sha256:a", startDrive: true },
    { plugin: "gadget", draftId: "drf-2", contentHash: "sha256:b" },
  ]);
  expect(text).toBe(
    '{"drafts":[{"plugin":"widget","draftId":"drf-1","contentHash":"sha256:a","startDrive":true},{"plugin":"gadget","draftId":"drf-2","contentHash":"sha256:b"}]}',
  );
  expect(decodeTestRunDrafts(text)).toEqual({
    ok: true,
    value: {
      drafts: [
        { plugin: "widget", draftId: "drf-1", contentHash: "sha256:a", startDrive: true },
        { plugin: "gadget", draftId: "drf-2", contentHash: "sha256:b" },
      ],
    },
  });
  expect(
    decodeTestRunDrafts(
      '{"drafts":[{"plugin":"widget","draftId":"drf-1","contentHash":"sha256:a"}]}',
    ),
  ).toEqual({
    ok: true,
    value: { drafts: [{ plugin: "widget", draftId: "drf-1", contentHash: "sha256:a" }] },
  });
  // 참이 아닌 값은 쓰지 않는다(옛 모양과 같다). 읽을 때도 참 값만 받는다
  expect(
    decodeTestRunDrafts(
      '{"drafts":[{"plugin":"widget","draftId":"drf-1","contentHash":"sha256:a","startDrive":false}]}',
    ).ok,
  ).toBe(false);
});
