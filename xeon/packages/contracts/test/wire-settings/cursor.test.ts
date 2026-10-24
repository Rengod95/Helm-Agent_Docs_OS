import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  EventFilterSchema,
  EventsSubscribeParamsSchema,
  EventsSubscribeResultSchema,
  StoreIdSchema,
  StreamPositionSchema,
  SubIdSchema,
  SubscribeFromSchema,
  WIRE_ERRORS,
  findBatchIssue,
  type EventWire,
} from "../../src/wire-settings/wire/index.ts";
import { EventIdSchema, ThreadIdSchema } from "../../src/conversation/index.ts";
import { must, rawId } from "../helpers/ids.ts";

const STORE = "sto_01ARZ3NDEKTSV4RRFFQ69G5FAV";

describe("cursor", () => {
  test("store id has the sto prefix and a ULID", () => {
    expect(parse(StoreIdSchema, STORE).ok).toBe(true);
    for (const bad of [
      "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      "sto_01ARZ3NDEKTSV4RRFFQ69G5FA",
      "sto_81ARZ3NDEKTSV4RRFFQ69G5FAV",
      "sto_01arz3ndektsv4rrffq69g5fav",
    ]) {
      expect(parse(StoreIdSchema, bad).ok).toBe(false);
    }
  });

  test("position requires storeId and seq", () => {
    expect(parse(StreamPositionSchema, { storeId: STORE, seq: 0 }).ok).toBe(true);
    expect(parse(StreamPositionSchema, { storeId: STORE }).ok).toBe(false);
    expect(parse(StreamPositionSchema, { seq: 1 }).ok).toBe(false);
    expect(parse(StreamPositionSchema, { storeId: STORE, seq: -1 }).ok).toBe(false);
    expect(parse(StreamPositionSchema, { storeId: STORE, seq: 1.5 }).ok).toBe(false);
    expect(parse(StreamPositionSchema, { storeId: STORE, seq: 1, extra: 1 }).ok).toBe(false);
  });

  test("head literal", () => {
    expect(parse(SubscribeFromSchema, "head").ok).toBe(true);
    expect(parse(SubscribeFromSchema, "HEAD").ok).toBe(false);
    expect(parse(SubscribeFromSchema, { storeId: STORE, seq: 3 }).ok).toBe(true);
    expect(parse(EventsSubscribeParamsSchema, { from: "head" }).ok).toBe(true);
    expect(parse(EventsSubscribeParamsSchema, {}).ok).toBe(false);
  });

  test("sub id", () => {
    expect(parse(SubIdSchema, "s1").ok).toBe(true);
    for (const bad of ["", "s-1", "x".repeat(17)]) expect(parse(SubIdSchema, bad).ok).toBe(false);
  });

  test("filter", () => {
    const filter = {
      threadIds: [rawId("thr", 1)],
      kindPrefixes: ["item.", "x.web-exa."],
      excludeKindPrefixes: ["part."],
    };
    expect(parse(EventFilterSchema, filter).ok).toBe(true);
    expect(parse(EventFilterSchema, { kindPrefixes: [""] }).ok).toBe(false);
    expect(parse(EventFilterSchema, { threadIds: ["thr_x"] }).ok).toBe(false);
  });

  test("subscribe result", () => {
    const result = { sub: "s1", start: 0, headSeq: 5, storeId: STORE, mode: "replaying" };
    expect(parse(EventsSubscribeResultSchema, result).ok).toBe(true);
    expect(parse(EventsSubscribeResultSchema, { ...result, mode: "later" }).ok).toBe(false);
  });
});

function event(seq: number): EventWire {
  return {
    id: must(EventIdSchema, rawId("evt", seq)),
    kind: "thread.started",
    version: 1,
    durable: true,
    seq,
    parentId: null,
    threadId: must(ThreadIdSchema, rawId("thr", 1)),
    turnId: null,
    stepId: null,
    recordedAt: "2026-10-21T00:00:00.000Z",
    causationId: null,
    correlationId: null,
    payload: {},
    redactions: [],
  };
}

describe("findBatchIssue", () => {
  test("batch interval invariant helper accepts a contiguous column", () => {
    const batches = [
      { from: 0, to: 3, events: [event(1), event(3)] },
      { from: 3, to: 7, events: [] },
      { from: 7, to: 9, events: [event(8), event(9)] },
    ];
    expect(findBatchIssue(0, batches)).toBeUndefined();
    expect(findBatchIssue(0, [])).toBeUndefined();
  });

  test("finds a gap and an overlap", () => {
    expect(
      findBatchIssue(0, [
        { from: 0, to: 3, events: [] },
        { from: 4, to: 6, events: [] },
      ]),
    ).toEqual({ kind: "gap", index: 1, expectedFrom: 3, from: 4 });
    expect(
      findBatchIssue(0, [
        { from: 0, to: 3, events: [] },
        { from: 2, to: 6, events: [] },
      ]),
    ).toEqual({ kind: "gap", index: 1, expectedFrom: 3, from: 2 });
    expect(findBatchIssue(5, [{ from: 0, to: 3, events: [] }])).toEqual({
      kind: "gap",
      index: 0,
      expectedFrom: 5,
      from: 0,
    });
  });

  test("finds events outside their interval, unordered events and backwards intervals", () => {
    expect(findBatchIssue(0, [{ from: 0, to: 3, events: [event(4)] }])).toEqual({
      kind: "outOfInterval",
      index: 0,
      seq: 4,
    });
    expect(findBatchIssue(1, [{ from: 1, to: 3, events: [event(1)] }])).toEqual({
      kind: "outOfInterval",
      index: 0,
      seq: 1,
    });
    expect(findBatchIssue(0, [{ from: 0, to: 3, events: [event(3), event(2)] }])).toEqual({
      kind: "unordered",
      index: 0,
    });
    expect(findBatchIssue(0, [{ from: 0, to: 3, events: [event(2), event(2)] }])).toEqual({
      kind: "unordered",
      index: 0,
    });
    expect(findBatchIssue(3, [{ from: 3, to: 1, events: [] }])).toEqual({
      kind: "backwards",
      index: 0,
      from: 3,
      to: 1,
    });
  });

  test("replay boundary cases name the error in the table", () => {
    const outOfRange = WIRE_ERRORS["replay.outOfRange"];
    expect(outOfRange.code).toBe(2001);
    for (const reason of ["storeMismatch", "aheadOfHead", "beforeOldest", "tooFar"]) {
      const details = {
        reason,
        storeId: STORE,
        headSeq: 5,
        oldestReplayableSeq: 0,
      };
      if (outOfRange.details === undefined) throw new Error("replay.outOfRange needs details");
      expect({ reason, ok: parse(outOfRange.details, details).ok }).toEqual({ reason, ok: true });
    }
  });
});
