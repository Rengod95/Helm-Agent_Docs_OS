import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import {
  WireError,
  type BacktestItem,
  type BacktestRunParams,
  type BacktestSummary,
} from "@fresnel/contracts/wire";
import type { BacktestPort } from "../../src/assembly/backtest/service.ts";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { partial } from "../fixtures/unsafe.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// 돌려 보기 처리기(`backtest.*`, 오류 3521~3525)를 가짜 엔진 위의 실제 처리기로 시험한다. 서비스의 동작은 `test/assembly/backtest/`가 본다.
// 여기서는 실패가 wire 오류 번호, 이름, 세부 값으로 가는지, 성공 값이 그대로 가는지, 진행 알림이 연결에 닿는지를 본다.

/** 서비스 포트의 실행 시작 실패. 서비스가 이 타입을 내보내지 않아 포트 메서드의 반환 타입에서 꺼낸다 */
type RunFailure = Extract<Awaited<ReturnType<BacktestPort["run"]>>, { ok: false }>["error"];
type ResultFailure = Extract<ReturnType<BacktestPort["result"]>, { ok: false }>["error"];

const RUN: BacktestRunParams = {
  candidate: { pluginId: "guard", versionId: "draft:drf_1:0000abcd" },
  hook: "tool.call.before",
  scope: {},
};

const NOT_REPRODUCIBLE = [
  "model_reaction_after_block",
  "later_call_order_and_count",
  "other_plugin_hook_interaction",
  "human_answer_to_ask",
  "candidate_time_or_external_state",
  "candidate_network_side_effects",
];

