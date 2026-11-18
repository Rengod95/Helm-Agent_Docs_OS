// 턴 기록 벤치의 합성 Turn. 모델과 도구는 돌리지 않고, 단계마다 호스트가 실제로 받는 사건만 실제 모양으로 만든다
// (`step_context`, 모델 호출 사용량, 도구 호출 줄, 스킬 읽기, 계측 링 버퍼의 훅 실행, `step.completed`, `turn.completed`).
// 정본 `docs/xeon/review/m5/turn-record-metrics.md` §4.1·§4.3·§4.5. 시각과 식별자는 결정적이라 같은 시나리오는 같은 입력을 준다.

import { createHash } from "node:crypto";
import { Bug } from "@fresnel/contracts";
import type { IdFactory, StepId, ThreadId, TurnId } from "@fresnel/contracts/conversation";
import type {
  AdvertisedFact,
  AdvertisedToolFact,
  ContextMaterialFact,
  ContextTraceEvent,
  ToolCallTraceEvent,
  TraceTurnEntry,
} from "@fresnel/contracts/extensions";
import type { DurableEventEnvelope } from "@fresnel/contracts/records";
import type { UsageRecord } from "@fresnel/contracts/services";

/** 시나리오 하나의 모양. 훅, 재료, 광고 도구 수는 턴마다 같다(요청 수는 단계 수에 따라 달라지지 않는다) */
export interface Scenario {
  readonly steps: number;
  readonly callsPerStep: number;
  readonly hooksPerTurn: number;
  readonly materials: number;
  readonly tools: number;
}

const SCENARIO_STEPS = [1, 5, 20] as const;
const SCENARIO_CALLS = [0, 3, 10] as const;
const PLUGIN_COUNT = 12;
const TURN_BASE_AT = Date.UTC(2026, 10, 18, 9, 0, 0);
const TURN_SPACING_MS = 100_000;

/** 스텝 수 1·5·20과 단계당 도구 호출 0·3·10을 짠 아홉 시나리오. 훅 40, 재료 60, 광고 도구 80은 모두 같다 */
export function scenarioGrid(): readonly Scenario[] {
  return SCENARIO_STEPS.flatMap((steps) =>
    SCENARIO_CALLS.map((callsPerStep) => ({
      steps,
      callsPerStep,
      hooksPerTurn: 40,
      materials: 60,
      tools: 80,
    })),
  );
}

export function scenarioLabel(scenario: Scenario): string {
  return `steps=${String(scenario.steps)},calls=${String(scenario.callsPerStep)}`;
}

/** 단계 하나가 싱크에 넘기는 사건 묶음. 호출 순서대로 쓴다 */
interface SyntheticStep {
  readonly stepIndex: number;
  readonly context: ContextTraceEvent;
  readonly usage: UsageRecord;
  readonly calls: readonly ToolCallTraceEvent[];
  readonly skillReads: readonly ContextTraceEvent[];
  /** 이 단계에서 계측 링 버퍼에 쌓이는 훅 실행. 계측이 꺼진 턴에서는 쌓이지 않는다 */
  readonly hooks: readonly TraceTurnEntry[];
  readonly completed: DurableEventEnvelope;
}

export interface SyntheticTurn {
  readonly turnId: TurnId;
  readonly started: DurableEventEnvelope;
  readonly steps: readonly SyntheticStep[];
  readonly completed: DurableEventEnvelope;
}

interface ToolEntry {
  readonly name: string;
  readonly plugin: string;
  readonly tokens: number;
  readonly state: "advertised" | "deferred";
}

const MATERIAL_KINDS = ["always", "drive", "on_demand"] as const;
const MATERIAL_TYPES = [
  "instruction",
  "skill_index",
  "memory",
  "hook_text",
  "tool_defs",
  "skill_body",
] as const;
const HOOK_NAMES = ["tool.call.before", "tool.result", "boundary.step.after"] as const;

/** 순환 목록에서 값을 고른다. 빈 목록은 픽스처 버그다 */
function cyclic<T>(list: readonly T[], index: number): T {
  const value = list[index % list.length];
  if (value === undefined) throw new Bug("fixture: cyclic list must not be empty");
  return value;
}

function digestOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function pluginOf(index: number): string {
  return `plugin-${String(index % PLUGIN_COUNT)}`;
}

