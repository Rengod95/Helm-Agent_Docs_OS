import { assertNever, err, ok, type Result } from "@xeon/contracts";
import type {
  ProposalDecideParams,
  ProposalDecideResult,
  ProposalListResult,
  ProposalRow,
  ProposalSource,
} from "@xeon/contracts/wire";

// 지식 제안 목록 view-model(M3-REQ-18, M3-18 L4, D-M3-32 a). 대기열은 둘(학습 `x_learning_proposals`, L2.knowledge)이고 호스트가 한 목록으로
// 합쳐 `proposal.list`로 준다. 이 모듈은 그 행을 화면 값으로 바꾸고, 사용자의 동작을 `proposal.decide` params로, 결과를 문구로 바꾼다.
// 순수 함수다. 서버의 `detail` 문자열은 화면에 쓰지 않는다(F.wire-settings.spec §3.5.1).

export type ProposalAction = "approve" | "reject" | "edit" | "revert";
export type ProposalScope = "user" | "project";

const SOURCE_LABELS: Readonly<Record<ProposalSource, string>> = {
  learning: "학습",
  knowledge: "지식",
};
const KIND_LABELS: Readonly<Record<ProposalRow["kind"], string>> = {
  skill: "스킬",
  memory: "메모리",
  feedback: "피드백",
  script: "스크립트",
};
const STATUS_LABELS: Readonly<Record<ProposalRow["status"], string>> = {
  pending: "대기 중",
  approved: "승인됨",
  applied: "적용됨",
  rejected: "거절됨",
  stale: "오래됨",
  expired: "만료됨",
  reverted: "되돌림",
};

export type ProposalRowVM = {
  /** 두 출처의 id가 겹칠 수 있어 출처와 함께 쓴다: `<source>:<id>` */
  readonly key: string;
  readonly source: ProposalSource;
  readonly sourceLabel: string;
  readonly id: string;
  readonly kindLabel: string;
  readonly op: string;
  readonly target: string;
  readonly statusLabel: string;
  readonly status: ProposalRow["status"];
  /** 지금 할 수 있는 동작 */
  readonly actions: readonly ProposalAction[];
  /** 지우거나 덮어쓰는 제안. 화면이 확인 단계를 둔다 */
  readonly destructive: boolean;
  /** 신뢰할 수 없는 입력을 읽은 뒤 만든 후보. 화면이 경고를 보인다 */
  readonly afterUntrusted: boolean;
  /** 같은 대상을 건드리는 다른 제안(있으면) */
  readonly conflictsWith: string | null;
  /** 거절·실패 사유 코드(출처가 정한 값) */
  readonly reason: string | null;
  readonly diff: string;
  readonly rationale: string | null;
  readonly evidenceCount: number;
  /** 결정 때 맞춰 보내는 판 */
  readonly revision: number;
  /** 스킬만 적용 범위를 고른다. 기본은 user다(D-M3-09) */
  readonly scopeChoice: {
    readonly allowed: readonly ProposalScope[];
    readonly initial: ProposalScope;
  } | null;
  readonly createdAt: number;
};

export type ProposalListVM = {
  readonly rows: readonly ProposalRowVM[];
  /** 읽지 못한 출처의 안내 문구 */
  readonly unavailableTexts: readonly string[];
  /** 행이 없을 때의 이유 문구. 행이 있으면 null */
  readonly emptyText: string | null;
  readonly nextCursor: string | null;
};

function actionsOf(row: ProposalRow): readonly ProposalAction[] {
  if (row.status === "pending") {
    return row.source === "learning" ? ["approve", "reject", "edit"] : ["approve", "reject"];
  }
  // 되돌리기는 학습 출처의 원장 롤백이다. 적용된 제안에만 있다
  if (row.status === "applied" && row.source === "learning") return ["revert"];
  return [];
}

function rowOf(row: ProposalRow): ProposalRowVM {
  return {
    key: `${row.source}:${row.id}`,
    source: row.source,
    sourceLabel: SOURCE_LABELS[row.source],
    id: row.id,
    kindLabel: KIND_LABELS[row.kind],
    op: row.op,
    target: row.target,
    statusLabel: STATUS_LABELS[row.status],
    status: row.status,
    actions: actionsOf(row),
    destructive: row.destructive,
    afterUntrusted: row.afterUntrusted,
    conflictsWith: row.conflictsWith,
    reason: row.reason,
    diff: row.diff,
    rationale: row.rationale,
    evidenceCount: row.evidence.length,
    revision: row.revision,
    scopeChoice: row.kind === "skill" ? { allowed: ["user", "project"], initial: "user" } : null,
    createdAt: row.createdAt,
  };
}

