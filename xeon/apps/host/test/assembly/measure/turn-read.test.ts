import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { Bug, ok } from "@fresnel/contracts";
import {
  hookOutcomeOf,
  postBlockClassOf,
  type PostBlockCall,
} from "../../../src/assembly/measure/classify.ts";
import { FEASIBLE_KINDS } from "@fresnel/contracts/wire";
import { openMeasureStore, type MeasureStore } from "../../../src/assembly/measure/store.ts";
import {
  createTurnRecordPort,
  type TurnRecordReadPort,
} from "../../../src/assembly/measure/turn-read.ts";
import {
  colNum,
  colsOf,
  type TrCacheRow,
  type TrCallRow,
  type TrFrameRow,
  type TrHookRow,
  type TrMaterialRow,
  type TrSkillRow,
  type TrStepRow,
  type TrToolUseRow,
  type TrTurnRow,
} from "../../../src/assembly/measure/turn-tables.ts";

// 턴 기록 지표와 살펴볼 것(M5d 수용 기준 14~18, 20, 38, 39). 합성 데이터를 저장소의 쓰기 면으로 만들고 읽기 포트의 값을 비교한다.

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);

function must<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) throw new Bug("the measure store must open in this test");
  return result.value;
}

function memory(): MeasureStore {
  return must(openMeasureStore(":memory:"));
}

function portOf(
  store: MeasureStore,
  minSample = 20,
  now = NOW,
  enabled = true,
  logged: ReadonlyMap<string, number> = new Map(),
): TurnRecordReadPort {
  return createTurnRecordPort({
    store: () => store,
    enabled: () => enabled,
    retentionDays: () => 30,
    logTurnStartedAt: (_threadId, turnId) => ok(logged.get(turnId)),
    events: { subscribe: () => () => undefined },
    now: () => now,
    metrics: () => ({
      minSample,
      defaultWindowDays: 30,
      findingsEnabled: true,
      findingOverrides: {},
    }),
  });
}

function turnRow(
  thread: string,
  turn: string,
  startedAt: number,
  extra: Partial<TrTurnRow> = {},
): TrTurnRow {
  return {
    threadId: thread,
    turnId: turn,
    startedAt,
    endedAt: startedAt + 1000,
    status: "completed",
    origin: "user",
    scopeKind: "live",
    profileId: "prof-1",
    profileRev: 1,
    profileRevChangesJson: null,
    overlayJson: null,
    pluginStderrJson: null,
    level: "full",
    complete: true,
    model: "m-1",
    flags: 0,
    recordJson: "{}",
    recordBytes: 2,
    startedEventId: null,
    ...extra,
  };
}

function stepRow(thread: string, turn: string, model: string | null): TrStepRow {
  return {
    threadId: thread,
    turnId: turn,
    stepIndex: 0,
    model,
    input: 100,
    output: 20,
    cacheRead: 0,
    cacheWrite: 0,
    retries: 0,
    advCount: 1,
    advTokens: 40,
    deferredCount: 0,
    toolsetFp: null,
    materialsFp: null,
    recorded: true,
  };
}

function call(thread: string, turn: string, id: string, extra: Partial<TrCallRow> = {}): TrCallRow {
  return {
    threadId: thread,
    turnId: turn,
    toolCallId: id,
    stepIndex: 0,
    tool: "bash",
    plugin: "core",
    caller: "main",
    callerPlugin: null,
    via: null,
    inheritedFrom: null,
    verdict: "allowed",
    blockedPlugin: null,
    blockedHook: null,
    callKey: `key-${id}`,
    targetKey: null,
    execMs: 5,
    execStatus: "ok",
    resultTokens: 3,
    resultTruncated: false,
    resultItemId: null,
    metaJson: "{}",
    ...extra,
  };
}

function hook(
  thread: string,
  turn: string,
  seq: number,
  extra: Partial<TrHookRow> = {},
): TrHookRow {
  return {
    threadId: thread,
    turnId: turn,
    stepIndex: 0,
    seqGlobal: seq,
    hook: "tool.call.before",
    registrationId: "reg-1",
    plugin: "guard",
    versionId: null,
    toolCallId: null,
    subjectJson: "{}",
    decision: "none",
    result: "passed",
    reason: null,
    askVia: null,
    askWaits: null,
    askMs: null,
    askAnswer: null,
    ms: 2,
    atMs: 1,
    size: 0,
    skippedBy: null,
    decisionText: null,
    ...extra,
  };
}

function material(
  thread: string,
  turn: string,
  ref: string,
  plugin: string,
  tokens: number,
  extra: Partial<TrMaterialRow> = {},
): TrMaterialRow {
  return {
    threadId: thread,
    turnId: turn,
    stepIndex: 0,
    ref,
    plugin,
    kind: "always",
    material: "instruction",
    tokens,
    truncated: false,
    omitted: null,
    itemId: null,
    attribution: "declared",
    ...extra,
  };
}

function tool(
  thread: string,
  turn: string,
  name: string,
  plugin: string,
  tokens: number,
  state: string,
  called: number,
): TrToolUseRow {
  return { threadId: thread, turnId: turn, tool: name, plugin, tokens, state, called };
}

function skill(
  thread: string,
  turn: string,
  name: string,
  plugin: string,
  listed: boolean,
  read: boolean,
  via: string | null,
): TrSkillRow {
  return {
    threadId: thread,
    turnId: turn,
    skill: name,
    plugin,
    listed,
    read,
    via,
    stepIndex: 0,
    tokens: read ? 5 : null,
  };
}

interface Parts {
  readonly calls?: TrCallRow[];
  readonly hooks?: TrHookRow[];
  readonly materials?: TrMaterialRow[];
  readonly tooluse?: TrToolUseRow[];
  readonly skills?: TrSkillRow[];
}

/** 턴 하나를 쓴다: 턴 행과 단계 0의 하위 행 */
function writeTurn(
  store: MeasureStore,
  thread: string,
  turn: string,
  startedAt: number,
  parts: Parts = {},
  extra: Partial<TrTurnRow> = {},
): void {
  must(store.upsertTurn(turnRow(thread, turn, startedAt, extra)));
  must(
    store.writeStep({
      step: stepRow(thread, turn, extra.model ?? "m-1"),
      calls: parts.calls ?? [],
      hooks: parts.hooks ?? [],
      materials: parts.materials ?? [],
      tooluse: parts.tooluse ?? [],
      skills: parts.skills ?? [],
      plugincalls: [],
      cache: [],
    }),
  );
}

function valuesOf(port: TurnRecordReadPort, metrics: string[], from = NOW - 60 * DAY, to = NOW) {
  const out = port.metrics({
    metrics,
    filter: { period: { from, to } },
    groupBy: [],
    compare: null,
  });
  if (!out.ok) throw new Bug("metrics must answer in this test");
  return out.value.rows[0]?.values ?? {};
}

// ---- 값 목록과 분류 --------------------------------------------------------

test("the seven hook outcomes follow the derivation table of §4.5", () => {
  expect(hookOutcomeOf({ result: "passed", reason: null, decision: "none" })).toBe("pass");
  expect(hookOutcomeOf({ result: "modified", reason: null, decision: "none" })).toBe("modified");
  expect(hookOutcomeOf({ result: "passed", reason: null, decision: "replace" })).toBe("modified");
  expect(hookOutcomeOf({ result: "passed", reason: null, decision: "ask" })).toBe("asked");
  expect(hookOutcomeOf({ result: "blocked", reason: null, decision: "block" })).toBe("blocked");
  expect(hookOutcomeOf({ result: "passed", reason: null, decision: "cancel" })).toBe("blocked");
  expect(hookOutcomeOf({ result: "failed", reason: "timeout", decision: "none" })).toBe("timeout");
  expect(hookOutcomeOf({ result: "failed", reason: "threw", decision: "none" })).toBe("error");
  expect(hookOutcomeOf({ result: "skipped", reason: null, decision: "none" })).toBe("skipped");
});

test("the post-block classes take the strongest match and a bash bypass with shared tokens is rewrite_text", () => {
  const base: PostBlockCall = {
    toolCallId: "b",
    stepIndex: 0,
    tool: "bash",
    callKey: "k1",
    targetKey: null,
    argTokens: ["a", "b", "c", "d", "e"],
  };
  const bypass: PostBlockCall = {
    toolCallId: "n",
    stepIndex: 1,
    tool: "bash",
    callKey: "k2",
    targetKey: null,
    argTokens: ["a", "b", "c", "d", "e"],
  };
  expect(postBlockClassOf(base, [base, bypass])).toBe("rewrite_text");
  const same: PostBlockCall = { ...bypass, callKey: "k1" };
  expect(postBlockClassOf(base, [base, same])).toBe("repeat");
  expect(postBlockClassOf(base, [base])).toBe("stopped");
});

test("the catalog names every metric of section 5 with a feasibility", () => {
  const port = portOf(memory());
  const ids = port.catalog();
  const doc = [
    "inst.loaded_turns",
    "inst.tokens",
    "inst.truncated",
    "inst.defied",
    "skill.listed_turns",
    "skill.read_turns",
    "skill.activation_rate",
    "skill.read_origin",
    "skill.activation_by_model",
    "skill.never_read",
    "tool.calls",
    "tool.error_rate",
    "tool.duration",
    "tool.result_tokens",
    "tool.never_called",
    "tool.deferred_activation",
    "hook.runs",
    "hook.outcomes",
    "hook.ask_answers",
    "hook.duration",
    "hook.fault_rate",
    "hook.hit_rate",
    "hook.shadowed",
    "hook.post_block",
    "drive.entries",
    "drive.usage_vs_limit",
    "drive.exit_reasons",
    "drive.asks",
    "block.time_split",
    "block.compactions",
    "block.cache_hit_rate",
    "block.cache_breaks",
    "block.cache_breaks_by_plugin",
    "ver.compare",
    "cost.always",
    "cost.drive",
    "cost.on_demand",
  ];
  const byId = new Map(ids.map((m) => [m.id, m]));
  for (const id of doc) {
    const found = byId.get(id);
    expect(found !== undefined && FEASIBLE_KINDS.some((kind) => kind === found.feasible)).toBe(
      true,
    );
  }
});

