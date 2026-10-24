import { describe, expect, test } from "bun:test";
import type { ShutdownReason } from "@xeon/contracts/services";
import { createProcessShutdown } from "../src/index.ts";
import { flushMicrotasks, manualClock } from "./support/clock.ts";
import { exitRecorder, memoryLogger, rejectionOf } from "./support/fakes.ts";

function setup(timeoutMs = 3000) {
  const clock = manualClock();
  const exits = exitRecorder();
  const logger = memoryLogger();
  const shutdown = createProcessShutdown({
    timeoutMs,
    clock,
    scheduler: clock,
    exit: (code) => exits.exit(code),
    logger,
  });
  return { clock, exits, logger, shutdown };
}

describe("createProcessShutdown", () => {
  test("starts with an open signal and no reason", () => {
    const { shutdown } = setup();
    expect(shutdown.signal.aborted).toBe(false);
    expect(shutdown.reason).toBeNull();
  });

  test("calls participants in reverse registration order, one at a time", async () => {
    const { shutdown } = setup();
    const events: string[] = [];
    shutdown.onShutdown("first", async () => {
      events.push("first:start");
      await Promise.resolve();
      events.push("first:end");
    });
    shutdown.onShutdown("second", async () => {
      events.push("second:start");
      await Promise.resolve();
      events.push("second:end");
    });
    const outcome = await shutdown.request("shutdown_request");
    expect(events).toEqual(["second:start", "second:end", "first:start", "first:end"]);
    expect(outcome.completed).toBe(true);
  });

  test("aborts the signal and records the reason before participants run", async () => {
    const { shutdown } = setup();
    const seen: { aborted: boolean; reason: ShutdownReason | null; arg: ShutdownReason }[] = [];
    shutdown.onShutdown("probe", (arg) => {
      seen.push({ aborted: shutdown.signal.aborted, reason: shutdown.reason, arg });
      return Promise.resolve();
    });
    await shutdown.request("stdin_eof");
    expect(seen).toEqual([{ aborted: true, reason: "stdin_eof", arg: "stdin_eof" }]);
  });

  test("duplicate shutdown requests share one run", async () => {
    const { shutdown } = setup();
    let calls = 0;
    shutdown.onShutdown("once", () => {
      calls += 1;
      return Promise.resolve();
    });
    const first = shutdown.request("stdin_eof");
    const second = shutdown.request("shutdown_request");
    expect(second).toBe(first);
    await first;
    await shutdown.request("signal");
    expect(calls).toBe(1);
    expect(shutdown.reason).toBe("stdin_eof");
  });

  test("a participant that never finishes forces exit(1) after the timeout", async () => {
    const { clock, exits, shutdown } = setup(3000);
    shutdown.onShutdown("stuck", () => new Promise<void>(() => {}));
    const outcome = shutdown.request("signal");
    await clock.advance(2999);
    expect(exits.codes).toEqual([]);
    const thrown = await rejectionOf(clock.advance(1));
    expect(thrown).toBeInstanceOf(Error);
    if (thrown instanceof Error) expect(thrown.message).toBe("exit(1)");
    expect(exits.codes).toEqual([1]);
    expect(await outcome).toEqual({ completed: false, elapsedMs: 3000 });
  });

  test("finishing inside the deadline cancels the timer and does not exit", async () => {
    const { clock, exits, shutdown } = setup(3000);
    shutdown.onShutdown("quick", () => Promise.resolve());
    const outcome = await shutdown.request("idle");
    expect(outcome).toEqual({ completed: true, elapsedMs: 0 });
    expect(clock.pendingTimers()).toEqual([]);
    await clock.advance(10_000);
    expect(exits.codes).toEqual([]);
  });

  test("a failing participant is logged and the next one still runs", async () => {
    const { logger, shutdown } = setup();
    const events: string[] = [];
    shutdown.onShutdown("last-called", () => {
      events.push("last-called");
      return Promise.resolve();
    });
    shutdown.onShutdown("broken", () => Promise.reject(new Error("boom")));
    const outcome = await shutdown.request("version_replace");
    expect(events).toEqual(["last-called"]);
    expect(outcome.completed).toBe(true);
    const failure = logger.records.find((record) => record.event === "shutdown.participant_failed");
    expect(failure?.fields).toEqual({ name: "broken", error: "boom" });
  });

  test("a participant that throws synchronously is treated the same way", async () => {
    const { shutdown } = setup();
    shutdown.onShutdown("sync-throw", () => {
      throw new Error("sync");
    });
    expect((await shutdown.request("signal")).completed).toBe(true);
  });

  test("an unsubscribed participant is not called", async () => {
    const { shutdown } = setup();
    let called = false;
    const off = shutdown.onShutdown("gone", () => {
      called = true;
      return Promise.resolve();
    });
    off();
    await shutdown.request("signal");
    expect(called).toBe(false);
  });

  test("a participant registered after the request starts is still called", async () => {
    const { shutdown } = setup();
    const slow = Promise.withResolvers<void>();
    shutdown.onShutdown("slow", () => slow.promise);
    const outcome = shutdown.request("idle");
    await flushMicrotasks();
    const late: { reason: ShutdownReason | null } = { reason: null };
    shutdown.onShutdown("late", (reason) => {
      late.reason = reason;
      return Promise.resolve();
    });
    slow.resolve();
    expect((await outcome).completed).toBe(true);
    expect(late.reason).toBe("idle");
  });

  test("rejects a non-positive timeout as a bug", () => {
    const clock = manualClock();
    const exits = exitRecorder();
    expect(() =>
      createProcessShutdown({ timeoutMs: 0, clock, scheduler: clock, exit: (c) => exits.exit(c) }),
    ).toThrow("timeoutMs");
  });
});
