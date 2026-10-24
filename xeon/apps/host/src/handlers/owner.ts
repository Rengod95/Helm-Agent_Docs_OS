import { assertNever } from "@xeon/contracts";
import { wireError, type WireError } from "@xeon/contracts/wire";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { ConnectionHub } from "../connection-types.ts";
import type { Engine, HostMode, OwnerKind } from "../types.ts";

// L4.host-service.spec HS-24 3단계, HS-25. 쓰기 소유를 얻지 못했을 때의 오류와 호스트 모드별 소유 표시 종류.

/** 호스트 모드 → sys_leases.kind. in-process → cli, stdio → app, service → service */
export function ownerKindOf(mode: HostMode): OwnerKind {
  switch (mode) {
    case "in-process":
      return "cli";
    case "stdio":
      return "app";
    case "service":
      return "service";
    default:
      return assertNever(mode, "HostMode");
  }
}

/**
 * thread.locked(3002)의 대안(HS-25). "observe"와 "fork"는 항상 넣는다. "delegate"는 서비스에 접속할 수 있고 이 호스트가
 * 서비스가 아닐 때만 넣는데 서비스 모드(M3)가 없는 M1에서는 넣지 않는다.
 */
function lockedOptions(): readonly ("observe" | "fork" | "delegate")[] {
  return ["observe", "fork"];
}

export function threadLocked(ownerKind: OwnerKind | null): WireError {
  return wireError("thread.locked", {
    details: { ownerKind: ownerKind ?? "unknown", options: [...lockedOptions()] },
  });
}

/**
 * 이 프로세스가 thread의 쓰기 소유를 쥐게 하고 연결에 기록한다(HS-23, HS-24, HS-28). 이미 쥐었으면 그대로 쓴다.
 * 얻지 못하면 3002 `thread.locked`와 대안이다. 기다리는 동안 연결이 닫혔으면 기록하지 않고 필요 없어진 잠금을 놓는다.
 */
export async function claimWrite(
  engine: Engine,
  hub: ConnectionHub,
  connectionId: string,
  threadId: ThreadId,
): Promise<void> {
  const { locks } = engine.ports;
  if (!locks.holds(threadId)) {
    const lock = await locks.tryAcquire(threadId, ownerKindOf(engine.mode));
    if (!lock.ok) throw threadLocked(lock.ownerKind);
  }
  const conn = hub.state(connectionId);
  if (conn === undefined || conn.phase === "closed") {
    hub.releaseUnused([threadId]);
    throw wireError("request.cancelled");
  }
  conn.openThreads.add(threadId);
  conn.writeThreads.add(threadId);
}