// ---- 수용 기준 14: 표본과 계측 꺼짐 ----------------------------------------

test("a rate below the minimum sample is insufficient and not zero-filled", () => {
  const store = memory();
  for (let i = 0; i < 3; i += 1) {
    const turn = `trn_s${String(i)}`;
    writeTurn(store, "thr_s", turn, NOW - (i + 1) * HOUR, {
      skills: [skill("thr_s", turn, "deploy", "ops", true, false, null)],
      calls: [call("thr_s", turn, `c${String(i)}`)],
    });
  }
  const values = valuesOf(portOf(store, 20), ["skill.activation_rate", "tool.calls"]);
  expect(values["skill.activation_rate"]).toEqual({
    value: null,
    n: 3,
    denom: 3,
    state: "insufficient_sample",
  });
  expect(values["tool.calls"]).toEqual({ value: 3, n: 3, state: "exact" });
  store.close();
});

test("a window with only log-only turns reads as measurement_off, not as zero", () => {
  const store = memory();
  writeTurn(
    store,
    "thr_off",
    "trn_off",
    NOW - HOUR,
    { calls: [call("thr_off", "trn_off", "c1")] },
    { level: "log_only" },
  );
  const port = portOf(store, 1);
  const values = valuesOf(port, ["hook.runs", "tool.calls"]);
  expect(values["hook.runs"]).toEqual({
    value: null,
    n: 0,
    state: "unavailable",
    reason: "measurement_off",
  });
  const out = port.metrics({
    metrics: ["hook.runs"],
    filter: { period: { from: NOW - 60 * DAY, to: NOW } },
    groupBy: [],
    compare: null,
  });
  expect(out.ok && out.value.notes.some((note) => note.code === "measurement_off")).toBe(true);
  store.close();
});

// ---- 수용 기준 15: 지침을 두고 막히거나 물린 턴 ------------------------------

test("inst.defied counts a loaded plugin's own blocked or asked calls and leaves out fault verdicts", () => {
  const store = memory();
  const T = "thr_d";
  const guide = (turn: string) => material(T, turn, "r-guide", "guide", 30);
  // A: guide 훅이 막음 → 걸림
  writeTurn(store, T, "trn_a", NOW - 1 * HOUR, {
    materials: [guide("trn_a")],
    calls: [
      call(T, "trn_a", "ca", {
        verdict: "blocked_hook",
        blockedPlugin: "guide",
        blockedHook: "tool.call.before",
      }),
    ],
    hooks: [
      hook(T, "trn_a", 1, {
        plugin: "guide",
        toolCallId: "ca",
        result: "blocked",
        decision: "block",
      }),
    ],
  });
  // B: guide 훅 고장(시간 초과) → 고장은 분자에서 뺀다
  writeTurn(store, T, "trn_b", NOW - 2 * HOUR, {
    materials: [guide("trn_b")],
    calls: [
      call(T, "trn_b", "cb", {
        verdict: "blocked_hook_fault",
        blockedPlugin: "guide",
        blockedHook: "tool.call.before",
      }),
    ],
    hooks: [
      hook(T, "trn_b", 1, {
        plugin: "guide",
        toolCallId: "cb",
        result: "failed",
        reason: "timeout",
      }),
    ],
  });
  // C: 지침만 있고 훅이 없음 → 분모에만 든다
  writeTurn(store, T, "trn_c", NOW - 3 * HOUR, { materials: [guide("trn_c")] });
  // D: guide가 물었고 사람이 거부 → 걸림
  writeTurn(store, T, "trn_d", NOW - 4 * HOUR, {
    materials: [guide("trn_d")],
    calls: [call(T, "trn_d", "cd", { verdict: "denied_human" })],
    hooks: [
      hook(T, "trn_d", 1, {
        plugin: "guide",
        toolCallId: "cd",
        result: "passed",
        decision: "ask",
        askVia: "decision",
        askAnswer: "deny",
      }),
    ],
  });
  // E: 다른 플러그인 훅이 막음 → guide에 걸리지 않는다
  writeTurn(store, T, "trn_e", NOW - 5 * HOUR, {
    materials: [guide("trn_e")],
    calls: [
      call(T, "trn_e", "ce", {
        verdict: "blocked_hook",
        blockedPlugin: "other",
        blockedHook: "tool.call.before",
      }),
    ],
    hooks: [
      hook(T, "trn_e", 1, {
        plugin: "other",
        toolCallId: "ce",
        result: "blocked",
        decision: "block",
      }),
    ],
  });
  const values = valuesOf(portOf(store, 1), [
    "inst.loaded_turns",
    "inst.defied",
    "inst.defied_calls",
  ]);
  expect(values["inst.loaded_turns"]).toEqual({ value: 5, n: 5, state: "exact" });
  expect(values["inst.defied"]).toEqual({ value: 2 / 5, n: 5, denom: 5, state: "approx" });
  expect(values["inst.defied_calls"]).toEqual({ value: 2, n: 2, state: "exact" });
  store.close();
});

// ---- 수용 기준 16: 막은 뒤의 행동 다섯 시나리오와 bash 우회 ----------------

test("the post-block classes come out for the five scenarios and a bash bypass", () => {
  const store = memory();
  const T = "thr_p";
  const blocked = (
    id: string,
    tool: string,
    targetKey: string | null,
    callKey: string,
    argTokens = "[]",
  ) =>
    call(T, "", id, {
      tool,
      targetKey,
      callKey,
      verdict: "blocked_hook",
      blockedPlugin: "guard",
      blockedHook: "tool.call.before",
      metaJson: `{"argTokens":${argTokens}}`,
    });
  const later = (
    id: string,
    step: number,
    tool: string,
    targetKey: string | null,
    callKey: string,
    argTokens = "[]",
  ) =>
    call(T, "", id, {
      stepIndex: step,
      tool,
      targetKey,
      callKey,
      metaJson: `{"argTokens":${argTokens}}`,
    });
  const scenario = (turn: string, start: number, calls: TrCallRow[]) =>
    writeTurn(store, T, turn, start, {
      calls: calls.map((c) => ({ ...c, threadId: T, turnId: turn })),
    });
  // 같은 호출을 되풀이
  scenario("trn_repeat", NOW - 1 * HOUR, [
    blocked("b1", "bash", null, "K"),
    later("n1", 1, "bash", null, "K"),
  ]);
  // 같은 대상에 다른 모양
  scenario("trn_rewrite", NOW - 2 * HOUR, [
    blocked("b2", "write", "T1", "K1"),
    later("n2", 1, "write", "T1", "K2"),
  ]);
  // 같은 대상을 다른 도구로
  scenario("trn_other", NOW - 3 * HOUR, [
    blocked("b3", "write", "T1", "K1"),
    later("n3", 1, "edit", "T1", "K3"),
  ]);
  // 무관한 호출
  scenario("trn_diff", NOW - 4 * HOUR, [
    blocked("b4", "write", "T1", "K1"),
    later("n4", 1, "read", "T2", "K4"),
  ]);
  // 멈춤: 뒤에 호출이 없다
  scenario("trn_stop", NOW - 5 * HOUR, [blocked("b5", "write", "T1", "K1")]);
  // bash 우회: 대상이 없고 문자열 토큰이 거의 같다 → rewrite_text
  scenario("trn_bypass", NOW - 6 * HOUR, [
    blocked("b6", "bash", null, "K1", '["rm","-rf","x","y","z"]'),
    later("n6", 1, "bash", null, "K2", '["rm","-rf","x","y","z"]'),
  ]);
  const values = valuesOf(portOf(store, 1), [
    "hook.post_block",
    "hook.post_block.repeat",
    "hook.post_block.rewrite",
    "hook.post_block.other_tool_same_target",
    "hook.post_block.different_path",
    "hook.post_block.stopped",
    "hook.post_block.rewrite_text",
    "hook.post_block.bypass_suspect",
  ]);
  expect(values["hook.post_block"]).toEqual({ value: 6, n: 6, state: "exact" });
  for (const cls of [
    "repeat",
    "rewrite",
    "other_tool_same_target",
    "different_path",
    "stopped",
    "rewrite_text",
  ]) {
    expect(values[`hook.post_block.${cls}`]).toMatchObject({ value: 1 / 6, denom: 6 });
  }
  expect(values["hook.post_block.bypass_suspect"]).toMatchObject({ value: 3 / 6 });
  store.close();
});

// ---- 수용 기준 17: 보관 기간을 넘긴 창은 tr_daily와 같은 값 ----------------

