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
import {
  CheckpointIdSchema,
  ThreadIdSchema,
  TurnIdSchema,
  localIdPattern,
} from "../../conversation/index.ts";
import type { CapabilityApi, CapabilityDef } from "../capability.ts";
import type { MethodDef } from "../method.ts";
import { defineCapability } from "../capability.ts";
import { serviceKey, type ServiceKey } from "../service-key.ts";
import type { ToolSpec } from "../tool-spec.ts";

// L2.artifacts.spec §3.1(§3.3이 쓰는 부분)과 §3.3. 정의 파일은 이 파일 하나다.
// artifacts.registry(§3.2)와 artifacts.sessions(§3.4)는 뒤 커밋에서 더한다.
// records/는 import하지 않는다(F.readme §3 같은 순서). HunkDecision·코멘트 대상 모양은
// records/catalog/approval.ts와 같게 적고, 두 모양이 같은지는 test/capabilities/artifacts-defs.test.ts가 확인한다.

// ── 공통 스키마 (§3.1) ─────────────────────────────────────────────────

/** 지역 ID. 접두 art·rvw·cmt는 F.conversation.spec §3.2.1 LocalIdPrefix 표다 */
export const ArtifactIdSchema: TString = Type.String({ pattern: localIdPattern("art") });
export const ReviewIdSchema: TString = Type.String({ pattern: localIdPattern("rvw") });
export const CommentIdSchema: TString = Type.String({ pattern: localIdPattern("cmt") });

/** 리뷰 안에서만 유일하다. f<파일 순번>h<hunk 순번>. 정규화한 diff에서 결정적으로 만든다(§4.2.2) */
export const HunkIdSchema: TString = Type.String({ pattern: "^f[0-9]{1,4}h[0-9]{1,4}$" });

/** 도구 호출 ID. 형식은 F.conversation.spec이 정하고 여기서는 길이만 제한한다 */
export const ToolCallIdSchema: TString = Type.String({ minLength: 1, maxLength: 128 });

/** F.extensions.spec PostWhen과 같은 값 집합 */
export const PostWhenSchema: TUnion<[TLiteral<"steer">, TLiteral<"followUp">, TLiteral<"next">]> =
  Type.Union([Type.Literal("steer"), Type.Literal("followUp"), Type.Literal("next")]);

// ── artifacts.reviews (§3.3) ───────────────────────────────────────────

/**
 * 리뷰할 변경을 어디서 모을지.
 * checkpoint 원본은 M3b에서 지원하지 않는다[미결 §10 11]. open은 source_unsupported를 돌려준다.
 */
export const ChangeSourceSchema: TUnion<
  [
    TObject<{ type: TLiteral<"turn">; turnId: TOptional<typeof TurnIdSchema> }>,
    TObject<{ type: TLiteral<"toolCalls">; toolCallIds: TArray<typeof ToolCallIdSchema> }>,
    TObject<{
      type: TLiteral<"checkpoint">;
      checkpointId: typeof CheckpointIdSchema;
      paths: TOptional<TArray<TString>>;
    }>,
    TObject<{ type: TLiteral<"patch">; patch: TString }>,
  ]
> = Type.Union([
  /** 한 턴의 workspace 쓰기 도구 결과 details.diff 전부. turnId 생략 시 CallContext.turnId */
  Type.Object({ type: Type.Literal("turn"), turnId: Type.Optional(TurnIdSchema) }),
  /** 지정한 도구 호출들의 결과 details.diff */
  Type.Object({
    type: Type.Literal("toolCalls"),
    toolCallIds: Type.Array(ToolCallIdSchema, { minItems: 1, maxItems: 64 }),
  }),
  /** L1 체크포인트의 파일 상태와 현재 파일의 차이. M3b에서는 source_unsupported로 거부된다 */
  Type.Object({
    type: Type.Literal("checkpoint"),
    checkpointId: CheckpointIdSchema,
    paths: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { minItems: 1, maxItems: 256 }),
    ),
  }),
  /** 호출자가 준 통합 diff */
  Type.Object({
    type: Type.Literal("patch"),
    patch: Type.String({ minLength: 1, maxLength: 4_194_304 }),
  }),
]);

