// 트레이스 화면의 표본 장면(개발 빌드만). 찍기와 상태 확인용이다. 값은 화면 모양을 보이려는 것이고 실제 엔진 값이 아니다.
// 턴 하나: repo-guard가 위험한 명령을 막고, review-flow가 사람에게 묻고, commit-style이 고치고, issue-sync가 시간 초과로 고장 난다.
// review-flow의 Drive가 한 겹 돈다. 많은 기록 장면은 턴 3,000개를 50개씩 쪽으로 준다.
import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type {
  CallRecord,
  HookRun,
  Material,
  StepRecord,
  TurnFlags,
  TurnRecord,
  TurnRecordGetResult,
  TurnSummary,
} from "@fresnel/contracts/wire";
import type { Load } from "../metrics/source.ts";
import type { TraceActions, TraceData, TurnPage } from "./source.ts";

export const TRACE_SCENES = [
  "live",
  "sample",
  "running",
  "pending",
  "partial",
  "many",
  "empty",
  "absent",
  "nothread",
  "loading",
  "failed",
  "offline",
] as const;
export type TraceScene = (typeof TRACE_SCENES)[number];

export const SAMPLE_THREAD = "thr_sample";
const BASE = Date.UTC(2026, 10, 19, 5, 12, 4);

function flags(patch: Partial<TurnFlags>): TurnFlags {
  return {
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
    ...patch,
  };
}

function hook(
  name: string,
  plugin: string,
  atMs: number,
  ms: number,
  patch: Partial<HookRun> = {},
): HookRun {
  return {
    hook: name,
    registrationId: `reg_${plugin}_${name}`,
    plugin,
    versionId: null,
    sourceKind: "plugin",
    seq: 0,
    subject: {},
    toolCallId: null,
    result: "passed",
    reason: null,
    decision: "none",
    ask: null,
    ms,
    atMs,
    size: 0,
    skippedBy: null,
    decisionText: null,
    ...patch,
  };
}

function material(
  plugin: string,
  kind: Material["material"],
  tokens: number,
  patch: Partial<Material> = {},
): Material {
  return {
    plugin,
    versionId: null,
    registrationId: null,
    kind: "always",
    material: kind,
    ref: `${plugin}/${kind}`,
    tokens,
    truncated: false,
    omitted: null,
    itemId: null,
    attribution: "declared",
    ...patch,
  };
}

function call(
  id: string,
  tool: string,
  plugin: string,
  startedAtMs: number,
  durationMs: number | null,
  patch: Partial<CallRecord> = {},
): CallRecord {
  return {
    toolCallId: id,
    parentToolCallId: null,
    tool,
    plugin,
    caller: "main",
    callerPlugin: null,
    via: null,
    risk: "read",
    capability: null,
    callKey: "0000000000000000",
    targetKey: null,
    afterUntrusted: false,
    verdict: "allowed",
    blockedBy: null,
    hooks: [],
    policy: null,
    approval: null,
    exec: { startedAtMs, durationMs, status: "ok", effectId: null },
    result: { tokens: 420, bytes: 1800, truncated: false, isError: false, itemId: null },
    ...patch,
  };
}

const MATERIALS: Material[] = [
  material("repo-guard", "instruction", 820),
  material("review-flow", "instruction", 1460, { kind: "drive" }),
  material("review-flow", "skill_index", 380),
  material("review-flow", "tool_defs", 940),
  material("commit-style", "instruction", 610),
  material("web-research", "tool_defs", 1720),
  material("web-research", "skill_index", 240, { kind: "on_demand" }),
  material("docs-voice", "instruction", 2240, { truncated: true }),
  material("issue-sync", "tool_defs", 520),
];

