import { assertNever } from "@xeon/contracts";
import type { DelegateError } from "@xeon/group-kit";
import type { ProposalId } from "./proposals/ids.ts";
import type { ProposalStatus, ProposalView } from "./proposals/proposal.ts";

// L3.learning.spec §3.9. 예상 가능한 실패는 판별 유니온 값으로 돌려준다(eng.typescript.guide TY-11).

export type LearningError =
  | { readonly kind: "learning.notFound"; readonly proposalId: string }
  | {
      readonly kind: "learning.revisionMismatch";
      readonly proposalId: string;
      readonly current: number;
    }
  | {
      readonly kind: "learning.closed";
      readonly proposalId: string;
      readonly status: ProposalStatus;
    }
  /** memory·feedback 후보에 project 범위 */
  | { readonly kind: "learning.scopeNotAllowed"; readonly proposalId: string }
  /** edit에 본문이 스키마를 지키지 않음(patch는 치환 목록 JSON) */
  | { readonly kind: "learning.invalidBody"; readonly proposalId: string; readonly detail: string }
  /** requires 미충족 또는 서비스 없음 */
  | { readonly kind: "learning.knowledgeUnavailable"; readonly detail?: string }
  /** fail-closed(§4.1) */
  | { readonly kind: "learning.settingsUnavailable" }
  /** 대기열 저장소를 읽거나 쓰지 못함 */
  | { readonly kind: "learning.storeUnavailable"; readonly detail: string }
  /** /learning review 때 진행 중 검토 있음 */
  | { readonly kind: "learning.reviewBusy"; readonly requestId: string }
  /** 수동 검토가 포크 지점으로 쓸 마지막 item을 모름 [제안] */
  | { readonly kind: "learning.noSnapshot" }
  /** 대화 없이 부른 명령은 기록을 쓸 thread가 없어 읽기만 한다(결정, 정리, 검토는 대화가 필요하다) [제안] */
  | { readonly kind: "learning.noConversation" }
  | { readonly kind: "learning.delegateFailed"; readonly cause: DelegateError };

/** 대기열 결정·적용의 결과. 명령 처리기와 L4 화면이 받는다 */
export type DecisionResult =
  | { readonly ok: true; readonly proposal: ProposalView; readonly applied: boolean }
  | { readonly ok: false; readonly error: LearningError };

/** 적용 어댑터 결과를 대기열 전이로 바꾼 값 */
export type ApplyTransition =
  | { readonly kind: "applied"; readonly ledgerId: string; readonly afterHash: string }
  | { readonly kind: "rejected"; readonly reason: "scan_failed" | "apply_failed" }
  | { readonly kind: "backToPending"; readonly reason: "base_stale" }
  /** io, 능력 일시 실패, 승인 요구. approved 유지 */
  | { readonly kind: "retry"; readonly detail: string };

/** 명령 진입 때의 지연 정리 결과(§4.5 규칙 7) */
export interface QueueSweep {
  readonly expired: readonly ProposalId[];
  readonly retried: readonly { readonly id: ProposalId; readonly transition: ApplyTransition }[];
}

/** KnowledgeChangeApi.apply의 결과(§3.6) */
export type ApplyResult =
  | { readonly ok: true; readonly ledgerId: string; readonly afterHash: string }
  | {
      readonly ok: false;
      readonly reason: "scan_failed" | "base_stale" | "approval_required" | "invalid" | "io";
      readonly detail?: string;
    };

/**
 * 순수 함수. L2 실패 코드마다 전이가 spec §4.5 표와 같다.
 * - `scan_failed`는 `rejected/scan_failed`, `base_stale`은 `pending/base_stale`
 * - `io`와 `approval_required`는 `approved` 유지(같은 멱등 키로 다시 부른다). 승인 증거를 믿지 않는 구성에서 L2가 승인을 한 번 더 묻거나
 *   대기열로 보낸 경우다(§4.5 규칙 6)
 * - `invalid`는 `rejected/apply_failed`
 */
export function applyOutcome(result: ApplyResult): ApplyTransition {
  if (result.ok) return { kind: "applied", ledgerId: result.ledgerId, afterHash: result.afterHash };
  switch (result.reason) {
    case "scan_failed":
      return { kind: "rejected", reason: "scan_failed" };
    case "base_stale":
      return { kind: "backToPending", reason: "base_stale" };
    case "invalid":
      return { kind: "rejected", reason: "apply_failed" };
    case "approval_required":
    case "io":
      return { kind: "retry", detail: result.detail ?? result.reason };
    default:
      return assertNever(result.reason, "ApplyResult.reason");
  }
}

/** `/learning` 명령 하나의 결과. 호스트가 직렬화해 화면에 낸다(`--json`은 이 값을 그대로 낸다) */
export type CommandReport =
  | { readonly kind: "usage"; readonly text: string }
  | {
      readonly kind: "queue";
      readonly views: readonly ProposalView[];
      readonly sweep: QueueSweep | null;
    }
  | { readonly kind: "show"; readonly view: ProposalView }
  | { readonly kind: "decision"; readonly result: DecisionResult }
  | {
      readonly kind: "review";
      readonly result:
        | { readonly ok: true; readonly requestId: string; readonly duplicate: boolean }
        | { readonly ok: false; readonly error: LearningError };
    }
  | { readonly kind: "cancel"; readonly cancelled: boolean }
  | { readonly kind: "error"; readonly error: LearningError };
