import { expect, test } from "bun:test";
import type { Logger } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { openMeasureStore, type MeasureStore } from "../../../src/assembly/measure/store.ts";
import { createTestRunMarks } from "../../../src/assembly/measure/test-run-marks.ts";

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
