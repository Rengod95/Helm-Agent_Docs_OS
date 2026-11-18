import { createHmac } from "node:crypto";
import type { StepComposition } from "@fresnel/contracts/conversation";
import type {
  PluginCallTraceEvent,
  TraceHandlerEntry,
  TraceTurnEntry,
  ToolCallTraceEvent,
} from "@fresnel/contracts/extensions";
import type { UsageRecord } from "@fresnel/contracts/services";
import type {
  Advertised,
  CacheBreak,
  CallRecord,
  FrameMark,
  HookRun,
  Material,
  ModelCall,
  PluginCallLine,
  RecordLevel,
  ScopeKind,
  StepRecord,
  TurnFlags,
  TurnRecord,
  TurnStatus,
} from "@fresnel/contracts/wire";
import {
  pluginCostOf,
  type StepContextEvent,
  type TurnSkillRead,
  type TurnToolRow,
} from "./turn-context.ts";
import { fitTurnRecord } from "./turn-fit.ts";
import type {
  TrCallRow,
  TrFrameRow,
  TrHookRow,
  TrPluginCallRow,
  TrStepRow,
  TrTurnRow,
} from "./turn-tables.ts";

// 턴 기록 행과 `record_json`을 만드는 순수 함수(정본 `docs/xeon/review/m5/turn-record-metrics.md` §3.2, §3.4, §4.1~4.2).
// 저장하지 않는 것과 아직 채우지 않는 것은 값 자체를 두지 않는다: 덧씌우기·초안·프레임·재료·광고·캐시 원인은
// 자리만 두고(null, 빈 배열, 0, "none") 다른 트랙이 채운다. 프로필 표지는 쓰는 쪽이 턴 시작에 `TurnDraft.profile`로 넣는다. 이 파일은 저장소와 시계를 모른다.

/** 턴 기록의 프로필 표지(§3.2 `TurnRecord.profile`). 턴 시작 값이다 */
export type TurnProfileMark = NonNullable<TurnRecord["profile"]>;
/** 턴 안에서 프로필 개정이 바뀐 단계 경계(§3.2 `profileRevChanges`의 한 줄) */
type ProfileRevChange = TurnRecord["profileRevChanges"][number];

/** 턴 하나의 훅 행 상한(§4.1 규칙 8). 넘는 행은 `elided.hooks`에 센다 */
export const MAX_HOOK_ROWS_PER_TURN = 500;

/** 턴 하나의 도구 호출 행 상한(§4.1 규칙 8). 넘는 줄은 `elided.calls`에 센다 */
export const MAX_CALL_ROWS_PER_TURN = 500;

/**
 * 턴 하나의 가벼운 길 호출 줄 상한(`tr_plugincall`). 넘는 줄은 버린다. 줄 수를 세는 칸(`elided`)은 닫힌 목록이라 아직 더하지 않았다
 */
export const MAX_PLUGIN_CALL_ROWS_PER_TURN = 500;

