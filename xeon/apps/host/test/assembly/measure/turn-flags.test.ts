import { expect, test } from "bun:test";
import type { CallRecord, FrameMark, HookRun, StepRecord } from "@fresnel/contracts/wire";
import {
  newDraft,
  turnFlagBitsOf,
  turnFlagsOf,
  type TurnDraft,
} from "../../../src/assembly/measure/turn-rows.ts";

// 턴 결과 수 표지(`TurnFlags`, 정본 턴 기록 §3.2, §4.2 규칙 15)의 순수 계산. 손으로 만든 호출과 훅 실행으로 값을 비교한다.

const PROFILE = { id: "default", rev: 0, source: "builtin", inherited: false } as const;

/** 턴 초안. 단계, 프레임, 자식, 범위를 시험이 채운다 */
function draftOf(): TurnDraft {
  return newDraft({
    threadId: "thr_flags",
    turnId: "trn_flags",
    startedAt: 1000,
    startedEventId: null,
    origin: "user",
    level: "full",
    maxBytes: 262_144,
    profile: PROFILE,
  });
}

function callOf(toolCallId: string, overrides: Partial<CallRecord> = {}): CallRecord {
  return {
    toolCallId,
    parentToolCallId: null,
    tool: "bash",
    plugin: "core",
    caller: "main",
    callerPlugin: null,
    via: null,
    risk: "exec",
    capability: null,
    callKey: "k0000000000000000",
    targetKey: null,
    afterUntrusted: false,
    verdict: "allowed",
    blockedBy: null,
    hooks: [],
    policy: null,
    approval: null,
    exec: null,
    result: null,
    ...overrides,
  };
}

function runOf(overrides: Partial<HookRun> = {}): HookRun {
  return {
    hook: "tool.call.before",
    registrationId: "ext:a",
    plugin: "ext",
    versionId: null,
    sourceKind: "plugin",
    seq: 0,
    subject: {},
    toolCallId: null,
    result: "passed",
    reason: null,
    decision: "none",
    ask: null,
    ms: 1,
    atMs: 1,
    size: 0,
    skippedBy: null,
    decisionText: null,
    ...overrides,
  };
}

function stepOf(
  stepIndex: number,
  parts: {
    readonly calls?: CallRecord[];
    readonly hooks?: HookRun[];
    readonly cache?: boolean;
  } = {},
): StepRecord {
  return {
    stepIndex,
    stepId: `stp_${String(stepIndex)}`,
    modelCalls: [],
    materials: [],
    advertised: {
      count: 0,
      tokens: 0,
      deferredCount: 0,
      removedCount: 0,
      fingerprint: "none",
      byPlugin: [],
      tools: [],
    },
    cache:
      parts.cache === true
        ? {
            observed: true,
            causes: [],
            cacheRead: 0,
            cacheWrite: 0,
            priorCacheRead: null,
            priorCacheWrite: null,
          }
        : null,
    hooks: parts.hooks ?? [],
    calls: parts.calls ?? [],
    composition: null,
    recorded: true,
  };
}

