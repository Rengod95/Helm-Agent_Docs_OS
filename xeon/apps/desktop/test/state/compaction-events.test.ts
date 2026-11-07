import { describe, expect, test } from "bun:test";
import type { ItemRecord, ThreadId } from "@fresnel/contracts/conversation";
import type { EventWire } from "@fresnel/contracts/wire";
import { decodeDurable } from "../../src/state/engine/decode.ts";
import { anchorCompactions } from "../../src/state/engine/compaction-anchor.ts";
import type { DurableFact, MirrorInput } from "../../src/state/engine/input.ts";
import { reduceMirror } from "../../src/state/engine/reduce.ts";
import { selectCompactionAnchors } from "../../src/state/engine/selectors.ts";
import {
  COMPACTION_CAP,
  INITIAL_MIRROR,
  type CompactionRecord,
  type EngineMirror,
  type Transcript,
} from "../../src/state/engine/state.ts";
import { STORE, SUB, evt, itm, thr } from "./helpers.ts";

// 대화 요약 사건(`thread.compacted`)의 디코드, 거울의 요약 기록, 구분선이 서는 자리(L4 desktop-ux §6.6).
// 요약 본문은 거울에 든다(요약 보기가 쓴다). 자리는 사건 시각과 item 시각으로 정한다.

const T: ThreadId = thr(1);
const OTHER: ThreadId = thr(2);
const BASE_MS = Date.parse("2026-11-07T00:00:00.000Z");
const iso = (offsetMs: number): string => new Date(BASE_MS + offsetMs).toISOString();

function wire(
  seq: number,
  payload: unknown,
  threadId: ThreadId = T,
  recordedAt = iso(0),
): EventWire {
  return {
    id: evt(seq),
    kind: "thread.compacted",
    version: 1,
    durable: true,
    seq,
    parentId: null,
    threadId,
    turnId: null,
    stepId: null,
    recordedAt,
    causationId: null,
    correlationId: null,
    payload,
    redactions: [],
  };
}

/** 스키마를 맞춘 요약 사건 payload. 필드마다 바꿔 쓴다 */
function payloadOf(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    summary: "요약 본문",
    firstKeptEventId: evt(1),
    tokensBefore: 120_000,
    details: null,
    usage: null,
    fromExtension: null,
    tokensAfter: 30_000,
    reason: "threshold",
    ...overrides,
  };
}

const compacted = (
  seq: number,
  overrides: Record<string, unknown> = {},
  threadId: ThreadId = T,
  recordedAt = iso(seq * 1000),
): DurableFact => decodeDurable(wire(seq, payloadOf(overrides), threadId, recordedAt));

function run(facts: readonly DurableFact[]): EngineMirror {
  const inputs: MirrorInput[] = [
    { type: "subscribed", sub: SUB, storeId: STORE, start: 0, live: true, from: "head" },
    {
      type: "batch",
      sub: SUB,
      from: 0,
      to: facts.at(-1)?.seq ?? 0,
      caughtUp: true,
      facts: [...facts],
    },
  ];
  let state = INITIAL_MIRROR;
  for (const input of inputs) state = reduceMirror(state, input).state;
  return state;
}

/** 연결 전 사건을 채우는 재생(backfill)을 적용한 거울 */
function replayOf(state: EngineMirror, facts: readonly DurableFact[]): EngineMirror {
  return reduceMirror(state, { type: "backfill", storeId: STORE, facts: [...facts] }).state;
}

function userAt(n: number, timestamp: number): ItemRecord {
  return {
    itemId: itm(n),
    status: "completed",
    kind: "user",
    message: { role: "user", content: `item ${n}`, timestamp },
    requestId: null,
  };
}

describe("thread.compacted: decode", () => {
  test("a compaction keeps the summary, the token counts and the reason, and drops details and usage", () => {
    expect(decodeDurable(wire(9, payloadOf()))).toEqual({
      type: "thread.compacted",
      seq: 9,
      eventId: evt(9),
      threadId: T,
      turnId: null,
      at: iso(0),
      compaction: {
        summary: "요약 본문",
        tokensBefore: 120_000,
        tokensAfter: 30_000,
        reason: "threshold",
      },
    });
  });

  test("an old record without tokensAfter or reason keeps both as null", () => {
    const { tokensAfter: _a, reason: _r, ...old } = payloadOf();
    expect(decodeDurable(wire(9, old))).toMatchObject({
      type: "thread.compacted",
      compaction: { summary: "요약 본문", tokensBefore: 120_000, tokensAfter: null, reason: null },
    });
  });

  test("a payload that does not match the schema is unreadable", () => {
    expect(decodeDurable(wire(9, { summary: 7 })).type).toBe("unreadable");
  });
});

