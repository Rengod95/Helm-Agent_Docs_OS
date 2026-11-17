import { Type, type TLiteral, type TUnion, type TUnsafe } from "typebox";
import { Nullable, type SchemaProof, type SchemaSound } from "../../base/index.ts";
import { StepCompositionSchema, type StepComposition } from "../../conversation/index.ts";
import {
  TOOL_CALL_VERDICTS,
  TRACE_FAILURE_REASONS,
  TRACE_HANDLER_RESULTS,
  type ToolCallVerdict,
  type TraceFailureReason,
  type TraceHandlerResult,
} from "../../extensions/index.ts";
import { SubIdSchema, type SubId } from "./cursor.ts";
import { EmptyParamsSchema, type EmptyParams } from "./notifications.ts";
import { closed, request, type Req } from "./schema-kit.ts";

// 턴 기록(M5d)의 저장 문자열 정본. 정본 문서는 docs/xeon/review/m5/turn-record-metrics.md §3.2(기록 스키마),
// §3.5(메서드·알림), §3.7(지난 턴에 돌려 보기), §3.8(화면용 읽기)다. 저장 문자열(값, 키 이름)은 정본과 글자 하나 다르지 않게 둔다.
// 메서드는 처리기가 생기기 전까지 레지스트리(methods.ts)에 넣지 않는다. 여기서는 타입과 params·result 스키마만 export한다.

/** 문자열 값 목록의 리터럴 유니온. 목록 순서는 정본 순서다 */
function literalUnion<const T extends readonly string[]>(values: T): TUnion<TLiteral<T[number]>[]> {
  return Type.Union(values.map((value) => Type.Literal(value)));
}

const ThreadRef = Type.String({ minLength: 1, maxLength: 64 });
const Id = Type.String({ minLength: 1, maxLength: 128 });
const Name = Type.String({ minLength: 1, maxLength: 96 });
const Cursor = Type.String({ minLength: 1, maxLength: 256 });
const Count = Type.Integer({ minimum: 0 });
const Ms = Type.Number({ minimum: 0 });
/** 도구 호출 키: 인자 정규화 JSON의 HMAC 16 hex */
const Hex16 = Type.String({ pattern: "^[0-9a-f]{16}$" });
/** 목록 상한. 기본 50은 메서드 params의 `limit` 설명에서 준다 */
const Limit = Type.Integer({ minimum: 1, maximum: 200 });

// ── 값 목록(enum) ──────────────────────────────────────────────────────

/** 기록 수준(`x.operations.trace.*` 설정이 정한다) */
export const RECORD_LEVELS = ["full", "log_only", "none"] as const;
export type RecordLevel = (typeof RECORD_LEVELS)[number];
export const RecordLevelSchema: TUnion<TLiteral<RecordLevel>[]> = literalUnion(RECORD_LEVELS);

/** 턴이 돈 범위(§4.6 규칙 31). `live` 일반 대화, `overlay_reviewed` 검토된 일회 덧씌우기, `overlay_draft` 초안 덧씌우기, `test` 테스트 실행, `craft` 테스트 대화 */
export const SCOPE_KINDS = ["live", "overlay_reviewed", "overlay_draft", "test", "craft"] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];
export const ScopeKindSchema: TUnion<TLiteral<ScopeKind>[]> = literalUnion(SCOPE_KINDS);

/** 호출한 쪽. `plugin`이면 `CallRecord.callerPlugin`이 플러그인 이름이다 */
export const CALLER_KINDS = ["main", "subagent", "plugin"] as const;
export type CallerKind = (typeof CALLER_KINDS)[number];
export const CallerKindSchema: TUnion<TLiteral<CallerKind>[]> = literalUnion(CALLER_KINDS);

/** 도구 호출의 판정 열네 가지(§3.2). 목록의 정본은 extensions의 `TOOL_CALL_VERDICTS`다(싱크와 같은 값을 쓴다) */
export const VERDICTS: typeof TOOL_CALL_VERDICTS = TOOL_CALL_VERDICTS;
export type Verdict = ToolCallVerdict;
export const VerdictSchema: TUnion<TLiteral<Verdict>[]> = literalUnion(VERDICTS);

/** 훅 결과의 표시값 여섯(F §4.5, R12). 저장 열이 아니라 `result`·`reason`·`decision`에서 파생한다 */
export const HOOK_OUTCOMES = ["pass", "modified", "asked", "blocked", "error", "timeout"] as const;
export type HookOutcome = (typeof HOOK_OUTCOMES)[number];
export const HookOutcomeSchema: TUnion<TLiteral<HookOutcome>[]> = literalUnion(HOOK_OUTCOMES);

/** 턴 상태. `open`은 진행 중, `lost`는 프로세스가 죽어 `turn.completed`가 없다 */
export const TURN_STATUSES = ["completed", "interrupted", "failed", "open", "lost"] as const;
export type TurnStatus = (typeof TURN_STATUSES)[number];
export const TurnStatusSchema: TUnion<TLiteral<TurnStatus>[]> = literalUnion(TURN_STATUSES);

/** 지표·발견이 다루는 대상 종류(`MetricDef.appliesTo`, `Finding.subject.kind`) */
export const SUBJECT_KINDS = ["instruction", "skill", "tool", "hook", "drive", "block"] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];
export const SubjectKindSchema: TUnion<TLiteral<SubjectKind>[]> = literalUnion(SUBJECT_KINDS);

/** 지표 차원(`Dim`, §3.5). `pluginVersion`은 `versionId`다 */
export const DIMS = [
  "plugin",
  "ref",
  "hook",
  "model",
  "profile",
  "pluginVersion",
  "scope",
  "caller",
  "day",
] as const;
export type Dim = (typeof DIMS)[number];
export const DimSchema: TUnion<TLiteral<Dim>[]> = literalUnion(DIMS);

export const METRIC_STATES = ["exact", "approx", "insufficient_sample", "unavailable"] as const;
export type MetricState = (typeof METRIC_STATES)[number];
export const MetricStateSchema: TUnion<TLiteral<MetricState>[]> = literalUnion(METRIC_STATES);

/** `MetricValue.reason`. 정본 목록 그대로다. §3.8의 `user_marked`는 이 목록에 없어 [미결]이다 */
export const METRIC_REASONS = [
  "measurement_off",
  "not_recorded",
  "needs_loader",
  "beyond_retention",
  "undefined_without_labels",
] as const;
export type MetricReason = (typeof METRIC_REASONS)[number];
export const MetricReasonSchema: TUnion<TLiteral<MetricReason>[]> = literalUnion(METRIC_REASONS);

export const METRIC_NOTE_CODES = [
  "insufficient_sample",
  "confounded",
  "measurement_off",
  "partial_window",
] as const;
export type MetricNoteCode = (typeof METRIC_NOTE_CODES)[number];
export const MetricNoteCodeSchema: TUnion<TLiteral<MetricNoteCode>[]> =
  literalUnion(METRIC_NOTE_CODES);

export const FINDING_STATES = ["open", "dismissed"] as const;
export type FindingState = (typeof FINDING_STATES)[number];
export const FindingStateSchema: TUnion<TLiteral<FindingState>[]> = literalUnion(FINDING_STATES);

/** `TurnRecord.flags`의 키. `turnRecord.list`의 `flags` 거르기도 이 목록을 쓴다 */
export const TURN_FLAG_KEYS = [
  "blockedIntent",
  "blockedFault",
  "deniedPolicy",
  "deniedHuman",
  "deniedNoninteractive",
  "replaced",
  "cancelledAsk",
  "asked",
  "modified",
  "timedOut",
  "failed",
  "drive",
  "cacheBreak",
  "subagents",
  "truncatedMaterials",
  "draftActive",
  "untrackedWrite",
] as const;
export type TurnFlagKey = (typeof TURN_FLAG_KEYS)[number];
export const TurnFlagKeySchema: TUnion<TLiteral<TurnFlagKey>[]> = literalUnion(TURN_FLAG_KEYS);

/** 지난 턴에 돌려 보기의 분류(§3.7). 정본 목록 그대로다 */
export const BACKTEST_CLASSES = [
  "newly_caught",
  "already_stopped",
  "agrees_block",
  "would_block_allowed_by_human",
  "passes_same",
  "candidate_fault",
  "unreplayable",
] as const;
export type BacktestClass = (typeof BACKTEST_CLASSES)[number];
export const BacktestClassSchema: TUnion<TLiteral<BacktestClass>[]> =
  literalUnion(BACKTEST_CLASSES);

// ── 훅 실행과 호출 ─────────────────────────────────────────────────────

const TraceHandlerResultSchema: TUnion<TLiteral<TraceHandlerResult>[]> =
  literalUnion(TRACE_HANDLER_RESULTS);

/** `HookRun.reason`의 값(§3.2). 라이브 `trace.turn`과 같은 목록 `TRACE_FAILURE_REASONS`(격리 프로세스 종료 둘 포함)를 그대로 쓴다 */
const HookFailureReasonSchema: TUnion<TLiteral<TraceFailureReason>[]> =
  literalUnion(TRACE_FAILURE_REASONS);

/** 묶인 대상. 도구 호출 훅은 toolCallId, 물음 훅은 approvalId, 서브에이전트 훅은 spawnRequestId와 childThreadId */
export interface HookSubject {
  readonly toolCallId?: string;
  readonly approvalId?: string;
  readonly spawnRequestId?: string;
  readonly childThreadId?: string;
}
const HookSubjectShape = closed({
  toolCallId: Type.Optional(Id),
  approvalId: Type.Optional(Id),
  spawnRequestId: Type.Optional(Id),
  childThreadId: Type.Optional(ThreadRef),
});
export const HookSubjectSchema: TUnsafe<HookSubject> = Type.Unsafe<HookSubject>(
  HookSubjectShape satisfies SchemaProof<HookSubject, typeof HookSubjectShape>,
);

