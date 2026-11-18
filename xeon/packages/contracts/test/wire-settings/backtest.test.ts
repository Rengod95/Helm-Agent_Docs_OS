import { describe, expect, test } from "bun:test";
import { parse } from "../../src/base/index.ts";
import {
  BACKTEST_CLASSES,
  BACKTEST_RUN_STATES,
  BacktestItemSchema,
  BacktestProgressParamsSchema,
  BacktestResultParamsSchema,
  BacktestResultResultSchema,
  BacktestRunParamsSchema,
  BacktestStatusResultSchema,
  BacktestSummarySchema,
  REPLAYABLE_HOOKS,
  WIRE_ERRORS,
  WIRE_METHODS,
  WIRE_NOTIFICATIONS,
  codeRangeOf,
  wireError,
  wireErrorCodeMatchesKind,
} from "../../src/wire-settings/wire/index.ts";
import type {
  BacktestClass,
  BacktestItem,
  BacktestRunParams,
  BacktestSummary,
} from "../../src/wire-settings/wire/index.ts";

// 지난 턴에 돌려 보기(M5d-2)의 wire 표면 값 비교 시험이다. 정본은 review/m5/turn-record-metrics.md §3.5, §3.7, §4.8이다.
// 등록만 다룬다. 처리기와 실행기는 아직 없다.

/** 값 비교용 표본 params. 시험마다 칸을 바꿔 쓴다 */
const RUN_PARAMS: BacktestRunParams = {
  candidate: { pluginId: "guard", versionId: "v2" },
  hook: "tool.call.before",
  scope: {
    lastTurns: 20,
    include: ["live", "test"],
    threadIds: ["thr_1"],
    turns: [{ threadId: "thr_1", turnId: "trn_1" }],
  },
};

const SUMMARY: BacktestSummary = {
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

const RUN_METHODS = [
  "backtest.run",
  "backtest.status",
  "backtest.result",
  "backtest.cancel",
] as const;

const BACKTEST_KINDS = [
  "backtest.candidateNotFound",
  "backtest.hookNotReplayable",
  "backtest.runNotFound",
  "backtest.isolationUnavailable",
  "backtest.busy",
] as const;

function itemOf(cls: BacktestClass): BacktestItem {
  return {
    toolCallId: "tc_1",
    threadId: "thr_1",
    turnId: "trn_1",
    tool: "shell",
    live: { verdict: "allowed", humanDecision: null, blockedBy: null, laterSignals: [] },
    candidate: { result: "block", reason: "dangerous", ms: 2 },
    class: cls,
  };
}

/** `scope` 칸만 바꾼 `backtest.run` params가 맞는지 */
function scopeOk(scope: object): boolean {
  return parse(BacktestRunParamsSchema, { ...RUN_PARAMS, scope }).ok;
}

/** `lastTurns` 한 칸만 바꾼 `backtest.run` params가 맞는지 */
function lastTurnsOk(lastTurns: number): boolean {
  return scopeOk({ lastTurns });
}

function threadIdsOf(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `thr_${String(i)}`);
}

function turnRefsOf(n: number): { threadId: string; turnId: string }[] {
  return Array.from({ length: n }, (_, i) => ({ threadId: "thr_1", turnId: `trn_${String(i)}` }));
}

function phrasesOf(n: number): string[] {
  return Array.from({ length: n }, () => "phrase");
}

function itemsOf(n: number) {
  return Array.from({ length: n }, () => itemOf("passes_same"));
}

function similarOf(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    toolCallId: `tc_${String(i)}`,
    similarTo: "tc_0",
    why: "arg_overlap",
    score: 0.7,
  }));
}