describe("thread.compacted: mirror", () => {
  test("records keep the arrival order and each thread keeps its own", () => {
    const state = run([
      compacted(1, { summary: "첫째" }),
      compacted(2, { summary: "다른 대화" }, OTHER),
      compacted(3, { summary: "둘째" }),
    ]);
    expect(state.compactions.map((r) => [r.threadId, r.summary])).toEqual([
      [T, "첫째"],
      [OTHER, "다른 대화"],
      [T, "둘째"],
    ]);
    expect(state.compactions[0]).toEqual({
      threadId: T,
      eventId: evt(1),
      at: iso(1000),
      summary: "첫째",
      tokensBefore: 120_000,
      tokensAfter: 30_000,
      reason: "threshold",
    });
  });

  test("a thread keeps at most COMPACTION_CAP records and drops its oldest", () => {
    const facts: DurableFact[] = [compacted(1, {}, OTHER)];
    for (let seq = 2; seq <= COMPACTION_CAP + 2; seq += 1) facts.push(compacted(seq));
    const mine = run(facts).compactions.filter((r) => r.threadId === T);
    expect(mine).toHaveLength(COMPACTION_CAP);
    expect(mine[0]?.eventId).toBe(evt(3));
    expect(mine.at(-1)?.eventId).toBe(evt(COMPACTION_CAP + 2));
    expect(run(facts).compactions.filter((r) => r.threadId === OTHER)).toHaveLength(1);
  });

  test("a compaction that the live stream and the replay both give is kept once", () => {
    const live = run([compacted(5, { summary: "같은 사건" })]);
    const both = replayOf(live, [compacted(5, { summary: "같은 사건" })]);
    expect(both.compactions).toHaveLength(1);
    expect(both.compactions[0]?.summary).toBe("같은 사건");
  });

  test("a head subscription clears the records, and the replay fills them again", () => {
    const state = run([compacted(1)]);
    const reset = reduceMirror(state, {
      type: "subscribed",
      sub: SUB,
      storeId: STORE,
      start: 10,
      live: true,
      from: "head",
    }).state;
    expect(reset.compactions).toEqual([]);
    expect(replayOf(reset, [compacted(1)]).compactions.map((r) => r.eventId)).toEqual([evt(1)]);
  });
});

/** 자리 시험용 요약 기록 한 건. 본문과 토큰 수는 자리와 무관하다 */
function recordAt(n: number, at: string): CompactionRecord {
  return {
    threadId: T,
    eventId: evt(n),
    at,
    summary: `s${n}`,
    tokensBefore: 1,
    tokensAfter: null,
    reason: null,
  };
}

describe("compaction anchors", () => {
  test("a summary sits after the last item whose time is not later than the summary, or at the top", () => {
    const ids = [itm(1), itm(2), itm(3)];
    const stamp = new Map([
      [itm(1), 100],
      [itm(2), 200],
      [itm(3), 300],
    ]);
    const anchors = anchorCompactions(ids, (id) => stamp.get(id), [
      recordAt(3, new Date(400).toISOString()),
      recordAt(1, new Date(50).toISOString()),
      recordAt(2, new Date(250).toISOString()),
      recordAt(4, "not a time"),
    ]);
    expect(anchors.map((a) => [a.record.eventId, a.after])).toEqual([
      [evt(1), null],
      [evt(2), itm(2)],
      [evt(3), itm(3)],
    ]);
  });

  test("the selector anchors the open thread's summaries and keeps the same reference until something changes", () => {
    const transcript: Transcript = {
      status: "ready",
      threadId: T,
      asOfSeq: 0,
      itemIds: [itm(1), itm(2)],
      items: { [itm(1)]: userAt(1, BASE_MS + 100), [itm(2)]: userAt(2, BASE_MS + 300) },
    };
    const state: EngineMirror = {
      ...INITIAL_MIRROR,
      transcript,
      compactions: [
        {
          threadId: T,
          eventId: evt(7),
          at: new Date(BASE_MS + 200).toISOString(),
          summary: "중간 요약",
          tokensBefore: 90_000,
          tokensAfter: 20_000,
          reason: "manual",
        },
      ],
    };
    const first = selectCompactionAnchors(state, T);
    expect(first.map((a) => [a.record.eventId, a.after])).toEqual([[evt(7), itm(1)]]);
    expect(selectCompactionAnchors(state, T)).toBe(first);
    expect(selectCompactionAnchors(state, OTHER)).toEqual([]);
  });
});
