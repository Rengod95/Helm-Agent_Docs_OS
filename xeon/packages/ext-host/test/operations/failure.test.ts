import { expect, test } from "bun:test";
import {
  createFailureLedger,
  fromHandlerFailure,
  fromMethodSettled,
  type HandlerOutcomeRecord,
} from "../../src/operations/index.ts";
import type { ExtMethodSettled, HandlerFailure } from "../../src/primitives/index.ts";

const owner = { type: "extension", name: "fail-ext", scopeId: "fail-ext" } as const;

function outcome(result: HandlerOutcomeRecord["result"]): HandlerOutcomeRecord {
  return {
    owner,
    tier: "user",
    point: "tool.call.before",
    fold: "first",
    failure: "closed",
    result,
    activeMs: 1,
    at: 1,
  };
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
    point: "boundary.message.after",
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

const failureAt = (point: HandlerFailure["point"]): HandlerFailure => ({
  point,
  handler: { scopeId: "fail-ext", extension: "fail-ext", seq: 1 },
  reason: "threw",
  elapsedMs: 1,
});

const policyOf = (point: HandlerFailure["point"]) =>
  fromHandlerFailure(failureAt(point), "user", 1).failure;

test("failure: records read the failure policy of the point declaration", () => {
  expect(policyOf("tool.call.before")).toBe("closed");
  expect(policyOf("guard.output.before")).toBe("closed");
  expect(policyOf("thread.compact.before")).toBe("open");
  expect(policyOf("thread.resources")).toBe("open");
  expect(policyOf("lifecycle.agent.settled")).toBe("open");
  expect(policyOf("tool.result")).toBe("skip");
});

function settledOf(outcome: ExtMethodSettled["outcome"], message?: string): ExtMethodSettled {
  return {
    extension: "fail-ext",
    scopeId: "fail-ext",
    verb: "sum",
    outcome,
    activeMs: 1,
    ...(message === undefined ? {} : { message }),
  };
}

test("failure: a method record keeps the thrown message and has no fold or failure policy", () => {
  expect(fromMethodSettled(settledOf("threw", "boom"), "user", 5)).toEqual({
    owner: { type: "extension", name: "fail-ext", scopeId: "fail-ext" },
    tier: "user",
    point: "ext.method",
    verb: "sum",
    result: "threw",
    activeMs: 1,
    at: 5,
    message: "boom",
  });
  const timedOut = fromMethodSettled(settledOf("timeout"), "user", 5);
  expect(timedOut?.fold).toBeUndefined();
  expect(timedOut?.failure).toBeUndefined();
  expect(timedOut?.message).toBeUndefined();
  // 호출한 쪽의 잘못과 취소는 장부 기록이 없다
  expect(fromMethodSettled(settledOf("params_invalid"), "user", 5)).toBeUndefined();
  expect(fromMethodSettled(settledOf("aborted"), "user", 5)).toBeUndefined();
});

test("failure: method outcomes are the extension's calls; params_invalid and aborted are not counted", () => {
  const ledger = createFailureLedger({ windowSize: 10 });
  const key = "ext:fail-ext";
  const record = (outcome: ExtMethodSettled["outcome"], message?: string) => {
    const found = fromMethodSettled(settledOf(outcome, message), "user", 5);
    if (found !== undefined) ledger.record(found);
    return ledger.stats(key);
  };
  expect(record("ok")).toMatchObject({ consecutive: 0, totalCalls: 1, totalFailures: 0 });
  expect(record("threw", "boom")).toMatchObject({
    consecutive: 1,
    totalCalls: 2,
    totalFailures: 1,
  });
  expect(record("timeout")).toMatchObject({ consecutive: 2, totalCalls: 3, totalFailures: 2 });
  expect(record("result_invalid")).toMatchObject({
    consecutive: 3,
    totalCalls: 4,
    totalFailures: 3,
    windowCalls: 4,
    windowFailures: 3,
  });
  expect(record("params_invalid")).toMatchObject({
    consecutive: 3,
    totalCalls: 4,
    totalFailures: 3,
    windowCalls: 4,
    windowFailures: 3,
  });
  expect(record("aborted")).toMatchObject({
    consecutive: 3,
    totalCalls: 4,
    totalFailures: 3,
    windowCalls: 4,
    windowFailures: 3,
  });
  expect(record("ok")).toMatchObject({
    consecutive: 0,
    totalCalls: 5,
    totalFailures: 3,
    windowCalls: 5,
    windowFailures: 3,
  });
  // 마지막 실패는 result_invalid 기록이다. 훅 실패와 같은 키 ext:<이름>에 든다
  expect(ledger.stats(key).lastFailure).toEqual({
    owner: { type: "extension", name: "fail-ext", scopeId: "fail-ext" },
    tier: "user",
    point: "ext.method",
    verb: "sum",
    result: "result_invalid",
    activeMs: 1,
    at: 5,
  });
});

test("failure: windowStartedAt is the time of the oldest call still in the window", () => {
  const ledger = createFailureLedger({ windowSize: 2 });
  const key = "ext:fail-ext";
  expect(ledger.stats(key).windowStartedAt).toBeUndefined();
  for (const at of [100, 250, 400]) ledger.record({ ...outcome("threw"), at });
  // 창은 최근 2번(250, 400)이라 100은 밀려났다
  expect(ledger.stats(key)).toMatchObject({ windowCalls: 2, windowStartedAt: 250 });
  ledger.reset(key);
  expect(ledger.stats(key).windowStartedAt).toBeUndefined();
});
