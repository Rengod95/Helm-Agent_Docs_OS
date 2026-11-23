import { assertNever } from "../../base/index.ts";
import type { Proposal, ProposalStatus } from "../../capabilities/index.ts";
import type { ProposalRow, ProposalStatusWire } from "./proposals.ts";

// 지식 대기열(L2.knowledge `knowledge.ledger`)의 제안을 승인 화면의 합친 목록 행(`ProposalRow`)으로 옮기는 규칙(M3-REQ-91, D-M3-32 a).
// 호스트의 대기열 어댑터(cap-knowledge `createKnowledgeProposalWire`)와 제안 플러그인(plugin-suggest)이 같은 규칙을 쓰도록 F에 둔다.
// 모두 순수 함수다. 읽기와 결정은 부르는 쪽이 한다.

const KNOWLEDGE_STATUSES: readonly ProposalStatus[] = [
  "pending",
  "applied",
  "rejected",
  "stale",
  "expired",
];

function knowledgeStatusOf(status: ProposalStatusWire): ProposalStatus | undefined {
  return KNOWLEDGE_STATUSES.find((known) => known === status);
}

/**
 * 상태 필터를 지식 대기열의 상태로 좁힌다. 필터가 없거나 비었으면 빈 배열(거르지 않는다), 지식 상태가 하나도 없으면 undefined(빈 목록)이다.
 * 합친 wire 상태 일곱 가운데 `approved`와 `reverted`는 학습 대기열만 쓴다
 */
export function knowledgeStatusesOf(
  wire: readonly ProposalStatusWire[] | undefined,
): readonly ProposalStatus[] | undefined {
  if (wire === undefined || wire.length === 0) return [];
  const known = wire.flatMap((status) => {
    const mapped = knowledgeStatusOf(status);
    return mapped === undefined ? [] : [mapped];
  });
  return known.length === 0 ? undefined : known;
}

function reasonOf(status: ProposalStatus): string | null {
  switch (status) {
    case "stale":
      return "base_stale";
    case "expired":
      return "expired";
    case "pending":
    case "applied":
    case "rejected":
      return null;
    default:
      return assertNever(status, "ProposalStatus");
  }
}

/**
 * 지식 대기열의 제안 하나를 합친 목록의 행으로 옮긴다. `destructive`는 기준 해시를 요구하는 연산(기존 내용을 바꾸거나 지움)과
 * 롤백이다(L2.knowledge.spec §4.4.2). 학습 대기열에만 있는 필드(근거 이벤트, 유사 스킬, 사유 설명, 거절 메모, 만료 시각)는 빈 값이다.
 */
export function proposalRowOf(proposal: Proposal): ProposalRow {
  const { target } = proposal;
  return {
    source: "knowledge",
    id: proposal.proposalId,
    kind: target.kind,
    op: proposal.op,
    target: `${target.kind}:${target.name}`,
    status: proposal.status,
    destructive: proposal.baseHash !== null || proposal.op === "rollback",
    diff: proposal.preview,
    rationale: null,
    evidence: [],
    conflictsWith: null,
    reason: reasonOf(proposal.status),
    note: null,
    revision: 1,
    scope: target.kind === "skill" ? (target.scope ?? "user") : null,
    afterUntrusted: proposal.afterUntrusted === true,
    createdAt: proposal.createdAt,
    expiresAt: null,
  };
}
