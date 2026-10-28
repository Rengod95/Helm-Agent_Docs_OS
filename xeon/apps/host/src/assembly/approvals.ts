import { eachAsync, err, ok, parse, type Result } from "@xeon/contracts";
import type { EventId, ThreadId } from "@xeon/contracts/conversation";
import {
  ApprovalRequestedPayloadSchema,
  type ReadFailure,
  type SessionService,
} from "@xeon/contracts/records";
import type { ApprovalResponse, ApprovalService } from "@xeon/contracts/services";
import type { PendingApproval, StoreId, WireResult } from "@xeon/contracts/wire";
import type { ApprovalListFailure, ApprovalPort } from "../types.ts";

// F.wire-settings.spec §4.6 A안, §3.4.6 5항. approval.respond는 L1.tools의 ApprovalService로 넘기고, approval.list는 저장소에서 읽는다.
// 조립 루트 코드(DR-14 예외 2).

export interface ApprovalPortDeps {
  readonly approvals: ApprovalService;
  readonly session: SessionService;
  readonly storeId: StoreId;
  /** 이 프로세스가 쓰기 소유를 쥔 thread. 재시작 뒤 메모리 대기 목록을 되살릴 대상이다 */
  readonly heldThreads: () => readonly ThreadId[];
}

/** 한 번에 훑는 thread 목록 쪽 크기(`ThreadListQuery.limit` 상한) */
const LIST_PAGE = 200;

/** 승인 요청 이벤트(approval.requested)의 payload를 스키마로 검사한다. 저장된 payload가 다르면 읽기 실패다 */
function requestOf(
  payload: unknown,
): Result<PendingApproval["request"], Extract<ReadFailure, { kind: "row_invalid" }>> {
  const parsed = parse(ApprovalRequestedPayloadSchema, payload);
  return parsed.ok
    ? ok(parsed.value)
    : err({ kind: "row_invalid", where: "events.payload(approval.requested)" });
}

export function createApprovalPort(deps: ApprovalPortDeps): ApprovalPort {
  const { approvals, session, storeId } = deps;

  /** 저장소에서 미해결 요청 id를 가진 thread를 찾는다. 승인이 대기 중인 thread만 훑는다 */
  function findInStore(approvalId: string): Result<ThreadId | undefined, ReadFailure> {
    let cursor: string | undefined;
    for (;;) {
      const page = session.threads.list({
        includeClosed: true,
        limit: LIST_PAGE,
        ...(cursor === undefined ? {} : { cursor }),
      });
      for (const row of page.threads) {
        if (row.pendingApprovals === 0) continue;
        const pending = session.query.pendingApprovals(row.threadId);
        if (!pending.ok) return pending;
        if (pending.value.some((view) => !view.resolved && view.approvalId === approvalId)) {
          return ok(row.threadId);
        }
      }
      if (page.nextCursor === null) return ok(undefined);
      cursor = page.nextCursor;
    }
  }

  return {
    async locate(approvalId): Promise<Result<ThreadId | undefined, ReadFailure>> {
      const known = approvals.get(approvalId);
      if (known !== undefined) return ok(known.request.surfaceThreadId);
      // 재시작 직후에는 메모리 대기 목록이 비어 있다. 쥔 thread의 미해결 요청을 저장소에서 되살린 뒤 다시 찾는다(L1.tools restore)
      const restored = await eachAsync<ThreadId, Result<ThreadId, ReadFailure>>(
        deps.heldThreads(),
        async (threadId) => {
          const read = await approvals.restore(threadId);
          if (!read.ok) return { value: err(read.error) };
          const found = approvals.get(approvalId);
          return found === undefined ? undefined : { value: ok(found.request.surfaceThreadId) };
        },
      );
      if (restored !== undefined) return restored.value;
      return findInStore(approvalId);
    },

    async respond(params) {
      const response: ApprovalResponse = {
        decision: params.decision,
        ...(params.answer === undefined ? {} : { answer: params.answer }),
        ...(params.remember === undefined ? {} : { remember: params.remember }),
      };
      return await approvals.respond(params.approvalId, response);
    },

    list: listPending,
  };

  /**
   * 위치(head)와 미해결 요청 id 조회는 같은 동기 구간에서 한다: 두 값이 같은 저장소 상태를 본다.
   * 요청이 하나도 없으면 여기서 끝난다(승인이 대기 중인 thread에만 요청하는 것이 보통이다, §3.4.6 5항)
   */
  async function listPending(
    threadId: ThreadId,
  ): Promise<Result<WireResult<"approval.list">, ApprovalListFailure>> {
    const found = session.query.thread(threadId);
    if (!found.ok) return found;
    if (found.value === undefined) return err({ kind: "thread_not_found", threadId });
    const headRead = session.feed.headSeq();
    if (!headRead.ok) return headRead;
    const head = headRead.value;
    const pendingRead = session.query.pendingApprovals(threadId);
    if (!pendingRead.ok) return pendingRead;
    const wanted = new Set<EventId>(
      pendingRead.value.filter((view) => !view.resolved).map((view) => view.approvalId),
    );
    const position = { storeId, seq: head };
    if (wanted.size === 0) return ok({ approvals: [], position });

    const pending: PendingApproval[] = [];
    for await (const read of session.readFrom(0, { threadId })) {
      if (!read.ok) return read;
      const event = read.value;
      if (event.seq > head) break;
      if (event.kind !== "approval.requested" || !wanted.has(event.id)) continue;
      const request = requestOf(event.payload);
      if (!request.ok) return request;
      pending.push({ approvalId: event.id, seq: event.seq, request: request.value });
      if (pending.length === wanted.size) break;
    }
    return ok({ approvals: pending, position });
  }
}
