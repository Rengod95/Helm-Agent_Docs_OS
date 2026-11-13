// src/state/engine/convo.ts
// 대화 화면이 읽는 "런타임 고유" 상태. 도구 진행 출력, 단계·턴 기록, 휘발 알림, 승인 기록, 개입, 주도(drive 임대), 하위 에이전트,
// 목표와 할 일, 변화 표지를 thread별로 모은다. 순수 함수만 둔다. 같은 사건이 두 번 와도(보조 재생과 구독이 겹친다) 결과가 같도록
// 모든 기록은 사건 seq나 id로 거른다. 선택자는 `convo-select.ts`다. 스펙: docs/xeon/L4/desktop-ux/spec.md 대화 상태 절.
import { assertNever } from "@fresnel/contracts";
import type {
  EventId,
  ItemId,
  ItemRecord,
  StepCompletedPayload,
  StepComposition,
  StepContextWarning,
  ThreadId,
  TurnId,
  TurnStartedPayload,
  Usage,
} from "@fresnel/contracts/conversation";
import type {
  AgentJudgedPayload,
  AgentSettledEventPayload,
  AgentSpawnedPayload,
  ApprovalRequestedPayload,
  ApprovalResolvedPayload,
  BranchSummarizedPayload,
  LeafMovedPayload,
  LeaseAcquiredPayload,
  LeaseReleasedPayload,
  SecretApprovedPayload,
  SecretDeniedPayload,
  SecretMaskedPayload,
  SecretUsedPayload,
  SettingsChangedPayload,
  ThreadResumedPayload,
  ToolSandboxBypassedPayload,
  ToolUntrustedReadPayload,
  TurnAbortRequestedPayload,
  WorkGoalJudgedPayload,
  WorkGoalSetPayload,
  WorkGoalSettledPayload,
  WorkTaskChangedPayload,
  WorkTaskCreatedPayload,
  WorkTaskLinkPayload,
} from "@fresnel/contracts/records";

/** thread마다 남기는 개수 상한. 넘으면 가장 오래된 것부터 버린다 */
const CONVO_TURN_CAP = 60;
const CONVO_TOOL_CAP = 400;
const CONVO_APPROVAL_CAP = 200;
const CONVO_LOOSE_CAP = 100;
const CONVO_LEASE_CAP = 40;
const CONVO_AGENT_CAP = 100;
const CONVO_TASK_CAP = 200;
const CONVO_MARKER_CAP = 200;
/** 턴마다 남기는 컨텍스트 경고와 알림 수 */
const CONVO_TURN_WARNING_CAP = 16;
const CONVO_TURN_NOTICE_CAP = 8;
/** 도구 호출마다 남기는 진행 출력의 마지막 줄 수와 한 줄의 글자 수 상한 */
const TOOL_PROGRESS_LINES = 20;
const TOOL_PROGRESS_LINE_CHARS = 400;

/** 권한 모드 설정 키(`views/permission-mode-model.ts`의 `PERMISSION_MODE_KEY`와 같은 값. state는 views를 읽지 않는다) */
const PERMISSION_MODE_SETTING_KEY = "l1.tools.permissionMode";

/** 거울이 읽는 새 내구 kind의 검증된 사실. `decode.ts`가 만든다 */
export type ConvoEvent =
  | { readonly kind: "step.completed"; readonly payload: StepCompletedPayload }
  | { readonly kind: "turn.abort_requested"; readonly payload: TurnAbortRequestedPayload }
  | { readonly kind: "agent.spawned"; readonly payload: AgentSpawnedPayload }
  | { readonly kind: "agent.judged"; readonly payload: AgentJudgedPayload }
  | { readonly kind: "agent.settled"; readonly payload: AgentSettledEventPayload }
  | { readonly kind: "work.goal_set"; readonly payload: WorkGoalSetPayload }
  | { readonly kind: "work.goal_judged"; readonly payload: WorkGoalJudgedPayload }
  | { readonly kind: "work.goal_settled"; readonly payload: WorkGoalSettledPayload }
  | { readonly kind: "work.task_created"; readonly payload: WorkTaskCreatedPayload }
  | { readonly kind: "work.task_changed"; readonly payload: WorkTaskChangedPayload }
  | { readonly kind: "work.task_linked"; readonly payload: WorkTaskLinkPayload }
  | { readonly kind: "work.task_unlinked"; readonly payload: WorkTaskLinkPayload }
  | { readonly kind: "thread.leaf_moved"; readonly payload: LeafMovedPayload }
  | { readonly kind: "thread.branch_summarized"; readonly payload: BranchSummarizedPayload }
  | { readonly kind: "thread.resumed"; readonly payload: ThreadResumedPayload }
  | { readonly kind: "settings.changed"; readonly payload: SettingsChangedPayload }
  | { readonly kind: "tool.sandbox_bypassed"; readonly payload: ToolSandboxBypassedPayload }
  | { readonly kind: "tool.untrusted_read"; readonly payload: ToolUntrustedReadPayload }
  | { readonly kind: "secret.used"; readonly payload: SecretUsedPayload }
  | { readonly kind: "secret.denied"; readonly payload: SecretDeniedPayload }
  | { readonly kind: "secret.approved"; readonly payload: SecretApprovedPayload }
  | { readonly kind: "secret.masked"; readonly payload: SecretMaskedPayload };

/** 사건 위치. 모든 내구 사실이 가진다 */
export type ConvoAt = {
  readonly seq: number;
  /** 사건 id(스냅숏에서 읽은 개입은 item id) */
  readonly eventId: string;
  readonly turnId: TurnId | null;
  /** 기록 시각(ISO) */
  readonly at: string;
};

