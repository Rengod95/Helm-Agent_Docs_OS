import {
  Type,
  type Static,
  type TInteger,
  type TLiteral,
  type TNull,
  type TObject,
  type TOptional,
  type TString,
  type TUnion,
  type TUnsafe,
} from "typebox";
import { Nullable } from "../../base/index.ts";
import {
  EventIdSchema,
  ItemIdSchema,
  type EventId,
  type ItemId,
} from "../../conversation/index.ts";

// 필드의 정본은 F.extensions.spec이다. records는 extensions보다 낮은 순위라(F.readme §3) 타입을 import하지 않고
// 같은 모양을 적는다. 이름 대응: scopeId ↔ ScopeId, leaseId ↔ LeaseId, limits ↔ DriveLimits, when ↔ PostWhen.

const scopeId = (): TString => Type.String({ minLength: 1, maxLength: 96 });
const leaseId = (): TString => Type.String({ minLength: 1, maxLength: 128 });

export const ScopeChangedPayloadSchema: TObject<{
  scopeId: TString;
  status: TUnion<[TLiteral<"enabled">, TLiteral<"disabled">]>;
  reason: TOptional<
    TUnion<
      [
        TLiteral<"request">,
        TLiteral<"auto_disable">,
        TLiteral<"safe_mode">,
        TLiteral<"startup_disable">,
      ]
    >
  >;
}> = Type.Object(
  {
    /** F.extensions.spec ScopeId. "<확장 이름>" 또는 "<확장 이름>/<하위 이름>" */
    scopeId: scopeId(),
    /** 적용된 상태. enable()/disable() 요청이 단계 경계에서 적용될 때 쓴다 */
    status: Type.Union([Type.Literal("enabled"), Type.Literal("disabled")]),
    /** 적용 사유. 없으면 "request". 값 정본은 X.operations.spec ScopeChangeReason */
    reason: Type.Optional(
      Type.Union([
        Type.Literal("request"),
        Type.Literal("auto_disable"),
        Type.Literal("safe_mode"),
        Type.Literal("startup_disable"),
      ]),
    ),
  },
  { additionalProperties: false },
);
export type ScopeChangedPayload = Static<typeof ScopeChangedPayloadSchema>;