/**
 * 결정 값. records/catalog/approval.ts의 HunkDecision과 같은 모양이다(§3.3 HunkDecisionSchema).
 */
export const HunkDecisionSchema: TUnion<
  [TLiteral<"pending">, TLiteral<"approved">, TLiteral<"rejected">]
> = Type.Union([Type.Literal("pending"), Type.Literal("approved"), Type.Literal("rejected")]);

export const HunkAppliedSchema: TUnion<
  [TLiteral<"none">, TLiteral<"reverted">, TLiteral<"conflict">]
> = Type.Union([Type.Literal("none"), Type.Literal("reverted"), Type.Literal("conflict")]);

export const HunkViewSchema: TObject<{
  hunkId: typeof HunkIdSchema;
  header: TString;
  oldStart: TInteger;
  oldLines: TInteger;
  newStart: TInteger;
  newLines: TInteger;
  decision: typeof HunkDecisionSchema;
  applied: typeof HunkAppliedSchema;
  commentCount: TInteger;
}> = Type.Object({
  hunkId: HunkIdSchema,
  header: Type.String({ maxLength: 512 }), // "@@ -12,5 +12,7 @@ function foo"
  oldStart: Type.Integer({ minimum: 0 }),
  oldLines: Type.Integer({ minimum: 0 }),
  newStart: Type.Integer({ minimum: 0 }),
  newLines: Type.Integer({ minimum: 0 }),
  decision: HunkDecisionSchema,
  applied: HunkAppliedSchema,
  commentCount: Type.Integer({ minimum: 0 }),
});
export type HunkView = Static<typeof HunkViewSchema>;

export const ReviewFileViewSchema: TObject<{
  fileIndex: TInteger;
  path: TString;
  oldPath: TUnion<[TString, TNull]>;
  change: TUnion<
    [TLiteral<"added">, TLiteral<"modified">, TLiteral<"deleted">, TLiteral<"renamed">]
  >;
  binary: TBoolean;
  hunks: TArray<typeof HunkViewSchema>;
}> = Type.Object({
  fileIndex: Type.Integer({ minimum: 0 }),
  path: Type.String(),
  oldPath: Type.Union([Type.String(), Type.Null()]),
  change: Type.Union([
    Type.Literal("added"),
    Type.Literal("modified"),
    Type.Literal("deleted"),
    Type.Literal("renamed"),
  ]),
  /** 이진 파일은 hunk가 없고 파일 단위로만 결정한다(§4.2.2) */
  binary: Type.Boolean(),
  hunks: Type.Array(HunkViewSchema),
});

/**
 * 코멘트 대상. records/catalog/approval.ts의 ReviewCommentTarget과 같은 모양이다(§3.3 CommentTargetSchema).
 */
export const CommentTargetSchema: TUnion<
  [
    TObject<{
      type: TLiteral<"hunk">;
      hunkId: typeof HunkIdSchema;
      line: TOptional<
        TObject<{ side: TUnion<[TLiteral<"old">, TLiteral<"new">]>; number: TInteger }>
      >;
    }>,
    TObject<{ type: TLiteral<"file">; path: TString }>,
    TObject<{ type: TLiteral<"review"> }>,
  ]
