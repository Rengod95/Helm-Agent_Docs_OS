import { assertNever, attemptAsync } from "@xeon/contracts";
import {
  CapabilityError,
  type CallOptions,
  type CapabilityApi,
  type KnowledgeLedger,
  type Proposal,
  type ProposalStatus,
} from "@xeon/contracts/capabilities";
import type {
  ProposalDecideParams,
  ProposalDecideResult,
  ProposalRow,
  ProposalStatusWire,
} from "@xeon/contracts/wire";

// M3-REQ-91(D-M3-32 a): 승인 화면은 대기열 둘을 한 목록으로 합친다. 이 파일은 L2.knowledge 쪽 절반이다. 지식 대기열의 `Proposal`을
// 합친 목록의 행(`ProposalRow`)으로 옮기고, `ledger.decide`의 오류를 결정 실패 이유로 옮긴다. 호스트의 `proposal.list`·
// `proposal.decide` 처리기가 부른다(처리기는 이 패키지의 몫이 아니다).

type LedgerApi = CapabilityApi<typeof KnowledgeLedger>;

/** 지식 대기열이 가진 상태. 합친 wire 상태 일곱 가운데 `approved`와 `reverted`는 학습 대기열만 쓴다 */
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

/** 상태 필터를 지식 대기열의 상태로 좁힌다. 지식 상태가 하나도 없으면 undefined(빈 목록) */
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
 * 롤백이다(L2.knowledge.spec §4.4.2). 학습 대기열에만 있는 필드(근거 이벤트, 유사 스킬, 사유 설명)는 빈 값이다.
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
    revision: 1,
    scope: target.kind === "skill" ? (target.scope ?? "user") : null,
    afterUntrusted: proposal.afterUntrusted === true,
    createdAt: proposal.createdAt,
  };
}

type DecideFailure = Extract<ProposalDecideResult, { ok: false }>;

type DecideReason = DecideFailure["reason"];

/**
 * 능력 오류 코드 → 결정 실패 이유. 표에 없는 코드는 `unavailable`이다. wire의 이유 집합(`PROPOSAL_DECIDE_FAILURES`)에
 * `name_conflict`·`patch_mismatch`·`rollback_conflict`를 따로 둘 자리가 없어 모두 `base_stale`로 옮긴다(대상이 제안 뒤에 바뀜).
 * 구별은 `detail` 문장에 남는다 [제안]
 */
const DECIDE_REASONS: ReadonlyMap<string, DecideReason> = new Map<string, DecideReason>([
  ["not_found", "not_found"],
  ["proposal_closed", "closed"],
  ["base_stale", "base_stale"],
  ["name_conflict", "base_stale"],
  ["patch_mismatch", "base_stale"],
  ["rollback_conflict", "base_stale"],
  ["scan_blocked", "scan_failed"],
  ["denied", "approval_required"],
  ["approval_denied", "approval_required"],
  ["unsupported", "unsupported"],
]);

function hasScopeReason(detail: unknown): boolean {
  return (
    typeof detail === "object" &&
    detail !== null &&
    "reason" in detail &&
    detail["reason"] === "scope_not_allowed"
  );
}

/** `ledger.decide`가 거부한 오류를 결정 실패 이유로 옮긴다. 모르는 코드는 `unavailable`이고 코드를 `detail`에 싣는다 */
function decideFailureOf(error: CapabilityError): DecideFailure {
  const { code, message, detail } = error.data;
  if (code === "invalid_input" && hasScopeReason(detail)) {
    return { ok: false, reason: "scope_not_allowed", detail: message };
  }
  const reason = DECIDE_REASONS.get(code);
  if (reason !== undefined) {
    return { ok: false, reason, detail: reason === "base_stale" ? `${code}: ${message}` : message };
  }
  return { ok: false, reason: "unavailable", detail: `${code}: ${message}`.slice(0, 512) };
}

export interface KnowledgeProposalListInput {
  /** 합친 wire 상태 필터. 생략하면 거르지 않는다 */
  readonly status?: readonly ProposalStatusWire[];
  /** 1~200, 기본 50 */
  readonly limit?: number;
  /** 이 항목보다 오래된 쪽부터. 호스트가 합친 목록의 커서에서 이 출처의 마지막 항목을 꺼내 넘긴다 */
  readonly before?: { readonly createdAt: number; readonly id: string };
}

export interface KnowledgeProposalWire {
  /** 지식 대기열을 최신순으로 읽는다. 지식 상태가 하나도 없는 필터는 빈 목록이다 */
  list(input: KnowledgeProposalListInput, options?: CallOptions): Promise<readonly ProposalRow[]>;
  /**
   * `source: "knowledge"` 결정 하나를 적용한다. 실패는 던지지 않고 이유로 돌려준다. `edit`와 `revert`는 학습 대기열만
   * 받으므로 `unsupported`다. `revision`은 지식 제안에서 항상 1이다.
   */
  decide(params: ProposalDecideParams, options: CallOptions): Promise<ProposalDecideResult>;
}

/** 호스트가 `knowledge.ledger` 능력 API로 만든다. 결정은 호스트(사용자) 문맥으로만 받는다(`ledger.decide`의 규칙) */
export function createKnowledgeProposalWire(ledger: LedgerApi): KnowledgeProposalWire {
  return {
    async list(input, options) {
      const statuses = knowledgeStatusesOf(input.status);
      if (statuses === undefined) return [];
      const listed = await ledger.proposals(
        {
          ...(statuses.length === 0 ? {} : { statuses: [...statuses] }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.before === undefined
            ? {}
            : { before: { createdAt: input.before.createdAt, proposalId: input.before.id } }),
        },
        options,
      );
      return listed.proposals.map(proposalRowOf);
    },
    async decide(params, options) {
      if (params.source !== "knowledge") {
        return {
          ok: false,
          reason: "unsupported",
          detail: "this adapter only decides knowledge proposals",
        };
      }
      switch (params.decision) {
        case "edit":
          if (params.revision !== 1) {
            return {
              ok: false,
              reason: "revision_mismatch",
              detail: "knowledge proposals are revision 1",
            };
          }
          return { ok: false, reason: "unsupported", detail: "edit is for learning proposals" };
        case "revert":
          return {
            ok: false,
            reason: "unsupported",
            detail: `${params.decision} is for learning proposals`,
          };
        case "approve":
        case "reject": {
          if (params.decision === "approve" && params.revision !== 1) {
            return {
              ok: false,
              reason: "revision_mismatch",
              detail: "knowledge proposals are revision 1",
            };
          }
          const decided = await attemptAsync(() =>
            ledger.decide(
              params.decision === "approve"
                ? {
                    proposalId: params.id,
                    decision: "approve",
                    ...(params.scope === undefined ? {} : { scope: params.scope }),
                  }
                : {
                    proposalId: params.id,
                    decision: "reject",
                    ...(params.note === undefined ? {} : { note: params.note }),
                  },
              options,
            ),
          );
          if (!decided.ok) {
            if (decided.error.cause instanceof CapabilityError) {
              return decideFailureOf(decided.error.cause);
            }
            throw new Error("proposal decide failed with a non-capability error", {
              cause: decided.error.cause,
            });
          }
          return {
            ok: true,
            proposal: proposalRowOf(decided.value.proposal),
            applied: decided.value.outcome?.status === "applied",
          };
        }
        default:
          return assertNever(params, "ProposalDecideParams");
      }
    },
  };
}
