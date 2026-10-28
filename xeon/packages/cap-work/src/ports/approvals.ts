import { err, ok, parse, type Result } from "@xeon/contracts";
import {
  ApprovalIdSchema,
  type ApprovalId,
  type JsonValue,
  type ThreadId,
} from "@xeon/contracts/conversation";
import { ApprovalBodyJsonSchema, type ReadFailure } from "@xeon/contracts/records";
import {
  L2_APPROVAL_REQUEST_ID_MAX,
  PERMISSION_MODE_STRICTNESS,
  type ApprovalBody,
  type ApprovalOrigin,
  type ApprovalRequestError,
  type ApprovalResolution,
  type ApprovalService,
  type L2ApprovalRequest,
  type L2ApprovalRespondInput,
  type L2ApprovalSnapshot,
  type L2ApprovalsPort,
  type OpenedApproval,
  type PermissionMode,
} from "@xeon/contracts/services";
import { planRefOf } from "../plans/refs.ts";

// L2.work.spec §4.2.2. 계획 승인은 F `L2ApprovalsPort`(L2.readme §5.7)로 kind "plan" 요청을 낸다.
// 호출마다 출처(origin)가 달라 포트는 출처를 받아 만든다. 이 파일이 `xeon.approvals`(F `ApprovalService`)를 그 포트로 감싸는 유일한 자리다.

/** 출처(스레드, 턴, 도구 호출, 호출자)를 받아 승인 포트를 만드는 함수 */
export type PlanApprovalsFactory = (origin: ApprovalOrigin) => L2ApprovalsPort;

const REQUEST_ID_MAX = L2_APPROVAL_REQUEST_ID_MAX;
const PLAN_TITLE = "Review the plan";

/** 계획 승인 요청의 대상. F PlanApprovalBody(`plan`, `planRef`, `nextModes`)와 같은 모양이다 */
export function planSubject(
  plan: { readonly planId: string; readonly version: number; readonly body: string },
  nextModes: readonly PermissionMode[],
): JsonValue {
  return {
    plan: plan.body,
    planRef: planRefOf(plan.planId, plan.version),
    nextModes: [...nextModes],
  };
}

/**
 * 승인할 때 고를 수 있는 다음 권한 모드: 계획 모드 직전 모드를 맨 앞에 두고 default, acceptEdits를 더한다.
 * bypass는 직전 모드였을 때만 낸다
 */
export function nextModesFor(previous: PermissionMode | null): PermissionMode[] {
  const modes: PermissionMode[] = [];
  for (const mode of [previous, "default", "acceptEdits"] as const) {
    if (mode !== null && mode !== "plan" && !modes.includes(mode)) modes.push(mode);
  }
  return modes;
}

function isMode(value: string): value is PermissionMode {
  return PERMISSION_MODE_STRICTNESS.some((mode) => mode === value);
}

function rejected(detail: string): ApprovalRequestError {
  return { kind: "rejected", code: "approvals.request_invalid", detail };
}

function approvalIdOf(raw: string): ApprovalId | undefined {
  const parsed = parse(ApprovalIdSchema, raw);
  return parsed.ok ? parsed.value : undefined;
}

function snapshotOf(opened: OpenedApproval): L2ApprovalSnapshot | undefined {
  const approvalId = approvalIdOf(opened.request.approvalId);
  if (approvalId === undefined) return undefined;
  const { resolution } = opened;
  if (resolution === null) return { approvalId, state: "pending", resolution: null };
  return snapshotOfResolution(approvalId, resolution);
}

function snapshotOfResolution(
  approvalId: ApprovalId,
  resolution: ApprovalResolution,
): L2ApprovalSnapshot {
  // 닫힘(cancelled)과 다른 응답에 밀림(superseded)은 결정이 아니라 철회다
  const closed = resolution.resolvedBy === "cancelled" || resolution.resolvedBy === "superseded";
  return {
    approvalId,
    state: closed ? "cancelled" : "resolved",
    resolution: { decision: resolution.decision, answer: resolution.answer },
  };
}