/** 핸들러가 낸 결정값(F §4.2). `cancel`·`answer`는 `ask.human.before` 전용(F §4.3.1) */
export const HOOK_DECISIONS = ["none", "block", "ask", "replace", "cancel", "answer"] as const;
export type HookDecision = (typeof HOOK_DECISIONS)[number];
const HookDecisionSchema: TUnion<TLiteral<HookDecision>[]> = literalUnion(HOOK_DECISIONS);

/** 사람 대기 메타데이터. `via`가 `decision`이면 핸들러가 `{ ask: true }`를 돌려 코어가 카드를 띄운 것, `awaitUser`이면 핸들러가 직접 기다린 것이다 */
export interface HookAsk {
  readonly via: "decision" | "awaitUser";
  readonly waits: number;
  readonly waitMs: number;
  readonly approvalId: string | null;
  readonly answer: "allow" | "deny" | "answer" | "cancelled" | "expired" | "noninteractive" | null;
}
const HookAskShape = closed({
  via: literalUnion(["decision", "awaitUser"]),
  waits: Count,
  waitMs: Ms,
  approvalId: Nullable(Id),
  answer: Nullable(
    literalUnion(["allow", "deny", "answer", "cancelled", "expired", "noninteractive"]),
  ),
});

/** 훅 실행 한 줄(§3.2). `result`는 기존 `TraceHandlerResult`(다섯 값)를 그대로 쓴다 */
export interface HookRun {
  /** 기록 당시의 훅 이름 문자열. 나중에 바꾸지 않는다 */
  readonly hook: string;
  readonly registrationId: string;
  readonly plugin: string;
  readonly versionId: string | null;
  readonly sourceKind: "plugin" | "external_hook" | "builtin";
  /** 같은 디스패치 안의 실행 순서 */
  readonly seq: number;
  readonly subject: HookSubject;
  /** `subject.toolCallId`의 사본(거르기용) */
  readonly toolCallId: string | null;
  readonly result: TraceHandlerResult;
  /** `failed`의 이유. 다른 결과에서는 null. `process_exit`·`process_killed`는 격리 프로세스의 종료다(엔진 설계 §3.3) */
  readonly reason: TraceFailureReason | null;
  readonly decision: HookDecision;
  readonly ask: HookAsk | null;
  /** 활성 시간(사람 응답 대기 제외) */
  readonly ms: number;
  readonly atMs: number;
  /** modified일 때 바뀐 크기 */
  readonly size: number;
  readonly skippedBy: string | null;
  /** blocked의 사유. 시크릿을 가리고 200자까지 */
  readonly decisionText: string | null;
}
const HookRunShape = closed({
  hook: Name,
  registrationId: Id,
  plugin: Name,
  versionId: Nullable(Id),
  sourceKind: literalUnion(["plugin", "external_hook", "builtin"]),
  seq: Count,
  subject: HookSubjectSchema,
  toolCallId: Nullable(Id),
  result: TraceHandlerResultSchema,
  reason: Nullable(HookFailureReasonSchema),
  decision: HookDecisionSchema,
  ask: Nullable(HookAskShape),
  ms: Ms,
  atMs: Ms,
  size: Count,
  skippedBy: Nullable(Id),
  decisionText: Nullable(Type.String({ maxLength: 200 })),
});
export const HookRunSchema: TUnsafe<HookRun> = Type.Unsafe<HookRun>(
  HookRunShape satisfies SchemaProof<HookRun, typeof HookRunShape>,
);

/** 모델 호출 한 줄. `drive`는 주도 함수의 model 명령이다 */
export interface ModelCall {
  readonly role: "main" | "judge" | "summary" | "search" | "review" | "title" | "drive";
  /** drive일 때 명령이 준 자유 문자열(64자까지). 그 밖에는 null */
  readonly label: string | null;
  readonly provider: string;
  readonly modelId: string;
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly firstTokenMs: number | null;
  readonly usage: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
  };
  /** provider_retry 알림 수와 기다린 시간 합(회복 전 시도) */
  readonly retries: number;
  readonly retryWaitMs: number;
  readonly stopReason: string;
}
const ModelCallShape = closed({
  role: literalUnion(["main", "judge", "summary", "search", "review", "title", "drive"]),
  label: Nullable(Type.String({ maxLength: 64 })),
  provider: Id,
  modelId: Id,
  startedAtMs: Ms,
  durationMs: Ms,
  firstTokenMs: Nullable(Ms),
  usage: closed({ input: Count, output: Count, cacheRead: Count, cacheWrite: Count }),
  retries: Count,
  retryWaitMs: Ms,
  stopReason: Type.String({ maxLength: 64 }),
});
export const ModelCallSchema: TUnsafe<ModelCall> = Type.Unsafe<ModelCall>(
  ModelCallShape satisfies SchemaProof<ModelCall, typeof ModelCallShape>,
);

/** 재료. 지침 한 덩어리. 값 자체는 저장하지 않는다 */
export interface Material {
  readonly plugin: string;
  readonly versionId: string | null;
  readonly registrationId: string | null;
  /** always: 항상 실림. drive: Drive 중에만. on_demand: 읽을 때(스킬 본문, 활성화한 도구 설명) */
  readonly kind: "always" | "drive" | "on_demand";
  readonly material:
    | "instruction"
    | "skill_index"
    | "skill_body"
    | "memory"
    | "hook_text"
    | "tool_defs";
  /** 파일 경로 해시, 스킬 이름, 도구 이름 등 사람이 알아볼 이름. 내용이 아니다 */
  readonly ref: string;
  readonly tokens: number;
  readonly truncated: boolean;
  /** 예산 때문에 싣지 못한 항목 수(스킬 색인) */
  readonly omitted: number | null;
  readonly itemId: string | null;
  /** hook_text 귀속이 선언이 아니라 추정이면 inferred */
  readonly attribution: "declared" | "inferred" | "shared";
}
const MaterialShape = closed({
  plugin: Name,
  versionId: Nullable(Id),
  registrationId: Nullable(Id),
  kind: literalUnion(["always", "drive", "on_demand"]),
  material: literalUnion([
    "instruction",
    "skill_index",
    "skill_body",
    "memory",
    "hook_text",
    "tool_defs",
  ]),
  ref: Type.String({ minLength: 1, maxLength: 256 }),
  tokens: Count,
  truncated: Type.Boolean(),
  omitted: Nullable(Count),
  itemId: Nullable(Id),
  attribution: literalUnion(["declared", "inferred", "shared"]),
});
export const MaterialSchema: TUnsafe<Material> = Type.Unsafe<Material>(
  MaterialShape satisfies SchemaProof<Material, typeof MaterialShape>,
);

/** 광고된 도구와 색인(§3.2). `tools`는 턴 안에서 처음 광고된 단계 기준이고 상한 256개다 */
export interface Advertised {
  readonly count: number;
  readonly tokens: number;
  readonly deferredCount: number;
  readonly removedCount: number;
  readonly fingerprint: string;
  readonly byPlugin: {
    readonly plugin: string;
    readonly count: number;
    readonly tokens: number;
    readonly deferred: number;
    readonly activated: number;
  }[];
  readonly tools: {
    readonly name: string;
    readonly plugin: string;
    readonly tokens: number;
    readonly state: "advertised" | "deferred" | "activated";
    readonly called: number;
  }[];
}
const AdvertisedShape = closed({
  count: Count,
  tokens: Count,
  deferredCount: Count,
  removedCount: Count,
  fingerprint: Type.String({ minLength: 1, maxLength: 128 }),
  byPlugin: Type.Array(
    closed({ plugin: Name, count: Count, tokens: Count, deferred: Count, activated: Count }),
  ),
  tools: Type.Array(
    closed({
      name: Name,
      plugin: Name,
      tokens: Count,
      state: literalUnion(["advertised", "deferred", "activated"]),
      called: Count,
    }),
    { maxItems: 256 },
  ),
});
export const AdvertisedSchema: TUnsafe<Advertised> = Type.Unsafe<Advertised>(
  AdvertisedShape satisfies SchemaProof<Advertised, typeof AdvertisedShape>,
);

/** 캐시가 깨진 관찰과 원인 목록(§3.2) */
export interface CacheBreak {
  /** 제공자가 알린 캐시 읽기·쓰기로 깨짐을 관찰했나 */
  readonly observed: boolean;
  readonly causes: {
    readonly kind:
      | "prefix_reset"
      | "toolset"
      | "section"
      | "model_switch"
      | "ttl"
      | "compaction"
      | "overlay_tools"
      | "unknown";
    readonly plugin: string | null;
    readonly registrations: string[];
    readonly evidence: "declared" | "inferred";
  }[];
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly priorCacheRead: number | null;
  readonly priorCacheWrite: number | null;
}
const CacheBreakShape = closed({
  observed: Type.Boolean(),
  causes: Type.Array(
    closed({
      kind: literalUnion([
        "prefix_reset",
        "toolset",
        "section",
        "model_switch",
        "ttl",
        "compaction",
        "overlay_tools",
        "unknown",
      ]),
      plugin: Nullable(Name),
      registrations: Type.Array(Id, { maxItems: 64 }),
      evidence: literalUnion(["declared", "inferred"]),
    }),
  ),
  cacheRead: Count,
  cacheWrite: Count,
  priorCacheRead: Nullable(Count),
  priorCacheWrite: Nullable(Count),
});
export const CacheBreakSchema: TUnsafe<CacheBreak> = Type.Unsafe<CacheBreak>(
  CacheBreakShape satisfies SchemaProof<CacheBreak, typeof CacheBreakShape>,
);

