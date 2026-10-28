import { expect, test } from "bun:test";
import { createCtrlCCounter, createExitCoordinator, wireSignals } from "../src/signals.ts";
import { EXIT } from "../src/exit-codes.ts";
import type { CliSignal } from "../src/io.ts";
import { manualClock } from "./support/harness.ts";

test("print mode: one ctrl+c asks to exit, a second within 2s forces it", () => {
  const clock = manualClock();
  const counter = createCtrlCCounter(clock, { interruptSupported: () => true });
  const print = { interactive: false, turnActive: true };
  expect(counter.press(print)).toBe("requestExit");
  clock.advance(1500);
  expect(counter.press(print)).toBe("forceExit");
});

test("print mode: presses more than 2s apart each count as the first", () => {
  const clock = manualClock();
  const counter = createCtrlCCounter(clock, { interruptSupported: () => true });
  const print = { interactive: false, turnActive: true };
  expect(counter.press(print)).toBe("requestExit");
  clock.advance(2000);
  expect(counter.press(print)).toBe("requestExit");
});

test("interactive turn with turn.interrupt available: 1 interrupts, 2 exits, 3 forces (AC9)", () => {
  const clock = manualClock();
  const counter = createCtrlCCounter(clock, { interruptSupported: () => true });
  const busy = { interactive: true, turnActive: true };
  expect(counter.press(busy)).toBe("interruptTurn");
  clock.advance(500);
  expect(counter.press(busy)).toBe("requestExit");
  clock.advance(500);
  expect(counter.press(busy)).toBe("forceExit");
});

test("interactive turn without turn.interrupt (M1): the first press already asks to exit", () => {
  const clock = manualClock();
  const counter = createCtrlCCounter(clock, { interruptSupported: () => false });
  const busy = { interactive: true, turnActive: true };
  expect(counter.press(busy)).toBe("requestExit");
  expect(counter.press(busy)).toBe("requestExit");
  expect(counter.press(busy)).toBe("forceExit");
});

test("interactive idle: the first press hints, the second exits", () => {
  const clock = manualClock();
  const counter = createCtrlCCounter(clock, { interruptSupported: () => true });
  const idle = { interactive: true, turnActive: false };
  expect(counter.press(idle)).toBe("hint");
  clock.advance(100);
  expect(counter.press(idle)).toBe("requestExit");
});

test("the exit coordinator keeps the first request and records a later force", async () => {
  const exit = createExitCoordinator();
  expect(exit.isRequested).toBe(false);
  exit.request(EXIT.terminated);
  exit.request(EXIT.hangup);
  expect(await exit.requested).toEqual({ code: EXIT.terminated, forced: false });
  exit.force(EXIT.interrupted);
  expect(await exit.forced).toEqual({ code: EXIT.interrupted, forced: true });
});

function wired(
  turnActive: boolean,
  interactive: boolean,
): {
  fire(signal: CliSignal): void;
  wiring: ReturnType<typeof wireSignals>;
  calls: string[];
  offs: number;
} {
  const handlers = new Map<CliSignal, () => void>();
  const calls: string[] = [];
  const state = { offs: 0 };
  const wiring = wireSignals(
    {
      onSignal(signal, handler) {
        handlers.set(signal, handler);
        return () => {
          state.offs += 1;
        };
      },
    },
    {
      clock: manualClock(),
      interactive,
      interruptSupported: () => true,
      turnActive: () => turnActive,
      interruptTurn: () => {
        calls.push("interrupt");
      },
      hint: () => {
        calls.push("hint");
      },
    },
  );
  return {
    fire: (signal) => handlers.get(signal)?.(),
    wiring,
    calls,
    get offs() {
      return state.offs;
    },
  };
}

test("SIGTERM requests exit 143 and SIGHUP requests exit 129", async () => {
  const term = wired(true, false);
  term.fire("SIGTERM");
  expect(await term.wiring.exit.requested).toEqual({ code: EXIT.terminated, forced: false });
  const hup = wired(true, false);
  hup.fire("SIGHUP");
  expect(await hup.wiring.exit.requested).toEqual({ code: EXIT.hangup, forced: false });
});

test("ctrl+c calls the interrupt and hint callbacks the counter picks", () => {
  const busy = wired(true, true);
  busy.fire("SIGINT");
  expect(busy.calls).toEqual(["interrupt"]);
  const idle = wired(false, true);
  idle.fire("SIGINT");
  expect(idle.calls).toEqual(["hint"]);
});

test("a raw-mode ctrl+c byte goes through the same handler", async () => {
  const w = wired(true, false);
  w.wiring.onCtrlC();
  expect(await w.wiring.exit.requested).toEqual({ code: EXIT.interrupted, forced: false });
});

test("an interactive exit with no turn running exits 0; with a turn it exits 130", async () => {
  const idle = wired(false, true);
  idle.wiring.onCtrlC();
  idle.wiring.onCtrlC();
  expect(await idle.wiring.exit.requested).toEqual({ code: EXIT.ok, forced: false });
  const busy = wired(true, true);
  busy.wiring.onCtrlC();
  busy.wiring.onCtrlC();
  expect(await busy.wiring.exit.requested).toEqual({ code: EXIT.interrupted, forced: false });
});

test("dispose removes the three handlers", () => {
  const w = wired(false, false);
  w.wiring.dispose();
  expect(w.offs).toBe(3);
});
