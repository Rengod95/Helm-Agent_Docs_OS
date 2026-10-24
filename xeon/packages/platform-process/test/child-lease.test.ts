import { describe, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import type { CloseInfo, Transport } from "@xeon/contracts/wire";
import { createHostShutdownHandler, createProcessShutdown, watchChildLease } from "../src/index.ts";
import { flushMicrotasks, manualClock } from "./support/clock.ts";
import { exitRecorder, memoryLogger, rejectionOf } from "./support/fakes.ts";

function closableTransport(): {
  readonly transport: Pick<Transport, "onClose" | "close">;
  readonly closeWith: (info: CloseInfo) => void;
  readonly closeCalls: string[];
} {
  const handlers = new Set<(info: CloseInfo) => void>();
  const closeCalls: string[] = [];
  return {
    transport: {
      onClose(handler) {
        handlers.add(handler);
        return () => {
          handlers.delete(handler);
        };
      },
      close(reason) {
        closeCalls.push(reason ?? "");
        return Promise.resolve();
      },
    },
    closeWith(info) {
      for (const handler of Array.from(handlers)) handler(info);
    },
    closeCalls,
  };
}

function setup() {
  const clock = manualClock();
  const exits = exitRecorder();
  const logger = memoryLogger();
  const shutdown = createProcessShutdown({
    timeoutMs: 1000,
    clock,
    scheduler: clock,
    exit: (code) => exits.exit(code),
    logger,
  });
  return { clock, exits, logger, shutdown };
}

describe("watchChildLease", () => {
  test("stdin EOF starts the shutdown with reason stdin_eof and exits 0 when it completes", async () => {
    const { shutdown, exits, logger } = setup();
    const link = closableTransport();
    const reasons: string[] = [];
    shutdown.onShutdown("probe", (reason) => {
      reasons.push(reason);
      return Promise.resolve();
    });
    const lease = watchChildLease(shutdown, {
      transport: link.transport,
      exit: (code) => exits.exit(code),
      logger,
    });
    link.closeWith({ reason: "eof" });
    await flushMicrotasks();
    expect(reasons).toEqual(["stdin_eof"]);
    expect(exits.codes).toEqual([0]);
    lease[Symbol.dispose]();
    // 대역 exit이 던진 값은 진단으로 남는다
    expect(logger.records.some((record) => record.event === "lease.shutdown_failed")).toBe(true);
  });

  const cases: readonly { readonly info: CloseInfo; readonly lost: boolean }[] = [
    { info: { reason: "error", message: "EPIPE" }, lost: true },
    { info: { reason: "local" }, lost: false },
    { info: { reason: "remote" }, lost: false },
  ];
  for (const { info, lost } of cases) {
    test(`close reason ${info.reason}: lease lost = ${String(lost)}`, async () => {
      const { shutdown, exits } = setup();
      const link = closableTransport();
      const lease = watchChildLease(shutdown, {
        transport: link.transport,
        exit: (code) => exits.exit(code),
      });
      link.closeWith(info);
      await flushMicrotasks();
      lease[Symbol.dispose]();
      expect(shutdown.reason !== null).toBe(lost);
    });
  }

  test("disposing the lease stops watching", async () => {
    const { shutdown, exits } = setup();
    const link = closableTransport();
    const lease = watchChildLease(shutdown, {
      transport: link.transport,
      exit: (code) => exits.exit(code),
    });
    lease[Symbol.dispose]();
    link.closeWith({ reason: "eof" });
    await flushMicrotasks();
    expect(shutdown.reason).toBeNull();
  });

  test("a participant that never finishes leads to exit(1) from the coordinator, not exit(0)", async () => {
    const { shutdown, exits, clock } = setup();
    const link = closableTransport();
    shutdown.onShutdown("stuck", () => new Promise<void>(() => undefined));
    const lease = watchChildLease(shutdown, {
      transport: link.transport,
      exit: (code) => exits.exit(code),
    });
    link.closeWith({ reason: "eof" });
    await flushMicrotasks();
    // 시한 초과: 조정자가 타이머 안에서 exit(1)을 부른다. 대역은 던지므로 advance가 거부된다
    expect(await rejectionOf(clock.advance(1000))).toBeInstanceOf(Bug);
    expect(exits.codes).toEqual([1]);
    lease[Symbol.dispose]();
  });
});

describe("createHostShutdownHandler", () => {
  test("answers after the participants finish and then closes the transport and exits 0", async () => {
    const { shutdown, exits, clock } = setup();
    const link = closableTransport();
    const events: string[] = [];
    shutdown.onShutdown("probe", async () => {
      await Promise.resolve();
      events.push("participant");
    });
    const handler = createHostShutdownHandler({
      coordinator: shutdown,
      transport: link.transport,
      scheduler: clock,
      exit: (code) => exits.exit(code),
    });
    const result = await handler({ reason: "client_exit" });
    events.push("replied");
    expect(result).toEqual({ accepted: true });
    // 응답이 나가기 전에는 전송을 닫지도 종료하지도 않는다
    expect(link.closeCalls).toEqual([]);
    expect(exits.codes).toEqual([]);
    await clock.advance(0);
    await flushMicrotasks();
    expect(events).toEqual(["participant", "replied"]);
    expect(link.closeCalls).toEqual(["shutdown"]);
    expect(exits.codes).toEqual([0]);
    expect(shutdown.reason).toBe("shutdown_request");
  });

  test("version_replace keeps its own reason", async () => {
    const { shutdown, exits, clock } = setup();
    const link = closableTransport();
    const handler = createHostShutdownHandler({
      coordinator: shutdown,
      transport: link.transport,
      scheduler: clock,
      exit: (code) => exits.exit(code),
    });
    await handler({ reason: "version_replace" });
    await clock.advance(0);
    expect(shutdown.reason).toBe("version_replace");
  });
});