test("a window older than retention reads the same values from tr_daily as from the raw turns", () => {
  const store = memory();
  const T = "thr_old";
  const base = NOW - 40 * DAY;
  for (let i = 0; i < 6; i += 1) {
    const turn = `trn_old${String(i)}`;
    writeTurn(store, T, turn, base + i * HOUR, {
      calls: [
        call(T, turn, `o${String(i)}a`, {
          plugin: "ops",
          tool: "deploy",
          verdict: i % 2 === 0 ? "blocked_hook" : "allowed",
          blockedPlugin: i % 2 === 0 ? "guard" : null,
          blockedHook: i % 2 === 0 ? "tool.call.before" : null,
          callKey: i % 3 === 0 ? "same" : `k${String(i)}`,
        }),
      ],
      hooks: [
        hook(T, turn, 1, {
          plugin: "guard",
          result: i % 3 === 0 ? "blocked" : "passed",
          decision: i % 3 === 0 ? "block" : "none",
          toolCallId: `o${String(i)}a`,
        }),
        hook(T, turn, 2, { plugin: "guard", result: "skipped", skippedBy: "other", seqGlobal: 2 }),
      ],
      tooluse: [
        tool(T, turn, "deploy", "ops", 40, i < 3 ? "advertised" : "deferred", i < 3 ? 1 : 0),
        tool(T, turn, "lint", "ops", 30, "advertised", 0),
      ],
      skills: [skill(T, turn, "guide-skill", "ops", true, i < 4, i < 4 ? "model" : null)],
      materials: [material(T, turn, "r-ops", "ops", 25)],
    });
  }
  const metrics = [
    "skill.activation_rate",
    "skill.listed_turns",
    "hook.outcomes.pass",
    "hook.outcomes.blocked",
    "hook.outcomes.skipped",
    "hook.runs",
    "tool.never_called",
    "tool.never_called.tokens",
    "hook.post_block",
    "hook.post_block.repeat",
    "hook.post_block.stopped",
    "hook.shadowed",
    "inst.defied",
    "inst.loaded_turns",
    "inst.tokens",
  ];
  const from = NOW - 60 * DAY;
  const before = valuesOf(portOf(store, 1), metrics, from, NOW);
  must(store.prune(NOW, 30));
  expect(must(store.readTurn(T, "trn_old0"))).toBeUndefined();
  const after = valuesOf(portOf(store, 1), metrics, from, NOW);
  expect(after).toEqual(before);
  expect(before["skill.activation_rate"]).toMatchObject({ value: 4 / 6 });
  store.close();
});

// ---- 수용 기준 18·19·20: 살펴볼 것 -----------------------------------------

/** 같은 스킬을 두 모델이 다르게 발동하는 합성 데이터 */
function driftStore(lowListed: number): MeasureStore {
  const store = memory();
  const T = "thr_drift";
  for (let i = 0; i < 25; i += 1) {
    const turn = `trn_hi${String(i)}`;
    writeTurn(
      store,
      T,
      turn,
      NOW - (i + 1) * HOUR,
      { skills: [skill(T, turn, "deploy", "ops", true, i < 20, i < 20 ? "model" : null)] },
      { model: "m-old" },
    );
  }
  for (let i = 0; i < lowListed; i += 1) {
    const turn = `trn_lo${String(i)}`;
    writeTurn(
      store,
      T,
      turn,
      NOW - (i + 30) * HOUR,
      { skills: [skill(T, turn, "deploy", "ops", true, i < 5, i < 5 ? "model" : null)] },
      { model: "m-new" },
    );
  }
  return store;
}

test("skill_activation_drop fires for a clear drop and stays silent below the segment sample", () => {
  const store = driftStore(25);
  const port = portOf(store, 20);
  const listed = port.findingsList({
    profileId: null,
    period: { from: NOW - 60 * DAY, to: NOW },
    state: null,
  });
  if (!listed.ok) throw new Bug("findings must list in this test");
  const drop = listed.value.findings.find((f) => f.ruleId === "skill_activation_drop");
  expect(drop?.subject).toEqual({ kind: "skill", plugin: "ops", ref: "deploy" });
  expect((drop?.next.length ?? 0) >= 1).toBe(true);
  store.close();

  const quiet = driftStore(10);
  const quietList = portOf(quiet, 20).findingsList({
    profileId: null,
    period: { from: NOW - 60 * DAY, to: NOW },
    state: null,
  });
  if (!quietList.ok) throw new Bug("findings must list in this test");
  expect(quietList.value.findings.some((f) => f.ruleId === "skill_activation_drop")).toBe(false);
  quiet.close();
});

test("the bundle of a finding is at most 16 KiB and carries only ids, hashes and numbers", () => {
  const store = driftStore(25);
  const port = portOf(store, 20);
  const listed = port.findingsList({
    profileId: null,
    period: { from: NOW - 60 * DAY, to: NOW },
    state: null,
  });
  if (!listed.ok) throw new Bug("findings must list in this test");
  const drop = listed.value.findings.find((f) => f.ruleId === "skill_activation_drop");
  if (drop === undefined) throw new Bug("the drift finding must exist in this test");
  const bundle = port.findingsBundle(drop.id);
  if (!bundle.ok) throw new Bug("the bundle must answer in this test");
  expect(bundle.value.bytes).toBeLessThanOrEqual(16_384);
  expect(Object.keys(bundle.value.bundle).toSorted()).toEqual([
    "evidence",
    "evidenceTotal",
    "findingId",
    "impact",
    "metrics",
    "ruleId",
    "subject",
  ]);
  expect(bundle.value.bundle.evidence.length).toBeLessThanOrEqual(50);
  for (const item of bundle.value.bundle.evidence) {
    expect(item.kind).toBe("turn");
  }
  store.close();
});

test("a dismissed finding opens again when its evidence value at least doubles", () => {
  const store = driftStore(25);
  const port = portOf(store, 20);
  const period = { from: NOW - 60 * DAY, to: NOW };
  const first = port.findingsList({ profileId: null, period, state: null });
  if (!first.ok) throw new Bug("findings must list in this test");
  const drop = first.value.findings.find((f) => f.ruleId === "skill_activation_drop");
  if (drop === undefined) throw new Bug("the drift finding must exist in this test");
  expect(port.findingsDismiss(drop.id, null).ok).toBe(true);
  const hidden = port.findingsList({ profileId: null, period, state: "dismissed" });
  if (!hidden.ok) throw new Bug("findings must list in this test");
  expect(hidden.value.findings.some((f) => f.id === drop.id)).toBe(true);
  // 근거 값(낮은 구간의 턴 수 25)이 두 배 이상(50)으로 늘면 다시 열린다
  for (let i = 0; i < 30; i += 1) {
    const turn = `trn_more${String(i)}`;
    writeTurn(
      store,
      "thr_drift",
      turn,
      NOW - (i + 100) * HOUR,
      { skills: [skill("thr_drift", turn, "deploy", "ops", true, false, null)] },
      { model: "m-new" },
    );
  }
  const reopened = port.findingsList({ profileId: null, period, state: "open" });
  if (!reopened.ok) throw new Bug("findings must list in this test");
  expect(reopened.value.findings.some((f) => f.id === drop.id)).toBe(true);
  store.close();
});

// ---- 수용 기준 38·39: 검색과 표지 ----------------------------------------

test("turnRecord.search filters one plugin's hook rows by outcome and pages the rest", () => {
  const store = memory();
  const T = "thr_search";
  writeTurn(store, T, "trn_s1", NOW - 1 * HOUR, {
    hooks: [hook(T, "trn_s1", 1, { decision: "block", result: "blocked" })],
  });
  writeTurn(store, T, "trn_s2", NOW - 2 * HOUR, {
    hooks: [hook(T, "trn_s2", 1, { result: "passed" })],
  });
  writeTurn(store, T, "trn_s3", NOW - 3 * HOUR, {
    hooks: [hook(T, "trn_s3", 1, { result: "failed", reason: "timeout" })],
  });
  writeTurn(store, T, "trn_s4", NOW - 4 * HOUR, {
    hooks: [hook(T, "trn_s4", 1, { result: "skipped", skippedBy: "other" })],
  });
  writeTurn(store, T, "trn_s5", NOW - 5 * HOUR, {
    hooks: [hook(T, "trn_s5", 1, { plugin: "other", result: "blocked", decision: "block" })],
  });
  const port = portOf(store);
  const period = { from: NOW - 10 * DAY, to: NOW };
  const blocked = port.search({
    plugin: "guard",
    hook: null,
    outcome: "blocked",
    period,
    scopes: null,
    cursor: null,
    limit: 50,
  });
  expect(blocked.ok && blocked.value.items.map((i) => i.turnId)).toEqual(["trn_s1"]);
  const firstPage = port.search({
    plugin: "guard",
    hook: null,
    outcome: null,
    period,
    scopes: null,
    cursor: null,
    limit: 2,
  });
  if (!firstPage.ok) throw new Bug("search must answer in this test");
  expect(firstPage.value.items.map((i) => i.outcome)).toEqual(["timeout", "pass"]);
  expect(firstPage.value.next).not.toBeNull();
  const secondPage = port.search({
    plugin: "guard",
    hook: null,
    outcome: null,
    period,
    scopes: null,
    cursor: firstPage.value.next,
    limit: 2,
  });
  if (!secondPage.ok) throw new Bug("search must answer in this test");
  expect(secondPage.value.items.map((i) => i.outcome)).toEqual(["blocked"]);
  expect(secondPage.value.next).toBeNull();
  store.close();
});

test("turnRecord.mark stores the user's mark for a turn in the log and refuses a missing turn", () => {
  const store = memory();
  const T = "thr_mark";
  writeTurn(store, T, "trn_m1", NOW - HOUR, {});
  const port = portOf(store);
  expect(port.mark(T, "trn_m1", "guard", "followed")).toEqual({ ok: true, value: true });
  expect(must(store.getMarks(T, "trn_m1")).map((m) => m.mark)).toEqual(["followed"]);
  const missing = port.mark(T, "trn_none", "guard", "not_followed");
  expect(missing.ok).toBe(false);
  store.close();
});

// ---- 비용과 교차 시험 ------------------------------------------------------

