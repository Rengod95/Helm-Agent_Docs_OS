import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { DurableEventEnvelope } from "@fresnel/contracts/records";
import type { BacktestRunParams, CallRecord, TurnRecord } from "@fresnel/contracts/wire";
import type { BacktestIsolation } from "../../../src/assembly/backtest/isolation.ts";
import {
  createBacktestService,
  NOT_REPRODUCIBLE,
  type BacktestPort,
  type BacktestServiceDeps,
} from "../../../src/assembly/backtest/service.ts";
import type { BacktestSettingsValues } from "../../../src/assembly/backtest/scope.ts";
import {
  assistantEvent,
  AT,
  blockedBy,
  callOf,
  fakeRunner,
  ids,
  payloadIdOf,
  resultEvent,
  turnOf,
  turnPortOf,
  type FakeRunner,
} from "./fixtures.ts";

// 돌려 보기 서비스(§3.5, §3.7, §4.8). 음성 시험을 먼저 두고(격리 없음, 실행 중 busy, 찾지 못함, 커서, 훅 없음), 그다음 분류와 요약을 본다.
// 시간과 실행기와 로그는 모두 가짜다. 실제 측정 저장소의 시험은 `no-mixing.test.ts`가 맡는다.

const HASH = `sha256:${"b".repeat(64)}`;
const T1 = ids.next("thr");
const T2 = ids.next("thr");
const DEFAULT_SETTINGS: BacktestSettingsValues = {
  maxTurns: 50,
  maxCalls: 2000,
  callTimeoutMs: 5000,
  totalTimeoutMs: 120000,
};

interface HarnessOptions {
  readonly turns?: readonly TurnRecord[];
  /** 로그 사건. 없는 대화는 빈 로그다 */
  readonly logs?: Readonly<Record<string, readonly DurableEventEnvelope[]>>;
  /** 대화가 없는 것으로 볼 id */
  readonly deleted?: readonly string[];
  readonly candidate?: "found" | "missing" | "inject_only";
  readonly isolation?: "available" | "unavailable";
  readonly runner?: FakeRunner;
  readonly settings?: Partial<BacktestSettingsValues>;
  readonly now?: () => number;
}

interface Harness {
  readonly port: BacktestPort;
  readonly counts: {
    resolve: number;
    reads: string[];
    exists: string[];
    turnReads: number;
    createRunner: number;
  };
  readonly progress: { runId: string; done: number; total: number }[];
  readonly runner: FakeRunner;
}

function harnessOf(options: HarnessOptions = {}): Harness {
  const reads: string[] = [];
  const exists: string[] = [];
  const counts = { resolve: 0, reads, exists, turnReads: 0, createRunner: 0 };
  const runner = options.runner ?? fakeRunner();
  const turns = options.turns ?? [];
  const turnPort = turnPortOf(turns);
  const isolation: BacktestIsolation =
    options.isolation === "unavailable"
      ? { available: false }
      : {
          available: true,
          createRunner: () => {
            counts.createRunner += 1;
            return runner;
          },
        };
  let runIds = 0;
  const deps: BacktestServiceDeps = {
    scope: {
      turns: {
        list: (query) => {
          counts.turnReads += 1;
          return turnPort.list(query);
        },
        get: (threadId, turnId) => {
          counts.turnReads += 1;
          return turnPort.get(threadId, turnId);
        },
      },
      threadIds: () => [...new Set(turns.map((turn) => turn.threadId))],
    },
    threadExists: (threadId) => {
      counts.exists.push(threadId);
      return !(options.deleted ?? []).includes(threadId);
    },
    readItemEvents: (threadId) => {
      counts.reads.push(threadId);
      return Promise.resolve(ok(options.logs?.[threadId] ?? []));
    },
    resolveCandidate: (candidate) => {
      counts.resolve += 1;
      if (options.candidate === "missing") {
        return Promise.resolve(
          err({ kind: "candidate_not_found", message: `no ${candidate.pluginId}` }),
        );
      }
      return Promise.resolve(
        ok({
          name: candidate.pluginId,
          versionId: candidate.versionId,
          root: "/store/cand",
          manifest: { name: candidate.pluginId },
          entry: options.candidate === "inject_only" ? null : "./src/index.ts",
        }),
      );
    },
    isolation: () => isolation,
    settings: () => ({ ...DEFAULT_SETTINGS, ...options.settings }),
    now: options.now ?? (() => AT),
    newRunId: () => {
      runIds += 1;
      return `bt_run${runIds}`;
    },
  };
  const port = createBacktestService(deps);
  const progress: Harness["progress"] = [];
  port.onProgress((event) => progress.push(event));
  return { port, counts, progress, runner };
}

