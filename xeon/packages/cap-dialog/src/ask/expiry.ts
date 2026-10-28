import type { AskQuestion } from "@xeon/contracts/capabilities";
import { defaultAskAnswer } from "@xeon/contracts/capabilities";
import type { ApprovalId, ThreadId } from "@xeon/contracts/conversation";
import type { Logger, TimerHandle } from "@xeon/contracts";
import type { L2ApprovalsPort } from "../ports/approvals.ts";
import type { Timers } from "../ports/timers.ts";
import { toQuestionAnswer } from "./mapping.ts";

// L2.dialog.spec §4.1.3 시간 제한. 만료 시각과 만료 결과를 승인 요청에 실어 L1.tools가 내구적으로 관리하는 것이
// 정본이지만 F `ApprovalRequestInput`에는 아직 그 필드가 없다(요청: L1.tools.spec §8.3에 만료 필드 추가).
// 그동안은 이 모듈이 프로세스 안 타이머로 같은 일을 한다. 한계:
// - 프로세스가 끝나면 타이머가 사라진다. 재시작 뒤 같은 `requestId`로 `ask`를 다시 부르면 제한 시간을 처음부터 다시 잰다.
// - `defaulted`와 `timeout` 표지는 메모리에만 있다. 재시작 뒤 이 질문의 결과는 `defaulted: false` 또는 `aborted`로 읽힌다.
// L1.tools가 만료를 맡게 되면 이 파일을 지우고 `ask/service.ts`가 요청에 만료를 싣게 바꾼다.

interface ArmedExpiry {
  readonly handle: TimerHandle;
}

interface ExpiryRequest {
  readonly approvals: L2ApprovalsPort;
  readonly threadId: ThreadId;
  readonly approvalId: ApprovalId;
  readonly requestKey: string;
  readonly afterSec: number;
  readonly questions: readonly AskQuestion[];
}

export interface AskExpiry {
  /** 같은 승인에 이미 걸려 있으면 다시 걸지 않는다 */
  arm(request: ExpiryRequest): void;
  /** 시간 초과로 추천 답이 들어간 승인인가 */
  wasDefaulted(approvalId: string): boolean;
  /** 시간 초과로 닫힌 승인인가 */
  wasTimedOut(approvalId: string): boolean;
  /** 이 승인의 타이머를 거둔다. 해결이 확인된 뒤 부른다 */
  settle(approvalId: string): void;
  /** 남은 타이머를 모두 거둔다 */
  dispose(): void;
}

export function createAskExpiry(timers: Timers, logger: Logger): AskExpiry {
  const armed = new Map<string, ArmedExpiry>();
  const defaulted = new Set<string>();
  const timedOut = new Set<string>();

  async function fire(request: ExpiryRequest): Promise<void> {
    armed.delete(request.approvalId);
    const fallback = defaultAskAnswer(request.questions);
    if (fallback !== null) {
      defaulted.add(request.approvalId);
      const response = await request.approvals.respond({
        threadId: request.threadId,
        approvalId: request.approvalId,
        decision: "answer",
        answer: toQuestionAnswer(fallback),
        requestId: request.requestKey,
      });
      if (!response.applied) {
        // 사용자가 먼저 답했거나 닫혔다
        defaulted.delete(request.approvalId);
      }
      return;
    }
    timedOut.add(request.approvalId);
    const cancelled = await request.approvals.cancel(
      request.threadId,
      request.approvalId,
      "timeout",
    );
    if (!cancelled.applied) timedOut.delete(request.approvalId);
  }

  return {
    arm(request) {
      if (request.afterSec <= 0 || armed.has(request.approvalId)) return;
      const handle = timers.scheduler.setTimeout(() => {
        fire(request).catch((caught: unknown) => {
          logger.error("dialog.ask_expiry_failed", {
            approvalId: request.approvalId,
            error: caught instanceof Error ? caught.message : String(caught),
          });
        });
      }, request.afterSec * 1000);
      armed.set(request.approvalId, { handle });
    },
    wasDefaulted: (approvalId) => defaulted.has(approvalId),
    wasTimedOut: (approvalId) => timedOut.has(approvalId),
    settle(approvalId) {
      const entry = armed.get(approvalId);
      if (entry === undefined) return;
      timers.scheduler.clearTimeout(entry.handle);
      armed.delete(approvalId);
    },
    dispose() {
      for (const entry of armed.values()) timers.scheduler.clearTimeout(entry.handle);
      armed.clear();
    },
  };
}
