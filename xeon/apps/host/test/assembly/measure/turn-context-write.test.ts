import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { Bug, parse, type Logger } from "@fresnel/contracts";
import type { StepId, ThreadId, TurnId } from "@fresnel/contracts/conversation";
import type {
  AdvertisedFact,
  ContextMaterialFact,
  ContextTraceEvent,
  ToolCallTraceEvent,
} from "@fresnel/contracts/extensions";
import type { CommitListener, DurableEventEnvelope } from "@fresnel/contracts/records";
import type { UsageRecord } from "@fresnel/contracts/services";
import { TurnRecordSchema } from "@fresnel/contracts/wire";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { startMeasurement, type MeasurementDeps } from "../../../src/assembly/measure/recorder.ts";
import {
  cacheBreakOf,
  cacheExpired,
  materialPlanOf,
  noteToolRows,
  pluginCostOf,
  type TurnToolRow,
} from "../../../src/assembly/measure/turn-context.ts";

// T-MEAS-CTX: 조립 재료·광고·스킬 읽기·캐시 원인의 값과 행. 값은 정확한 숫자와 문자열로 비교한다(정본 §3.2~3.4, §4.5).

const ids = fixedIdFactory();
const THREAD: ThreadId = ids.next("thr");
const TURN: TurnId = ids.next("trn");
const STEP: StepId = ids.next("stp");
const AT = Date.UTC(2026, 10, 18, 9, 0, 0);

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
};

function envelope(
  seq: number,
  kind: DurableEventEnvelope["kind"],
  payload: unknown,
  stepId: StepId | null = null,
): DurableEventEnvelope {
  return {
    id: ids.next("evt"),
    kind,
    version: 1,
    threadId: THREAD,
    turnId: TURN,
    stepId,
    recordedAt: AT + seq * 10,
    causationId: null,
    correlationId: null,
    payload,
    durable: true,
    seq,
    parentId: null,
  };
}

const TURN_STARTED = { inputItemIds: [], requestId: null, scopeId: null, origin: "user" };
const TURN_COMPLETED = { status: "completed", stepCount: 1, usage: null, error: null };

function stepCompleted(stepIndex: number, warnings: readonly unknown[] = []): unknown {
  return {
    stepIndex,
    status: "completed",
    stopReason: "stop",
    assistantItemId: null,
    toolResultItemIds: [],
    ...(warnings.length === 0 ? {} : { contextWarnings: warnings }),
  };
}