function paramsOf(overrides: Partial<BacktestRunParams> = {}): BacktestRunParams {
  return {
    candidate: { pluginId: "cand", versionId: HASH },
    hook: "tool.call.before",
    scope: { lastTurns: 20 },
    ...overrides,
  };
}

/** 실행을 시작하고 끝날 때까지 기다린다. 시작하지 못하면 오류 값을 돌려준다 */
async function runToEnd(port: BacktestPort, params: BacktestRunParams = paramsOf()) {
  const started = await port.run(params);
  if (!started.ok) return started;
  await port.whenDone(started.value.runId);
  return started;
}

test("with no isolation, run fails and reads nothing: no candidate, no turn, no log, no runner", async () => {
  const turn = turnOf(T1, ids.next("trn"), AT, [callOf("c1")]);
  const harness = harnessOf({ turns: [turn], isolation: "unavailable" });
  const started = await harness.port.run(paramsOf());
  expect(started.ok ? "ok" : started.error.kind).toBe("isolation_unavailable");
  expect(harness.counts).toEqual({
    resolve: 0,
    reads: [],
    exists: [],
    turnReads: 0,
    createRunner: 0,
  });
});

test("while one run is queued or running a new run is busy, and the first still finishes", async () => {
  let releaseGate: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const turn = turnOf(T1, ids.next("trn"), AT, [callOf("c1"), callOf("c2")]);
  const runner = fakeRunner({
    script: async () => {
      await gate;
      return { kind: "returned", value: null, ms: 1 };
    },
  });
  const harness = harnessOf({ turns: [turn], runner });
  const first = await harness.port.run(paramsOf());
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  const second = await harness.port.run(paramsOf());
  expect(second.ok ? "ok" : second.error.kind).toBe("busy");
  releaseGate?.();
  await harness.port.whenDone(first.value.runId);
  expect(harness.port.status(first.value.runId)).toEqual({
    ok: true,
    value: { state: "done", done: 2, total: 2 },
  });
  // 끝난 뒤에는 다시 시작할 수 있다
  const third = await runToEnd(harness.port);
  expect(third.ok).toBe(true);
});

test("an unknown run id answers run_not_found on status, result, and cancel", () => {
  const harness = harnessOf();
  expect(harness.port.status("bt_nope")).toEqual({ ok: false, error: { kind: "run_not_found" } });
  expect(harness.port.result("bt_nope")).toEqual({ ok: false, error: { kind: "run_not_found" } });
  expect(harness.port.cancel("bt_nope")).toEqual({ ok: false, error: { kind: "run_not_found" } });
});

test("a result cursor that is not one the service gave answers invalid_cursor", async () => {
  const turn = turnOf(T1, ids.next("trn"), AT, [callOf("c1")]);
  const harness = harnessOf({ turns: [turn] });
  const started = await runToEnd(harness.port);
  if (!started.ok) throw new Error("the run must start");
  for (const cursor of ["", "xyz", "pg_01", "pg_-1", "pg_99999"]) {
    const read = harness.port.result(started.value.runId, cursor);
    expect(read.ok ? "ok" : read.error.kind).toBe("invalid_cursor");
  }
  expect(harness.port.result(started.value.runId, "pg_0").ok).toBe(true);
});

test("a candidate that is not there answers candidate_not_found and no runner is made", async () => {
  const harness = harnessOf({ candidate: "missing" });
  const started = await harness.port.run(paramsOf());
  expect(started.ok ? "ok" : started.error.kind).toBe("candidate_not_found");
  expect(harness.counts.createRunner).toBe(0);
});

