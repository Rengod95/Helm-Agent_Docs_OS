import { Bug, err, ok, parse, type Result } from "@xeon/contracts";
import { ApprovalIdSchema, type ApprovalId, type ThreadId } from "@xeon/contracts/conversation";
import { ApprovalBodyJsonSchema, type ReadFailure } from "@xeon/contracts/records";
import {
  L2_APPROVAL_REQUEST_ID_MAX,
  type ApprovalBody,
  type ApprovalOrigin,
  type ApprovalRequestError,
  type ApprovalResolution,
  type L2ApprovalRequest,
  type L2ApprovalRespondInput,
  type L2ApprovalSnapshot,
  type L2ApprovalsPort,
  type OpenedApproval,
} from "@xeon/contracts/services";
import { approvalBodyOf } from "../approvals/pending.ts";
import { requestKeyFor } from "../approvals/keys.ts";
import type { ApprovalsInternal } from "../approvals/service.ts";

// F `L2ApprovalsPort`(L2.readme §5.7)를 core-tools의 실제 `ApprovalService` 위에 얹은 기준 어댑터. 각 cap-*의 `src/ports/approvals.ts`가
// 같은 일을 한다. 이 파일은 그 어댑터가 따라야 할 규칙을 실제 서비스로 확인하는 시험용 구현이다(다른 패키지 테스트용 `./testing`).
//
// - 요청 키: L2 `requestId`(1~48자)는 `requestKeyFor`를 거쳐 승인 요청 키가 된다. 커밋 키 알파벳 밖의 문자나 한도 밖의 길이는 해시로 줄인다.
// - 출처: L2 포트의 `request`에는 도구 호출 맥락이 없다. cap-*는 도구 메서드가 받은 `CallOptions.context`로 `origin`을 만들어 호출마다 포트를 만든다.
//   `origin.toolCallId`가 있으면 core-tools가 활성 호출 표에서 대기 체크포인트 초안을 만든다.
// - 대상(`subject`): 여기서는 kind의 body 내용 그대로(`question`은 `{ questions }`, `plan`은 `{ plan, planRef, nextModes }`, `tool`은 도구 승인 body)다.
//   도메인 대상(AskApprovalSubject 등)을 body로 바꾸는 규칙은 cap-*가 가진다.

export interface L2PortOptions {
  /** 이 포트가 낸 요청의 출처. 도구 호출 안에서 부르면 toolCallId를 채운다 */
  readonly origin: ApprovalOrigin;
  /** 화면 제목. 생략하면 kind별 기본 문장 */
  readonly title?: (request: L2ApprovalRequest) => string;
}

const DEFAULT_TITLES: Readonly<Record<L2ApprovalRequest["kind"], string>> = {
  tool: "Approve this action?",
  plan: "Review the plan",
  question: "Answer the questions",
};

function stateOf(opened: OpenedApproval): L2ApprovalSnapshot["state"] {
  if (opened.resolution === null) return "pending";
  return opened.resolution.resolvedBy === "cancelled" ? "cancelled" : "resolved";
}

function snapshotOf(approvalId: string, opened: OpenedApproval): L2ApprovalSnapshot {
  const { resolution } = opened;
  return {
    approvalId: toApprovalId(approvalId),
    state: stateOf(opened),
    resolution:
      resolution === null ? null : { decision: resolution.decision, answer: resolution.answer },
  };
}

function snapshotOfResolution(
  approvalId: string,
  resolution: ApprovalResolution,
): L2ApprovalSnapshot {
  return {
    approvalId: toApprovalId(approvalId),
    state: resolution.resolvedBy === "cancelled" ? "cancelled" : "resolved",
    resolution: { decision: resolution.decision, answer: resolution.answer },
  };
}

/** 서비스가 준 approvalId(approval.requested 이벤트 id)를 L2의 ApprovalId로 읽는다 */
function toApprovalId(value: string): ApprovalId {
  const parsed = parse(ApprovalIdSchema, value);
  if (!parsed.ok) throw new Bug(`l2port.approval_id_invalid: ${value}`);
  return parsed.value;
}

function bodyOf(request: L2ApprovalRequest): ApprovalBody | undefined {
  const shape = parse(ApprovalBodyJsonSchema, {
    kind: request.kind,
    [request.kind]: request.subject,
  });
  return shape.ok ? approvalBodyOf(shape.value) : undefined;
}

function rejected(code: string, detail: string): ApprovalRequestError {
  return { kind: "rejected", code, detail };
}

export function l2ApprovalsPort(
  approvals: ApprovalsInternal,
  options: L2PortOptions,
): L2ApprovalsPort {
  return {
    async request(
      input: L2ApprovalRequest,
    ): Promise<Result<L2ApprovalSnapshot, ApprovalRequestError>> {
      if (input.requestId.length < 1 || input.requestId.length > L2_APPROVAL_REQUEST_ID_MAX) {
        return err(rejected("approvals.request_invalid", "requestId must be 1-48 characters"));
      }
      const body = bodyOf(input);
      if (body === undefined) {
        return err(
          rejected("approvals.request_invalid", `subject does not fit kind ${input.kind}`),
        );
      }
      const opened = await approvals.open({
        origin: { ...options.origin, threadId: input.threadId },
        requestKey: requestKeyFor(input.requestId),
        title: options.title?.(input) ?? DEFAULT_TITLES[input.kind],
        body,
        remember: ["once"],
      });
      if (!opened.ok) return opened;
      return ok(snapshotOf(opened.value.request.approvalId, opened.value));
    },
    get(
      _threadId: ThreadId,
      approvalId: ApprovalId,
    ): Promise<Result<L2ApprovalSnapshot | null, ReadFailure>> {
      const known = approvals.get(approvalId);
      return Promise.resolve(ok(known === undefined ? null : snapshotOf(approvalId, known)));
    },
    respond(input: L2ApprovalRespondInput): Promise<{ readonly applied: boolean }> {
      return approvals.respond(input.approvalId, {
        decision: input.decision,
        ...(input.answer === undefined ? {} : { answer: input.answer }),
      });
    },
    cancel(_threadId: ThreadId, approvalId: ApprovalId, reason: string) {
      return approvals.cancel(approvalId, reason);
    },
    async wait(_threadId: ThreadId, approvalId: ApprovalId, signal: AbortSignal) {
      const waited = await approvals.wait(approvalId, signal);
      if (!waited.ok) return err({ kind: "cancelled" as const });
      return ok(snapshotOfResolution(approvalId, waited.value));
    },
  };
}
