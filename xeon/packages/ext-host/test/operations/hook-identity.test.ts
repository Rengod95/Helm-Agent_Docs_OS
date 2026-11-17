import { expect, test } from "bun:test";
import { hostOf, traceReadOf } from "../../src/primitives/index.ts";
import { flushMicrotasks } from "../../src/testing/index.ts";
import { makeUnit } from "../primitives/fixtures/support.ts";
import { createOperationsHarness } from "./support/harness.ts";

// 턴 기록 정본 `turn-record-metrics.md` §4.2 규칙 12·14·16의 원천. 디스패처가 등록 항목에서 출처를, 핸들러가 낸 값에서 결정을,
// `awaitUser` 대기 계측에서 물음을 항목에 싣는지 실제 디스패치로 값을 비교한다.

const toolCall = { toolCallId: "call_1", toolName: "read", input: { path: "a" } };

/** 가짜 시계로 ms 뒤에 끝나는 약속 */
function after(timers: { setTimer: (ms: number, fn: () => void) => () => void }, ms: number) {
  return new Promise<void>((resolve) => {
    timers.setTimer(ms, resolve);
  });
}

test("trace identity: a plugin's entry names its registration's plugin, a null version, and its source kind", async () => {
  const { t } = await createOperationsHarness();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const turn = t.ids.next("trn");
  const step = t.ids.next("stp");
  await t.host.install(
    makeUnit({ name: "acme-hooks", hooks: ["tool.call.before"], builtin: false }, (g) => {
      g.on("tool.call.before", () => undefined);
    }),
  );
  await t.host.install(
    makeUnit({ name: "core-hooks", hooks: ["tool.call.before"], builtin: true }, (g) => {
      g.on("tool.call.before", () => undefined);
    }),
  );
  await t.host.dispatch(
    "boundary.settle.after",
    { turnId: turn, aborted: false },
    { threadId: thread, dispatchKey: `${turn}:boundary.settle.after` },
  );
  await t.host.dispatch("tool.call.before", toolCall, {
    threadId: thread,
    dispatchKey: `${step}:tool.call.before:call_1`,
  });

  const entry = traceReadOf(t.host)
    .turn(thread, turn)
    ?.entries.find((item) => item.hook === "tool.call.before");
  const handlers = entry?.handlers ?? [];
  expect(handlers.find((handler) => handler.registrationId === "acme-hooks")).toEqual({
    registrationId: "acme-hooks",
    ms: 0,
    result: "passed",
    atMs: 0,
    size: 0,
    skippedBy: null,
    reason: null,
    toolCallId: "call_1",
    plugin: "acme-hooks",
    versionId: null,
    sourceKind: "plugin",
    decision: "none",
  });
  expect(handlers.find((handler) => handler.registrationId === "core-hooks")).toEqual({
    registrationId: "core-hooks",
    ms: 0,
    result: "passed",
    atMs: 0,
    size: 0,
    skippedBy: null,
    reason: null,
    toolCallId: "call_1",
    plugin: "core-hooks",
    versionId: null,
    sourceKind: "builtin",
    decision: "none",
  });
});

test("trace decision: a tool.call.before ask is recorded as passed with decision ask and a decision-sourced ask", async () => {
  const { t } = await createOperationsHarness();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const turn = t.ids.next("trn");
  const step = t.ids.next("stp");
  await t.host.install(
    makeUnit({ name: "asker", hooks: ["tool.call.before"] }, (g) => {
      g.on("tool.call.before", () => ({ ask: true, reason: "confirm" }));
    }),
  );
  await t.host.dispatch(
    "boundary.settle.after",
    { turnId: turn, aborted: false },
    { threadId: thread, dispatchKey: `${turn}:boundary.settle.after` },
  );
  await t.host.dispatch("tool.call.before", toolCall, {
    threadId: thread,
    dispatchKey: `${step}:tool.call.before:call_1`,
  });

  const handlers = traceReadOf(t.host)
    .turn(thread, turn)
    ?.entries.find((item) => item.hook === "tool.call.before")?.handlers;
  expect(handlers).toEqual([
    {
      registrationId: "asker",
      ms: 0,
      result: "passed",
      atMs: 0,
      size: 0,
      skippedBy: null,
      reason: null,
      toolCallId: "call_1",
      plugin: "asker",
      versionId: null,
      sourceKind: "builtin",
      decision: "ask",
      ask: { via: "decision", waits: 0, waitMs: 0, approvalId: null, answer: null },
    },
  ]);
});

