import { assertNever } from "@xeon/contracts";
import { toJsonSchema } from "@xeon/contracts/capabilities";
import type { JsonValue } from "@xeon/contracts/conversation";
import type {
  ExtensionManifest,
  RecordKind,
  RecordKindDecl,
  RecordSubject,
} from "@xeon/contracts/extensions";
import { Type } from "typebox";
import type { Proposal } from "./proposals/proposal.ts";
import type { ReviewOutcome } from "./proposals/reader.ts";

// L3.learning.spec §3.7.3 공개 레코드 8종(`grp.learning.*`)과 비공개 기록 kind. 레코드에는 본문을 싣지 않는다. 본문은 승인 뒤 L2-d에만 있다.

const Base = {
  proposalId: Type.String(),
  target: Type.String({ maxLength: 128 }),
  reviewId: Type.Union([Type.String({ maxLength: 64 }), Type.Null()]),
};

const SkillProposedV1 = Type.Object(
  {
    ...Base,
    op: Type.Union([
      Type.Literal("create"),
      Type.Literal("patch"),
      Type.Literal("add_file"),
      Type.Literal("archive"),
    ]),
    summary: Type.String({ maxLength: 200 }),
    conflictsWith: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);
const SkillApprovedV1 = Type.Object(
  { ...Base, revision: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
const SkillRejectedV1 = Type.Object(
  {
    ...Base,
    reason: Type.Union([
      Type.Literal("user_rejected"),
      Type.Literal("scan_failed"),
      Type.Literal("base_stale"),
      Type.Literal("op_not_allowed"),
      Type.Literal("ttl"),
    ]),
  },
  { additionalProperties: false },
);
const SkillAppliedV1 = Type.Object(
  { ...Base, ledgerId: Type.String(), skillName: Type.String({ maxLength: 128 }) },
  { additionalProperties: false },
);
const MemoryProposedV1 = Type.Object(
  {
    ...Base,
    op: Type.Union([Type.Literal("add"), Type.Literal("replace"), Type.Literal("remove")]),
    area: Type.Union([Type.Literal("user"), Type.Literal("environment")]),
    summary: Type.String({ maxLength: 200 }),
  },
  { additionalProperties: false },
);
const FeedbackProposedV1 = Type.Object(
  {
    ...Base,
    signal: Type.Union([
      Type.Literal("style_correction"),
      Type.Literal("workflow_correction"),
      Type.Literal("frustration"),
      Type.Literal("repeated_mistake"),
    ]),
    summary: Type.String({ maxLength: 200 }),
  },
  { additionalProperties: false },
);
const ReviewFinishedV1 = Type.Object(
  {
    reviewId: Type.String({ maxLength: 48 }),
    outcome: Type.Union([
      Type.Literal("completed"),
      Type.Literal("aborted"),
      Type.Literal("error"),
      Type.Literal("budget"),
    ]),
    proposalCount: Type.Integer({ minimum: 0 }),
    inputTokens: Type.Integer({ minimum: 0 }),
    outputTokens: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
/** 2차 */
const ScriptProposedV1 = Type.Object(
  {
    ...Base,
    form: Type.Union([Type.Literal("script"), Type.Literal("slash_command")]),
    occurrences: Type.Integer({ minimum: 1 }),
    summary: Type.String({ maxLength: 200 }),
  },
  { additionalProperties: false },
);

export const learningRecordKindDecls: readonly RecordKindDecl[] = [
  {
    kind: "grp.learning.skill.proposed",
    version: 1,
    description: "스킬 후보가 대기열에 들어감",
    payload: SkillProposedV1,
  },
  {
    kind: "grp.learning.skill.approved",
    version: 1,
    description: "사용자가 스킬 후보를 승인함",
    payload: SkillApprovedV1,
  },
  {
    kind: "grp.learning.skill.rejected",
    version: 1,
    description: "스킬 후보가 거절됨(사용자, 스캔, 만료)",
    payload: SkillRejectedV1,
  },
  {
    kind: "grp.learning.skill.applied",
    version: 1,
    description: "승인된 스킬 변경이 L2-d에 반영됨",
    payload: SkillAppliedV1,
  },
  {
    kind: "grp.learning.memory.proposed",
    version: 1,
    description: "메모리 후보가 대기열에 들어감",
    payload: MemoryProposedV1,
  },
  {
    kind: "grp.learning.feedback.proposed",
    version: 1,
    description: "작업 방식 피드백 후보가 대기열에 들어감",
    payload: FeedbackProposedV1,
  },
  {
    kind: "grp.learning.review.finished",
    version: 1,
    description: "검토 포크가 끝남",
    payload: ReviewFinishedV1,
  },
  {
    kind: "grp.learning.script.proposed",
    version: 1,
    description: "(2차) 반복 명령 묶음의 스크립트 후보",
    payload: ScriptProposedV1,
  },
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 매니페스트 `recordKinds`의 형태: payload는 JSON Schema 문서다(F.extensions.spec §3.1) */
export const learningManifestRecordKinds: NonNullable<ExtensionManifest["recordKinds"]> =
  learningRecordKindDecls.map((decl) => {
    const json = toJsonSchema(decl.payload);
    const payload: Record<string, unknown> = isPlainObject(json) ? json : {};
    return { kind: decl.kind, version: decl.version, description: decl.description, payload };
  });

export interface RecordDraft {
  readonly kind: RecordKind;
  readonly subject: RecordSubject;
  readonly payload: JsonValue;
}

function summaryOf(proposal: Proposal): string {
  return `${proposal.op} ${proposal.target}`.slice(0, 200);
}

/** 대기열에 들어간 후보를 알리는 공개 레코드. 후보 종류가 정한다. script는 2차라 만들지 않는다 */
export function proposedRecordOf(proposal: Proposal): RecordDraft | undefined {
  const subject: RecordSubject = { type: "thread", id: proposal.threadId };
  const common = {
    proposalId: proposal.id,
    target: proposal.target,
    reviewId: proposal.reviewId,
  };
  switch (proposal.kind) {
    case "skill":
      if (
        proposal.op === "create" ||
        proposal.op === "patch" ||
        proposal.op === "add_file" ||
        proposal.op === "archive"
      ) {
        return {
          kind: "grp.learning.skill.proposed",
          subject,
          payload: {
            ...common,
            op: proposal.op,
            summary: summaryOf(proposal),
            conflictsWith: proposal.conflictsWith,
          },
        };
      }
      return undefined;
    case "memory": {
      const area = proposal.target.startsWith("environment") ? "environment" : "user";
      if (proposal.op === "add" || proposal.op === "replace" || proposal.op === "remove") {
        return {
          kind: "grp.learning.memory.proposed",
          subject,
          payload: { ...common, op: proposal.op, area, summary: summaryOf(proposal) },
        };
      }
      return undefined;
    }
    case "feedback":
      return {
        kind: "grp.learning.feedback.proposed",
        subject,
        // 신호 종류는 검토 포크가 적지 않는다(제안 도구 입력에 없다). 좌절·교정 구분은 근거 문장이 담는다 [제안]
        payload: { ...common, signal: "workflow_correction", summary: summaryOf(proposal) },
      };
    case "script":
      return undefined;
    default:
      return assertNever(proposal.kind, "ProposalKind");
  }
}

export function reviewFinishedPayload(input: {
  readonly reviewId: string;
  readonly outcome: ReviewOutcome;
  readonly proposalCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}): JsonValue {
  return { ...input };
}

function skillBase(proposal: Proposal) {
  return { proposalId: proposal.id, target: proposal.target, reviewId: proposal.reviewId };
}

/** 스킬 후보의 승인·거절·적용을 알리는 공개 레코드. 다른 종류와 알릴 필요가 없는 사유(`apply_failed`)는 undefined */
export function skillDecisionRecordOf(
  proposal: Proposal,
  decision: "approved" | "rejected" | "applied",
): RecordDraft | undefined {
  if (proposal.kind !== "skill") return undefined;
  const subject: RecordSubject = { type: "thread", id: proposal.threadId };
  if (decision === "approved") {
    return {
      kind: "grp.learning.skill.approved",
      subject,
      payload: { ...skillBase(proposal), revision: proposal.revision },
    };
  }
  if (decision === "applied") {
    return {
      kind: "grp.learning.skill.applied",
      subject,
      payload: {
        ...skillBase(proposal),
        ledgerId: proposal.ledgerId ?? "",
        skillName: proposal.target.split("/")[0] ?? proposal.target,
      },
    };
  }
  const reason = proposal.reason;
  if (
    reason !== "user_rejected" &&
    reason !== "scan_failed" &&
    reason !== "base_stale" &&
    reason !== "op_not_allowed" &&
    reason !== "ttl"
  ) {
    return undefined;
  }
  return {
    kind: "grp.learning.skill.rejected",
    subject,
    payload: { ...skillBase(proposal), reason },
  };
}
