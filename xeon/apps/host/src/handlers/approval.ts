import { assertNever } from "@fresnel/contracts";
import type { WireError, WireHandler } from "@fresnel/contracts/wire";
import { approvalMaskEntries } from "../display-mask.ts";
import { wireErrorOfStore } from "../store-error.ts";
import type { ConnectionHub } from "../connection-types.ts";
import type { ApprovalListFailure, Engine } from "../types.ts";
import { withWriteOwner } from "./owner.ts";

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
 * 응답은 그 thread의 `approval.resolved` 커밋이라 쓰기 소유가 있어야 한다. 소유를 쥐지 않았으면 이 호출이 한 번 얻어서 쓰고 놓는다
 * (`withWriteOwner`, HS-52): 소유를 얻을 때 포트가 미해결 요청을 메모리 대기로 되살리므로, 재시작 뒤 받은 요청에서 바로 답해도 찾는다.
 * 다른 프로세스가 쥐고 있으면 3002다. turn을 잇는 일은 `turn.resume`(HS-74)이 따로 한다.
 */
export function createApprovalRespondHandler(
  engine: Engine,
  hub: () => ConnectionHub,
): WireHandler<"approval.respond"> {
  const { approvals } = engine.ports;
  return async (params) => {
    const located = await approvals.locate(params.approvalId);
    if (!located.ok) throw wireErrorOfStore(located.error, "approval.respond lookup");
    const threadId = located.value;
    if (threadId === undefined) return { applied: false, reason: "unknown_approval" };
    return await withWriteOwner(engine, hub(), threadId, () => approvals.respond(params));
  };
}

/**
 * 소유 없이도 읽는다. 승인이 대기 중인 thread(`ThreadSummary.pendingApprovals > 0`)에만 요청하는 것이 보통이다.
 * `threadId`를 생략하면 닫히지 않은 모든 대화의 대기 승인이다(W-01)
 */
export function createApprovalListHandler(engine: Engine): WireHandler<"approval.list"> {
  const { approvals } = engine.ports;
  return async (params) => {
    const listed =
      params.threadId === undefined
        ? await approvals.listAll()
        : await approvals.list(params.threadId);
    if (!listed.ok) throw listFailure(listed.error);
    // 화면 가림 표식은 목록 옆에 붙인다. 승인 목록은 바뀌지 않는다(L0.secrets.spec §3.5.1)
    const masks = approvalMaskEntries(engine.ports.secrets.display, listed.value.approvals);
    return masks.length === 0 ? listed.value : { ...listed.value, masks };
  };
}