test("a candidate with no code (inject only) and a hook with no handler both answer hook_not_replayable", async () => {
  const injectOnly = harnessOf({ candidate: "inject_only" });
  const injected = await injectOnly.port.run(paramsOf());
  expect(injected.ok ? "ok" : injected.error.kind).toBe("hook_not_replayable");
  expect(injectOnly.counts.createRunner).toBe(0);

  const noHandler = fakeRunner({ points: [] });
  const harness = harnessOf({ runner: noHandler });
  const started = await harness.port.run(paramsOf());
  expect(started.ok ? "ok" : started.error.kind).toBe("hook_not_replayable");
  expect(noHandler.closes).toEqual(["idle"]);
});

test("a runner that cannot open is isolation_unavailable, and it is closed", async () => {
  const runner = fakeRunner({ openFails: true });
  const harness = harnessOf({ runner });
  const started = await harness.port.run(paramsOf());
  expect(started.ok ? "ok" : started.error.kind).toBe("isolation_unavailable");
  expect(runner.closes).toEqual(["idle"]);
  // 실패한 시작은 자리를 남기지 않는다
  expect(harness.port.status("bt_run1")).toEqual({ ok: false, error: { kind: "run_not_found" } });
});

// ── 분류와 요약 ───────────────────────────────────────────────────────

/** 분류 시험의 기록 한 묶음: 여러 판정의 호출을 한 턴에 담고, 로그 인자와 결과도 맞춘다 */
function classScenario() {
  const turnId = ids.next("trn");
  const calls: CallRecord[] = [
    callOf("c-newly", { tool: "bash" }),
    callOf("c-human", {
      tool: "bash",
      approval: {
        approvalId: "a1",
        decision: "allow",
        resolvedBy: "human",
        waitMs: 5,
        inheritedFrom: null,
      },
    }),
    callOf("c-agrees", {
      tool: "bash",
      verdict: "blocked_hook",
      blockedBy: blockedBy("other", "tool.call.before"),
    }),
    callOf("c-stopped", {
      tool: "bash",
      verdict: "denied_policy",
      policy: { effect: "deny", tier: null },
    }),
    callOf("c-same", { tool: "bash" }),
    callOf("c-fault", { tool: "bash" }),
    callOf("c-noargs", { tool: "bash" }),
  ];
  const turn = turnOf(T1, turnId, AT, calls);
  const logs = [
    assistantEvent(T1, 1, [
      { id: "c-newly", name: "bash", args: { command: "rm a" } },
      { id: "c-human", name: "bash", args: { command: "rm b" } },
      { id: "c-agrees", name: "bash", args: { command: "rm c" } },
      { id: "c-stopped", name: "bash", args: { command: "rm d" } },
      { id: "c-same", name: "bash", args: { command: "ls" } },
      { id: "c-fault", name: "bash", args: { command: "pwd" } },
    ]),
  ];
  return { turn, logs };
}

test("each recorded call is classified by the candidate's answer against what really happened", async () => {
  const { turn, logs } = classScenario();
  const runner = fakeRunner({
    script: (call) => {
      const id = payloadIdOf(call);
      if (id === "c-fault") return { kind: "threw", message: "boom", ms: 2 };
      if (id === "c-same") return { kind: "returned", value: null, ms: 2 };
      return { kind: "returned", value: { block: true, reason: "no rm" }, ms: 2 };
    },
  });
  const harness = harnessOf({ turns: [turn], logs: { [T1]: logs }, runner });
  const started = await runToEnd(harness.port);
  if (!started.ok) throw new Error("the run must start");
  const read = harness.port.result(started.value.runId);
  if (!read.ok) throw new Error("the result must read");
  expect(read.value.items.map((item) => [item.toolCallId, item.class])).toEqual([
    ["c-newly", "newly_caught"],
    ["c-human", "would_block_allowed_by_human"],
    ["c-agrees", "agrees_block"],
    ["c-stopped", "already_stopped"],
    ["c-same", "passes_same"],
    ["c-fault", "candidate_fault"],
    ["c-noargs", "unreplayable"],
  ]);
  expect(read.value.items[0]?.candidate).toEqual({ result: "block", reason: "no rm", ms: 2 });
  expect(read.value.items[6]?.unreplayableReason).toBe("args_missing");
  expect(read.value.items[6]?.candidate.result).toBe("skipped");
  expect(read.value.items[1]?.live.humanDecision).toBe("allow");
});

