import { createHmac } from "node:crypto";
import type { StepComposition } from "@fresnel/contracts/conversation";
import type {
  PluginCallTraceEvent,
  TraceHandlerEntry,
  TraceTurnEntry,
  ToolCallTraceEvent,
} from "@fresnel/contracts/extensions";
import type { UsageRecord } from "@fresnel/contracts/services";
import { TURN_FLAG_KEYS } from "@fresnel/contracts/wire";
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
  NO_TURN_BLOCKS,
  pluginCostOf,
  type StepContextEvent,
  type TurnBlockFacts,
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

/** 테스트 실행 대화의 구성(§3.2 `TurnRecord.testRun`, §4.6 규칙 37). 범위가 `test`인 턴에만 실린다 */
export type TurnTestRunMark = TurnRecord["testRun"];
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
  /** 테스트 실행 대화의 구성(기준 프로필, 묶음 id, 초안 버전). 범위가 `test`일 때만 싣는다 */
  testRun: TurnTestRunMark;
  /**
   * 이 턴의 `profile.applied`가 초안 덧씌우기(`draftId`)를 실었는가. 참이면 범위는 `overlay_draft`다(§4.6 규칙 31, §4.3.8).
   * 대화 범위가 `test`나 `craft`면 그것이 이긴다
   */
  draftOverlay: boolean;
  /** 끝난 단계의 기록 */
  readonly steps: StepRecord[];
  /** 주도권 스택의 프레임: 턴 시작 때 열려 있던 것과 턴 안의 변화(코어 위 프레임만, 깊이는 코어를 0으로 센다) */
  readonly frames: FrameMark[];
  /** 이 턴의 `agent.spawned`로 만든 자식 대화 id. `flags.subagents`가 센다(`children` 목록은 아직 비운다) */
  readonly spawnedChildren: Set<string>;
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
  /** 턴에 실린 색인·기억 블록의 사실(턴 기록 싱크가 알린 값). 단계마다 재료로 싣고 `skills.listed`가 된다 */
  blocks: TurnBlockFacts;
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
    testRun: null,
    draftOverlay: false,
    steps: [],
    frames: [],
    spawnedChildren: new Set(),
    pluginCalls: [],
    calls: new Map(),
    toolCalls: new Map(),
    contexts: new Map(),
    skillReads: new Map(),
    seenHooks: new Set(),
    approvals: new Map(),
    tools: new Map(),
    skills: new Map(),
    blocks: NO_TURN_BLOCKS,
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
  const run: HookRun = {
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
  // 턴이 열리기 전에 실행된 훅(§4.2 규칙 17의 2)은 표지를 단다. 턴의 단계 0에만 든다
  return entry.pre === true ? { ...run, preTurn: true } : run;
}

/**
 * 턴 수준 훅(턴 경계와 컨텍스트 조립 앞의 첫 훅, 턴이 열리기 전에 실행된 훅). 이 훅은 `record_json`의 `turnHooks`에만 들고
 * 첫 단계(`steps[0]`)의 `hooks`에는 들지 않는다. 둘 다에 넣으면 `flags.modified` 같은 수가 두 배가 된다(review/m5/turn-record-metrics.md §3.2).
 * 단계 번호 0은 이 훅들과 첫 모델 단계가 함께 쓰므로 훅 이름으로 가른다 [제안: 이름 목록]
 */
const TURN_LEVEL_HOOKS: ReadonlySet<string> = new Set([
  "thread.start",
  "input.user.before",
  "input.bash.before",
  "input.agent.before",
  "boundary.turn.before",
]);

