import {
  Type,
  type Static,
  type TArray,
  type TBoolean,
  type TInteger,
  type TLiteral,
  type TNull,
  type TObject,
  type TString,
  type TUnion,
  type TUnsafe,
} from "typebox";
import { Nullable } from "../../base/index.ts";
import {
  EventIdSchema,
  ItemIdSchema,
  ThreadIdSchema,
  TurnIdSchema,
  UsageSchema,
  type EventId,
  type ItemId,
  type ThreadId,
  type TurnId,
  type Usage,
} from "../../conversation/index.ts";

// 하위 모양: L1.agents.spec §3.2·§3.4·§3.5

const ToolOwner: TObject<{
  kind: TLiteral<"tool">;
  turnId: TUnsafe<TurnId>;
  toolCallId: TString;
}> = Type.Object(
  {
    kind: Type.Literal("tool"),
    turnId: TurnIdSchema,
    toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);
const DriveOwner: TObject<{
  kind: TLiteral<"drive">;
  turnId: TUnion<[TUnsafe<TurnId>, TNull]>;
  scopeId: TString;
  leaseId: TString;
}> = Type.Object(
  {
    kind: Type.Literal("drive"),
    turnId: Nullable(TurnIdSchema),
    scopeId: Type.String({ minLength: 1, maxLength: 96 }),
    leaseId: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);
const ScopeOwner: TObject<{ kind: TLiteral<"scope">; scopeId: TString }> = Type.Object(
  { kind: Type.Literal("scope"), scopeId: Type.String({ minLength: 1, maxLength: 96 }) },
  { additionalProperties: false },
);

export const SpawnOwnerJsonSchema: TUnion<
  [typeof ToolOwner, typeof DriveOwner, typeof ScopeOwner]
> = Type.Union([ToolOwner, DriveOwner, ScopeOwner]);
export type SpawnOwnerJson = Static<typeof SpawnOwnerJsonSchema>;

const ForkAtEvent: TObject<{ at: TLiteral<"event">; eventId: TUnsafe<EventId> }> = Type.Object(
  { at: Type.Literal("event"), eventId: EventIdSchema },
  { additionalProperties: false },
);
const ForkAtItem: TObject<{ at: TLiteral<"item">; itemId: TUnsafe<ItemId> }> = Type.Object(
  { at: Type.Literal("item"), itemId: ItemIdSchema },
  { additionalProperties: false },
);

export const AgentSpawnedPayloadSchema: TObject<{
  childThreadId: TUnsafe<ThreadId>;
  agent: TString;
  requestId: TString;
  owner: typeof SpawnOwnerJsonSchema;
  caller: TString;
  depth: TInteger;
  background: TBoolean;
  fork: TUnion<[typeof ForkAtEvent, typeof ForkAtItem, TNull]>;
  modelRole: TString;
}> = Type.Object(
  {
    childThreadId: ThreadIdSchema,
    agent: Type.String({ minLength: 1, maxLength: 64 }),
    /** 자식 requestId */
    requestId: Type.String({ minLength: 1, maxLength: 64 }),
    owner: SpawnOwnerJsonSchema,
    /** "subagent:<agent>" */
    caller: Type.String({ minLength: 1, maxLength: 128 }),
    depth: Type.Integer({ minimum: 0 }),
    background: Type.Boolean(),
    fork: Type.Union([ForkAtEvent, ForkAtItem, Type.Null()]),
    modelRole: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: false },
);
export type AgentSpawnedPayload = Static<typeof AgentSpawnedPayloadSchema>;

const Report: TObject<{
  text: TString;
  truncated: TBoolean;
  flags: TArray<TString>;
  originalChars: TInteger;
}> = Type.Object(
  {
    text: Type.String({ maxLength: 65_536 }),
    truncated: Type.Boolean(),
    flags: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 32 }),
    originalChars: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

/** F.extensions.spec의 지점 페이로드 AgentSettledPayload(agent_settled)와 이름이 겹치지 않게 Event를 붙인다 */
export const AgentSettledEventPayloadSchema: TObject<{
  childThreadId: TUnsafe<ThreadId>;
  requestId: TString;
  status: TUnion<[TLiteral<"completed">, TLiteral<"aborted">, TLiteral<"error">]>;
  report: TUnion<[typeof Report, TNull]>;
  answerItemId: TUnion<[TUnsafe<ItemId>, TNull]>;
  usage: TUnion<[TUnsafe<Usage>, TNull]>;
  error: TUnion<[TString, TNull]>;
}> = Type.Object(
  {
    childThreadId: ThreadIdSchema,
    requestId: Type.String({ minLength: 1, maxLength: 64 }),
    status: Type.Union([Type.Literal("completed"), Type.Literal("aborted"), Type.Literal("error")]),
    report: Nullable(Report),
    answerItemId: Nullable(ItemIdSchema),
    /** 자식 사용량은 여기에만 남는다 */
    usage: Nullable(UsageSchema),
    error: Nullable(Type.String({ maxLength: 4000 })),
  },
  { additionalProperties: false },
);
export type AgentSettledEventPayload = Static<typeof AgentSettledEventPayloadSchema>;

export const AgentJudgedPayloadSchema: TObject<{
  goalRef: TString;
  run: TInteger;
  verdict: TUnion<[TLiteral<"met">, TLiteral<"not_met">, TLiteral<"undecidable">]>;
  rationale: TString;
  missing: TArray<TString>;
  usage: TUnion<[TUnsafe<Usage>, TNull]>;
  model: TObject<{ provider: TString; modelId: TString }>;
}> = Type.Object(
  {
    goalRef: Type.String({ minLength: 1, maxLength: 256 }),
    /** 1부터 */
    run: Type.Integer({ minimum: 1 }),
    verdict: Type.Union([
      Type.Literal("met"),
      Type.Literal("not_met"),
      Type.Literal("undecidable"),
    ]),
    rationale: Type.String({ maxLength: 8000 }),
    missing: Type.Array(Type.String({ maxLength: 1000 }), { maxItems: 64 }),
    usage: Nullable(UsageSchema),
    model: Type.Object(
      {
        provider: Type.String({ minLength: 1, maxLength: 96 }),
        modelId: Type.String({ minLength: 1, maxLength: 256 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type AgentJudgedPayload = Static<typeof AgentJudgedPayloadSchema>;
