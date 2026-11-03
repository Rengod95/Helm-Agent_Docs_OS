import { expect, test } from "bun:test";
import { traceReadOf } from "../../src/primitives/index.ts";
import { makeUnit } from "../primitives/fixtures/support.ts";
import { createOperationsHarness } from "./support/harness.ts";

// X.operations.spec §4.8.2. 핸들러 결과 다섯(고침·지나감·막음·실패·건너뜀)과 `atMs`·`size`·`skippedBy`·`reason`이
// 실제 디스패치에서 구분되어 기록되는지 값으로 비교한다.

const toolCall = { toolCallId: "call_1", toolName: "read", input: { path: "a" } };

test("trace results: chain records modified, passed, failed and the handlers skipped by a stop", async () => {
  const { t } = await createOperationsHarness();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const turn = t.ids.next("trn");
  const step = t.ids.next("stp");
  await t.host.install(
    makeUnit({ name: "ext-a", hooks: ["input.user.before"] }, (g) => {
      g.on("input.user.before", () => ({ action: "transform", text: "hello" }));
    }),
  );
  await t.host.install(
    makeUnit({ name: "ext-b", hooks: ["input.user.before"] }, (g) => {
      g.on("input.user.before", () => undefined);
    }),
  );
  await t.host.install(
    makeUnit({ name: "ext-c", hooks: ["input.user.before"] }, (g) => {
      g.on("input.user.before", () => {
        throw new Error("boom");
      });
    }),
  );
  await t.host.install(
    makeUnit({ name: "ext-d", hooks: ["input.user.before"] }, (g) => {
      g.on("input.user.before", () => ({ action: "handled" }));
    }),
  );
  await t.host.install(
    makeUnit({ name: "ext-e", hooks: ["input.user.before"] }, (g) => {
      g.on("input.user.before", () => ({ action: "transform", text: "never" }));
    }),
  );
  await t.host.install(
    makeUnit({ name: "ext-f", hooks: ["input.user.before"] }, (g) => {
      g.on("input.user.before", () => undefined);
    }),
  );
  // Turn의 첫 디스패치가 Turn 시작이다
  await t.host.dispatch(
    "boundary.settle.after",
    { turnId: turn, aborted: false },
    { threadId: thread, dispatchKey: `${turn}:boundary.settle.after` },
  );
  await t.timers.advance(40);
  await t.host.dispatch(
    "input.user.before",
    { text: "hi", source: "interactive" },
    {
      threadId: thread,
      dispatchKey: `${step}:input.user.before`,
      initial: { text: "hi", handled: false },
    },
  );

  const result = traceReadOf(t.host).turn(thread, turn);
  const entry = result?.entries.find((item) => item.hook === "input.user.before");
  expect(entry?.handlers).toEqual([
    {
      registrationId: "ext-a",
      ms: 0,
      result: "modified",
      atMs: 40,
      size: JSON.stringify({ action: "transform", text: "hello" }).length,
      skippedBy: null,
      reason: null,
    },
    {
      registrationId: "ext-b",
      ms: 0,
      result: "passed",
      atMs: 40,
      size: 0,
      skippedBy: null,
      reason: null,
    },
    {
      registrationId: "ext-c",
      ms: 0,
      result: "failed",
      atMs: 40,
      size: 0,
      skippedBy: null,
      reason: "threw",
    },
    {
      registrationId: "ext-d",
      ms: 0,
      result: "modified",
      atMs: 40,
      size: JSON.stringify({ action: "handled" }).length,
      skippedBy: null,
      reason: null,
    },
    {
      registrationId: "ext-e",
      ms: 0,
      result: "skipped",
      atMs: 40,
      size: 0,
      skippedBy: "ext-d",
      reason: null,
    },
    {
      registrationId: "ext-f",
      ms: 0,
      result: "skipped",
      atMs: 40,
      size: 0,
      skippedBy: "ext-d",
      reason: null,
    },
  ]);
});

test("trace results: first records passed, blocked and the handler skipped by the block", async () => {
  const { t } = await createOperationsHarness();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const turn = t.ids.next("trn");
  const step = t.ids.next("stp");
  await t.host.install(
    makeUnit({ name: "ext-pass", hooks: ["tool.call.before"] }, (g) => {
      g.on("tool.call.before", () => undefined);
    }),
  );
  await t.host.install(
    makeUnit({ name: "ext-block", hooks: ["tool.call.before"] }, (g) => {
      g.on("tool.call.before", () => ({ block: true, reason: "no" }));
    }),
  );
  await t.host.install(
    makeUnit({ name: "ext-late", hooks: ["tool.call.before"] }, (g) => {
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
  expect(entry?.handlers.map((h) => [h.registrationId, h.result, h.skippedBy, h.size])).toEqual([
    ["ext-pass", "passed", null, 0],
    ["ext-block", "blocked", null, 0],
    ["ext-late", "skipped", "ext-block", 0],
  ]);
});