/** 도구 호출 한 건(§3.2). 판정, 승인, 실행, 결과 크기를 모은다 */
export interface CallRecord {
  readonly toolCallId: string;
  readonly parentToolCallId: string | null;
  readonly tool: string;
  /** 도구를 낸 플러그인(§4.5 규칙 17) */
  readonly plugin: string;
  readonly caller: CallerKind;
  /** caller가 plugin일 때 이름 */
  readonly callerPlugin: string | null;
  /** 호출이 들어온 길(F §4.6 PluginCallRequest.via). 모델이 부른 호출이면 null */
  readonly via: "hook" | "tool" | "command" | "method" | "drive" | "effect" | null;
  readonly risk: "read" | "write" | "exec";
  readonly capability: { readonly id: string; readonly method: string } | null;
  /** 인자 정규화 JSON의 HMAC 16 hex(대화별 소금이 아닌 설치별 소금) */
  readonly callKey: string;
  /** 도구가 선언한 대상 경로 집합의 HMAC. 없으면 null */
  readonly targetKey: string | null;
  readonly afterUntrusted: boolean;
  readonly verdict: Verdict;
  readonly blockedBy: {
    readonly plugin: string | null;
    readonly hook: string | null;
    readonly registrationId: string | null;
  } | null;
  /** tool.call.before, guard.tool.before, tool.result 등 이 호출에 묶인 것 */
  readonly hooks: HookRun[];
  readonly policy: {
    readonly effect: "allow" | "ask" | "deny";
    readonly tier: string | null;
  } | null;
  readonly approval: {
    readonly approvalId: string;
    readonly decision: "allow" | "deny" | "answer";
    readonly resolvedBy: string;
    readonly waitMs: number;
    /** 바깥 플러그인 호출의 승인을 물려받아 카드가 안 뜬 경우(F §5.3 U-11)의 바깥 approvalId */
    readonly inheritedFrom: string | null;
  } | null;
  readonly exec: {
    readonly startedAtMs: number;
    readonly durationMs: number | null;
    readonly status: "ok" | "error" | "interrupted" | "abandoned";
    readonly effectId: string | null;
  } | null;
  readonly result: {
    readonly tokens: number;
    readonly bytes: number;
    readonly truncated: boolean;
    readonly isError: boolean;
    readonly itemId: string | null;
  } | null;
}
const CallRecordShape = closed({
  toolCallId: Id,
  parentToolCallId: Nullable(Id),
  tool: Name,
  plugin: Name,
  caller: CallerKindSchema,
  callerPlugin: Nullable(Name),
  via: Nullable(literalUnion(["hook", "tool", "command", "method", "drive", "effect"])),
  risk: literalUnion(["read", "write", "exec"]),
  capability: Nullable(closed({ id: Id, method: Name })),
  callKey: Hex16,
  targetKey: Nullable(Id),
  afterUntrusted: Type.Boolean(),
  verdict: VerdictSchema,
  blockedBy: Nullable(
    closed({ plugin: Nullable(Name), hook: Nullable(Name), registrationId: Nullable(Id) }),
  ),
  hooks: Type.Array(HookRunSchema),
  policy: Nullable(
    closed({ effect: literalUnion(["allow", "ask", "deny"]), tier: Nullable(Name) }),
  ),
  approval: Nullable(
    closed({
      approvalId: Id,
      decision: literalUnion(["allow", "deny", "answer"]),
      resolvedBy: Name,
      waitMs: Ms,
      inheritedFrom: Nullable(Id),
    }),
  ),
  exec: Nullable(
    closed({
      startedAtMs: Ms,
      durationMs: Nullable(Ms),
      status: literalUnion(["ok", "error", "interrupted", "abandoned"]),
      effectId: Nullable(Id),
    }),
  ),
  result: Nullable(
    closed({
      tokens: Count,
      bytes: Count,
      truncated: Type.Boolean(),
      isError: Type.Boolean(),
      itemId: Nullable(Id),
    }),
  ),
});
export const CallRecordSchema: TUnsafe<CallRecord> = Type.Unsafe<CallRecord>(
  CallRecordShape satisfies SchemaProof<CallRecord, typeof CallRecordShape>,
);

/** 한 단계의 기록(§3.2). `composition`은 `step.completed.composition`의 사본이다 */
export interface StepRecord {
  readonly stepIndex: number;
  readonly stepId: string;
  /** 보통 1개. 판정·요약 호출은 role로 구분 */
  readonly modelCalls: ModelCall[];
  readonly materials: Material[];
  readonly advertised: Advertised;
  readonly cache: CacheBreak | null;
  /** 컨텍스트·요청·단계 끝 훅(도구 호출에 묶이지 않은 것) */
  readonly hooks: HookRun[];
  readonly calls: CallRecord[];
  readonly composition: StepComposition | null;
  readonly recorded: boolean;
}
const StepRecordShape = closed({
  stepIndex: Count,
  stepId: Id,
  modelCalls: Type.Array(ModelCallSchema),
  materials: Type.Array(MaterialSchema),
  advertised: AdvertisedSchema,
  cache: Nullable(CacheBreakSchema),
  hooks: Type.Array(HookRunSchema),
  calls: Type.Array(CallRecordSchema),
  composition: Nullable(StepCompositionSchema),
  recorded: Type.Boolean(),
});
export const StepRecordSchema: TUnsafe<StepRecord> = Type.Unsafe<StepRecord>(
  StepRecordShape satisfies SchemaProof<StepRecord, typeof StepRecordShape>,
);

/** 덧씌우기 표지. M5c `profile.applied.overlay`를 그대로 옮긴 것이다. 정본은 M5c §3.2 */
export interface OverlayMark {
  readonly kind: "once" | "draft";
  /** draftId가 있으면 초안 */
  readonly plugins: {
    readonly id: string;
    readonly versionId: string;
    readonly draftId?: string;
  }[];
  readonly until: "turn" | "release";
  /** 덧씌운 도구 때문에 이 턴의 도구 목록이 바뀌어 캐시가 깨졌나 */
  readonly toolsetChanged: boolean;
}
const OverlayMarkShape = closed({
  kind: literalUnion(["once", "draft"]),
  plugins: Type.Array(closed({ id: Name, versionId: Id, draftId: Type.Optional(Id) })),
  until: literalUnion(["turn", "release"]),
  toolsetChanged: Type.Boolean(),
});
export const OverlayMarkSchema: TUnsafe<OverlayMark> = Type.Unsafe<OverlayMark>(
  OverlayMarkShape satisfies SchemaProof<OverlayMark, typeof OverlayMarkShape>,
);

/** Drive 프레임 한 칸(§3.2). 한도 소비량이 예산 도달을 설명한다(엔진 설계 §2.3) */
export interface FrameMark {
  /** 프레임 깊이. 0은 기본 턴 흐름 */
  readonly depth: number;
  /** 0이면 null */
  readonly plugin: string | null;
  /** lease.acquired.contentHash */
  readonly versionId: string | null;
  readonly leaseId: string | null;
  readonly parentLeaseId: string | null;
  /** 턴 시작 기준 ms. 턴 전에 들어왔으면 0 */
  readonly enteredAtMs: number;
  readonly exitedAtMs: number | null;
  /** 저장된 lease.released.reason 값 그대로 */
  readonly exitReason:
    | "done"
    | "budget"
    | "error"
    | "idle"
    | "revoked"
    | "restart"
    | "waiting"
    | "disabled"
    | null;
  /** 아래 프레임이 이 프레임의 끝으로 받은 last 값. handoff_aborted는 종료 사유가 아니다 */
  readonly lowerResumedWith: "handoff_done" | "handoff_aborted" | "user" | null;
  readonly limits: {
    readonly maxTurns?: number;
    readonly maxSpawns?: number;
    readonly maxTokens?: number;
  };
  readonly used: { readonly turns: number; readonly spawns: number; readonly tokens: number };
  /** 이 프레임이 주도 중에 받은 사용자 메시지 수 */
  readonly userMessages: number;
}
const FrameMarkShape = closed({
  depth: Count,
  plugin: Nullable(Name),
  versionId: Nullable(Id),
  leaseId: Nullable(Id),
  parentLeaseId: Nullable(Id),
  enteredAtMs: Ms,
  exitedAtMs: Nullable(Ms),
  exitReason: Nullable(
    literalUnion(["done", "budget", "error", "idle", "revoked", "restart", "waiting", "disabled"]),
  ),
  lowerResumedWith: Nullable(literalUnion(["handoff_done", "handoff_aborted", "user"])),
  limits: closed({
    maxTurns: Type.Optional(Count),
    maxSpawns: Type.Optional(Count),
    maxTokens: Type.Optional(Count),
  }),
  used: closed({ turns: Count, spawns: Count, tokens: Count }),
  userMessages: Count,
});
export const FrameMarkSchema: TUnsafe<FrameMark> = Type.Unsafe<FrameMark>(
  FrameMarkShape satisfies SchemaProof<FrameMark, typeof FrameMarkShape>,
);

/** 이 턴에서 시작한 자식 대화 한 줄(규칙 24). 부모 턴 기록이 자식 대화를 찾는 길이다 */
export interface TurnChild {
  readonly childThreadId: string;
  readonly agent: string;
  readonly status: "running" | "completed" | "failed" | "interrupted";
  readonly used: { readonly turns: number; readonly tokens: number } | null;
}
const TurnChildShape = closed({
  childThreadId: ThreadRef,
  agent: Name,
  status: literalUnion(["running", "completed", "failed", "interrupted"]),
  used: Nullable(closed({ turns: Count, tokens: Count })),
});
export const TurnChildSchema: TUnsafe<TurnChild> = Type.Unsafe<TurnChild>(
  TurnChildShape satisfies SchemaProof<TurnChild, typeof TurnChildShape>,
);

