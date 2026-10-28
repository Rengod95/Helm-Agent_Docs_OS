import {
  Type,
  type Static,
  type TArray,
  type TBoolean,
  type TInteger,
  type TLiteral,
  type TNull,
  type TNumber,
  type TObject,
  type TOptional,
  type TUnion,
  type TUnsafe,
} from "typebox";
import { Nullable } from "../../base/index.ts";
import {
  AgentMessageSchema,
  AssistantMessageEventSchema,
  EventIdSchema,
  ItemIdSchema,
  MessageSchema,
  StepIdSchema,
  ToolResultMessageSchema,
  TurnIdSchema,
  TurnOriginSchema,
  type EventId,
  type ItemId,
} from "../../conversation/index.ts";
import { DurableEventEnvelopeSchema } from "../../records/index.ts";

const Envelope: typeof DurableEventEnvelopeSchema.properties =
  DurableEventEnvelopeSchema.properties;

/**
 * 경계에서 커밋할 내구 이벤트 초안(F.records.spec §3.1 DurableEventDraft)의 스키마.
 * seq, recordedAt은 저장소가 채우고 parentId는 생략하면 현재 leaf에 붙는다.
 */
export const DurableEventDraftSchema: TObject<{
  id: typeof Envelope.id;
  kind: typeof Envelope.kind;
  version: typeof Envelope.version;
  threadId: typeof Envelope.threadId;
  turnId: typeof Envelope.turnId;
  stepId: typeof Envelope.stepId;
  causationId: typeof Envelope.causationId;
  correlationId: typeof Envelope.correlationId;
  payload: typeof Envelope.payload;
  durable: typeof Envelope.durable;
  detached: typeof Envelope.detached;
  parentId: TOptional<TUnion<[TUnsafe<EventId>, TNull]>>;
}> = Type.Object(
  {
    id: Envelope.id,
    kind: Envelope.kind,
    version: Envelope.version,
    threadId: Envelope.threadId,
    turnId: Envelope.turnId,
    stepId: Envelope.stepId,
    causationId: Envelope.causationId,
    correlationId: Envelope.correlationId,
    payload: Envelope.payload,
    durable: Envelope.durable,
    detached: Envelope.detached,
    parentId: Type.Optional(Nullable(EventIdSchema)),
  },
  { additionalProperties: false },
);

const DraftsSchema: TArray<typeof DurableEventDraftSchema> = Type.Array(DurableEventDraftSchema, {
  maxItems: 256,
});
const MessagesSchema: TArray<typeof AgentMessageSchema> = Type.Array(AgentMessageSchema, {
  maxItems: 100_000,
});

// ── #18 agent_start, #25 agent_end, #26 agent_settled (Xeon turn 경계) ────

export const AgentStartPayloadSchema: TObject<{
  turnId: typeof TurnIdSchema;
  origin: TOptional<typeof TurnOriginSchema>;
}> = Type.Object(
  {
    turnId: TurnIdSchema,
    /** 이 turn의 입력 출처 [제안: M3-REQ-06]. 선택이다: L1.loop가 채우기 전(M3-REQ-77)의 호출자가 컴파일되도록 열어 둔다. 없으면 "user"로 본다 */
    origin: Type.Optional(TurnOriginSchema),
  },
  { additionalProperties: false },
);
export type AgentStartPayload = Static<typeof AgentStartPayloadSchema>;

export const AgentEndPayloadSchema: TObject<{
  turnId: typeof TurnIdSchema;
  messages: typeof MessagesSchema;
}> = Type.Object(
  { turnId: TurnIdSchema, messages: MessagesSchema },
  { additionalProperties: false },
);
export type AgentEndPayload = Static<typeof AgentEndPayloadSchema>;

export const AgentSettledPayloadSchema: TObject<{
  turnId: typeof TurnIdSchema;
  aborted: TBoolean;
  origin: TOptional<typeof TurnOriginSchema>;
  status: TOptional<TUnion<[TLiteral<"completed">, TLiteral<"aborted">, TLiteral<"error">]>>;
  hasFinalAnswer: TOptional<TBoolean>;
  lastItemId: TOptional<TUnion<[TUnsafe<ItemId>, TNull]>>;
}> = Type.Object(
  {
    turnId: TurnIdSchema,
    aborted: Type.Boolean(),
    /**
     * 아래 네 필드는 선택이다: L1.loop가 채우기 전(M3-REQ-77)의 호출자가 컴파일되도록 열어 둔다 [제안].
     * 없을 때 읽는 쪽의 기본: origin "user", status는 aborted가 참이면 "aborted" 아니면 "completed", hasFinalAnswer 참, lastItemId 없음
     * (학습 그룹은 lastItemId가 없으면 검토 포크를 시작하지 않는다)
     */
    /** 이 turn의 입력 출처 [제안: M3-REQ-06, 100] */
    origin: Type.Optional(TurnOriginSchema),
    /** turn의 끝. `aborted`가 참이면 "aborted"다 */
    status: Type.Optional(
      Type.Union([Type.Literal("completed"), Type.Literal("aborted"), Type.Literal("error")]),
    ),
    /** turn이 사용자에게 보일 최종 어시스턴트 답으로 끝났는가 */
    hasFinalAnswer: Type.Optional(Type.Boolean()),
    /** turn의 마지막 item. 없으면 null. 포크 지점이 된다(학습 그룹) */
    lastItemId: Type.Optional(Nullable(ItemIdSchema)),
  },
  { additionalProperties: false },
);
export type AgentSettledPayload = Static<typeof AgentSettledPayloadSchema>;