const ZERO_FLAGS = {
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

test("a turn with no calls, hooks, frames or children has all-zero flags", () => {
  const draft = draftOf();
  expect(turnFlagsOf(draft, [])).toEqual(ZERO_FLAGS);
  expect(turnFlagBitsOf(turnFlagsOf(draft, []))).toBe(0);
});

test("each call verdict counts once under its flag and an allowed call counts under none", () => {
  const draft = draftOf();
  const verdicts: CallRecord["verdict"][] = [
    "blocked_hook",
    "blocked_guard",
    "blocked_spawn",
    "blocked_hook_fault",
    "blocked_guard_fault",
    "denied_policy",
    "denied_human",
    "denied_human",
    "denied_noninteractive",
    "replaced_hook",
    "cancelled_ask",
    "allowed",
    "invalid_args",
  ];
  draft.steps.push(
    stepOf(0, {
      calls: verdicts.map((verdict, index) => callOf(`c${String(index)}`, { verdict })),
    }),
  );
  expect(turnFlagsOf(draft, [])).toEqual({
    ...ZERO_FLAGS,
    blockedIntent: 3,
    blockedFault: 2,
    deniedPolicy: 1,
    deniedHuman: 2,
    deniedNoninteractive: 1,
    replaced: 1,
    cancelledAsk: 1,
  });
});

test("failed hook runs split into timed out and other faults, and modified runs count on their own", () => {
  const draft = draftOf();
  draft.steps.push(
    stepOf(0, {
      hooks: [
        runOf({ result: "failed", reason: "threw", seq: 1 }),
        runOf({ result: "modified", seq: 2 }),
        runOf({ result: "failed", reason: "process_exit", seq: 3 }),
      ],
    }),
  );
  const turnHooks = [
    runOf({ result: "failed", reason: "timeout", seq: 0 }),
    runOf({ result: "failed", reason: "timeout", seq: 4 }),
  ];
  expect(turnFlagsOf(draft, turnHooks)).toEqual({
    ...ZERO_FLAGS,
    modified: 1,
    timedOut: 2,
    failed: 2,
  });
});

test("a hook run shown on its call and in the step's hooks is counted once", () => {
  const draft = draftOf();
  const run = runOf({ result: "modified", toolCallId: "c0", subject: { toolCallId: "c0" } });
  draft.steps.push(stepOf(0, { calls: [callOf("c0", { hooks: [run] })], hooks: [run] }));
  expect(turnFlagsOf(draft, []).modified).toBe(1);
});

test("a human question counts once per approval, a hook's own question without an approval counts per run, and an inherited approval is not a question", () => {
  const draft = draftOf();
  draft.steps.push(
    stepOf(0, {
      calls: [
        // 호출의 승인과 훅의 결정 물음이 같은 카드(apr_1)라 한 번이다
        callOf("c0", {
          verdict: "allowed",
          approval: {
            approvalId: "apr_1",
            decision: "allow",
            resolvedBy: "user",
            waitMs: 5,
            inheritedFrom: null,
          },
        }),
        callOf("c1", {
          verdict: "allowed",
          approval: {
            approvalId: "apr_2",
            decision: "allow",
            resolvedBy: "user",
            waitMs: 5,
            inheritedFrom: null,
          },
        }),
        // 바깥 호출의 승인을 물려받아 카드를 띄우지 않았으니 세지 않는다
        callOf("c2", {
          verdict: "allowed",
          approval: {
            approvalId: "apr_1",
            decision: "allow",
            resolvedBy: "user",
            waitMs: 0,
            inheritedFrom: "apr_out",
          },
        }),
      ],
      hooks: [
        runOf({
          toolCallId: "c0",
          decision: "ask",
          ask: { via: "decision", waits: 1, waitMs: 5, approvalId: "apr_1", answer: "allow" },
        }),
        runOf({
          seq: 5,
          ask: { via: "awaitUser", waits: 2, waitMs: 30, approvalId: null, answer: "deny" },
        }),
      ],
    }),
  );
  expect(turnFlagsOf(draft, []).asked).toBe(3);
});

test("drive, children, cache break, truncated materials and the draft scope read from the draft", () => {
  const draft = draftOf();
  const frame: FrameMark = {
    depth: 1,
    plugin: "helm",
    versionId: null,
    leaseId: "lease_1",
    parentLeaseId: null,
    enteredAtMs: 0,
    exitedAtMs: null,
    exitReason: null,
    lowerResumedWith: null,
    limits: {},
    used: { turns: 0, spawns: 0, tokens: 0 },
    userMessages: 0,
  };
  draft.frames.push(frame);
  draft.spawnedChildren.add("thr_child_1");
  draft.spawnedChildren.add("thr_child_2");
  draft.spawnedChildren.add("thr_child_1");
  draft.elidedMaterials = 4;
  draft.scope = "overlay_draft";
  draft.steps.push(stepOf(0, { cache: true }));
  expect(turnFlagsOf(draft, [])).toEqual({
    ...ZERO_FLAGS,
    drive: true,
    cacheBreak: true,
    subagents: 2,
    truncatedMaterials: 4,
    draftActive: true,
  });
});

test("a write by a plugin caller that ran through the pipeline does not set untrackedWrite, which has no observed-call source", () => {
  const draft = draftOf();
  draft.steps.push(
    stepOf(0, {
      calls: [
        callOf("c0", {
          caller: "plugin",
          callerPlugin: "helm",
          risk: "write",
          exec: { startedAtMs: 0, durationMs: 1, status: "ok", effectId: "efx_1" },
        }),
      ],
    }),
  );
  expect(turnFlagsOf(draft, []).untrackedWrite).toBe(false);
});

test("the flag bits follow the key order: a boolean sets its bit and a count sets its bit when above zero", () => {
  const draft = draftOf();
  draft.steps.push(stepOf(0, { calls: [callOf("c0", { verdict: "blocked_hook" })] }));
  draft.frames.push({
    depth: 1,
    plugin: "helm",
    versionId: null,
    leaseId: "lease_1",
    parentLeaseId: null,
    enteredAtMs: 0,
    exitedAtMs: null,
    exitReason: null,
    lowerResumedWith: null,
    limits: {},
    used: { turns: 0, spawns: 0, tokens: 0 },
    userMessages: 0,
  });
  draft.spawnedChildren.add("thr_child_1");
  // blockedIntent(bit 0) + drive(bit 11) + subagents(bit 13) = 1 + 2048 + 8192
  expect(turnFlagBitsOf(turnFlagsOf(draft, []))).toBe(10241);
});
