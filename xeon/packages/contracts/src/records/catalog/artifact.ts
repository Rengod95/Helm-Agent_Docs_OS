import { Type, type TUnsafe } from "typebox";
import { Nullable, type SchemaProof } from "../../base/index.ts";
import {
  CheckpointIdSchema,
  EventIdSchema,
  JsonValueSchema,
  ThreadIdSchema,
  TurnIdSchema,
  localIdPattern,
  type CheckpointId,
  type EventId,
  type JsonValue,
  type ThreadId,
  type TurnId,
} from "../../conversation/index.ts";
import { BlobRefSchema, type BlobRef } from "../blob.ts";
import type { CatalogEntry } from "./entry.ts";

// L2.artifacts.spec §3.6. 소유 생산자 cap.artifacts는 owners.ts가 정한다. 모두 내구, 버전 1이다.
// 정적 타입은 스키마에서 파생한다(Static). L2.artifacts.spec의 interface와 같은 모양이다.

const ArtifactIdShape = Type.String({ pattern: localIdPattern("art") });
const ReviewIdShape = Type.String({ pattern: localIdPattern("rvw") });
const CommentIdShape = Type.String({ pattern: localIdPattern("cmt") });
const HandoffIdShape = Type.String({ pattern: localIdPattern("hof") });
const HunkIdShape = Type.String({ minLength: 1, maxLength: 64 });
const ToolCallIds = Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 1024 });
const Round = Type.Integer({ minimum: 1 });
const DeliverWhen = Type.Union([
  Type.Literal("steer"),
  Type.Literal("followUp"),
  Type.Literal("next"),
]);

const registeredShape = Type.Object(
  {
    artifactId: ArtifactIdShape,
    /** ArtifactKind */
    kind: Type.String({ minLength: 1, maxLength: 64 }),
    title: Type.String({ maxLength: 200 }),
    version: Type.Literal(1),
    content: BlobRefSchema,
    sourcePath: Nullable(Type.String({ maxLength: 4096 })),
    /** ArtifactMeta. 16 KiB 이하 */
    meta: JsonValueSchema,
    turnId: Nullable(TurnIdSchema),
    toolCallId: Nullable(Type.String({ minLength: 1, maxLength: 256 })),
    /** ArtifactProducer */
    producer: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: false },
);
export type ArtifactRegisteredPayload = {
  artifactId: string;
  kind: string;
  title: string;
  version: 1;
  content: BlobRef;
  sourcePath: string | null;
  meta: JsonValue;
  turnId: TurnId | null;
  toolCallId: string | null;
  producer: string;
};
export const ArtifactRegisteredPayloadSchema: TUnsafe<ArtifactRegisteredPayload> =
  Type.Unsafe<ArtifactRegisteredPayload>(
    registeredShape satisfies SchemaProof<ArtifactRegisteredPayload, typeof registeredShape>,
  );

const updatedShape = Type.Object(
  {
    artifactId: ArtifactIdShape,
    /** baseVersion + 1 */
    version: Type.Integer({ minimum: 2 }),
    baseVersion: Type.Integer({ minimum: 1 }),
    title: Nullable(Type.String({ maxLength: 200 })),
    content: Nullable(BlobRefSchema),
    sourcePath: Nullable(Type.String({ maxLength: 4096 })),
    /** 바뀌지 않았으면 null. 주면 전체 교체 */
    meta: Nullable(JsonValueSchema),
  },
  { additionalProperties: false },
);
export type ArtifactUpdatedPayload = {
  artifactId: string;
  version: number;
  baseVersion: number;
  title: string | null;
  content: BlobRef | null;
  sourcePath: string | null;
  meta: JsonValue | null;
};
export const ArtifactUpdatedPayloadSchema: TUnsafe<ArtifactUpdatedPayload> =
  Type.Unsafe<ArtifactUpdatedPayload>(
    updatedShape satisfies SchemaProof<ArtifactUpdatedPayload, typeof updatedShape>,
  );

