import { describe, expect, test } from "bun:test";
import { returnStepOf, watchEngineReturn } from "../../src/app/restart-needed.ts";
import { createUiStore } from "../../src/state/ui/index.ts";
import type { EngineState } from "../../src/transport/ipc.ts";
import { harness, STORE, SUB } from "../state/helpers.ts";

const EXIT = { code: 1, signal: null, at: "2026-11-04T00:00:00.000Z" };
const STARTING: EngineState = { kind: "starting", source: "sidecar", attempt: 0 };
const RUNNING: EngineState = { kind: "running", source: "sidecar", pid: 1 };
const STOPPING: EngineState = { kind: "stopping" };
const FAILED: EngineState = { kind: "failed", attempts: 3, lastExit: EXIT };

describe("returnStepOf: when the engine counts as back after a restart", () => {
  const FIRST = { seenRunning: false, awaiting: false };
  const SEEN = { seenRunning: true, awaiting: false };
  const AWAITING = { seenRunning: true, awaiting: true };

  test("the first start is not a return, even when the engine and the link reach live", () => {
    expect(returnStepOf(FIRST, "down")).toEqual({
      seenRunning: false,
      awaiting: false,
      returned: false,
    });
    expect(returnStepOf(FIRST, "up")).toEqual({
      seenRunning: true,
      awaiting: false,
      returned: false,
    });
    expect(returnStepOf(FIRST, "live")).toEqual({
      seenRunning: true,
      awaiting: false,
      returned: false,
    });
  });

  test("a stop, then running, is a return only once the link is live", () => {
    expect(returnStepOf(SEEN, "down")).toEqual({
      seenRunning: true,
      awaiting: true,
      returned: false,
    });
    // 프로세스가 떠도 연결이 live가 아니면 아직 돌아온 것이 아니다(셸은 프로세스가 뜨자마자 running을 보낸다)
    expect(returnStepOf(AWAITING, "up")).toEqual({
      seenRunning: true,
      awaiting: true,
      returned: false,
    });
    expect(returnStepOf(AWAITING, "live")).toEqual({
      seenRunning: true,
      awaiting: false,
      returned: true,
    });
  });

  test("a start that fails before its link is live is not a return, and the next live one still is", () => {
    expect(returnStepOf(AWAITING, "down")).toEqual({
      seenRunning: true,
      awaiting: true,
      returned: false,
    });
    expect(returnStepOf(AWAITING, "live")).toEqual({
      seenRunning: true,
      awaiting: false,
      returned: true,
    });
  });

  test("a link that drops and comes back while the engine kept running is not a restart", () => {
    expect(returnStepOf(SEEN, "up")).toEqual({
      seenRunning: true,
      awaiting: false,
      returned: false,
    });
    expect(returnStepOf(SEEN, "live")).toEqual({
      seenRunning: true,
      awaiting: false,
      returned: false,
    });
  });
});

describe("watchEngineReturn: clears the list when the engine comes back with a live link", () => {
  test("the list clears and onReturned runs once, after a stop, a start and a live link", () => {
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
    const live = (): void => {
      h.store.ingest({
        type: "subscribed",
        sub: SUB,
        storeId: STORE,
        start: 0,
        live: true,
        from: "head",
      });
      h.store.flush();
    };

    step(STARTING);
    step(RUNNING);
    live();
    expect(returned).toBe(0);
    expect(ui.read.getState().restartNeeded).toEqual([{ kind: "install", name: "alpha" }]);

    step(STOPPING);
    step(STARTING);
    expect(returned).toBe(0);

    // 프로세스가 떠도 연결이 live가 되기 전에는 돌아온 것이 아니다
    step(RUNNING);
    expect(returned).toBe(0);
    expect(ui.read.getState().restartNeeded).toEqual([{ kind: "install", name: "alpha" }]);

    live();
    expect(returned).toBe(1);
    expect(ui.read.getState().restartNeeded).toEqual([]);

    step({ ...RUNNING, pid: 2 });
    expect(returned).toBe(1);
    expect(reports).toEqual([]);
    stop();
  });

  test("a restarted engine whose link never gets live does not clear the list or toast", () => {
    const h = harness();
    const ui = createUiStore();
    let returned = 0;
    ui.actions.noteRestartNeeded({ kind: "install", name: "beta" });
    const stop = watchEngineReturn({
      engine: h.store.read,
      ui,
      onReturned: () => {
        returned += 1;
      },
      report: () => {},
    });
    const step = (state: EngineState): void => {
      h.store.ingest({ type: "engine", state });
      h.store.flush();
    };
    h.store.ingest({
      type: "subscribed",
      sub: SUB,
      storeId: STORE,
      start: 0,
      live: true,
      from: "head",
    });
    step(RUNNING);
    step(STOPPING);
    step(STARTING);
    step(RUNNING);
    step(FAILED);
    expect(returned).toBe(0);
    expect(ui.read.getState().restartNeeded).toEqual([{ kind: "install", name: "beta" }]);
    stop();
  });
});
