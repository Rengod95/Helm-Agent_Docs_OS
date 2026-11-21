import { assertNever, Bug, err, ok, parse, type Result } from "@fresnel/contracts";
import { isCapabilityId } from "@fresnel/contracts/capabilities";
import { ApprovalIdSchema, type ApprovalId, type ThreadId } from "@fresnel/contracts/conversation";
import {
  ApprovalBodyJsonSchema,
  isApprovalRequestKey,
  type ApprovalBodyJson,
  type ReadFailure,
} from "@fresnel/contracts/records";
import {
  L2_APPROVAL_REQUEST_ID_MAX,
  type ApprovalBody,
  type ApprovalOrigin,
  type ApprovalRequestError,
  type ApprovalResolution,
  type ApprovalService,
  type L2ApprovalRequest,
  type L2ApprovalSnapshot,
  type L2ApprovalsPort,
  type OpenedApproval,
  type ToolRisk,
} from "@fresnel/contracts/services";

// L2.readme §5.7. 각 cap-*는 F `L2ApprovalsPort` 모양으로 승인을 쓴다. 이 파일은 그 포트를 F `ApprovalService`(open/wait/get) 위에 얹는
// 조립 루트의 어댑터다(core-tools의 `testing/l2-port.ts`가 같은 규칙의 시험용 기준 구현이다). 호출마다 출처(origin)가 달라
// 포트는 출처를 받아 만든다. 도구 호출 안에서 낸 요청이면 `origin.toolCallId`가 있어 L1.tools가 그 호출의 대기 체크포인트를 같은 커밋에 넣는다.
// 조립 루트 코드(DR-14 예외 2).

function isRisk(value: string): value is ToolRisk {
  return value === "read" || value === "write" || value === "exec";
}

/** 기록 수준 body(JSON)를 서비스 타입의 ApprovalBody로 되돌린다. 모르는 등급·기능이 있으면 undefined */
function bodyOfJson(body: ApprovalBodyJson): ApprovalBody | undefined {
  switch (body.kind) {
    case "tool": {
      const tool = body.tool;
      if (!isRisk(tool.risk)) return undefined;
      const base = {
        toolName: tool.toolName,
        risk: tool.risk,
        args: tool.args,
        argsHash: tool.argsHash,
        ruleId: tool.ruleId,
      };
      if (tool.capability === undefined) return { kind: "tool", tool: base };
      const id = tool.capability.id;
      if (!isCapabilityId(id)) return undefined;
      return {
        kind: "tool",
        tool: { ...base, capability: { id, method: tool.capability.method } },
      };
    }
    case "plan":
      // 계획 승인은 더는 만들지 않는다 [결정: 2026-11-13 사용자]. 요청 경로는 이 종류를 받지 않아 subject 불일치로 거부한다
      return undefined;
    case "question":
      return { kind: "question", question: { questions: body.question.questions } };
    case "review":
      return { kind: "review", review: body.review };
    default:
      return assertNever(body, "ApprovalBodyJson");
  }
}

function toApprovalId(value: string): ApprovalId {
  const parsed = parse(ApprovalIdSchema, value);
  // fresnel-disable-next-line fresnel/bug-for-expected -- ApprovalService가 만든 id(approval.requested 이벤트 id)라 형식이 어긋나면 코드 결함이다 (eng.typescript.guide TY-24)
  if (!parsed.ok) throw new Bug(`l2port.approval_id_invalid: ${value}`);
  return parsed.value;
}

function stateOf(opened: OpenedApproval): L2ApprovalSnapshot["state"] {
  if (opened.resolution === null) return "pending";
  return opened.resolution.resolvedBy === "cancelled" ? "cancelled" : "resolved";
}

function snapshotOf(opened: OpenedApproval): L2ApprovalSnapshot {
  const { resolution } = opened;
  return {
    approvalId: toApprovalId(opened.request.approvalId),
    state: stateOf(opened),
    resolution:
      resolution === null
        ? null
        : {
            decision: resolution.decision,
            answer: resolution.answer,
            remember: resolution.remember,
          },
  };
}

function snapshotOfResolution(resolution: ApprovalResolution): L2ApprovalSnapshot {
  return {
    approvalId: toApprovalId(resolution.approvalId),
    state: resolution.resolvedBy === "cancelled" ? "cancelled" : "resolved",
    resolution: {
      decision: resolution.decision,
      answer: resolution.answer,
      remember: resolution.remember,
    },
  };
}