const archivedShape = Type.Object(
  {
    artifactId: ArtifactIdShape,
    reason: Type.Union([Type.Literal("user"), Type.Literal("retention"), Type.Literal("limit")]),
  },
  { additionalProperties: false },
);
export type ArtifactArchivedPayload = {
  artifactId: string;
  reason: "user" | "retention" | "limit";
};
export const ArtifactArchivedPayloadSchema: TUnsafe<ArtifactArchivedPayload> =
  Type.Unsafe<ArtifactArchivedPayload>(
    archivedShape satisfies SchemaProof<ArtifactArchivedPayload, typeof archivedShape>,
  );

const reviewBasisShape = Type.Union([
  Type.Object(
    { type: Type.Literal("turn"), turnId: TurnIdSchema, toolCallIds: ToolCallIds },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal("toolCalls"), toolCallIds: ToolCallIds },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("checkpoint"),
      checkpointId: CheckpointIdSchema,
      paths: Nullable(Type.Array(Type.String({ maxLength: 4096 }), { maxItems: 1024 })),
    },
    { additionalProperties: false },
  ),
  Type.Object({ type: Type.Literal("patch") }, { additionalProperties: false }),
]);
const reviewHunkShape = Type.Object(
  {
    hunkId: HunkIdShape,
    header: Type.String({ maxLength: 1024 }),
    oldStart: Type.Integer({ minimum: 0 }),
    oldLines: Type.Integer({ minimum: 0 }),
    newStart: Type.Integer({ minimum: 0 }),
    newLines: Type.Integer({ minimum: 0 }),
    patchSha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  },
  { additionalProperties: false },
);
const reviewFileShape = Type.Object(
  {
    fileIndex: Type.Integer({ minimum: 0 }),
    path: Type.String({ maxLength: 4096 }),
    oldPath: Nullable(Type.String({ maxLength: 4096 })),
    change: Type.String({ minLength: 1, maxLength: 32 }),
    binary: Type.Boolean(),
    hunks: Type.Array(reviewHunkShape, { maxItems: 4096 }),
  },
  { additionalProperties: false },
);
const reviewOpenedShape = Type.Object(
  {
    reviewId: ReviewIdShape,
    /** 같은 커밋의 artifact.registered(kind "changeset") */
    artifactId: ArtifactIdShape,
    title: Type.String({ maxLength: 200 }),
    /** 변경을 모은 근거. patch 원문은 담지 않는다(diff blob에 있다) */
    basis: reviewBasisShape,
    /** 정규화한 통합 diff blob. changeset 산출물 본문과 같은 blob */
    diff: BlobRefSchema,
    files: Type.Array(reviewFileShape, { maxItems: 1024 }),
    deliverAs: DeliverWhen,
    approvalId: Nullable(Type.String({ minLength: 1, maxLength: 128 })),
  },
  { additionalProperties: false },
);
export type ReviewOpenedPayload = {
  reviewId: string;
  artifactId: string;
  title: string;
  basis:
    | { type: "turn"; turnId: TurnId; toolCallIds: string[] }
    | { type: "toolCalls"; toolCallIds: string[] }
    | { type: "checkpoint"; checkpointId: CheckpointId; paths: string[] | null }
    | { type: "patch" };
  diff: BlobRef;
  files: {
    fileIndex: number;
    path: string;
    oldPath: string | null;
    change: string;
    binary: boolean;
    hunks: {
      hunkId: string;
      header: string;
      oldStart: number;
      oldLines: number;
      newStart: number;
      newLines: number;
      patchSha256: string;
    }[];
  }[];
  deliverAs: "steer" | "followUp" | "next";
  approvalId: string | null;
};
export const ReviewOpenedPayloadSchema: TUnsafe<ReviewOpenedPayload> =
  Type.Unsafe<ReviewOpenedPayload>(
    reviewOpenedShape satisfies SchemaProof<ReviewOpenedPayload, typeof reviewOpenedShape>,
  );

const reviewDecidedShape = Type.Object(
  {
    reviewId: ReviewIdShape,
    round: Round,
    decisions: Type.Array(
      Type.Object(
        {
          hunkId: HunkIdShape,
          decision: Type.Union([
            Type.Literal("pending"),
            Type.Literal("approved"),
            Type.Literal("rejected"),
          ]),
        },
        { additionalProperties: false },
      ),
      { maxItems: 4096 },
    ),
    by: Type.Union([
      Type.Literal("user"),
      Type.Literal("model"),
      Type.Literal("group"),
      Type.Literal("remote"),
    ]),
  },
  { additionalProperties: false },
);
export type ReviewDecidedPayload = {
  reviewId: string;
  round: number;
  decisions: { hunkId: string; decision: "pending" | "approved" | "rejected" }[];
  by: "user" | "model" | "group" | "remote";
};
export const ReviewDecidedPayloadSchema: TUnsafe<ReviewDecidedPayload> =
  Type.Unsafe<ReviewDecidedPayload>(
    reviewDecidedShape satisfies SchemaProof<ReviewDecidedPayload, typeof reviewDecidedShape>,
  );

