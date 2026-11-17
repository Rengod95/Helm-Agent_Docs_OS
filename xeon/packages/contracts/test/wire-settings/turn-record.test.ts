import { describe, expect, test } from "bun:test";
import { parse } from "../../src/base/index.ts";
import { TRACE_FAILURE_REASONS } from "../../src/extensions/index.ts";
import {
  BACKTEST_CLASSES,
  BacktestItemSchema,
  BacktestSummarySchema,
  CALLER_KINDS,
  CallRecordSchema,
  CallerKindSchema,
  DeltaRowSchema,
  EvidenceRefSchema,
  FindingSchema,
  FindingsBundleResultSchema,
  FindingsListParamsSchema,
  HOOK_OUTCOMES,
  HookOutcomeSchema,
  HookRunSchema,
  MetricFilterSchema,
  MetricRowSchema,
  MetricValueSchema,
  MetricsQueryParamsSchema,
  ProfileCostGetResultSchema,
  RECORD_LEVELS,
  RecordLevelSchema,
  SCOPE_KINDS,
  ScopeKindSchema,
  StepRecordSchema,
  TURN_FLAG_KEYS,
  TestRunCompareParamsSchema,
  TurnRecordAckResultSchema,
  TurnRecordDeltaParamsSchema,
  TurnRecordGetParamsSchema,
  TurnRecordGetResultSchema,
  TurnRecordListParamsSchema,
  TurnRecordMarkParamsSchema,
  TurnRecordSchema,
  TurnRecordSearchParamsSchema,
  TurnRecordUnwatchParamsSchema,
  TurnRecordWatchResultSchema,
  VERDICTS,
  VerdictSchema,
  WIRE_ERRORS,
  ThreadSummarySchema,
  codeRangeOf,
  wireError,
  wireErrorCodeMatchesKind,
  type CallRecord,
  type HookRun,
  type StepRecord,
  type TurnFlagKey,
  type TurnFlags,
  type TurnRecord,
} from "../../src/wire-settings/wire/index.ts";
import type { Equal, Expect } from "../types/expect.ts";

// 턴 기록 스키마(M5d, 정본 review/m5/turn-record-metrics.md §3.2, §3.5, §3.7, §3.8)의 값 비교 시험이다.
// 저장 문자열은 정본과 글자 하나 다르지 않아야 하므로 값 목록을 정본 순서대로 적어 비교한다.

export type TurnFlagKeysMatch = Expect<Equal<TurnFlagKey, keyof TurnFlags>>;

function threadIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `thr_${i}`);
}

const flags: TurnFlags = {
  blockedIntent: 1,
  blockedFault: 0,
  deniedPolicy: 0,
  deniedHuman: 0,
  deniedNoninteractive: 0,
  replaced: 0,
  cancelledAsk: 0,
  asked: 0,
  modified: 0,
  timedOut: 0,
  failed: 0,
  drive: false,
  cacheBreak: false,
  subagents: 0,
  truncatedMaterials: 0,
  draftActive: false,
  untrackedWrite: false,
};

const hookRun: HookRun = {
  hook: "tool.call.before",
  registrationId: "reg-guard",
  plugin: "guard",
  versionId: "v1",
  sourceKind: "plugin",
  seq: 1,
  subject: { toolCallId: "tc_1" },
  toolCallId: "tc_1",
  result: "blocked",
  reason: null,
  decision: "block",
  ask: null,
  ms: 1.5,
  atMs: 0,
  size: 0,
  skippedBy: null,
  decisionText: "denied by policy",
};

const call: CallRecord = {
  toolCallId: "tc_1",
  parentToolCallId: null,
  tool: "shell",
  plugin: "shell",
  caller: "main",
  callerPlugin: null,
  via: null,
  risk: "exec",
  capability: null,
  callKey: "aaaaaaaaaaaaaaaa",
  targetKey: null,
  afterUntrusted: false,
  verdict: "blocked_hook",
  blockedBy: { plugin: "guard", hook: "tool.call.before", registrationId: "reg-guard" },
  hooks: [hookRun],
  policy: null,
  approval: null,
  exec: null,
  result: null,
};

