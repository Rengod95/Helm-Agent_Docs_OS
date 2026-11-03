import { assertNever } from "@fresnel/contracts";
import type { MessageId } from "@fresnel/client/i18n";
import type { HunkDecision } from "../../review-model.ts";

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