/** 이 실행이 턴 수준 훅인가 */
export function isTurnLevelHook(run: HookRun): boolean {
  return run.preTurn === true || TURN_LEVEL_HOOKS.has(run.hook);
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
export function keyedHex(salt: string, text: string): string {
  return createHmac("sha256", salt).update(text).digest("hex").slice(0, 16);
}

/**
 * 문자열 인자 토큰 목록을 설치별 소금으로 가린 목록(`meta_json.argTokens`, §5.1-②). 토큰마다 `callKey`와 같은 방식(앞 16 hex)을 쓴다.
 * 같은 소금이면 같은 토큰은 같은 값이고, 원본 토큰은 저장하지 않는다
 */
export function maskedArgTokensOf(salt: string, tokens: readonly string[]): string[] {
  return tokens.map((token) => keyedHex(salt, token));
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
 * 호출 한 줄의 저장 모양(`tr_call`). 열은 거르기용 사본이고, 위험 등급·기능·`afterUntrusted`·인자 어림 토큰 수는 `meta_json`에 든다.
 * `riskKnown`이 거짓이면 위험 등급은 자리 값이다. `maskedArgTokens`는 `maskedArgTokensOf`의 결과다(원본 토큰은 넘기지 않는다)
 */
export function trCallRowOf(
  event: ToolCallTraceEvent,
  record: CallRecord,
  base: { readonly threadId: string; readonly turnId: string; readonly stepIndex: number },
  maskedArgTokens: readonly string[],
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
      argTokenCount: event.argTokenCount,
      argTokens: [...maskedArgTokens],
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

/** 사람에게 물은 횟수. 같은 승인 id의 물음은 한 번이다(호출의 승인과 훅의 결정 물음은 같은 카드). 승인을 물려받은 호출은 카드를 띄우지 않았으니 세지 않는다. 승인 id가 없는 훅 물음(`awaitUser`)은 실행마다 한 번이다 */
function askedOf(calls: readonly CallRecord[], runs: readonly HookRun[]): number {
  const approvals = new Set<string>();
  for (const call of calls) {
    if (call.approval !== null && call.approval.inheritedFrom === null) {
      approvals.add(call.approval.approvalId);
    }
  }
  let unlinked = 0;
  for (const run of runs) {
    if (run.ask === null) continue;
    if (run.ask.approvalId === null) unlinked += 1;
    else approvals.add(run.ask.approvalId);
  }
  return approvals.size + unlinked;
}

/**
 * 턴의 결과 수 표지(§3.2 `TurnFlags`). 단계 기록의 호출 판정과 훅 실행(턴 밖 훅과 늦은 행 포함)에서 센다.
 * 호출은 판정마다 한 번씩 세고, 훅 실행은 `record_json`에 든 행을 센다(호출에 붙은 복사본은 따로 세지 않는다).
 * 상한 때문에 버린 행은 세지 않는다(`elided`가 센다). `failed`는 시간 초과를 뺀 고장이고, `timedOut`은 시간 초과다.
 * `untrackedWrite`는 항상 거짓이다: 대체 도구가 코어 서비스를 거치지 않았는지 세는 `observedCoreCalls` 계측이 아직 없다(F §5.5 P-4 3)
 */
export function turnFlagsOf(draft: TurnDraft, turnHooks: readonly HookRun[]): TurnFlags {
  const calls = draft.steps.flatMap((step) => step.calls);
  const runs = [...turnHooks, ...draft.steps.flatMap((step) => step.hooks)];
  const verdictCount = (...verdicts: CallRecord["verdict"][]): number =>
    calls.filter((call) => verdicts.includes(call.verdict)).length;
  const failed = runs.filter((run) => run.result === "failed");
  const timedOut = failed.filter((run) => run.reason === "timeout").length;
  return {
    blockedIntent: verdictCount("blocked_hook", "blocked_guard", "blocked_spawn"),
    blockedFault: verdictCount("blocked_hook_fault", "blocked_guard_fault"),
    deniedPolicy: verdictCount("denied_policy"),
    deniedHuman: verdictCount("denied_human"),
    deniedNoninteractive: verdictCount("denied_noninteractive"),
    replaced: verdictCount("replaced_hook"),
    cancelledAsk: verdictCount("cancelled_ask"),
    asked: askedOf(calls, runs),
    modified: runs.filter((run) => run.result === "modified").length,
    timedOut,
    failed: failed.length - timedOut,
    drive: draft.frames.length > 0,
    cacheBreak: draft.steps.some((step) => step.cache?.observed === true),
    subagents: draft.spawnedChildren.size,
    truncatedMaterials: draft.elidedMaterials,
    draftActive: draft.scope === "overlay_draft",
    untrackedWrite: false,
  };
}

/**
 * 턴 행의 `flags` 열(정수 비트). `TURN_FLAG_KEYS`의 i번째 칸이 `1 << i`이고, 불린 칸은 참일 때, 수 칸은 0보다 클 때 켜진다.
 * `turnRecord.list`의 `flags` 거르기가 이 비트를 `(flags & mask) <> 0`으로 쓴다
 */
export function turnFlagBitsOf(flags: TurnFlags): number {
  let bits = 0;
  TURN_FLAG_KEYS.forEach((key, index) => {
    const value = flags[key];
    const on = typeof value === "boolean" ? value : value > 0;
    if (on) bits |= 1 << index;
  });
  return bits;
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
    testRun: draft.testRun,
    children: [],
    frames: draft.frames.map((frame) => ({ ...frame })),
    steps: [...draft.steps],
    turnHooks: [...state.turnHooks],
    continues: [],
    // 스킬 색인에 실린 이름과 못 실은 수는 턴 기록 싱크가 알린 값이다(§4.5 규칙 29). 알림이 없으면 빈 값이다
    skills: {
      listed: [...(draft.blocks.skillIndex?.listed ?? [])],
      listedOmitted: draft.blocks.skillIndex?.omitted ?? 0,
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
    flags: turnFlagsOf(draft, state.turnHooks),
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
  // 상한을 넘으면 줄인다(§4.1 규칙 8). 요약으로 바꾼 턴은 행의 `complete`도 거짓이다. 플래그는 줄이기 전 기록에서 센다
  const record = turnRecordOf(draft, state);
  const fitted = fitTurnRecord(record, draft.maxBytes);
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
    flags: turnFlagBitsOf(record.flags),
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
