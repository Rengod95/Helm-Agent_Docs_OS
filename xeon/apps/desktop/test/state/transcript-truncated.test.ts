import { describe, expect, test } from "bun:test";
import { selectTranscriptTruncated } from "../../src/state/engine/selectors.ts";
import { harness, SUB, STORE, thr } from "./helpers.ts";

// scJ S2-1: 읽는 상한에서 잘린 스냅샷은 거울에 표식이 남고, 잘리지 않은 스냅샷에는 없다.

function open(truncated: boolean) {
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
  h.store.ingest({
    type: "transcript",
    threadId: thr(2),
    asOfSeq: 5,
    items: [],
    ...(truncated ? { truncated: true as const } : {}),
  });
  h.store.flush();
  return selectTranscriptTruncated(h.store.read.getState());
}

describe("selectTranscriptTruncated", () => {
  test("is true only when the snapshot stopped at the read cap", () => {
    expect(open(true)).toBe(true);
    expect(open(false)).toBe(false);
  });
});
