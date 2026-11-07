import { describe, expect, test } from "bun:test";
import type { AnchoredCompaction } from "../../src/state/engine/compaction-anchor.ts";
import type { CompactionRecord } from "../../src/state/engine/state.ts";
import { transcriptRowsOf } from "../../src/views/transcript-rows.ts";
import { evt, itm, thr } from "../state/helpers.ts";

// 트랜스크립트 줄 순서(요약 구분선의 자리). 값으로 키 순서를 비교한다.

function recordOf(n: number): CompactionRecord {
  return {
    threadId: thr(1),
    eventId: evt(n),
    at: "2026-11-07T00:00:00.000Z",
    summary: `요약 ${n}`,
    tokensBefore: 1,
    tokensAfter: null,
    reason: null,
  };
}

const anchor = (n: number, after: ReturnType<typeof itm> | null): AnchoredCompaction => ({
  record: recordOf(n),
  after,
});

describe("transcriptRowsOf", () => {
  const ids = [itm(1), itm(2), itm(3)];

  test("a summary sits right after its anchor item, the top ones before the first item, the live row last", () => {
    const rows = transcriptRowsOf({
      ids,
      live: [itm(9)],
      showLive: true,
      anchors: [anchor(1, itm(2)), anchor(2, null), anchor(3, itm(2))],
    });
    expect(rows.map((row) => row.key)).toEqual([
      `compact:${evt(2)}`,
      itm(1),
      itm(2),
      `compact:${evt(1)}`,
      `compact:${evt(3)}`,
      itm(3),
      `live:${itm(9)}`,
    ]);
    expect(rows[0]).toMatchObject({ kind: "compaction", record: { summary: "요약 2" } });
    expect(rows[5]).toMatchObject({ kind: "item", id: itm(3), live: false });
  });

  test("the live rows are left out until the transcript is ready", () => {
    const rows = transcriptRowsOf({ ids, live: [itm(9)], showLive: false, anchors: [] });
    expect(rows.map((row) => row.key)).toEqual([itm(1), itm(2), itm(3)]);
  });

  test("without summaries the rows are the items alone", () => {
    const rows = transcriptRowsOf({ ids: [], live: [], showLive: true, anchors: [] });
    expect(rows).toEqual([]);
  });
});
