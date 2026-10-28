import {
  Type,
  type Static,
  type TAddOptional,
  type TArray,
  type TInteger,
  type TLiteral,
  type TNull,
  type TObject,
  type TString,
  type TUnion,
  type TUnsafe,
} from "typebox";
import { Nullable } from "../base/index.ts";
import {
  EventIdSchema,
  ItemIdSchema,
  ThreadIdSchema,
  type EventId,
  type IdFactory,
  type ItemId,
  type StepId,
  type ThreadId,
  type TurnId,
} from "./ids.ts";
import {
  ItemKindSchema,
  StepStatusSchema,
  ThreadStatusSchema,
  TurnStatusSchema,
  type ItemRecordSchema,
  type ToolCallItemSchema,
} from "./hierarchy.ts";
import { AgentToolResultSchema } from "./agent-schema.ts";
import { JsonValueSchema, StopReasonSchema, UsageSchema } from "./message-schema.ts";
import { PartDeltaSchema, PartRecordSchema } from "./parts.ts";
import type { AgentEvent, AgentToolResult } from "./agent.ts";
import type { JsonValue, StopReason, Usage } from "./pi.ts";

/** 공통 범위 필드. envelope 필드(F.records.spec)와 이름이 같다. */
export interface LifecycleScope {
  threadId: ThreadId;
  turnId: TurnId | null;
  stepId: StepId | null;
}

export type Notification<K extends string, P> = { readonly type: K } & LifecycleScope & P;

// ── thread ──────────────────────────────────────────────────────────────
export const ThreadStartedPayloadSchema: TObject<{
  title: TUnion<[TString, TNull]>;
  forkedFrom: TUnion<[TObject<{ threadId: TUnsafe<ThreadId>; eventId: TUnsafe<EventId> }>, TNull]>;
  workspace: TAddOptional<TUnion<[TString, TNull]>>;
}> = Type.Object(
  {
    title: Nullable(Type.String({ maxLength: 200 })),
    forkedFrom: Nullable(
      Type.Object(
        { threadId: ThreadIdSchema, eventId: EventIdSchema },
        { additionalProperties: false },
      ),
    ),
    /**
     * thread.create가 받은 작업 폴더(절대 경로). 없거나 null이면 호스트 프로세스의 cwd를 쓴다.
     * M1이 쓴 옛 행에는 필드가 없어 선택 필드로 더했다: 없는 값은 null과 같고 version 1 그대로 읽는다(F.records.spec §3.2 규칙 5).
     */
    workspace: Type.Optional(Nullable(Type.String({ minLength: 1, maxLength: 4096 }))),
  },
  { additionalProperties: false },
);
export type ThreadStartedPayload = Static<typeof ThreadStartedPayloadSchema>;

export const ThreadUpdatedPayloadSchema: TObject<{
  title: TAddOptional<TUnion<[TString, TNull]>>;
  status: TAddOptional<typeof ThreadStatusSchema>;
  leafEventId: TAddOptional<TUnsafe<EventId>>;
}> = Type.Object(
  {
    title: Type.Optional(Nullable(Type.String({ maxLength: 200 }))),
    status: Type.Optional(ThreadStatusSchema),
    leafEventId: Type.Optional(EventIdSchema),
  },
  { additionalProperties: false },
);
export type ThreadUpdatedPayload = Static<typeof ThreadUpdatedPayloadSchema>;

export const ThreadClosedPayloadSchema: TObject<{ reason: TUnion<[TString, TNull]> }> = Type.Object(
  { reason: Nullable(Type.String({ maxLength: 500 })) },
  { additionalProperties: false },
);
export type ThreadClosedPayload = Static<typeof ThreadClosedPayloadSchema>;

export type ThreadStarted = Notification<"thread.started", ThreadStartedPayload>;
export type ThreadUpdated = Notification<"thread.updated", ThreadUpdatedPayload>;
export type ThreadClosed = Notification<"thread.closed", ThreadClosedPayload>;
export type ThreadEvent = ThreadStarted | ThreadUpdated | ThreadClosed;

// ── turn ────────────────────────────────────────────────────────────────

/**
 * turn 입력의 출처 [제안: M3-REQ-06, 이름 `origin`. 값 집합은 학습 그룹 요구 REQ-LN-01의 `TurnOrigin`].
 * delegation은 위임 자식 대화의 turn, drive는 drive 함수의 `loop.turn`, scheduled는 예약 실행, remote는 원격 입력이다.
 * other는 위 다섯에 들지 않는 확장 post다
 */
export type TurnOrigin = "user" | "scheduled" | "remote" | "delegation" | "drive" | "other";
export const TURN_ORIGINS: readonly TurnOrigin[] = [
  "user",
  "scheduled",
  "remote",
  "delegation",
  "drive",
  "other",
];
export const TurnOriginSchema: TUnion<
  [
    TLiteral<"user">,
    TLiteral<"scheduled">,
    TLiteral<"remote">,
    TLiteral<"delegation">,
    TLiteral<"drive">,
    TLiteral<"other">,
  ]