describe("backtest.run params", () => {
  test("a valid params object parses and keeps its values", () => {
    const result = parse(BacktestRunParamsSchema, RUN_PARAMS);
    expect(result.ok && result.value).toEqual(RUN_PARAMS);
    // 레지스트리 항목도 같은 스키마를 쓴다
    const viaRegistry = parse(WIRE_METHODS["backtest.run"].params, RUN_PARAMS);
    expect(viaRegistry.ok && viaRegistry.value).toEqual(RUN_PARAMS);
  });

  test("an unknown hook, lastTurns 51, an extra field and a candidate without versionId are rejected", () => {
    const outcomes = {
      unknownHook: parse(BacktestRunParamsSchema, { ...RUN_PARAMS, hook: "boundary.turn.after" })
        .ok,
      lastTurns51: parse(BacktestRunParamsSchema, {
        ...RUN_PARAMS,
        scope: { ...RUN_PARAMS.scope, lastTurns: 51 },
      }).ok,
      extraField: parse(BacktestRunParamsSchema, { ...RUN_PARAMS, extra: 1 }).ok,
      noVersionId: parse(BacktestRunParamsSchema, {
        ...RUN_PARAMS,
        candidate: { pluginId: "guard" },
      }).ok,
    };
    expect(outcomes).toEqual({
      unknownHook: false,
      lastTurns51: false,
      extraField: false,
      noVersionId: false,
    });
  });

  test("lastTurns is an integer from 1 to 50 and the replayable hooks are the three of §4.8 rule 44", () => {
    expect({
      one: lastTurnsOk(1),
      fifty: lastTurnsOk(50),
      zero: lastTurnsOk(0),
      fraction: lastTurnsOk(2.5),
    }).toEqual({ one: true, fifty: true, zero: false, fraction: false });
    expect(REPLAYABLE_HOOKS).toEqual(["tool.call.before", "guard.tool.before", "tool.result"]);
  });

  test("threadIds and turns hold at most fifty items and a turn takes exactly its two ids", () => {
    expect({
      threads50: scopeOk({ threadIds: threadIdsOf(50) }),
      threads51: scopeOk({ threadIds: threadIdsOf(51) }),
      turns50: scopeOk({ turns: turnRefsOf(50) }),
      turns51: scopeOk({ turns: turnRefsOf(51) }),
      turnExtra: scopeOk({ turns: [{ threadId: "thr_1", turnId: "trn_1", hookSeq: 1 }] }),
    }).toEqual({
      threads50: true,
      threads51: false,
      turns50: true,
      turns51: false,
      turnExtra: false,
    });
  });
});

describe("backtest.status and backtest.result", () => {
  test("status keeps the five run states and the two counters", () => {
    expect(BACKTEST_RUN_STATES).toEqual(["queued", "running", "done", "cancelled", "failed"]);
    for (const state of BACKTEST_RUN_STATES) {
      const value = { state, done: 1, total: 3 };
      const result = parse(BacktestStatusResultSchema, value);
      expect(result.ok && result.value).toEqual(value);
    }
    const bad = {
      paused: parse(BacktestStatusResultSchema, { state: "paused", done: 0, total: 0 }).ok,
      negativeDone: parse(BacktestStatusResultSchema, { state: "done", done: -1, total: 0 }).ok,
    };
    expect(bad).toEqual({ paused: false, negativeDone: false });
  });

  test("result takes an optional cursor, and its items keep their values", () => {
    const params = { runId: "bt_1", cursor: "c_2" };
    const parsedParams = parse(BacktestResultParamsSchema, params);
    expect(parsedParams.ok && parsedParams.value).toEqual(params);
    expect(parse(BacktestResultParamsSchema, { runId: "bt_1" }).ok).toBe(true);

    const answer = {
      summary: SUMMARY,
      items: [itemOf("newly_caught")],
      notReproducible: ["model_reaction", "call_order"],
      next: null,
    };
    const parsed = parse(BacktestResultResultSchema, answer);
    expect(parsed.ok && parsed.value).toEqual(answer);
  });

  test("result holds at most six fixed notReproducible phrases and two hundred items", () => {
    const base = { summary: SUMMARY, items: [], notReproducible: [], next: null };
    expect({
      six: parse(BacktestResultResultSchema, { ...base, notReproducible: phrasesOf(6) }).ok,
      seven: parse(BacktestResultResultSchema, { ...base, notReproducible: phrasesOf(7) }).ok,
      items200: parse(BacktestResultResultSchema, { ...base, items: itemsOf(200) }).ok,
      items201: parse(BacktestResultResultSchema, { ...base, items: itemsOf(201) }).ok,
    }).toEqual({ six: true, seven: false, items200: true, items201: false });
  });
});