/** 광고 도구 목록. 여덟 개를 지연 도구로 둔다 */
function toolCatalog(count: number): readonly ToolEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `tool_${String(index)}`,
    plugin: pluginOf(index),
    tokens: 30 + ((index * 17) % 120),
    state: index % 10 === 9 ? "deferred" : "advertised",
  }));
}

/** 재료 목록. 턴의 단계마다 같은 재료가 실린다 */
function materialsOf(count: number): readonly ContextMaterialFact[] {
  return Array.from({ length: count }, (_, index) => ({
    plugin: pluginOf(index),
    versionId: null,
    registrationId: `${pluginOf(index)}:reg${String(index)}`,
    kind: cyclic(MATERIAL_KINDS, index),
    material: cyclic(MATERIAL_TYPES, index),
    ref: `section.${String(index)}`,
    tokens: 40 + ((index * 23) % 400),
    truncated: false,
    omitted: null,
    itemId: null,
    attribution: "declared" as const,
  }));
}

function advertisedOf(tools: readonly ToolEntry[]): AdvertisedFact {
  const byPlugin = new Map<string, { count: number; tokens: number; deferred: number }>();
  for (const tool of tools) {
    const row = byPlugin.get(tool.plugin) ?? { count: 0, tokens: 0, deferred: 0 };
    byPlugin.set(tool.plugin, {
      count: row.count + 1,
      tokens: row.tokens + tool.tokens,
      deferred: row.deferred + (tool.state === "deferred" ? 1 : 0),
    });
  }
  return {
    count: tools.length,
    tokens: tools.reduce((sum, tool) => sum + tool.tokens, 0),
    deferredCount: tools.filter((tool) => tool.state === "deferred").length,
    removedCount: 0,
    fingerprint: digestOf(`tools:${tools.map((tool) => tool.name).join(",")}`),
    byPlugin: [...byPlugin].map(([plugin, row]) => ({
      plugin,
      count: row.count,
      tokens: row.tokens,
      deferred: row.deferred,
      activated: 0,
    })),
    tools: tools.map((tool): AdvertisedToolFact => ({
      name: tool.name,
      plugin: tool.plugin,
      tokens: tool.tokens,
      state: tool.state,
    })),
    toolsOmitted: 0,
  };
}

/** 도구 호출 식별자. 훅 행이 이 값으로 호출에 붙는다 */
function toolCallIdOf(turnNo: number, step: number, call: number): string {
  return `call_${String(turnNo)}_${String(step)}_${String(call)}`;
}

/** 단계 시작 뒤 시각(ms, 턴 기준). 사건의 시각은 결정적이다 */
function stampOf(turnNo: number, offset: number): number {
  return TURN_BASE_AT + turnNo * TURN_SPACING_MS + offset;
}

const USAGE_PER_CALL = {
  input: 8000,
  output: 400,
  cacheRead: 6000,
  cacheWrite: 200,
  totalTokens: 14600,
  cost: { input: 0.01, output: 0.002, cacheRead: 0.001, cacheWrite: 0.0005, total: 0.0135 },
} as const;

interface SyntheticIds {
  readonly threadId: ThreadId;
  readonly ids: IdFactory;
}