/** 비용 숫자의 근거. 측정(`measured`), 정적으로 센 값(`estimated`), 매니페스트 선언(`declared`), 알 수 없음(`unknown`) */
export type CostBasis = "measured" | "estimated" | "declared" | "unknown";
export const CostBasisSchema: TUnion<TLiteral<CostBasis>[]> = literalUnion([
  "measured",
  "estimated",
  "declared",
  "unknown",
]);

/** 정적으로 센 값과 측정을 합칠 때 쓰는 비용 칸(§3.3). M5c의 카드와 `profile.preview.cost`도 이 모양을 쓴다 */
export interface CostFigures {
  readonly always: number | null;
  readonly drive: number | null;
  readonly onDemand: number | null;
  readonly toolCount: number | null;
  readonly basis: CostBasis;
}
const CostFiguresShape = closed({
  always: Nullable(Count),
  drive: Nullable(Count),
  onDemand: Nullable(Count),
  toolCount: Nullable(Count),
  basis: CostBasisSchema,
});
export const CostFiguresSchema: TUnsafe<CostFigures> = Type.Unsafe<CostFigures>(
  CostFiguresShape satisfies SchemaProof<CostFigures, typeof CostFiguresShape>,
);

/** 턴 기록의 플러그인별 비용(§3.3). 파생값이라 basis는 항상 measured이고 칸은 수다 */
export interface PluginCost {
  readonly plugin: string;
  readonly always: number;
  readonly drive: number;
  readonly onDemand: number;
  readonly shared: boolean;
}
const PluginCostShape = closed({
  plugin: Name,
  always: Count,
  drive: Count,
  onDemand: Count,
  shared: Type.Boolean(),
});
export const PluginCostSchema: TUnsafe<PluginCost> = Type.Unsafe<PluginCost>(
  PluginCostShape satisfies SchemaProof<PluginCost, typeof PluginCostShape>,
);

/** `profileCost.get`의 플러그인 한 줄. 측정과 정적 추정을 합쳐 같은 필드명으로 낸다(§3.3). 정적 추정의 `drive`는 null이라 `PluginCost`를 쓰지 않는다 */
export interface ProfileCostRow extends CostFigures {
  readonly plugin: string;
  readonly shared: boolean;
}
const ProfileCostRowShape = closed({
  plugin: Name,
  shared: Type.Boolean(),
  ...CostFiguresShape.properties,
});
export const ProfileCostRowSchema: TUnsafe<ProfileCostRow> = Type.Unsafe<ProfileCostRow>(
  ProfileCostRowShape satisfies SchemaProof<ProfileCostRow, typeof ProfileCostRowShape>,
);

/** 가벼운 길(읽기 전용)의 플러그인 호출 한 줄. 파이프라인 길의 호출은 `CallRecord`로 간다(F §5.3 U-2) */
export interface PluginCallLine {
  readonly plugin: string;
  readonly capability: string;
  readonly method: string;
  readonly requestKey: string;
  readonly ok: boolean;
  readonly ms: number;
  readonly via: string;
  readonly toolCallId: string | null;
}
const PluginCallLineShape = closed({
  plugin: Name,
  capability: Name,
  method: Name,
  requestKey: Id,
  ok: Type.Boolean(),
  ms: Ms,
  via: Type.String({ minLength: 1, maxLength: 64 }),
  toolCallId: Nullable(Id),
});
export const PluginCallLineSchema: TUnsafe<PluginCallLine> = Type.Unsafe<PluginCallLine>(
  PluginCallLineShape satisfies SchemaProof<PluginCallLine, typeof PluginCallLineShape>,
);

/** 턴의 결과 수 표지(§3.2). 칸은 정본 이름 그대로다 */
export interface TurnFlags {
  readonly blockedIntent: number;
  readonly blockedFault: number;
  readonly deniedPolicy: number;
  readonly deniedHuman: number;
  readonly deniedNoninteractive: number;
  readonly replaced: number;
  readonly cancelledAsk: number;
  readonly asked: number;
  readonly modified: number;
  readonly timedOut: number;
  readonly failed: number;
  readonly drive: boolean;
  readonly cacheBreak: boolean;
  readonly subagents: number;
  readonly truncatedMaterials: number;
  readonly draftActive: boolean;
  /** 쓰기 위험 등급 대체 도구가 코어 서비스 호출 없이 성공함(F §5.5 P-4) */
  readonly untrackedWrite: boolean;
}
const TurnFlagsShape = closed({
  blockedIntent: Count,
  blockedFault: Count,
  deniedPolicy: Count,
  deniedHuman: Count,
  deniedNoninteractive: Count,
  replaced: Count,
  cancelledAsk: Count,
  asked: Count,
  modified: Count,
  timedOut: Count,
  failed: Count,
  drive: Type.Boolean(),
  cacheBreak: Type.Boolean(),
  subagents: Count,
  truncatedMaterials: Count,
  draftActive: Type.Boolean(),
  untrackedWrite: Type.Boolean(),
});
export const TurnFlagsSchema: TUnsafe<TurnFlags> = Type.Unsafe<TurnFlags>(
  TurnFlagsShape satisfies SchemaProof<TurnFlags, typeof TurnFlagsShape>,
);

/** 상한 때문에 줄인 칸의 개수(§4.1 규칙 8) */
export interface TurnElided {
  readonly hooks?: number;
  readonly calls?: number;
  readonly materials?: number;
  readonly tools?: number;
  readonly skills?: number;
}
const TurnElidedShape = closed({
  hooks: Type.Optional(Count),
  calls: Type.Optional(Count),
  materials: Type.Optional(Count),
  tools: Type.Optional(Count),
  skills: Type.Optional(Count),
});
export const TurnElidedSchema: TUnsafe<TurnElided> = Type.Unsafe<TurnElided>(
  TurnElidedShape satisfies SchemaProof<TurnElided, typeof TurnElidedShape>,
);

/** 턴 기록 한 건(§3.2). `record_json`에 전체가 들어가고 `tr_turn`의 열은 거르기용 사본이다 */
export interface TurnRecord {
  readonly schema: 1;
  readonly threadId: string;
  readonly turnId: string;
  /** 하위 에이전트 대화의 턴이면 부모 쪽 자리(agent.spawned) */
  readonly parent: {
    readonly threadId: string;
    readonly turnId: string | null;
    readonly toolCallId: string | null;
    readonly scopeId: string | null;
  } | null;
  /** turn.started.origin */
  readonly origin: "user" | "scheduled" | "remote" | "delegation" | "drive" | "other";
  readonly startedAt: number;
  readonly endedAt: number | null;
  /** open: 아직 진행 중. lost: 프로세스가 죽어 turn.completed가 없다 */
  readonly status: TurnStatus;
  readonly level: RecordLevel;
  /** 이 턴의 모든 단계 기록이 저장됐나 */
  readonly complete: boolean;
  readonly scope: ScopeKind;
  /** rev는 턴 시작 값. 프로필 개정이 단계 경계마다 바뀔 수 있어 바뀐 곳은 profileRevChanges에 적는다(M5c §4.1.6) */
  readonly profile: {
    readonly id: string;
    readonly rev: number;
    readonly source: "thread" | "builtin";
    readonly inherited: boolean;
  } | null;
  readonly profileRevChanges: { readonly stepIndex: number; readonly rev: number }[];
  readonly overlay: OverlayMark | null;
  /** 테스트 실행 대화의 구성(M5c §4.8.1). 초안 버전 id가 여기 있다. 대화 전체의 구성이라 `overlay`는 null이다 */
  readonly testRun: {
    readonly runGroupId: string | null;
    readonly baseProfileId: string;
    readonly drafts: {
      readonly plugin: string;
      readonly draftId: string;
      readonly versionId: string;
    }[];
  } | null;
  /** 이 턴에서 시작한 자식 대화의 목록(규칙 24) */
  readonly children: TurnChild[];
  /** Drive 프레임 스택: 턴 시작 때의 스택과 턴 안의 변화 */
  readonly frames: FrameMark[];
  readonly steps: StepRecord[];
  /** 단계 밖 훅. 묶음 이름은 F의 위치 종류(boundary, 컨텍스트 조립 앞의 첫 훅) */
  readonly turnHooks: HookRun[];
  readonly continues: {
    readonly atMs: number;
    readonly plugin: string;
    readonly decided: "continue" | "stop";
    readonly reason: string | null;
  }[];
  readonly skills: {
    readonly listed: string[];
    readonly listedOmitted: number;
    readonly read: {
      readonly name: string;
      readonly plugin: string;
      readonly via: "model" | "user";
      readonly stepIndex: number;
      readonly tokens: number;
    }[];
  };
  /** 파생값(§3.3) */
  readonly cost: PluginCost[];
  /** 가벼운 길(읽기 전용)의 플러그인 호출 한 줄씩 */
  readonly pluginCalls: PluginCallLine[];
  /** 플러그인 프로세스의 표준오류 꼬리. 길이 상한, 시크릿 마스킹(엔진 설계 §3.2) */
  readonly pluginStderr: {
    readonly plugin: string;
    readonly versionId: string | null;
    readonly bytes: number;
    readonly tail: string;
  }[];
  readonly flags: TurnFlags;
  readonly elided: TurnElided;
}
const TurnRecordShape = closed({
  schema: Type.Literal(1),
  threadId: ThreadRef,
  turnId: ThreadRef,
  parent: Nullable(
    closed({
      threadId: ThreadRef,
      turnId: Nullable(ThreadRef),
      toolCallId: Nullable(Id),
      scopeId: Nullable(Id),
    }),
  ),
  origin: literalUnion(["user", "scheduled", "remote", "delegation", "drive", "other"]),
  startedAt: Type.Number(),
  endedAt: Nullable(Type.Number()),
  status: TurnStatusSchema,
  level: RecordLevelSchema,
  complete: Type.Boolean(),
  scope: ScopeKindSchema,
  profile: Nullable(
    closed({
      id: Id,
      rev: Count,
      source: literalUnion(["thread", "builtin"]),
      inherited: Type.Boolean(),
    }),
  ),
  profileRevChanges: Type.Array(closed({ stepIndex: Count, rev: Count })),
  overlay: Nullable(OverlayMarkSchema),
  testRun: Nullable(
    closed({
      runGroupId: Nullable(Id),
      baseProfileId: Id,
      drafts: Type.Array(closed({ plugin: Name, draftId: Id, versionId: Id })),
    }),
  ),
  children: Type.Array(TurnChildSchema),
  frames: Type.Array(FrameMarkSchema),
  steps: Type.Array(StepRecordSchema),
  turnHooks: Type.Array(HookRunSchema),
  continues: Type.Array(
    closed({
      atMs: Ms,
      plugin: Name,
      decided: literalUnion(["continue", "stop"]),
      reason: Nullable(Type.String({ maxLength: 512 })),
    }),
  ),
  skills: closed({
    listed: Type.Array(Name),
    listedOmitted: Count,
    read: Type.Array(
      closed({
        name: Name,
        plugin: Name,
        via: literalUnion(["model", "user"]),
        stepIndex: Count,
        tokens: Count,
      }),
    ),
  }),
  cost: Type.Array(PluginCostSchema),
  pluginCalls: Type.Array(PluginCallLineSchema),
  pluginStderr: Type.Array(
    closed({
      plugin: Name,
      versionId: Nullable(Id),
      bytes: Count,
      tail: Type.String({ maxLength: 4096 }),
    }),
  ),
  flags: TurnFlagsSchema,
  elided: TurnElidedSchema,
});
export const TurnRecordSchema: TUnsafe<TurnRecord> = Type.Unsafe<TurnRecord>(
  TurnRecordShape satisfies SchemaProof<TurnRecord, typeof TurnRecordShape>,
);