/** 인자가 JSON이 아닌 호출의 요청 키 재료. 인자 값은 싣지 않으므로 이런 호출은 같은 키로 센다 */
const NON_JSON_ARGS = "non-json";

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
  /** `record_json`의 상한(바이트, `x.operations.trace.maxTurnBytes`). 턴이 처음 보일 때 정한다(규칙 6, 8) */
  readonly maxBytes: number;
  /** 턴 시작 때의 프로필 표지. 턴을 열 때 정한다(§4.10 규칙 60~62) */
  readonly profile: TurnProfileMark;
  /** 턴 안에서 프로필 개정이 시작 값(또는 직전 바뀜)과 달라진 단계 경계(§4.10 규칙 63) */
  readonly profileRevChanges: ProfileRevChange[];
  /** 마지막으로 끝난 단계의 번호. 프로필 경계가 가리키는 다음 단계를 정하는 데 쓴다 */
  lastStepIndex: number | null;
  /** 범위 표지. 턴을 열 때 대화의 `tr_thread`에서 정한다(§4.6) */
  scope: ScopeKind;
  /** 끝난 단계의 기록 */
  readonly steps: StepRecord[];
  /** 주도권 스택의 프레임: 턴 시작 때 열려 있던 것과 턴 안의 변화(코어 위 프레임만, 깊이는 코어를 0으로 센다) */
  readonly frames: FrameMark[];
  /** 가벼운 길의 플러그인 호출 줄(추적 싱크가 준 것, 들어온 순서). 턴을 닫을 때 `record_json`과 `tr_plugincall` 행이 된다 */
  readonly pluginCalls: PluginCallLine[];
  /** 단계 id별 모델 호출(사용량 합산기가 준 것). 단계가 끝날 때 읽는다 */
  readonly calls: Map<string, UsageRecord[]>;
  /** 단계 id별 도구 호출 추적 줄(추적 싱크가 준 것). 단계가 끝날 때 읽고 비운다 */
  readonly toolCalls: Map<string, ToolCallTraceEvent[]>;
  /** 단계 id별 조립 사실(재료와 광고, 측정 싱크가 준 것). 단계가 끝날 때 읽고 비운다 */
  readonly contexts: Map<string, StepContextEvent>;
  /** 단계 id별 스킬 본문 읽기(측정 싱크가 준 것). 단계가 끝날 때 읽고 비운다 */
  readonly skillReads: Map<string, { readonly toolCallId: string; readonly name: string }[]>;
  /**
   * 훅 실행 가운데 이미 본 것의 키(`hookKeyOf`). 단계가 끝날 때 그 단계의 실행을 넣는다. 턴을 닫을 때 키에 없는 실행이 늦은 행이다
   */
  readonly seenHooks: Set<string>;
  /** 호출 id → 승인 해결(호출 줄의 `approval`). 훅 행의 물음 답을 채울 때 읽는다 */
  readonly approvals: Map<string, ApprovalOf>;
  /** 턴의 도구 줄(이름 → 줄). 첫 광고 토큰은 고정이고 상태와 호출 수를 갱신한다 */
  readonly tools: Map<string, TurnToolRow>;
  /** 턴에서 처음 읽은 스킬(이름 → 읽기) */
  readonly skills: Map<string, TurnSkillRead>;
  /** 이 턴의 `tr_material`에 이미 쓴 재료 키. 같은 재료는 처음 나타난 단계에만 쓴다 */
  readonly materialKeys: Set<string>;
  /** 이 턴의 `StepRecord`에 실은 재료 수(상한을 셀 때 쓴다) */
  materialCount: number;
  /** 상한 때문에 버린 재료 수, 도구 줄 수, 스킬 수 */
  elidedMaterials: number;
  elidedTools: number;
  elidedSkills: number;
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
  readonly maxBytes: number;
  readonly profile: TurnProfileMark;
}): TurnDraft {
  return {
    ...input,
    profileRevChanges: [],
    lastStepIndex: null,
    scope: "live",
    steps: [],
    frames: [],
    pluginCalls: [],
    calls: new Map(),
    toolCalls: new Map(),
    contexts: new Map(),
    skillReads: new Map(),
    seenHooks: new Set(),
    approvals: new Map(),
    tools: new Map(),
    skills: new Map(),
    materialKeys: new Set(),
    materialCount: 0,
    elidedMaterials: 0,
    elidedTools: 0,
    elidedSkills: 0,
    callRows: 0,
    elidedCalls: 0,
    hookRows: 0,
    elidedHooks: 0,
    writeFailures: 0,
  };
}

/**
 * 프로필 경계가 가리키는 단계 번호(§4.10 규칙 63). 경계는 끝난 단계(`step_end`) 뒤에 오므로 다음 단계다.
 * 끝난 단계가 없으면 턴의 첫 단계(0)다
 */
export function stepAfterBoundary(lastStepIndex: number | null): number {
  return lastStepIndex === null ? 0 : lastStepIndex + 1;
}

/** 트레이스의 항목과 처리기 기록을 턴 안의 순서로 펼친 한 줄. `seqGlobal`은 턴 안에서 세는 순번이다 */
export interface FlatHook {
  readonly entry: TraceTurnEntry;
  readonly handler: TraceHandlerEntry;
  /** 항목 안의 처리기 번호(0부터). `hookKeyOf`의 한 자리다 */
  readonly handlerIndex: number;
  readonly seqGlobal: number;
}

export function flatHooksOf(entries: readonly TraceTurnEntry[]): FlatHook[] {
  const out: FlatHook[] = [];
  for (const entry of entries) {
    entry.handlers.forEach((handler, handlerIndex) => {
      out.push({ entry, handler, handlerIndex, seqGlobal: out.length });
    });
  }
  return out;
}

