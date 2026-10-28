import {
  assertNever,
  parse,
  type ParseError,
  type Result,
  type SchemaProof,
} from "@xeon/contracts";
import { Type, type TUnsafe } from "typebox";

// L3.learning.spec §3.6, §3.8. 후보(Proposal)의 형식, 대기열 행의 검증, 화면용 보기.
// [제안] 후보에 본문 `body`와 부모 thread `threadId`, 스킬 설명 `description`을 더했다. 본문은 blob을 쓰지 않고 비공개 기록 `proposal.created`·`proposal.edited`의 payload에 실리고
// 투영이 행에 둔다. diff는 기록에 싣지 않고 투영기가 본문에서 만든다.

export type ProposalKind = "skill" | "memory" | "feedback" | "script";
/** 삭제 연산은 없다. 스킬은 archive만 둔다 */
export type ProposalOp = "create" | "patch" | "add_file" | "archive" | "add" | "replace" | "remove";
export type ProposalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "applied"
  | "reverted"
  | "expired";
export type ProposalReason =
  | "user_rejected"
  | "scan_failed"
  | "base_stale"
  | "op_not_allowed"
  | "apply_failed"
  | "ttl"
  | "rollback_refused";

/** 상태 값 전체. 명령 인자 검사에 쓴다 */
export const PROPOSAL_STATUS_VALUES: readonly ProposalStatus[] = [
  "pending",
  "approved",
  "rejected",
  "applied",
  "reverted",
  "expired",
];

export interface Proposal {
  readonly id: string;
  readonly kind: ProposalKind;
  readonly op: ProposalOp;
  readonly target: string;
  /** 표시용 diff. create·add는 빈 기준에 대한 diff다 */
  readonly diff: string;
  /** 적용 때 넘길 새 내용. 스캔에서 거절된 후보는 비워 둔다(본문을 남기지 않는다, §4.5 표) */
  readonly body: string;
  /** 스킬 create의 설명. 그 밖은 null */
  readonly description: string | null;
  readonly bodyHash: string;
  readonly baseHash: string | null;
  readonly rationale: string;
  readonly evidenceEventIds: readonly string[];
  /** 근거 이벤트가 있는 부모 thread */
  readonly threadId: string;
  readonly status: ProposalStatus;
  /** 만든 검토의 requestId(1~48자). 사용자 명령이나 주 대화에서 온 후보는 null */
  readonly reviewId: string | null;
  /** 기존 스킬과 겹치는 대상이 있으면 그 이름 */
  readonly conflictsWith: string | null;
  readonly destructive: boolean;
  /** 적용 범위. 스킬만 의미가 있다. 기본 user, 승인 때 사용자가 project로 바꿀 수 있다(§4.5 규칙 8) */
  readonly scope: "user" | "project";
  /** 신뢰할 수 없는 입력(웹, MCP 결과)을 읽은 뒤 만든 후보(§3.5) */
  readonly afterUntrusted: boolean;
  readonly reason: ProposalReason | null;
  /** 스캔 규칙 이름만 남긴다. 걸린 문자열은 남기지 않는다(§4.6 3) */
  readonly findings: readonly string[];
  /** 적용 뒤 L2-d 원장 항목 id */
  readonly ledgerId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly revision: number;
}

