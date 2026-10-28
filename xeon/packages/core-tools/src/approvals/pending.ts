import { assertNever, ok, parse, type Result } from "@xeon/contracts";
import { isCapabilityId, type CapabilityId } from "@xeon/contracts/capabilities";
import type { EventId, ThreadId } from "@xeon/contracts/conversation";
import {
  ApprovalRequestedPayloadSchema,
  ApprovalResolvedPayloadSchema,
  type ApprovalBodyJson,
  type ApprovalResolvedPayload,
  type DurableEventEnvelope,
  type ReadFailure,
  type SessionService,
} from "@xeon/contracts/records";
import {
  PERMISSION_MODE_STRICTNESS,
  TOOL_RISK_ORDER,
  type ApprovalBody,
  type ApprovalRequest,
  type CallerId,
  type PermissionMode,
  type ToolRisk,
} from "@xeon/contracts/services";

// L1.tools.spec §4.7 내구화와 재개. 미해결 approval.requested를 이벤트에서 다시 읽는다.

function isCallerId(value: string): value is CallerId {
  return value === "main" || value.startsWith("subagent:");
}

function isRisk(value: string): value is ToolRisk {
  return TOOL_RISK_ORDER.some((risk) => risk === value);
}

function isMode(value: string): value is PermissionMode {
  return PERMISSION_MODE_STRICTNESS.some((mode) => mode === value);
}

/** 기록된 body(JSON 수준)를 서비스 타입의 ApprovalBody로 되돌린다. 모르는 등급·능력·모드가 있으면 undefined */
export function approvalBodyOf(body: ApprovalBodyJson): ApprovalBody | undefined {
  switch (body.kind) {
    case "tool": {
      const tool = body.tool;
      if (!isRisk(tool.risk)) return undefined;
      let capability: { readonly id: CapabilityId; readonly method: string } | undefined;
      if (tool.capability !== undefined) {
        const id = tool.capability.id;
        if (!isCapabilityId(id)) return undefined;
        capability = { id, method: tool.capability.method };
      }
      return {
        kind: "tool",
        tool: {
          toolName: tool.toolName,
          ...(capability === undefined ? {} : { capability }),
          risk: tool.risk,
          args: tool.args,
          argsHash: tool.argsHash,
          ruleId: tool.ruleId,
        },
      };
    }
    case "plan": {
      const modes = body.plan.nextModes.filter(isMode);
      return {
        kind: "plan",
        plan: { plan: body.plan.plan, planRef: body.plan.planRef, nextModes: modes },
      };
    }
    case "question":
      return { kind: "question", question: { questions: body.question.questions } };
    case "review":
      return { kind: "review", review: body.review };
    default:
      return assertNever(body, "approvals.bodyOf");
  }
}

/** approval.requested 이벤트를 ApprovalRequest로 되돌린다. 형식이 어긋나면 undefined */
function requestOf(event: DurableEventEnvelope): ApprovalRequest | undefined {
  const parsed = parse(ApprovalRequestedPayloadSchema, event.payload);
  if (!parsed.ok) return undefined;
  const payload = parsed.value;
  const caller = payload.origin.caller;
  if (!isCallerId(caller)) return undefined;
  const body = approvalBodyOf(payload.body);
  if (body === undefined) return undefined;
  return {
    approvalId: event.id,
    origin: {
      threadId: payload.origin.threadId,
      turnId: payload.origin.turnId,
      stepId: payload.origin.stepId,
      toolCallId: payload.origin.toolCallId,
      caller,
    },
    requestKey: payload.requestKey,
    title: payload.title,
    body,
    remember: payload.remember,
    surfaceThreadId: payload.surfaceThreadId,
    requestedAt: payload.requestedAt,
    ...(payload.expiresAt === undefined ? {} : { expiresAt: payload.expiresAt }),
    ...(payload.onExpire === undefined ? {} : { onExpire: payload.onExpire }),
  };
}

interface ScannedRequest {
  readonly eventId: EventId;
  readonly request: ApprovalRequest;
}

export interface ScannedApprovals {
  /** 이벤트 순서대로 */
  readonly requests: readonly ScannedRequest[];
  /** approvalId → 해결 기록 */
  readonly resolved: ReadonlyMap<string, ApprovalResolvedPayload>;
}

/** 활성 가지의 approval.* 이벤트를 모두 읽는다 */
export async function scanApprovals(
  session: Pick<SessionService, "readBranch">,
  threadId: ThreadId,
): Promise<Result<ScannedApprovals, ReadFailure>> {
  const requests: ScannedRequest[] = [];
  const resolved = new Map<string, ApprovalResolvedPayload>();
  for await (const read of session.readBranch(threadId)) {
    if (!read.ok) return read;
    const event = read.value;
    if (event.kind === "approval.requested") {
      const request = requestOf(event);
      if (request !== undefined) requests.push({ eventId: event.id, request });
    } else if (event.kind === "approval.resolved") {
      const parsed = parse(ApprovalResolvedPayloadSchema, event.payload);
      if (parsed.ok) resolved.set(parsed.value.approvalId, parsed.value);
    }
  }
  return ok({ requests, resolved });
}
