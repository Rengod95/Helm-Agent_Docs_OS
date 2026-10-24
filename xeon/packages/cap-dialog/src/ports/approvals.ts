import { canonicalJson, err, ok, parse, type Result } from "@xeon/contracts";
import type { CallContext } from "@xeon/contracts/capabilities";
import { ApprovalIdSchema, type ApprovalId, type ThreadId } from "@xeon/contracts/conversation";
import { ApprovalBodyJsonSchema, type ReadFailure } from "@xeon/contracts/records";
import {
  L2_APPROVAL_REQUEST_ID_MAX,
  type ApprovalOrigin,
  type ApprovalRequestError,
  type ApprovalResolution,
  type ApprovalService,
  type CallerId,
  type L2ApprovalRequest,
  type L2ApprovalRespondInput,
  type L2ApprovalSnapshot,
  type L2ApprovalsPort,
  type OpenedApproval,
} from "@xeon/contracts/services";

export type { L2ApprovalsPort };

/**
 * 승인 프로토콜(`xeon.approvals`, kind `question`)을 쓰는 유일한 자리(L2.dialog.spec §4.1.1).
 * 포트 모양은 F의 L2 공통 `L2ApprovalsPort`(L2.readme §5.7)다. 이 포트는 요청이 낸 쪽(출처)을 호출마다 정해야 해서
 * 호출 문맥으로 포트를 만드는 팩토리로 받는다: 도구 호출 안이면 문맥의 `toolCallId`·`turnId`가 요청의 `origin`이 되어
 * L1.tools가 그 호출의 대기 체크포인트를 같은 커밋에 넣는다.
 *
 * 기본 구현은 `questionApprovalsOver`다. 조립 루트는 이 팩토리를 `dialogPlugin({ approvals })`로 바꿔 넣을 수도 있다.
 */
export interface ApprovalsPortFactory {
  forCall(context: CallContext | undefined): L2ApprovalsPort;
}

const REQUEST_ID_MAX = L2_APPROVAL_REQUEST_ID_MAX;
const QUESTION_TITLE = "Answer the questions";

function callerOf(context: CallContext | undefined): CallerId {
  const caller = context?.caller;
  return caller?.agent === "subagent" ? `subagent:${caller.extension ?? "agent"}` : "main";
}

function rejected(detail: string): ApprovalRequestError {
  return { kind: "rejected", code: "approvals.request_invalid", detail };
}

function approvalIdOf(raw: string): ApprovalId | undefined {
  const parsed = parse(ApprovalIdSchema, raw);
  return parsed.ok ? parsed.value : undefined;
}

function snapshotOfResolution(
  approvalId: ApprovalId,
  resolution: ApprovalResolution,
): L2ApprovalSnapshot {
  // 닫힘(cancelled)과 다른 응답에 밀림(superseded)은 답이 아니라 철회다
  const closed = resolution.resolvedBy === "cancelled" || resolution.resolvedBy === "superseded";
  return {
    approvalId,
    state: closed ? "cancelled" : "resolved",
    resolution: { decision: resolution.decision, answer: resolution.answer },
  };
}

function snapshotOf(opened: OpenedApproval): L2ApprovalSnapshot | undefined {
  const approvalId = approvalIdOf(opened.request.approvalId);
  if (approvalId === undefined) return undefined;
  return opened.resolution === null
    ? { approvalId, state: "pending", resolution: null }
    : snapshotOfResolution(approvalId, opened.resolution);
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
 * `xeon.approvals`를 질문 승인용 `L2ApprovalsPort`로 감싼다. 규칙:
 * - 요청 대상(`subject`)은 F `QuestionBody`(`{ questions }`) 모양이다. `toQuestionBody`가 만든다.
 * - 요청 멱등 키는 L2 `requestId`(1~48자) 그대로다. 같은 키로 다시 부르면 서비스가 처음 요청과 현재 해결 상태를 돌려준다(재시작 뒤에도 같다).
 *   서비스가 내용을 비교하지 않으므로 질문 묶음이 처음과 다르면 이 어댑터가 `key_reused`로 거부한다.
 * - 서비스의 메모리 대기 목록은 재시작하면 비므로, 모르는 approvalId를 다루기 전에 그 대화의 미해결 요청을 이벤트에서 다시 읽는다(`restore`).
 * - 응답 모양 검사는 서비스가 한다(kind question: decision `answer`에 `QuestionAnswer`, `deny`에 선택적 `{ feedback }`). 어긋나면 `applied: false`다.
 */
export function questionApprovalsOver(approvals: ApprovalService): ApprovalsPortFactory {
  return {
    forCall(context) {
      const origin = {
        turnId: context?.turnId ?? null,
        stepId: null,
        toolCallId: context?.toolCallId ?? null,
        caller: callerOf(context),
      } satisfies Omit<ApprovalOrigin, "threadId">;

      const port: L2ApprovalsPort = {
        async request(
          input: L2ApprovalRequest,
        ): Promise<Result<L2ApprovalSnapshot, ApprovalRequestError>> {
          if (input.requestId.length < 1 || input.requestId.length > REQUEST_ID_MAX) {
            return err(rejected(`requestId must be 1-${REQUEST_ID_MAX} characters`));
          }
          const shape =
            input.kind === "question"
              ? parse(ApprovalBodyJsonSchema, { kind: "question", question: input.subject })
              : undefined;
          if (shape === undefined || !shape.ok || shape.value.kind !== "question") {
            return err(rejected("ask makes question approvals only"));
          }
          const body = {
            kind: "question",
            question: { questions: shape.value.question.questions },
          } as const;
          const opened = await approvals.open({
            origin: { ...origin, threadId: input.threadId },
            requestKey: input.requestId,
            title: QUESTION_TITLE,
            body,
            remember: ["once"],
          });
          if (!opened.ok) return opened;
          // 서비스는 같은 키의 두 번째 요청에 처음 요청을 돌려줄 뿐 내용을 비교하지 않는다. 포트 계약은 다른 내용이면 key_reused다
          if (canonicalJson(opened.value.request.body) !== canonicalJson(body)) {
            return err({ kind: "key_reused", requestId: input.requestId });
          }
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
    },
  };
}
