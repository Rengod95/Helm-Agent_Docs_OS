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
 * thread 하나에 대해 지금 진행 중인 소유 획득과 빌린 잠금의 장부(엔진마다 따로). 처리기들이 같은 `holds`를 보므로, 한 처리기가
 * 한 번만 쓰려고 빌린 잠금을 다른 처리기가 이미 쥔 소유로 착각하지 않게 하는 데 쓴다.
 */
interface ThreadUse {
  /** `claimWrite`가 잠금을 기다리거나 연결에 기록하는 중인 호출 수 */
  claimers: number;
  /** `withWriteOwner`로 이 thread에서 일하는 중인 호출 수 */
  borrowers: number;
  /** 빌리는 쪽이 잠금을 얻었다: 일이 끝나면 놓을 후보다. 연결이 소유로 이어받으면 거짓이 된다 */
  borrowed: boolean;
}

const usesByEngine = new WeakMap<Engine, Map<ThreadId, ThreadUse>>();

function useOf(engine: Engine, threadId: ThreadId): ThreadUse {
  const uses = usesByEngine.get(engine) ?? new Map<ThreadId, ThreadUse>();
  usesByEngine.set(engine, uses);
  const existing = uses.get(threadId);
  if (existing !== undefined) return existing;
  const created: ThreadUse = { claimers: 0, borrowers: 0, borrowed: false };
  uses.set(threadId, created);
  return created;
}

function forgetIfIdle(engine: Engine, threadId: ThreadId, use: ThreadUse): void {
  if (use.claimers === 0 && use.borrowers === 0) usesByEngine.get(engine)?.delete(threadId);
}

/**
 * 이 프로세스가 thread의 쓰기 소유를 쥐게 하고 연결에 기록한다(HS-23, HS-24, HS-28). 이미 쥐었으면 그대로 쓴다.
 * 얻지 못하면 3002 `thread.locked`와 대안이다. 기다리는 동안 연결이 닫혔으면 기록하지 않고 필요 없어진 잠금을 놓는다.
 * 연결에 기록하면 같은 thread에서 잠금을 빌려 쓰던 처리기(`withWriteOwner`)의 잠금이 이 연결의 소유가 된다.
 */
export async function claimWrite(
  engine: Engine,
  hub: ConnectionHub,
  connectionId: string,
  threadId: ThreadId,
): Promise<void> {
  const { locks } = engine.ports;
  const use = useOf(engine, threadId);
  use.claimers += 1;
  try {
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
    use.borrowed = false;
  } finally {
    use.claimers -= 1;
    forgetIfIdle(engine, threadId, use);
  }
}

/**
 * 쓰기 소유가 필요한 일 하나를 하고, 소유를 쥐지 않았으면 이 호출이 한 번 얻어서 쓰고 놓는다(`thread.rename`, `thread.delete`, HS-28·HS-73).
 * 이미 쥐었으면 그대로 일한다. 얻지 못하면 3002다.
 *
 * 처리기마다 `holds`로 "내가 얻었는가"를 따로 보면 어긋난다. 이 호출이 빌린 잠금도 `holds`에는 쥔 것으로 보이므로, 같은 thread의 다른 연결이
 * 그동안 `turn.start`나 `thread.open`으로 소유를 이어받았는데 이 호출이 일을 마치고 놓아 버리면 그 연결이 잠금 없이 쓰게 된다.
 * 그래서 놓는 것은 빌린 호출 가운데 마지막이 끝날 때 하고, 그때 쓰기로 연 연결이 있거나(`writeThreads`), 소유를 얻는 중인 호출이 있거나,
 * turn이 도는 중이면 놓지 않는다. 다른 호출이 빌려 둔 잠금 위에서 일하는 호출도 빌린 호출로 센다.
 */
export async function withWriteOwner<T>(
  engine: Engine,
  hub: ConnectionHub,
  threadId: ThreadId,
  work: () => Promise<T> | T,
): Promise<T> {
  const { locks, turns } = engine.ports;
  const use = useOf(engine, threadId);
  use.borrowers += 1;
  try {
    if (!locks.holds(threadId)) {
      const lock = await locks.tryAcquire(threadId, ownerKindOf(engine.mode));
      if (!lock.ok) throw threadLocked(lock.ownerKind);
      use.borrowed = true;
    }
    return await work();
  } finally {
    use.borrowers -= 1;
    if (use.borrowers === 0) {
      const toRelease = use.borrowed;
      use.borrowed = false;
      const adopted =
        use.claimers > 0 ||
        hub.connections().some((conn) => conn.writeThreads.has(threadId)) ||
        turns.isLive(threadId);
      forgetIfIdle(engine, threadId, use);
      if (toRelease && !adopted && locks.holds(threadId)) await locks.release(threadId);
    }
  }
}