// ── #19 turn_start (Xeon step 시작) ──────────────────────────────────────

export const TurnStartPayloadSchema: TObject<{
  stepIndex: TInteger;
  stepId: typeof StepIdSchema;
  timestamp: TNumber;
}> = Type.Object(
  {
    stepIndex: Type.Integer({ minimum: 0 }),
    stepId: StepIdSchema,
    timestamp: Type.Number(),
  },
  { additionalProperties: false },
);
export type TurnStartPayload = Static<typeof TurnStartPayloadSchema>;

// ── #20~#22 message_* ────────────────────────────────────────────────────

export const MessageStartPayloadSchema: TObject<{ message: typeof AgentMessageSchema }> =
  Type.Object({ message: AgentMessageSchema }, { additionalProperties: false });
export type MessageStartPayload = Static<typeof MessageStartPayloadSchema>;

export const MessageUpdatePayloadSchema: TObject<{
  message: typeof AgentMessageSchema;
  assistantMessageEvent: typeof AssistantMessageEventSchema;
}> = Type.Object(
  { message: AgentMessageSchema, assistantMessageEvent: AssistantMessageEventSchema },
  { additionalProperties: false },
);
export type MessageUpdatePayload = Static<typeof MessageUpdatePayloadSchema>;

export const MessageEndPayloadSchema: TObject<{ message: typeof AgentMessageSchema }> = Type.Object(
  { message: AgentMessageSchema },
  { additionalProperties: false },
);
export type MessageEndPayload = Static<typeof MessageEndPayloadSchema>;

export const MessageEndValueSchema: TObject<{ message: typeof AgentMessageSchema }> = Type.Object(
  { message: AgentMessageSchema },
  { additionalProperties: false },
);
export type MessageEndValue = Static<typeof MessageEndValueSchema>;

/** 확정 메시지 교체. role이 현재 메시지와 다르면 병합이 거부된다 */
export const MessageEndPatchSchema: TObject<{ message: typeof AgentMessageSchema }> = Type.Object(
  { message: AgentMessageSchema },
  { additionalProperties: false },
);
export type MessageEndPatch = Static<typeof MessageEndPatchSchema>;

// ── #23 turn_end (Xeon step 끝), #24 agent_before_settle (Xeon turn 정착 직전) ─

export const BoundaryContextPreviewSchema: TObject<{
  contextMessages: typeof MessagesSchema;
  llmMessages: TArray<typeof MessageSchema>;
  pendingMessages: typeof MessagesSchema;
  canContinue: TBoolean;
}> = Type.Object(
  {
    contextMessages: MessagesSchema,
    llmMessages: Type.Array(MessageSchema, { maxItems: 100_000 }),
    pendingMessages: MessagesSchema,
    canContinue: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type BoundaryContextPreview = Static<typeof BoundaryContextPreviewSchema>;

export const BoundaryValueSchema: TObject<{
  entries: typeof DraftsSchema;
  continue: TBoolean;
}> = Type.Object(
  { entries: DraftsSchema, continue: Type.Boolean() },
  { additionalProperties: false },
);
export type BoundaryValue = Static<typeof BoundaryValueSchema>;

export const BoundaryPatchSchema: TObject<{
  entries: TOptional<typeof DraftsSchema>;
  continue: TOptional<TBoolean>;
}> = Type.Object(
  {
    /** 교체. 누적하려면 current.entries를 읽어 전체 목록을 돌려준다 */
    entries: Type.Optional(DraftsSchema),
    continue: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type BoundaryPatch = Static<typeof BoundaryPatchSchema>;

export const TurnEndPayloadSchema: TObject<{
  stepIndex: TInteger;
  stepId: typeof StepIdSchema;
  message: typeof AgentMessageSchema;
  toolResults: TArray<typeof ToolResultMessageSchema>;
  messageItemId: typeof ItemIdSchema;
  toolResultItemIds: TArray<typeof ItemIdSchema>;
  context: typeof BoundaryContextPreviewSchema;
}> = Type.Object(
  {
    stepIndex: Type.Integer({ minimum: 0 }),
    stepId: StepIdSchema,
    message: AgentMessageSchema,
    toolResults: Type.Array(ToolResultMessageSchema, { maxItems: 1024 }),
    messageItemId: ItemIdSchema,
    toolResultItemIds: Type.Array(ItemIdSchema, { maxItems: 1024 }),
    context: BoundaryContextPreviewSchema,
  },
  { additionalProperties: false },
);
export type TurnEndPayload = Static<typeof TurnEndPayloadSchema>;

export const AgentBeforeSettlePayloadSchema: TObject<{
  turnId: typeof TurnIdSchema;
  context: typeof BoundaryContextPreviewSchema;
  outcome: TUnion<[TLiteral<"completed">, TLiteral<"aborted">, TLiteral<"error">]>;
}> = Type.Object(
  {
    turnId: TurnIdSchema,
    context: BoundaryContextPreviewSchema,
    outcome: Type.Union([
      Type.Literal("completed"),
      Type.Literal("aborted"),
      Type.Literal("error"),
    ]),
  },
  { additionalProperties: false },
);
export type AgentBeforeSettlePayload = Static<typeof AgentBeforeSettlePayloadSchema>;