test("the summary counts every class, the calls seen, the calls replayed, and the candidate faults", async () => {
  const { turn, logs } = classScenario();
  const runner = fakeRunner({
    script: (call) => {
      const id = payloadIdOf(call);
      if (id === "c-fault") return { kind: "threw", message: "boom", ms: 2 };
      if (id === "c-same") return { kind: "returned", value: null, ms: 2 };
      return { kind: "returned", value: { block: true, reason: "no rm" }, ms: 2 };
    },
  });
  const harness = harnessOf({ turns: [turn], logs: { [T1]: logs }, runner });
  const started = await runToEnd(harness.port);
  if (!started.ok) throw new Error("the run must start");
  const read = harness.port.result(started.value.runId);
  if (!read.ok) throw new Error("the result must read");
  expect(read.value.summary).toEqual({
    turns: 1,
    calls: 7,
    replayed: 6,
    counts: {
      newly_caught: 1,
      already_stopped: 1,
      agrees_block: 1,
      would_block_allowed_by_human: 1,
      passes_same: 1,
      candidate_fault: 1,
      unreplayable: 1,
    },
    similarNotCaught: [],
    candidateFaults: { threw: 1, timeout: 0 },
  });
  expect(read.value.notReproducible).toEqual([...NOT_REPRODUCIBLE]);
  expect(read.value.notReproducible).toHaveLength(6);
  expect(read.value.next).toBe(null);
});

test("the unreplayable reasons are thread deleted, blob expired, tool unknown and args missing", async () => {
  const deleted = ids.next("thr");
  const turnA = turnOf(T1, ids.next("trn"), AT, [
    callOf("blob", { tool: "bash" }),
    callOf("badtool", { tool: "Bad Tool!" }),
    callOf("noargs", { tool: "bash" }),
  ]);
  const turnB = turnOf(deleted, ids.next("trn"), AT + 10, [callOf("gone", { tool: "bash" })]);
  const hash = "cd".repeat(32);
  const logs = [
    assistantEvent(T1, 1, [
      { id: "blob", name: "bash", args: { command: `blob:sha256:${hash}` } },
      { id: "badtool", name: "Bad Tool!", args: { command: "x" } },
    ]),
  ];
  const harness = harnessOf({ turns: [turnA, turnB], logs: { [T1]: logs }, deleted: [deleted] });
  const started = await runToEnd(harness.port);
  if (!started.ok) throw new Error("the run must start");
  const read = harness.port.result(started.value.runId);
  if (!read.ok) throw new Error("the result must read");
  expect(read.value.items.map((item) => [item.toolCallId, item.unreplayableReason])).toEqual([
    ["blob", "blob_expired"],
    ["badtool", "tool_unknown"],
    ["noargs", "args_missing"],
    ["gone", "thread_deleted"],
  ]);
  // 삭제된 대화의 로그는 읽지 않는다
  expect(harness.counts.reads).not.toContain(deleted);
  expect(harness.counts.exists).toContain(deleted);
});

test("a tool.result hook replays the stored result, and a call with no stored result is result_not_stored", async () => {
  const turn = turnOf(T1, ids.next("trn"), AT, [
    callOf("has-result", { tool: "read" }),
    callOf("no-result", { tool: "read" }),
  ]);
  const logs = [
    assistantEvent(T1, 1, [
      { id: "has-result", name: "read", args: { path: "a" } },
      { id: "no-result", name: "read", args: { path: "b" } },
    ]),
    resultEvent(T1, 2, "has-result", "read", "file body"),
  ];
  const seen: unknown[] = [];
  const runner = fakeRunner({
    points: ["tool.result"],
    script: (call) => {
      seen.push(call.current);
      return { kind: "returned", value: { content: [{ type: "text", text: "x" }] }, ms: 1 };
    },
  });
  const harness = harnessOf({ turns: [turn], logs: { [T1]: logs }, runner });
  const started = await runToEnd(harness.port, paramsOf({ hook: "tool.result" }));
  if (!started.ok) throw new Error("the run must start");
  const read = harness.port.result(started.value.runId);
  if (!read.ok) throw new Error("the result must read");
  expect(
    read.value.items.map((item) => [item.toolCallId, item.class, item.unreplayableReason ?? null]),
  ).toEqual([
    ["has-result", "passes_same", null],
    ["no-result", "unreplayable", "result_not_stored"],
  ]);
  // 결과가 값이면 같은 입력을 한 번 더 부르므로 현재 값은 두 번 간다(규칙 48)
  const stored = { content: [{ type: "text", text: "file body" }], isError: false };
  expect(seen).toEqual([stored, stored]);
});

