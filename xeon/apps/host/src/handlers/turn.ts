import { assertNever } from "@xeon/contracts";
import type { LoopError } from "@xeon/contracts/services";
import { wireError, type WireError, type WireHandler } from "@xeon/contracts/wire";
import type { ConnectionHub } from "../connection-types.ts";
import type { Engine } from "../types.ts";
import { ownerKindOf, threadLocked } from "./owner.ts";

// L4.host-service.spec §3.4 M1 표, HS-22, HS-28. turn.start: 쓰기 소유를 확인하고 없으면 암묵 획득한 뒤 입력을 제출한다.
// 응답은 접수만 뜻한다. 접수 뒤 취소가 와도 turn은 멈추지 않는다. turn.interrupt는 M2다.

/**
 * loop.admit가 입력을 받지 않은 이유를 와이어 오류로 옮긴다. 와이어 오류 목록(F.wire-settings §3.5.2)에 저장소 부족·읽기 전용·
 * 저장소 사용 중 전용 kind가 없어 `internal`(-32603)에 원인을 메시지로 싣는다 [미결: 전용 kind를 F에 추가할지]
 */
function admitRejection(error: LoopError): WireError {
  switch (error.kind) {
    case "thread_not_found":
      return wireError("thread.notFound", { details: { threadId: error.threadId } });
    case "turn_aborting":
      return wireError("turn.busy", { details: { turnId: error.turnId } });
    case "ownership_lost":
    case "stale_lease":
      return threadLocked(null);
    case "input_invalid":
      return wireError("jsonrpc.invalidParams", {
        details: { issues: [{ path: "input", message: error.message.slice(0, 512) }] },
      });
    case "busy":
    case "disk_full":
      return wireError("internal", { message: `turn.start rejected: store ${error.kind}` });
    case "read_only":
      return wireError("internal", {
        message: `turn.start rejected: store read_only (${error.reason})`,
      });
    default:
      return assertNever(error, "LoopError");
  }
}

export function createTurnStartHandler(
  engine: Engine,
  hub: () => ConnectionHub,
): WireHandler<"turn.start"> {
  const { ports } = engine;
  return async (params, context) => {
    const { threadId } = params;
    if (!ports.threads.exists(threadId)) {
      throw wireError("thread.notFound", { details: { threadId } });
    }
    if (!ports.locks.holds(threadId)) {
      const lock = await ports.locks.tryAcquire(threadId, ownerKindOf(engine.mode));
      if (!lock.ok) throw threadLocked(lock.ownerKind);
    }
    hub().state(context.connectionId)?.openThreads.add(threadId);
    const outcome = await ports.turns.submit(threadId, params.input, params.requestId);
    if (!outcome.ok) {
      if (outcome.reason === "rejected") throw admitRejection(outcome.error);
      throw wireError("turn.busy", { details: { turnId: outcome.turnId } });
    }
    return { turnId: outcome.turnId };
  };
}