> = Type.Union([
  Type.Object(
    {
      type: Type.Literal("hunk"),
      hunkId: HunkIdSchema,
      line: Type.Optional(
        Type.Object(
          {
            side: Type.Union([Type.Literal("old"), Type.Literal("new")]),
            number: Type.Integer({ minimum: 1 }),
          },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal("file"), path: Type.String({ minLength: 1, maxLength: 4096 }) },
    { additionalProperties: false },
  ),
  Type.Object({ type: Type.Literal("review") }, { additionalProperties: false }),
]);

export const CommentViewSchema: TObject<{
  commentId: TString;
  target: typeof CommentTargetSchema;
  body: TString;
  round: TInteger;
  deliveredRound: TUnion<[TInteger, TNull]>;
}> = Type.Object({
  commentId: CommentIdSchema,
  target: CommentTargetSchema,
  body: Type.String({ minLength: 1, maxLength: 8000 }),
  round: Type.Integer({ minimum: 1 }),
  /** 에이전트 입력으로 전달된 라운드. 아직이면 null */
  deliveredRound: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
});
export type CommentView = Static<typeof CommentViewSchema>;

export const ReviewStatusSchema: TUnion<
  [TLiteral<"open">, TLiteral<"submitted">, TLiteral<"closed">]
> = Type.Union([Type.Literal("open"), Type.Literal("submitted"), Type.Literal("closed")]);

export const ReviewViewSchema: TObject<{
  reviewId: TString;
  threadId: typeof ThreadIdSchema;
  artifactId: TString;
  title: TString;
  status: typeof ReviewStatusSchema;
  round: TInteger;
  files: TArray<typeof ReviewFileViewSchema>;
  comments: TArray<typeof CommentViewSchema>;
}> = Type.Object({
  reviewId: ReviewIdSchema,
  threadId: ThreadIdSchema,
  /** 변경 묶음을 담은 changeset 산출물 */
  artifactId: ArtifactIdSchema,
  title: Type.String({ maxLength: 200 }),
  status: ReviewStatusSchema,
  /** 현재 라운드. 열 때 1, 제출할 때마다 1 증가 */
  round: Type.Integer({ minimum: 1 }),
  files: Type.Array(ReviewFileViewSchema),
  comments: Type.Array(CommentViewSchema),
});
export type ReviewView = Static<typeof ReviewViewSchema>;

export const ApplyOutcomeSchema: TObject<{
  path: TString;
  hunkIds: TArray<typeof HunkIdSchema>;
  result: TUnion<[TLiteral<"reverted">, TLiteral<"conflict">, TLiteral<"skipped">]>;
  method: TUnion<[TLiteral<"workspace_files">, TLiteral<"checkpoint_restore">, TLiteral<"none">]>;
  detail: TOptional<TString>;
}> = Type.Object({
  path: Type.String(),
  hunkIds: Type.Array(HunkIdSchema),
  result: Type.Union([Type.Literal("reverted"), Type.Literal("conflict"), Type.Literal("skipped")]),
  /** 되돌림에 쓴 경로. §4.2.5 [미결]의 후보 이름 */
  method: Type.Union([
    Type.Literal("workspace_files"),
    Type.Literal("checkpoint_restore"),
    Type.Literal("none"),
  ]),
  detail: Type.Optional(Type.String({ maxLength: 500 })),
});
export type ApplyOutcome = Static<typeof ApplyOutcomeSchema>;

const HunkSelectionSchema: TUnion<[TArray<typeof HunkIdSchema>, TLiteral<"all">]> = Type.Union([
  Type.Array(HunkIdSchema, { minItems: 1, maxItems: 4096 }),
  Type.Literal("all"),
]);

// 메서드 입력·출력. 같은 모양은 한 번만 적는다.

const OpenInput: TObject<{
  threadId: TOptional<typeof ThreadIdSchema>;
  title: TOptional<TString>;
  changes: typeof ChangeSourceSchema;
  deliverAs: TOptional<typeof PostWhenSchema>;
  requestApproval: TOptional<TBoolean>;
}> = Type.Object({
  threadId: Type.Optional(ThreadIdSchema),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  changes: ChangeSourceSchema,
  /** 제출 시 코멘트를 넣을 전달 모드. 생략하면 l2.artifacts.reviews.deliverAs */
  deliverAs: Type.Optional(PostWhenSchema),
  /** 거짓이면 승인 요청을 내지 않는다(그룹 코드가 직접 결정할 때). 기본 참 */
  requestApproval: Type.Optional(Type.Boolean()),
});

const ReviewOnlyInput: TObject<{ reviewId: TString }> = Type.Object({ reviewId: ReviewIdSchema });

const HunksInput: TObject<{ reviewId: TString; hunks: typeof HunkSelectionSchema }> = Type.Object({
  reviewId: ReviewIdSchema,
  hunks: HunkSelectionSchema,
});

const CommentInput: TObject<{
  reviewId: TString;
  target: typeof CommentTargetSchema;
  body: TString;
}> = Type.Object({
  reviewId: ReviewIdSchema,
  target: CommentTargetSchema,
  body: Type.String({ minLength: 1, maxLength: 8000 }),
});

const SubmitInput: TObject<{
  reviewId: TString;
  deliverAs: TOptional<typeof PostWhenSchema>;
  approveRemaining: TOptional<TBoolean>;
}> = Type.Object({
  reviewId: ReviewIdSchema,
  deliverAs: Type.Optional(PostWhenSchema),
  /** 참이면 남은 pending hunk를 승인으로 본다. 기본 거짓 */
  approveRemaining: Type.Optional(Type.Boolean()),
});

const DeliveryReceipt: TObject<{
  requestId: TString;
  when: typeof PostWhenSchema;
  duplicate: TBoolean;
}> = Type.Object({
  requestId: Type.String(),
  when: PostWhenSchema,
  duplicate: Type.Boolean(),
});

const SubmitOutput: TObject<{
  review: typeof ReviewViewSchema;
  applied: TArray<typeof ApplyOutcomeSchema>;
  delivery: TUnion<[typeof DeliveryReceipt, TNull]>;
}> = Type.Object({
  review: ReviewViewSchema,
  applied: Type.Array(ApplyOutcomeSchema),
  delivery: Type.Union([DeliveryReceipt, Type.Null()]),
});

const CloseInput: TObject<{
  reviewId: TString;
  reason: TUnion<[TLiteral<"done">, TLiteral<"discarded">]>;
}> = Type.Object({
  reviewId: ReviewIdSchema,
  reason: Type.Union([Type.Literal("done"), Type.Literal("discarded")]),
});

/** review_request 도구의 파라미터. 모델에게는 changes를 노출하지 않는다 */
const ReviewRequestParams: TObject<{
  toolCallIds: TOptional<TArray<typeof ToolCallIdSchema>>;
  title: TOptional<TString>;
}> = Type.Object({
  toolCallIds: Type.Optional(Type.Array(ToolCallIdSchema, { minItems: 1, maxItems: 64 })),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
});

type ReviewsMethods = {
  readonly open: MethodDef<typeof OpenInput, typeof ReviewViewSchema>;
  readonly get: MethodDef<typeof ReviewOnlyInput, typeof ReviewViewSchema>;
  readonly approve: MethodDef<typeof HunksInput, typeof ReviewViewSchema>;
  readonly reject: MethodDef<typeof HunksInput, typeof ReviewViewSchema>;
  readonly comment: MethodDef<typeof CommentInput, typeof CommentViewSchema>;
  readonly submit: MethodDef<typeof SubmitInput, typeof SubmitOutput>;
  readonly close: MethodDef<typeof CloseInput, typeof ReviewViewSchema>;
};

/**
 * 변경 묶음 리뷰. 호출 중복은 CallOptions.requestId로 막는다(idempotent). 입력에 requestId 필드를 두지 않는다.
 * get은 읽기 전용이다.
 */
export const ArtifactsReviews: CapabilityDef<
  ReviewsMethods,
  readonly [ToolSpec<"open", typeof ReviewRequestParams, ReviewsMethods["open"]>]
> = defineCapability({
  id: "artifacts.reviews",
  version: "1.0.0",
  description: "파일 변경을 hunk 단위로 승인·거절하고 코멘트를 에이전트 입력으로 되돌린다.",
  service: {
    methods: {
      open: {
        description:
          "변경을 모아 리뷰를 연다. changeset 산출물을 함께 등록하고 사용자 승인 요청을 낸다.",
        input: OpenInput,
        output: ReviewViewSchema,
        replay: "safe",
        idempotent: true,
        errors: {
          no_changes: { description: "모은 변경이 없음", retryable: false },
          source_unsupported: {
            description: "이 버전이 지원하지 않는 변경 원본(checkpoint, M3b)",
            retryable: false,
          },
          diff_unparsable: {
            description: "diff를 통합 diff로 해석할 수 없음",
            retryable: false,
            detail: Type.Object({ source: Type.String(), line: Type.Integer({ minimum: 0 }) }),
          },
          review_too_large: { description: "파일 수나 hunk 수가 상한을 넘음", retryable: false },
        },
      },
      get: {
        description: "리뷰 상태를 돌려준다.",
        input: ReviewOnlyInput,
        output: ReviewViewSchema,
        replay: "safe",
        readOnly: true,
      },
      approve: {
        description: "hunk를 승인으로 표시한다.",
        input: HunksInput,
        output: ReviewViewSchema,
        replay: "safe",
        idempotent: true,
        errors: {
          review_closed: { description: "닫힌 리뷰", retryable: false },
          hunk_unknown: { description: "리뷰에 없는 hunkId", retryable: false },
        },
      },
      reject: {
        description: "hunk를 거절로 표시한다. 되돌림은 submit에서 적용한다.",
        input: HunksInput,
        output: ReviewViewSchema,
        replay: "safe",
        idempotent: true,
        errors: {
          review_closed: { description: "닫힌 리뷰", retryable: false },
          hunk_unknown: { description: "리뷰에 없는 hunkId", retryable: false },
        },
      },
      comment: {
        description: "hunk의 줄, 파일, 리뷰 전체에 코멘트를 단다.",
        input: CommentInput,
        output: CommentViewSchema,
        replay: "safe",
        idempotent: true,
        errors: {
          review_closed: { description: "닫힌 리뷰", retryable: false },
          hunk_unknown: { description: "리뷰에 없는 hunkId", retryable: false },
          line_out_of_range: { description: "줄 번호가 hunk 범위 밖", retryable: false },
        },
      },
      submit: {
        description:
          "현재 라운드를 확정한다. 거절 hunk를 되돌리고 결정·코멘트를 에이전트 입력으로 넣는다.",
        input: SubmitInput,
        output: SubmitOutput,
        replay: "safe",
        idempotent: true,
        errors: {
          review_closed: { description: "닫힌 리뷰", retryable: false },
          decisions_pending: {
            description: "pending hunk가 남았고 approveRemaining이 거짓",
            retryable: false,
          },
          revert_unavailable: {
            description: "거절 적용 경로(§4.2.5)를 쓸 수 없음",
            retryable: true,
          },
        },
      },
      close: {
        description: "리뷰를 닫는다. 이후 결정·코멘트를 받지 않는다.",
        input: CloseInput,
        output: ReviewViewSchema,
        replay: "safe",
        idempotent: true,
      },
    },
  },
  tools: [
    {
      // [제안] 모델이 사용자 리뷰를 요청하는 도구. 기본 노출 여부는 l2.artifacts.tools.reviewRequest
      name: "review_request",
      label: "변경 리뷰 요청",
      description:
        "이번 턴(또는 지정한 도구 호출)에서 바꾼 파일을 사용자 리뷰에 올린다. 결과를 기다리지 않는다. " +
        "사용자의 결정과 코멘트는 나중에 사용자 입력으로 들어온다.",
      method: "open",
      parameters: ReviewRequestParams,
      toInput: (p) => ({
        changes:
          p.toolCallIds === undefined
            ? { type: "turn" }
            : { type: "toolCalls", toolCallIds: p.toolCallIds },
        ...(p.title === undefined ? {} : { title: p.title }),
      }),
      outputSchema: ReviewViewSchema,
      toContent: (out) => ({
        content: [
          {
            type: "text",
            text:
              `review ${out.reviewId} opened: ${out.files.length} files, ` +
              `${out.files.reduce((n, f) => n + f.hunks.length, 0)} hunks. Decisions arrive as later user input.`,
          },
        ],
        structuredContent: out,
      }),
      replay: "safe",
      executionMode: "sequential",
      hints: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    },
  ],
});
export const ArtifactsReviewsKey: ServiceKey<CapabilityApi<typeof ArtifactsReviews>> =
  serviceKey(ArtifactsReviews);
