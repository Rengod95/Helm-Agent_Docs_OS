import {
  Type,
  type Static,
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
  CheckpointIdSchema,
  EffectIdSchema,
  EventIdSchema,
  ModelThinkingLevelSchema,
  StepIdSchema,
  ThreadIdSchema,
  TurnIdSchema,
  type CheckpointId,
  type EffectId,
  type EventId,
  type ModelThinkingLevel,
  type StepId,
  type ThreadId,
  type TurnId,
} from "../conversation/index.ts";

export const STEP_CHECKPOINT_SCHEMA_VERSION: number = 1;

export const PendingToolCallSchema: TObject<{
  toolCallId: TString;
  effectId: TUnion<[TUnsafe<EffectId>, TNull]>;
  waiting: TUnion<[TLiteral<"approval">, TLiteral<"input_required">, TLiteral<"deferred">, TNull]>;
}> = Type.Object(
  {
    toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
    /** intent를 쓰기 전이면 null */
    effectId: Nullable(EffectIdSchema),
    waiting: Type.Union([
      Type.Literal("approval"),
      Type.Literal("input_required"),
      Type.Literal("deferred"),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);
export type PendingToolCall = Static<typeof PendingToolCallSchema>;

/**
 * 단계 체크포인트. 단계 경계마다 step.completed와 같은 커밋으로 쓴다.
 * 루프 상태 전부를 복사하지 않는다. drive 임대와 scope 상태는 해당 이벤트 id로 참조한다.
 */
export const StepCheckpointSchema: TObject<{
  checkpointId: TUnsafe<CheckpointId>;
  schemaVersion: TInteger;
  threadId: TUnsafe<ThreadId>;
  turnId: TUnsafe<TurnId>;
  stepId: TUnsafe<StepId>;
  stepIndex: TInteger;
  leafEventId: TUnsafe<EventId>;
  next: TUnion<
    [TLiteral<"request">, TLiteral<"tools">, TLiteral<"await_input">, TLiteral<"turn_end">]
  >;
  pendingToolCalls: TArray<typeof PendingToolCallSchema>;
  inputCursor: TObject<{ consumedSeq: TInteger }>;
  model: TObject<{
    provider: TString;
    modelId: TString;
    thinkingLevel: TUnsafe<ModelThinkingLevel>;
  }>;
  leaseRefs: TArray<TUnsafe<EventId>>;
  scopeRef: TUnion<[TUnsafe<EventId>, TNull]>;
}> = Type.Object(
  {
    checkpointId: CheckpointIdSchema,
    schemaVersion: Type.Integer({ minimum: 1 }),
    threadId: ThreadIdSchema,
    turnId: TurnIdSchema,
    stepId: StepIdSchema,
    stepIndex: Type.Integer({ minimum: 0 }),
    /** 이 체크포인트 직전 내구 이벤트(같은 커밋의 step.completed) */
    leafEventId: EventIdSchema,
    next: Type.Union([
      Type.Literal("request"),
      Type.Literal("tools"),
      Type.Literal("await_input"),
      Type.Literal("turn_end"),
    ]),
    pendingToolCalls: Type.Array(PendingToolCallSchema, { maxItems: 1024 }),
    /** 입력 큐에서 마지막으로 소비한 내구 seq */
    inputCursor: Type.Object(
      { consumedSeq: Type.Integer({ minimum: 0 }) },
      { additionalProperties: false },
    ),
    /** 재개 후 첫 요청에 쓴다 */
    model: Type.Object(
      {
        provider: Type.String({ minLength: 1, maxLength: 96 }),
        modelId: Type.String({ minLength: 1, maxLength: 256 }),
        thinkingLevel: ModelThinkingLevelSchema,
      },
      { additionalProperties: false },
    ),
    /** 유효한 lease.acquired 이벤트 */
    leaseRefs: Type.Array(EventIdSchema, { maxItems: 64 }),
    /** 마지막 scope.changed 이벤트 */
    scopeRef: Nullable(EventIdSchema),
  },
  { additionalProperties: false },
);
export type StepCheckpoint = Static<typeof StepCheckpointSchema>;
