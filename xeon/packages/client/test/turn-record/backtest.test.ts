import { describe, expect, test } from "bun:test";
import { wireError, type WireParams } from "@fresnel/contracts/wire";
import { fakeConnection } from "../settings/fixtures.ts";
import {
  backtestResult,
  backtestStatus,
  cancelBacktest,
  runBacktest,
  turnRecordFailureOf,
} from "../../src/turn-record/index.ts";

// 지난 턴에 돌려 보기의 호출 틀 시험(M5d-2). 연결은 read.test.ts와 같은 `fakeConnection`을 쓴다.

const RUN: WireParams<"backtest.run"> = {
  candidate: { pluginId: "guard", versionId: "v2" },
  hook: "tool.call.before",
  scope: { lastTurns: 5 },
};

const SUMMARY = {
  turns: 1,
  calls: 2,
  replayed: 2,
  counts: {
    newly_caught: 1,
    already_stopped: 0,
    agrees_block: 0,
    would_block_allowed_by_human: 0,
    passes_same: 1,
    candidate_fault: 0,
    unreplayable: 0,
  },
  similarNotCaught: [],
  candidateFaults: { threw: 0, timeout: 0 },
};

describe("turnRecordFailureOf for backtest codes", () => {
  test("3521 to 3525 map to their own kinds", () => {
    expect({
      candidate: turnRecordFailureOf(wireError("backtest.candidateNotFound")),
      hook: turnRecordFailureOf(wireError("backtest.hookNotReplayable")),
      run: turnRecordFailureOf(wireError("backtest.runNotFound")),
      isolation: turnRecordFailureOf(wireError("backtest.isolationUnavailable")),
      busy: turnRecordFailureOf(wireError("backtest.busy")),
    }).toEqual({
      candidate: { kind: "candidateNotFound" },
      hook: { kind: "hookNotReplayable" },
      run: { kind: "runNotFound" },
      isolation: { kind: "isolationUnavailable" },
      busy: { kind: "busy" },
    });
  });
});

describe("backtest calls", () => {
  test("runBacktest sends the candidate, hook and scope and returns the run id", async () => {
    const host = fakeConnection({ "backtest.run": () => Promise.resolve({ runId: "bt_1" }) });
    expect(await runBacktest(host.connection, RUN)).toEqual({
      ok: true,
      value: { runId: "bt_1" },
    });
    expect(host.calls).toEqual([{ method: "backtest.run", params: RUN }]);
  });

  test("each refusal of runBacktest keeps its kind, and a busy run is busy", async () => {
    const cases = [
      ["backtest.candidateNotFound", "candidateNotFound"],
      ["backtest.hookNotReplayable", "hookNotReplayable"],
      ["backtest.isolationUnavailable", "isolationUnavailable"],
      ["backtest.busy", "busy"],
    ] as const;
    const outcomes = await Promise.all(
      cases.map(async ([code]) => {
        const host = fakeConnection({ "backtest.run": () => Promise.reject(wireError(code)) });
        return { code, result: await runBacktest(host.connection, RUN) };
      }),
    );
    expect(outcomes).toEqual(
      cases.map(([code, kind]) => ({ code, result: { ok: false, error: { kind } } })),
    );
  });

  test("backtestStatus reads the state and counters, and a missing run is runNotFound", async () => {
    const host = fakeConnection({
      "backtest.status": () => Promise.resolve({ state: "running", done: 2, total: 5 }),
    });
    expect(await backtestStatus(host.connection, { runId: "bt_1" })).toEqual({
      ok: true,
      value: { state: "running", done: 2, total: 5 },
    });
    expect(host.calls).toEqual([{ method: "backtest.status", params: { runId: "bt_1" } }]);

    const missing = fakeConnection({
      "backtest.status": () => Promise.reject(wireError("backtest.runNotFound")),
    });
    expect(await backtestStatus(missing.connection, { runId: "bt_9" })).toEqual({
      ok: false,
      error: { kind: "runNotFound" },
    });
  });

  test("backtestResult passes the cursor and returns the page with its summary", async () => {
    const page = {
      summary: SUMMARY,
      items: [],
      notReproducible: ["model_reaction"],
      next: "c_2",
    };
    const host = fakeConnection({ "backtest.result": () => Promise.resolve(page) });
    expect(await backtestResult(host.connection, { runId: "bt_1", cursor: "c_1" })).toEqual({
      ok: true,
      value: page,
    });
    expect(host.calls).toEqual([
      { method: "backtest.result", params: { runId: "bt_1", cursor: "c_1" } },
    ]);
  });

  test("cancelBacktest sends the run id and answers with the empty value", async () => {
    const host = fakeConnection({ "backtest.cancel": () => Promise.resolve({}) });
    expect(await cancelBacktest(host.connection, { runId: "bt_1" })).toEqual({
      ok: true,
      value: {},
    });
    expect(host.calls).toEqual([{ method: "backtest.cancel", params: { runId: "bt_1" } }]);
  });
});