/** 훅 실행 하나의 키. 항목의 `seq`와 항목 안의 처리기 번호다. 턴 안에서 항목은 추가만 되므로 키는 바뀌지 않는다 */
export function hookKeyOf(flat: FlatHook): string {
  return `${flat.entry.seq}:${flat.handlerIndex}`;
}

/** 승인 해결 한 건(호출 줄의 `approval`) */
export type ApprovalOf = NonNullable<ToolCallTraceEvent["approval"]>;

/**
 * 결정이 `ask`이고 핸들러가 `{ask:true}`를 낸 행에 승인의 대기 시간, 승인 id, 답을 채운다(턴 기록 §4.2 규칙 14 (b)).
 * 호출 줄이 없거나 승인이 없으면 행을 그대로 둔다. `ask.answer`는 승인의 결정(allow, deny, answer)이고, 무인 실행이면 `noninteractive`다
 */
function joinApproval(run: HookRun, approval: ApprovalOf | undefined): HookRun {
  if (run.ask === null || run.ask.via !== "decision" || approval === undefined) return run;
  return {
    ...run,
    subject: { ...run.subject, approvalId: approval.approvalId },
    ask: {
      via: "decision",
      waits: run.ask.waits,
      waitMs: approval.waitMs,
      approvalId: approval.approvalId,
      answer: approval.resolvedBy === "noninteractive" ? "noninteractive" : approval.decision,
    },
  };
}

/** 훅 행에 그 호출의 승인을 잇는다(도구 호출 지점이 아니면 그대로다) */
function withApproval(run: HookRun, approvals: ReadonlyMap<string, ApprovalOf>): HookRun {
  return joinApproval(run, run.toolCallId === null ? undefined : approvals.get(run.toolCallId));
}

/** 훅 실행 한 번의 모양(§3.2 `HookRun`). 플러그인, 버전, 출처, 결정, 물음은 기록하는 쪽이 준 값이고, 모르면 자리 값이다 */
function hookRunOf(flat: FlatHook): HookRun {
  const { entry, handler } = flat;
  const toolCallId = handler.toolCallId ?? null;
  return {
    hook: entry.hook,
    registrationId: handler.registrationId,
    // 등록 항목이 없던 옛 기록은 자리 값이다
    plugin: handler.plugin ?? UNKNOWN_PLUGIN,
    versionId: handler.versionId ?? null,
    sourceKind: handler.sourceKind ?? "plugin",
    seq: entry.seq,
    subject: toolCallId === null ? {} : { toolCallId },
    toolCallId,
    result: handler.result,
    reason: handler.reason,
    decision: handler.decision ?? "none",
    ask: handler.ask ?? null,
    ms: handler.ms,
    atMs: handler.atMs,
    size: handler.size,
    skippedBy: handler.skippedBy,
    decisionText: null,
  };
}

/**
 * 한 단계(`step`)의 훅 실행을 고른다. 상한 `room`을 넘는 행은 버리고 개수를 `elided`에 센다.
 * 단계 밖 훅(step 0)도 같은 함수로 고른다. `approvals`가 있으면 물음 행에 승인을 잇는다
 */
export function hooksOfStep(
  flats: readonly FlatHook[],
  step: number,
  room: number,
  approvals?: ReadonlyMap<string, ApprovalOf>,
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
    const run = hookRunOf(flat);
    rows.push({
      run: approvals === undefined ? run : withApproval(run, approvals),
      seqGlobal: flat.seqGlobal,
    });
  }
  return { rows, elided };
}

/**
 * 턴을 닫을 때 아직 행으로 쓰지 않은 훅 실행(턴 기록 §7 "분리 실행"). 단계 밖 훅(step 0)은 턴 훅이라 여기 없다.
 * 행은 실행이 시작된 단계에 `late: true`로 쓴다. `seqGlobal`은 턴의 모든 실행 수 뒤에서 이어 세므로 이미 쓴 행과 키가 겹치지 않는다.
 * `room`을 넘는 행은 버리고 `elided`에 센다
 */
