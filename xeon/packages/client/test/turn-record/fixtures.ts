import type {
  CallRecord,
  DeltaRow,
  FrameMark,
  HookRun,
  StepRecord,
  TurnChild,
  TurnFlags,
  TurnRecord,
  TurnRecordDeltaParams,
  TurnSummary,
} from "@fresnel/contracts/wire";

// 턴 기록 시험의 값 도우미. 모양은 `packages/contracts/test/wire-settings/turn-record.test.ts`의 표본과 같고,
// 시험마다 필요한 칸만 `overrides`로 바꾼다. 단언(`as`)은 쓰지 않는다.

const FLAGS: TurnFlags = {
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

export function hookRunOf(overrides: Partial<HookRun> = {}): HookRun {
  return {
    hook: "tool.call.before",
    registrationId: "reg-guard",
    plugin: "guard",
    versionId: "v1",
    sourceKind: "plugin",
    seq: 1,
    subject: { toolCallId: "tc_1" },
    toolCallId: "tc_1",
    result: "passed",
    reason: null,
    decision: "none",
    ask: null,
    ms: 1.5,
    atMs: 0,
    size: 0,
    skippedBy: null,
    decisionText: null,
    ...overrides,
  };
}

export function callOf(overrides: Partial<CallRecord> = {}): CallRecord {
  return {
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

export function stepOf(stepIndex: number, overrides: Partial<StepRecord> = {}): StepRecord {
  return {
    stepIndex,
    stepId: `stp_${stepIndex}`,
    modelCalls: [],
    materials: [],
    advertised: {
      count: 0,
      tokens: 0,
      deferredCount: 0,
      removedCount: 0,
      fingerprint: "fp-0",
      byPlugin: [],
      tools: [],
    },
    cache: null,
    hooks: [],
    calls: [],
    composition: null,
    recorded: true,
    ...overrides,
  };
}

export function frameOf(overrides: Partial<FrameMark> = {}): FrameMark {
  return {
    depth: 1,
    plugin: "notes",
    versionId: "v1",
    leaseId: "lease_1",
    parentLeaseId: null,
    enteredAtMs: 10,
    exitedAtMs: null,
    exitReason: null,
    lowerResumedWith: null,
    limits: {},
    used: { turns: 0, spawns: 0, tokens: 0 },
    userMessages: 0,
    ...overrides,
  };
}

export function childOf(childThreadId: string, overrides: Partial<TurnChild> = {}): TurnChild {
  return {
    childThreadId,
    agent: "researcher",
    status: "running",
    used: null,
    ...overrides,
  };
}

/** 열린 턴 하나. 단계와 훅은 `overrides`로 넣는다 */
export function turnOf(overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    schema: 1,
    threadId: "thr_1",
    turnId: "trn_1",
    parent: null,
    origin: "user",
    startedAt: 1000,
    endedAt: null,
    status: "open",
    level: "full",
    complete: false,
    scope: "live",
    profile: { id: "default", rev: 3, source: "thread", inherited: false },
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
    flags: FLAGS,
    elided: {},
    ...overrides,
  };
}

export function summaryOf(turnId: string): TurnSummary {
  return {
    threadId: "thr_1",
    turnId,
    startedAt: 1000,
    endedAt: 2000,
    status: "completed",
    scope: "live",
    complete: true,
    profileId: "default",
    stepCount: 1,
    callCount: 0,
    flags: FLAGS,
    frameDepthMax: 0,
    childCount: 0,
  };
}

/** `turnRecord.delta` 알림 params 하나 */
export function deltaNotice(
  sub: string,
  turnId: string,
  rows: readonly DeltaRow[] = [],
): TurnRecordDeltaParams {
  return { sub, threadId: "thr_1", turnId, stepIndex: null, rows: [...rows], final: false };
}
