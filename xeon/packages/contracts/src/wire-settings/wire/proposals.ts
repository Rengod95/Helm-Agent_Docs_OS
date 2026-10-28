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
import { ThreadIdSchema } from "../../conversation/index.ts";

// 지식 제안 대기열 wire(M3-REQ-18, D-M3-32 a). 대기열은 둘이다: 학습 그룹의 `x_learning_proposals`(source "learning")와
// L2.knowledge의 쓰기 승인 대기열 `cap_knowledge_proposals`(source "knowledge"). 이 wire는 두 출처를 한 목록으로 조회하고 결정한다.
// 이름과 모양은 모두 [제안]이다(L3.learning.spec §3.8 `ProposalView`와 L2.knowledge.spec §3.5 `Proposal`의 공통 부분).

/** 대기열 출처. L4가 목록의 출처 열에 그대로 보인다 */
export const ProposalSourceSchema: TUnion<[TLiteral<"learning">, TLiteral<"knowledge">]> =
  Type.Union([Type.Literal("learning"), Type.Literal("knowledge")]);
export type ProposalSource = Static<typeof ProposalSourceSchema>;

export const PROPOSAL_SOURCES: readonly ProposalSource[] = ["learning", "knowledge"];

export const ProposalKindWireSchema: TUnion<
  [TLiteral<"skill">, TLiteral<"memory">, TLiteral<"feedback">, TLiteral<"script">]
> = Type.Union([
  Type.Literal("skill"),
  Type.Literal("memory"),
  Type.Literal("feedback"),
  Type.Literal("script"),
]);

/** 두 대기열의 상태 합집합. 학습: pending, approved, rejected, applied, reverted, expired. 지식: pending, applied, rejected, stale, expired */
export const ProposalStatusWireSchema: TUnion<
  [
    TLiteral<"pending">,
    TLiteral<"approved">,
    TLiteral<"applied">,
    TLiteral<"rejected">,
    TLiteral<"stale">,
    TLiteral<"expired">,
    TLiteral<"reverted">,
  ]
> = Type.Union([
  Type.Literal("pending"),
  Type.Literal("approved"),
  Type.Literal("applied"),
  Type.Literal("rejected"),
  Type.Literal("stale"),
  Type.Literal("expired"),
  Type.Literal("reverted"),
]);
export type ProposalStatusWire = Static<typeof ProposalStatusWireSchema>;

const ProposalEvidenceSchema: TObject<{ eventId: TString; threadId: typeof ThreadIdSchema }> =
  Type.Object(
    { eventId: Type.String({ minLength: 1, maxLength: 64 }), threadId: ThreadIdSchema },
    { additionalProperties: false },
  );

