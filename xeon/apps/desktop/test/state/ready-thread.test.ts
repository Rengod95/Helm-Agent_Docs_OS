import { describe, expect, test } from "bun:test";
import { selectReadyThreadId } from "../../src/state/engine/selectors.ts";
import { harness, openedHarness, thr, SUB, STORE } from "./helpers.ts";

// 확장 화면의 helm 상태 조회는 엔진이 열어 본문까지 받은 대화로만 나간다.
// 다시 켠 뒤 고른 채로만 남은 대화나 열리는 중인 대화로 나가면 호스트가 "thread … is not open"으로 거절한다.

describe("selectReadyThreadId", () => {
  test("열린 대화가 없으면 null이다", () => {
    const h = harness();
    expect(selectReadyThreadId(h.store.read.getState())).toBeNull();
  });

  test("열리는 중에는 null이고 본문을 받은 뒤에 그 대화의 id다", () => {
    const h = harness();
    h.store.ingest({
      type: "subscribed",
      sub: SUB,
      storeId: STORE,
      start: 5,
      live: true,
      from: "head",
    });
    h.store.ingest({ type: "transcript_opening", threadId: thr(2) });
    h.store.flush();
    expect(selectReadyThreadId(h.store.read.getState())).toBeNull();
    h.store.ingest({ type: "transcript", threadId: thr(2), asOfSeq: 5, items: [] });
    h.store.flush();
    expect(selectReadyThreadId(h.store.read.getState())).toBe(thr(2));
  });

  test("대화를 닫으면 다시 null이다", () => {
    const h = openedHarness(5, thr(1));
    expect(selectReadyThreadId(h.store.read.getState())).toBe(thr(1));
    h.store.ingest({ type: "transcript_closed" });
    h.store.flush();
    expect(selectReadyThreadId(h.store.read.getState())).toBeNull();
  });
});