const step: StepRecord = {
  stepIndex: 0,
  stepId: "stp_1",
  modelCalls: [
    {
      role: "main",
      label: null,
      provider: "anthropic",
      modelId: "model-x",
      startedAtMs: 0,
      durationMs: 120,
      firstTokenMs: 30,
      usage: { input: 1000, output: 200, cacheRead: 0, cacheWrite: 900 },
      retries: 0,
      retryWaitMs: 0,
      stopReason: "end_turn",
    },
  ],
  materials: [
    {
      plugin: "notes",
      versionId: "v1",
      registrationId: "reg-notes",
      kind: "always",
      material: "instruction",
      ref: "a1b2c3",
      tokens: 120,
      truncated: false,
      omitted: null,
      itemId: null,
      attribution: "declared",
    },
  ],
  advertised: {
    count: 1,
    tokens: 80,
    deferredCount: 0,
    removedCount: 0,
    fingerprint: "fp-1",
    byPlugin: [{ plugin: "shell", count: 1, tokens: 80, deferred: 0, activated: 0 }],
    tools: [{ name: "shell", plugin: "shell", tokens: 80, state: "advertised", called: 1 }],
  },
  cache: null,
  hooks: [],
  calls: [call],
  composition: null,
  recorded: true,
};

const turn: TurnRecord = {
  schema: 1,
  threadId: "thr_1",
  turnId: "trn_1",
  parent: null,
  origin: "user",
  startedAt: 1000,
  endedAt: 2000,
  status: "completed",
  level: "full",
  complete: true,
  scope: "live",
  profile: { id: "default", rev: 3, source: "thread", inherited: false },
  profileRevChanges: [],
  overlay: null,
  testRun: null,
  children: [],
  frames: [],
  steps: [step],
  turnHooks: [],
  continues: [],
  skills: { listed: ["notes"], listedOmitted: 0, read: [] },
  cost: [{ plugin: "notes", always: 120, drive: 0, onDemand: 0, shared: false }],
  pluginCalls: [],
  pluginStderr: [],
  flags,
  elided: {},
};

describe("턴 기록 값 목록(정본 순서와 글자)", () => {
  test("Verdict has the fourteen stored strings of §3.2 in order", () => {
    expect([...VERDICTS]).toEqual([
      "allowed",
      "blocked_hook",
      "blocked_hook_fault",
      "blocked_guard",
      "blocked_guard_fault",
      "denied_policy",
      "denied_human",
      "denied_noninteractive",
      "replaced_hook",
      "blocked_spawn",
      "cancelled_ask",
      "aborted",
      "invalid_args",
      "unavailable",
    ]);
    for (const verdict of VERDICTS) {
      expect(parse(VerdictSchema, verdict).ok).toBe(true);
    }
    expect(parse(VerdictSchema, "allow").ok).toBe(false);
    expect(parse(VerdictSchema, "blocked").ok).toBe(false);
  });

  test("ScopeKind is live, overlay_reviewed, overlay_draft, test, craft", () => {
    expect([...SCOPE_KINDS]).toEqual([
      "live",
      "overlay_reviewed",
      "overlay_draft",
      "test",
      "craft",
    ]);
    for (const scope of SCOPE_KINDS) {
      expect(parse(ScopeKindSchema, scope).ok).toBe(true);
    }
    expect(parse(ScopeKindSchema, "overlay").ok).toBe(false);
  });

  test("RecordLevel, CallerKind and HookOutcome carry the stored strings", () => {
    expect([...RECORD_LEVELS]).toEqual(["full", "log_only", "none"]);
    expect([...CALLER_KINDS]).toEqual(["main", "subagent", "plugin"]);
    expect([...HOOK_OUTCOMES]).toEqual([
      "pass",
      "modified",
      "asked",
      "blocked",
      "error",
      "timeout",
    ]);
    expect(parse(RecordLevelSchema, "log").ok).toBe(false);
    expect(parse(CallerKindSchema, "plugin").ok).toBe(true);
    expect(parse(HookOutcomeSchema, "allowed").ok).toBe(false);
    expect(parse(HookOutcomeSchema, "timeout").ok).toBe(true);
  });

  test("HookRun.reason is the one live failure list, process reasons included", () => {
    expect([...TRACE_FAILURE_REASONS]).toEqual([
      "threw",
      "timeout",
      "result_invalid",
      "merge_rejected",
      "process_exit",
      "process_killed",
    ]);
  });

  test("turn flag keys match the TurnFlags object in order", () => {
    expect(Object.keys(flags)).toEqual([...TURN_FLAG_KEYS]);
    expect([...BACKTEST_CLASSES]).toEqual([
      "newly_caught",
      "already_stopped",
      "agrees_block",
      "would_block_allowed_by_human",
      "passes_same",
      "candidate_fault",
      "unreplayable",
    ]);
  });
});

