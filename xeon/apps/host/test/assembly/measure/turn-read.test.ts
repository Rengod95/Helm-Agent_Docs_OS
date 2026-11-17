import { expect, test } from "bun:test";
import { Bug } from "@fresnel/contracts";
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
import type {
  TrCallRow,
  TrHookRow,
  TrMaterialRow,
  TrSkillRow,
  TrStepRow,
  TrToolUseRow,
  TrTurnRow,
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
): TurnRecordReadPort {
  return createTurnRecordPort({
    store: () => store,
    enabled: () => enabled,
    retentionDays: () => 30,
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
  const out = portOf(store).profileCost("prof-1");
  if (!out.ok) throw new Bug("profile cost must answer in this test");
  expect(out.value.basis).toBe("measured");
  expect(out.value.nTurns).toBe(1);
  expect(out.value.plugins.find((p) => p.plugin === "core")?.always).toBe(50);
  const none = portOf(store).profileCost("prof-empty");
  if (!none.ok) throw new Bug("profile cost must answer in this test");
  expect(none.value).toMatchObject({ basis: "estimated", nTurns: 0, plugins: [] });
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
  const missing = port.get(T, "trn_none");
  expect(missing).toEqual({
    ok: true,
    value: { enabled: true, level: "full", record: null, absent: "never_recorded" },
  });
  expect(portOf(store, 20, NOW, false).get(T, "trn_none")).toEqual({
    ok: true,
    value: { enabled: false, level: "log_only", record: null, absent: "off" },
  });
  store.close();
});