describe("BacktestItem and BacktestSummary", () => {
  test("an item parses for each of the seven classes and keeps its class", () => {
    expect(BACKTEST_CLASSES).toEqual([
      "newly_caught",
      "already_stopped",
      "agrees_block",
      "would_block_allowed_by_human",
      "passes_same",
      "candidate_fault",
      "unreplayable",
    ]);
    for (const cls of BACKTEST_CLASSES) {
      const item = itemOf(cls);
      const result = parse(BacktestItemSchema, item);
      expect(result.ok && result.value).toEqual(item);
    }
  });

  test("skippedBy names the earlier hook for already_stopped, and nondeterministic is only true", () => {
    const stopped: BacktestItem = { ...itemOf("already_stopped"), skippedBy: "guard" };
    const parsed = parse(BacktestItemSchema, stopped);
    expect(parsed.ok && parsed.value).toEqual(stopped);
    const flagged: BacktestItem = { ...itemOf("passes_same"), nondeterministic: true };
    const parsedFlag = parse(BacktestItemSchema, flagged);
    expect(parsedFlag.ok && parsedFlag.value).toEqual(flagged);
    expect({
      falseFlag: parse(BacktestItemSchema, { ...itemOf("passes_same"), nondeterministic: false })
        .ok,
      emptySkippedBy: parse(BacktestItemSchema, { ...itemOf("already_stopped"), skippedBy: "" }).ok,
    }).toEqual({ falseFlag: false, emptySkippedBy: false });
  });

  test("unreplayableReason takes the five values of §3.7 and nothing else", () => {
    const reasons = [
      "tool_unknown",
      "args_missing",
      "blob_expired",
      "thread_deleted",
      "result_not_stored",
      "hook_not_recorded",
    ];
    const outcomes = Object.fromEntries(
      reasons.map((reason) => [
        reason,
        parse(BacktestItemSchema, { ...itemOf("unreplayable"), unreplayableReason: reason }).ok,
      ]),
    );
    expect(outcomes).toEqual({
      tool_unknown: true,
      args_missing: true,
      blob_expired: true,
      thread_deleted: true,
      result_not_stored: true,
      hook_not_recorded: false,
    });
  });

  test("the summary counts need all seven keys and similarNotCaught holds at most twenty", () => {
    const parsed = parse(BacktestSummarySchema, SUMMARY);
    expect(parsed.ok && parsed.value).toEqual(SUMMARY);
    const partial = Object.fromEntries(
      Object.entries(SUMMARY.counts).filter(([cls]) => cls !== "newly_caught"),
    );
    expect({
      keysMatchClasses: Object.keys(SUMMARY.counts).toSorted(),
      missingOne: parse(BacktestSummarySchema, { ...SUMMARY, counts: partial }).ok,
      twenty: parse(BacktestSummarySchema, { ...SUMMARY, similarNotCaught: similarOf(20) }).ok,
      twentyOne: parse(BacktestSummarySchema, { ...SUMMARY, similarNotCaught: similarOf(21) }).ok,
    }).toEqual({
      keysMatchClasses: [...BACKTEST_CLASSES].toSorted(),
      missingOne: false,
      twenty: true,
      twentyOne: false,
    });
  });
});