type PlanBody = Extract<ApprovalBody, { readonly kind: "plan" }>;

/** 요청 대상을 승인 body(kind plan)로 읽는다. 계획 승인이 아니거나 모양이 틀리면 undefined */
function planBodyOf(subject: JsonValue): PlanBody | undefined {
  const shape = parse(ApprovalBodyJsonSchema, { kind: "plan", plan: subject });
  if (!shape.ok || shape.value.kind !== "plan") return undefined;
  const { plan, planRef, nextModes } = shape.value.plan;
  return { kind: "plan", plan: { plan, planRef, nextModes: nextModes.filter(isMode) } };
}

/** 서비스의 메모리 대기 목록에 없으면(재시작 직후) 그 대화의 미해결 요청을 이벤트에서 다시 읽어 찾는다 */
async function known(
  approvals: ApprovalService,
  threadId: ThreadId,
  approvalId: string,
): Promise<OpenedApproval | undefined> {
  const inMemory = approvals.get(approvalId);
  if (inMemory !== undefined) return inMemory;
  const restored = await approvals.restore(threadId);
  return restored.ok ? approvals.get(approvalId) : undefined;
}

/**
 * `xeon.approvals`를 계획 승인용 `L2ApprovalsPort`로 감싼다. 규칙:
 * - 요청 멱등 키는 L2 `requestId`(1~48자) 그대로다. 같은 키로 다시 부르면 서비스가 처음 요청과 현재 해결 상태를 돌려준다.
 * - 서비스의 메모리 대기 목록은 재시작하면 비므로, 모르는 approvalId를 다루기 전에 그 대화의 미해결 요청을 이벤트에서 다시 읽는다(`restore`).
 * - 응답 모양 검사는 서비스가 한다(kind plan: allow의 `{ mode?, note? }`, deny의 `{ feedback }`). 어긋나면 `applied: false`다.
 */
export function planApprovalsOver(approvals: ApprovalService): PlanApprovalsFactory {
  return (origin) => {
    const port: L2ApprovalsPort = {
      async request(
        input: L2ApprovalRequest,
      ): Promise<Result<L2ApprovalSnapshot, ApprovalRequestError>> {
        if (input.requestId.length < 1 || input.requestId.length > REQUEST_ID_MAX) {
          return err(rejected(`requestId must be 1-${REQUEST_ID_MAX} characters`));
        }
        const body = input.kind === "plan" ? planBodyOf(input.subject) : undefined;
        if (body === undefined) return err(rejected("work.plans asks for plan approvals only"));
        const opened = await approvals.open({
          origin: { ...origin, threadId: input.threadId },
          requestKey: input.requestId,
          title: PLAN_TITLE,
          body,
          remember: ["once"],
        });
        if (!opened.ok) return opened;
        const snapshot = snapshotOf(opened.value);
        return snapshot === undefined
          ? err(rejected("the approval service returned an id that is not an approval id"))
          : ok(snapshot);
      },

      async get(
        threadId: ThreadId,
        approvalId: ApprovalId,
      ): Promise<Result<L2ApprovalSnapshot | null, ReadFailure>> {
        const opened = await known(approvals, threadId, approvalId);
        return ok(opened === undefined ? null : (snapshotOf(opened) ?? null));
      },

      async respond(input: L2ApprovalRespondInput) {
        await known(approvals, input.threadId, input.approvalId);
        return await approvals.respond(input.approvalId, {
          decision: input.decision,
          ...(input.answer === undefined ? {} : { answer: input.answer }),
        });
      },

      async cancel(threadId: ThreadId, approvalId: ApprovalId, reason: string) {
        await known(approvals, threadId, approvalId);
        return await approvals.cancel(approvalId, reason);
      },

      async wait(threadId: ThreadId, approvalId: ApprovalId, signal: AbortSignal) {
        await known(approvals, threadId, approvalId);
        const waited = await approvals.wait(approvalId, signal);
        return waited.ok
          ? ok(snapshotOfResolution(approvalId, waited.value))
          : err({ kind: "cancelled" as const });
      },
    };
    return port;
  };
}