const shape = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 128 }),
    kind: Type.Union([
      Type.Literal("skill"),
      Type.Literal("memory"),
      Type.Literal("feedback"),
      Type.Literal("script"),
    ]),
    op: Type.Union([
      Type.Literal("create"),
      Type.Literal("patch"),
      Type.Literal("add_file"),
      Type.Literal("archive"),
      Type.Literal("add"),
      Type.Literal("replace"),
      Type.Literal("remove"),
    ]),
    target: Type.String({ minLength: 1, maxLength: 128 }),
    diff: Type.String({ maxLength: 200_000 }),
    body: Type.String({ maxLength: 100_000 }),
    description: Type.Union([Type.String({ maxLength: 1024 }), Type.Null()]),
    bodyHash: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    baseHash: Type.Union([Type.String({ pattern: "^[0-9a-f]{64}$" }), Type.Null()]),
    rationale: Type.String({ maxLength: 2000 }),
    evidenceEventIds: Type.Array(Type.String(), { maxItems: 32 }),
    threadId: Type.String({ minLength: 1, maxLength: 64 }),
    status: Type.Union([
      Type.Literal("pending"),
      Type.Literal("approved"),
      Type.Literal("rejected"),
      Type.Literal("applied"),
      Type.Literal("reverted"),
      Type.Literal("expired"),
    ]),
    reviewId: Type.Union([Type.String({ maxLength: 48 }), Type.Null()]),
    conflictsWith: Type.Union([Type.String(), Type.Null()]),
    destructive: Type.Boolean(),
    scope: Type.Union([Type.Literal("user"), Type.Literal("project")]),
    afterUntrusted: Type.Boolean(),
    reason: Type.Union([
      Type.Literal("user_rejected"),
      Type.Literal("scan_failed"),
      Type.Literal("base_stale"),
      Type.Literal("op_not_allowed"),
      Type.Literal("apply_failed"),
      Type.Literal("ttl"),
      Type.Literal("rollback_refused"),
      Type.Null(),
    ]),
    findings: Type.Array(Type.String({ maxLength: 64 }), { maxItems: 64 }),
    ledgerId: Type.Union([Type.String(), Type.Null()]),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
    revision: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

const ProposalSchema: TUnsafe<Proposal> = Type.Unsafe<Proposal>(
  shape satisfies SchemaProof<Proposal, typeof shape>,
);

/** 저장소 경계(SQLite 행, 메모리 복사)에서 읽은 값을 후보로 들인다 */
export function parseProposal(value: unknown): Result<Proposal, ParseError> {
  return parse(ProposalSchema, value);
}

/** 파괴적 연산: 기존 내용을 바꾸거나 없앤다(스킬 patch·archive, 메모리 replace·remove) */
export function isDestructiveOp(op: ProposalOp): boolean {
  return op === "patch" || op === "archive" || op === "replace" || op === "remove";
}

/** 연산과 종류의 조합(§3.6 ProposalOpSchema 주석). 허용하지 않는 조합은 `op_not_allowed`다 */
export function opAllowedFor(kind: ProposalKind, op: ProposalOp): boolean {
  switch (kind) {
    case "skill":
      return op === "create" || op === "patch" || op === "add_file" || op === "archive";
    case "memory":
      return op === "add" || op === "replace" || op === "remove";
    case "feedback":
      return op === "add";
    case "script":
      return op === "create";
    default:
      return assertNever(kind, "ProposalKind");
  }
}

/** 화면이 그리는 한 행(§3.8). 대기열 행과 같은 필드에서 만든다 */
export interface ProposalView {
  readonly id: string;
  readonly kind: ProposalKind;
  readonly op: ProposalOp;
  readonly target: string;
  readonly status: ProposalStatus;
  readonly destructive: boolean;
  readonly diff: string;
  readonly rationale: string;
  readonly evidence: readonly { readonly eventId: string; readonly threadId: string }[];
  readonly conflictsWith: string | null;
  readonly reason: ProposalReason | null;
  readonly revision: number;
  readonly scope: "user" | "project";
  readonly afterUntrusted: boolean;
  readonly createdAt: number;
  /** L4 통합 목록의 출처 열(REQ-LN-10). 이 그룹의 행은 항상 "learning" */
  readonly source: "learning";
}

export function proposalView(proposal: Proposal): ProposalView {
  return {
    id: proposal.id,
    kind: proposal.kind,
    op: proposal.op,
    target: proposal.target,
    status: proposal.status,
    destructive: proposal.destructive,
    diff: proposal.diff,
    rationale: proposal.rationale,
    evidence: proposal.evidenceEventIds.map((eventId) => ({
      eventId,
      threadId: proposal.threadId,
    })),
    conflictsWith: proposal.conflictsWith,
    reason: proposal.reason,
    revision: proposal.revision,
    scope: proposal.scope,
    afterUntrusted: proposal.afterUntrusted,
    createdAt: proposal.createdAt,
    source: "learning",
  };
}