/** 시나리오의 턴 하나를 만든다. 호출 전부가 `scenario`의 모양을 따른다 */
export function buildTurn(scenario: Scenario, turnNo: number, source: SyntheticIds): SyntheticTurn {
  const { threadId, ids } = source;
  const turnId = ids.next("trn");
  const tools = toolCatalog(scenario.tools);
  const materials = materialsOf(scenario.materials);
  const advertised = advertisedOf(tools);
  let seq = 0;
  const envelope = (
    kind: DurableEventEnvelope["kind"],
    payload: unknown,
    stepId: StepId | null,
    offset: number,
  ): DurableEventEnvelope => {
    seq += 1;
    return {
      id: ids.next("evt"),
      kind,
      version: 1,
      threadId,
      turnId,
      stepId,
      recordedAt: stampOf(turnNo, offset),
      causationId: null,
      correlationId: null,
      payload,
      durable: true,
      seq,
      parentId: null,
    };
  };
  const started = envelope(
    "turn.started",
    { inputItemIds: [], requestId: null, scopeId: null, origin: "user" },
    null,
    0,
  );
  const steps: SyntheticStep[] = [];
  for (let stepIndex = 1; stepIndex <= scenario.steps; stepIndex += 1) {
    const stepId = ids.next("stp");
    const base = stepIndex * 1000;
    const calls: ToolCallTraceEvent[] = [];
    for (let call = 0; call < scenario.callsPerStep; call += 1) {
      const isSkill = stepIndex === 1 && call === 0;
      const tool = isSkill
        ? { name: "skill_view", plugin: pluginOf(0) }
        : cyclic(tools, turnNo * 5 + stepIndex * 3 + call * 7);
      const toolCallId = toolCallIdOf(turnNo, stepIndex, call);
      calls.push({
        threadId,
        turnId,
        stepId,
        toolCallId,
        parentToolCallId: null,
        tool: tool.name,
        plugin: tool.plugin,
        caller: "main",
        callerPlugin: null,
        via: null,
        risk: "read",
        capability: null,
        argsHash: digestOf(`args:${toolCallId}`),
        argTokens: 40 + ((call * 11) % 60),
        targetHash: null,
        afterUntrusted: false,
        verdict: "allowed",
        blockedBy: null,
        policy: { effect: "allow", tier: "read" },
        approval: null,
        exec: {
          startedAt: stampOf(turnNo, base + call),
          durationMs: 6,
          status: "ok",
          effectId: null,
        },
        result: { tokens: 120, bytes: 480, truncated: false, isError: false, itemId: null },
        closedAt: stampOf(turnNo, base + call + 6),
      });
    }
    const skillReads: ContextTraceEvent[] =
      stepIndex === 1 && scenario.callsPerStep > 0
        ? [
            {
              kind: "skill_read",
              threadId,
              turnId,
              stepId,
              toolCallId: toolCallIdOf(turnNo, stepIndex, 0),
              name: "release-checklist",
            },
          ]
        : [];
    const hooks: TraceTurnEntry[] = [];
    for (let entry = 0; entry < scenario.hooksPerTurn; entry += 1) {
      if (entry % scenario.steps !== stepIndex - 1) continue;
      const hook = cyclic(HOOK_NAMES, entry);
      const plugin = pluginOf(entry);
      const modified = entry % 9 === 0;
      const toolCallId =
        hook === "tool.call.before" && scenario.callsPerStep > 0
          ? toolCallIdOf(turnNo, stepIndex, entry % scenario.callsPerStep)
          : undefined;
      hooks.push({
        seq: entry,
        hook,
        step: stepIndex,
        handlers: [
          {
            registrationId: `${plugin}:h${String(entry)}`,
            ms: 1 + (entry % 5),
            result: modified ? "modified" : "passed",
            atMs: entry * 3,
            size: modified ? 120 : 0,
            skippedBy: null,
            reason: null,
            plugin,
            versionId: null,
            sourceKind: "plugin",
            decision: "none",
            ...(toolCallId === undefined ? {} : { toolCallId }),
          },
        ],
      });
    }
    steps.push({
      stepIndex,
      context: {
        kind: "step_context",
        threadId,
        turnId,
        stepId,
        materials,
        advertised,
      },
      usage: {
        threadId,
        turnId,
        stepId,
        role: "main",
        scopeId: null,
        provider: "bench",
        modelId: "bench-model",
        usage: USAGE_PER_CALL,
        stopReason: "stop",
        aborted: false,
        recordedAt: stampOf(turnNo, base + 900),
        startedAt: stampOf(turnNo, base + 10),
        firstTokenAt: stampOf(turnNo, base + 40),
      },
      calls,
      skillReads,
      hooks,
      completed: envelope(
        "step.completed",
        {
          stepIndex,
          status: "completed",
          stopReason: "stop",
          assistantItemId: null,
          toolResultItemIds: [],
          composition: {
            system: 2400,
            tools: 1800 + scenario.tools * 20,
            sections: { instruction: 1200, memory: 300, hook_text: 500, tool_defs: 1800 },
            injected: 900,
            volatile: 120,
            history: 4000 + stepIndex * 900,
            total: 9000 + stepIndex * 900,
          },
        },
        stepId,
        base + 950,
      ),
    });
  }
  const completed = envelope(
    "turn.completed",
    {
      status: "completed",
      stepCount: scenario.steps,
      usage: {
        ...USAGE_PER_CALL,
        input: USAGE_PER_CALL.input * scenario.steps,
        output: USAGE_PER_CALL.output * scenario.steps,
        totalTokens: USAGE_PER_CALL.totalTokens * scenario.steps,
      },
      error: null,
    },
    null,
    TURN_SPACING_MS - 1,
  );
  return { turnId, started, steps, completed };
}