function step(
  index: number,
  at: number,
  len: number,
  calls: CallRecord[],
  hooks: HookRun[],
  open = false,
): StepRecord {
  return {
    stepIndex: index,
    stepId: `stp_${String(index)}`,
    modelCalls: [
      {
        role: "main",
        label: null,
        provider: "sample",
        modelId: "sample-model",
        startedAtMs: at,
        durationMs: open ? 0 : len,
        firstTokenMs: 420,
        usage: {
          input: 14_200 + index * 2_100,
          output: 640 + index * 120,
          cacheRead: index === 0 ? 0 : 11_800,
          cacheWrite: index === 0 ? 12_400 : 900,
        },
        retries: 0,
        retryWaitMs: 0,
        stopReason: "tool_use",
      },
    ],
    materials: index === 0 ? MATERIALS : MATERIALS.filter((m) => m.kind !== "on_demand"),
    advertised: {
      count: 23,
      tokens: 3_180,
      deferredCount: 4,
      removedCount: 0,
      fingerprint: "sample",
      byPlugin: [],
      tools: [],
    },
    cache:
      index === 2
        ? {
            observed: true,
            causes: [
              { kind: "toolset", plugin: "web-research", registrations: [], evidence: "inferred" },
            ],
            cacheRead: 0,
            cacheWrite: 15_200,
            priorCacheRead: 11_800,
            priorCacheWrite: 900,
          }
        : null,
    hooks,
    calls,
    composition: null,
    recorded: true,
  };
}