/**
 * 기본 제목. `plan`은 은퇴한 종류라 새 요청이 없다(`request`가 subject 불일치로 거부한다). ApprovalKind가 옛 기록을 읽으려고 `plan`을 남겨서
 * `Record`가 그 칸을 요구한다.
 */
const DEFAULT_TITLES: Readonly<Record<L2ApprovalRequest["kind"], string>> = {
  tool: "Approve this action?",
  plan: "Review the plan",
  question: "Answer the questions",
  review: "Review the changes",
};

export interface L2PortOptions {
  /** 요청의 출처. 도구 호출 안이면 호출 문맥에서, 아니면 요청의 대화만으로 만든다 */
  readonly origin: (request: L2ApprovalRequest) => ApprovalOrigin;
  /** 화면 제목. 생략하면 kind별 기본 문장 */
  readonly title?: (request: L2ApprovalRequest) => string;
}

function rejected(code: string, detail: string): ApprovalRequestError {
  return { kind: "rejected", code, detail };
}

function createL2ApprovalsPort(
  approvals: ApprovalService,
  options: L2PortOptions,
): L2ApprovalsPort {
  return {
    async request(input): Promise<Result<L2ApprovalSnapshot, ApprovalRequestError>> {
      if (input.requestId.length < 1 || input.requestId.length > L2_APPROVAL_REQUEST_ID_MAX) {
        return err(rejected("approvals.request_invalid", "requestId must be 1-48 characters"));
      }
      // cap-*는 F `requestKeyFor`로 만든 키를 넘긴다. 어댑터는 다시 해시하지 않고 키인지만 본다(`h_` 원문이 해시 키와 겹치지 않게 contracts가 판정한다)
      if (!isApprovalRequestKey(input.requestId)) {
        return err(
          rejected(
            "approvals.request_invalid",
            "requestId must be an approval request key made with requestKeyFor",
          ),
        );
      }
      const shape = parse(ApprovalBodyJsonSchema, {
        kind: input.kind,
        [input.kind]: input.subject,
      });
      const body = shape.ok ? bodyOfJson(shape.value) : undefined;
      if (body === undefined) {
        return err(
          rejected("approvals.request_invalid", `subject does not fit kind ${input.kind}`),
        );
      }
      const opened = await approvals.open({
        origin: options.origin(input),
        requestKey: input.requestId,
        title: options.title?.(input) ?? DEFAULT_TITLES[input.kind],
        body,
        remember: input.remember ?? ["once"],
      });
      if (!opened.ok) return opened;
      return ok(snapshotOf(opened.value));
    },
    get(
      _threadId: ThreadId,
      approvalId: ApprovalId,
    ): Promise<Result<L2ApprovalSnapshot | null, ReadFailure>> {
      const known = approvals.get(approvalId);
      return Promise.resolve(ok(known === undefined ? null : snapshotOf(known)));
    },
    respond(input) {
      return approvals.respond(input.approvalId, {
        decision: input.decision,
        ...(input.answer === undefined ? {} : { answer: input.answer }),
      });
    },
    cancel(_threadId, approvalId, reason) {
      return approvals.cancel(approvalId, reason);
    },
    async wait(_threadId, approvalId, signal) {
      const waited = await approvals.wait(approvalId, signal);
      if (!waited.ok) return err({ kind: "cancelled" as const });
      return ok(snapshotOfResolution(waited.value));
    },
  };
}

/** 출처가 없는 요청(기능이 도구 호출 밖에서 묻는 경우)의 출처. 대기 체크포인트 없이 승인 이벤트만 남는다 */
function bareOrigin(threadId: ThreadId): ApprovalOrigin {
  return { threadId, turnId: null, stepId: null, toolCallId: null, caller: "main" };
}

/** 출처 없이 쓰는 포트(웹 도메인 승인처럼 요청마다 대화만 아는 경우) */
export function createBareL2ApprovalsPort(
  approvals: ApprovalService,
  title?: L2PortOptions["title"],
): L2ApprovalsPort {
  return createL2ApprovalsPort(approvals, {
    origin: (request) => bareOrigin(request.threadId),
    ...(title === undefined ? {} : { title }),
  });
}
