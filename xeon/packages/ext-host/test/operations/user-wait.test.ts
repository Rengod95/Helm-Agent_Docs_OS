import { expect, test } from "bun:test";
import { hostOf } from "../../src/primitives/index.ts";
import { flushMicrotasks } from "../../src/testing/index.ts";
import { makeUnit } from "../primitives/fixtures/support.ts";
import { createOperationsHarness } from "./support/harness.ts";

/** 가짜 시계로 ms 뒤에 끝나는 약속 */
function after(timers: { setTimer: (ms: number, fn: () => void) => () => void }, ms: number) {
  return new Promise<void>((resolve) => {
    timers.setTimer(ms, resolve);
  });
}

async function runHandler(
  wait: "plain" | "user",
  waitMs: number,
): Promise<{ failures: number; finished: boolean; signalAborted: boolean | undefined }> {
  const { t, notices } = await createOperationsHarness({
    settings: { budgets: { tap: 1000 } },
  });
  const thread = t.newThread();
  await t.host.openThread(thread);
  const probe: { finished: boolean; signalAborted: boolean | undefined } = {
    finished: false,
    signalAborted: undefined,
  };
  await t.host.install(
    makeUnit({ name: "uw-ext", points: ["boundary.settle.after"], builtin: false }, (g) => {
      g.on("boundary.settle.after", async () => {
        if (wait === "user") {
          await hostOf(g).awaitUser((signal) => {
            probe.signalAborted = signal.aborted;
            return after(t.timers, waitMs);
          });
        } else {
          await after(t.timers, waitMs);
        }
        probe.finished = true;
      });
    }),
  );
  const dispatched = t.host.dispatch(
    "boundary.settle.after",
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: "k" },
  );
  // 핸들러가 시작해 대기에 들어간 뒤에 시계를 움직인다
  await flushMicrotasks();
  await t.timers.advance(waitMs + 10);
  const outcome = await dispatched;
  return {
    failures: outcome.failures.length + notices.filter((n) => n.startsWith("failed:")).length,
    finished: probe.finished,
    signalAborted: probe.signalAborted,
  };
}

test("awaitUser: time spent waiting for the user is not charged to the handler budget", async () => {
  // 예산 1초, 대기 5초: 사용자 응답 대기로 감싸면 시간 초과가 아니다
  expect(await runHandler("user", 5000)).toEqual({
    failures: 0,
    finished: true,
    signalAborted: false,
  });
});

test("awaitUser: the same wait without the wrapper exceeds the budget", async () => {
  const result = await runHandler("plain", 5000);
  expect(result.failures).toBeGreaterThan(0);
});

test("awaitUser: the wait gets a signal that follows the handler and the caller's own signal", async () => {
  const { t } = await createOperationsHarness();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const seen: boolean[] = [];
  const own = new AbortController();
  await t.host.install(
    makeUnit({ name: "uw-sig", points: ["boundary.settle.after"], builtin: false }, (g) => {
      g.on("boundary.settle.after", async () => {
        await hostOf(g).awaitUser(
          (signal) => {
            seen.push(signal.aborted);
            own.abort();
            seen.push(signal.aborted);
            return Promise.resolve();
          },
          { signal: own.signal },
        );
      });
    }),
  );
  await t.host.dispatch(
    "boundary.settle.after",
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: "k" },
  );
  expect(seen).toEqual([false, true]);
});

test("awaitUser outside a handler just runs the wait", async () => {
  const { t } = await createOperationsHarness();
  const results: string[] = [];
  await t.host.install(
    makeUnit({ name: "uw-setup", builtin: false }, async (g) => {
      results.push(await hostOf(g).awaitUser(() => Promise.resolve("direct")));
    }),
  );
  expect(results).toEqual(["direct"]);
});
