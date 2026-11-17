import { createHmac } from "node:crypto";
import type { StepComposition } from "@fresnel/contracts/conversation";
import type {
  TraceHandlerEntry,
  TraceTurnEntry,
  ToolCallTraceEvent,
} from "@fresnel/contracts/extensions";
import type { UsageRecord } from "@fresnel/contracts/services";
import type {
  Advertised,
  CallRecord,
  HookRun,
  ModelCall,
  RecordLevel,
  ScopeKind,
  StepRecord,
  TurnFlags,
  TurnRecord,
  TurnStatus,
} from "@fresnel/contracts/wire";
import type { TrCallRow, TrHookRow, TrStepRow, TrTurnRow } from "./turn-tables.ts";

// 턴 기록 행과 `record_json`을 만드는 순수 함수(정본 `docs/xeon/review/m5/turn-record-metrics.md` §3.2, §3.4, §4.1~4.2).
// 저장하지 않는 것과 아직 채우지 않는 것은 값 자체를 두지 않는다: 프로필·덧씌우기·초안·프레임·재료·광고·캐시 원인은
// 자리만 두고(null, 빈 배열, 0, "none") 다른 트랙이 채운다. 이 파일은 저장소와 시계를 모른다.

/** 턴 하나의 훅 행 상한(§4.1 규칙 8). 넘는 행은 `elided.hooks`에 센다 */
export const MAX_HOOK_ROWS_PER_TURN = 500;

/** 턴 하나의 도구 호출 행 상한(§4.1 규칙 8). 넘는 줄은 `elided.calls`에 센다 */
export const MAX_CALL_ROWS_PER_TURN = 500;

/** 등록되지 않은 도구의 소유자 자리 값. 와이어 이름 규칙(1자 이상)을 지키려고 훅과 같은 값을 쓴다 */
const UNKNOWN_PLUGIN = "none";
/** 등록되지 않은 도구의 위험 등급 자리 값. 알 수 없으면 가장 무거운 등급으로 센다(meta_json의 `riskKnown`이 구분한다) */
const UNKNOWN_RISK: CallRecord["risk"] = "exec";

/** 아직 채우지 않는 광고 요약의 자리 값(§3.2). 지문이 비어 있으면 스키마가 거부하므로 "none"을 둔다 */
const ADVERTISED_NONE: Advertised = {
  count: 0,
  tokens: 0,
  deferredCount: 0,
  removedCount: 0,
  fingerprint: "none",
  byPlugin: [],
  tools: [],
};