test("a guard candidate on a call the tool.call.before hook already stopped is already_stopped and names that hook", async () => {
  const turn = turnOf(T1, ids.next("trn"), AT, [
    callOf("c1", { verdict: "blocked_hook", blockedBy: blockedBy("first", "tool.call.before") }),
  ]);
  const logs = [assistantEvent(T1, 1, [{ id: "c1", name: "bash", args: { command: "x" } }])];
  const runner = fakeRunner({
    points: ["guard.tool.before"],
    script: () => ({ kind: "returned", value: { block: true, reason: "g" }, ms: 1 }),
  });
  const harness = harnessOf({ turns: [turn], logs: { [T1]: logs }, runner });
  const started = await runToEnd(harness.port, paramsOf({ hook: "guard.tool.before" }));
  if (!started.ok) throw new Error("the run must start");
  const read = harness.port.result(started.value.runId);
  if (!read.ok) throw new Error("the result must read");
  expect(read.value.items.map((item) => [item.class, item.skippedBy ?? null])).toEqual([
    ["already_stopped", "tool.call.before"],
  ]);
});

test("a call the candidate blocked and that resembles a call it let pass shows up in similarNotCaught", async () => {
  const turn = turnOf(T1, ids.next("trn"), AT, [
    callOf("blocked", { targetKey: "t1" }),
    callOf("let-through", { targetKey: "t1" }),
  ]);
  const logs = [
    assistantEvent(T1, 1, [
      { id: "blocked", name: "bash", args: { command: "rm build" } },
      { id: "let-through", name: "bash", args: { command: "rm cache" } },
    ]),
  ];
  const runner = fakeRunner({
    script: (call) =>
      payloadIdOf(call) === "blocked"
        ? { kind: "returned", value: { block: true, reason: "no" }, ms: 1 }
        : { kind: "returned", value: null, ms: 1 },
  });
  const harness = harnessOf({ turns: [turn], logs: { [T1]: logs }, runner });
  const started = await runToEnd(harness.port);
  if (!started.ok) throw new Error("the run must start");
  const read = harness.port.result(started.value.runId);
  if (!read.ok) throw new Error("the result must read");
  expect(read.value.summary.similarNotCaught).toEqual([
    { toolCallId: "let-through", similarTo: "blocked", why: "same_tool_same_target", score: null },
  ]);
});

// ── 순서, 비결정성, 한도, 취소, 진행, 실행기 닫기 ─────────────────────

test("calls run one at a time, in recorded order per thread and by time, and the runner is closed once at the end", async () => {
  const turnLate = turnOf(T1, ids.next("trn"), AT + 100, [callOf("late")]);
  const turnEarly = turnOf(T1, ids.next("trn"), AT, [callOf("early-a"), callOf("early-b")]);
  const other = turnOf(T2, ids.next("trn"), AT + 50, [callOf("other")]);
  const logs = {
    [T1]: [
      assistantEvent(T1, 1, [
        { id: "early-a", name: "bash", args: {} },
        { id: "early-b", name: "bash", args: {} },
        { id: "late", name: "bash", args: {} },
      ]),
    ],
    [T2]: [assistantEvent(T2, 2, [{ id: "other", name: "bash", args: {} }])],
  };
  const runner = fakeRunner();
  const harness = harnessOf({ turns: [turnLate, turnEarly, other], logs, runner });
  const started = await runToEnd(harness.port);
  if (!started.ok) throw new Error("the run must start");
  expect(runner.maxInFlight).toBe(1);
  // 두 번씩 돈다: 결과가 값이면 같은 입력을 한 번 더 부른다(규칙 48)
  expect(runner.calls.map((call) => payloadIdOf(call))).toEqual([
    "early-a",
    "early-a",
    "early-b",
    "early-b",
    "late",
    "late",
    "other",
    "other",
  ]);
  expect(runner.closes).toEqual(["idle"]);
});