/** 표본 턴 번호(`trn_sample_N`의 N). 목록의 시각과 같은 시작 시각을 준다 */
function sampleIndex(turnId: string): number {
  const n = Number(turnId.slice(turnId.lastIndexOf("_") + 1));
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export function sampleRecord(turnId: string, running: boolean): TurnRecord {
  const startedAt = BASE - sampleIndex(turnId) * 97_000;
  const s0 = step(
    0,
    180,
    2_400,
    [
      call("tc_1", "read_file", "core", 2_640, 120, {
        hooks: [hook("tool.call.before", "repo-guard", 2_600, 6, { toolCallId: "tc_1" })],
      }),
      call("tc_2", "bash", "core", 2_660, null, {
        risk: "exec",
        verdict: "blocked_hook",
        blockedBy: {
          plugin: "repo-guard",
          hook: "tool.call.before",
          registrationId: "reg_repo-guard_tool.call.before",
        },
        exec: null,
        result: null,
        hooks: [
          hook("tool.call.before", "repo-guard", 2_620, 14, {
            toolCallId: "tc_2",
            result: "blocked",
            decision: "block",
            decisionText: t("desktop.craft.trace.dev.sample.blocked"),
          }),
        ],
      }),
    ],
    [hook("request.context.before", "docs-voice", 160, 18, { result: "modified", size: 340 })],
  );
  const s1 = step(
    1,
    2_900,
    3_100,
    [
      call("tc_3", "git_commit", "commit-style", 9_400, 860, {
        risk: "write",
        approval: {
          approvalId: "ap_1",
          decision: "allow",
          resolvedBy: "human",
          waitMs: 3_200,
          inheritedFrom: null,
        },
        hooks: [
          hook("tool.call.before", "review-flow", 6_020, 22, {
            toolCallId: "tc_3",
            decision: "ask",
            decisionText: t("desktop.craft.trace.dev.sample.asked"),
            ask: { via: "decision", waits: 1, waitMs: 3_200, approvalId: "ap_1", answer: "allow" },
          }),
          hook("tool.call.before", "commit-style", 6_050, 31, {
            toolCallId: "tc_3",
            result: "modified",
            size: 64,
          }),
          hook("tool.result", "issue-sync", 10_270, 2_000, {
            toolCallId: "tc_3",
            result: "failed",
            reason: "timeout",
          }),
        ],
      }),
      call("tc_4", "web_search", "web-research", 6_100, 1_900),
    ],
    [hook("request.model.after", "repo-guard", 6_000, 4)],
  );
  const s2 = step(2, 12_400, running ? 0 : 2_700, [], [], running);
  const turnHooks = [
    hook("input.user.before", "repo-guard", 0, 3, { preTurn: true }),
    hook("thread.prompt.before", "review-flow", 40, 9),
    ...(running ? [] : [hook("boundary.turn.after", "review-flow", 15_120, 12)]),
  ];
  return {
    schema: 1,
    threadId: SAMPLE_THREAD,
    turnId,
    parent: null,
    origin: "user",
    startedAt,
    endedAt: running ? null : startedAt + 15_200,
    status: running ? "open" : "completed",
    level: "full",
    complete: !running,
    scope: "live",
    profile: { id: "default", rev: 4, source: "thread", inherited: false },
    profileRevChanges: [],
    overlay: null,
    testRun: null,
    children: [
      {
        childThreadId: "thr_sample_child",
        agent: "explorer",
        status: "completed",
        used: { turns: 3, tokens: 18_400 },
      },
    ],
    frames: [
      {
        depth: 1,
        plugin: "review-flow",
        versionId: null,
        leaseId: "lease_sample",
        parentLeaseId: null,
        enteredAtMs: 2_900,
        exitedAtMs: running ? null : 14_900,
        exitReason: running ? null : "done",
        lowerResumedWith: null,
        limits: { maxTurns: 6, maxTokens: 120_000 },
        used: { turns: 2, spawns: 1, tokens: 46_800 },
        userMessages: 1,
      },
    ],
    steps: [s0, s1, s2],
    turnHooks,
    continues: running
      ? []
      : [
          {
            atMs: 15_100,
            plugin: "review-flow",
            decided: "stop",
            reason: t("desktop.craft.trace.dev.sample.stopped"),
          },
        ],
    skills: {
      listed: ["review-checklist", "commit-message", "web-cite"],
      listedOmitted: 0,
      read: [
        {
          name: "review-checklist",
          plugin: "review-flow",
          via: "model",
          stepIndex: 1,
          tokens: 1_240,
        },
      ],
    },
    cost: [
      { plugin: "docs-voice", always: 2_240, drive: 0, onDemand: 0, shared: false },
      { plugin: "review-flow", always: 380, drive: 1_460, onDemand: 1_240, shared: false },
      { plugin: "web-research", always: 1_720, drive: 0, onDemand: 240, shared: false },
      { plugin: "repo-guard", always: 820, drive: 0, onDemand: 0, shared: false },
      { plugin: "commit-style", always: 610, drive: 0, onDemand: 0, shared: false },
      { plugin: "issue-sync", always: 520, drive: 0, onDemand: 0, shared: false },
    ],
    pluginCalls: [],
    pluginStderr: [],
    flags: flags({
      blockedIntent: 1,
      asked: 1,
      modified: 2,
      timedOut: 1,
      drive: true,
      cacheBreak: true,
      subagents: 1,
      truncatedMaterials: 1,
    }),
    elided: {},
  };
}

function summary(i: number): TurnSummary {
  return {
    threadId: SAMPLE_THREAD,
    turnId: `trn_sample_${String(i)}`,
    startedAt: BASE - i * 97_000,
    endedAt: BASE - i * 97_000 + 15_200,
    status: i === 7 ? "interrupted" : "completed",
    scope: "live",
    complete: true,
    profileId: "default",
    stepCount: 1 + (i % 4),
    callCount: (i * 3) % 7,
    flags: flags(i % 5 === 0 ? { blockedIntent: 1 } : {}),
    frameDepthMax: i % 3 === 0 ? 1 : 0,
    childCount: 0,
  };
}

function page(from: number, count: number, total: number): TurnPage {
  const n = Math.max(0, Math.min(count, total - from));
  return {
    items: Array.from({ length: n }, (_, k) => summary(from + k)),
    next: from + n < total ? String(from + n) : null,
    off: false,
  };
}

function ready<T>(value: T): Load<T> {
  return { kind: "ready", value, stale: false };
}

function got(record: TurnRecord): Load<TurnRecordGetResult> {
  return ready({ enabled: true, level: "full", record, absent: null });
}

const NO_ACTIONS: TraceActions = { reload: () => {}, pick: () => {}, more: () => {}, back: null };

/** 표본 장면의 원천. `turns`는 화면이 "더 보기"로 늘리는 쪽 수다 */
export function sampleTrace(
  scene: Exclude<TraceScene, "live">,
  state: { readonly turnId: string | null; readonly pages: number },
  actions: Partial<TraceActions>,
): TraceData {
  const all: TraceActions = { ...NO_ACTIONS, ...actions };
  const base = {
    link: "live" as const,
    threadId: SAMPLE_THREAD,
    from: "metrics" as const,
    loadingMore: false,
    watching: false,
    pending: [],
    actions: all,
  };
  const turnId = state.turnId ?? "trn_sample_0";
  switch (scene) {
    case "sample":
      return {
        ...base,
        turnId,
        turns: ready(page(0, 12, 12)),
        record: got(sampleRecord(turnId, false)),
      };
    case "running":
      return {
        ...base,
        turnId,
        watching: true,
        turns: ready(page(0, 12, 12)),
        record: got(sampleRecord(turnId, true)),
      };
    case "pending": {
      // 도는 턴: 단계 2가 아직 끝나지 않았는데 그 단계의 Hook 셋이 먼저 왔다(엔진이 실행 직후 보낸 행)
      const record = sampleRecord(turnId, true);
      const stepIndex = (record.steps.at(-1)?.stepIndex ?? 0) + 1;
      const early = (name: string, plugin: string, atMs: number, patch: Partial<HookRun>) => ({
        stepIndex,
        run: hook(name, plugin, atMs, 9, { seq: 900 + atMs, ...patch }),
      });
      return {
        ...base,
        turnId,
        watching: true,
        turns: ready(page(0, 12, 12)),
        record: got(record),
        pending: [
          early("request.context.before", "docs-voice", 12_520, { result: "modified", size: 220 }),
          early("tool.call.before", "repo-guard", 12_910, {
            result: "blocked",
            decision: "block",
            decisionText: t("desktop.craft.trace.dev.sample.blocked"),
          }),
          early("tool.call.before", "review-flow", 13_040, { decision: "ask" }),
        ],
      };
    }
    case "partial": {
      // 끊겼다 이어진 턴: 이어진 뒤의 단계만 남았고 `complete: false`다
      const full = sampleRecord(turnId, false);
      return {
        ...base,
        turnId,
        turns: ready(page(0, 12, 12)),
        record: got({ ...full, complete: false, steps: full.steps.slice(-1) }),
      };
    }
    case "many":
      return {
        ...base,
        turnId,
        turns: ready(page(0, 50 * state.pages, 3_000)),
        record: got(sampleRecord(turnId, false)),
      };
    case "empty":
      return {
        ...base,
        turnId: null,
        turns: ready({ items: [], next: null, off: false }),
        record: { kind: "loading" },
      };
    case "absent":
      return {
        ...base,
        turnId,
        turns: ready(page(0, 12, 12)),
        record: ready({ enabled: true, level: "full", record: null, absent: "purged" }),
      };
    case "nothread":
      return {
        ...base,
        threadId: null,
        turnId: null,
        from: "metrics",
        turns: { kind: "loading" },
        record: { kind: "loading" },
      };
    case "loading":
      return { ...base, turnId, turns: { kind: "loading" }, record: { kind: "loading" } };
    case "failed":
      return { ...base, turnId, turns: ready(page(0, 12, 12)), record: { kind: "error" } };
    case "offline":
      return {
        ...base,
        link: "offline",
        turnId,
        turns: { kind: "offline" },
        record: { kind: "offline" },
      };
    default:
      return assertNever(scene, "TraceScene");
  }
}