function usage(
  stepId: StepId,
  startedAt: number,
  cacheRead: number,
  cacheWrite: number,
): UsageRecord {
  return {
    threadId: THREAD,
    turnId: TURN,
    stepId,
    role: "main",
    scopeId: null,
    provider: "tape",
    modelId: "tape-1",
    usage: {
      input: 10,
      output: 5,
      cacheRead,
      cacheWrite,
      totalTokens: 15 + cacheRead + cacheWrite,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    aborted: false,
    recordedAt: startedAt + 10,
    startedAt,
    firstTokenAt: startedAt + 2,
  };
}

function material(overrides: Partial<ContextMaterialFact>): ContextMaterialFact {
  return {
    plugin: "alpha",
    versionId: null,
    registrationId: null,
    kind: "always",
    material: "instruction",
    ref: "guides/style.md",
    tokens: 12,
    truncated: false,
    omitted: null,
    itemId: null,
    attribution: "declared",
    ...overrides,
  };
}

function advertisedOf(overrides: Partial<AdvertisedFact>): AdvertisedFact {
  return {
    count: 2,
    tokens: 14,
    deferredCount: 0,
    removedCount: 0,
    fingerprint: "sha256:step-one",
    byPlugin: [{ plugin: "alpha", count: 1, tokens: 10, deferred: 0, activated: 0 }],
    tools: [
      { name: "a-run", plugin: "alpha", tokens: 10, state: "advertised" },
      { name: "k-view", plugin: "knowledge", tokens: 4, state: "advertised" },
    ],
    toolsOmitted: 0,
    ...overrides,
  };
}

function callOf(overrides: Partial<ToolCallTraceEvent>): ToolCallTraceEvent {
  return {
    threadId: THREAD,
    turnId: TURN,
    stepId: STEP,
    toolCallId: "call-1",
    parentToolCallId: null,
    tool: "a-run",
    plugin: "alpha",
    caller: "main",
    callerPlugin: null,
    via: null,
    risk: "read",
    capability: null,
    argsHash: "a".repeat(64),
    argTokens: 3,
    targetHash: null,
    afterUntrusted: false,
    verdict: "allowed",
    blockedBy: null,
    policy: null,
    approval: null,
    exec: null,
    result: { tokens: 40, bytes: 160, truncated: false, isError: false, itemId: null },
    closedAt: AT,
    ...overrides,
  };
}

interface Rig {
  readonly commit: (events: readonly DurableEventEnvelope[]) => void;
  readonly meter: (record: UsageRecord) => void;
  readonly context: (event: ContextTraceEvent) => void;
  readonly call: (event: ToolCallTraceEvent) => void;
  readonly measurement: ReturnType<typeof startMeasurement>;
}

function open(dir: string, enabled: boolean): Rig {
  const listeners = new Set<CommitListener>();
  let meterListener: ((record: UsageRecord) => void) | undefined;
  const deps: MeasurementDeps = {
    dir,
    session: {
      feed: {
        onCommit: (listener: CommitListener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      },
    },
    usage: {
      subscribe: (listener) => {
        meterListener = listener;
        return () => {
          meterListener = undefined;
        };
      },
    },
    enabled: () => enabled,
    logger,
    now: () => AT,
  };
  const measurement = startMeasurement(deps);
  return {
    measurement,
    commit: (events) => {
      for (const listener of listeners) listener({ firstSeq: 1, lastSeq: events.length, events });
    },
    meter: (record) => {
      meterListener?.(record);
    },
    context: (event) => {
      measurement.offerContext(event);
    },
    call: (event) => {
      measurement.offerCall(event);
    },
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
}

function bundleOf(rig: Rig) {
  const store = rig.measurement.store;
  if (store === undefined) throw new Bug("the measure database must open in this test");
  const bundle = store.readTurn(THREAD, TURN);
  if (!bundle.ok || bundle.value === undefined) throw new Bug("the turn must be readable");
  return bundle.value;
}

// ---- 순수 함수 --------------------------------------------------------------

test("cache_expiry_judgment_uses_the_same_thresholds_as_the_recorder", () => {
  const prior = { model: "m", cacheRead: 5000, cacheWrite: 400 };
  expect(cacheExpired(prior, { model: "m", cacheRead: 2000, cacheWrite: 1000 })).toBe(true);
  expect(cacheExpired(prior, { model: "m", cacheRead: 2600, cacheWrite: 1000 })).toBe(false);
  expect(cacheExpired(prior, { model: "m", cacheRead: 2000, cacheWrite: 999 })).toBe(false);
  expect(cacheExpired(prior, { model: "other", cacheRead: 2000, cacheWrite: 1000 })).toBe(false);
  expect(cacheExpired(undefined, { model: "m", cacheRead: 0, cacheWrite: 5000 })).toBe(false);
});

test("a_prefix_reset_that_also_breaks_usage_is_observed_and_owned_by_its_one_plugin", () => {
  const cache = cacheBreakOf({
    warnings: [
      { code: "cache_prefix_reset", changed: ["system"], owners: ["reg-1"], plugins: ["alpha"] },
    ],
    current: { model: "m", startedAt: AT, cacheRead: 2000, cacheWrite: 1000 },
    prior: { model: "m", endedAt: AT - 100, cacheRead: 5000, cacheWrite: 400 },
    compacted: false,
    pluginOfTool: () => undefined,
  });
  expect(cache).toEqual({
    observed: true,
    causes: [
      { kind: "prefix_reset", plugin: "alpha", registrations: ["reg-1"], evidence: "declared" },
    ],
    cacheRead: 2000,
    cacheWrite: 1000,
    priorCacheRead: 5000,
    priorCacheWrite: 400,
  });
});

test("a_structural_warning_without_a_usage_break_is_a_prediction_only", () => {
  const cache = cacheBreakOf({
    warnings: [{ code: "cache_reset_model_switch", from: "a/x", to: "b/y" }],
    // 읽기가 앞 읽기의 반(50)보다 많아 사용량은 깨지지 않았다
    current: { model: "m", startedAt: AT, cacheRead: 90, cacheWrite: 3000 },
    prior: { model: "m", endedAt: AT - 100, cacheRead: 100, cacheWrite: 100 },
    compacted: false,
    pluginOfTool: () => undefined,
  });
  expect(cache).toEqual({
    observed: false,
    causes: [{ kind: "model_switch", plugin: null, registrations: [], evidence: "declared" }],
    cacheRead: 90,
    cacheWrite: 3000,
    priorCacheRead: 100,
    priorCacheWrite: 100,
  });
});

test("a_prefix_reset_with_two_changers_has_no_single_owner_and_lists_the_candidates", () => {
  const cache = cacheBreakOf({
    warnings: [
      {
        code: "cache_prefix_reset",
        changed: ["sections"],
        owners: ["r1", "r2"],
        plugins: ["a", "b"],
      },
    ],
    current: undefined,
    prior: undefined,
    compacted: false,
    pluginOfTool: () => undefined,
  });
  expect(cache?.causes).toEqual([
    { kind: "section", plugin: null, registrations: ["r1", "r2"], evidence: "declared" },
  ]);
  expect(cache?.observed).toBe(false);
});

test("a_toolset_change_takes_the_plugin_only_when_every_tool_has_one_owner", () => {
  const owners: Record<string, string> = { "x-one": "xpl", "x-two": "xpl", "y-one": "ypl" };
  const pluginOfTool = (name: string): string | undefined => owners[name];
  const single = cacheBreakOf({
    warnings: [{ code: "tools_deferred", added: ["x-one"], removed: ["x-two"] }],
    current: undefined,
    prior: undefined,
    compacted: false,
    pluginOfTool,
  });
  expect(single?.causes).toEqual([
    { kind: "toolset", plugin: "xpl", registrations: [], evidence: "declared" },
  ]);
  const mixed = cacheBreakOf({
    warnings: [{ code: "tools_deferred", added: ["x-one", "y-one"], removed: [] }],
    current: undefined,
    prior: undefined,
    compacted: false,
    pluginOfTool,
  });
  expect(mixed?.causes).toEqual([
    { kind: "toolset", plugin: null, registrations: [], evidence: "declared" },
  ]);
});

test("usage_only_breaks_are_ttl_after_five_minutes_else_compaction_else_unknown", () => {
  const base = { model: "m", cacheRead: 5000, cacheWrite: 400, endedAt: AT };
  const current = (startedAt: number, compacted: boolean) =>
    cacheBreakOf({
      warnings: [],
      current: { model: "m", startedAt, cacheRead: 2000, cacheWrite: 1000 },
      prior: base,
      compacted,
      pluginOfTool: () => undefined,
    });
  expect(current(AT + 300_001, true)?.causes).toEqual([
    { kind: "ttl", plugin: null, registrations: [], evidence: "inferred" },
  ]);
  expect(current(AT + 1000, true)?.causes).toEqual([
    { kind: "compaction", plugin: null, registrations: [], evidence: "inferred" },
  ]);
  const unknown = current(AT + 1000, false);
  expect(unknown?.observed).toBe(true);
  expect(unknown?.causes).toEqual([
    { kind: "unknown", plugin: null, registrations: [], evidence: "inferred" },
  ]);
});

test("no_warning_and_no_usage_break_gives_no_cache_record", () => {
  expect(
    cacheBreakOf({
      warnings: [{ code: "near_window", tokens: 1, contextWindow: 2 }],
      current: { model: "m", startedAt: AT, cacheRead: 9000, cacheWrite: 10 },
      prior: { model: "m", endedAt: AT - 1, cacheRead: 9000, cacheWrite: 10 },
      compacted: false,
      pluginOfTool: () => undefined,
    }),
  ).toBeNull();
});

test("plugin_cost_sums_the_last_step_materials_tools_and_skill_reads_exactly", () => {
  const cost = pluginCostOf({
    materials: [material({ plugin: "alpha", kind: "always", tokens: 12 })],
    tools: [
      { plugin: "alpha", tokens: 10, state: "advertised" },
      { plugin: "alpha", tokens: 7, state: "activated" },
      { plugin: "knowledge", tokens: 4, state: "advertised" },
    ],
    skills: [{ plugin: "knowledge", tokens: 40 }],
  });
  expect(cost).toEqual([
    { plugin: "alpha", always: 22, drive: 0, onDemand: 7, shared: false },
    { plugin: "knowledge", always: 4, drive: 0, onDemand: 40, shared: false },
  ]);
});

test("material_plan_caps_the_kept_rows_and_writes_only_first_appearances", () => {
  const many = Array.from({ length: 5 }, (_, index) => material({ ref: `r${String(index)}` }));
  const plan = materialPlanOf({ materials: many, budget: 3, seen: new Set(["alpha\u0000r0"]) });
  expect(plan.kept.map((item) => item.ref)).toEqual(["r0", "r1", "r2"]);
  expect(plan.fresh.map((item) => item.ref)).toEqual(["r1", "r2"]);
  expect(plan.elided).toBe(2);
});

test("tool_rows_keep_the_first_tokens_track_state_and_count_calls", () => {
  const tools = new Map<string, TurnToolRow>();
  const first = noteToolRows({ tools, advertised: advertisedOf({}), calledNames: [] });
  expect(first.stepTools.map((row) => [row.name, row.state])).toEqual([
    ["a-run", "advertised"],
    ["k-view", "advertised"],
  ]);
  const second = noteToolRows({
    tools,
    advertised: advertisedOf({
      tools: [{ name: "a-run", plugin: "alpha", tokens: 99, state: "activated" }],
    }),
    calledNames: ["a-run", "a-run", "unknown-tool"],
  });
  expect(second.stepTools.map((row) => [row.name, row.state])).toEqual([["a-run", "activated"]]);
  expect(tools.get("a-run")).toEqual({
    name: "a-run",
    plugin: "alpha",
    tokens: 10,
    state: "activated",
    called: 2,
  });
  expect(second.touched).toEqual(new Set(["a-run"]));
});

// ---- 쓰는 쪽(기록기) --------------------------------------------------------

test("materials_tools_skills_and_cache_reach_the_rows_and_the_turn_record", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-context-"));
  try {
    const rig = open(dir, true);
    rig.commit([envelope(1, "turn.started", TURN_STARTED)]);
    rig.context({
      kind: "step_context",
      threadId: THREAD,
      turnId: TURN,
      stepId: STEP,
      materials: [material({ ref: "guides/style.md", tokens: 12 })],
      advertised: advertisedOf({}),
    });
    rig.context({
      kind: "skill_read",
      threadId: THREAD,
      turnId: TURN,
      stepId: STEP,
      toolCallId: "call-skill",
      name: "deploy",
    });
    rig.call(callOf({ toolCallId: "call-1", tool: "a-run", plugin: "alpha" }));
    rig.call(
      callOf({
        toolCallId: "call-skill",
        tool: "skill_view",
        plugin: "knowledge",
        result: { tokens: 40, bytes: 160, truncated: false, isError: false, itemId: null },
      }),
    );
    rig.meter(usage(STEP, AT + 5, 0, 2000));
    rig.commit([
      envelope(
        2,
        "step.completed",
        stepCompleted(1, [
          {
            code: "cache_prefix_reset",
            changed: ["system"],
            owners: ["reg-1"],
            plugins: ["alpha"],
          },
        ]),
        STEP,
      ),
    ]);
    rig.commit([envelope(3, "turn.completed", TURN_COMPLETED)]);
    await settle();

    const bundle = bundleOf(rig);
    expect(
      bundle.materials.map((row) => [
        row.stepIndex,
        row.plugin,
        row.ref,
        row.tokens,
        row.kind,
        row.attribution,
      ]),
    ).toEqual([[1, "alpha", "guides/style.md", 12, "always", "declared"]]);
    const tooluse = bundle.tooluse.toSorted((left, right) => (left.tool < right.tool ? -1 : 1));
    expect(tooluse.map((row) => [row.tool, row.plugin, row.tokens, row.state, row.called])).toEqual(
      [
        ["a-run", "alpha", 10, "advertised", 1],
        ["k-view", "knowledge", 4, "advertised", 0],
      ],
    );
    expect(bundle.tooluse.length).toBe(2);
    expect(
      bundle.skills.map((row) => [
        row.skill,
        row.plugin,
        row.listed,
        row.read,
        row.via,
        row.stepIndex,
        row.tokens,
      ]),
    ).toEqual([["deploy", "knowledge", false, true, "model", 1, 40]]);
    expect(
      bundle.cache.map((row) => [
        row.stepIndex,
        row.n,
        row.observed,
        row.kind,
        row.plugin,
        row.registrations,
        row.evidence,
      ]),
    ).toEqual([[1, 0, false, "prefix_reset", "alpha", '["reg-1"]', "declared"]]);
    expect(bundle.steps[0]).toMatchObject({
      advCount: 2,
      advTokens: 14,
      deferredCount: 0,
      toolsetFp: "sha256:step-one",
      materialsFp: expect.stringMatching(/^sha256:/),
    });

    const json: unknown = JSON.parse(bundle.turn.recordJson);
    const record = parse(TurnRecordSchema, json);
    if (!record.ok) throw new Bug("the turn record must validate");
    const step = record.value.steps[0];
    expect(step?.materials.map((item) => item.ref)).toEqual(["guides/style.md"]);
    expect(step?.advertised.tools.map((tool) => [tool.name, tool.state, tool.called])).toEqual([
      ["a-run", "advertised", 1],
      ["k-view", "advertised", 0],
    ]);
    expect(step?.cache?.observed).toBe(false);
    expect(record.value.skills.read).toEqual([
      { name: "deploy", plugin: "knowledge", via: "model", stepIndex: 1, tokens: 40 },
    ]);
    expect(record.value.cost).toEqual([
      { plugin: "alpha", always: 22, drive: 0, onDemand: 0, shared: false },
      { plugin: "knowledge", always: 4, drive: 0, onDemand: 40, shared: false },
    ]);
    expect(record.value.flags.cacheBreak).toBe(false);
    rig.measurement.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a_later_step_writes_only_new_materials_and_the_turn_counts_the_cap", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-context-"));
  try {
    const rig = open(dir, true);
    rig.commit([envelope(1, "turn.started", TURN_STARTED)]);
    const second = ids.next("stp");
    const manyMaterials = Array.from({ length: 203 }, (_, index) =>
      material({ ref: `m${String(index)}`, tokens: 1 }),
    );
    rig.context({
      kind: "step_context",
      threadId: THREAD,
      turnId: TURN,
      stepId: STEP,
      materials: manyMaterials,
      advertised: advertisedOf({}),
    });
    rig.commit([envelope(2, "step.completed", stepCompleted(1), STEP)]);
    rig.context({
      kind: "step_context",
      threadId: THREAD,
      turnId: TURN,
      stepId: second,
      materials: manyMaterials.slice(0, 2),
      advertised: advertisedOf({ fingerprint: "sha256:step-two" }),
    });
    rig.commit([envelope(3, "step.completed", stepCompleted(2), second)]);
    rig.commit([envelope(4, "turn.completed", TURN_COMPLETED)]);
    await settle();

    const bundle = bundleOf(rig);
    expect(bundle.materials.length).toBe(200);
    const json: unknown = JSON.parse(bundle.turn.recordJson);
    const record = parse(TurnRecordSchema, json);
    if (!record.ok) throw new Bug("the turn record must validate");
    // 첫 단계에서 200개를 싣고 3개를 넘겼다. 둘째 단계는 남은 상한이 없어 2개를 모두 넘겼다
    expect(record.value.elided.materials).toBe(5);
    expect(record.value.flags.truncatedMaterials).toBe(5);
    expect(record.value.steps[1]?.materials.length).toBe(0);
    rig.measurement.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the_tool_rows_stop_at_256_and_the_rest_are_counted_as_elided", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-context-"));
  try {
    const rig = open(dir, true);
    rig.commit([envelope(1, "turn.started", TURN_STARTED)]);
    const tools = Array.from({ length: 260 }, (_, index) => ({
      name: `t${String(index)}`,
      plugin: "bulk",
      tokens: 1,
      state: "advertised" as const,
    }));
    rig.context({
      kind: "step_context",
      threadId: THREAD,
      turnId: TURN,
      stepId: STEP,
      materials: [],
      advertised: advertisedOf({ count: 260, tokens: 260, tools, toolsOmitted: 0 }),
    });
    rig.commit([envelope(2, "step.completed", stepCompleted(1), STEP)]);
    rig.commit([envelope(3, "turn.completed", TURN_COMPLETED)]);
    await settle();
    const bundle = bundleOf(rig);
    expect(bundle.tooluse.length).toBe(256);
    const json: unknown = JSON.parse(bundle.turn.recordJson);
    const record = parse(TurnRecordSchema, json);
    if (!record.ok) throw new Bug("the turn record must validate");
    expect(record.value.elided.tools).toBe(4);
    rig.measurement.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a_compaction_before_the_step_and_a_usage_break_record_a_compaction_cause", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-context-"));
  try {
    const rig = open(dir, true);
    rig.commit([envelope(1, "turn.started", TURN_STARTED)]);
    rig.meter(usage(STEP, AT + 5, 5000, 400));
    rig.commit([envelope(2, "step.completed", stepCompleted(1), STEP)]);
    const second = ids.next("stp");
    rig.commit([envelope(3, "thread.compacted", { summary: "x" })]);
    rig.meter(usage(second, AT + 100, 2000, 1000));
    rig.commit([envelope(4, "step.completed", stepCompleted(2), second)]);
    rig.commit([envelope(5, "turn.completed", TURN_COMPLETED)]);
    await settle();
    const bundle = bundleOf(rig);
    expect(
      bundle.cache.map((row) => [
        row.stepIndex,
        row.observed,
        row.kind,
        row.evidence,
        row.priorCacheRead,
        row.priorCacheWrite,
      ]),
    ).toEqual([[2, true, "compaction", "inferred", 5000, 400]]);
    rig.measurement.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("with_the_measurement_off_the_context_events_write_no_rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-context-"));
  try {
    const rig = open(dir, false);
    rig.commit([envelope(1, "turn.started", TURN_STARTED)]);
    rig.context({
      kind: "step_context",
      threadId: THREAD,
      turnId: TURN,
      stepId: STEP,
      materials: [material({})],
      advertised: advertisedOf({}),
    });
    rig.commit([envelope(2, "step.completed", stepCompleted(1), STEP)]);
    rig.commit([envelope(3, "turn.completed", TURN_COMPLETED)]);
    await settle();
    const bundle = bundleOf(rig);
    expect(bundle.turn.level).toBe("log_only");
    expect(bundle.materials).toEqual([]);
    expect(bundle.tooluse).toEqual([]);
    rig.measurement.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
