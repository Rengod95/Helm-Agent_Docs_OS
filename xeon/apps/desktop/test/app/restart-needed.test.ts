import { describe, expect, test } from "bun:test";
import { returnStepOf, watchEngineReturn } from "../../src/app/restart-needed.ts";
import { createUiStore } from "../../src/state/ui/index.ts";
import type { EngineState } from "../../src/transport/ipc.ts";
import { harness } from "../state/helpers.ts";

const EXIT = { code: 1, signal: null, at: "2026-11-04T00:00:00.000Z" };
const STARTING: EngineState = { kind: "starting", source: "sidecar", attempt: 0 };
const RUNNING: EngineState = { kind: "running", source: "sidecar", pid: 1 };
const STOPPING: EngineState = { kind: "stopping" };
const FAILED: EngineState = { kind: "failed", attempts: 3, lastExit: EXIT };

describe("returnStepOf: when the engine counts as back after a restart", () => {
  test("the first start is not a return, even though it reaches running", () => {
    expect(returnStepOf(false, null, STARTING)).toEqual({ seenRunning: false, returned: false });
    expect(returnStepOf(false, STARTING, RUNNING)).toEqual({ seenRunning: true, returned: false });
  });

  test("running, a stop, a start, and running again is a return", () => {
    expect(returnStepOf(true, RUNNING, STOPPING)).toEqual({ seenRunning: true, returned: false });
    expect(returnStepOf(true, STOPPING, STARTING)).toEqual({ seenRunning: true, returned: false });
    expect(returnStepOf(true, STARTING, RUNNING)).toEqual({ seenRunning: true, returned: true });
  });

  test("a failure followed by running counts only once running was seen in this app run", () => {
    expect(returnStepOf(false, FAILED, RUNNING)).toEqual({ seenRunning: true, returned: false });
    expect(returnStepOf(true, FAILED, RUNNING)).toEqual({ seenRunning: true, returned: true });
  });

  test("a running engine that reports running again is not a return", () => {
    expect(returnStepOf(true, RUNNING, { ...RUNNING, pid: 2 })).toEqual({
      seenRunning: true,
      returned: false,
    });
  });
});

describe("watchEngineReturn: clears the list when the engine comes back", () => {
  test("the list clears and onReturned runs once, after a stop and a start", () => {
    const h = harness();
    const ui = createUiStore();
    const reports: unknown[] = [];
    let returned = 0;
    ui.actions.noteRestartNeeded({ kind: "install", name: "alpha" });
    const stop = watchEngineReturn({
      engine: h.store.read,
      ui,
      onReturned: () => {
        returned += 1;
      },
      report: (cause) => {
        reports.push(cause);
      },
    });
    const step = (state: EngineState): void => {
      h.store.ingest({ type: "engine", state });
      h.store.flush();
    };

    step(STARTING);
    step(RUNNING);
    expect(returned).toBe(0);
    expect(ui.read.getState().restartNeeded).toEqual([{ kind: "install", name: "alpha" }]);

    step(STOPPING);
    step(STARTING);
    expect(returned).toBe(0);

    step(RUNNING);
    expect(returned).toBe(1);
    expect(ui.read.getState().restartNeeded).toEqual([]);

    step({ ...RUNNING, pid: 2 });
    expect(returned).toBe(1);
    expect(reports).toEqual([]);
    stop();
  });
});