describe("기록 스키마", () => {
  test("a sample TurnRecord parses and keeps its values", () => {
    const result = parse(TurnRecordSchema, turn);
    expect(result.ok ? result.value : result.error).toEqual(turn);
  });

  test("a wrong verdict, an unknown scope or an extra key fails", () => {
    expect(parse(CallRecordSchema, { ...call, verdict: "allow" }).ok).toBe(false);
    expect(parse(TurnRecordSchema, { ...turn, scope: "shadow" }).ok).toBe(false);
    expect(parse(TurnRecordSchema, { ...turn, extra: 1 }).ok).toBe(false);
    expect(parse(TurnRecordSchema, { ...turn, schema: 2 }).ok).toBe(false);
  });

  test("HookRun.result uses the five trace results and reason takes the two process values", () => {
    expect(parse(HookRunSchema, { ...hookRun, result: "passed" }).ok).toBe(true);
    expect(parse(HookRunSchema, { ...hookRun, result: "blocked_hook" }).ok).toBe(false);
    expect(parse(HookRunSchema, { ...hookRun, result: "failed", reason: "process_exit" }).ok).toBe(
      true,
    );
    expect(
      parse(HookRunSchema, { ...hookRun, result: "failed", reason: "process_killed" }).ok,
    ).toBe(true);
    expect(parse(HookRunSchema, { ...hookRun, reason: "crashed" }).ok).toBe(false);
    expect(parse(HookRunSchema, { ...hookRun, decisionText: "x".repeat(201) }).ok).toBe(false);
  });

  test("StepRecord reuses the stored composition shape", () => {
    expect(parse(StepRecordSchema, step).ok).toBe(true);
    expect(parse(StepRecordSchema, { ...step, advertised: { count: 1 } }).ok).toBe(false);
  });

  test("the callKey is 16 lowercase hex characters", () => {
    expect(parse(CallRecordSchema, { ...call, callKey: "aaaaaaaaaaaaaaag" }).ok).toBe(false);
    expect(parse(CallRecordSchema, { ...call, callKey: "AAAAAAAAAAAAAAAA" }).ok).toBe(false);
  });

  test("EvidenceRef has a turn form and a backtest form and nothing else", () => {
    expect(
      parse(EvidenceRefSchema, { kind: "turn", threadId: "thr_1", turnId: "trn_1", stepIndex: 0 })
        .ok,
    ).toBe(true);
    expect(parse(EvidenceRefSchema, { kind: "backtest", backtestRunId: "bt_1" }).ok).toBe(true);
    expect(parse(EvidenceRefSchema, { kind: "turn", threadId: "thr_1" }).ok).toBe(false);
    expect(
      parse(EvidenceRefSchema, { kind: "backtest", backtestRunId: "bt_1", threadId: "thr_1" }).ok,
    ).toBe(false);
  });

  test("a Finding holds at most 50 representative evidence items", () => {
    const evidence = { kind: "turn", threadId: "thr_1", turnId: "trn_1" };
    const finding = {
      id: "f_1",
      ruleId: "skill_never_read",
      ruleVersion: 1,
      subject: { kind: "skill", plugin: "notes", ref: "review" },
      impact: { unit: "turns", value: 50 },
      metrics: { "skill.never_read": { value: 0.5, n: 60, state: "exact" } },
      evidence: Array.from({ length: 50 }, () => evidence),
      evidenceTotal: 60,
      next: [{ kind: "fix", target: "craft_chat", label: "설명 고치기" }],
      state: "open",
    };
    expect(parse(FindingSchema, finding).ok).toBe(true);
    expect(parse(FindingSchema, { ...finding, evidence: [...finding.evidence, evidence] }).ok).toBe(
      false,
    );
  });

  test("MetricValue states and the stored reasons", () => {
    expect(
      parse(MetricValueSchema, {
        value: null,
        n: 0,
        state: "insufficient_sample",
        reason: "not_recorded",
      }).ok,
    ).toBe(true);
    expect(parse(MetricValueSchema, { value: 1, n: 2, state: "exact", reason: "beyond" }).ok).toBe(
      false,
    );
  });

  test("MetricRow key may hold only the grouped dimensions", () => {
    expect(parse(MetricRowSchema, { key: { plugin: "guard" }, values: {} }).ok).toBe(true);
    expect(parse(MetricRowSchema, { key: {}, values: {} }).ok).toBe(true);
    expect(parse(MetricRowSchema, { key: { bogus: "x" }, values: {} }).ok).toBe(false);
  });

  test("ProfileCostGet rows keep a null drive for the estimated basis", () => {
    const row = {
      plugin: "notes",
      shared: false,
      always: 120,
      drive: null,
      onDemand: null,
      toolCount: 3,
      basis: "estimated",
    };
    const result = {
      profileId: "default",
      rev: 3,
      basis: "estimated",
      nTurns: 0,
      plugins: [row],
      total: row,
    };
    expect(parse(ProfileCostGetResultSchema, result).ok).toBe(true);
    expect(parse(ProfileCostGetResultSchema, { ...result, basis: "declared" }).ok).toBe(false);
  });

  test("BacktestSummary counts need all seven classes", () => {
    const counts = {
      newly_caught: 1,
      already_stopped: 0,
      agrees_block: 0,
      would_block_allowed_by_human: 0,
      passes_same: 0,
      candidate_fault: 0,
      unreplayable: 0,
    };
    const summary = {
      turns: 1,
      calls: 1,
      replayed: 1,
      counts,
      similarNotCaught: [],
      candidateFaults: { threw: 0, timeout: 0 },
    };
    expect(parse(BacktestSummarySchema, summary).ok).toBe(true);
    const { newly_caught: _n, ...partial } = counts;
    expect(parse(BacktestSummarySchema, { ...summary, counts: partial }).ok).toBe(false);
    const item = {
      toolCallId: "tc_1",
      threadId: "thr_1",
      turnId: "trn_1",
      tool: "shell",
      live: { verdict: "allowed", humanDecision: null, blockedBy: null, laterSignals: [] },
      candidate: { result: "block", reason: "dangerous", ms: 2 },
      class: "newly_caught",
    };
    expect(parse(BacktestItemSchema, item).ok).toBe(true);
    expect(parse(BacktestItemSchema, { ...item, class: "unknown" }).ok).toBe(false);
  });
});