test("profileCost.get sums the material and advertised tool tokens per plugin over the turns", () => {
  const store = memory();
  const T = "thr_cost";
  writeTurn(store, T, "trn_c1", NOW - HOUR, {
    materials: [material(T, "trn_c1", "r-core", "core", 10)],
    tooluse: [tool(T, "trn_c1", "bash", "core", 40, "advertised", 1)],
  });
  const out = portOf(store).profileCost("prof-1", ["core"]);
  if (!out.ok) throw new Bug("profile cost must answer in this test");
  expect(out.value.basis).toBe("measured");
  expect(out.value.nTurns).toBe(1);
  expect(out.value.plugins.find((p) => p.plugin === "core")?.always).toBe(50);
  const none = portOf(store).profileCost("prof-empty", ["core"]);
  if (!none.ok) throw new Bug("profile cost must answer in this test");
  expect(none.value).toMatchObject({ basis: "estimated", nTurns: 0 });
  expect(none.value.plugins).toEqual([
    {
      plugin: "core",
      always: null,
      drive: null,
      onDemand: null,
      toolCount: null,
      basis: "unknown",
      shared: false,
    },
  ]);
  store.close();
});

// ---- 턴 기록 읽기(record_json을 검증해 돌려준다) -------------------------

function recordJson(thread: string, turn: string, startedAt: number): string {
  const flags = {
    blockedIntent: 0,
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
  return JSON.stringify({
    schema: 1,
    threadId: thread,
    turnId: turn,
    parent: null,
    origin: "user",
    startedAt,
    endedAt: startedAt + 1000,
    status: "completed",
    level: "full",
    complete: true,
    scope: "live",
    profile: null,
    profileRevChanges: [],
    overlay: null,
    testRun: null,
    children: [],
    frames: [],
    steps: [],
    turnHooks: [],
    continues: [],
    skills: { listed: [], listedOmitted: 0, read: [] },
    cost: [],
    pluginCalls: [],
    pluginStderr: [],
    flags,
    elided: {},
  });
}

test("turnRecord.list and get read the stored record and say why a turn is absent", () => {
  const store = memory();
  const T = "thr_read";
  writeTurn(
    store,
    T,
    "trn_r1",
    NOW - HOUR,
    { calls: [call(T, "trn_r1", "cr1")] },
    { recordJson: recordJson(T, "trn_r1", NOW - HOUR) },
  );
  const port = portOf(store);
  const listed = port.list({ threadId: T, limit: 50 });
  if (!listed.ok) throw new Bug("list must answer in this test");
  expect(
    listed.value.items.map((item) => [item.turnId, item.callCount, item.status, item.scope]),
  ).toEqual([["trn_r1", 1, "completed", "live"]]);
  const got = port.get(T, "trn_r1");
  if (!got.ok) throw new Bug("get must answer in this test");
  expect(got.value.absent).toBeNull();
  expect(got.value.record?.turnId).toBe("trn_r1");
  // 로그에도 없는 턴은 3501이다
  expect(port.get(T, "trn_none")).toEqual({ ok: false, error: { kind: "turn_missing" } });
  // 로그에는 있고 행이 없으면 이유를 준다. 기록 시각 표지가 없으면 지운 것으로 보지 않는다
  const logged = new Map([["trn_none", NOW - HOUR]]);
  expect(portOf(store, 20, NOW, true, logged).get(T, "trn_none")).toEqual({
    ok: true,
    value: { enabled: true, level: "full", record: null, absent: "never_recorded" },
  });
  expect(portOf(store, 20, NOW, false, logged).get(T, "trn_none")).toEqual({
    ok: true,
    value: { enabled: false, level: "log_only", record: null, absent: "off" },
  });
  store.close();
});

test("a turn with no row is purged only when it started after recording began and before the retention cutoff", () => {
  const store = memory();
  const T = "thr_purge";
  // 기록이 쓸 수 있게 된 시각: 40일 전. 그 뒤로 시작한 턴의 행은 보관 정리가 지웠을 수 있다
  expect(store.markRecordingSince(NOW - 40 * DAY)).toEqual({ ok: true, value: 1 });
  // 한 번 더 적어도 처음 값이 남는다
  expect(store.markRecordingSince(NOW)).toEqual({ ok: true, value: 0 });
  const logged = new Map([
    ["trn_old", NOW - 35 * DAY], // 기록 뒤, 보관 기간(30일) 밖: 지워졌다
    ["trn_young", NOW - 2 * DAY], // 보관 기간 안: 행이 있어야 했다
    ["trn_before", NOW - 50 * DAY], // 기록 시작 전: 원래 기록이 없었다
  ]);
  const port = portOf(store, 20, NOW, true, logged);
  for (const [turnId, reason] of [
    ["trn_old", "purged"],
    ["trn_young", "never_recorded"],
    ["trn_before", "never_recorded"],
  ] as const) {
    expect(port.get(T, turnId)).toEqual({
      ok: true,
      value: { enabled: true, level: "full", record: null, absent: reason },
    });
  }
  store.close();
});

// ---- M5d-1 층 4: 블록, 주도, 캐시, 버전 비교, 발견(§5, §6, §4.7 규칙 40) ------

interface StepSpec {
  readonly index: number;
  readonly input?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  readonly calls?: TrCallRow[];
  readonly hooks?: TrHookRow[];
  readonly cache?: TrCacheRow[];
}

/** 턴 하나를 단계마다 쓴다. 재료, 도구 광고, 스킬은 단계 0에 둔다 */
function writeSteps(
  store: MeasureStore,
  thread: string,
  turn: string,
  startedAt: number,
  steps: readonly StepSpec[],
  extra: Partial<TrTurnRow> = {},
  parts: { readonly materials?: TrMaterialRow[]; readonly tooluse?: TrToolUseRow[] } = {},
): void {
  must(store.upsertTurn(turnRow(thread, turn, startedAt, extra)));
  for (const spec of steps) {
    const base = stepRow(thread, turn, extra.model ?? "m-1");
    must(
      store.writeStep({
        step: {
          ...base,
          stepIndex: spec.index,
          input: spec.input ?? 0,
          cacheRead: spec.cacheRead ?? 0,
          cacheWrite: spec.cacheWrite ?? 0,
        },
        calls: spec.calls ?? [],
        hooks: spec.hooks ?? [],
        materials: spec.index === 0 ? (parts.materials ?? []) : [],
        tooluse: spec.index === 0 ? (parts.tooluse ?? []) : [],
        skills: [],
        plugincalls: [],
        cache: spec.cache ?? [],
      }),
    );
  }
}

/** 원인 한 줄. 플러그인이 없으면 추정 근거다(기록기와 같은 규칙) */
function causeRow(
  thread: string,
  turn: string,
  step: number,
  kind: string,
  plugin: string | null,
  observed: boolean,
  cacheWrite: number,
): TrCacheRow {
  return {
    threadId: thread,
    turnId: turn,
    stepIndex: step,
    n: 0,
    observed,
    kind,
    plugin,
    registrations: "[]",
    evidence: plugin === null ? "inferred" : "declared",
    cacheRead: 0,
    cacheWrite,
    priorCacheRead: null,
    priorCacheWrite: null,
  };
}

/** 주도 프레임 한 줄. 깊이 0은 기본 흐름이라 플러그인이 없다 */
function frameRow(
  thread: string,
  turn: string,
  lease: string,
  depth: number,
  plugin: string | null,
  range: { readonly entered: number; readonly exited: number | null },
  reason: string | null,
  limits: Record<string, number>,
  used: Record<string, number>,
): TrFrameRow {
  return {
    threadId: thread,
    turnId: turn,
    leaseId: lease,
    depth,
    plugin,
    versionId: null,
    parentLeaseId: depth > 0 ? "lease-root" : null,
    enteredAtMs: range.entered,
    exitedAtMs: range.exited,
    exitReason: reason,
    lowerResumedWith: null,
    limitsJson: JSON.stringify(limits),
    usedJson: JSON.stringify(used),
    userMessages: 0,
  };
}

function writeFrameRows(store: MeasureStore, rows: readonly TrFrameRow[]): void {
  must(store.writeFrames(rows));
}

// 보관 기간(30일) 안의 창이다. 기간을 넘으면 접힌 날이 섞여 partial_window가 붙는다
/** 턴이 없는 프로필의 정적 줄. 칸은 모두 null이다 */
function unknownCostLine(plugin: string) {
  return {
    plugin,
    always: null,
    drive: null,
    onDemand: null,
    toolCount: null,
    basis: "unknown" as const,
    shared: false,
  };
}

/** 문자열 인자 토큰을 `meta_json.argTokens`로 싣는다(수집기와 같은 모양) */
function argTokensJson(values: string[]): string {
  return JSON.stringify({ argTokens: values });
}

const READ_METRICS_WINDOW = { from: NOW - 20 * DAY, to: NOW };

test("profileCost.get lists the profile's plugins with null figures and no invented numbers when it has no turns", () => {
  const store = memory();
  const out = portOf(store).profileCost("prof-none", ["core", "guard"]);
  if (!out.ok) throw new Bug("profile cost must answer in this test");
  expect(out.value).toMatchObject({ profileId: "prof-none", basis: "estimated", nTurns: 0 });
  expect(out.value.plugins).toEqual([unknownCostLine("core"), unknownCostLine("guard")]);
  expect(out.value.total).toEqual(unknownCostLine("*"));
  store.close();
});

test("block.time_split averages the tool, ask and rest milliseconds per turn and leaves the model share unrecorded", () => {
  const store = memory();
  const T = "thr_block";
  // 턴 A: 도구 실행 5+5ms와 도구 훅 2ms, 물음 대기 300ms. 턴 B: 시간만 있다
  writeSteps(
    store,
    T,
    "trn_bA",
    NOW - 2 * HOUR,
    [
      {
        index: 0,
        calls: [
          call(T, "trn_bA", "bA1", { plugin: "guard" }),
          call(T, "trn_bA", "bA2", { plugin: "guard" }),
        ],
        hooks: [
          hook(T, "trn_bA", 1, { toolCallId: "bA1", ms: 2 }),
          hook(T, "trn_bA", 2, { askVia: "awaitUser", askWaits: 1, askMs: 300, ms: 1 }),
        ],
      },
    ],
    { endedAt: NOW - 2 * HOUR + 10_000 },
  );
  writeSteps(store, T, "trn_bB", NOW - HOUR, [{ index: 0 }], { endedAt: NOW - HOUR + 4000 });
  const values = valuesOf(portOf(store, 1), [
    "block.time_split",
    "block.time_split.tools",
    "block.time_split.hook",
    "block.time_split.ask",
    "block.time_split.rest",
    "block.time_split.model",
    "block.compactions",
  ]);
  expect(values["block.time_split"]).toMatchObject({ value: 7000, n: 2, state: "approx" });
  // 도구 실행 10ms(턴 A), 훅 3ms(턴 A), 물음 300ms(턴 A)를 턴 둘의 평균으로 낸다. 나머지는 9687과 4000의 평균
  expect(values["block.time_split.tools"]).toMatchObject({ value: 5, n: 2, state: "approx" });
  expect(values["block.time_split.hook"]).toMatchObject({ value: 1.5, n: 2, state: "approx" });
  expect(values["block.time_split.ask"]).toMatchObject({ value: 150, n: 2 });
  expect(values["block.time_split.rest"]).toMatchObject({ value: 6843.5, n: 2 });
  expect(values["block.time_split.model"]).toEqual({
    value: null,
    n: 0,
    state: "unavailable",
    reason: "not_recorded",
  });
  expect(values["block.compactions"]).toMatchObject({
    state: "unavailable",
    reason: "not_recorded",
  });
  store.close();
});

test("the cache counters give the hit rate, observed and predicted breaks, the unattributed share and the per-plugin tokens", () => {
  const store = memory();
  const T = "thr_cache";
  // 턴 C: 단계 0은 관찰된 깨짐(guard, 쓰기 50), 단계 1은 TTL 깨짐(플러그인 없음). 턴 D: 예측만 된 깨짐(guard)
  writeSteps(store, T, "trn_cC", NOW - 3 * HOUR, [
    {
      index: 0,
      input: 100,
      cacheRead: 300,
      cacheWrite: 50,
      cache: [causeRow(T, "trn_cC", 0, "prefix_reset", "guard", true, 50)],
    },
    { index: 1, cache: [causeRow(T, "trn_cC", 1, "ttl", null, true, 0)] },
  ]);
  writeSteps(store, T, "trn_cD", NOW - 4 * HOUR, [
    { index: 0, input: 100, cache: [causeRow(T, "trn_cD", 0, "toolset", "guard", false, 0)] },
  ]);
  const values = valuesOf(portOf(store, 1), [
    "block.cache_hit_rate",
    "block.cache_breaks",
    "block.cache_breaks.predicted",
    "block.cache_breaks.unattributed",
    "block.cache_breaks_by_plugin",
    "block.cache_breaks_by_plugin.inferred",
    "block.cache_breaks_by_plugin.tokens",
  ]);
  // 사용량이 있는 단계는 C0(450칸 가운데 300)과 D0(100칸 가운데 0)
  expect(values["block.cache_hit_rate"]?.value).toBeCloseTo(300 / 550, 10);
  // 단계 셋 가운데 관찰된 깨짐은 둘, 예측만 된 것은 하나
  expect(values["block.cache_breaks"]).toMatchObject({ value: 2, denom: 3, n: 3, state: "exact" });
  expect(values["block.cache_breaks.predicted"]).toMatchObject({ value: 1, denom: 3 });
  // 관찰된 깨짐 가운데 플러그인이 없는 것은 TTL 하나
  expect(values["block.cache_breaks.unattributed"]).toMatchObject({ value: 0.5, n: 2 });
  // 플러그인 귀속 관찰은 guard의 하나, 턴 둘(C, D)에 쓰기 50 토큰이라 턴당 25
  expect(values["block.cache_breaks_by_plugin"]).toMatchObject({ value: 1, state: "exact" });
  expect(values["block.cache_breaks_by_plugin.inferred"]).toMatchObject({ value: 0, n: 1 });
  expect(values["block.cache_breaks_by_plugin.tokens"]).toMatchObject({ value: 25, n: 2 });
  store.close();
});

// M5c §4.8.9, E §4.6 규칙 36: 테스트 대화(scope craft)의 턴은 지표 기본 필터에서 빠지고 `scopes`로 켜야 나온다
test("craft-scope turns are left out of the default metrics and come back only when their scope is asked for", () => {
  const store = memory();
  // 일반 대화: 입력 100, 캐시 읽기 300이라 적중률 300/400
  writeSteps(store, "thr_plain", "trn_plain", NOW - HOUR, [
    { index: 0, input: 100, cacheRead: 300 },
  ]);
  // 테스트 대화: 입력 900, 캐시 읽기 0이라 적중률 0. 기본 지표에 들면 값이 바뀐다
  writeSteps(
    store,
    "thr_craft",
    "trn_craft",
    NOW - HOUR,
    [{ index: 0, input: 900, cacheRead: 0 }],
    {
      scopeKind: "craft",
    },
  );
  const port = portOf(store, 1);
  const period = { from: NOW - 60 * DAY, to: NOW };
  const rateWith = (scopes: readonly ("live" | "craft")[] | null): number | null | undefined => {
    const filter = scopes === null ? { period } : { period, scopes: [...scopes] };
    const out = port.metrics({
      metrics: ["block.cache_hit_rate"],
      filter,
      groupBy: [],
      compare: null,
    });
    if (!out.ok) throw new Bug("metrics must answer in this test");
    return out.value.rows[0]?.values["block.cache_hit_rate"]?.value;
  };
  // 기본 필터는 일반 대화만 센다
  expect(rateWith(null)).toBeCloseTo(300 / 400, 10);
  // 명시로 craft를 켜면 테스트 대화가 나온다
  expect(rateWith(["craft"])).toBe(0);
  // 둘 다 켜면 두 턴의 합이다
  expect(rateWith(["live", "craft"])).toBeCloseTo(300 / 1300, 10);
  store.close();
});

// M5c §4.8.1, E §4.6 규칙 36: 테스트 실행 대화(scope test)의 턴도 지표 기본 필터에서 빠지고 `scopes`로 켜야 나온다
test("test-scope turns of a test run are left out of the default metrics too and come back only when asked for", () => {
  const store = memory();
  writeSteps(store, "thr_plain", "trn_plain", NOW - HOUR, [
    { index: 0, input: 100, cacheRead: 300 },
  ]);
  writeSteps(store, "thr_run", "trn_run", NOW - HOUR, [{ index: 0, input: 900, cacheRead: 0 }], {
    scopeKind: "test",
  });
  const port = portOf(store, 1);
  const period = { from: NOW - 60 * DAY, to: NOW };
  const rateWith = (scopes: readonly ("live" | "test")[] | null): number | null | undefined => {
    const filter = scopes === null ? { period } : { period, scopes: [...scopes] };
    const out = port.metrics({
      metrics: ["block.cache_hit_rate"],
      filter,
      groupBy: [],
      compare: null,
    });
    if (!out.ok) throw new Bug("metrics must answer in this test");
    return out.value.rows[0]?.values["block.cache_hit_rate"]?.value;
  };
  expect(rateWith(null)).toBeCloseTo(300 / 400, 10);
  expect(rateWith(["test"])).toBe(0);
  expect(rateWith(["live", "test"])).toBeCloseTo(300 / 1300, 10);
  store.close();
});

test("drive metrics read the frame rows: entries, exits by reason, usage against limits and asks inside the frame", () => {
  const store = memory();
  const T = "thr_drive";
  // 턴 E: 주도 프레임 helm(깊이 1, 0~5000ms, 한도 소진)과 그 안의 물음(atMs 100). 턴 F: helm 정상 끝. 턴 G: helm 한도 소진
  writeSteps(
    store,
    T,
    "trn_dE",
    NOW - 5 * HOUR,
    [
      {
        index: 0,
        hooks: [hook(T, "trn_dE", 1, { askVia: "decision", atMs: 100, toolCallId: null })],
      },
    ],
    { endedAt: NOW - 5 * HOUR + 20_000 },
  );
  writeSteps(store, T, "trn_dF", NOW - 6 * HOUR, [{ index: 0 }]);
  writeSteps(store, T, "trn_dG", NOW - 7 * HOUR, [{ index: 0 }]);
  writeFrameRows(store, [
    frameRow(
      T,
      "trn_dE",
      "lease-e0",
      0,
      null,
      { entered: 0, exited: 20_000 },
      "done",
      {},
      { turns: 1 },
    ),
    frameRow(
      T,
      "trn_dE",
      "lease-e1",
      1,
      "helm",
      { entered: 0, exited: 5000 },
      "budget",
      { maxTurns: 4 },
      { turns: 4 },
    ),
    frameRow(
      T,
      "trn_dF",
      "lease-f1",
      1,
      "helm",
      { entered: 0, exited: 3000 },
      "done",
      { maxTurns: 4 },
      { turns: 2 },
    ),
    frameRow(
      T,
      "trn_dG",
      "lease-g1",
      1,
      "helm",
      { entered: 0, exited: 1000 },
      "budget",
      { maxTurns: 4 },
      { turns: 4 },
    ),
  ]);
  const values = valuesOf(portOf(store, 1), [
    "drive.entries",
    "drive.exit_reasons",
    "drive.exit_reasons.budget",
    "drive.exit_reasons.done",
    "drive.usage_vs_limit",
    "drive.usage_vs_limit.spawns",
    "drive.asks",
  ]);
  expect(values["drive.entries"]).toMatchObject({ value: 3, n: 3, state: "exact" });
  expect(values["drive.exit_reasons"]).toMatchObject({ value: 3, state: "exact" });
  expect(values["drive.exit_reasons.budget"]).toMatchObject({ value: 2 / 3, denom: 3 });
  expect(values["drive.exit_reasons.done"]).toMatchObject({ value: 1 / 3, denom: 3 });
  // 한도 합 12, 쓴 합 10
  expect(values["drive.usage_vs_limit"]).toMatchObject({ value: 10 / 12, n: 3 });
  // 서브에이전트 한도가 없는 프레임만 있어 표본이 없다
  expect(values["drive.usage_vs_limit.spawns"]).toMatchObject({
    value: null,
    state: "insufficient_sample",
  });
  expect(values["drive.asks"]).toMatchObject({ value: 1, state: "exact" });
  store.close();
});

test("drive metrics are not_recorded while no frame row exists, and do not read zero", () => {
  const store = memory();
  writeSteps(store, "thr_nof", "trn_nof", NOW - HOUR, [{ index: 0 }]);
  const values = valuesOf(portOf(store, 1), ["drive.entries", "drive.exit_reasons.budget"]);
  expect(values["drive.entries"]).toEqual({
    value: null,
    n: 0,
    state: "unavailable",
    reason: "not_recorded",
  });
  expect(values["drive.exit_reasons.budget"]).toMatchObject({
    state: "unavailable",
    reason: "not_recorded",
  });
  store.close();
});

test("compare by pluginVersion groups the turns by the plugin's hook versions and names the confounder and the unknown group", () => {
  const store = memory();
  const T = "thr_ver";
  writeSteps(store, T, "trn_v1", NOW - 7 * HOUR, [
    {
      index: 0,
      calls: [call(T, "trn_v1", "v1c", { plugin: "guard" })],
      hooks: [hook(T, "trn_v1", 1, { plugin: "guard", versionId: "sha256:aaa" })],
    },
  ]);
  writeSteps(store, T, "trn_v2", NOW - 8 * HOUR, [
    {
      index: 0,
      calls: [call(T, "trn_v2", "v2c", { plugin: "guard" })],
      hooks: [hook(T, "trn_v2", 1, { plugin: "guard", versionId: "sha256:aaa" })],
    },
  ]);
  writeSteps(
    store,
    T,
    "trn_v3",
    NOW - 9 * HOUR,
    [
      {
        index: 0,
        calls: [
          call(T, "trn_v3", "v3a", { plugin: "guard" }),
          call(T, "trn_v3", "v3b", { plugin: "guard" }),
          call(T, "trn_v3", "v3c", { plugin: "guard" }),
        ],
        hooks: [hook(T, "trn_v3", 1, { plugin: "guard", versionId: "sha256:bbb" })],
      },
    ],
    { model: "m-2" },
  );
  const port = portOf(store, 1);
  const compared = port.metrics({
    metrics: ["tool.calls"],
    filter: { period: READ_METRICS_WINDOW, plugin: "guard" },
    groupBy: [],
    compare: { by: "pluginVersion", a: "sha256:aaa", b: "sha256:bbb" },
  });
  if (!compared.ok) throw new Bug("pluginVersion compare must answer in this test");
  expect(compared.value.rows).toEqual([
    {
      key: { pluginVersion: "sha256:aaa" },
      values: { "tool.calls": { value: 2, n: 2, state: "exact" } },
    },
    {
      key: { pluginVersion: "sha256:bbb" },
      values: { "tool.calls": { value: 3, n: 3, state: "exact" } },
    },
  ]);
  // 두 그룹 사이에 모델이 함께 바뀌었다. 인과는 말하지 않고 함께 바뀐 차원만 적는다
  expect(compared.value.notes).toEqual([
    { metric: "tool.calls", code: "confounded", text: "changed with: model" },
  ]);
  // 버전이 없는 턴은 unknown 그룹이고 값은 그대로 나온다(실패하지 않는다)
  const unknownSide = port.metrics({
    metrics: ["tool.calls"],
    filter: { period: READ_METRICS_WINDOW, plugin: "guard" },
    groupBy: [],
    compare: { by: "pluginVersion", a: "sha256:aaa", b: "unknown" },
  });
  if (!unknownSide.ok) throw new Bug("pluginVersion compare must answer with unknown");
  expect(unknownSide.value.rows[1]).toEqual({
    key: { pluginVersion: "unknown" },
    values: { "tool.calls": { value: 0, n: 0, state: "exact" } },
  });
  expect(unknownSide.value.notes).toContainEqual({
    metric: "tool.calls",
    code: "confounded",
    text: "unknown group: versionId or profileRev is not recorded for these turns",
  });
  // 비교 차원의 필터가 없으면 거부한다
  const noPlugin = port.metrics({
    metrics: ["tool.calls"],
    filter: { period: READ_METRICS_WINDOW },
    groupBy: [],
    compare: { by: "pluginVersion", a: "sha256:aaa", b: "sha256:bbb" },
  });
  expect(noPlugin.ok).toBe(false);
  store.close();
});

test("compare by profileRev groups the turns by tr_turn.profile_rev for the one profile", () => {
  const store = memory();
  const T = "thr_rev";
  writeSteps(
    store,
    T,
    "trn_r1",
    NOW - 10 * HOUR,
    [
      {
        index: 0,
        calls: [
          call(T, "trn_r1", "r1a", { plugin: "guard" }),
          call(T, "trn_r1", "r1b", { plugin: "guard" }),
        ],
      },
    ],
    { profileRev: 1 },
  );
  writeSteps(
    store,
    T,
    "trn_r2",
    NOW - 11 * HOUR,
    [{ index: 0, calls: [call(T, "trn_r2", "r2a", { plugin: "guard" })] }],
    { profileRev: 2 },
  );
  const out = portOf(store, 1).metrics({
    metrics: ["tool.calls"],
    filter: { period: READ_METRICS_WINDOW, profileId: "prof-1", plugin: "guard" },
    groupBy: [],
    compare: { by: "profileRev", a: "1", b: "2" },
  });
  if (!out.ok) throw new Bug("profileRev compare must answer in this test");
  expect(out.value.rows.map((row) => row.values["tool.calls"])).toEqual([
    { value: 2, n: 2, state: "exact" },
    { value: 1, n: 1, state: "exact" },
  ]);
  // 모델이 같고 버전도 이 비교에 없으므로 함께 바뀐 차원이 없다
  expect(out.value.notes).toEqual([]);
  store.close();
});

test("cache_break_by_plugin fires on the observed breaks of one plugin and stays silent under the share and count", () => {
  const store = memory();
  const T = "thr_cbp";
  // 열 턴 모두 guard의 관찰 깨짐(쓰기 1000): 깨짐 10회, 플러그인 턴 10 → 턴당 1000토큰
  for (let i = 0; i < 10; i += 1) {
    const turn = `trn_cb${String(i)}`;
    writeSteps(store, T, turn, NOW - (i + 1) * HOUR, [
      { index: 0, cache: [causeRow(T, turn, 0, "prefix_reset", "guard", true, 1000)] },
    ]);
  }
  // helm은 스무 턴에 실렸고(지침으로 턴마다 낀 플러그인) 깨짐은 둘뿐이라 10회도 20%도 못 넘는다
  const H = "thr_cbp_helm";
  for (let i = 0; i < 20; i += 1) {
    const turn = `trn_hm${String(i)}`;
    writeSteps(
      store,
      H,
      turn,
      NOW - (i + 30) * HOUR,
      [
        {
          index: 0,
          cache: i < 2 ? [causeRow(H, turn, 0, "section", "helm", true, 10)] : [],
        },
      ],
      {},
      { materials: [material(H, turn, "r-helm", "helm", 10)] },
    );
  }
  const found = portOf(store, 1).findingsList({ profileId: null, period: null, state: null });
  if (!found.ok) throw new Bug("findings must list in this test");
  const cache = found.value.findings.filter((f) => f.ruleId === "cache_break_by_plugin");
  expect(cache).toHaveLength(1);
  expect(cache[0]).toMatchObject({
    subject: { kind: "block", plugin: "guard", ref: "context" },
    impact: { unit: "tokens_per_turn", value: 1000 },
    evidenceTotal: 10,
    state: "open",
  });
  expect(cache[0]?.next.length).toBeGreaterThan(0);
  store.close();
});

test("drive_budget_exhausted fires when the budget share of one plugin's exits reaches the threshold", () => {
  const store = memory();
  const T = "thr_dbe";
  // helm의 반납 다섯: 한도 소진 셋, 끝남 둘
  const reasons = ["budget", "budget", "budget", "done", "done"];
  reasons.forEach((reason, i) => {
    const turn = `trn_db${String(i)}`;
    writeSteps(store, T, turn, NOW - (i + 1) * HOUR, [{ index: 0 }]);
    writeFrameRows(store, [
      frameRow(
        T,
        turn,
        `lease-db${String(i)}`,
        1,
        "helm",
        { entered: 0, exited: 1000 },
        reason,
        { maxTurns: 4 },
        { turns: 4 },
      ),
    ]);
  });
  const found = portOf(store, 1).findingsList({ profileId: null, period: null, state: null });
  if (!found.ok) throw new Bug("findings must list in this test");
  const drive = found.value.findings.filter((f) => f.ruleId === "drive_budget_exhausted");
  expect(drive).toHaveLength(1);
  expect(drive[0]).toMatchObject({
    subject: { kind: "drive", plugin: "helm", ref: null },
    impact: { unit: "hits", value: 3 },
    evidenceTotal: 3,
  });
  store.close();
});

test("rewrite_text marks a bash retry whose argument tokens overlap and different_path marks the rest", () => {
  const store = memory();
  const T = "thr_rw";
  const blocked = (turn: string, values: string[]) =>
    call(T, turn, `${turn}-b`, {
      tool: "bash",
      plugin: "core",
      verdict: "blocked_hook",
      blockedPlugin: "guard",
      blockedHook: "tool.call.before",
      callKey: `${turn}-kA`,
      metaJson: argTokensJson(values),
    });
  const next = (turn: string, values: string[]) =>
    call(T, turn, `${turn}-n`, {
      tool: "bash",
      plugin: "core",
      verdict: "allowed",
      stepIndex: 1,
      callKey: `${turn}-kB`,
      metaJson: argTokensJson(values),
    });
  // 턴 R1: 같은 토큰 다섯 가운데 다섯이 겹침(1.0 ≥ 0.8). 턴 R2: 겹침이 없다
  writeSteps(store, T, "trn_rw1", NOW - 10 * HOUR, [
    { index: 0, calls: [blocked("trn_rw1", ["a", "b", "c", "d", "e"])] },
    { index: 1, calls: [next("trn_rw1", ["a", "b", "c", "d", "e"])] },
  ]);
  writeSteps(store, T, "trn_rw2", NOW - 11 * HOUR, [
    { index: 0, calls: [blocked("trn_rw2", ["a", "b", "c", "d", "e"])] },
    { index: 1, calls: [next("trn_rw2", ["x", "y", "z", "w", "v"])] },
  ]);
  const values = valuesOf(portOf(store, 1), [
    "hook.post_block",
    "hook.post_block.rewrite_text",
    "hook.post_block.different_path",
  ]);
  expect(values["hook.post_block"]).toMatchObject({ value: 2 });
  expect(values["hook.post_block.rewrite_text"]).toMatchObject({ value: 0.5, denom: 2 });
  expect(values["hook.post_block.different_path"]).toMatchObject({ value: 0.5, denom: 2 });
  store.close();
});

test("rewrite_text is not_recorded when the calls carry only a numeric argTokens (the old count form, not a token list)", () => {
  const store = memory();
  const T = "thr_rw_count";
  // 예전 모양(숫자)의 `argTokens`는 목록이 아니다. 겹침을 잴 수 없으니 rewrite_text는 값이 없고 나머지는 센다
  const countOnly = (turn: string, stepIndex: number, extra: Partial<TrCallRow>) =>
    call(T, turn, `${turn}-${String(stepIndex)}`, {
      tool: "bash",
      plugin: "core",
      stepIndex,
      metaJson: JSON.stringify({ argTokens: 12 }),
      ...extra,
    });
  writeSteps(store, T, "trn_rc1", NOW - 10 * HOUR, [
    {
      index: 0,
      calls: [
        countOnly("trn_rc1", 0, {
          verdict: "blocked_hook",
          blockedPlugin: "guard",
          blockedHook: "tool.call.before",
          callKey: "rc1-a",
        }),
      ],
    },
    { index: 1, calls: [countOnly("trn_rc1", 1, { verdict: "allowed", callKey: "rc1-b" })] },
  ]);
  const values = valuesOf(portOf(store, 1), ["hook.post_block", "hook.post_block.rewrite_text"]);
  expect(values["hook.post_block"]).toMatchObject({ value: 1 });
  expect(values["hook.post_block.rewrite_text"]).toEqual({
    value: null,
    n: 0,
    state: "unavailable",
    reason: "not_recorded",
  });
  store.close();
});

test("the cache, block and drive counters read the same values from tr_daily as from the raw turns", () => {
  const store = memory();
  const T = "thr_fold_new";
  const base = NOW - 40 * DAY;
  for (let i = 0; i < 3; i += 1) {
    const turn = `trn_fn${String(i)}`;
    writeSteps(
      store,
      T,
      turn,
      base + i * HOUR,
      [
        {
          index: 0,
          input: 100,
          cacheRead: 200,
          cacheWrite: 20,
          calls: [call(T, turn, `fn${String(i)}`, { plugin: "guard", execMs: 7 })],
          hooks: [hook(T, turn, 1, { askVia: "decision", askMs: 50, atMs: 10 })],
          cache: [causeRow(T, turn, 0, "prefix_reset", "guard", i !== 1, 20)],
        },
        { index: 1 },
      ],
      { endedAt: base + i * HOUR + 3000 },
    );
    writeFrameRows(store, [
      frameRow(
        T,
        turn,
        `lease-fn${String(i)}`,
        1,
        "helm",
        { entered: 0, exited: 500 },
        i === 0 ? "budget" : "done",
        { maxTurns: 2 },
        { turns: 1 },
      ),
    ]);
  }
  const metrics = [
    "block.time_split",
    "block.time_split.tools",
    "block.time_split.ask",
    "block.cache_hit_rate",
    "block.cache_breaks",
    "block.cache_breaks.predicted",
    "block.cache_breaks_by_plugin",
    "block.cache_breaks_by_plugin.tokens",
    "drive.entries",
    "drive.exit_reasons.budget",
    "drive.usage_vs_limit",
  ];
  const before = valuesOf(portOf(store, 1), metrics, base - DAY, NOW);
  expect(before["drive.entries"]).toMatchObject({ value: 3 });
  must(store.prune(NOW, 30));
  expect(must(store.readTurn(T, "trn_fn0"))).toBeUndefined();
  const after = valuesOf(portOf(store, 1), metrics, base - DAY, NOW);
  expect(after).toEqual(before);
  expect(before["block.cache_breaks"]).toMatchObject({ value: 2 });
  store.close();
});

// ---- 보관 기간을 가로지르는 창: 접힌 턴과 원본 턴이 섞여도 값이 같다 ----------

/** 턴 하나: 단계 0에 캐시 원인 한 줄, 주도 프레임 한 줄(helm), 물음이 있으면 프레임 안의 물음 한 번 */
function writeSpanTurn(
  store: MeasureStore,
  thread: string,
  turn: string,
  startedAt: number,
  cause: {
    readonly kind: string;
    readonly plugin: string | null;
    readonly observed: boolean;
    readonly write: number;
  },
  exit: string,
  ask: boolean,
): void {
  writeSteps(
    store,
    thread,
    turn,
    startedAt,
    [
      {
        index: 0,
        input: 100,
        cacheRead: 200,
        cacheWrite: cause.write,
        calls: [call(thread, turn, `${turn}-c`, { plugin: "guard", execMs: 7 })],
        hooks: ask ? [hook(thread, turn, 1, { askVia: "decision", askMs: 50, atMs: 10 })] : [],
        cache: [causeRow(thread, turn, 0, cause.kind, cause.plugin, cause.observed, cause.write)],
      },
    ],
    { endedAt: startedAt + 3000 },
  );
  writeFrameRows(store, [
    frameRow(
      thread,
      turn,
      `lease-${turn}`,
      1,
      "helm",
      { entered: 0, exited: 500 },
      exit,
      { maxTurns: 2 },
      { turns: 1 },
    ),
  ]);
}

function rowsIn(path: string, table: string, thread: string): number {
  const raw = new Database(path);
  try {
    return colNum(
      colsOf(raw.query(`SELECT COUNT(*) AS n FROM ${table} WHERE thread_id = ?`).get(thread)),
      "n",
    );
  } finally {
    raw.close();
  }
}

test("a window that crosses the retention cutoff reads the same cache, block and drive values before and after the prune", () => {
  const dir = mkdtempSync(join(tmpdir(), "measure-span-"));
  try {
    const path = join(dir, "measure.db");
    const store = must(openMeasureStore(path));
    const T = "thr_span";
    // 창은 날 경계(UTC 0시)에서 시작한다. 보관 기간의 컷오프는 2026-10-19 12:00(UTC)이다
    const from = Date.UTC(2026, 9, 14);
    // 컷오프 앞의 세 턴. 셋째(10-19 09시)는 컷오프와 같은 날이지만 컷오프 앞이라 접힌다
    writeSpanTurn(
      store,
      T,
      "trn_sp1",
      Date.UTC(2026, 9, 15, 10),
      { kind: "prefix_reset", plugin: "guard", observed: true, write: 50 },
      "budget",
      true,
    );
    writeSpanTurn(
      store,
      T,
      "trn_sp2",
      Date.UTC(2026, 9, 17, 15),
      { kind: "ttl", plugin: null, observed: true, write: 0 },
      "done",
      false,
    );
    writeSpanTurn(
      store,
      T,
      "trn_sp3",
      Date.UTC(2026, 9, 19, 9),
      { kind: "toolset", plugin: "guard", observed: false, write: 0 },
      "budget",
      false,
    );
    // 컷오프 뒤: 원본으로 남는 두 턴
    writeSpanTurn(
      store,
      T,
      "trn_sp4",
      Date.UTC(2026, 9, 19, 13),
      { kind: "prefix_reset", plugin: "guard", observed: true, write: 30 },
      "done",
      true,
    );
    writeSpanTurn(
      store,
      T,
      "trn_sp5",
      Date.UTC(2026, 10, 10, 8),
      { kind: "prefix_reset", plugin: "guard", observed: true, write: 30 },
      "budget",
      false,
    );

    const metrics = [
      "block.cache_hit_rate",
      "block.cache_breaks",
      "block.cache_breaks.predicted",
      "block.cache_breaks.unattributed",
      "block.cache_breaks_by_plugin",
      "block.cache_breaks_by_plugin.tokens",
      "block.time_split.ask",
      "drive.entries",
      "drive.exit_reasons.budget",
      "drive.usage_vs_limit",
      "drive.asks",
    ];
    const before = valuesOf(portOf(store, 1), metrics, from, NOW);
    must(store.prune(NOW, 30));

    // 접힌 턴의 원본 행은 지워지고 원본 턴 둘의 행만 남는다
    expect(must(store.readTurn(T, "trn_sp1"))).toBeUndefined();
    expect(rowsIn(path, "tr_turn", T)).toBe(2);
    expect(rowsIn(path, "tr_cache", T)).toBe(2);
    expect(rowsIn(path, "tr_frame", T)).toBe(2);
    // 접힌 값은 tr_daily에 남는다: 프레임 진입 셋은 helm의 세 번
    expect(
      must(store.dailyCounters("drive"))
        .filter((row) => row.counter === "entries")
        .map((row) => [row.day, row.plugin, row.n]),
    ).toEqual([
      ["2026-10-15", "helm", 1],
      ["2026-10-17", "helm", 1],
      ["2026-10-19", "helm", 1],
    ]);

    const after = valuesOf(portOf(store, 1), metrics, from, NOW);
    expect(after).toEqual(before);
    expect(before["drive.entries"]).toMatchObject({ value: 5, state: "exact" });
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- 모든 대화의 최근 턴(turnRecord.recent, AGE-36) ------------------------

type RecentArgs = Partial<Parameters<TurnRecordReadPort["recent"]>[0]>;

function recentOf(port: TurnRecordReadPort, args: RecentArgs = {}) {
  const out = port.recent({
    from: null,
    to: null,
    profileId: null,
    plugin: null,
    scopes: null,
    cursor: null,
    limit: 50,
    titleOf: (threadId) => ok({ title: `title of ${threadId}` }),
    ...args,
  });
  if (!out.ok) throw new Bug("recent must answer in this test");
  return out.value;
}

function putTurn(
  store: MeasureStore,
  thread: string,
  turn: string,
  startedAt: number,
  extra: Partial<TrTurnRow> = {},
  parts: Parameters<typeof writeTurn>[4] = {},
): void {
  writeTurn(store, thread, turn, startedAt, parts, {
    recordJson: recordJson(thread, turn, startedAt),
    ...extra,
  });
}

test("turnRecord.recent lists turns of every thread by start time, newest first, with titles", () => {
  const store = memory();
  // 시작 시각 순서와 저장 순서가 다르다(늦게 저장된 오래된 턴)
  putTurn(store, "thr_a", "trn_a1", NOW - 3 * HOUR);
  putTurn(store, "thr_b", "trn_b1", NOW - 1 * HOUR);
  putTurn(store, "thr_a", "trn_a2", NOW - 2 * HOUR);
  putTurn(store, "thr_c", "trn_c0", NOW - 4 * HOUR);
  const out = recentOf(portOf(store));
  expect(out.items.map((i) => [i.turn.threadId, i.turn.turnId, i.title])).toEqual([
    ["thr_b", "trn_b1", "title of thr_b"],
    ["thr_a", "trn_a2", "title of thr_a"],
    ["thr_a", "trn_a1", "title of thr_a"],
    ["thr_c", "trn_c0", "title of thr_c"],
  ]);
  expect(out.next).toBeNull();
  store.close();
});

test("turnRecord.recent pages with a cursor and a turn that appears while reading is neither repeated nor lost", () => {
  const store = memory();
  for (let i = 0; i < 7; i += 1)
    putTurn(store, `thr_${String(i % 3)}`, `trn_${String(i)}`, NOW - (10 - i) * HOUR);
  // 시작 시각이 같은 두 턴은 행 id로 가른다
  putTurn(store, "thr_9", "trn_tie1", NOW - 20 * HOUR);
  putTurn(store, "thr_9", "trn_tie2", NOW - 20 * HOUR);
  const port = portOf(store);
  const first = recentOf(port, { limit: 3 });
  expect(first.items.map((i) => i.turn.turnId)).toEqual(["trn_6", "trn_5", "trn_4"]);
  expect(first.next).not.toBeNull();
  // 첫 쪽을 읽은 뒤 가장 새 턴이 생긴다
  putTurn(store, "thr_new", "trn_new", NOW);
  const seen = first.items.map((i) => i.turn.turnId);
  let cursor = first.next;
  while (cursor !== null) {
    const page = recentOf(port, { limit: 3, cursor });
    seen.push(...page.items.map((i) => i.turn.turnId));
    cursor = page.next;
  }
  expect(seen).toEqual([
    "trn_6",
    "trn_5",
    "trn_4",
    "trn_3",
    "trn_2",
    "trn_1",
    "trn_0",
    "trn_tie2",
    "trn_tie1",
  ]);
  // 새 턴은 처음부터 다시 읽으면 맨 앞에 온다
  expect(recentOf(port, { limit: 1 }).items[0]?.turn.turnId).toBe("trn_new");
  store.close();
});

test("turnRecord.recent filters by period, profile, plugin decision and scope, and hides test runs by default", () => {
  const store = memory();
  putTurn(store, "thr_a", "trn_old", NOW - 10 * DAY);
  putTurn(store, "thr_a", "trn_p2", NOW - 3 * HOUR, { profileId: "prof-2" });
  putTurn(
    store,
    "thr_a",
    "trn_blocked",
    NOW - 2 * HOUR,
    {},
    {
      hooks: [hook("thr_a", "trn_blocked", 1, { plugin: "guard", result: "blocked" })],
    },
  );
  putTurn(
    store,
    "thr_a",
    "trn_passed",
    NOW - 1 * HOUR,
    {},
    {
      hooks: [
        hook("thr_a", "trn_passed", 1, { plugin: "guard", result: "passed", decision: "none" }),
      ],
    },
  );
  putTurn(
    store,
    "thr_a",
    "trn_asked",
    NOW - 30 * 60_000,
    {},
    {
      hooks: [
        hook("thr_a", "trn_asked", 1, { plugin: "other", result: "passed", decision: "ask" }),
      ],
    },
  );
  putTurn(store, "thr_t", "trn_test", NOW - 20 * 60_000, { scopeKind: "test" });
  const port = portOf(store);
  const ids = (args: RecentArgs) => recentOf(port, args).items.map((i) => i.turn.turnId);
  expect(ids({})).toEqual(["trn_asked", "trn_passed", "trn_blocked", "trn_p2", "trn_old"]);
  expect(ids({ scopes: ["test"] })).toEqual(["trn_test"]);
  expect(ids({ from: NOW - 4 * HOUR, to: NOW - HOUR })).toEqual(["trn_blocked", "trn_p2"]);
  expect(ids({ profileId: "prof-2" })).toEqual(["trn_p2"]);
  // 통과만 한 턴과 다른 플러그인의 결정은 남지 않는다
  expect(ids({ plugin: "guard" })).toEqual(["trn_blocked"]);
  expect(ids({ plugin: "other" })).toEqual(["trn_asked"]);
  expect(ids({ plugin: "nobody" })).toEqual([]);
  store.close();
});

test("turnRecord.recent answers empty for an empty store and refuses a bad cursor or range", () => {
  const store = memory();
  const port = portOf(store);
  expect(recentOf(port)).toMatchObject({ items: [], next: null });
  const bad = port.recent({
    from: null,
    to: null,
    profileId: null,
    plugin: null,
    scopes: null,
    cursor: "nope",
    limit: 5,
    titleOf: () => ok({ title: null }),
  });
  expect(bad).toEqual({ ok: false, error: { kind: "invalid_cursor" } });
  const range = port.recent({
    from: 5,
    to: 5,
    profileId: null,
    plugin: null,
    scopes: null,
    cursor: null,
    limit: 5,
    titleOf: () => ok({ title: null }),
  });
  expect(range.ok).toBe(false);
  store.close();
});

const goneTitleOf: RecentArgs["titleOf"] = (threadId) =>
  ok(threadId === "thr_gone" ? undefined : { title: null });

test("turnRecord.recent leaves out turns of deleted threads and still fills the page", () => {
  const store = memory();
  for (let i = 0; i < 6; i += 1)
    putTurn(store, i < 4 ? "thr_gone" : "thr_live", `trn_${String(i)}`, NOW - (10 - i) * HOUR);
  const port = portOf(store);
  const out = recentOf(port, { limit: 2, titleOf: goneTitleOf });
  expect(out.items.map((i) => i.turn.turnId)).toEqual(["trn_5", "trn_4"]);
  // 남은 턴은 모두 지워진 대화의 것이라 쪽은 비고 끝난다
  const rest = recentOf(port, {
    limit: 2,
    titleOf: goneTitleOf,
    ...(out.next === null ? {} : { cursor: out.next }),
  });
  expect(rest).toMatchObject({ items: [], next: null });
  store.close();
});

test("turnRecord.recent keeps working on a store opened before the started_at index existed", () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-recent-"));
  try {
    const path = join(dir, "measure.db");
    const first = must(openMeasureStore(path));
    putTurn(first, "thr_a", "trn_1", NOW - HOUR);
    first.close();
    const raw = new Database(path);
    raw.run("DROP INDEX tr_turn_started");
    raw.close();
    const second = must(openMeasureStore(path));
    expect(recentOf(portOf(second)).items.map((i) => i.turn.turnId)).toEqual(["trn_1"]);
    const raw2 = new Database(path, { readonly: true });
    const found = raw2
      .query("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'tr_turn_started'")
      .all();
    raw2.close();
    expect(found).toHaveLength(1);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
