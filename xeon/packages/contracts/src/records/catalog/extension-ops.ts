import {
  Type,
  type Static,
  type TBoolean,
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
  JsonValueSchema,
  type EventId,
  type ItemId,
  type JsonValue,
} from "../../conversation/index.ts";

// 필드의 정본은 F.extensions.spec이다. records는 extensions보다 낮은 순위라(F.readme §3) 타입을 import하지 않고
// 같은 모양을 적는다. 이름 대응: scopeId ↔ RegistrationId, leaseId ↔ DriveLockId, limits ↔ DriveLimits, when ↔ PostWhen.

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
    /** F.extensions.spec RegistrationId. "<확장 이름>" 또는 "<확장 이름>/<하위 이름>" */
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
  asksDisable: TOptional<TBoolean>;
}> = Type.Object(
  {
    /** X.operations.spec HandlerOwnerKey: "ext:<이름>" | "hook:<이름>" */
    owner: Type.String({ minLength: 1, maxLength: 96 }),
    /** F.extensions.spec HookName */
    point: Type.String({ minLength: 1, maxLength: 64 }),
    /** 실패 분류. 값 집합은 X.operations.spec §4.3 */
    result: Type.String({ minLength: 1, maxLength: 64 }),
    message: Type.String({ maxLength: 4000 }),
    /** 같은 owner의 연속 실패 수 */
    consecutive: Type.Integer({ minimum: 1 }),
    /** 참이면 이 실패로 자동 끄기 기준을 넘어 "끌까요" 질문이 새로 생겼다. 답을 받을 때까지 켜 둔다 [결정: 2026-11-04 사용자] */
    asksDisable: Type.Optional(Type.Boolean()),
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
  lineageId: TString;
  limits: typeof DriveLimitsJsonSchema;
  leaseEpoch: TOptional<TInteger>;
  parent: TOptional<TString>;
  depth: TOptional<TInteger>;
  contentHash: TOptional<TString>;
  input: TOptional<TUnsafe<JsonValue>>;
  requestId: TOptional<TString>;
}> = Type.Object(
  {
    /** F.extensions.spec DriveLock.leaseId */
    leaseId: leaseId(),
    /** 임대를 받은 그룹의 scope */
    scopeId: scopeId(),
    /**
     * 계통 id. `leaseId`는 부여마다 새로 발급하지만 계통 id는 사유 `waiting` 반납 바로 뒤, 같은 thread와 같은 Registration의 부여가
     * 앞 drive 락에서 이어받는다. 그 밖의 부여는 자기 `leaseId`와 같은 값으로 새 계통을 연다. `loop.turn`·`loop.spawn`의 기본 키 재료다
     * (X.primitives.spec §4.4.3, F.extensions.spec §4.6 REQ-X-04)
     */
    lineageId: leaseId(),
    /** DriveLock.limits(DriveLimits) */
    limits: DriveLimitsJsonSchema,
    /**
     * 임대 차수. 그 scope의 활성 가지 위 직전 `lease.acquired` 개수 + 1, 1부터 센다(X.primitives.spec §4.4.1).
     * 선택이라 `version`을 올리지 않는다. 없으면(옛 기록) 활성 가지 위 개수로 다시 센다 [결정: M3-REQ-08]
     */
    leaseEpoch: Type.Optional(Type.Integer({ minimum: 1 })),
    /**
     * 맡긴 쪽 프레임의 leaseId(`handoff`, drive-isolation.md 2.1). 사용자 명령이나 프로필 시작으로 쌓인 프레임은 없다.
     * 선택이라 `version`을 올리지 않는다.
     */
    parent: Type.Optional(leaseId()),
    /**
     * 주도권 스택의 깊이. depth는 코어 위 첫 프레임이 0이고 옛 기록은 0으로 읽는다. 읽기 쪽 `DriveFrameView.depth`는 코어가 0이라 이 값에 1을 더한다.
     * 선택이라 `version`을 올리지 않는다(drive-isolation.md 2.6).
     */
    depth: Type.Optional(Type.Integer({ minimum: 0 })),
    /** 그 프레임을 낸 플러그인의 versionId(`sha256:<hex>` 또는 `draft:<draftId>:<해시 앞 8자>`). 지금 값이 없는 경로는 싣지 않는다 */
    contentHash: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    /**
     * 프레임을 연 명령의 입력(맡기기가 넘긴 `input`, 사용자 명령의 `input`). 재시작 뒤 맡은 프레임이 같은 입력으로 이어 가게 한다.
     * 직렬화 크기는 엔진이 `DRIVE_INPUT_MAX_BYTES`로 막는다(넘으면 부여하지 않고 거절한다). 선택이라 `version`을 올리지 않는다 [제안: 이름 `input`, AGE-26]
     */
    input: Type.Optional(JsonValueSchema),
    /** 이 부여를 낳은 시작 요청(`lease.requested`)의 id. 재시작 뒤 이미 부여된 요청을 다시 큐에 넣지 않는 근거다. 선택 [제안: 이름 `requestId`, AGE-26] */
    requestId: Type.Optional(Type.String({ minLength: 1, maxLength: 96 })),
  },
  { additionalProperties: false },
);
export type LeaseAcquiredPayload = Static<typeof LeaseAcquiredPayloadSchema>;

/**
 * disabled: 그룹 끄기, budget: 상한 도달, error: drive 함수 예외, idle: 효과 없는 반환 반복,
 * revoked: X의 중재로 회수, restart: 프로세스 재시작 뒤 정리,
 * done: 단계 함수가 `done` 명령으로 주도권을 내려놓음(M5a E1),
 * waiting: drive가 `ask` 명령으로 사람 확인을 기다리며 반납(X-17). 답이 오면 그 Registration이 다시 후보가 된다.
 */
export const LeaseReleasedPayloadSchema: TObject<{
  leaseId: TString;
  scopeId: TString;
  result: TOptional<TUnsafe<JsonValue>>;
  reason: TUnion<
    [
      TLiteral<"done">,
      TLiteral<"disabled">,
      TLiteral<"budget">,
      TLiteral<"error">,
      TLiteral<"idle">,
      TLiteral<"revoked">,
      TLiteral<"restart">,
      TLiteral<"waiting">,
    ]
  >;
}> = Type.Object(
  {
    leaseId: leaseId(),
    scopeId: scopeId(),
    /**
     * 사유 `done`일 때 단계 함수가 낸 결과. 맡긴 쪽이 재시작 직전에 끝난 맡기기의 결과를 받게 한다.
     * 선택이라 `version`을 올리지 않는다 [제안: 이름 `result`, AGE-26]
     */
    result: Type.Optional(JsonValueSchema),
    reason: Type.Union([
      Type.Literal("done"),
      Type.Literal("disabled"),
      Type.Literal("budget"),
      Type.Literal("error"),
      Type.Literal("idle"),
      Type.Literal("revoked"),
      Type.Literal("restart"),
      Type.Literal("waiting"),
    ]),
  },
  { additionalProperties: false },
);
export type LeaseReleasedPayload = Static<typeof LeaseReleasedPayloadSchema>;

/**
 * 주도 시작 요청 하나의 기록 [제안: 이름 `lease.requested`, AGE-26]. 사용자 명령(`user`)과 맡기기(`handoff`)가 큐에 들어갈 때 `queued`로,
 * 부여 없이 버려질 때 `dropped`로 남는다. 부여되면 `lease.acquired.requestId`가 이 요청을 가리킨다. 프로필 시작은 열 때 다시 만들어지므로 남기지 않는다.
 * 재시작 때 `queued`이고 `dropped`도 부여도 없는 요청을 큐에 되살린다. `parent`는 맡기기에서 맡긴 프레임의 leaseId다
 */
export const LeaseRequestedPayloadSchema: TObject<{
  requestId: TString;
  scopeId: TString;
  status: TUnion<[TLiteral<"queued">, TLiteral<"dropped">]>;
  trigger: TUnion<[TLiteral<"user">, TLiteral<"handoff">]>;
  parent: TOptional<TString>;
  input: TOptional<TUnsafe<JsonValue>>;
}> = Type.Object(
  {
    requestId: Type.String({ minLength: 1, maxLength: 96 }),
    scopeId: scopeId(),
    status: Type.Union([Type.Literal("queued"), Type.Literal("dropped")]),
    trigger: Type.Union([Type.Literal("user"), Type.Literal("handoff")]),
    parent: Type.Optional(leaseId()),
    /** `queued`에만 싣는다. 크기는 `DRIVE_INPUT_MAX_BYTES` 이내다 */
    input: Type.Optional(JsonValueSchema),
  },
  { additionalProperties: false },
);
export type LeaseRequestedPayload = Static<typeof LeaseRequestedPayloadSchema>;

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

/**
 * 주도 명령 하나의 결과를 남기는 상태 사건 [제안: 이름 `drive.command_settled`, C0에서 확정] [결정: 2026-11-17 사용자, U1].
 * 재시작 뒤 같은 명령을 두 번 실행하지 않는 근거다. `turn`, `ask`, `spawn`은 기존 사건과 함께, `model`·`tool`(E2)은 이 사건만으로 남는다. `commit`은 상태 커밋 사건이 그 기록이라 쓰지 않는다(두 번 쓰기 사이에서 죽으면 재시작이 명령을 다시 내지 않아 사건이 빠진다).
 * 임대 id는 싣지 않는다(재시작이나 재부여로 다른 임대가 같은 (scope, requestId)를 다시 기록해도 내용이 같아야 멱등이다). `requestId`는 엔진이 붙인 명령 요청 id, `outcome`은 결과 요약(`completed`, `answered`, `denied` 등), `ref`는 결과 참조(turn id, 자식 thread id 등)이다
 */
export const DriveCommandSettledPayloadSchema: TObject<{
  scopeId: TString;
  requestId: TString;
  command: TUnion<
    [TLiteral<"turn">, TLiteral<"model">, TLiteral<"tool">, TLiteral<"ask">, TLiteral<"spawn">]
  >;
  outcome: TString;
  ref: TOptional<TString>;
}> = Type.Object(
  {
    scopeId: scopeId(),
    requestId: Type.String({ minLength: 1, maxLength: 96 }),
    command: Type.Union([
      Type.Literal("turn"),
      Type.Literal("model"),
      Type.Literal("tool"),
      Type.Literal("ask"),
      Type.Literal("spawn"),
    ]),
    outcome: Type.String({ minLength: 1, maxLength: 48 }),
    ref: Type.Optional(Type.String({ minLength: 1, maxLength: 96 })),
  },
  { additionalProperties: false },
);
export type DriveCommandSettledPayload = Static<typeof DriveCommandSettledPayloadSchema>;

/** RegistrationApi.post 호출의 영수증. 큐 항목 사실은 같은 커밋의 input.queued가 적는다 */
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
