import {
  Type,
  type Static,
  type TArray,
  type TBoolean,
  type TInteger,
  type TLiteral,
  type TNull,
  type TObject,
  type TOptional,
  type TString,
  type TUnion,
} from "typebox";
import { Nullable } from "../../base/index.ts";
import type { CapabilityApi, CapabilityDef } from "../capability.ts";
import type { MethodDef } from "../method.ts";
import { defineCapability } from "../capability.ts";
import { serviceKey, type ServiceKey } from "../service-key.ts";
import type { ToolSpec } from "../tool-spec.ts";

// L2.schedule.spec §4.4.9 (M3b B1-SCH2). 능력 ID는 `schedule.entries`다. §3.5의 `schedule.timers`(cron 식)와는 다른 능력이다.
// 트리거와 항목, 실행 기록 모양은 `@xeon/cap-schedule`의 `TriggerSpec`, `ScheduleEntry`, `RunRecord`와 같은 필드 이름을 쓴다.
// F는 cap-schedule을 import하지 않는다(층 순서). 엔진과 같은 모양인지는 호스트가 엔진 포트를 조립할 때 타입으로 확인한다 [미결: 호스트 조립 커밋].
// 간격 최소값 300초는 엔진이 `interval_too_short`로 거부한다. 이 스키마는 그 값을 두지 않는다.

// ── 식별자 ─────────────────────────────────────────────────────────────

/** 예약 항목 ID. 엔진이 접두 `sch_`로 만든다 */
export const ScheduleIdSchema: TString = Type.String({ pattern: "^sch_[0-9A-Za-z]{1,64}$" });
/** 실행 기록 ID. 엔진이 접두 `run_`로 만든다 */
export const RunIdSchema: TString = Type.String({ pattern: "^run_[0-9A-Za-z]{1,64}$" });

// ── 트리거 ─────────────────────────────────────────────────────────────

const IntervalTriggerSchema: TObject<{ kind: TLiteral<"interval">; everySeconds: TInteger }> =
  Type.Object(
    {
      kind: Type.Literal("interval"),
      everySeconds: Type.Integer({ minimum: 1, maximum: 31536000 }),
    },
    { additionalProperties: false },
  );

const AtTriggerSchema: TObject<{ kind: TLiteral<"at">; atMs: TInteger }> = Type.Object(
  { kind: Type.Literal("at"), atMs: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);

const FileWatchTriggerSchema: TObject<{
  kind: TLiteral<"file_watch">;
  paths: TArray<TString>;
  debounceMs: TInteger;
}> = Type.Object(
  {
    kind: Type.Literal("file_watch"),
    paths: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), {
      minItems: 1,
      maxItems: 16,
    }),
    debounceMs: Type.Integer({ minimum: 0, maximum: 3600000 }),
  },
  { additionalProperties: false },
);

const RemoteTriggerSchema: TObject<{ kind: TLiteral<"remote"> }> = Type.Object(
  { kind: Type.Literal("remote") },
  { additionalProperties: false },
);