// ── 도구 호출 ─────────────────────────────────────────────────────────

/** 도구가 실행 중에 낸 진행 출력(휘발 `tool_progress`). 마지막 줄들과 받은 총량만 둔다 */
export type ToolProgress = {
  readonly itemId: ItemId;
  /** 마지막으로 받은 출력의 끝 `TOOL_PROGRESS_LINES`줄. 한 줄은 `TOOL_PROGRESS_LINE_CHARS`자까지 */
  readonly lines: readonly string[];
  /** 지금까지 받은 출력 글자 수의 합(갱신마다 받은 본문 길이를 더한다) */
  readonly receivedChars: number;
  /** 받은 갱신 수 */
  readonly updates: number;
};

type InterventionKind =
  | "hook_denied"
  | "guard_denied"
  | "hook_patched"
  | "sandbox_bypassed"
  | "untrusted_read"
  | "secret_used"
  | "secret_denied"
  | "secret_approved"
  | "secret_masked";

/** 도구 호출에 개입한 일 하나 */
export type Intervention = {
  readonly kind: InterventionKind;
  /** 개입한 확장 이름. 모르면 null */
  readonly extension: string | null;
  /** 사유. 없으면 null */
  readonly reason: string | null;
  /** 짧은 보조 값(시크릿 핸들, 우회 사유, 가림 층 등). 없으면 null */
  readonly detail: string | null;
  /** 사건 seq. 도구 결과 item에서 읽은 개입은 그 item의 seq다 */
  readonly seq: number;
  readonly at: string;
};

/** 승인이 해결된 뒤에도 남기는 기록: 누가 무엇을 어떤 범위로 허용·거부했나 */
export type ApprovalTrail = {
  readonly approvalId: EventId;
  readonly decision: ApprovalResolvedPayload["decision"];
  /** 사용자가 고른 기억 범위 */
  readonly remember: ApprovalResolvedPayload["remember"];
  /** 요청이 제안한 범위. 없으면 null */
  readonly requestedRemember: ApprovalResolvedPayload["requestedRemember"];
  readonly resolvedBy: ApprovalResolvedPayload["resolvedBy"];
  /** 다른 기기에서 답했으면 그 기기 id. 이 컴퓨터에서 답했으면 없다(L4.remote.spec §8.9) */
  readonly deviceId?: string;
  readonly title: string;
  /** 요청한 쪽(`main`, `background`, `host`, `subagent:<이름>`, `ext:<이름>`) */
  readonly caller: string;
  readonly bodyKind: ApprovalRequestedPayload["body"]["kind"];
  /** 도구 승인이면 도구 이름 */
  readonly toolName: string | null;
  readonly seq: number;
  readonly at: string;
};

type ToolRecord = {
  readonly toolCallId: string;
  readonly progress: ToolProgress | null;
  readonly approvals: readonly ApprovalTrail[];
  readonly interventions: readonly Intervention[];
};

/** 승인 요청의 요약. 해결 사건이 오면 도구 호출에 기록을 붙이는 데 쓴다 */
type ApprovalDigest = {
  readonly toolCallId: string | null;
  readonly title: string;
  readonly caller: string;
  readonly bodyKind: ApprovalRequestedPayload["body"]["kind"];
  readonly toolName: string | null;
};

// ── 단계와 턴 ─────────────────────────────────────────────────────────

/** 턴이 끝난 이유. `turn.completed`의 status와 error 문자열에서 읽는다 */
export type TurnEnd =
  | { readonly kind: "completed" }
  /** 단계 상한(`step_limit`)이나 자식 한도(`child_limit`)로 멈췄다 */
  | { readonly kind: "limit"; readonly limit: "step_limit" | "child_limit" }
  /** 중단됐다. code는 중단 사유 문자열(`user`, `budget` 등)이고 모르면 null */
  | { readonly kind: "interrupted"; readonly code: string | null }
  | { readonly kind: "failed"; readonly message: string | null };

/** 턴 안에서 사용자에게만 보인 휘발 알림 */
export type TurnNoticeRecord =
  | { readonly code: "gate_limit"; readonly limit: number | null }
  | {
      readonly code: "repeat_detected";
      readonly kind: string | null;
      readonly count: number | null;
    };

export type TurnAbortRecord = {
  readonly code: TurnAbortRequestedPayload["reason"]["code"];
  readonly message: string | null;
  readonly cause: TurnAbortRequestedPayload["cause"];
  readonly background: boolean;
};

export type TurnCompletion = {
  readonly at: string;
  readonly status: "completed" | "interrupted" | "failed";
  readonly stepCount: number;
  readonly usage: Usage | null;
  readonly error: string | null;
  /** 시작 사건과 끝 사건의 기록 시각 차(ms). 시작을 보지 못했으면 null */
  readonly durationMs: number | null;
  readonly end: TurnEnd;
};