describe("메서드 params와 result 스키마(미등록)", () => {
  test("turnRecord.list limit is 1 to 200 and its filters are the stored values", () => {
    expect(parse(TurnRecordListParamsSchema, { threadId: "thr_1" }).ok).toBe(true);
    expect(parse(TurnRecordListParamsSchema, { threadId: "thr_1", limit: 200 }).ok).toBe(true);
    expect(parse(TurnRecordListParamsSchema, { threadId: "thr_1", limit: 201 }).ok).toBe(false);
    expect(
      parse(TurnRecordListParamsSchema, { threadId: "thr_1", flags: ["blockedIntent", "asked"] })
        .ok,
    ).toBe(true);
    expect(parse(TurnRecordListParamsSchema, { threadId: "thr_1", flags: ["nope"] }).ok).toBe(
      false,
    );
    expect(parse(TurnRecordListParamsSchema, { threadId: "thr_1", scope: ["shadow"] }).ok).toBe(
      false,
    );
  });

  test("turnRecord.get returns absent for a turn that is not recorded", () => {
    expect(parse(TurnRecordGetParamsSchema, { threadId: "thr_1", turnId: "trn_1" }).ok).toBe(true);
    expect(
      parse(TurnRecordGetParamsSchema, { threadId: "thr_1", turnId: "trn_1", detail: "all" }).ok,
    ).toBe(false);
    expect(
      parse(TurnRecordGetResultSchema, {
        enabled: false,
        level: "none",
        record: null,
        absent: "off",
      }).ok,
    ).toBe(true);
    expect(
      parse(TurnRecordGetResultSchema, {
        enabled: true,
        level: "full",
        record: null,
        absent: "missing",
      }).ok,
    ).toBe(false);
  });

  test("watch and unwatch use the subscription id, and the empty result is {}", () => {
    expect(parse(TurnRecordWatchResultSchema, { sub: "s1", level: "full" }).ok).toBe(true);
    expect(parse(TurnRecordWatchResultSchema, { sub: "s-1", level: "full" }).ok).toBe(false);
    expect(parse(TurnRecordUnwatchParamsSchema, { sub: "s1" }).ok).toBe(true);
    expect(parse(TurnRecordAckResultSchema, {}).ok).toBe(true);
    expect(parse(TurnRecordAckResultSchema, { ok: true }).ok).toBe(false);
  });

  test("the delta notification takes at most 100 rows and the turn row's status is a stored value", () => {
    const base = { sub: "s1", threadId: "thr_1", turnId: "trn_1", stepIndex: null, final: true };
    const turnRow = { kind: "turn", status: "completed", complete: true };
    expect(parse(TurnRecordDeltaParamsSchema, { ...base, rows: [turnRow] }).ok).toBe(true);
    const tooMany = Array.from({ length: 101 }, () => turnRow);
    expect(parse(TurnRecordDeltaParamsSchema, { ...base, rows: tooMany }).ok).toBe(false);
    expect(parse(DeltaRowSchema, { kind: "turn", status: "done", complete: true }).ok).toBe(false);
    expect(parse(DeltaRowSchema, { kind: "step", stepIndex: 0, step }).ok).toBe(true);
  });

  test("turnRecord.search filters by period and takes a hook outcome, not a verdict", () => {
    const base = { plugin: "guard", period: { days: 7 } };
    expect(parse(TurnRecordSearchParamsSchema, base).ok).toBe(true);
    expect(parse(TurnRecordSearchParamsSchema, { ...base, outcome: "blocked" }).ok).toBe(true);
    expect(parse(TurnRecordSearchParamsSchema, { ...base, outcome: "blocked_hook" }).ok).toBe(
      false,
    );
    expect(parse(TurnRecordSearchParamsSchema, { ...base, period: { days: 0 } }).ok).toBe(false);
  });

  test("turnRecord.mark accepts only followed and not_followed", () => {
    const base = { threadId: "thr_1", turnId: "trn_1", plugin: "notes" };
    expect(parse(TurnRecordMarkParamsSchema, { ...base, mark: "followed" }).ok).toBe(true);
    expect(parse(TurnRecordMarkParamsSchema, { ...base, mark: "done" }).ok).toBe(false);
  });

  test("metrics.query takes at most 16 metrics and the stored compare keys", () => {
    const filter = { period: { days: 30 }, scopes: ["live", "overlay_reviewed"], caller: "any" };
    expect(parse(MetricFilterSchema, filter).ok).toBe(true);
    expect(
      parse(MetricsQueryParamsSchema, { metrics: ["hook.outcomes"], filter, groupBy: ["plugin"] })
        .ok,
    ).toBe(true);
    expect(
      parse(MetricsQueryParamsSchema, {
        metrics: Array.from({ length: 17 }, (_, i) => `m${i}`),
        filter,
      }).ok,
    ).toBe(false);
    expect(
      parse(MetricsQueryParamsSchema, {
        metrics: ["a"],
        filter,
        compare: { by: "day", a: "x", b: "y" },
      }).ok,
    ).toBe(false);
  });

  test("findings.list state and findings.bundle size limit", () => {
    expect(parse(FindingsListParamsSchema, { state: "dismissed" }).ok).toBe(true);
    expect(parse(FindingsListParamsSchema, { state: "closed" }).ok).toBe(false);
    const bundle = {
      bundle: {
        findingId: "f_1",
        ruleId: "skill_never_read",
        subject: { kind: "skill", plugin: "notes", ref: null },
        impact: { unit: "turns", value: 50 },
        metrics: {},
        evidence: [],
        evidenceTotal: 0,
      },
    };
    expect(parse(FindingsBundleResultSchema, { ...bundle, bytes: 16384 }).ok).toBe(true);
    expect(parse(FindingsBundleResultSchema, { ...bundle, bytes: 16385 }).ok).toBe(false);
  });

  test("testRun.compare takes two to eight threads", () => {
    expect(parse(TestRunCompareParamsSchema, { threadIds: threadIds(1) }).ok).toBe(false);
    expect(parse(TestRunCompareParamsSchema, { threadIds: threadIds(2) }).ok).toBe(true);
    expect(parse(TestRunCompareParamsSchema, { threadIds: threadIds(8) }).ok).toBe(true);
    expect(parse(TestRunCompareParamsSchema, { threadIds: threadIds(9) }).ok).toBe(false);
  });

  test("TestRunMarker takes the optional kind, draft and runGroupId", () => {
    const marker = { profileId: "p", target: "helm", paused: false };
    const schema = ThreadSummarySchema.properties.testRun;
    expect(parse(schema, marker).ok).toBe(true);
    expect(parse(schema, { ...marker, kind: "draft", draft: true, runGroupId: "grp_1" }).ok).toBe(
      true,
    );
    expect(parse(schema, { ...marker, kind: "other" }).ok).toBe(false);
    expect(parse(schema, { ...marker, draft: "yes" }).ok).toBe(false);
  });
});

describe("턴 기록 오류 코드", () => {
  test("3501, 3511, 3512 and 3531 are in the core range and not retryable", () => {
    const cases = [
      [wireError("turnRecord.turnNotFound").code, "turnRecord.turnNotFound", 3501],
      [wireError("metrics.unknownMetric").code, "metrics.unknownMetric", 3511],
      [wireError("metrics.filterInvalid").code, "metrics.filterInvalid", 3512],
      [wireError("findings.notFound").code, "findings.notFound", 3531],
    ] as const;
    for (const [code, kind, expected] of cases) {
      expect({ kind, code, ok: wireErrorCodeMatchesKind(code, kind) }).toEqual({
        kind,
        code: expected,
        ok: true,
      });
      expect(codeRangeOf(code)?.name).toBe("core");
      expect(WIRE_ERRORS[kind].retryable).toBe(false);
    }
  });

  test("backtest codes 3521 to 3525 are not registered yet", () => {
    const codes = Object.values(WIRE_ERRORS).map((spec) => spec.code);
    for (const code of [3521, 3522, 3523, 3524, 3525]) {
      expect(codes).not.toContain(code);
    }
  });
});