const LoopTriggerSchema: TObject<{
  kind: TLiteral<"loop">;
  intervalSeconds: TInteger;
  maxIterations: TInteger;
  expiresAtMs: TInteger;
}> = Type.Object(
  {
    kind: Type.Literal("loop"),
    intervalSeconds: Type.Integer({ minimum: 0, maximum: 31536000 }),
    maxIterations: Type.Integer({ minimum: 1, maximum: 10000 }),
    expiresAtMs: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

/** 트리거 다섯 종류. 각 모양은 정확히 그 필드만 가진다(알 수 없는 필드는 거부) */
export const ScheduleTriggerSchema: TUnion<
  [
    typeof IntervalTriggerSchema,
    typeof AtTriggerSchema,
    typeof FileWatchTriggerSchema,
    typeof RemoteTriggerSchema,
    typeof LoopTriggerSchema,
  ]
> = Type.Union([
  IntervalTriggerSchema,
  AtTriggerSchema,
  FileWatchTriggerSchema,
  RemoteTriggerSchema,
  LoopTriggerSchema,
]);
export type ScheduleTrigger = Static<typeof ScheduleTriggerSchema>;

// ── 항목과 실행 기록 ───────────────────────────────────────────────────

const StopReasonSchema: TUnion<
  [
    TLiteral<"cancelled">,
    TLiteral<"completed">,
    TLiteral<"max_iterations">,
    TLiteral<"expired">,
    TLiteral<"host_exit">,
    TLiteral<"run_failed">,
  ]
> = Type.Union([
  Type.Literal("cancelled"),
  Type.Literal("completed"),
  Type.Literal("max_iterations"),
  Type.Literal("expired"),
  Type.Literal("host_exit"),
  Type.Literal("run_failed"),
]);

/** 예약 항목 한 건. `ScheduleEntry`와 같은 필드다. 세션 종류는 `cron`이다 */
export const ScheduleEntryViewSchema: TObject<{
  id: typeof ScheduleIdSchema;
  trigger: typeof ScheduleTriggerSchema;
  prompt: TString;
  workspace: TUnion<[TString, TNull]>;
  title: TUnion<[TString, TNull]>;
  sessionKind: TLiteral<"cron">;
  enabled: TBoolean;
  createdAt: TInteger;
  nextDueAt: TUnion<[TInteger, TNull]>;
  lastStartedAt: TUnion<[TInteger, TNull]>;
  iterations: TInteger;
  stoppedReason: TUnion<[typeof StopReasonSchema, TNull]>;
}> = Type.Object(
  {
    id: ScheduleIdSchema,
    trigger: ScheduleTriggerSchema,
    prompt: Type.String({ minLength: 1, maxLength: 20000 }),
    workspace: Nullable(Type.String({ maxLength: 4096 })),
    title: Nullable(Type.String({ minLength: 1, maxLength: 200 })),
    sessionKind: Type.Literal("cron"),
    enabled: Type.Boolean(),
    createdAt: Type.Integer({ minimum: 0 }),
    /** 다음 기한(epoch ms). 간격, 시각, 루프만 가진다. 꺼진 항목과 실행 중인 루프는 null */
    nextDueAt: Nullable(Type.Integer({ minimum: 0 })),
    lastStartedAt: Nullable(Type.Integer({ minimum: 0 })),
    iterations: Type.Integer({ minimum: 0 }),
    stoppedReason: Nullable(StopReasonSchema),
  },
  { additionalProperties: false },
);
export type ScheduleEntryView = Static<typeof ScheduleEntryViewSchema>;

const TriggerKindSchema: TUnion<
  [
    TLiteral<"interval">,
    TLiteral<"at">,
    TLiteral<"file_watch">,
    TLiteral<"remote">,
    TLiteral<"loop">,
  ]
> = Type.Union([
  Type.Literal("interval"),
  Type.Literal("at"),
  Type.Literal("file_watch"),
  Type.Literal("remote"),
  Type.Literal("loop"),
]);

const RunStatusSchema: TUnion<
  [
    TLiteral<"claimed">,
    TLiteral<"started">,
    TLiteral<"finished">,
    TLiteral<"skipped">,
    TLiteral<"failed">,
  ]
> = Type.Union([
  Type.Literal("claimed"),
  Type.Literal("started"),
  Type.Literal("finished"),
  Type.Literal("skipped"),
  Type.Literal("failed"),
]);

const RunOutcomeSchema: TUnion<
  [TLiteral<"completed">, TLiteral<"aborted">, TLiteral<"failed">, TLiteral<"awaiting_approval">]
> = Type.Union([
  Type.Literal("completed"),
  Type.Literal("aborted"),
  Type.Literal("failed"),
  Type.Literal("awaiting_approval"),
]);

/** 건너뜀 사유(`RunSkipReason`)와 실패 사유(`RunFailReason`)의 합집합 */
const RunReasonSchema: TUnion<
  [
    TLiteral<"missed">,
    TLiteral<"too_old">,
    TLiteral<"min_interval">,
    TLiteral<"overlap">,
    TLiteral<"rate_limited">,
    TLiteral<"host_exit">,
    TLiteral<"start_failed">,
    TLiteral<"run_failed">,
  ]
> = Type.Union([
  Type.Literal("missed"),
  Type.Literal("too_old"),
  Type.Literal("min_interval"),
  Type.Literal("overlap"),
  Type.Literal("rate_limited"),
  Type.Literal("host_exit"),
  Type.Literal("start_failed"),
  Type.Literal("run_failed"),
]);

/** 실행 기록 한 건. `RunRecord`와 같은 필드다 */
export const RunViewSchema: TObject<{
  runId: typeof RunIdSchema;
  scheduleId: typeof ScheduleIdSchema;
  firedBy: typeof TriggerKindSchema;
  dueAt: TInteger;
  claimedAt: TInteger;
  missed: TBoolean;
  status: typeof RunStatusSchema;
  threadId: TUnion<[TString, TNull]>;
  startedAt: TUnion<[TInteger, TNull]>;
  endedAt: TUnion<[TInteger, TNull]>;
  outcome: TUnion<[typeof RunOutcomeSchema, TNull]>;
  reason: TUnion<[typeof RunReasonSchema, TNull]>;
  skippedCount: TInteger;
}> = Type.Object(
  {
    runId: RunIdSchema,
    scheduleId: ScheduleIdSchema,
    firedBy: TriggerKindSchema,
    dueAt: Type.Integer({ minimum: 0 }),
    claimedAt: Type.Integer({ minimum: 0 }),
    missed: Type.Boolean(),
    status: RunStatusSchema,
    /** 이 실행이 연 세션. `RunRecord.threadId`와 같은 문자열이라 브랜드를 씌우지 않는다 */
    threadId: Nullable(Type.String({ minLength: 1, maxLength: 128 })),
    startedAt: Nullable(Type.Integer({ minimum: 0 })),
    endedAt: Nullable(Type.Integer({ minimum: 0 })),
    outcome: Nullable(RunOutcomeSchema),
    reason: Nullable(RunReasonSchema),
    skippedCount: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type RunView = Static<typeof RunViewSchema>;

/** 목록 한 줄: 항목과 마지막 실행 기록(없으면 null) */
export const ScheduleListItemSchema: TObject<{
  entry: typeof ScheduleEntryViewSchema;
  lastRun: TUnion<[typeof RunViewSchema, TNull]>;
}> = Type.Object(
  { entry: ScheduleEntryViewSchema, lastRun: Nullable(RunViewSchema) },
  { additionalProperties: false },
);
export type ScheduleListItem = Static<typeof ScheduleListItemSchema>;

// ── 오류 값 ────────────────────────────────────────────────────────────

const IntervalTooShortSchema: TObject<{
  kind: TLiteral<"interval_too_short">;
  minSeconds: TInteger;
}> = Type.Object(
  { kind: Type.Literal("interval_too_short"), minSeconds: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
const AtInPastSchema: TObject<{ kind: TLiteral<"at_in_past"> }> = Type.Object(
  { kind: Type.Literal("at_in_past") },
  { additionalProperties: false },
);
const InvalidTriggerSchema: TObject<{ kind: TLiteral<"invalid_trigger">; reason: TString }> =
  Type.Object(
    { kind: Type.Literal("invalid_trigger"), reason: Type.String({ maxLength: 200 }) },
    { additionalProperties: false },
  );
const LimitReachedSchema: TObject<{ kind: TLiteral<"limit_reached">; max: TInteger }> = Type.Object(
  { kind: Type.Literal("limit_reached"), max: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
const NotFoundSchema: TObject<{ kind: TLiteral<"not_found"> }> = Type.Object(
  { kind: Type.Literal("not_found") },
  { additionalProperties: false },
);
const NotRemoteSchema: TObject<{ kind: TLiteral<"not_remote"> }> = Type.Object(
  { kind: Type.Literal("not_remote") },
  { additionalProperties: false },
);
const DisabledSchema: TObject<{ kind: TLiteral<"disabled"> }> = Type.Object(
  { kind: Type.Literal("disabled") },
  { additionalProperties: false },
);
const StoreFailedSchema: TObject<{ kind: TLiteral<"store_failed">; message: TString }> =
  Type.Object(
    { kind: Type.Literal("store_failed"), message: Type.String({ maxLength: 512 }) },
    { additionalProperties: false },
  );

/** 예약 호출이 기대한 실패로 돌려주는 값(`CreateError`, `CancelError`, `FireError`의 합집합). wire 결과의 `ok: false`가 싣는다 */
export const ScheduleErrorSchema: TUnion<
  [
    typeof IntervalTooShortSchema,
    typeof AtInPastSchema,
    typeof InvalidTriggerSchema,
    typeof LimitReachedSchema,
    typeof NotFoundSchema,
    typeof NotRemoteSchema,
    typeof DisabledSchema,
    typeof StoreFailedSchema,
  ]
> = Type.Union([
  IntervalTooShortSchema,
  AtInPastSchema,
  InvalidTriggerSchema,
  LimitReachedSchema,
  NotFoundSchema,
  NotRemoteSchema,
  DisabledSchema,
  StoreFailedSchema,
]);
export type ScheduleError = Static<typeof ScheduleErrorSchema>;

// ── 메서드 입력과 출력 ─────────────────────────────────────────────────

/** create 입력. 엔진의 `CreateInput`과 같다. 세션은 항상 `cron`이다 */
export const ScheduleCreateInputSchema: TObject<{
  trigger: typeof ScheduleTriggerSchema;
  prompt: TString;
  workspace: TOptional<TString>;
  title: TOptional<TString>;
  enabled: TOptional<TBoolean>;
}> = Type.Object(
  {
    trigger: ScheduleTriggerSchema,
    prompt: Type.String({ minLength: 1, maxLength: 20000 }),
    workspace: Type.Optional(Type.String({ maxLength: 4096 })),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    enabled: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const CreateOutputSchema: TObject<{ entry: typeof ScheduleEntryViewSchema }> = Type.Object(
  { entry: ScheduleEntryViewSchema },
  { additionalProperties: false },
);

export const ScheduleListInputSchema: TObject<{ enabled: TOptional<TBoolean> }> = Type.Object(
  { enabled: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);

const ListOutputSchema: TObject<{ items: TArray<typeof ScheduleListItemSchema> }> = Type.Object(
  { items: Type.Array(ScheduleListItemSchema, { maxItems: 200 }) },
  { additionalProperties: false },
);

export const ScheduleCancelInputSchema: TObject<{ scheduleId: typeof ScheduleIdSchema }> =
  Type.Object({ scheduleId: ScheduleIdSchema }, { additionalProperties: false });

const CancelOutputSchema: TObject<{ entry: typeof ScheduleEntryViewSchema }> = Type.Object(
  { entry: ScheduleEntryViewSchema },
  { additionalProperties: false },
);

export const ScheduleFireInputSchema: TObject<{ scheduleId: typeof ScheduleIdSchema }> =
  Type.Object({ scheduleId: ScheduleIdSchema }, { additionalProperties: false });

const FireOutputSchema: TObject<{ run: typeof RunViewSchema }> = Type.Object(
  { run: RunViewSchema },
  { additionalProperties: false },
);

// 오류 상세(`ErrorDecl.detail`). 공통 코드(`invalid_input`, `not_found`)는 선언하지 않는다(validate의 error_code_shadow)
const IntervalTooShortDetail: TObject<{ minSeconds: TInteger }> = Type.Object({
  minSeconds: Type.Integer({ minimum: 1 }),
});
const InvalidTriggerDetail: TObject<{ reason: TString }> = Type.Object({
  reason: Type.String({ maxLength: 200 }),
});
const LimitReachedDetail: TObject<{ max: TInteger }> = Type.Object({
  max: Type.Integer({ minimum: 1 }),
});
const StoreFailedDetail: TObject<{ message: TString }> = Type.Object({
  message: Type.String({ maxLength: 512 }),
});

type ScheduleMethods = {
  readonly create: MethodDef<typeof ScheduleCreateInputSchema, typeof CreateOutputSchema>;
  readonly list: MethodDef<typeof ScheduleListInputSchema, typeof ListOutputSchema>;
  readonly cancel: MethodDef<typeof ScheduleCancelInputSchema, typeof CancelOutputSchema>;
  readonly fire: MethodDef<typeof ScheduleFireInputSchema, typeof FireOutputSchema>;
};

// ── 모델 도구 `schedule_create`의 인자 ──────────────────────────────────

const ScheduleCreateToolParams: TObject<{
  prompt: TString;
  everySeconds: TOptional<TInteger>;
  at: TOptional<TString>;
  title: TOptional<TString>;
}> = Type.Object(
  {
    prompt: Type.String({ minLength: 1, maxLength: 20000 }),
    everySeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 31536000 })),
    at: Type.Optional(Type.String({ format: "date-time", maxLength: 64 })),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { additionalProperties: false },
);

/**
 * 도구 인자의 트리거. 간격과 시각 가운데 정확히 하나여야 한다. 둘 다 없거나 둘 다 있거나 시각을 읽지 못하면
 * `atMs: 0`을 준다. atMs의 최소값이 1이라 메서드 입력 검사가 `invalid_input`으로 거부한다. 순수 함수
 */
function triggerOfToolParams(params: Static<typeof ScheduleCreateToolParams>): ScheduleTrigger {
  const { everySeconds, at } = params;
  if (everySeconds !== undefined && at === undefined) {
    return { kind: "interval", everySeconds };
  }
  if (at !== undefined && everySeconds === undefined) {
    const atMs = Date.parse(at);
    return { kind: "at", atMs: Number.isNaN(atMs) ? 0 : atMs };
  }
  return { kind: "at", atMs: 0 };
}

/** 도구 인자를 create 입력으로 옮긴다. 순수 함수 */
function createInputOfToolParams(
  params: Static<typeof ScheduleCreateToolParams>,
): Static<typeof ScheduleCreateInputSchema> {
  const trigger = triggerOfToolParams(params);
  return params.title === undefined
    ? { trigger, prompt: params.prompt }
    : { trigger, prompt: params.prompt, title: params.title };
}

/** 결과를 모델에게 한 줄로 돌려준다. 다음 기한이 없으면 `none`이다 */
function createTextOf(entry: ScheduleEntryView): string {
  const next = entry.nextDueAt === null ? "none" : new Date(entry.nextDueAt).toISOString();
  return `schedule ${entry.id} next=${next}`;
}

// L2.schedule.spec §4.4.9. 능력 정의는 이 파일 하나다.
// ADR-0015 분류(값으로 고정한다, test/capabilities/l2-effect-classes.test.ts):
// - list는 읽기 전용이다. 항목을 바꾸지 않으므로 `readOnly`와 `replay: "safe"`를 단다.
// - create, cancel, fire는 효과가 있는 쓰기다. 재생 정책과 분류를 달지 않는다(unsafe).
//   create는 `requestId` 기억이 아직 없어 `idempotent`가 될 수 없다. 같은 요청을 두 번 받으면 항목이 두 개 생긴다.
//   cancel과 fire도 같은 이유로 선언하지 않는다. 필요해지면 requestId 기억을 만든 뒤 바꾼다.

/** 예약 항목의 만들기, 목록, 취소, 원격 실행(M3b). cron 식이 없는 상태 기계 위의 능력이다 */
export const ScheduleEntries: CapabilityDef<
  ScheduleMethods,
  readonly [ToolSpec<"create", typeof ScheduleCreateToolParams, ScheduleMethods["create"]>]
> = defineCapability({
  id: "schedule.entries",
  version: "1.0.0",
  description:
    "예약 항목(무인 새 세션에서 프롬프트를 실행)의 만들기, 목록, 취소, 원격 실행. cron 식이 없고 schedule.timers와 다른 능력이다.",
  service: {
    methods: {
      // ADR-0015: 효과가 있는 쓰기다. requestId 기억이 없어 분류하지 않는다(멱등이 아니다)
      create: {
        description:
          "예약 항목을 만든다. 트리거는 간격, 한 번의 시각, 파일 감시, 원격, 루프 가운데 하나다. 간격 최소값과 켜진 예약 수 상한은 엔진이 검사한다.",
        input: ScheduleCreateInputSchema,
        output: CreateOutputSchema,
        errors: {
          interval_too_short: {
            description: "간격이 최소값(300초)보다 짧다",
            retryable: false,
            detail: IntervalTooShortDetail,
          },
          at_in_past: { description: "시각이 이미 지났다", retryable: false },
          invalid_trigger: {
            description: "트리거 값이 엔진 규칙에 맞지 않다",
            retryable: false,
            detail: InvalidTriggerDetail,
          },
          limit_reached: {
            description: "켜진 예약 수 상한에 닿았다",
            retryable: false,
            detail: LimitReachedDetail,
          },
          store_failed: {
            description: "예약 저장소를 읽거나 쓰지 못했다",
            retryable: false,
            detail: StoreFailedDetail,
          },
        },
      },
      list: {
        description: "예약 항목과 항목마다 마지막 실행 기록을 돌려준다. 읽기 전용이다.",
        input: ScheduleListInputSchema,
        output: ListOutputSchema,
        // ADR-0015: 읽기 전용
        replay: "safe",
        readOnly: true,
        errors: {
          store_failed: {
            description: "예약 저장소를 읽지 못했다",
            retryable: false,
            detail: StoreFailedDetail,
          },
        },
      },
      cancel: {
        description:
          "예약 항목을 끈다. 멈춘 이유는 cancelled로 남는다. 이미 꺼진 항목은 그대로 돌려준다.",
        input: ScheduleCancelInputSchema,
        output: CancelOutputSchema,
        // ADR-0015: 효과가 있는 쓰기이고 requestId 기억이 없어 분류하지 않는다
        errors: {
          store_failed: {
            description: "예약 저장소에 쓰지 못했다",
            retryable: false,
            detail: StoreFailedDetail,
          },
        },
      },
      fire: {
        description:
          "원격 트리거 예약을 지금 한 번 실행한다. 원격이 아닌 항목과 꺼진 항목은 거부된다.",
        input: ScheduleFireInputSchema,
        output: FireOutputSchema,
        // ADR-0015: 효과가 있는 쓰기이고 requestId 기억이 없어 분류하지 않는다
        errors: {
          not_remote: { description: "원격 트리거가 아니다", retryable: false },
          disabled: { description: "꺼진 항목이다", retryable: false },
          store_failed: {
            description: "예약 저장소에 쓰지 못했다",
            retryable: false,
            detail: StoreFailedDetail,
          },
        },
      },
    },
  },
  tools: [
    {
      name: "schedule_create",
      label: "예약 만들기",
      description:
        "지정한 간격이나 시각에 이 프롬프트를 사용자 없이 새 세션에서 실행하도록 예약한다. 사용자가 나중에 실행을 요청했을 때만 쓴다. everySeconds와 at 가운데 하나만 준다.",
      method: "create",
      parameters: ScheduleCreateToolParams,
      toInput: createInputOfToolParams,
      toContent: (out) => ({
        content: [{ type: "text", text: createTextOf(out.entry) }],
      }),
      executionMode: "sequential",
      hints: { readOnly: false, destructive: false, idempotent: false, openWorld: false },
    },
  ],
});
export const ScheduleEntriesKey: ServiceKey<CapabilityApi<typeof ScheduleEntries>> =
  serviceKey(ScheduleEntries);

/** 예약 묶음. WORK_CAPABILITIES와 같은 방식이다 */
export const SCHEDULE_CAPABILITIES: readonly [typeof ScheduleEntries] = [ScheduleEntries];