export type TurnRecord = {
  readonly turnId: TurnId;
  /** 시작 사건 seq. 시작을 보지 못한 턴은 null */
  readonly startedSeq: number | null;
  readonly startedAt: string | null;
  readonly origin: NonNullable<TurnStartedPayload["origin"]>;
  /** 주도 턴이면 임대한 scope id */
  readonly scopeId: string | null;
  readonly requestId: string | null;
  /** 이 턴을 시작한 입력 item id(`turn.started`의 `inputItemIds`). 시작을 못 봤으면 빈 목록 */
  readonly inputItemIds: readonly ItemId[];
  /** 턴이 시작할 때 이 거울이 알던 대화의 모델. 모르면 null */
  readonly model: string | null;
  /** 끝난 단계 수(가장 큰 단계 번호 + 1) */
  readonly steps: number;
  /** `lastStopReason`과 `lastContextTokens`를 정한 단계 번호. 더 앞선 단계가 늦게 와도 덮지 않는다. 없으면 -1 */
  readonly lastStepIndex: number;
  readonly lastStopReason: StepCompletedPayload["stopReason"] | null;
  readonly warnings: readonly StepContextWarning[];
  /** 마지막 단계 요청의 추정 토큰 합. 없으면 null */
  readonly lastContextTokens: number | null;
  /** 마지막 단계 요청의 소유자별 토큰 어림(`step.completed.composition`, T-MEAS-CTX). 옛 기록에는 없어 null(DP-202) */
  readonly lastComposition: StepComposition | null;
  readonly notices: readonly TurnNoticeRecord[];
  readonly abort: TurnAbortRecord | null;
  readonly completion: TurnCompletion | null;
};

// ── 주도(drive 임대) ──────────────────────────────────────────────────

export type LeaseRecord = {
  readonly leaseId: string;
  readonly scopeId: string;
  readonly lineageId: string;
  readonly epoch: number | null;
  readonly limits: LeaseAcquiredPayload["limits"];
  readonly acquiredSeq: number;
  readonly acquiredAt: string;
  readonly releasedSeq: number | null;
  readonly releasedAt: string | null;
  readonly releaseReason: LeaseReleasedPayload["reason"] | null;
};

// ── 하위 에이전트 ─────────────────────────────────────────────────────

type AgentJudgment = {
  readonly goalRef: string;
  readonly seq: number;
  readonly run: number;
  readonly verdict: AgentJudgedPayload["verdict"];
  readonly rationale: string;
  readonly missing: readonly string[];
};

export type AgentRecord = {
  readonly childThreadId: ThreadId;
  readonly agent: string;
  readonly requestId: string;
  readonly caller: string;
  readonly depth: number;
  readonly background: boolean;
  readonly owner: AgentSpawnedPayload["owner"];
  readonly modelRole: string;
  readonly spawnedSeq: number;
  readonly spawnedAt: string;
  readonly status: "running" | "completed" | "aborted" | "error";
  readonly settledAt: string | null;
  /** 끝났을 때 보고 본문(잘렸으면 `reportTruncated`). 없으면 null */
  readonly reportText: string | null;
  readonly reportTruncated: boolean;
  readonly usage: Usage | null;
  readonly error: string | null;
  readonly limitHit: "steps" | "tokens" | null;
};

// ── 목표와 할 일 ──────────────────────────────────────────────────────

export type GoalState = {
  readonly goal: WorkGoalSetPayload["goal"];
  /** 마지막으로 반영한 사건 seq */
  readonly seq: number;
  /** 판정 기록(번호 `n`으로 거른다) */
  readonly judgments: readonly WorkGoalJudgedPayload[];
};

export type TaskState = {
  readonly task: WorkTaskCreatedPayload["task"];
  /** 마지막으로 반영한 사건 seq */
  readonly seq: number;
};

// ── 변화 표지 ─────────────────────────────────────────────────────────

/** 대화 줄 사이에 놓을 표지 하나. 줄 모델이 `at`(ISO)과 `seq`로 자리를 고른다 */
export type ConvoMarker = {
  readonly seq: number;
  readonly at: string;
  readonly change:
    | { readonly kind: "model"; readonly model: string }
    | { readonly kind: "permission_mode"; readonly value: string | null }
    | { readonly kind: "resumed"; readonly attempt: number; readonly mode: "manual" | "auto" }
    | { readonly kind: "scheduled_start"; readonly turnId: TurnId }
    | {
        readonly kind: "leaf_moved";
        readonly reason: LeafMovedPayload["reason"];
        readonly leafEventId: EventId;
      }
    | { readonly kind: "branch_summarized"; readonly summary: string };
};

export type ThreadConvo = {
  readonly turns: readonly TurnRecord[];
  /** 도구 호출 id별 기록 */
  readonly tools: Readonly<Record<string, ToolRecord>>;
  readonly toolOrder: readonly string[];
  /** 승인 id별 요청 요약(해결 때 도구 호출에 붙이려고 둔다) */
  readonly approvalDigests: Readonly<Record<string, ApprovalDigest>>;
  readonly approvalOrder: readonly string[];
  /** 도구 호출에 묶이지 않은 개입(시크릿 가림, 시크릿 승인)과 도구 호출 id 없는 승인 기록 */
  readonly looseInterventions: readonly Intervention[];
  readonly looseApprovals: readonly ApprovalTrail[];
  readonly leases: readonly LeaseRecord[];
  readonly agents: readonly AgentRecord[];
  /** 판정 에이전트의 판정(`agent.judged`). 받은 순서 */
  readonly judgments: readonly AgentJudgment[];
  readonly goal: GoalState | null;
  readonly tasks: Readonly<Record<string, TaskState>>;
  readonly taskOrder: readonly string[];
  readonly markers: readonly ConvoMarker[];
};

export const EMPTY_THREAD_CONVO: ThreadConvo = {
  turns: [],
  tools: {},
  toolOrder: [],
  approvalDigests: {},
  approvalOrder: [],
  looseInterventions: [],
  looseApprovals: [],
  leases: [],
  agents: [],
  judgments: [],
  goal: null,
  tasks: {},
  taskOrder: [],
  markers: [],
};

/** 거울 전체의 대화 상태. thread id별이다 */
export type Convo = Readonly<Record<string, ThreadConvo>>;

// ── 도우미 ────────────────────────────────────────────────────────────