/** 턴 목록의 한 줄(§3.8). 목록과 그 자리 관찰이 쓴다 */
export interface TurnSummary {
  readonly threadId: string;
  readonly turnId: string;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly status: TurnStatus;
  readonly scope: ScopeKind;
  readonly complete: boolean;
  readonly profileId: string | null;
  readonly stepCount: number;
  readonly callCount: number;
  readonly flags: TurnFlags;
  readonly frameDepthMax: number;
  readonly childCount: number;
}
const TurnSummaryShape = closed({
  threadId: ThreadRef,
  turnId: ThreadRef,
  startedAt: Type.Number(),
  endedAt: Nullable(Type.Number()),
  status: TurnStatusSchema,
  scope: ScopeKindSchema,
  complete: Type.Boolean(),
  profileId: Nullable(Id),
  stepCount: Count,
  callCount: Count,
  flags: TurnFlagsSchema,
  frameDepthMax: Count,
  childCount: Count,
});
export const TurnSummarySchema: TUnsafe<TurnSummary> = Type.Unsafe<TurnSummary>(
  TurnSummaryShape satisfies SchemaProof<TurnSummary, typeof TurnSummaryShape>,
);

/** `turnRecord.delta` 알림의 행(§3.8). 한 알림에 100행까지다 */
export type DeltaRow =
  | { readonly kind: "step"; readonly stepIndex: number; readonly step: StepRecord }
  | { readonly kind: "hook"; readonly stepIndex: number | null; readonly hook: HookRun }
  | { readonly kind: "call"; readonly stepIndex: number; readonly call: CallRecord }
  | { readonly kind: "frame"; readonly frame: FrameMark }
  | { readonly kind: "child"; readonly child: TurnChild }
  | { readonly kind: "turn"; readonly status: TurnStatus; readonly complete: boolean };
const DeltaRowShape = Type.Union([
  closed({ kind: Type.Literal("step"), stepIndex: Count, step: StepRecordSchema }),
  closed({ kind: Type.Literal("hook"), stepIndex: Nullable(Count), hook: HookRunSchema }),
  closed({ kind: Type.Literal("call"), stepIndex: Count, call: CallRecordSchema }),
  closed({ kind: Type.Literal("frame"), frame: FrameMarkSchema }),
  closed({ kind: Type.Literal("child"), child: TurnChildSchema }),
  closed({ kind: Type.Literal("turn"), status: TurnStatusSchema, complete: Type.Boolean() }),
]);
export const DeltaRowSchema: TUnsafe<DeltaRow> = Type.Unsafe<DeltaRow>(
  DeltaRowShape satisfies SchemaSound<DeltaRow, typeof DeltaRowShape>,
);

// ── 지표(§3.5, §5) ─────────────────────────────────────────────────────

/** 집계 기간(`MetricFilter.period`). 기본은 `{ days: 30 }` */
export type MetricPeriod =
  | { readonly days: number }
  | { readonly from: number; readonly to: number };
const MetricPeriodShape = Type.Union([
  closed({ days: Type.Integer({ minimum: 1 }) }),
  closed({ from: Type.Number(), to: Type.Number() }),
]);
export const MetricPeriodSchema: TUnsafe<MetricPeriod> = Type.Unsafe<MetricPeriod>(
  MetricPeriodShape satisfies SchemaSound<MetricPeriod, typeof MetricPeriodShape>,
);

/** 지표 질의의 필터(§3.5). 기본 범위는 `["live", "overlay_reviewed"]`다 */
export interface MetricFilter {
  readonly profileId?: string;
  readonly plugin?: string;
  readonly modelVersion?: string;
  readonly period: MetricPeriod;
  readonly scopes?: ScopeKind[];
  /** 기본 "any" */
  readonly caller?: "main" | "subagent" | "any";
}
const MetricFilterShape = closed({
  profileId: Type.Optional(Id),
  plugin: Type.Optional(Name),
  modelVersion: Type.Optional(Id),
  period: MetricPeriodSchema,
  scopes: Type.Optional(Type.Array(ScopeKindSchema, { maxItems: SCOPE_KINDS.length })),
  caller: Type.Optional(literalUnion(["main", "subagent", "any"])),
});
export const MetricFilterSchema: TUnsafe<MetricFilter> = Type.Unsafe<MetricFilter>(
  MetricFilterShape satisfies SchemaProof<MetricFilter, typeof MetricFilterShape>,
);

/** 지표 값 하나(§3.5). 모든 값은 이 모양으로 돌려준다 */
export interface MetricValue {
  readonly value: number | null;
  readonly n: number;
  readonly denom?: number;
  readonly state: MetricState;
  readonly reason?: MetricReason;
}
const MetricValueShape = closed({
  value: Nullable(Type.Number()),
  n: Count,
  denom: Type.Optional(Type.Number({ minimum: 0 })),
  state: MetricStateSchema,
  reason: Type.Optional(MetricReasonSchema),
});
export const MetricValueSchema: TUnsafe<MetricValue> = Type.Unsafe<MetricValue>(
  MetricValueShape satisfies SchemaProof<MetricValue, typeof MetricValueShape>,
);

/** 가능 열(§5). `exact` 예, `approx` 근사, `partial` 부분, `no` 아니오. 저장 문자열이 아니라 카탈로그 값이다 */
export const FEASIBLE_KINDS = ["exact", "approx", "partial", "no"] as const;
export type Feasible = (typeof FEASIBLE_KINDS)[number];
export const FeasibleSchema: TUnion<TLiteral<Feasible>[]> = literalUnion(FEASIBLE_KINDS);

/** 지표 정의 한 줄(`metrics.catalog`, §5의 행). `feasible`은 §5의 "기록만으로 가능한가" 열이다 */
export interface MetricDef {
  readonly id: string;
  readonly label: { readonly ko: string; readonly en: string };
  readonly unit: string;
  readonly kind: "count" | "ratio" | "tokens" | "ms";
  readonly appliesTo: SubjectKind[];
  readonly feasible: Feasible;
  readonly definitionNote: string | null;
}
const MetricDefShape = closed({
  id: Name,
  label: closed({ ko: Type.String({ maxLength: 128 }), en: Type.String({ maxLength: 128 }) }),
  unit: Type.String({ maxLength: 32 }),
  kind: literalUnion(["count", "ratio", "tokens", "ms"]),
  appliesTo: Type.Array(SubjectKindSchema),
  feasible: FeasibleSchema,
  definitionNote: Nullable(Type.String({ maxLength: 512 })),
});
export const MetricDefSchema: TUnsafe<MetricDef> = Type.Unsafe<MetricDef>(
  MetricDefShape satisfies SchemaProof<MetricDef, typeof MetricDefShape>,
);

/** 지표 질의의 주의 한 줄(`notes`) */
export interface MetricNote {
  readonly metric: string;
  readonly code: MetricNoteCode;
  readonly text: string | null;
}
const MetricNoteShape = closed({
  metric: Name,
  code: MetricNoteCodeSchema,
  text: Nullable(Type.String({ maxLength: 512 })),
});
export const MetricNoteSchema: TUnsafe<MetricNote> = Type.Unsafe<MetricNote>(
  MetricNoteShape satisfies SchemaProof<MetricNote, typeof MetricNoteShape>,
);

/** 비교 표의 한 줄(§3.8). 표본 하나의 비교면 `observation`이 참이다 */
export interface CompareRow {
  readonly row: string;
  readonly values: Record<
    string,
    { readonly value: number | string | null; readonly state: MetricState }
  >;
  readonly observation: boolean;
}
const CompareRowShape = closed({
  row: Name,
  values: Type.Record(
    Type.String(),
    closed({
      value: Nullable(Type.Union([Type.Number(), Type.String({ maxLength: 512 })])),
      state: MetricStateSchema,
    }),
  ),
  observation: Type.Boolean(),
});
export const CompareRowSchema: TUnsafe<CompareRow> = Type.Unsafe<CompareRow>(
  CompareRowShape satisfies SchemaProof<CompareRow, typeof CompareRowShape>,
);

