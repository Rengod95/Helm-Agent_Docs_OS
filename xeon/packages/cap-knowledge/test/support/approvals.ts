import { ok, type Result } from "@xeon/contracts";
import type { KnowledgeFailure } from "../../src/errors.ts";
import type {
  WriteApprovalAnswer,
  WriteApprovalRequest,
  WriteApprovals,
} from "../../src/ports/approvals.ts";

// 시험용 쓰기 승인 포트. 정해진 답으로 응답하거나, 풀어 줄 때까지 기다린다.

export interface ScriptedApprovals extends WriteApprovals {
  readonly requests: WriteApprovalRequest[];
  /** 이후 요청의 답을 정한다. 기본은 allow */
  answerWith(next: WriteApprovalAnswer): void;
  /** 다음 요청부터 `release`를 부를 때까지 응답하지 않는다 */
  hold(): { release(answer?: WriteApprovalAnswer): void };
}

export function scriptedApprovals(): ScriptedApprovals {
  const requests: WriteApprovalRequest[] = [];
  let answer: WriteApprovalAnswer = { kind: "allow" };
  let gate: Promise<WriteApprovalAnswer> | undefined;
  return {
    requests,
    answerWith(next) {
      answer = next;
    },
    hold() {
      const slot: { release?: (value: WriteApprovalAnswer) => void } = {};
      gate = new Promise<WriteApprovalAnswer>((resolve) => {
        slot.release = resolve;
      });
      return {
        release: (value) => {
          slot.release?.(value ?? answer);
        },
      };
    },
    async ask(request): Promise<Result<WriteApprovalAnswer, KnowledgeFailure>> {
      requests.push(request);
      if (gate !== undefined) return ok(await gate);
      return ok(answer);
    },
  };
}