function capTail<T>(list: readonly T[], cap: number): readonly T[] {
  return list.length <= cap ? list : list.slice(list.length - cap);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 도구 결과의 details에서 개입을 읽을 수 있게 `{ code, extension, reason, … }` 모양을 좁힌다 */
function detailsRecord(details: unknown): Readonly<Record<string, unknown>> | null {
  return isRecord(details) ? details : null;
}

function withThread(
  convo: Convo,
  threadId: ThreadId,
  change: (current: ThreadConvo) => ThreadConvo,
): Convo {
  const current = convo[threadId] ?? EMPTY_THREAD_CONVO;
  const next = change(current);
  return next === current ? convo : { ...convo, [threadId]: next };
}

// ── 턴 ────────────────────────────────────────────────────────────────

function newTurn(turnId: TurnId): TurnRecord {
  return {
    turnId,
    startedSeq: null,
    startedAt: null,
    origin: "user",
    scopeId: null,
    requestId: null,
    inputItemIds: [],
    model: null,
    steps: 0,
    lastStepIndex: -1,
    lastStopReason: null,
    warnings: [],
    lastContextTokens: null,
    lastComposition: null,
    notices: [],
    abort: null,
    completion: null,
  };
}

function upsertTurn(
  current: ThreadConvo,
  turnId: TurnId,
  change: (turn: TurnRecord) => TurnRecord,
): ThreadConvo {
  const index = current.turns.findIndex((t) => t.turnId === turnId);
  if (index < 0) {
    return {
      ...current,
      turns: capTail([...current.turns, change(newTurn(turnId))], CONVO_TURN_CAP),
    };
  }
  const found = current.turns[index];
  if (found === undefined) return current;
  const changed = change(found);
  if (changed === found) return current;
  return { ...current, turns: current.turns.map((t, i) => (i === index ? changed : t)) };
}

/** 턴이 끝난 이유. `error` 문자열은 루프가 쓰는 짧은 코드(`step_limit`, `child_limit`, 중단 사유)이거나 실패 문장이다 */
export function turnEndOf(status: TurnCompletion["status"], error: string | null): TurnEnd {
  if (status === "completed") return { kind: "completed" };
  if (status === "failed") return { kind: "failed", message: error };
  if (error === "step_limit" || error === "child_limit") return { kind: "limit", limit: error };
  return { kind: "interrupted", code: error };
}

function millisBetween(startIso: string | null, endIso: string): number | null {
  if (startIso === null) return null;
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  return Number.isNaN(start) || Number.isNaN(end) || end < start ? null : end - start;
}

// ── 사실 ──────────────────────────────────────────────────────────────

/** `turn.started`가 싣는 값(리듀서가 대화의 모델을 같이 준다) */
export type TurnStartFact = ConvoAt & {
  readonly threadId: ThreadId;
  readonly origin: NonNullable<TurnStartedPayload["origin"]>;
  readonly scopeId: string | null;
  readonly requestId: string | null;
  readonly inputItemIds: readonly ItemId[];
  readonly model: string | null;
};

export function convoTurnStarted(convo: Convo, fact: TurnStartFact): Convo {
  const turnId = fact.turnId;
  if (turnId === null) return convo;
  const started = withThread(convo, fact.threadId, (c) => {
    const next = upsertTurn(c, turnId, (t) =>
      t.startedSeq !== null
        ? t
        : {
            ...t,
            startedSeq: fact.seq,
            startedAt: fact.at,
            origin: fact.origin,
            scopeId: fact.scopeId,
            requestId: fact.requestId,
            inputItemIds: fact.inputItemIds,
            model: fact.model,
            // 끝 사건이 먼저 온 턴(보조 재생 순서)은 시작을 보고 나서 시간을 채운다
            completion:
              t.completion === null
                ? null
                : { ...t.completion, durationMs: millisBetween(fact.at, t.completion.at) },
          },
    );
    if (fact.origin !== "scheduled" || c.markers.some((m) => m.seq === fact.seq)) return next;
    return addMarker(next, {
      seq: fact.seq,
      at: fact.at,
      change: { kind: "scheduled_start", turnId },
    });
  });
  return started;
}

export type TurnCompleteFact = ConvoAt & {
  readonly threadId: ThreadId;
  readonly status: TurnCompletion["status"];
  readonly stepCount: number;
  readonly usage: Usage | null;
  readonly error: string | null;
};

export function convoTurnCompleted(convo: Convo, fact: TurnCompleteFact): Convo {
  const turnId = fact.turnId;
  if (turnId === null) return convo;
  return withThread(convo, fact.threadId, (c) =>
    upsertTurn(c, turnId, (t) =>
      t.completion !== null
        ? t
        : {
            ...t,
            steps: Math.max(t.steps, fact.stepCount),
            completion: {
              at: fact.at,
              status: fact.status,
              stepCount: fact.stepCount,
              usage: fact.usage,
              error: fact.error,
              durationMs: millisBetween(t.startedAt, fact.at),
              end: turnEndOf(fact.status, fact.error),
            },
          },
    ),
  );
}

/** 휘발 알림(`turn.updated`의 `gate_limit`, `repeat_detected`)을 그 턴에 붙인다 */
export function convoTurnNotice(
  convo: Convo,
  threadId: ThreadId,
  turnId: TurnId | null,
  notice: TurnNoticeRecord,
): Convo {
  if (turnId === null) return convo;
  return withThread(convo, threadId, (c) =>
    upsertTurn(c, turnId, (t) =>
      t.notices.some((n) => sameNotice(n, notice))
        ? t
        : { ...t, notices: capTail([...t.notices, notice], CONVO_TURN_NOTICE_CAP) },
    ),
  );
}

function sameNotice(a: TurnNoticeRecord, b: TurnNoticeRecord): boolean {
  if (a.code === "gate_limit" && b.code === "gate_limit") return a.limit === b.limit;
  if (a.code === "repeat_detected" && b.code === "repeat_detected") {
    return a.kind === b.kind && a.count === b.count;
  }
  return false;
}

/** 휘발 알림의 `detail`(JSON)에서 알려진 모양만 읽는다. 모양이 맞지 않으면 null */
export function turnNoticeOf(code: string, detail: unknown): TurnNoticeRecord | null {
  if (code === "gate_limit") {
    return { code, limit: isRecord(detail) ? numberOf(detail["limit"]) : null };
  }
  if (code === "repeat_detected") {
    return {
      code,
      kind: isRecord(detail) ? stringOf(detail["kind"]) : null,
      count: isRecord(detail) ? numberOf(detail["count"]) : null,
    };
  }
  return null;
}

// ── 도구 ──────────────────────────────────────────────────────────────

function upsertTool(
  current: ThreadConvo,
  toolCallId: string,
  change: (tool: ToolRecord) => ToolRecord,
): ThreadConvo {
  const found = current.tools[toolCallId];
  const base: ToolRecord = found ?? {
    toolCallId,
    progress: null,
    approvals: [],
    interventions: [],
  };
  const next = change(base);
  if (found === next) return current;
  const order = found === undefined ? [...current.toolOrder, toolCallId] : current.toolOrder;
  const capped = capTail(order, CONVO_TOOL_CAP);
  const tools: Record<string, ToolRecord> = { ...current.tools, [toolCallId]: next };
  for (const dropped of order) {
    if (!capped.includes(dropped)) delete tools[dropped];
  }
  return { ...current, tools, toolOrder: capped };
}

/** 같은 개입은 한 번만 둔다. 사건 위치는 보지 않는다(스냅숏에서 읽은 것은 위치가 없다) */
function sameIntervention(a: Intervention, b: Intervention): boolean {
  return (
    a.kind === b.kind &&
    a.extension === b.extension &&
    a.reason === b.reason &&
    a.detail === b.detail
  );
}

function addIntervention(tool: ToolRecord, item: Intervention): ToolRecord {
  if (tool.interventions.some((i) => sameIntervention(i, item))) return tool;
  return { ...tool, interventions: [...tool.interventions, item] };
}

function addLoose(current: ThreadConvo, item: Intervention): ThreadConvo {
  if (current.looseInterventions.some((i) => sameIntervention(i, item))) return current;
  return {
    ...current,
    looseInterventions: capTail([...current.looseInterventions, item], CONVO_LOOSE_CAP),
  };
}

/** 한 도구 호출에 개입을 붙인다. 도구 호출 id가 없으면 묶이지 않은 개입이다 */
function intervene(
  current: ThreadConvo,
  toolCallId: string | null,
  item: Intervention,
): ThreadConvo {
  return toolCallId === null
    ? addLoose(current, item)
    : upsertTool(current, toolCallId, (t) => addIntervention(t, item));
}

/** 출력(`partialResult.content`)의 글을 이어 붙인다. 글이 아닌 조각은 건너뛴다 */
export function progressTextOf(partialResult: {
  readonly content: readonly { readonly type: string }[];
}): string {
  let text = "";
  for (const part of partialResult.content) {
    if (part.type === "text" && "text" in part && typeof part.text === "string") text += part.text;
  }
  return text;
}

/** 진행 출력의 마지막 `TOOL_PROGRESS_LINES`줄. 한 줄은 `TOOL_PROGRESS_LINE_CHARS`자까지 자른다 */
export function tailLines(text: string): readonly string[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  return lines
    .slice(-TOOL_PROGRESS_LINES)
    .map((line) =>
      line.length > TOOL_PROGRESS_LINE_CHARS ? `${line.slice(0, TOOL_PROGRESS_LINE_CHARS)}…` : line,
    );
}

/** 휘발 `tool_progress`를 도구 호출에 붙인다. `toolKey`는 도구 호출 id이고 아직 모르면 item id다 */
export function convoToolProgress(
  convo: Convo,
  threadId: ThreadId,
  toolKey: string,
  itemId: ItemId,
  text: string,
): Convo {
  return withThread(convo, threadId, (c) =>
    upsertTool(c, toolKey, (t) => ({
      ...t,
      progress: {
        itemId,
        lines: tailLines(text),
        receivedChars: (t.progress?.receivedChars ?? 0) + text.length,
        updates: (t.progress?.updates ?? 0) + 1,
      },
    })),
  );
}

/**
 * 확정된 item 하나에서 개입을 읽는다. 도구 결과 item의 details가 `denied_by_extension`·`denied_by_guard`면 막힘이고,
 * `resultPatchedBy`가 있으면 훅이 결과를 고친 것이다(`core-tools/src/pipeline.ts`가 싣는다)
 */
export function convoItemRecorded(
  convo: Convo,
  threadId: ThreadId,
  at: ConvoAt,
  item: ItemRecord,
): Convo {
  if (item.kind !== "toolResult") return convo;
  const message = item.message;
  const toolCallId = message.toolCallId;
  const details = detailsRecord(message.details);
  if (details === null) return convo;
  const code = stringOf(details["code"]);
  const found: Intervention[] = [];
  if (code === "denied_by_extension" || code === "denied_by_guard") {
    found.push({
      kind: code === "denied_by_guard" ? "guard_denied" : "hook_denied",
      extension: stringOf(details["extension"]),
      reason: stringOf(details["reason"]),
      detail: stringOf(details["outcome"]),
      seq: at.seq,
      at: at.at,
    });
  }
  const patched = details["resultPatchedBy"];
  if (Array.isArray(patched)) {
    const names = patched.filter((n): n is string => typeof n === "string");
    if (names.length > 0) {
      found.push({
        kind: "hook_patched",
        extension: names[0] ?? null,
        reason: null,
        detail: names.join(", "),
        seq: at.seq,
        at: at.at,
      });
    }
  }
  if (found.length === 0) return convo;
  return withThread(convo, threadId, (c) =>
    found.reduce((acc, i) => intervene(acc, toolCallId, i), c),
  );
}

// ── 승인 ──────────────────────────────────────────────────────────────

export function convoApprovalRequested(
  convo: Convo,
  threadId: ThreadId,
  eventId: EventId,
  request: ApprovalRequestedPayload,
): Convo {
  return withThread(convo, threadId, (c) => {
    if (c.approvalDigests[eventId] !== undefined) return c;
    const digest: ApprovalDigest = {
      toolCallId: request.origin.toolCallId,
      title: request.title,
      caller: request.origin.caller,
      bodyKind: request.body.kind,
      toolName: request.body.kind === "tool" ? request.body.tool.toolName : null,
    };
    const order = capTail([...c.approvalOrder, eventId], CONVO_APPROVAL_CAP);
    const digests: Record<string, ApprovalDigest> = { ...c.approvalDigests, [eventId]: digest };
    for (const dropped of c.approvalOrder) {
      if (!order.includes(dropped)) delete digests[dropped];
    }
    return { ...c, approvalDigests: digests, approvalOrder: order };
  });
}

/** 해결 사건을 그 승인이 걸린 도구 호출에 기록으로 붙인다. 요청을 본 적 없는 승인은 붙일 곳이 없어 건너뛴다 */
export function convoApprovalResolved(
  convo: Convo,
  threadId: ThreadId,
  at: ConvoAt,
  resolved: ApprovalResolvedPayload,
): Convo {
  return withThread(convo, threadId, (c) => {
    const digest = c.approvalDigests[resolved.approvalId];
    if (digest === undefined) return c;
    const trail: ApprovalTrail = {
      approvalId: resolved.approvalId,
      decision: resolved.decision,
      remember: resolved.remember,
      requestedRemember: resolved.requestedRemember,
      resolvedBy: resolved.resolvedBy,
      ...(resolved.deviceId === undefined ? {} : { deviceId: resolved.deviceId }),
      title: digest.title,
      caller: digest.caller,
      bodyKind: digest.bodyKind,
      toolName: digest.toolName,
      seq: at.seq,
      at: at.at,
    };
    if (digest.toolCallId === null) {
      if (c.looseApprovals.some((a) => a.approvalId === trail.approvalId)) return c;
      return { ...c, looseApprovals: capTail([...c.looseApprovals, trail], CONVO_LOOSE_CAP) };
    }
    return upsertTool(c, digest.toolCallId, (t) =>
      t.approvals.some((a) => a.approvalId === trail.approvalId)
        ? t
        : { ...t, approvals: [...t.approvals, trail] },
    );
  });
}

// ── 표지 ──────────────────────────────────────────────────────────────

function addMarker(current: ThreadConvo, marker: ConvoMarker): ThreadConvo {
  if (current.markers.some((m) => m.seq === marker.seq && m.change.kind === marker.change.kind)) {
    return current;
  }
  const next = [...current.markers, marker].toSorted((a, b) => a.seq - b.seq);
  return { ...current, markers: capTail(next, CONVO_MARKER_CAP) };
}

/** 대화의 모델이 바뀌었다(`thread.updated.model`). 값이 있을 때만 표지다 */
export function convoModelChanged(
  convo: Convo,
  threadId: ThreadId,
  at: ConvoAt,
  model: string | null | undefined,
): Convo {
  if (typeof model !== "string") return convo;
  return withThread(convo, threadId, (c) =>
    addMarker(c, { seq: at.seq, at: at.at, change: { kind: "model", model } }),
  );
}

// ── 일반 사건 ─────────────────────────────────────────────────────────

function upsertAgent(
  current: ThreadConvo,
  childThreadId: ThreadId,
  make: () => AgentRecord | null,
  change: (agent: AgentRecord) => AgentRecord,
): ThreadConvo {
  const index = current.agents.findIndex((a) => a.childThreadId === childThreadId);
  if (index < 0) {
    const created = make();
    if (created === null) return current;
    return { ...current, agents: capTail([...current.agents, change(created)], CONVO_AGENT_CAP) };
  }
  const found = current.agents[index];
  if (found === undefined) return current;
  const changed = change(found);
  if (changed === found) return current;
  return { ...current, agents: current.agents.map((a, i) => (i === index ? changed : a)) };
}

/** 같은 사건 seq 이하로는 목표·할 일을 바꾸지 않는다(보조 재생이 더 새 상태를 되돌리지 못하게) */
function applyTask(
  current: ThreadConvo,
  taskId: string,
  seq: number,
  change: (state: TaskState) => TaskState,
  make: (() => TaskState) | null,
): ThreadConvo {
  const found = current.tasks[taskId];
  if (found === undefined) {
    if (make === null) return current;
    const created = make();
    return {
      ...current,
      tasks: { ...current.tasks, [taskId]: created },
      taskOrder: capTail([...current.taskOrder, taskId], CONVO_TASK_CAP),
    };
  }
  if (seq <= found.seq) return current;
  const changed = change(found);
  return { ...current, tasks: { ...current.tasks, [taskId]: { ...changed, seq } } };
}

/** 새 내구 kind 하나를 thread의 대화 상태에 반영한다 */
export function convoApply(
  convo: Convo,
  threadId: ThreadId,
  at: ConvoAt,
  event: ConvoEvent,
): Convo {
  switch (event.kind) {
    case "step.completed": {
      const turnId = at.turnId;
      if (turnId === null) return convo;
      const p = event.payload;
      return withThread(convo, threadId, (c) =>
        upsertTurn(c, turnId, (t) => {
          const warnings = [...t.warnings];
          for (const w of p.contextWarnings ?? []) {
            if (!warnings.some((x) => JSON.stringify(x) === JSON.stringify(w))) warnings.push(w);
          }
          const latest = p.stepIndex >= t.lastStepIndex;
          return {
            ...t,
            steps: Math.max(t.steps, p.stepIndex + 1),
            lastStepIndex: latest ? p.stepIndex : t.lastStepIndex,
            lastStopReason: latest ? p.stopReason : t.lastStopReason,
            warnings: capTail(warnings, CONVO_TURN_WARNING_CAP),
            lastContextTokens: latest
              ? (p.composition?.total ?? t.lastContextTokens)
              : t.lastContextTokens,
            lastComposition: latest ? (p.composition ?? t.lastComposition) : t.lastComposition,
          };
        }),
      );
    }
    case "turn.abort_requested": {
      const turnId = at.turnId;
      if (turnId === null) return convo;
      const p = event.payload;
      return withThread(convo, threadId, (c) =>
        upsertTurn(c, turnId, (t) => ({
          ...t,
          abort: {
            code: p.reason.code,
            message: p.reason.message,
            cause: p.cause,
            background: p.background,
          },
        })),
      );
    }
    case "agent.spawned": {
      const p = event.payload;
      return withThread(convo, threadId, (c) =>
        upsertAgent(
          c,
          p.childThreadId,
          () => ({
            childThreadId: p.childThreadId,
            agent: p.agent,
            requestId: p.requestId,
            caller: p.caller,
            depth: p.depth,
            background: p.background,
            owner: p.owner,
            modelRole: p.modelRole,
            spawnedSeq: at.seq,
            spawnedAt: at.at,
            status: "running",
            settledAt: null,
            reportText: null,
            reportTruncated: false,
            usage: null,
            error: null,
            limitHit: null,
          }),
          (a) => a,
        ),
      );
    }
    case "agent.settled": {
      const p = event.payload;
      return withThread(convo, threadId, (c) =>
        upsertAgent(
          c,
          p.childThreadId,
          () => null,
          (a) =>
            a.settledAt !== null
              ? a
              : {
                  ...a,
                  status: p.status,
                  settledAt: at.at,
                  reportText: p.report?.text ?? null,
                  reportTruncated: p.report?.truncated ?? false,
                  usage: p.usage,
                  error: p.error,
                  limitHit: p.limitHit ?? null,
                },
        ),
      );
    }
    case "agent.judged": {
      // 판정 에이전트의 판정. 목표 참조(`goalRef`)와 번호(`run`)로 거른다
      const p = event.payload;
      return withThread(convo, threadId, (c) =>
        c.judgments.some((j) => j.goalRef === p.goalRef && j.run === p.run)
          ? c
          : {
              ...c,
              judgments: capTail(
                [
                  ...c.judgments,
                  {
                    goalRef: p.goalRef,
                    run: p.run,
                    verdict: p.verdict,
                    rationale: p.rationale,
                    missing: p.missing,
                    seq: at.seq,
                  },
                ],
                CONVO_AGENT_CAP,
              ),
            },
      );
    }
    case "work.goal_set": {
      const p = event.payload;
      return withThread(convo, threadId, (c) =>
        c.goal !== null && at.seq <= c.goal.seq
          ? c
          : { ...c, goal: { goal: p.goal, seq: at.seq, judgments: [] } },
      );
    }
    case "work.goal_judged": {
      const p = event.payload;
      return withThread(convo, threadId, (c) => {
        const goal = c.goal;
        if (goal === null || goal.goal.goalId !== p.goalId) return c;
        if (goal.judgments.some((j) => j.n === p.n)) return c;
        const judgments = [...goal.judgments, p].toSorted((a, b) => a.n - b.n);
        return {
          ...c,
          goal: {
            ...goal,
            seq: Math.max(goal.seq, at.seq),
            judgments,
            goal: {
              ...goal.goal,
              judgments: Math.max(goal.goal.judgments, p.n),
              lastVerdict:
                p.n >= goal.goal.judgments
                  ? (p.verdict ?? goal.goal.lastVerdict)
                  : goal.goal.lastVerdict,
            },
          },
        };
      });
    }
    case "work.goal_settled": {
      const p = event.payload;
      return withThread(convo, threadId, (c) => {
        const goal = c.goal;
        if (goal === null || goal.goal.goalId !== p.goalId) return c;
        if (at.seq < goal.seq) return c;
        if (goal.goal.status === p.status && goal.goal.judgments === p.judgments) return c;
        return {
          ...c,
          goal: {
            ...goal,
            seq: Math.max(goal.seq, at.seq),
            goal: { ...goal.goal, status: p.status, judgments: p.judgments },
          },
        };
      });
    }
    case "work.task_created": {
      const task = event.payload.task;
      return withThread(convo, threadId, (c) =>
        applyTask(
          c,
          task.id,
          at.seq,
          (s) => s,
          () => ({ task, seq: at.seq }),
        ),
      );
    }
    case "work.task_changed": {
      const p = event.payload;
      return withThread(convo, threadId, (c) =>
        applyTask(
          c,
          p.taskId,
          at.seq,
          (s) => ({
            ...s,
            task: {
              ...s.task,
              ...(p.set.content !== undefined ? { content: p.set.content } : {}),
              ...(p.set.activeForm !== undefined ? { activeForm: p.set.activeForm } : {}),
              ...(p.set.status !== undefined ? { status: p.set.status } : {}),
              ...(p.set.owner !== undefined ? { owner: p.set.owner } : {}),
            },
          }),
          null,
        ),
      );
    }
    case "work.task_linked":
    case "work.task_unlinked": {
      const p = event.payload;
      const link = event.kind === "work.task_linked";
      return withThread(convo, threadId, (c) =>
        applyTask(
          c,
          p.taskId,
          at.seq,
          (s) => ({
            ...s,
            task: {
              ...s.task,
              blockedBy: link
                ? [...s.task.blockedBy.filter((id) => !p.blockedBy.includes(id)), ...p.blockedBy]
                : s.task.blockedBy.filter((id) => !p.blockedBy.includes(id)),
            },
          }),
          null,
        ),
      );
    }
    case "thread.leaf_moved": {
      const p = event.payload;
      return withThread(convo, threadId, (c) =>
        addMarker(c, {
          seq: at.seq,
          at: at.at,
          change: { kind: "leaf_moved", reason: p.reason, leafEventId: p.leafEventId },
        }),
      );
    }
    case "thread.branch_summarized": {
      const p = event.payload;
      return withThread(convo, threadId, (c) =>
        addMarker(c, {
          seq: at.seq,
          at: at.at,
          change: { kind: "branch_summarized", summary: p.summary },
        }),
      );
    }
    case "thread.resumed": {
      const p = event.payload;
      return withThread(convo, threadId, (c) =>
        addMarker(c, {
          seq: at.seq,
          at: at.at,
          change: { kind: "resumed", attempt: p.attempt, mode: p.mode },
        }),
      );
    }
    case "settings.changed": {
      const p = event.payload;
      if (p.key !== PERMISSION_MODE_SETTING_KEY) return convo;
      return withThread(convo, threadId, (c) =>
        addMarker(c, {
          seq: at.seq,
          at: at.at,
          change: { kind: "permission_mode", value: stringOf(p.value) },
        }),
      );
    }
    case "tool.sandbox_bypassed": {
      const p = event.payload;
      return withThread(convo, threadId, (c) =>
        intervene(c, p.toolCallId, {
          kind: "sandbox_bypassed",
          extension: null,
          reason: p.reason,
          detail: p.toolName,
          seq: at.seq,
          at: at.at,
        }),
      );
    }
    case "tool.untrusted_read": {
      const p = event.payload;
      return withThread(convo, threadId, (c) =>
        intervene(c, p.toolCallId, {
          kind: "untrusted_read",
          extension: null,
          reason: null,
          detail: p.toolName,
          seq: at.seq,
          at: at.at,
        }),
      );
    }
    case "secret.used": {
      const p = event.payload;
      return withThread(convo, threadId, (c) =>
        intervene(c, p.toolCallId, {
          kind: "secret_used",
          extension: null,
          reason: null,
          detail: p.handle,
          seq: at.seq,
          at: at.at,
        }),
      );
    }
    case "secret.denied": {
      const p = event.payload;
      return withThread(convo, threadId, (c) =>
        intervene(c, p.toolCallId, {
          kind: "secret_denied",
          extension: null,
          reason: p.reason,
          detail: p.handle,
          seq: at.seq,
          at: at.at,
        }),
      );
    }
    case "secret.approved": {
      const p = event.payload;
      return withThread(convo, threadId, (c) =>
        addLoose(c, {
          kind: "secret_approved",
          extension: null,
          reason: p.scope,
          detail: p.handle,
          seq: at.seq,
          at: at.at,
        }),
      );
    }
    case "secret.masked": {
      const p = event.payload;
      return withThread(convo, threadId, (c) =>
        addLoose(c, {
          kind: "secret_masked",
          extension: null,
          reason: null,
          detail: p.layer,
          seq: at.seq,
          at: at.at,
        }),
      );
    }
    default:
      return assertNever(event, "convoApply");
  }
}

// ── 주도 임대 ─────────────────────────────────────────────────────────

export function convoLeaseAcquired(
  convo: Convo,
  threadId: ThreadId,
  at: ConvoAt,
  p: LeaseAcquiredPayload,
): Convo {
  return withThread(convo, threadId, (c) => {
    if (c.leases.some((l) => l.leaseId === p.leaseId)) return c;
    const record: LeaseRecord = {
      leaseId: p.leaseId,
      scopeId: p.scopeId,
      lineageId: p.lineageId,
      epoch: p.leaseEpoch ?? null,
      limits: p.limits,
      acquiredSeq: at.seq,
      acquiredAt: at.at,
      releasedSeq: null,
      releasedAt: null,
      releaseReason: null,
    };
    return { ...c, leases: capTail([...c.leases, record], CONVO_LEASE_CAP) };
  });
}

export function convoLeaseReleased(
  convo: Convo,
  threadId: ThreadId,
  at: ConvoAt,
  p: LeaseReleasedPayload,
): Convo {
  return withThread(convo, threadId, (c) => {
    const found = c.leases.find((l) => l.leaseId === p.leaseId);
    if (found === undefined || found.releasedSeq !== null) return c;
    return {
      ...c,
      leases: c.leases.map((l) =>
        l === found ? { ...l, releasedSeq: at.seq, releasedAt: at.at, releaseReason: p.reason } : l,
      ),
    };
  });
}