/** 휘발. 확장 핸들러 실패 하나마다 보낸다(X.operations.spec §4.3.4) */
export const ScopeHandlerFailedPayloadSchema: TObject<{
  owner: TString;
  point: TString;
  result: TString;
  message: TString;
  consecutive: TInteger;
}> = Type.Object(
  {
    /** X.operations.spec HandlerOwnerKey: "ext:<이름>" | "hook:<이름>" */
    owner: Type.String({ minLength: 1, maxLength: 96 }),
    /** F.extensions.spec PointName */
    point: Type.String({ minLength: 1, maxLength: 64 }),
    /** 실패 분류. 값 집합은 X.operations.spec §4.3 */
    result: Type.String({ minLength: 1, maxLength: 64 }),
    message: Type.String({ maxLength: 4000 }),
    /** 같은 owner의 연속 실패 수 */
    consecutive: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type ScopeHandlerFailedPayload = Static<typeof ScopeHandlerFailedPayloadSchema>;

export const DriveLimitsJsonSchema: TObject<{
  maxTurns: TOptional<TInteger>;
  maxSpawns: TOptional<TInteger>;
  maxTokens: TOptional<TInteger>;
}> = Type.Object(
  {
    maxTurns: Type.Optional(Type.Integer({ minimum: 0 })),
    maxSpawns: Type.Optional(Type.Integer({ minimum: 0 })),
    maxTokens: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const LeaseAcquiredPayloadSchema: TObject<{
  leaseId: TString;
  scopeId: TString;
  limits: typeof DriveLimitsJsonSchema;
  leaseEpoch: TOptional<TInteger>;
}> = Type.Object(
  {
    /** F.extensions.spec DriveLease.leaseId */
    leaseId: leaseId(),
    /** 임대를 받은 그룹의 scope */
    scopeId: scopeId(),
    /** DriveLease.limits(DriveLimits) */
    limits: DriveLimitsJsonSchema,
    /**
     * 임대 차수. 그 scope의 활성 가지 위 직전 `lease.acquired` 개수 + 1, 1부터 센다(X.primitives.spec §4.4.1).
     * 선택이라 `version`을 올리지 않는다. 없으면(옛 기록) 활성 가지 위 개수로 다시 센다 [결정: M3-REQ-08]
     */
    leaseEpoch: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);
export type LeaseAcquiredPayload = Static<typeof LeaseAcquiredPayloadSchema>;

/**
 * disabled: 그룹 끄기, budget: 상한 도달, error: drive 함수 예외, idle: 효과 없는 반환 반복,
 * revoked: X의 중재로 회수, restart: 프로세스 재시작 뒤 정리.
 */
export const LeaseReleasedPayloadSchema: TObject<{
  leaseId: TString;
  scopeId: TString;
  reason: TUnion<
    [
      TLiteral<"disabled">,
      TLiteral<"budget">,
      TLiteral<"error">,
      TLiteral<"idle">,
      TLiteral<"revoked">,
      TLiteral<"restart">,
    ]
  >;
}> = Type.Object(
  {
    leaseId: leaseId(),
    scopeId: scopeId(),
    reason: Type.Union([
      Type.Literal("disabled"),
      Type.Literal("budget"),
      Type.Literal("error"),
      Type.Literal("idle"),
      Type.Literal("revoked"),
      Type.Literal("restart"),
    ]),
  },
  { additionalProperties: false },
);
export type LeaseReleasedPayload = Static<typeof LeaseReleasedPayloadSchema>;

/**
 * drive 임대 요청이 대기 상한 뒤 거부됐다(M3-REQ-99, review.m3-design-inputs D-M3-05 a).
 * groupId는 요청한 그룹(ExtensionName), requestSeq는 거부된 요청의 순번이다.
 * 수명주기 지점 `lifecycle.lease.rejected`의 페이로드이기도 하다.
 */
export const LeaseRejectedPayloadSchema: TObject<{
  groupId: TString;
  reason: TString;
  requestSeq: TInteger;
}> = Type.Object(
  {
    groupId: Type.String({ minLength: 1, maxLength: 96 }),
    reason: Type.String({ minLength: 1, maxLength: 64 }),
    requestSeq: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type LeaseRejectedPayload = Static<typeof LeaseRejectedPayloadSchema>;

/** ScopeApi.post 호출의 영수증. 큐 항목 사실은 같은 커밋의 input.queued가 적는다 */
export const PostAcceptedPayloadSchema: TObject<{
  requestId: TString;
  scopeId: TString;
  when: TUnion<[TLiteral<"steer">, TLiteral<"followUp">, TLiteral<"next">]>;
  inputId: TUnsafe<EventId>;
  itemId: TUnion<[TUnsafe<ItemId>, TNull]>;
}> = Type.Object(
  {
    /** F.extensions.spec PostOptions.requestId. 대화 범위 멱등 키 */
    requestId: Type.String({ minLength: 1, maxLength: 64 }),
    /** post한 확장의 scope */
    scopeId: scopeId(),
    /** PostOptions.when(PostWhen) */
    when: Type.Union([Type.Literal("steer"), Type.Literal("followUp"), Type.Literal("next")]),
    /** 같은 커밋의 input.queued 이벤트 id. 재개 때 post 멱등 판정의 근거다 [결정(잠정): review.decisions-2 U-05] */
    inputId: EventIdSchema,
    /** 대화에 남은 item(user 또는 custom). 아직 큐에 있으면 null */
    itemId: Nullable(ItemIdSchema),
  },
  { additionalProperties: false },
);
export type PostAcceptedPayload = Static<typeof PostAcceptedPayloadSchema>;
