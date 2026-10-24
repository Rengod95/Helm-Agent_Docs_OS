import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import { EventIdSchema, ThreadIdSchema, TurnIdSchema } from "../../src/conversation/index.ts";
import type { ThreadSummaryRow } from "../../src/records/index.ts";
import {
  WIRE_METHODS,
  ThreadSummarySchema,
  threadSummaryOf,
} from "../../src/wire-settings/wire/index.ts";
import { must, rawId } from "../helpers/ids.ts";

const THREAD = must(ThreadIdSchema, rawId("thr", 1));

function row(patch: Partial<ThreadSummaryRow> = {}): ThreadSummaryRow {
  return {
    threadId: THREAD,
    title: "hello",
    status: "idle",
    workspace: "/work/app",
    createdAt: Date.UTC(2026, 9, 23, 1, 0, 0),
    updatedAt: Date.UTC(2026, 9, 23, 1, 5, 0, 250),
    headSeq: 42,
    forkedFrom: null,
    marker: null,
    queuedInputs: 1,
    pendingApprovals: 2,
    ...patch,
  };
}

describe("threadSummaryOf", () => {
  test("turns epoch ms into ISO time and keeps the other fields", () => {
    const result = threadSummaryOf(row());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      threadId: THREAD,
      title: "hello",
      status: "idle",
      workspace: "/work/app",
      createdAt: "2026-10-23T01:00:00.000Z",
      updatedAt: "2026-10-23T01:05:00.250Z",
      headSeq: 42,
      forkedFrom: null,
      resumable: null,
      queuedInputs: 1,
      pendingApprovals: 2,
    });
  });

  test("the result passes the wire schema, including forks and a recovery marker", () => {
    const marked = row({
      status: "running",
      forkedFrom: {
        threadId: must(ThreadIdSchema, rawId("thr", 2)),
        eventId: must(EventIdSchema, rawId("evt", 3)),
      },
      marker: {
        turnId: must(TurnIdSchema, rawId("trn", 1)),
        runningSince: Date.UTC(2026, 9, 23, 1, 4, 0),
        resumeAttempts: 2,
      },
      title: null,
      workspace: null,
    });
    const result = threadSummaryOf(marked);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.resumable).toEqual({
      turnId: must(TurnIdSchema, rawId("trn", 1)),
      runningSince: "2026-10-23T01:04:00.000Z",
      resumeAttempts: 2,
    });
    expect(parse(ThreadSummarySchema, result.value).ok).toBe(true);
    expect(
      parse(WIRE_METHODS["thread.list"].result, { threads: [result.value], nextCursor: null }).ok,
    ).toBe(true);
  });

  test("a time outside the Date range is an error value naming the field", () => {
    expect(threadSummaryOf(row({ createdAt: 9e15 }))).toEqual({
      ok: false,
      error: { kind: "invalid_time", field: "createdAt" },
    });
    expect(threadSummaryOf(row({ updatedAt: Number.NaN }))).toEqual({
      ok: false,
      error: { kind: "invalid_time", field: "updatedAt" },
    });
    const badMarker = row({
      marker: {
        turnId: must(TurnIdSchema, rawId("trn", 1)),
        runningSince: -9e15,
        resumeAttempts: 0,
      },
    });
    expect(threadSummaryOf(badMarker)).toEqual({
      ok: false,
      error: { kind: "invalid_time", field: "resumable.runningSince" },
    });
  });
});
