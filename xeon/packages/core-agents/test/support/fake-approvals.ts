// 승인 서비스의 대역(`request`만). 요청을 기록하고, 같은 requestKey에는 처음 해결을 돌려준다(실제 서비스와 같다).
import { err, ok, type Result } from "@fresnel/contracts";
import type {
  ApprovalDecision,
  ApprovalRequestError,
  ApprovalRequestInput,
  ApprovalResolution,
  ApprovalService,
} from "@fresnel/contracts/services";

export interface FakeApprovals extends Pick<ApprovalService, "request"> {
  /** 받은 요청 입력(카드) 목록 */
  readonly requests: readonly ApprovalRequestInput[];
  /** 다음 해결의 결정. 기본은 허용 */
  answer(decision: ApprovalDecision): void;
  /** 카드를 열지 못한다(커밋 거부) */
  failNext(): void;
}

export function fakeApprovals(): FakeApprovals {
  const requests: ApprovalRequestInput[] = [];
  const byKey = new Map<string, ApprovalResolution>();
  let decision: ApprovalDecision = "allow";
  let failing = false;
  return {
    requests,
    answer(next) {
      decision = next;
    },
    failNext() {
      failing = true;
    },
    request(input: ApprovalRequestInput, _signal: AbortSignal) {
      if (failing) {
        failing = false;
        const failed: ApprovalRequestError = {
          kind: "rejected",
          code: "commit_failed",
          detail: null,
        };
        return Promise.resolve<Result<ApprovalResolution, ApprovalRequestError>>(err(failed));
      }
      requests.push(input);
      const known = byKey.get(input.requestKey);
      if (known !== undefined) {
        return Promise.resolve<Result<ApprovalResolution, ApprovalRequestError>>(ok(known));
      }
      const resolution: ApprovalResolution = {
        approvalId: `appr-${String(requests.length)}`,
        decision,
        answer: null,
        remember: "once",
        requestedRemember: "once",
        resolvedBy: "user",
      };
      byKey.set(input.requestKey, resolution);
      return Promise.resolve<Result<ApprovalResolution, ApprovalRequestError>>(ok(resolution));
    },
  };
}