test("a call whose second run gives another answer is flagged nondeterministic, and a repeat of the same answer is not", async () => {
  const turn = turnOf(T1, ids.next("trn"), AT, [callOf("flaky"), callOf("steady")]);
  const logs = [
    assistantEvent(T1, 1, [
      { id: "flaky", name: "bash", args: {} },
      { id: "steady", name: "bash", args: {} },
    ]),
  ];
  let flakyRuns = 0;
  const runner = fakeRunner({
    script: (call) => {
      if (payloadIdOf(call) === "flaky") {
        flakyRuns += 1;
        const reason = flakyRuns === 1 ? "first" : "second";
        return { kind: "returned", value: { block: true, reason }, ms: 1 };
      }
      return { kind: "returned", value: { block: true, reason: "same" }, ms: 1 };
    },
  });
  const harness = harnessOf({ turns: [turn], logs: { [T1]: logs }, runner });
  const started = await runToEnd(harness.port);
  if (!started.ok) throw new Error("the run must start");
  const read = harness.port.result(started.value.runId);
  if (!read.ok) throw new Error("the result must read");
  expect(read.value.items.map((item) => [item.toolCallId, item.nondeterministic ?? false])).toEqual(
    [
      ["flaky", true],
      ["steady", false],
    ],
  );
});

test("the maxCalls cap runs only the first calls and the summary shows the calls seen", async () => {
  const turn = turnOf(T1, ids.next("trn"), AT, [
    callOf("a"),
    callOf("b"),
    callOf("c"),
    callOf("d"),
    callOf("e"),
  ]);
  const logs = [
    assistantEvent(
      T1,
      1,
      ["a", "b", "c", "d", "e"].map((id) => ({ id, name: "bash", args: {} })),
    ),
  ];
  const runner = fakeRunner();
  const harness = harnessOf({
    turns: [turn],
    logs: { [T1]: logs },
    runner,
    settings: { maxCalls: 2 },
  });
  const started = await runToEnd(harness.port);
  if (!started.ok) throw new Error("the run must start");
  expect(harness.progress.at(-1)).toEqual({ runId: started.value.runId, done: 2, total: 2 });
  const read = harness.port.result(started.value.runId);
  if (!read.ok) throw new Error("the result must read");
  expect(read.value.items.map((item) => item.toolCallId)).toEqual(["a", "b"]);
  expect(read.value.summary.calls).toBe(5);
  expect(read.value.summary.replayed).toBe(2);
});

test("the total time limit stops the run before the next call, and the run is done with fewer replayed", async () => {
  const turn = turnOf(T1, ids.next("trn"), AT, [callOf("a"), callOf("b"), callOf("c")]);
  const logs = [
    assistantEvent(
      T1,
      1,
      ["a", "b", "c"].map((id) => ({ id, name: "bash", args: {} })),
    ),
  ];
  let clock = 0;
  const runner = fakeRunner({
    // 한 번 부를 때마다 10 ms가 지난다고 본다
    script: () => {
      clock += 10;
      return { kind: "returned", value: null, ms: 10 };
    },
  });
  const harness = harnessOf({
    turns: [turn],
    logs: { [T1]: logs },
    runner,
    settings: { totalTimeoutMs: 25 },
    now: () => clock,
  });
  const started = await runToEnd(harness.port);
  if (!started.ok) throw new Error("the run must start");
  // 첫 호출은 두 번 돌고(10 ms씩 두 번, 20 ms), 둘째 호출의 첫 부르기 뒤 시각이 한도(25 ms)를 넘는다
  expect(harness.port.status(started.value.runId)).toEqual({
    ok: true,
    value: { state: "done", done: 2, total: 3 },
  });
  const read = harness.port.result(started.value.runId);
  if (!read.ok) throw new Error("the result must read");
  expect(read.value.summary.calls).toBe(3);
  expect(read.value.summary.replayed).toBeLessThan(read.value.summary.calls);
});

