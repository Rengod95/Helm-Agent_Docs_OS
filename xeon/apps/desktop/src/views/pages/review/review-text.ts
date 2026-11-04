import { assertNever } from "@fresnel/contracts";
import type { MessageId } from "@fresnel/client/i18n";
import type { HunkDecision, ReviewResultRow } from "../../review-model.ts";

// 변경 검토 화면(P-04)의 문장 고르기. 문장은 메시지 id로 들고 있다가 그릴 때 `t()`로 만든다.

/** hunk 결정의 글자. 색과 함께 글자로도 보여 준다 */
export function decisionIdOf(decision: HunkDecision): MessageId {
  switch (decision) {
    case "pending":
      return "desktop.review.hunk.decision.pending";
    case "approved":
      return "desktop.review.hunk.decision.approved";
    case "rejected":
      return "desktop.review.hunk.decision.rejected";
    default:
      return assertNever(decision, "HunkDecision");
  }
}

/** 제출 결과 표의 결과 글자(되돌림, 충돌, 건너뜀) */
export function resultIdOf(result: ReviewResultRow["result"]): MessageId {
  switch (result) {
    case "reverted":
      return "desktop.review.result.reverted";
    case "conflict":
      return "desktop.review.result.conflict";
    case "skipped":
      return "desktop.review.result.skipped";
    default:
      return assertNever(result, "ReviewResultRow.result");
  }
}

/** 제출 결과 표의 되돌린 방법 글자 */
export function methodIdOf(method: ReviewResultRow["method"]): MessageId {
  switch (method) {
    case "workspace_files":
      return "desktop.review.result.method.workspaceFiles";
    case "checkpoint_restore":
      return "desktop.review.result.method.checkpointRestore";
    case "none":
      return "desktop.review.result.method.none";
    default:
      return assertNever(method, "ReviewResultRow.method");
  }
}
