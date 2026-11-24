import { describe, expect, test } from "bun:test";
import type { ExtTestRecord } from "@fresnel/contracts/wire";
import { trialEndedOf } from "../../src/views/trial-ended.ts";

function record(over: Partial<ExtTestRecord>): ExtTestRecord {
  return {
    testId: "tst_1",
    kind: "testRun",
    target: "water",
    state: "running",
    startedAt: "2026-11-24T00:00:00.000Z",
    durationMs: null,
    threadId: "thr_1",
    replay: null,
    ...over,
  };
}

describe("trialEndedOf", () => {
  test("a running record is not ended, a failed or passed one is", () => {
    expect(trialEndedOf([record({})], "thr_1")).toBe(false);
    expect(trialEndedOf([record({ state: "failed" })], "thr_1")).toBe(true);
    expect(trialEndedOf([record({ state: "passed" })], "thr_1")).toBe(true);
  });
  test("other threads, replay records and a missing record do not end it", () => {
    expect(trialEndedOf([record({ state: "failed", threadId: "thr_2" })], "thr_1")).toBe(false);
    expect(trialEndedOf([record({ state: "failed", kind: "replay" })], "thr_1")).toBe(false);
    expect(trialEndedOf([], "thr_1")).toBe(false);
  });
});
