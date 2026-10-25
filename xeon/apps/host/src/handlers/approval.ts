import { assertNever } from "@xeon/contracts";
import type { WireError, WireHandler } from "@xeon/contracts/wire";
import { wireErrorOfStore } from "../store-error.ts";
import type { ApprovalListFailure, Engine } from "../types.ts";
import { threadLocked } from "./owner.ts";

// L4.host-service.spec §3.4 M2 표, F wire §4.6 A안과 §3.4.6 5항. approval.respond와 approval.list (HOST.4).

function listFailure(error: ApprovalListFailure): WireError {
  switch (error.kind) {
    case "thread_not_found":
    case "busy":
    case "io":
    case "row_invalid":
      return wireErrorOfStore(error, "approval.list");
    default:
      return assertNever(error, "ApprovalListFailure");
  }
}

/**
 * 승인 응답을 L1.tools에 넘긴다. 모르는 `approvalId`이면 `applied: false`와 이유 `unknown_approval`이다(이미 해결됐거나 응답이 맞지 않은 이유는
 * L1.tools가 `already_resolved`·`answer_invalid`로 낸다, F wire §3.3.1).
 * 요청이 속한 thread를 이 프로세스가 쥐지 않았으면 3002다: 응답은 그 thread의 `approval.resolved` 커밋이라 쓰기 소유가 있어야 한다.
 * 재시작 직후에는 메모리 대기 목록이 비어 있으므로 포트가 쥔 thread의 미해결 요청을 먼저 되살린다(`restore`).
 */
export function createApprovalRespondHandler(engine: Engine): WireHandler<"approval.respond"> {
  const { approvals, locks } = engine.ports;
  return async (params) => {
    const located = await approvals.locate(params.approvalId);
    if (!located.ok) throw wireErrorOfStore(located.error, "approval.respond lookup");
    const threadId = located.value;
    if (threadId === undefined) return { applied: false, reason: "unknown_approval" };
    if (!locks.holds(threadId)) throw threadLocked(null);
    return await approvals.respond(params);
  };
}

/** 소유 없이도 읽는다. 승인이 대기 중인 thread(`ThreadSummary.pendingApprovals > 0`)에만 요청하는 것이 보통이다 */
export function createApprovalListHandler(engine: Engine): WireHandler<"approval.list"> {
  const { approvals } = engine.ports;
  return async (params) => {
    const listed = await approvals.list(params.threadId);
    if (!listed.ok) throw listFailure(listed.error);
    return listed.value;
  };
}
