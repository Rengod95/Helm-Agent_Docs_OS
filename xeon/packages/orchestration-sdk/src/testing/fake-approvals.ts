import { err, ok } from "@fresnel/contracts";
import type { JsonValue } from "@fresnel/contracts/conversation";
import type {
  ApprovalRequest,
  ApprovalResolution,
  ApprovalService,
  OpenedApproval,
} from "@fresnel/contracts/services";

/** `autoAnswerApprovals`가 만든 승인 서비스 대역과 새로 연 요청 */
export interface AutoAnswerApprovals {
  readonly service: ApprovalService;
  /** 새로 연 요청. 같은 `requestKey`로 다시 연 요청은 세지 않는다 */
  readonly created: readonly ApprovalRequest[];
}

/**
 * 연 요청을 바로 `answer`로 해결하는 승인 서비스 대역(replay용). 사람 없이 loop.ask를 지나가는 그룹을 재생할 때 쓴다.
 * `open`은 대화와 `requestKey`로 멱등이라 같은 키로 다시 열면 처음 요청과 해결을 돌려준다.
 * 기준 실행과 절단 실행이 같은 대역을 이어 쓰면 재호출이 기록된 답을 돌려받는 경로를 그대로 본다.
 */
export function autoAnswerApprovals(answer: JsonValue): AutoAnswerApprovals {
  const byKey = new Map<string, OpenedApproval>();
  const byId = new Map<string, OpenedApproval>();
  const created: ApprovalRequest[] = [];

  function resolutionOf(approvalId: string): ApprovalResolution {
    return {
      approvalId,
      decision: "answer",
      answer,
      remember: "once",
      requestedRemember: null,
      resolvedBy: "user",
    };
  }

  const service: ApprovalService = {
    async request(input) {
      const opened = await service.open(input);
      if (!opened.ok) return opened;
      return ok(opened.value.resolution ?? resolutionOf(opened.value.request.approvalId));
    },
    respond: () => Promise.resolve({ applied: false, reason: "already_resolved" }),
    pending: () => [],
    restore: () => Promise.resolve(ok([])),
    cancel: () => Promise.resolve({ applied: false }),
    open(input) {
      const key = `${input.origin.threadId}|${input.requestKey}`;
      const known = byKey.get(key);
      if (known !== undefined) return Promise.resolve(ok(known));
      const request: ApprovalRequest = {
        ...input,
        approvalId: `appr_auto_${String(created.length + 1)}`,
        surfaceThreadId: input.origin.threadId,
        requestedAt: 0,
      };
      const opened: OpenedApproval = { request, resolution: resolutionOf(request.approvalId) };
      byKey.set(key, opened);
      byId.set(request.approvalId, opened);
      created.push(request);
      return Promise.resolve(ok(opened));
    },
    wait(approvalId) {
      const entry = byId.get(approvalId);
      const resolution = entry?.resolution;
      if (resolution === undefined || resolution === null) {
        return Promise.resolve(err({ kind: "unknown" }));
      }
      return Promise.resolve(ok(resolution));
    },
    get: (approvalId) => byId.get(approvalId),
  };
  return { service, created };
}