const SUMMARY: BacktestSummary = {
  turns: 2,
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

const ITEM: BacktestItem = {
  toolCallId: "call_1",
  threadId: "thr_1",
  turnId: "trn_1",
  tool: "read",
  live: { verdict: "allowed", humanDecision: null, blockedBy: null, laterSignals: [] },
  candidate: { result: "block", reason: "forbidden argument", ms: 1 },
  class: "newly_caught",
};

test("each backtest.run failure reaches the wire with its own code, kind and retryable flag", async () => {
  const cases: readonly {
    readonly failure: RunFailure;
    readonly code: number;
    readonly kind: string;
    readonly retryable: boolean;
    readonly message?: string;
  }[] = [
    {
      failure: { kind: "candidate_not_found", message: "the draft is missing: not_found" },
      code: 3521,
      kind: "backtest.candidateNotFound",
      retryable: false,
      message: "the draft is missing: not_found",
    },
    {
      failure: { kind: "hook_not_replayable" },
      code: 3522,
      kind: "backtest.hookNotReplayable",
      retryable: false,
    },
    {
      failure: { kind: "isolation_unavailable" },
      code: 3524,
      kind: "backtest.isolationUnavailable",
      retryable: false,
    },
    { failure: { kind: "busy" }, code: 3525, kind: "backtest.busy", retryable: true },
  ];
  await Promise.all(
    cases.map(async (item) => {
      const host = createFakeHost({
        overrides: {
          backtest: partial<BacktestPort>({ run: () => Promise.resolve(err(item.failure)) }),
        },
      });
      const { connection } = host.connect();
      await connection.request("host.hello", HELLO_PARAMS);
      const error = await rejectionOf(connection.request("backtest.run", RUN));
      if (!(error instanceof WireError)) throw new Error(`expected a wire error for ${item.kind}`);
      expect({ code: error.code, kind: error.data.kind, retryable: error.data.retryable }).toEqual({
        code: item.code,
        kind: item.kind,
        retryable: item.retryable,
      });
      if (item.message !== undefined) expect(error.message).toBe(item.message);
      await connection.close();
    }),
  );
});

test("backtest.status, backtest.result and backtest.cancel answer 3523 for a run that does not exist", async () => {
  const host = createFakeHost({
    overrides: {
      backtest: partial<BacktestPort>({
        status: () => err({ kind: "run_not_found" }),
        result: () => err({ kind: "run_not_found" }),
        cancel: () => err({ kind: "run_not_found" }),
      }),
    },
  });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const calls = [
    connection.request("backtest.status", { runId: "bt_missing" }),
    connection.request("backtest.result", { runId: "bt_missing" }),
    connection.request("backtest.cancel", { runId: "bt_missing" }),
  ];
  const failures = await Promise.all(calls.map((call) => rejectionOf(call)));
  expect(
    failures.map((failure) =>
      failure instanceof WireError ? [failure.code, failure.data.kind] : failure,
    ),
  ).toEqual([
    [3523, "backtest.runNotFound"],
    [3523, "backtest.runNotFound"],
    [3523, "backtest.runNotFound"],
  ]);
  await connection.close();
});

test("a malformed backtest.result cursor is an invalid-params error on the cursor", async () => {
  const failure: ResultFailure = { kind: "invalid_cursor" };
  const host = createFakeHost({
    overrides: {
      backtest: partial<BacktestPort>({ result: () => err(failure) }),
    },
  });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const error = await rejectionOf(
    connection.request("backtest.result", { runId: "bt_1", cursor: "pg_x" }),
  );
  if (!(error instanceof WireError)) throw new Error("expected a wire error");
  expect([error.code, error.data.kind, error.data.details]).toEqual([
    -32602,
    "jsonrpc.invalidParams",
    {
      issues: [{ path: "cursor", message: "cursor must be a next value from a previous response" }],
    },
  ]);
  await connection.close();
});

test("run, status, result and cancel pass their parameters to the port and answer its values", async () => {
  const seen: unknown[] = [];
  const host = createFakeHost({
    overrides: {
      backtest: partial<BacktestPort>({
        run: (params) => {
          seen.push(["run", params]);
          return Promise.resolve(ok({ runId: "bt_1" }));
        },
        status: (runId) => {
          seen.push(["status", runId]);
          return ok({ state: "done", done: 2, total: 2 });
        },
        result: (runId, cursor) => {
          seen.push(["result", runId, cursor ?? null]);
          return ok({
            summary: SUMMARY,
            items: [ITEM],
            notReproducible: [...NOT_REPRODUCIBLE],
            next: null,
          });
        },
        cancel: (runId) => {
          seen.push(["cancel", runId]);
          return ok(true);
        },
      }),
    },
  });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);

  const started = await connection.request("backtest.run", RUN);
  expect(started).toEqual({ runId: "bt_1" });
  expect(await connection.request("backtest.status", { runId: "bt_1" })).toEqual({
    state: "done",
    done: 2,
    total: 2,
  });
  expect(await connection.request("backtest.result", { runId: "bt_1" })).toEqual({
    summary: SUMMARY,
    items: [ITEM],
    notReproducible: NOT_REPRODUCIBLE,
    next: null,
  });
  expect(await connection.request("backtest.cancel", { runId: "bt_1" })).toEqual({});
  expect(seen).toEqual([
    ["run", RUN],
    ["status", "bt_1"],
    ["result", "bt_1", null],
    ["cancel", "bt_1"],
  ]);
  await connection.close();
});

test("backtest.progress reaches a connected client with the run id, done and total", async () => {
  const slot: { progress?: (event: { runId: string; done: number; total: number }) => void } = {};
  const host = createFakeHost({
    overrides: {
      backtest: partial<BacktestPort>({
        onProgress: (listener) => {
          slot.progress = listener;
          return () => undefined;
        },
      }),
    },
  });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const progressed = new Promise<unknown>((resolve) => {
    connection.onNotification("backtest.progress", (params) => resolve(params));
  });
  if (slot.progress === undefined) throw new Error("the hub should subscribe to backtest progress");
  slot.progress({ runId: "bt_1", done: 1, total: 2 });
  expect(await progressed).toEqual({ runId: "bt_1", done: 1, total: 2 });
  await connection.close();
});

test("host.hello lists the four backtest methods and the progress notification as implemented", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  const featured = new Set(hello.features.map((feature) => feature.name));
  expect(
    [
      "backtest.run",
      "backtest.status",
      "backtest.result",
      "backtest.cancel",
      "backtest.progress",
    ].map((name) => featured.has(name)),
  ).toEqual([true, true, true, true, true]);
  await connection.close();
});
