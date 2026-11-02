import { eachAsync, err, ok, parse, type Result } from "@fresnel/contracts";
import type { EventId, ThreadId } from "@fresnel/contracts/conversation";
import {
  ApprovalRequestedPayloadSchema,
  type ReadFailure,
  type SessionService,
} from "@fresnel/contracts/records";
import type { ApprovalResponse, ApprovalService } from "@fresnel/contracts/services";
import type { PendingApproval, StoreId, WireResult } from "@fresnel/contracts/wire";
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

/** `approval.list`가 돌려줄 대기 승인 수 상한. `ApprovalListResultSchema`의 `maxItems`와 같다(계약 쪽 상수는 내보내지 않는다) */
const APPROVAL_LIST_MAX = 1000;

/** 열려 있는 thread 하나의 아직 해결되지 않은 승인 요청 id. `listAll`이 목록을 넘기며 모은다 */
interface OpenWanted {
  readonly threadId: ThreadId;
  readonly wanted: ReadonlySet<EventId>;
}

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
    listAll,
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
    const wanted = unresolvedOf(threadId);
    if (!wanted.ok) return wanted;
    const requests = await requestsOf(threadId, wanted.value, head);
    if (!requests.ok) return requests;
    return ok({ approvals: requests.value, position: { storeId, seq: head } });
  }

  /**
   * 닫히지 않은 모든 thread의 미해결 요청(W-01). 위치는 한 번만 잰다. 목록 쪽을 넘기며 각 thread의 미해결 id를 모으는 일은
   * 동기로 끝내서 위치와 같은 저장소 상태를 본다. 그 뒤 이벤트를 읽는 일은 `seq <= head`인 이벤트만 쓰므로 비동기로 해도 된다.
   */
  async function listAll(): Promise<Result<WireResult<"approval.list">, ApprovalListFailure>> {
    const headRead = session.feed.headSeq();
    if (!headRead.ok) return headRead;
    const head = headRead.value;
    const open = unresolvedInOpenThreads();
    if (!open.ok) return open;
    const perThread = await Promise.all(
      open.value.map((group) => requestsOf(group.threadId, group.wanted, head)),
    );
    const collected: PendingApproval[] = [];
    for (const requests of perThread) {
      if (!requests.ok) return requests;
      for (const approval of requests.value) collected.push(approval);
    }
    // 전역 seq라 순서가 한 가지로 정해진다. 상한을 넘으면 가장 오래된 것부터 남긴다
    const sorted = collected.toSorted((a, b) => a.seq - b.seq);
    return ok({
      approvals: sorted.slice(0, APPROVAL_LIST_MAX),
      position: { storeId, seq: head },
    });
  }

  /** 열려 있는 thread 가운데 아직 해결되지 않은 승인 요청이 있는 것만 모은다. `pendingApprovals`가 0인 thread는 읽지 않는다 */
  function unresolvedInOpenThreads(): Result<readonly OpenWanted[], ReadFailure> {
    const groups: OpenWanted[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = session.threads.list({
        includeClosed: false,
        limit: LIST_PAGE,
        ...(cursor === undefined ? {} : { cursor }),
      });
      for (const row of page.threads) {
        if (row.pendingApprovals === 0) continue;
        const found = session.query.thread(row.threadId);
        if (!found.ok) return found;
        // 목록을 읽은 뒤 지워진 thread(thread_not_found)는 건너뛴다
        if (found.value === undefined) continue;
        const wanted = unresolvedOf(row.threadId);
        if (!wanted.ok) return wanted;
        if (wanted.value.size > 0) groups.push({ threadId: row.threadId, wanted: wanted.value });
      }
      if (page.nextCursor === null) return ok(groups);
      cursor = page.nextCursor;
    }
  }

  /** thread의 아직 해결되지 않은 승인 요청 id. 투영을 한 번 읽는다 */
  function unresolvedOf(threadId: ThreadId): Result<ReadonlySet<EventId>, ReadFailure> {
    const pending = session.query.pendingApprovals(threadId);
    if (!pending.ok) return pending;
    return ok(
      new Set(pending.value.filter((view) => !view.resolved).map((view) => view.approvalId)),
    );
  }

  /**
   * `wanted`인 승인 요청 이벤트를 thread의 이벤트에서 찾는다. `head` 뒤의 이벤트는 위치 밖이라 무시한다(이 함수는 `head`를 받을 뿐 다시 읽지 않는다).
   */
  async function requestsOf(
    threadId: ThreadId,
    wanted: ReadonlySet<EventId>,
    head: number,
  ): Promise<Result<PendingApproval[], ReadFailure>> {
    const pending: PendingApproval[] = [];
    if (wanted.size === 0) return ok(pending);
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
    return ok(pending);
  }
}