const reviewCommentedShape = Type.Object(
  {
    reviewId: ReviewIdShape,
    round: Round,
    commentId: CommentIdShape,
    target: Type.Union([
      Type.Object(
        {
          type: Type.Literal("hunk"),
          hunkId: HunkIdShape,
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
        { type: Type.Literal("file"), path: Type.String({ maxLength: 4096 }) },
        { additionalProperties: false },
      ),
      Type.Object({ type: Type.Literal("review") }, { additionalProperties: false }),
    ]),
    body: Type.String({ maxLength: 8000 }),
    by: Type.Union([Type.Literal("user"), Type.Literal("group"), Type.Literal("remote")]),
  },
  { additionalProperties: false },
);
export type ReviewCommentedPayload = {
  reviewId: string;
  round: number;
  commentId: string;
  target:
    | { type: "hunk"; hunkId: string; line?: { side: "old" | "new"; number: number } }
    | { type: "file"; path: string }
    | { type: "review" };
  body: string;
  by: "user" | "group" | "remote";
};
export const ReviewCommentedPayloadSchema: TUnsafe<ReviewCommentedPayload> =
  Type.Unsafe<ReviewCommentedPayload>(
    reviewCommentedShape satisfies SchemaProof<ReviewCommentedPayload, typeof reviewCommentedShape>,
  );

const reviewAppliedShape = Type.Object(
  {
    reviewId: ReviewIdShape,
    round: Round,
    outcomes: Type.Array(
      Type.Object(
        {
          path: Type.String({ maxLength: 4096 }),
          hunkIds: Type.Array(HunkIdShape, { maxItems: 4096 }),
          result: Type.Union([
            Type.Literal("reverted"),
            Type.Literal("conflict"),
            Type.Literal("skipped"),
          ]),
          method: Type.Union([
            Type.Literal("workspace_files"),
            Type.Literal("checkpoint_restore"),
            Type.Literal("none"),
          ]),
          detail: Type.Optional(Type.String({ maxLength: 1000 })),
        },
        { additionalProperties: false },
      ),
      { maxItems: 1024 },
    ),
  },
  { additionalProperties: false },
);
export type ReviewAppliedPayload = {
  reviewId: string;
  round: number;
  outcomes: {
    path: string;
    hunkIds: string[];
    result: "reverted" | "conflict" | "skipped";
    method: "workspace_files" | "checkpoint_restore" | "none";
    detail?: string;
  }[];
};
export const ReviewAppliedPayloadSchema: TUnsafe<ReviewAppliedPayload> =
  Type.Unsafe<ReviewAppliedPayload>(
    reviewAppliedShape satisfies SchemaProof<ReviewAppliedPayload, typeof reviewAppliedShape>,
  );

const reviewSubmittedShape = Type.Object(
  {
    reviewId: ReviewIdShape,
    /** 확정한 라운드. 다음 라운드는 round + 1 */
    round: Round,
    /** 에이전트 입력 전달. 전달할 결정·코멘트가 없으면 null */
    delivery: Nullable(
      Type.Object(
        {
          requestId: Type.String({ minLength: 1, maxLength: 256 }),
          when: DeliverWhen,
          commentIds: Type.Array(CommentIdShape, { maxItems: 1024 }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type ReviewSubmittedPayload = {
  reviewId: string;
  round: number;
  delivery: {
    requestId: string;
    when: "steer" | "followUp" | "next";
    commentIds: string[];
  } | null;
};
export const ReviewSubmittedPayloadSchema: TUnsafe<ReviewSubmittedPayload> =
  Type.Unsafe<ReviewSubmittedPayload>(
    reviewSubmittedShape satisfies SchemaProof<ReviewSubmittedPayload, typeof reviewSubmittedShape>,
  );

const reviewClosedShape = Type.Object(
  {
    reviewId: ReviewIdShape,
    reason: Type.Union([Type.Literal("done"), Type.Literal("discarded")]),
  },
  { additionalProperties: false },
);
export type ReviewClosedPayload = { reviewId: string; reason: "done" | "discarded" };
export const ReviewClosedPayloadSchema: TUnsafe<ReviewClosedPayload> =
  Type.Unsafe<ReviewClosedPayload>(
    reviewClosedShape satisfies SchemaProof<ReviewClosedPayload, typeof reviewClosedShape>,
  );

const sessionLabeledShape = Type.Object(
  {
    /** 대상 세션은 envelope.threadId. 전체 목록(교체)이다 */
    labels: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 32 }),
  },
  { additionalProperties: false },
);
export type SessionLabeledPayload = { labels: string[] };
export const SessionLabeledPayloadSchema: TUnsafe<SessionLabeledPayload> =
  Type.Unsafe<SessionLabeledPayload>(
    sessionLabeledShape satisfies SchemaProof<SessionLabeledPayload, typeof sessionLabeledShape>,
  );

const handoffSentShape = Type.Object(
  { handoffId: HandoffIdShape, toThreadId: ThreadIdSchema, package: BlobRefSchema },
  { additionalProperties: false },
);
export type HandoffSentPayload = { handoffId: string; toThreadId: ThreadId; package: BlobRef };
export const HandoffSentPayloadSchema: TUnsafe<HandoffSentPayload> =
  Type.Unsafe<HandoffSentPayload>(
    handoffSentShape satisfies SchemaProof<HandoffSentPayload, typeof handoffSentShape>,
  );

const handoffReceivedShape = Type.Object(
  {
    handoffId: HandoffIdShape,
    fromThreadId: ThreadIdSchema,
    fromLeafEventId: EventIdSchema,
    package: BlobRefSchema,
  },
  { additionalProperties: false },
);
export type HandoffReceivedPayload = {
  handoffId: string;
  fromThreadId: ThreadId;
  fromLeafEventId: EventId;
  package: BlobRef;
};
export const HandoffReceivedPayloadSchema: TUnsafe<HandoffReceivedPayload> =
  Type.Unsafe<HandoffReceivedPayload>(
    handoffReceivedShape satisfies SchemaProof<HandoffReceivedPayload, typeof handoffReceivedShape>,
  );

/** 도메인 소유 카탈로그(F.records.spec §3.3.2). 모두 내구, 버전 1, 생산자 cap.artifacts */
export const ARTIFACT_EVENT_CATALOG: readonly CatalogEntry[] = [
  {
    kind: "artifact.registered",
    version: 1,
    durable: true,
    payload: ArtifactRegisteredPayloadSchema,
  },
  { kind: "artifact.updated", version: 1, durable: true, payload: ArtifactUpdatedPayloadSchema },
  { kind: "artifact.archived", version: 1, durable: true, payload: ArtifactArchivedPayloadSchema },
  { kind: "artifact.review_opened", version: 1, durable: true, payload: ReviewOpenedPayloadSchema },
  {
    kind: "artifact.review_decided",
    version: 1,
    durable: true,
    payload: ReviewDecidedPayloadSchema,
  },
  {
    kind: "artifact.review_commented",
    version: 1,
    durable: true,
    payload: ReviewCommentedPayloadSchema,
  },
  {
    kind: "artifact.review_applied",
    version: 1,
    durable: true,
    payload: ReviewAppliedPayloadSchema,
  },
  {
    kind: "artifact.review_submitted",
    version: 1,
    durable: true,
    payload: ReviewSubmittedPayloadSchema,
  },
  { kind: "artifact.review_closed", version: 1, durable: true, payload: ReviewClosedPayloadSchema },
  {
    kind: "artifact.session_labeled",
    version: 1,
    durable: true,
    payload: SessionLabeledPayloadSchema,
  },
  { kind: "artifact.handoff_sent", version: 1, durable: true, payload: HandoffSentPayloadSchema },
  {
    kind: "artifact.handoff_received",
    version: 1,
    durable: true,
    payload: HandoffReceivedPayloadSchema,
  },
];