describe("backtest.cancel and backtest.progress", () => {
  test("cancel answers with the empty object and takes the run id", () => {
    const result = WIRE_METHODS["backtest.cancel"].result;
    expect({
      empty: parse(result, {}).ok,
      withField: parse(result, { runId: "bt_1" }).ok,
    }).toEqual({ empty: true, withField: false });
    const params = parse(WIRE_METHODS["backtest.cancel"].params, { runId: "bt_1" });
    expect(params.ok && params.value).toEqual({ runId: "bt_1" });
  });

  test("progress carries the run id and the two counters and nothing else", () => {
    const value = { runId: "bt_1", done: 4, total: 10 };
    const parsed = parse(BacktestProgressParamsSchema, value);
    expect(parsed.ok && parsed.value).toEqual(value);
    expect({
      extra: parse(BacktestProgressParamsSchema, { ...value, state: "running" }).ok,
      negative: parse(BacktestProgressParamsSchema, { ...value, done: -1 }).ok,
    }).toEqual({ extra: false, negative: false });
  });
});

describe("backtest registration", () => {
  test("the four methods are M5 rows, active since 0.1.0, and the progress notification is M5 too", () => {
    const rows = RUN_METHODS.map((name) => {
      const spec = WIRE_METHODS[name];
      return [name, spec.stage, spec.since, spec.status];
    });
    expect(rows).toEqual([
      ["backtest.run", "M5", "0.1.0", "active"],
      ["backtest.status", "M5", "0.1.0", "active"],
      ["backtest.result", "M5", "0.1.0", "active"],
      ["backtest.cancel", "M5", "0.1.0", "active"],
    ]);
    const notice = WIRE_NOTIFICATIONS["backtest.progress"];
    expect({ stage: notice.stage, since: notice.since }).toEqual({ stage: "M5", since: "0.1.0" });
  });
});

describe("backtest error codes", () => {
  test("3521 to 3525 carry their kinds, and only backtest.busy is retryable", () => {
    const codes = {
      "backtest.candidateNotFound": WIRE_ERRORS["backtest.candidateNotFound"].code,
      "backtest.hookNotReplayable": WIRE_ERRORS["backtest.hookNotReplayable"].code,
      "backtest.runNotFound": WIRE_ERRORS["backtest.runNotFound"].code,
      "backtest.isolationUnavailable": WIRE_ERRORS["backtest.isolationUnavailable"].code,
      "backtest.busy": WIRE_ERRORS["backtest.busy"].code,
    };
    expect(codes).toEqual({
      "backtest.candidateNotFound": 3521,
      "backtest.hookNotReplayable": 3522,
      "backtest.runNotFound": 3523,
      "backtest.isolationUnavailable": 3524,
      "backtest.busy": 3525,
    });
    const retryable = {
      candidateNotFound: WIRE_ERRORS["backtest.candidateNotFound"].retryable,
      hookNotReplayable: WIRE_ERRORS["backtest.hookNotReplayable"].retryable,
      runNotFound: WIRE_ERRORS["backtest.runNotFound"].retryable,
      isolationUnavailable: WIRE_ERRORS["backtest.isolationUnavailable"].retryable,
      busy: WIRE_ERRORS["backtest.busy"].retryable,
    };
    expect(retryable).toEqual({
      candidateNotFound: false,
      hookNotReplayable: false,
      runNotFound: false,
      isolationUnavailable: false,
      busy: true,
    });
  });

  test("each backtest code matches its kind, sits in the core range and builds a WireError with that code", () => {
    const facts = BACKTEST_KINDS.map((kind) => {
      const code = wireError(kind).code;
      return {
        kind,
        code,
        matches: wireErrorCodeMatchesKind(code, kind),
        range: codeRangeOf(code)?.name,
      };
    });
    expect(facts).toEqual([
      { kind: "backtest.candidateNotFound", code: 3521, matches: true, range: "core" },
      { kind: "backtest.hookNotReplayable", code: 3522, matches: true, range: "core" },
      { kind: "backtest.runNotFound", code: 3523, matches: true, range: "core" },
      { kind: "backtest.isolationUnavailable", code: 3524, matches: true, range: "core" },
      { kind: "backtest.busy", code: 3525, matches: true, range: "core" },
    ]);
  });
});