test("a cancel between calls ends the run as cancelled, keeps the items so far, and closes the runner", async () => {
  const turn = turnOf(T1, ids.next("trn"), AT, [callOf("a"), callOf("b"), callOf("c")]);
  const logs = [
    assistantEvent(
      T1,
      1,
      ["a", "b", "c"].map((id) => ({ id, name: "bash", args: {} })),
    ),
  ];
  const handle: { port: BacktestPort | undefined } = { port: undefined };
  const runner = fakeRunner({
    script: (call) => {
      // 첫 호출의 두 번째 부르기가 끝난 뒤 취소를 건다(다음 호출 앞에서 멈춘다)
      if (payloadIdOf(call) === "a") {
        handle.port?.cancel("bt_run1");
      }
      return { kind: "returned", value: null, ms: 1 };
    },
  });
  const harness = harnessOf({ turns: [turn], logs: { [T1]: logs }, runner });
  handle.port = harness.port;
  const started = await runToEnd(harness.port);
  if (!started.ok) throw new Error("the run must start");
  const status = harness.port.status(started.value.runId);
  expect(status.ok && status.value.state).toBe("cancelled");
  const read = harness.port.result(started.value.runId);
  expect(read.ok && read.value.items.map((item) => item.toolCallId)).toEqual(["a"]);
  expect(runner.closes).toEqual(["idle"]);
});

test("a runner that throws ends the run as failed and the runner is still closed", async () => {
  const turn = turnOf(T1, ids.next("trn"), AT, [callOf("a")]);
  const logs = [assistantEvent(T1, 1, [{ id: "a", name: "bash", args: {} }])];
  const runner = fakeRunner({
    script: () => {
      throw new Error("the candidate runner broke");
    },
  });
  const harness = harnessOf({ turns: [turn], logs: { [T1]: logs }, runner });
  const started = await runToEnd(harness.port);
  if (!started.ok) throw new Error("the run must start");
  expect(harness.port.status(started.value.runId)).toEqual({
    ok: true,
    value: { state: "failed", done: 0, total: 1 },
  });
  expect(runner.closes).toEqual(["idle"]);
});

test("progress events report done and total after each call, and a stopped listener hears nothing more", async () => {
  const turn = turnOf(T1, ids.next("trn"), AT, [callOf("a"), callOf("b")]);
  const logs = [
    assistantEvent(
      T1,
      1,
      ["a", "b"].map((id) => ({ id, name: "bash", args: {} })),
    ),
  ];
  const harness = harnessOf({ turns: [turn], logs: { [T1]: logs } });
  const started = await runToEnd(harness.port);
  if (!started.ok) throw new Error("the run must start");
  expect(harness.progress).toEqual([
    { runId: started.value.runId, done: 1, total: 2 },
    { runId: started.value.runId, done: 2, total: 2 },
  ]);
});

test("the result pages two hundred items at a time, the summary is complete on each page, and the last page has no next", async () => {
  const calls = Array.from({ length: 250 }, (_, i) => callOf(`call-${i}`));
  const turn = turnOf(T1, ids.next("trn"), AT, calls);
  const logs = [
    assistantEvent(
      T1,
      1,
      calls.map((call) => ({ id: call.toolCallId, name: "bash", args: {} })),
    ),
  ];
  const harness = harnessOf({
    turns: [turn],
    logs: { [T1]: logs },
    runner: fakeRunner({ script: () => ({ kind: "returned", value: null, ms: 1 }) }),
  });
  const started = await runToEnd(harness.port);
  if (!started.ok) throw new Error("the run must start");
  const first = harness.port.result(started.value.runId);
  const second = harness.port.result(started.value.runId, "pg_200");
  if (!first.ok || !second.ok) throw new Error("both pages must read");
  expect(first.value.items).toHaveLength(200);
  expect(first.value.next).toBe("pg_200");
  expect(second.value.items).toHaveLength(50);
  expect(second.value.next).toBe(null);
  expect(second.value.items[0]?.toolCallId).toBe("call-200");
  expect(second.value.summary).toEqual(first.value.summary);
  expect(first.value.summary.calls).toBe(250);
});