/** 근거 참조의 정본(§3.5). M5c의 검토 증거가 이것을 가져다 쓴다. 지난 턴에 돌려 본 결과는 backtest 변형이다 */
export type EvidenceRef =
  | {
      readonly kind: "turn" | "call" | "hook" | "material" | "skill";
      readonly threadId: string;
      readonly turnId: string;
      readonly stepIndex?: number;
      readonly toolCallId?: string;
      readonly hookSeq?: number;
    }
  | { readonly kind: "backtest"; readonly backtestRunId: string; readonly toolCallId?: string };
const EvidenceRefShape = Type.Union([
  closed({
    kind: literalUnion(["turn", "call", "hook", "material", "skill"]),
    threadId: ThreadRef,
    turnId: ThreadRef,
    stepIndex: Type.Optional(Count),
    toolCallId: Type.Optional(Id),
    hookSeq: Type.Optional(Count),
  }),
  closed({ kind: Type.Literal("backtest"), backtestRunId: Id, toolCallId: Type.Optional(Id) }),
]);
export const EvidenceRefSchema: TUnsafe<EvidenceRef> = Type.Unsafe<EvidenceRef>(
  EvidenceRefShape satisfies SchemaSound<EvidenceRef, typeof EvidenceRefShape>,
);

/** 살펴볼 것 한 건(§3.5). 대표 증거 50개와 총수를 싣는다 */
export interface Finding {
  readonly id: string;
  readonly ruleId: string;
  readonly ruleVersion: number;
  readonly subject: {
    readonly kind: SubjectKind;
    readonly plugin: string;
    /** kind가 block이면 F의 BlockId(context, model, tools, ask, agents, record) */
    readonly ref: string | null;
  };
  readonly impact: { readonly unit: "tokens_per_turn" | "hits" | "turns"; readonly value: number };
  readonly metrics: Record<string, MetricValue>;
  readonly evidence: EvidenceRef[];
  readonly evidenceTotal: number;
  readonly next: {
    readonly kind: "fix" | "promote" | "remove";
    readonly target: "craft_chat" | "profile";
    readonly label: string;
  }[];
  readonly state: FindingState;
}
const FindingShape = closed({
  id: Id,
  ruleId: Name,
  ruleVersion: Count,
  subject: closed({ kind: SubjectKindSchema, plugin: Name, ref: Nullable(Id) }),
  impact: closed({
    unit: literalUnion(["tokens_per_turn", "hits", "turns"]),
    value: Type.Number(),
  }),
  metrics: Type.Record(Type.String(), MetricValueSchema),
  evidence: Type.Array(EvidenceRefSchema, { maxItems: 50 }),
  evidenceTotal: Count,
  next: Type.Array(
    closed({
      kind: literalUnion(["fix", "promote", "remove"]),
      target: literalUnion(["craft_chat", "profile"]),
      label: Type.String({ minLength: 1, maxLength: 128 }),
    }),
  ),
  state: FindingStateSchema,
});
export const FindingSchema: TUnsafe<Finding> = Type.Unsafe<Finding>(
  FindingShape satisfies SchemaProof<Finding, typeof FindingShape>,
);

/** 사람에게 넘기는 발견 묶음(§4.7 규칙 43). 16 KiB 이하이고 id, 해시, 숫자만 담는다 */
export interface FindingBundle {
  readonly findingId: string;
  readonly ruleId: string;
  readonly subject: Finding["subject"];
  readonly impact: Finding["impact"];
  readonly metrics: Record<string, MetricValue>;
  readonly evidence: EvidenceRef[];
  readonly evidenceTotal: number;
}
const FindingBundleShape = closed({
  findingId: Id,
  ruleId: Name,
  subject: FindingShape.properties.subject,
  impact: FindingShape.properties.impact,
  metrics: FindingShape.properties.metrics,
  evidence: FindingShape.properties.evidence,
  evidenceTotal: Count,
});
export const FindingBundleSchema: TUnsafe<FindingBundle> = Type.Unsafe<FindingBundle>(
  FindingBundleShape satisfies SchemaProof<FindingBundle, typeof FindingBundleShape>,
);

// ── 지난 턴에 돌려 보기(§3.7, 타입만) ────────────────────────────────

/** 지난 턴에 돌려 본 호출 한 건 */
export interface BacktestItem {
  readonly toolCallId: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly tool: string;
  readonly live: {
    readonly verdict: Verdict;
    readonly humanDecision: "allow" | "deny" | null;
    readonly blockedBy: string | null;
    readonly laterSignals: ("approval_denied" | "turn_rewound")[];
  };
  /** 후보의 결과도 F §4.5와 같은 변환을 쓴다. replace는 막음·물음처럼 newly_caught로 센다 */
  readonly candidate: {
    readonly result:
      | "pass"
      | "block"
      | "modify"
      | "ask"
      | "replace"
      | "failed"
      | "timeout"
      | "skipped";
    readonly reason: string | null;
    readonly ms: number;
  };
  readonly class: BacktestClass;
  readonly unreplayableReason?:
    | "tool_unknown"
    | "args_missing"
    | "blob_expired"
    | "thread_deleted"
    | "result_not_stored";
}
const BacktestItemShape = closed({
  toolCallId: Id,
  threadId: ThreadRef,
  turnId: ThreadRef,
  tool: Name,
  live: closed({
    verdict: VerdictSchema,
    humanDecision: Nullable(literalUnion(["allow", "deny"])),
    blockedBy: Nullable(Name),
    laterSignals: Type.Array(literalUnion(["approval_denied", "turn_rewound"])),
  }),
  candidate: closed({
    result: literalUnion([
      "pass",
      "block",
      "modify",
      "ask",
      "replace",
      "failed",
      "timeout",
      "skipped",
    ]),
    reason: Nullable(Type.String({ maxLength: 512 })),
    ms: Ms,
  }),
  class: BacktestClassSchema,
  unreplayableReason: Type.Optional(
    literalUnion([
      "tool_unknown",
      "args_missing",
      "blob_expired",
      "thread_deleted",
      "result_not_stored",
    ]),
  ),
});
export const BacktestItemSchema: TUnsafe<BacktestItem> = Type.Unsafe<BacktestItem>(
  BacktestItemShape satisfies SchemaProof<BacktestItem, typeof BacktestItemShape>,
);

/** 지난 턴에 돌려 본 결과의 요약(§3.7). `similarNotCaught`는 최대 20개다 */
export interface BacktestSummary {
  readonly turns: number;
  readonly calls: number;
  readonly replayed: number;
  readonly counts: Record<BacktestClass, number>;
  readonly similarNotCaught: {
    readonly toolCallId: string;
    readonly similarTo: string;
    readonly why: "same_tool_same_target" | "arg_overlap";
    readonly score: number | null;
  }[];
  readonly candidateFaults: { readonly threw: number; readonly timeout: number };
}
const BacktestSummaryShape = closed({
  turns: Count,
  calls: Count,
  replayed: Count,
  counts: closed({
    newly_caught: Count,
    already_stopped: Count,
    agrees_block: Count,
    would_block_allowed_by_human: Count,
    passes_same: Count,
    candidate_fault: Count,
    unreplayable: Count,
  }),
  similarNotCaught: Type.Array(
    closed({
      toolCallId: Id,
      similarTo: Id,
      why: literalUnion(["same_tool_same_target", "arg_overlap"]),
      score: Nullable(Type.Number()),
    }),
    { maxItems: 20 },
  ),
  candidateFaults: closed({ threw: Count, timeout: Count }),
});
export const BacktestSummarySchema: TUnsafe<BacktestSummary> = Type.Unsafe<BacktestSummary>(
  BacktestSummaryShape satisfies SchemaProof<BacktestSummary, typeof BacktestSummaryShape>,
);

// ── 메서드 params·result (§3.5, §3.8) ─────────────────────────────────
// 아래 스키마는 레지스트리에 없다. 처리기가 생기면 methods.ts 표에 더하고 wire 시험이 문서와 대조한다.
// `result`가 `{}`인 메서드는 EmptyParamsSchema(notifications.ts)를 쓴다.

/** `turnRecord.list` params. `limit`은 기본 50, 최대 200 */
export interface TurnRecordListParams {
  readonly threadId: string;
  readonly cursor?: string;
  readonly limit?: number;
  readonly scope?: ScopeKind[];
  readonly flags?: TurnFlagKey[];
}
const TurnRecordListParamsShape = request({
  threadId: ThreadRef,
  cursor: Type.Optional(Cursor),
  limit: Type.Optional(Limit),
  scope: Type.Optional(Type.Array(ScopeKindSchema, { maxItems: SCOPE_KINDS.length })),
  flags: Type.Optional(Type.Array(TurnFlagKeySchema, { maxItems: TURN_FLAG_KEYS.length })),
});
export const TurnRecordListParamsSchema: TUnsafe<Req<TurnRecordListParams>> = Type.Unsafe<
  Req<TurnRecordListParams>
>(
  TurnRecordListParamsShape satisfies SchemaProof<
    Req<TurnRecordListParams>,
    typeof TurnRecordListParamsShape
  >,
);
export interface TurnRecordListResult {
  readonly enabled: boolean;
  readonly level: RecordLevel;
  readonly items: TurnSummary[];
  readonly next: string | null;
}
const TurnRecordListResultShape = closed({
  enabled: Type.Boolean(),
  level: RecordLevelSchema,
  items: Type.Array(TurnSummarySchema, { maxItems: 200 }),
  next: Nullable(Cursor),
});
export const TurnRecordListResultSchema: TUnsafe<TurnRecordListResult> =
  Type.Unsafe<TurnRecordListResult>(
    TurnRecordListResultShape satisfies SchemaProof<
      TurnRecordListResult,
      typeof TurnRecordListResultShape
    >,
  );