export function lateHooksOf(
  flats: readonly FlatHook[],
  input: {
    readonly seen: ReadonlySet<string>;
    readonly approvals: ReadonlyMap<string, ApprovalOf>;
    readonly room: number;
  },
): {
  readonly rows: readonly {
    readonly run: HookRun;
    readonly seqGlobal: number;
    readonly stepIndex: number;
  }[];
  readonly elided: number;
} {
  const rows: { run: HookRun; seqGlobal: number; stepIndex: number }[] = [];
  let elided = 0;
  for (const flat of flats) {
    if (flat.entry.step === 0 || input.seen.has(hookKeyOf(flat))) continue;
    if (rows.length >= input.room) {
      elided += 1;
      continue;
    }
    const run = withApproval(hookRunOf(flat), input.approvals);
    rows.push({
      run: { ...run, late: true },
      seqGlobal: flats.length + rows.length,
      stepIndex: flat.entry.step,
    });
  }
  return { rows, elided };
}

/** 훅 행 하나의 저장 모양(`tr_hook`). 열 이름이 정본 §3.4와 같다. 늦은 행의 표지는 열이 없어 `subject_json`에 싣는다 */
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
    subjectJson: JSON.stringify(run.late === true ? { ...run.subject, late: true } : run.subject),
    decision: run.decision,
    result: run.result,
    reason: run.reason,
    askVia: run.ask?.via ?? null,
    askWaits: run.ask?.waits ?? null,
    askMs: run.ask?.waitMs ?? null,
    askAnswer: run.ask?.answer ?? null,
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
 * 가벼운 길의 호출 줄을 턴 기록 줄(`PluginCallLine`, §3.2)로 옮긴다. 요청 키는 인자 해시를 설치별 소금으로 HMAC한 짧은 값이다(§4.1 규칙 11)
 */
export function pluginCallLineOf(event: PluginCallTraceEvent, salt: string): PluginCallLine {
  return {
    plugin: event.plugin,
    capability: event.capability,
    method: event.method,
    requestKey: keyedHex(salt, event.argsHash ?? NON_JSON_ARGS),
    ok: event.ok,
    ms: event.ms,
    via: event.via,
    toolCallId: event.toolCallId,
  };
}