/** 목록의 한 행. 두 출처가 같은 모양이다. 출처에 없는 필드는 빈 값(null, false, 빈 배열)이다 */
export const ProposalRowSchema: TObject<{
  source: typeof ProposalSourceSchema;
  id: TString;
  kind: typeof ProposalKindWireSchema;
  op: TString;
  target: TString;
  status: typeof ProposalStatusWireSchema;
  destructive: TBoolean;
  diff: TString;
  rationale: TUnion<[TString, TNull]>;
  evidence: TArray<typeof ProposalEvidenceSchema>;
  conflictsWith: TUnion<[TString, TNull]>;
  reason: TUnion<[TString, TNull]>;
  revision: TInteger;
  scope: TUnion<[TUnion<[TLiteral<"user">, TLiteral<"project">]>, TNull]>;
  afterUntrusted: TBoolean;
  createdAt: TInteger;
}> = Type.Object(
  {
    source: ProposalSourceSchema,
    /** 출처 안에서 유일한 id. 결정 요청은 (source, id)로 대상을 고른다 */
    id: Type.String({ minLength: 1, maxLength: 128 }),
    kind: ProposalKindWireSchema,
    op: Type.String({ minLength: 1, maxLength: 32 }),
    target: Type.String({ minLength: 1, maxLength: 4096 }),
    status: ProposalStatusWireSchema,
    destructive: Type.Boolean(),
    /** 사람이 볼 diff(현재 내용 기준) */
    diff: Type.String({ maxLength: 200_000 }),
    rationale: Nullable(Type.String({ maxLength: 8000 })),
    /** 근거 이벤트. 학습 출처만 채운다 */
    evidence: Type.Array(ProposalEvidenceSchema, { maxItems: 64 }),
    conflictsWith: Nullable(Type.String({ maxLength: 4096 })),
    /** 거절·실패 사유 코드(출처가 정한 값) */
    reason: Nullable(Type.String({ maxLength: 64 })),
    /** 결정 때 맞춰 보내는 판. 지식 출처는 1 */
    revision: Type.Integer({ minimum: 1 }),
    /** 적용 범위. 스킬만 의미가 있고 그 밖은 null */
    scope: Nullable(Type.Union([Type.Literal("user"), Type.Literal("project")])),
    /** 신뢰할 수 없는 입력을 읽은 뒤 만든 후보. 화면이 경고를 보인다 */
    afterUntrusted: Type.Boolean(),
    createdAt: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type ProposalRow = Static<typeof ProposalRowSchema>;

/** `proposal.list` params. 생략한 필터는 걸지 않는다 */
export const ProposalListParamsSchema: TObject<{
  source: TOptional<typeof ProposalSourceSchema>;
  status: TOptional<TArray<typeof ProposalStatusWireSchema>>;
  limit: TOptional<TInteger>;
  cursor: TOptional<TString>;
}> = Type.Object(
  {
    source: Type.Optional(ProposalSourceSchema),
    status: Type.Optional(Type.Array(ProposalStatusWireSchema, { minItems: 1, maxItems: 7 })),
    /** 1~200, 기본 50 */
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    /** 불투명. 이전 결과의 `nextCursor` */
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  },
  { additionalProperties: false },
);
export type ProposalListParams = Static<typeof ProposalListParamsSchema>;

/**
 * 두 출처를 `createdAt` 내림차순, 같으면 `(source, id)` 오름차순으로 합친 목록.
 * 한 출처를 읽지 못하면(지식 저장소 없음 등) 그 출처만 `unavailable`에 올리고 나머지는 돌려준다
 */
export const ProposalListResultSchema: TObject<{
  proposals: TArray<typeof ProposalRowSchema>;
  nextCursor: TUnion<[TString, TNull]>;
  unavailable: TArray<typeof ProposalSourceSchema>;
}> = Type.Object(
  {
    proposals: Type.Array(ProposalRowSchema, { maxItems: 200 }),
    nextCursor: Nullable(Type.String({ minLength: 1, maxLength: 512 })),
    unavailable: Type.Array(ProposalSourceSchema, { maxItems: 2 }),
  },
  { additionalProperties: false },
);
export type ProposalListResult = Static<typeof ProposalListResultSchema>;

const ProposalTarget = {
  source: ProposalSourceSchema,
  id: Type.String({ minLength: 1, maxLength: 128 }),
};

/** `proposal.decide` params의 변형 하나. `decision`이 나머지 필드를 정한다 */
export const ProposalApproveParamsSchema: TObject<{
  source: typeof ProposalSourceSchema;
  id: TString;
  decision: TLiteral<"approve">;
  revision: TOptional<TInteger>;
  scope: TOptional<TUnion<[TLiteral<"user">, TLiteral<"project">]>>;
}> = Type.Object(
  {
    ...ProposalTarget,
    decision: Type.Literal("approve"),
    /** 학습 출처는 목록에서 본 판을 맞춰 보낸다. 없으면 현재 판으로 본다 */
    revision: Type.Optional(Type.Integer({ minimum: 1 })),
    /** 스킬 후보의 적용 범위(D-M3-09). 기본 user */
    scope: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("project")])),
  },
  { additionalProperties: false },
);
export const ProposalRejectParamsSchema: TObject<{
  source: typeof ProposalSourceSchema;
  id: TString;
  decision: TLiteral<"reject">;
  note: TOptional<TString>;
}> = Type.Object(
  {
    ...ProposalTarget,
    decision: Type.Literal("reject"),
    note: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);
/** 학습 출처만 받는다. 지식 출처에 보내면 `unsupported`다 */
export const ProposalEditParamsSchema: TObject<{
  source: typeof ProposalSourceSchema;
  id: TString;
  decision: TLiteral<"edit">;
  body: TString;
}> = Type.Object(
  {
    ...ProposalTarget,
    decision: Type.Literal("edit"),
    body: Type.String({ minLength: 1, maxLength: 200_000 }),
  },
  { additionalProperties: false },
);
/** 학습 출처만 받는다(원장 롤백). 지식 출처에 보내면 `unsupported`다 */
export const ProposalRevertParamsSchema: TObject<{
  source: typeof ProposalSourceSchema;
  id: TString;
  decision: TLiteral<"revert">;
}> = Type.Object(
  { ...ProposalTarget, decision: Type.Literal("revert") },
  { additionalProperties: false },
);

export const ProposalDecideParamsSchema: TUnion<
  [
    typeof ProposalApproveParamsSchema,
    typeof ProposalRejectParamsSchema,
    typeof ProposalEditParamsSchema,
    typeof ProposalRevertParamsSchema,
  ]
> = Type.Union([
  ProposalApproveParamsSchema,
  ProposalRejectParamsSchema,
  ProposalEditParamsSchema,
  ProposalRevertParamsSchema,
]);
export type ProposalDecideParams = Static<typeof ProposalDecideParamsSchema>;

/** 결정을 적용하지 못한 이유. 출처마다 다른 오류(`learning.*`, `proposal_closed`, `base_stale`)를 한 집합으로 옮긴다 */
export const PROPOSAL_DECIDE_FAILURES: readonly [
  "not_found",
  "revision_mismatch",
  "closed",
  "scope_not_allowed",
  "unsupported",
  "base_stale",
  "scan_failed",
  "approval_required",
  "unavailable",
] = [
  "not_found",
  "revision_mismatch",
  "closed",
  "scope_not_allowed",
  "unsupported",
  "base_stale",
  "scan_failed",
  "approval_required",
  "unavailable",
];

export const ProposalDecideResultSchema: TUnion<
  [
    TObject<{
      ok: TLiteral<true>;
      proposal: typeof ProposalRowSchema;
      applied: TBoolean;
    }>,
    TObject<{
      ok: TLiteral<false>;
      reason: TUnion<
        [
          TLiteral<"not_found">,
          TLiteral<"revision_mismatch">,
          TLiteral<"closed">,
          TLiteral<"scope_not_allowed">,
          TLiteral<"unsupported">,
          TLiteral<"base_stale">,
          TLiteral<"scan_failed">,
          TLiteral<"approval_required">,
          TLiteral<"unavailable">,
        ]
      >;
      detail: TOptional<TString>;
    }>,
  ]
> = Type.Union([
  Type.Object(
    { ok: Type.Literal(true), proposal: ProposalRowSchema, applied: Type.Boolean() },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ok: Type.Literal(false),
      reason: Type.Union([
        Type.Literal("not_found"),
        Type.Literal("revision_mismatch"),
        Type.Literal("closed"),
        Type.Literal("scope_not_allowed"),
        Type.Literal("unsupported"),
        Type.Literal("base_stale"),
        Type.Literal("scan_failed"),
        Type.Literal("approval_required"),
        Type.Literal("unavailable"),
      ]),
      detail: Type.Optional(Type.String({ maxLength: 512 })),
    },
    { additionalProperties: false },
  ),
]);
export type ProposalDecideResult = Static<typeof ProposalDecideResultSchema>;