/** `turnRecord.get` params. `detail`을 생략하면 전체다 */
export interface TurnRecordGetParams {
  readonly threadId: string;
  readonly turnId: string;
  readonly detail?: "summary" | "full";
}
const TurnRecordGetParamsShape = request({
  threadId: ThreadRef,
  turnId: ThreadRef,
  detail: Type.Optional(literalUnion(["summary", "full"])),
});
export const TurnRecordGetParamsSchema: TUnsafe<Req<TurnRecordGetParams>> = Type.Unsafe<
  Req<TurnRecordGetParams>
>(
  TurnRecordGetParamsShape satisfies SchemaProof<
    Req<TurnRecordGetParams>,
    typeof TurnRecordGetParamsShape
  >,
);
/** `absent`는 기록이 없는 이유다. 기록이 꺼졌거나 지워진 턴은 오류가 아니다 */
export interface TurnRecordGetResult {
  readonly enabled: boolean;
  readonly level: RecordLevel;
  readonly record: TurnRecord | null;
  readonly absent: "never_recorded" | "purged" | "off" | null;
}
const TurnRecordGetResultShape = closed({
  enabled: Type.Boolean(),
  level: RecordLevelSchema,
  record: Nullable(TurnRecordSchema),
  absent: Nullable(literalUnion(["never_recorded", "purged", "off"])),
});
export const TurnRecordGetResultSchema: TUnsafe<TurnRecordGetResult> =
  Type.Unsafe<TurnRecordGetResult>(
    TurnRecordGetResultShape satisfies SchemaProof<
      TurnRecordGetResult,
      typeof TurnRecordGetResultShape
    >,
  );

/** `turnRecord.watch` params */
export interface TurnRecordWatchParams {
  readonly threadId: string;
}
const TurnRecordWatchParamsShape = request({ threadId: ThreadRef });
export const TurnRecordWatchParamsSchema: TUnsafe<Req<TurnRecordWatchParams>> = Type.Unsafe<
  Req<TurnRecordWatchParams>
>(
  TurnRecordWatchParamsShape satisfies SchemaProof<
    Req<TurnRecordWatchParams>,
    typeof TurnRecordWatchParamsShape
  >,
);
export interface TurnRecordWatchResult {
  readonly sub: SubId;
  readonly level: RecordLevel;
}
const TurnRecordWatchResultShape = closed({ sub: SubIdSchema, level: RecordLevelSchema });
export const TurnRecordWatchResultSchema: TUnsafe<TurnRecordWatchResult> =
  Type.Unsafe<TurnRecordWatchResult>(
    TurnRecordWatchResultShape satisfies SchemaProof<
      TurnRecordWatchResult,
      typeof TurnRecordWatchResultShape
    >,
  );

/** `turnRecord.unwatch` params. 결과는 `{}` */
export interface TurnRecordUnwatchParams {
  readonly sub: SubId;
}
const TurnRecordUnwatchParamsShape = request({ sub: SubIdSchema });
export const TurnRecordUnwatchParamsSchema: TUnsafe<Req<TurnRecordUnwatchParams>> = Type.Unsafe<
  Req<TurnRecordUnwatchParams>
>(
  TurnRecordUnwatchParamsShape satisfies SchemaProof<
    Req<TurnRecordUnwatchParams>,
    typeof TurnRecordUnwatchParamsShape
  >,
);

/** 알림 `turnRecord.delta`. 100 ms 안의 행은 묶고 한 알림에 100행까지다 [제안] */
export interface TurnRecordDeltaParams {
  readonly sub: SubId;
  readonly threadId: string;
  readonly turnId: string;
  readonly stepIndex: number | null;
  readonly rows: DeltaRow[];
  readonly final: boolean;
}
const TurnRecordDeltaParamsShape = closed({
  sub: SubIdSchema,
  threadId: ThreadRef,
  turnId: ThreadRef,
  stepIndex: Nullable(Count),
  rows: Type.Array(DeltaRowSchema, { maxItems: 100 }),
  final: Type.Boolean(),
});
export const TurnRecordDeltaParamsSchema: TUnsafe<TurnRecordDeltaParams> =
  Type.Unsafe<TurnRecordDeltaParams>(
    TurnRecordDeltaParamsShape satisfies SchemaProof<
      TurnRecordDeltaParams,
      typeof TurnRecordDeltaParamsShape
    >,
  );

/** `turnRecord.search` 결과의 한 줄(§3.8). `hookSeq`는 훅 행이 없으면 null이다 */
export interface TurnSearchItem {
  readonly threadId: string;
  readonly turnId: string;
  readonly hookSeq: number | null;
  readonly plugin: string;
  readonly outcome: HookOutcome;
  readonly at: number;
}
const TurnSearchItemShape = closed({
  threadId: ThreadRef,
  turnId: ThreadRef,
  hookSeq: Nullable(Count),
  plugin: Name,
  outcome: HookOutcomeSchema,
  at: Type.Number(),
});
export const TurnSearchItemSchema: TUnsafe<TurnSearchItem> = Type.Unsafe<TurnSearchItem>(
  TurnSearchItemShape satisfies SchemaProof<TurnSearchItem, typeof TurnSearchItemShape>,
);

/** `turnRecord.search` params. 필터 검사는 `metrics.query`와 같다(3512) */
export interface TurnRecordSearchParams {
  readonly plugin: string;
  readonly hook?: string;
  readonly outcome?: HookOutcome;
  readonly period: MetricPeriod;
  readonly scopes?: ScopeKind[];
  readonly cursor?: string;
  /** 기본 50, 최대 200 */
  readonly limit?: number;
}
const TurnRecordSearchParamsShape = request({
  plugin: Name,
  hook: Type.Optional(Name),
  outcome: Type.Optional(HookOutcomeSchema),
  period: MetricPeriodSchema,
  scopes: Type.Optional(Type.Array(ScopeKindSchema, { maxItems: SCOPE_KINDS.length })),
  cursor: Type.Optional(Cursor),
  limit: Type.Optional(Limit),
});
export const TurnRecordSearchParamsSchema: TUnsafe<Req<TurnRecordSearchParams>> = Type.Unsafe<
  Req<TurnRecordSearchParams>
>(
  TurnRecordSearchParamsShape satisfies SchemaProof<
    Req<TurnRecordSearchParams>,
    typeof TurnRecordSearchParamsShape
  >,
);
export interface TurnRecordSearchResult {
  readonly items: TurnSearchItem[];
  readonly next: string | null;
}
const TurnRecordSearchResultShape = closed({
  items: Type.Array(TurnSearchItemSchema, { maxItems: 200 }),
  next: Nullable(Cursor),
});
export const TurnRecordSearchResultSchema: TUnsafe<TurnRecordSearchResult> =
  Type.Unsafe<TurnRecordSearchResult>(
    TurnRecordSearchResultShape satisfies SchemaProof<
      TurnRecordSearchResult,
      typeof TurnRecordSearchResultShape
    >,
  );

/** `turnRecord.mark` params. 사용자가 "지침을 따랐나"를 누른 표시다(§3.8). 결과는 `{}` */
export interface TurnRecordMarkParams {
  readonly threadId: string;
  readonly turnId: string;
  readonly plugin: string;
  readonly mark: "followed" | "not_followed";
}
const TurnRecordMarkParamsShape = request({
  threadId: ThreadRef,
  turnId: ThreadRef,
  plugin: Name,
  mark: literalUnion(["followed", "not_followed"]),
});
export const TurnRecordMarkParamsSchema: TUnsafe<Req<TurnRecordMarkParams>> = Type.Unsafe<
  Req<TurnRecordMarkParams>
>(
  TurnRecordMarkParamsShape satisfies SchemaProof<
    Req<TurnRecordMarkParams>,
    typeof TurnRecordMarkParamsShape
  >,
);

/** `metrics.catalog` 결과 */
export interface MetricsCatalogResult {
  readonly metrics: MetricDef[];
}
const MetricsCatalogResultShape = closed({
  metrics: Type.Array(MetricDefSchema, { maxItems: 256 }),
});
export const MetricsCatalogResultSchema: TUnsafe<MetricsCatalogResult> =
  Type.Unsafe<MetricsCatalogResult>(
    MetricsCatalogResultShape satisfies SchemaProof<
      MetricsCatalogResult,
      typeof MetricsCatalogResultShape
    >,
  );

/** `metrics.query`의 집계 창. 계산에 쓴 실제 기간이다(정의가 문서에 없어 [제안]) */
export interface MetricWindow {
  readonly from: number;
  readonly to: number;
}
const MetricWindowShape = closed({ from: Type.Number(), to: Type.Number() });
export const MetricWindowSchema: TUnsafe<MetricWindow> = Type.Unsafe<MetricWindow>(
  MetricWindowShape satisfies SchemaProof<MetricWindow, typeof MetricWindowShape>,
);

/** `metrics.query` 결과의 한 행. `key`에는 `groupBy`로 고른 차원만 있다 [제안: 문서는 Record<Dim,string>] */
export interface MetricRow {
  readonly key: Partial<Record<Dim, string>>;
  readonly values: Record<string, MetricValue>;
}
const MetricRowShape = closed({
  key: closed({
    plugin: Type.Optional(Type.String({ maxLength: 256 })),
    ref: Type.Optional(Type.String({ maxLength: 256 })),
    hook: Type.Optional(Type.String({ maxLength: 256 })),
    model: Type.Optional(Type.String({ maxLength: 256 })),
    profile: Type.Optional(Type.String({ maxLength: 256 })),
    pluginVersion: Type.Optional(Type.String({ maxLength: 256 })),
    scope: Type.Optional(Type.String({ maxLength: 256 })),
    caller: Type.Optional(Type.String({ maxLength: 256 })),
    day: Type.Optional(Type.String({ maxLength: 256 })),
  }),
  values: Type.Record(Type.String(), MetricValueSchema),
});
export const MetricRowSchema: TUnsafe<MetricRow> = Type.Unsafe<MetricRow>(
  MetricRowShape satisfies SchemaProof<MetricRow, typeof MetricRowShape>,
);