> = Type.Union([
  Type.Literal("user"),
  Type.Literal("scheduled"),
  Type.Literal("remote"),
  Type.Literal("delegation"),
  Type.Literal("drive"),
  Type.Literal("other"),
]);

export const TurnStartedPayloadSchema: TObject<{
  inputItemIds: TArray<TUnsafe<ItemId>>;
  requestId: TUnion<[TString, TNull]>;
  scopeId: TUnion<[TString, TNull]>;
  origin: TAddOptional<typeof TurnOriginSchema>;
}> = Type.Object(
  {
    inputItemIds: Type.Array(ItemIdSchema, { maxItems: 1024 }),
    requestId: Nullable(Type.String({ minLength: 1, maxLength: 64 })),
    /** drive turn이면 임대한 scope id, 그 밖은 null. drive turn 멱등 키 (scopeId, requestId)의 근거 */
    scopeId: Nullable(Type.String({ minLength: 1, maxLength: 96 })),
    /** 입력 출처. 선택이라 `version`을 올리지 않는다. 없으면(옛 기록) "user"로 읽는다 [제안: M3-REQ-06] */
    origin: Type.Optional(TurnOriginSchema),
  },
  { additionalProperties: false },
);
export type TurnStartedPayload = Static<typeof TurnStartedPayloadSchema>;

/** 사용자에게만 보이는 휘발 알림(L1.loop.spec §4.9, §4.10, FR-L5). 모델 컨텍스트에는 넣지 않는다 */
export const TurnNoticeSchema: TObject<{
  code: TUnion<[TLiteral<"repeat_detected">, TLiteral<"gate_limit">]>;
  detail: TUnsafe<JsonValue>;
}> = Type.Object(
  {
    /** repeat_detected: 같은 행동-관찰(또는 오류) 쌍이 연속으로 되풀이됨. gate_limit: 완료 게이트 계속 횟수가 상한에 이름 */
    code: Type.Union([Type.Literal("repeat_detected"), Type.Literal("gate_limit")]),
    /** 코드별 보조 값. gate_limit은 `{ limit: number }`, repeat_detected는 `{ kind: "action_observation" | "action_error", count: number }` */
    detail: JsonValueSchema,
  },
  { additionalProperties: false },
);
export type TurnNotice = Static<typeof TurnNoticeSchema>;

export const TurnUpdatedPayloadSchema: TObject<{
  status: typeof TurnStatusSchema;
  notice: TAddOptional<typeof TurnNoticeSchema>;
}> = Type.Object(
  {
    status: TurnStatusSchema,
    /** 알림. 없으면 상태 갱신만이다 */
    notice: Type.Optional(TurnNoticeSchema),
  },
  { additionalProperties: false },
);
export type TurnUpdatedPayload = Static<typeof TurnUpdatedPayloadSchema>;

export const TurnCompletedPayloadSchema: TObject<{
  status: TUnion<[TLiteral<"completed">, TLiteral<"interrupted">, TLiteral<"failed">]>;
  stepCount: TInteger;
  usage: TUnion<[TUnsafe<Usage>, TNull]>;
  error: TUnion<[TString, TNull]>;
}> = Type.Object(
  {
    status: Type.Union([
      Type.Literal("completed"),
      Type.Literal("interrupted"),
      Type.Literal("failed"),
    ]),
    stepCount: Type.Integer({ minimum: 0 }),
    /** turn 안 모델 호출 합계 */
    usage: Nullable(UsageSchema),
    error: Nullable(Type.String({ maxLength: 4000 })),
  },
  { additionalProperties: false },
);
export type TurnCompletedPayload = Static<typeof TurnCompletedPayloadSchema>;

export type TurnStarted = Notification<"turn.started", TurnStartedPayload>;
export type TurnUpdated = Notification<"turn.updated", TurnUpdatedPayload>;
export type TurnCompleted = Notification<"turn.completed", TurnCompletedPayload>;
export type TurnEvent = TurnStarted | TurnUpdated | TurnCompleted;

// ── step (pi turn_start ~ turn_end. F.conversation.spec §2.1) ─────────────
export const StepStartedPayloadSchema: TObject<{ stepIndex: TInteger }> = Type.Object(
  { stepIndex: Type.Integer({ minimum: 0 }) },
  { additionalProperties: false },
);
export type StepStartedPayload = Static<typeof StepStartedPayloadSchema>;

export const StepUpdatedPayloadSchema: TObject<{ status: typeof StepStatusSchema }> = Type.Object(
  { status: StepStatusSchema },
  { additionalProperties: false },
);
export type StepUpdatedPayload = Static<typeof StepUpdatedPayloadSchema>;

