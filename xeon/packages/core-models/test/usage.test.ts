import { describe, expect, test } from "bun:test";
import type { Usage } from "@xeon/contracts/conversation";
import type { UsageRecord } from "@xeon/contracts/services";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { createUsageMeter } from "../src/usage.ts";

const ids = fixedIdFactory();
const THREAD = ids.next("thr");
const OTHER_THREAD = ids.next("thr");
const TURN = ids.next("trn");

function usage(partial: Partial<Usage> = {}): Usage {
  return {
    input: 10,
    output: 5,
    cacheRead: 2,
    cacheWrite: 1,
    totalTokens: 18,
    cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
    ...partial,
  };
}

function record(partial: Partial<UsageRecord> = {}): UsageRecord {
  return {
    threadId: THREAD,
    turnId: null,
    stepId: null,
    role: "main",
    scopeId: null,
    provider: "tape",
    modelId: "tape-1",
    usage: usage(),
    stopReason: "stop",
    aborted: false,
    recordedAt: 0,
    ...partial,
  };
}

describe("createUsageMeter", () => {
  test("an empty scope has zero totals", () => {
    expect(createUsageMeter().totals({ threadId: THREAD })).toEqual({
      calls: 0,
      abortedCalls: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      totalTokens: 0,
      costTotal: 0,
    });
  });

  test("sums records, counts aborted calls, and adds reasoning only for providers that report it", () => {
    const meter = createUsageMeter();
    meter.record(record());
    meter.record(record({ usage: usage({ reasoning: 4 }), aborted: true, stopReason: "aborted" }));
    expect(meter.totals({ threadId: THREAD })).toMatchObject({
      calls: 2,
      abortedCalls: 1,
      input: 20,
      output: 10,
      cacheRead: 4,
      cacheWrite: 2,
      reasoning: 4,
      totalTokens: 36,
    });
    expect(meter.totals({ threadId: THREAD }).costTotal).toBeCloseTo(0.06, 9);
  });

  test("scopes filter by thread, turn, role and scope id", () => {
    const meter = createUsageMeter();
    meter.record(record({ turnId: TURN, role: "review", scopeId: "helm" }));
    meter.record(record({ role: "main" }));
    meter.record(record({ threadId: OTHER_THREAD }));
    expect(meter.totals({ threadId: THREAD }).calls).toBe(2);
    expect(meter.totals({ threadId: THREAD, turnId: TURN }).calls).toBe(1);
    expect(meter.totals({ threadId: THREAD, role: "review" }).calls).toBe(1);
    expect(meter.totals({ threadId: THREAD, scopeId: "helm" }).calls).toBe(1);
    expect(meter.totals({ threadId: THREAD, role: "review", scopeId: "other" }).calls).toBe(0);
    expect(meter.totals({ threadId: OTHER_THREAD }).calls).toBe(1);
  });

  test("subscribers see every record until they unsubscribe; a throwing subscriber does not stop others", () => {
    const warnings: string[] = [];
    const meter = createUsageMeter({
      debug() {},
      info() {},
      error() {},
      child() {
        return this;
      },
      warn(event) {
        warnings.push(event);
      },
    });
    const seen: number[] = [];
    meter.subscribe(() => {
      throw new Error("listener bug");
    });
    const unsubscribe = meter.subscribe((entry) => {
      seen.push(entry.usage.input);
    });
    meter.record(record());
    unsubscribe();
    meter.record(record());
    expect(seen).toEqual([10]);
    expect(warnings).toEqual(["usage.listener_failed", "usage.listener_failed"]);
    expect(meter.totals({ threadId: THREAD }).calls).toBe(2);
  });
});