test("trace decision: a tool.call.before replace is recorded as passed with decision replace and no ask", async () => {
  const { t } = await createOperationsHarness();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const turn = t.ids.next("trn");
  const step = t.ids.next("stp");
  await t.host.install(
    makeUnit({ name: "replacer", hooks: ["tool.call.before"] }, (g) => {
      g.on("tool.call.before", () => ({
        replace: { content: [{ type: "text", text: "cached" }] },
        reason: "cache",
      }));
    }),
  );
  await t.host.dispatch(
    "boundary.settle.after",
    { turnId: turn, aborted: false },
    { threadId: thread, dispatchKey: `${turn}:boundary.settle.after` },
  );
  await t.host.dispatch("tool.call.before", toolCall, {
    threadId: thread,
    dispatchKey: `${step}:tool.call.before:call_1`,
  });

  const handlers = traceReadOf(t.host)
    .turn(thread, turn)
    ?.entries.find((item) => item.hook === "tool.call.before")?.handlers;
  expect(handlers).toEqual([
    {
      registrationId: "replacer",
      ms: 0,
      result: "passed",
      atMs: 0,
      size: 0,
      skippedBy: null,
      reason: null,
      toolCallId: "call_1",
      plugin: "replacer",
      versionId: null,
      sourceKind: "builtin",
      decision: "replace",
    },
  ]);
});

test("trace decision: a tool.call.before block is recorded as blocked with decision block", async () => {
  const { t } = await createOperationsHarness();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const turn = t.ids.next("trn");
  const step = t.ids.next("stp");
  await t.host.install(
    makeUnit({ name: "blocker", hooks: ["tool.call.before"] }, (g) => {
      g.on("tool.call.before", () => ({ block: true, reason: "no", terminate: false }));
    }),
  );
  await t.host.dispatch(
    "boundary.settle.after",
    { turnId: turn, aborted: false },
    { threadId: thread, dispatchKey: `${turn}:boundary.settle.after` },
  );
  await t.host.dispatch("tool.call.before", toolCall, {
    threadId: thread,
    dispatchKey: `${step}:tool.call.before:call_1`,
  });

  const handlers = traceReadOf(t.host)
    .turn(thread, turn)
    ?.entries.find((item) => item.hook === "tool.call.before")?.handlers;
  expect(handlers).toEqual([
    {
      registrationId: "blocker",
      ms: 0,
      result: "blocked",
      atMs: 0,
      size: 0,
      skippedBy: null,
      reason: null,
      toolCallId: "call_1",
      plugin: "blocker",
      versionId: null,
      sourceKind: "builtin",
      decision: "block",
    },
  ]);
});

test("trace awaitUser: the waits and waitMs of a handler's user wait are counted, and ms leaves the wait out", async () => {
  const { t } = await createOperationsHarness();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const turn = t.ids.next("trn");
  const step = t.ids.next("stp");
  await t.host.install(
    makeUnit({ name: "waiter", hooks: ["tool.call.before"], builtin: false }, (g) => {
      g.on("tool.call.before", async () => {
        // 5ms는 활성 시간이다. 그 뒤 사람을 3000ms 기다리는데, 이 시간은 ms에서 빠진다
        await after(t.timers, 5);
        await hostOf(g).awaitUser(() => after(t.timers, 3000));
        return undefined;
      });
    }),
  );
  await t.host.dispatch(
    "boundary.settle.after",
    { turnId: turn, aborted: false },
    { threadId: thread, dispatchKey: `${turn}:boundary.settle.after` },
  );
  const dispatched = t.host.dispatch("tool.call.before", toolCall, {
    threadId: thread,
    dispatchKey: `${step}:tool.call.before:call_1`,
  });
  await flushMicrotasks();
  await t.timers.advance(5);
  await flushMicrotasks();
  await t.timers.advance(3000);
  await dispatched;

  const handlers = traceReadOf(t.host)
    .turn(thread, turn)
    ?.entries.find((item) => item.hook === "tool.call.before")?.handlers;
  expect(handlers).toEqual([
    {
      registrationId: "waiter",
      ms: 5,
      result: "passed",
      atMs: 0,
      size: 0,
      skippedBy: null,
      reason: null,
      toolCallId: "call_1",
      plugin: "waiter",
      versionId: null,
      sourceKind: "plugin",
      decision: "none",
      ask: { via: "awaitUser", waits: 1, waitMs: 3000, approvalId: null, answer: null },
    },
  ]);
});