export const StepCompletedPayloadSchema: TObject<{
  stepIndex: TInteger;
  status: TUnion<[TLiteral<"completed">, TLiteral<"interrupted">, TLiteral<"failed">]>;
  stopReason: TUnsafe<StopReason>;
  assistantItemId: TUnion<[TUnsafe<ItemId>, TNull]>;
  toolResultItemIds: TArray<TUnsafe<ItemId>>;
}> = Type.Object(
  {
    stepIndex: Type.Integer({ minimum: 0 }),
    status: Type.Union([
      Type.Literal("completed"),
      Type.Literal("interrupted"),
      Type.Literal("failed"),
    ]),
    stopReason: StopReasonSchema,
    assistantItemId: Nullable(ItemIdSchema),
    toolResultItemIds: Type.Array(ItemIdSchema, { maxItems: 1024 }),
  },
  { additionalProperties: false },
);
export type StepCompletedPayload = Static<typeof StepCompletedPayloadSchema>;

/** pi `turn_start`에 대응한다. */
export type StepStarted = Notification<"step.started", StepStartedPayload>;
export type StepUpdated = Notification<"step.updated", StepUpdatedPayload>;
/** pi `turn_end`에 대응한다. 단계 경계다. */
export type StepCompleted = Notification<"step.completed", StepCompletedPayload>;
export type StepEvent = StepStarted | StepUpdated | StepCompleted;

// ── item ────────────────────────────────────────────────────────────────
export const ItemStartedPayloadSchema: TObject<{
  itemId: TUnsafe<ItemId>;
  kind: typeof ItemKindSchema;
  toolCallId: TUnion<[TString, TNull]>;
  toolName: TUnion<[TString, TNull]>;
}> = Type.Object(
  {
    itemId: ItemIdSchema,
    kind: ItemKindSchema,
    /** kind === "toolCall"일 때 */
    toolCallId: Nullable(Type.String({ minLength: 1, maxLength: 256 })),
    toolName: Nullable(Type.String({ minLength: 1, maxLength: 128 })),
  },
  { additionalProperties: false },
);
export type ItemStartedPayload = Static<typeof ItemStartedPayloadSchema>;

export const ItemUpdateSchema: TUnion<
  [
    TObject<{ kind: TLiteral<"part_delta">; delta: typeof PartDeltaSchema }>,
    TObject<{ kind: TLiteral<"part_completed">; part: typeof PartRecordSchema }>,
    TObject<{
      kind: TLiteral<"tool_progress">;
      partialResult: TUnsafe<AgentToolResult>;
    }>,
  ]
> = Type.Union([
  Type.Object(
    { kind: Type.Literal("part_delta"), delta: PartDeltaSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("part_completed"), part: PartRecordSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    // 휘발 경로라 얕게만 검사한다.
    { kind: Type.Literal("tool_progress"), partialResult: AgentToolResultSchema },
    { additionalProperties: false },
  ),
]);
export type ItemUpdate = Static<typeof ItemUpdateSchema>;

export const ItemUpdatedPayloadSchema: TObject<{
  itemId: TUnsafe<ItemId>;
  update: typeof ItemUpdateSchema;
}> = Type.Object(
  { itemId: ItemIdSchema, update: ItemUpdateSchema },
  { additionalProperties: false },
);
export type ItemUpdatedPayload = Static<typeof ItemUpdatedPayloadSchema>;

/** item.completed는 카탈로그 kind가 아니라(내구 기록은 item.recorded, effect.result) 기록 검증 스키마를 두지 않는다. */
export type ItemCompletedPayload = {
  item: Static<typeof ItemRecordSchema> | Static<typeof ToolCallItemSchema>;
};

export type ItemStarted = Notification<"item.started", ItemStartedPayload>;
export type ItemUpdated = Notification<"item.updated", ItemUpdatedPayload>;
export type ItemCompleted = Notification<"item.completed", ItemCompletedPayload>;
export type ItemEvent = ItemStarted | ItemUpdated | ItemCompleted;

export type LifecycleEvent = ThreadEvent | TurnEvent | StepEvent | ItemEvent;

// ── pi AgentEvent → 알림 대응 함수 시그니처. 구현은 L1.loop(L1-b)이 한다 ─────────
export interface AgentEventMapInit {
  threadId: ThreadId;
  turnId: TurnId;
  /** 재개 시 체크포인트의 stepIndex + 1 */
  startStepIndex: number;
  ids: IdFactory;
}

export interface AgentEventMapper {
  /** pi 이벤트 하나를 받아 0개 이상의 알림을 순서대로 돌려준다. 같은 입력 열에 같은 출력 열(ids 제외). */
  map(event: AgentEvent): readonly LifecycleEvent[];
  /** 현재 열린 step과 item. 체크포인트 작성에 쓴다. */
  snapshot(): { stepId: StepId | null; stepIndex: number; openItemIds: readonly ItemId[] };
}

export type CreateAgentEventMapper = (init: AgentEventMapInit) => AgentEventMapper;