/** 아직 채우지 않는 턴 플래그. 모두 0이다(§4.2 규칙 15의 구분은 막힘과 고장을 나누는 다른 트랙이 채운다) */
const NO_FLAGS: TurnFlags = {
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

/** 쓰는 쪽이 턴 하나에 쌓는 상태. 행과 `record_json`은 이 값에서 만든다 */
export interface TurnDraft {
  readonly threadId: string;
  readonly turnId: string;
  readonly startedAt: number;
  readonly startedEventId: string | null;
  readonly origin: TurnRecord["origin"];
  /** 계측이 켜진 턴이면 `full`, 꺼진 턴이면 `log_only`(§4.1 규칙 3). 턴이 처음 보일 때 정한다 */
  readonly level: RecordLevel;
  /** 범위 표지. 턴을 열 때 대화의 `tr_thread`에서 정한다(§4.6) */
  scope: ScopeKind;
  /** 끝난 단계의 기록 */
  readonly steps: StepRecord[];
  /** 단계 id별 모델 호출(사용량 합산기가 준 것). 단계가 끝날 때 읽는다 */
  readonly calls: Map<string, UsageRecord[]>;
  /** 단계 id별 도구 호출 추적 줄(추적 싱크가 준 것). 단계가 끝날 때 읽고 비운다 */
  readonly toolCalls: Map<string, ToolCallTraceEvent[]>;
  /** 이 턴에 모은 도구 호출 줄 수. 상한을 셀 때 쓴다 */
  callRows: number;
  /** 상한 때문에 버린 도구 호출 줄 수 */
  elidedCalls: number;
  /** 이 턴에 쓴 훅 행 수. 상한을 셀 때 쓴다 */
  hookRows: number;
  /** 상한 때문에 버린 훅 행 수 */
  elidedHooks: number;
  /** 단계 묶음 쓰기가 실패한 횟수. 0이 아니면 턴은 불완전하다(`complete: false`) */
  writeFailures: number;
}

/** 턴을 끝낼 때 정해지는 값 */
export interface TurnState {
  readonly status: TurnStatus;
  readonly endedAt: number | null;
  readonly complete: boolean;
  /** 단계 밖 훅(boundary 등 step 0). `record_json`의 `turnHooks`에만 들어간다 */
  readonly turnHooks: readonly HookRun[];
}

export function newDraft(input: {
  readonly threadId: string;
  readonly turnId: string;
  readonly startedAt: number;
  readonly startedEventId: string | null;
  readonly origin: TurnRecord["origin"];
  readonly level: RecordLevel;
}): TurnDraft {
  return {
    ...input,
    scope: "live",
    steps: [],
    calls: new Map(),
    toolCalls: new Map(),
    callRows: 0,
    elidedCalls: 0,
    hookRows: 0,
    elidedHooks: 0,
    writeFailures: 0,
  };
}

/** 트레이스의 항목과 처리기 기록을 턴 안의 순서로 펼친 한 줄. `seqGlobal`은 턴 안에서 세는 순번이다 */
export interface FlatHook {
  readonly entry: TraceTurnEntry;
  readonly handler: TraceHandlerEntry;
  readonly seqGlobal: number;
}

export function flatHooksOf(entries: readonly TraceTurnEntry[]): FlatHook[] {
  const out: FlatHook[] = [];
  for (const entry of entries) {
    for (const handler of entry.handlers) {
      out.push({ entry, handler, seqGlobal: out.length });
    }
  }
  return out;
}

/** 훅 실행 한 번의 모양(§3.2 `HookRun`). 아직 채우지 않는 필드는 정본이 정한 자리 값이다 */
function hookRunOf(flat: FlatHook): HookRun {
  const { entry, handler } = flat;
  const toolCallId = handler.toolCallId ?? null;
  return {
    hook: entry.hook,
    registrationId: handler.registrationId,
    // 플러그인과 버전은 다른 트랙이 로더에서 채운다. 지금은 자리 값이다
    plugin: "none",
    versionId: null,
    sourceKind: "plugin",
    seq: entry.seq,
    subject: toolCallId === null ? {} : { toolCallId },
    toolCallId,
    result: handler.result,
    reason: handler.reason,
    decision: "none",
    ask: null,
    ms: handler.ms,
    atMs: handler.atMs,
    size: handler.size,
    skippedBy: handler.skippedBy,
    decisionText: null,
  };
}

/**
 * 한 단계(`step`)의 훅 실행을 고른다. 상한 `room`을 넘는 행은 버리고 개수를 `elided`에 센다.
 * 단계 밖 훅(step 0)도 같은 함수로 고른다
 */
export function hooksOfStep(
  flats: readonly FlatHook[],
  step: number,
  room: number,
): {
  readonly rows: readonly { readonly run: HookRun; readonly seqGlobal: number }[];
  readonly elided: number;
} {
  const rows: { run: HookRun; seqGlobal: number }[] = [];
  let elided = 0;
  for (const flat of flats) {
    if (flat.entry.step !== step) continue;
    if (rows.length >= room) {
      elided += 1;
      continue;
    }
    rows.push({ run: hookRunOf(flat), seqGlobal: flat.seqGlobal });
  }
  return { rows, elided };
}

/** 훅 행 하나의 저장 모양(`tr_hook`). 열 이름이 정본 §3.4와 같다 */
export function trHookRowOf(
  row: { readonly run: HookRun; readonly seqGlobal: number },
  base: { readonly threadId: string; readonly turnId: string; readonly stepIndex: number },
): TrHookRow {
  const { run } = row;
  return {
    threadId: base.threadId,
    turnId: base.turnId,
    stepIndex: base.stepIndex,
    seqGlobal: row.seqGlobal,
    hook: run.hook,
    registrationId: run.registrationId,
    plugin: run.plugin,
    versionId: run.versionId,
    toolCallId: run.toolCallId,
    subjectJson: JSON.stringify(run.subject),
    decision: run.decision,
    result: run.result,
    reason: run.reason,
    askVia: null,
    askWaits: null,
    askMs: null,
    askAnswer: null,
    ms: run.ms,
    atMs: run.atMs,
    size: run.size,
    skippedBy: run.skippedBy,
    decisionText: run.decisionText,
  };
}

/** 호출 역할의 저장 값. 하위 대화의 모델 호출은 그 대화에서 주 모델 호출이다(`ModelCall`에는 하위 역할이 없다) */
function roleOf(role: UsageRecord["role"]): ModelCall["role"] {
  return role === "subagent" ? "main" : role;
}

/** 모델 호출 한 번의 모양(§3.2 `ModelCall`). 시각은 턴 시작 기준 ms다 */
function modelCallOf(call: UsageRecord, turnStartedAt: number): ModelCall {
  const startedAt = call.startedAt ?? call.recordedAt;
  const firstToken =
    call.startedAt === undefined || typeof call.firstTokenAt !== "number"
      ? null
      : Math.max(0, call.firstTokenAt - call.startedAt);
  return {
    role: roleOf(call.role),
    label: null,
    provider: call.provider,
    modelId: call.modelId,
    startedAtMs: Math.max(0, startedAt - turnStartedAt),
    durationMs: Math.max(0, call.recordedAt - startedAt),
    firstTokenMs: firstToken,
    usage: {
      input: call.usage.input,
      output: call.usage.output,
      cacheRead: call.usage.cacheRead,
      cacheWrite: call.usage.cacheWrite,
    },
    // 재시도 알림은 아직 세지 않는다(다른 트랙). 0은 "재시도 없음"이 아니라 "세지 않음"이다
    retries: 0,
    retryWaitMs: 0,
    stopReason: call.stopReason,
  };
}

/** 설치별 소금으로 HMAC한 앞 16 hex(§4.3 규칙 20·21). 소금 없이는 인자 값을 사전 대입으로 되짚을 수 없다 */
function keyedHex(salt: string, text: string): string {
  return createHmac("sha256", salt).update(text).digest("hex").slice(0, 16);
}

/**
 * 호출 추적 줄 하나를 저장 모양(`CallRecord`)으로 옮긴다. 인자와 대상은 해시를 소금으로 한 번 더 HMAC한 짧은 값만 남긴다.
 * `hooks`는 이 호출의 `toolCallId`에 묶인 훅 행이다(§4.3)
 */
export function callRecordOf(
  event: ToolCallTraceEvent,
  input: {
    readonly salt: string;
    readonly turnStartedAt: number;
    readonly hooks: readonly HookRun[];
  },
): CallRecord {
  return {
    toolCallId: event.toolCallId,
    parentToolCallId: event.parentToolCallId,
    tool: event.tool,
    plugin: event.plugin ?? UNKNOWN_PLUGIN,
    caller: event.caller,
    callerPlugin: event.callerPlugin,
    via: event.via,
    risk: event.risk ?? UNKNOWN_RISK,
    capability: event.capability,
    callKey: keyedHex(input.salt, event.argsHash),
    targetKey: event.targetHash === null ? null : keyedHex(input.salt, event.targetHash),
    afterUntrusted: event.afterUntrusted,
    verdict: event.verdict,
    blockedBy: event.blockedBy,
    hooks: [...input.hooks],
    policy: event.policy,
    approval:
      event.approval === null
        ? null
        : {
            approvalId: event.approval.approvalId,
            decision: event.approval.decision,
            resolvedBy: event.approval.resolvedBy,
            waitMs: event.approval.waitMs,
            inheritedFrom: event.approval.inheritedFrom,
          },
    exec:
      event.exec === null
        ? null
        : {
            startedAtMs: Math.max(0, event.exec.startedAt - input.turnStartedAt),
            durationMs: event.exec.durationMs,
            status: event.exec.status,
            effectId: event.exec.effectId,
          },
    result:
      event.result === null
        ? null
        : {
            tokens: event.result.tokens,
            bytes: event.result.bytes,
            truncated: event.result.truncated,
            isError: event.result.isError,
            itemId: event.result.itemId,
          },
  };
}

/**
 * 호출 한 줄의 저장 모양(`tr_call`). 열은 거르기용 사본이고, 위험 등급·기능·`afterUntrusted`·인자 글자 수는 `meta_json`에 든다.
 * `riskKnown`이 거짓이면 위험 등급은 자리 값이다
 */
export function trCallRowOf(
  event: ToolCallTraceEvent,
  record: CallRecord,
  base: { readonly threadId: string; readonly turnId: string; readonly stepIndex: number },
): TrCallRow {
  return {
    threadId: base.threadId,
    turnId: base.turnId,
    toolCallId: record.toolCallId,
    stepIndex: base.stepIndex,
    tool: record.tool,
    plugin: record.plugin,
    caller: record.caller,
    callerPlugin: record.callerPlugin,
    via: record.via,
    inheritedFrom: record.approval?.inheritedFrom ?? null,
    verdict: record.verdict,
    blockedPlugin: record.blockedBy?.plugin ?? null,
    blockedHook: record.blockedBy?.hook ?? null,
    callKey: record.callKey,
    targetKey: record.targetKey,
    execMs: record.exec?.durationMs ?? null,
    execStatus: record.exec?.status ?? null,
    resultTokens: record.result?.tokens ?? null,
    resultTruncated: record.result?.truncated ?? null,
    resultItemId: record.result?.itemId ?? null,
    metaJson: JSON.stringify({
      risk: record.risk,
      riskKnown: event.risk !== null,
      capability: record.capability,
      afterUntrusted: record.afterUntrusted,
      parentToolCallId: record.parentToolCallId,
      argTokens: event.argTokens,
      registrationId: record.blockedBy?.registrationId ?? null,
    }),
  };
}

/** 단계 하나의 기록(§3.2 `StepRecord`). `toolCalls`는 이 단계의 도구 호출 기록이다 */
export function stepRecordOf(input: {
  readonly stepIndex: number;
  readonly stepId: string;
  readonly turnStartedAt: number;
  readonly calls: readonly UsageRecord[];
  readonly toolCalls: readonly CallRecord[];
  readonly composition: StepComposition | null;
  readonly hooks: readonly HookRun[];
}): StepRecord {
  return {
    stepIndex: input.stepIndex,
    stepId: input.stepId,
    modelCalls: input.calls.map((call) => modelCallOf(call, input.turnStartedAt)),
    materials: [],
    advertised: ADVERTISED_NONE,
    cache: null,
    hooks: [...input.hooks],
    calls: [...input.toolCalls],
    composition: input.composition,
    recorded: true,
  };
}

/** 단계 행(`tr_step`). 사용량 열은 모델 호출의 합이다 */
export function stepRowOf(input: {
  readonly threadId: string;
  readonly turnId: string;
  readonly stepIndex: number;
  readonly calls: readonly ModelCall[];
}): TrStepRow {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  for (const call of input.calls) {
    inputTokens += call.usage.input;
    outputTokens += call.usage.output;
    cacheRead += call.usage.cacheRead;
    cacheWrite += call.usage.cacheWrite;
  }
  return {
    threadId: input.threadId,
    turnId: input.turnId,
    stepIndex: input.stepIndex,
    model: input.calls[0]?.modelId ?? null,
    input: inputTokens,
    output: outputTokens,
    cacheRead,
    cacheWrite,
    retries: 0,
    advCount: 0,
    advTokens: 0,
    deferredCount: 0,
    toolsetFp: null,
    materialsFp: null,
    recorded: true,
  };
}

/** 턴 기록 한 건(§3.2 `TurnRecord`). 아직 채우지 않는 칸은 빈 값이다 */
function turnRecordOf(draft: TurnDraft, state: TurnState): TurnRecord {
  return {
    schema: 1,
    threadId: draft.threadId,
    turnId: draft.turnId,
    parent: null,
    origin: draft.origin,
    startedAt: draft.startedAt,
    endedAt: state.endedAt,
    status: state.status,
    level: draft.level,
    complete: state.complete,
    scope: draft.scope,
    profile: null,
    profileRevChanges: [],
    overlay: null,
    testRun: null,
    children: [],
    frames: [],
    steps: [...draft.steps],
    turnHooks: [...state.turnHooks],
    continues: [],
    skills: { listed: [], listedOmitted: 0, read: [] },
    cost: [],
    pluginCalls: [],
    pluginStderr: [],
    flags: NO_FLAGS,
    elided: {
      ...(draft.elidedHooks === 0 ? {} : { hooks: draft.elidedHooks }),
      ...(draft.elidedCalls === 0 ? {} : { calls: draft.elidedCalls }),
    },
  };
}

/** 턴 행(`tr_turn`). `record_json`은 `TurnRecord` 전체의 직렬화다 */
export function turnRowOf(draft: TurnDraft, state: TurnState): TrTurnRow {
  const recordJson = JSON.stringify(turnRecordOf(draft, state));
  const firstModel = draft.steps[0]?.modelCalls[0]?.modelId ?? null;
  return {
    threadId: draft.threadId,
    turnId: draft.turnId,
    startedAt: draft.startedAt,
    endedAt: state.endedAt,
    status: state.status,
    origin: draft.origin,
    scopeKind: draft.scope,
    profileId: null,
    profileRev: null,
    profileRevChangesJson: null,
    overlayJson: null,
    pluginStderrJson: null,
    level: draft.level,
    complete: state.complete,
    model: firstModel,
    flags: 0,
    recordJson,
    recordBytes: new TextEncoder().encode(recordJson).byteLength,
    startedEventId: draft.startedEventId,
  };
}