/** `metrics.query` params */
export interface MetricsQueryParams {
  readonly metrics: string[];
  readonly filter: MetricFilter;
  readonly groupBy?: Dim[];
  readonly compare?: {
    readonly by: "pluginVersion" | "model" | "profileRev";
    readonly a: string;
    readonly b: string;
  };
}
const MetricsQueryParamsShape = request({
  metrics: Type.Array(Name, { maxItems: 16 }),
  filter: MetricFilterSchema,
  groupBy: Type.Optional(Type.Array(DimSchema, { maxItems: DIMS.length })),
  compare: Type.Optional(
    closed({
      by: literalUnion(["pluginVersion", "model", "profileRev"]),
      a: Id,
      b: Id,
    }),
  ),
});
export const MetricsQueryParamsSchema: TUnsafe<Req<MetricsQueryParams>> = Type.Unsafe<
  Req<MetricsQueryParams>
>(
  MetricsQueryParamsShape satisfies SchemaProof<
    Req<MetricsQueryParams>,
    typeof MetricsQueryParamsShape
  >,
);
export interface MetricsQueryResult {
  readonly window: MetricWindow;
  readonly rows: MetricRow[];
  readonly notes: MetricNote[];
}
const MetricsQueryResultShape = closed({
  window: MetricWindowSchema,
  rows: Type.Array(MetricRowSchema, { maxItems: 1000 }),
  notes: Type.Array(MetricNoteSchema, { maxItems: 256 }),
});
export const MetricsQueryResultSchema: TUnsafe<MetricsQueryResult> =
  Type.Unsafe<MetricsQueryResult>(
    MetricsQueryResultShape satisfies SchemaProof<
      MetricsQueryResult,
      typeof MetricsQueryResultShape
    >,
  );

/** `findings.list` params. `period`을 생략하면 기본 창이다 */
export interface FindingsListParams {
  readonly profileId?: string;
  readonly period?: MetricPeriod;
  readonly state?: FindingState;
}
const FindingsListParamsShape = request({
  profileId: Type.Optional(Id),
  period: Type.Optional(MetricPeriodSchema),
  state: Type.Optional(FindingStateSchema),
});
export const FindingsListParamsSchema: TUnsafe<Req<FindingsListParams>> = Type.Unsafe<
  Req<FindingsListParams>
>(
  FindingsListParamsShape satisfies SchemaProof<
    Req<FindingsListParams>,
    typeof FindingsListParamsShape
  >,
);
export interface FindingsListResult {
  readonly asOf: number;
  /** tr_turn의 가장 큰 rowid. 캐시 키다(§4.7 규칙 41) */
  readonly dataRevision: number;
  readonly findings: Finding[];
}
const FindingsListResultShape = closed({
  asOf: Type.Number(),
  dataRevision: Count,
  findings: Type.Array(FindingSchema, { maxItems: 256 }),
});
export const FindingsListResultSchema: TUnsafe<FindingsListResult> =
  Type.Unsafe<FindingsListResult>(
    FindingsListResultShape satisfies SchemaProof<
      FindingsListResult,
      typeof FindingsListResultShape
    >,
  );

/** `findings.evidence` params. 증거 목록은 쪽 단위로 읽는다 */
export interface FindingsEvidenceParams {
  readonly findingId: string;
  readonly cursor?: string;
}
const FindingsEvidenceParamsShape = request({ findingId: Id, cursor: Type.Optional(Cursor) });
export const FindingsEvidenceParamsSchema: TUnsafe<Req<FindingsEvidenceParams>> = Type.Unsafe<
  Req<FindingsEvidenceParams>
>(
  FindingsEvidenceParamsShape satisfies SchemaProof<
    Req<FindingsEvidenceParams>,
    typeof FindingsEvidenceParamsShape
  >,
);
export interface FindingsEvidenceResult {
  readonly items: EvidenceRef[];
  readonly next: string | null;
}
const FindingsEvidenceResultShape = closed({
  items: Type.Array(EvidenceRefSchema, { maxItems: 200 }),
  next: Nullable(Cursor),
});
export const FindingsEvidenceResultSchema: TUnsafe<FindingsEvidenceResult> =
  Type.Unsafe<FindingsEvidenceResult>(
    FindingsEvidenceResultShape satisfies SchemaProof<
      FindingsEvidenceResult,
      typeof FindingsEvidenceResultShape
    >,
  );

/** `findings.dismiss` params. 결과는 `{}`. `until`은 다시 열릴 시점(ms)이다 */
export interface FindingsDismissParams {
  readonly findingId: string;
  readonly until?: number;
}
const FindingsDismissParamsShape = request({ findingId: Id, until: Type.Optional(Type.Number()) });
export const FindingsDismissParamsSchema: TUnsafe<Req<FindingsDismissParams>> = Type.Unsafe<
  Req<FindingsDismissParams>
>(
  FindingsDismissParamsShape satisfies SchemaProof<
    Req<FindingsDismissParams>,
    typeof FindingsDismissParamsShape
  >,
);

/** `findings.bundle` params */
export interface FindingsBundleParams {
  readonly findingId: string;
}
const FindingsBundleParamsShape = request({ findingId: Id });
export const FindingsBundleParamsSchema: TUnsafe<Req<FindingsBundleParams>> = Type.Unsafe<
  Req<FindingsBundleParams>
>(
  FindingsBundleParamsShape satisfies SchemaProof<
    Req<FindingsBundleParams>,
    typeof FindingsBundleParamsShape
  >,
);
export interface FindingsBundleResult {
  readonly bundle: FindingBundle;
  /** 16 KiB 이하 */
  readonly bytes: number;
}
const FindingsBundleResultShape = closed({
  bundle: FindingBundleSchema,
  bytes: Type.Integer({ minimum: 0, maximum: 16384 }),
});
export const FindingsBundleResultSchema: TUnsafe<FindingsBundleResult> =
  Type.Unsafe<FindingsBundleResult>(
    FindingsBundleResultShape satisfies SchemaProof<
      FindingsBundleResult,
      typeof FindingsBundleResultShape
    >,
  );

/** `profileCost.get` params */
export interface ProfileCostGetParams {
  readonly profileId: string;
  readonly basis?: "measured" | "estimated";
}
const ProfileCostGetParamsShape = request({
  profileId: Id,
  basis: Type.Optional(literalUnion(["measured", "estimated"])),
});
export const ProfileCostGetParamsSchema: TUnsafe<Req<ProfileCostGetParams>> = Type.Unsafe<
  Req<ProfileCostGetParams>
>(
  ProfileCostGetParamsShape satisfies SchemaProof<
    Req<ProfileCostGetParams>,
    typeof ProfileCostGetParamsShape
  >,
);
export interface ProfileCostGetResult {
  readonly profileId: string;
  readonly rev: number;
  readonly basis: "measured" | "estimated";
  readonly nTurns: number;
  readonly plugins: ProfileCostRow[];
  readonly total: ProfileCostRow;
}
const ProfileCostGetResultShape = closed({
  profileId: Id,
  rev: Count,
  basis: literalUnion(["measured", "estimated"]),
  nTurns: Count,
  plugins: Type.Array(ProfileCostRowSchema, { maxItems: 256 }),
  total: ProfileCostRowSchema,
});
export const ProfileCostGetResultSchema: TUnsafe<ProfileCostGetResult> =
  Type.Unsafe<ProfileCostGetResult>(
    ProfileCostGetResultShape satisfies SchemaProof<
      ProfileCostGetResult,
      typeof ProfileCostGetResultShape
    >,
  );

/** `testRun.compare` params. 2에서 8개 대화를 나란히 놓는다 */
export interface TestRunCompareParams {
  readonly threadIds: string[];
}
const TestRunCompareParamsShape = request({
  threadIds: Type.Array(ThreadRef, { minItems: 2, maxItems: 8 }),
});
export const TestRunCompareParamsSchema: TUnsafe<Req<TestRunCompareParams>> = Type.Unsafe<
  Req<TestRunCompareParams>
>(
  TestRunCompareParamsShape satisfies SchemaProof<
    Req<TestRunCompareParams>,
    typeof TestRunCompareParamsShape
  >,
);
export interface TestRunCompareResult {
  readonly sameInput: boolean;
  readonly columns: {
    readonly threadId: string;
    readonly label: string;
    readonly versionIds: string[];
  }[];
  readonly rows: CompareRow[];
}
const TestRunCompareResultShape = closed({
  sameInput: Type.Boolean(),
  columns: Type.Array(
    closed({ threadId: ThreadRef, label: Name, versionIds: Type.Array(Id, { maxItems: 16 }) }),
    { maxItems: 8 },
  ),
  rows: Type.Array(CompareRowSchema, { maxItems: 1000 }),
});
export const TestRunCompareResultSchema: TUnsafe<TestRunCompareResult> =
  Type.Unsafe<TestRunCompareResult>(
    TestRunCompareResultShape satisfies SchemaProof<
      TestRunCompareResult,
      typeof TestRunCompareResultShape
    >,
  );

/** `turnRecord.unwatch`, `turnRecord.mark`, `findings.dismiss`의 결과 `{}`. 기존 빈 객체 스키마를 그대로 쓴다 */
export type TurnRecordAckResult = EmptyParams;
export const TurnRecordAckResultSchema: typeof EmptyParamsSchema = EmptyParamsSchema;