/** `proposal.list` 결과를 목록 값으로 바꾼다. 행 순서는 호스트가 정한 그대로다(최신 먼저) */
export function proposalListView(result: ProposalListResult): ProposalListVM {
  const rows = result.proposals.map(rowOf);
  const unavailableTexts = result.unavailable.map(
    (source) => `${SOURCE_LABELS[source]} 제안을 불러오지 못했어요`,
  );
  return {
    rows,
    unavailableTexts,
    emptyText: rows.length === 0 ? "대기 중인 제안이 없어요" : null,
    nextCursor: result.nextCursor,
  };
}

/** 동작에 딸린 입력. 동작이 쓰지 않는 입력은 무시한다 */
export type ProposalInput = {
  readonly scope?: ProposalScope;
  readonly note?: string;
  readonly body?: string;
};

export type DecisionError =
  /** 이 행에서 할 수 없는 동작이다 */
  | { readonly kind: "not_allowed"; readonly action: ProposalAction }
  /** 수정 본문이 비었다 */
  | { readonly kind: "empty_body" }
  /** 스킬이 아닌 제안에 적용 범위를 줬다 */
  | { readonly kind: "scope_not_applicable" };

const NOTE_MAX = 500;
const BODY_MAX = 200_000;

/** 동작을 `proposal.decide` params로 바꾼다. 판(`revision`)은 목록에서 본 값을 그대로 보낸다 */
export function decisionParams(
  row: ProposalRowVM,
  action: ProposalAction,
  input: ProposalInput = {},
): Result<ProposalDecideParams, DecisionError> {
  if (!row.actions.includes(action)) return err({ kind: "not_allowed", action });
  const target = { source: row.source, id: row.id };
  switch (action) {
    case "approve": {
      if (input.scope !== undefined && row.scopeChoice === null) {
        return err({ kind: "scope_not_applicable" });
      }
      const scope = row.scopeChoice === null ? undefined : (input.scope ?? row.scopeChoice.initial);
      return ok({
        ...target,
        decision: "approve",
        revision: row.revision,
        ...(scope === undefined ? {} : { scope }),
      });
    }
    case "reject": {
      const note = input.note?.trim().slice(0, NOTE_MAX) ?? "";
      return ok({ ...target, decision: "reject", ...(note === "" ? {} : { note }) });
    }
    case "edit": {
      const body = input.body ?? "";
      if (body.trim() === "") return err({ kind: "empty_body" });
      return ok({
        ...target,
        decision: "edit",
        revision: row.revision,
        body: body.slice(0, BODY_MAX),
      });
    }
    case "revert":
      return ok({ ...target, decision: "revert" });
    default:
      return assertNever(action, "ProposalAction");
  }
}

export type DecisionOutcome =
  /** 결정을 받았다. `applied`가 거짓이면 승인만 하고 아직 적용하지 않은 것이다 */
  | { readonly kind: "done"; readonly proposal: ProposalRowVM; readonly applied: boolean }
  /** 적용하지 못했다. `reload`가 참이면 목록을 다시 읽는다 */
  | { readonly kind: "failed"; readonly text: string; readonly reload: boolean };

const FAILURE_TEXTS: Readonly<
  Record<
    Extract<ProposalDecideResult, { ok: false }>["reason"],
    { readonly text: string; readonly reload: boolean }
  >
> = {
  not_found: { text: "제안을 찾을 수 없어요. 목록을 새로 불러왔어요", reload: true },
  revision_mismatch: {
    text: "다른 곳에서 제안이 바뀌었어요. 목록을 새로 불러왔어요",
    reload: true,
  },
  closed: { text: "이미 처리된 제안이에요. 목록을 새로 불러왔어요", reload: true },
  scope_not_allowed: { text: "이 범위에는 적용할 수 없어요", reload: false },
  unsupported: { text: "이 출처에서는 쓸 수 없는 동작이에요", reload: false },
  base_stale: { text: "대상이 바뀌어 제안이 오래되었어요. 목록을 새로 불러왔어요", reload: true },
  scan_failed: { text: "내용 검사를 통과하지 못해 적용하지 않았어요", reload: false },
  approval_required: { text: "쓰기 승인이 먼저 필요해요", reload: false },
  unavailable: { text: "지금은 처리할 수 없어요. 잠시 뒤 다시 해 주세요", reload: false },
};

/** `proposal.decide` 결과를 화면 값으로 바꾼다. 서버의 `detail`은 쓰지 않는다 */
export function decisionOutcomeOf(result: ProposalDecideResult): DecisionOutcome {
  if (result.ok) return { kind: "done", proposal: rowOf(result.proposal), applied: result.applied };
  const failure = FAILURE_TEXTS[result.reason];
  return { kind: "failed", text: failure.text, reload: failure.reload };
}