/** 가벼운 길의 줄 하나를 `tr_plugincall` 행으로 옮긴다. `seq`는 턴 안에서 들어온 순번이다 */
export function trPluginCallRowOf(
  line: PluginCallLine,
  ids: { readonly threadId: string; readonly turnId: string },
  seq: number,
): TrPluginCallRow {
  return {
    threadId: ids.threadId,
    turnId: ids.turnId,
    seq,
    plugin: line.plugin,
    capability: line.capability,
    method: line.method,
    requestKey: line.requestKey,
    ok: line.ok,
    ms: line.ms,
    via: line.via,
    toolCallId: line.toolCallId,
  };
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

/** 단계 하나의 기록(§3.2 `StepRecord`). `toolCalls`는 이 단계의 도구 호출 기록이다. 재료·광고·캐시는 측정 싱크가 없으면 자리 값이다 */
export function stepRecordOf(input: {
  readonly stepIndex: number;
  readonly stepId: string;
  readonly turnStartedAt: number;
  readonly calls: readonly UsageRecord[];
  readonly toolCalls: readonly CallRecord[];
  readonly composition: StepComposition | null;
  readonly hooks: readonly HookRun[];
  readonly materials?: readonly Material[];
  readonly advertised?: Advertised;
  readonly cache?: CacheBreak | null;
}): StepRecord {
  return {
    stepIndex: input.stepIndex,
    stepId: input.stepId,
    modelCalls: input.calls.map((call) => modelCallOf(call, input.turnStartedAt)),
    materials: [...(input.materials ?? [])],
    advertised: input.advertised ?? ADVERTISED_NONE,
    cache: input.cache ?? null,
    hooks: [...input.hooks],
    calls: [...input.toolCalls],
    composition: input.composition,
    recorded: true,
  };
}

/** 단계 행(`tr_step`). 사용량 열은 모델 호출의 합이다. `context`가 있으면 광고 열과 지문을 채운다 */
export function stepRowOf(input: {
  readonly threadId: string;
  readonly turnId: string;
  readonly stepIndex: number;
  readonly calls: readonly ModelCall[];
  readonly context?: { readonly advertised: Advertised; readonly materialsFp: string | null };
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
    advCount: input.context?.advertised.count ?? 0,
    advTokens: input.context?.advertised.tokens ?? 0,
    deferredCount: input.context?.advertised.deferredCount ?? 0,
    toolsetFp: input.context?.advertised.fingerprint ?? null,
    materialsFp: input.context?.materialsFp ?? null,
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
    profile: draft.profile,
    profileRevChanges: [...draft.profileRevChanges],
    overlay: null,
    testRun: null,
    children: [],
    frames: draft.frames.map((frame) => ({ ...frame })),
    steps: [...draft.steps],
    turnHooks: [...state.turnHooks],
    continues: [],
    // 스킬 색인에 실린 이름(`listed`)은 조립 입력에 없어 아직 비운다(§4.5 규칙 29, 보고 참조)
    skills: {
      listed: [],
      listedOmitted: 0,
      read: [...draft.skills.values()].map((skill) => ({
        name: skill.name,
        plugin: skill.plugin,
        via: "model" as const,
        stepIndex: skill.stepIndex,
        tokens: skill.tokens,
      })),
    },
    cost: pluginCostOf({
      materials: draft.steps.at(-1)?.materials ?? [],
      tools: [...draft.tools.values()],
      skills: [...draft.skills.values()],
    }),
    pluginCalls: draft.pluginCalls.map((line) => ({ ...line })),
    pluginStderr: [],
    flags: {
      ...NO_FLAGS,
      cacheBreak: draft.steps.some((step) => step.cache?.observed === true),
      truncatedMaterials: draft.elidedMaterials,
    },
    elided: {
      ...(draft.elidedHooks === 0 ? {} : { hooks: draft.elidedHooks }),
      ...(draft.elidedCalls === 0 ? {} : { calls: draft.elidedCalls }),
      ...(draft.elidedMaterials === 0 ? {} : { materials: draft.elidedMaterials }),
      ...(draft.elidedTools === 0 ? {} : { tools: draft.elidedTools }),
      ...(draft.elidedSkills === 0 ? {} : { skills: draft.elidedSkills }),
    },
  };
}

/** 턴 행(`tr_turn`). `record_json`은 `TurnRecord` 전체의 직렬화다 */
export function turnRowOf(draft: TurnDraft, state: TurnState): TrTurnRow {
  // 상한을 넘으면 줄인다(§4.1 규칙 8). 요약으로 바꾼 턴은 행의 `complete`도 거짓이다
  const fitted = fitTurnRecord(turnRecordOf(draft, state), draft.maxBytes);
  const firstModel = draft.steps[0]?.modelCalls[0]?.modelId ?? null;
  return {
    threadId: draft.threadId,
    turnId: draft.turnId,
    startedAt: draft.startedAt,
    endedAt: state.endedAt,
    status: state.status,
    origin: draft.origin,
    scopeKind: draft.scope,
    profileId: draft.profile.id,
    profileRev: draft.profile.rev,
    profileRevChangesJson:
      draft.profileRevChanges.length === 0 ? null : JSON.stringify(draft.profileRevChanges),
    overlayJson: null,
    pluginStderrJson: null,
    level: draft.level,
    complete: state.complete && !fitted.summarized,
    model: firstModel,
    flags: 0,
    recordJson: fitted.json,
    recordBytes: fitted.bytes,
    startedEventId: draft.startedEventId,
  };
}

/** 프레임 표지를 `tr_frame` 행으로 옮긴다. 코어(`leaseId` 없음)는 행으로 쓰지 않는다 */
export function trFrameRowOf(
  ids: { readonly threadId: string; readonly turnId: string },
  frame: FrameMark,
): TrFrameRow | null {
  if (frame.leaseId === null) return null;
  return {
    threadId: ids.threadId,
    turnId: ids.turnId,
    leaseId: frame.leaseId,
    depth: frame.depth,
    plugin: frame.plugin,
    versionId: frame.versionId,
    parentLeaseId: frame.parentLeaseId,
    enteredAtMs: frame.enteredAtMs,
    exitedAtMs: frame.exitedAtMs,
    exitReason: frame.exitReason,
    lowerResumedWith: frame.lowerResumedWith,
    limitsJson: JSON.stringify(frame.limits),
    usedJson: JSON.stringify(frame.used),
    userMessages: frame.userMessages,
  };
}