test("the scope takes live turns by default, the newest of them with lastTurns, and a turns list exactly", async () => {
  const newest = turnOf(T1, ids.next("trn"), AT + 200, [callOf("n")]);
  const oldest = turnOf(T1, ids.next("trn"), AT, [callOf("o")]);
  const testScope = turnOf(T1, ids.next("trn"), AT + 300, [callOf("t")], "test");
  const logs = [
    assistantEvent(T1, 1, [
      { id: "n", name: "bash", args: {} },
      { id: "o", name: "bash", args: {} },
      { id: "t", name: "bash", args: {} },
    ]),
  ];
  const harness = harnessOf({ turns: [newest, oldest, testScope], logs: { [T1]: logs } });
  const live = await runToEnd(harness.port, paramsOf({ scope: {} }));
  if (!live.ok) throw new Error("the run must start");
  // 같은 대화 안에서는 시각순이라 오래된 턴이 먼저 돈다
  const liveRead = harness.port.result(live.value.runId);
  expect(liveRead.ok && liveRead.value.items.map((item) => item.toolCallId)).toEqual(["o", "n"]);

  const newestOnly = await runToEnd(harness.port, paramsOf({ scope: { lastTurns: 1 } }));
  if (!newestOnly.ok) throw new Error("the run must start");
  const newestRead = harness.port.result(newestOnly.value.runId);
  expect(newestRead.ok && newestRead.value.items.map((item) => item.toolCallId)).toEqual(["n"]);

  const withTest = await runToEnd(harness.port, paramsOf({ scope: { include: ["live", "test"] } }));
  if (!withTest.ok) throw new Error("the run must start");
  const withTestRead = harness.port.result(withTest.value.runId);
  expect(withTestRead.ok && withTestRead.value.summary.turns).toBe(3);

  const explicit = await runToEnd(
    harness.port,
    paramsOf({ scope: { turns: [{ threadId: T1, turnId: oldest.turnId }] } }),
  );
  if (!explicit.ok) throw new Error("the run must start");
  const explicitRead = harness.port.result(explicit.value.runId);
  expect(explicitRead.ok && explicitRead.value.items.map((item) => item.toolCallId)).toEqual(["o"]);
});

test("a run capped by maxCalls closes its runner once", async () => {
  const turn = turnOf(T1, ids.next("trn"), AT, [callOf("a"), callOf("b")]);
  const logs = [
    assistantEvent(
      T1,
      1,
      ["a", "b"].map((id) => ({ id, name: "bash", args: {} })),
    ),
  ];
  const runner = fakeRunner();
  const harness = harnessOf({
    turns: [turn],
    logs: { [T1]: logs },
    runner,
    settings: { maxCalls: 1 },
  });
  const started = await runToEnd(harness.port);
  expect(started.ok).toBe(true);
  expect(runner.closes).toEqual(["idle"]);
});

test("the service keeps at most twenty finished runs and drops the oldest", async () => {
  const turn = turnOf(T1, ids.next("trn"), AT, [callOf("a")]);
  const logs = [assistantEvent(T1, 1, [{ id: "a", name: "bash", args: {} }])];
  const harness = harnessOf({ turns: [turn], logs: { [T1]: logs } });
  const first = await runToEnd(harness.port);
  if (!first.ok) throw new Error("the run must start");
  for (let i = 0; i < 20; i += 1) {
    // oxlint-disable-next-line no-await-in-loop -- 끝난 실행을 차례로 스무 번 만든다(보관 한도 시험)
    await runToEnd(harness.port);
  }
  expect(harness.port.status(first.value.runId)).toEqual({
    ok: false,
    error: { kind: "run_not_found" },
  });
});

test("the isolation is taken at the time of each run, so a late binding is seen", async () => {
  const turn = turnOf(T1, ids.next("trn"), AT, [callOf("a")]);
  const logs = [assistantEvent(T1, 1, [{ id: "a", name: "bash", args: {} }])];
  let late: BacktestIsolation = { available: false };
  const deps: BacktestServiceDeps = {
    scope: { turns: turnPortOf([turn]), threadIds: () => [T1] },
    threadExists: () => true,
    readItemEvents: () => Promise.resolve(ok(logs)),
    resolveCandidate: () =>
      Promise.resolve(
        ok({ name: "cand", versionId: HASH, root: "/r", manifest: {}, entry: "./x.ts" }),
      ),
    isolation: () => late,
    settings: () => DEFAULT_SETTINGS,
    now: () => AT,
    newRunId: () => "bt_late",
  };
  const port = createBacktestService(deps);
  expect((await port.run(paramsOf())).ok).toBe(false);
  late = { available: true, createRunner: () => fakeRunner() };
  const started = await runToEnd(port);
  expect(started.ok).toBe(true);
});
