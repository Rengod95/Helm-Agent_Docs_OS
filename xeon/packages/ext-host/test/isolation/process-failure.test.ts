import { expect, test } from "bun:test";
import { FIRST_DENY } from "@fresnel/contracts/extensions";
import { PluginProcessError } from "../../src/isolation/errors.ts";
import { createFailureLedger, fromHandlerFailure } from "../../src/operations/index.ts";
import { traceReadOf } from "../../src/primitives/index.ts";
import type { HandlerFailure } from "../../src/primitives/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { makeUnit, userText } from "../primitives/fixtures/support.ts";
import { createOperationsHarness } from "../operations/support/harness.ts";

// 격리 프로세스가 끝나서 실패한 핸들러(`PluginProcessError`)는 실패 이유로 `process_exit`·`process_killed`를 싣는다.
// 막는 훅은 막음으로 대체하고, 고치는 훅은 건너뛰며, 기록과 장부에도 그 이유가 남는다.

const toolCall = { toolCallId: "call_1", toolName: "read", input: { path: "a" } };
const reasons = ["process_exit", "process_killed"] as const;

test.each(reasons)(
  "a blocking hook whose handler failed with %s substitutes the block and records the reason",
  async (reason) => {
    const t = await createTestHost();
    const thread = t.newThread();
    await t.host.openThread(thread);
    const ran: string[] = [];
    await t.host.install(
      makeUnit({ name: "proc-a", hooks: ["tool.call.before"], loadIndex: 0 }, (g) => {
        g.on("tool.call.before", () => {
          ran.push("a");
          throw new PluginProcessError(reason, "the plugin host stopped");
        });
      }),
    );
    await t.host.install(
      makeUnit({ name: "proc-b", hooks: ["tool.call.before"], loadIndex: 1 }, (g) => {
        g.on("tool.call.before", () => {
          ran.push("b");
          return undefined;
        });
      }),
    );
    const outcome = await t.host.dispatch("tool.call.before", toolCall, {
      threadId: thread,
      dispatchKey: "k",
    });
    expect(outcome.decision).toEqual(FIRST_DENY["tool.call.before"]);
    expect(outcome.substituted).toBe(true);
    expect(outcome.failures.map((failure) => failure.reason)).toEqual([reason]);
    expect(outcome.failures[0]?.error).toBeInstanceOf(PluginProcessError);
    expect(ran).toEqual(["a"]);
  },
);

test.each(reasons)(
  "a modifying hook whose handler failed with %s is skipped and the chain goes on",
  async (reason) => {
    const t = await createTestHost({ strict: true });
    const thread = t.newThread();
    await t.host.openThread(thread);
    await t.host.install(
      makeUnit({ name: "proc-c", hooks: ["boundary.message.after"], loadIndex: 0 }, (g) => {
        g.on("boundary.message.after", () => {
          throw new PluginProcessError(reason, "the plugin host exited");
        });
      }),
    );
    await t.host.install(
      makeUnit({ name: "proc-d", hooks: ["boundary.message.after"], loadIndex: 1 }, (g) => {
        g.on("boundary.message.after", () => ({ message: { ...userText, content: "edited" } }));
      }),
    );
    const outcome = await t.host.dispatch(
      "boundary.message.after",
      { message: userText },
      { threadId: thread, dispatchKey: "k", initial: { message: userText } },
    );
    expect(outcome.failures.map((failure) => failure.reason)).toEqual([reason]);
    expect(outcome.applied.map((ref) => ref.extension)).toEqual(["proc-d"]);
    expect(outcome.value).toEqual({ message: { ...userText, content: "edited" } });
  },
);

test("the trace entry of a handler that failed by its process records the reason", async () => {
  const { t } = await createOperationsHarness();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const turn = t.ids.next("trn");
  const step = t.ids.next("stp");
  await t.host.install(
    makeUnit({ name: "proc-t", hooks: ["tool.call.before"] }, (g) => {
      g.on("tool.call.before", () => {
        throw new PluginProcessError("process_killed", "stopped by the engine");
      });
    }),
  );
  // Turn의 첫 디스패치가 Turn 시작이다
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
  expect(entry?.handlers).toMatchObject([
    { registrationId: "proc-t", result: "failed", reason: "process_killed", skippedBy: null },
  ]);
});

test("the failure ledger counts a process failure as a failure of that extension", () => {
  const ledger = createFailureLedger({ windowSize: 4 });
  const failure: HandlerFailure = {
    point: "tool.call.before",
    handler: { scopeId: "proc-l", extension: "proc-l", seq: 1 },
    reason: "process_exit",
    elapsedMs: 5,
  };
  const stats = ledger.record(fromHandlerFailure(failure, "builtin", 100));
  expect(stats).toMatchObject({ consecutive: 1, windowFailures: 1, totalFailures: 1 });
  expect(stats.lastFailure).toMatchObject({ result: "process_exit", point: "tool.call.before" });
});
