import { expect, test } from "bun:test";
import {
  createFailureLedger,
  fromHandlerFailure,
  type HandlerOutcomeRecord,
} from "../../src/operations/index.ts";
import type { HandlerFailure } from "../../src/primitives/index.ts";

const owner = { type: "extension", name: "fail-ext", scopeId: "fail-ext" } as const;

function outcome(result: HandlerOutcomeRecord["result"]): HandlerOutcomeRecord {
  return { owner, tier: "user", point: "tool_call", fold: "first", result, activeMs: 1, at: 1 };
}

test("failure: classification table", () => {
  const ledger = createFailureLedger({ windowSize: 4 });
  const key = "ext:fail-ext";
  expect(ledger.record(outcome("ok")).consecutive).toBe(0);
  expect(ledger.record(outcome("threw")).consecutive).toBe(1);
  expect(ledger.record(outcome("timeout")).consecutive).toBe(2);
  expect(ledger.record(outcome("result_invalid")).consecutive).toBe(3);
  // aborted와 value_from_tap은 세지 않는다
  expect(ledger.record(outcome("aborted")).consecutive).toBe(3);
  expect(ledger.record(outcome("value_from_tap")).consecutive).toBe(3);
  expect(ledger.stats(key)).toMatchObject({
    windowCalls: 4,
    windowFailures: 3,
    totalCalls: 4,
    totalFailures: 3,
  });
  // ok가 오면 연속 수가 0으로 돌아가고 창은 최근 4번만 센다
  expect(ledger.record(outcome("ok")).consecutive).toBe(0);
  expect(ledger.stats(key)).toMatchObject({ windowCalls: 4, windowFailures: 3 });
  expect(ledger.record(outcome("merge_rejected")).consecutive).toBe(1);
  expect(ledger.stats(key).lastFailure?.result).toBe("merge_rejected");
  expect([...ledger.snapshot().keys()]).toEqual([key]);
  ledger.reset(key);
  expect(ledger.stats(key)).toMatchObject({ consecutive: 0, totalCalls: 0 });
});

test("failure: window size follows the live setting", () => {
  const options = { windowSize: 2 };
  const ledger = createFailureLedger(options);
  ledger.record(outcome("threw"));
  ledger.record(outcome("threw"));
  ledger.record(outcome("threw"));
  expect(ledger.stats("ext:fail-ext").windowCalls).toBe(2);
  options.windowSize = 3;
  ledger.record(outcome("threw"));
  ledger.record(outcome("ok"));
  expect(ledger.stats("ext:fail-ext").windowCalls).toBe(3);
});

test("failure: fromHandlerFailure keeps the owner, fold and a bounded message", () => {
  const failure: HandlerFailure = {
    point: "message_end",
    handler: { scopeId: "fail-ext/sub", extension: "fail-ext", seq: 3 },
    reason: "merge_rejected",
    error: new Error("x".repeat(900)),
    elapsedMs: 7,
  };
  const record = fromHandlerFailure(failure, "builtin", 42);
  expect(record).toMatchObject({
    owner: { type: "extension", name: "fail-ext", scopeId: "fail-ext/sub" },
    tier: "builtin",
    fold: "chain",
    result: "merge_rejected",
    activeMs: 7,
    at: 42,
  });
  expect(record.message?.length).toBe(500);
  const timedOut: HandlerFailure = {
    point: failure.point,
    handler: failure.handler,
    reason: "timeout",
    elapsedMs: 1,
  };
  expect(fromHandlerFailure(timedOut, "user", 1).message).toBeUndefined();
});
