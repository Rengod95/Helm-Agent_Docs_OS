import type { Result } from "@fresnel/contracts";
import { WIRE_ERRORS } from "@fresnel/contracts/wire";
import type { ApprovalRespondResult } from "@fresnel/contracts/wire";
import type { ApprovalFailure } from "../state/ui/index.ts";
import type { CommandError } from "../views/commands.ts";

// approval.respond의 결과를 승인 카드의 실패 표시로 바꾼다(F.wire-settings.spec §3.3.1, L4.desktop.spec §4.13).
// 계약은 result `{ applied, reason?, detail? }`다. `reason`이 있어 이미 해결된 요청과 맞지 않는 답을 카드가 구분한다.

const INVALID_PARAMS = -32602;
const REMOTE_NOT_ALLOWED = WIRE_ERRORS["approval.remoteNotAllowed"].code;

export type ApprovalFailureView = {
  readonly kind: ApprovalFailure;
  /** `answer_invalid`일 때 host가 준 한 줄(어디가 맞지 않는지). 없으면 undefined */
  readonly detail?: string;
};

/** 적용되었으면 null, 아니면 카드에 보일 실패 표시 */
export function approvalFailureOf(
  sent: Result<ApprovalRespondResult, CommandError>,
  decision: "allow" | "deny" | "answer",
): ApprovalFailureView | null {
  if (!sent.ok) {
    // 다른 프로세스(터미널 등)가 이 대화를 쥐고 있다(3002): 이유를 말해야 사용자가 그쪽을 끝낸다
    if (sent.error.kind === "locked") return { kind: "locked" };
    // 다른 기기에서 승인하기가 꺼져 있다(3009): 답은 이 컴퓨터에서만 한다
    if (sent.error.kind === "rejected" && sent.error.code === REMOTE_NOT_ALLOWED) {
      return { kind: "thisComputerOnly" };
    }
    // 스키마에 맞지 않는 질문 답은 host가 -32602로 거절한다
    return sent.error.kind === "rejected" &&
      sent.error.code === INVALID_PARAMS &&
      decision === "answer"
      ? { kind: "invalid" }
      : { kind: "failed" };
  }
  const { applied, reason, detail } = sent.value;
  if (applied) return null;
  if (reason === "answer_invalid") {
    return detail === undefined ? { kind: "invalid" } : { kind: "invalid", detail };
  }
  // 이미 해결된 승인은 곧 대기열에서 빠지고, host가 모르는 승인은 지울 때까지 카드에 남는다
  if (reason === "already_resolved") return { kind: "closed" };
  if (reason === "unknown_approval") return { kind: "gone" };
  if (reason === "commit_failed") return { kind: "failed" };
  return { kind: "unapplied" };
}
