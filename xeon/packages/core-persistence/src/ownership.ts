import type { Logger } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { LeaseService, LeaseToken, ReadOnlyReason } from "@xeon/contracts/records";

/** 프로세스 안에서 thread를 연 방식. 쓰기 소유 증표(LeaseToken)는 열린 thread마다 보관한다(L1.persistence.spec §3.6) */
type OpenState =
  | {
      readonly role: "owner";
      readonly token: LeaseToken;
      /** 쓰기 열기를 했지만 버전 검사에 걸려 읽기 전용이면 이유가 있다 */
      readonly readOnly: ReadOnlyReason | null;
      /** 이 서비스가 직접 임대를 얻은 thread(자식 thread). release 때 임대도 반납한다 */
      readonly selfAcquired: boolean;
      readonly keepAlive: Disposable | null;
    }
  | { readonly role: "observer" };

export interface OpenSessions {
  stateOf(threadId: ThreadId): OpenState | undefined;
  set(threadId: ThreadId, state: OpenState): void;
  forget(threadId: ThreadId): OpenState | undefined;
}

export function createOpenSessions(): OpenSessions {
  const states = new Map<ThreadId, OpenState>();
  return {
    stateOf: (threadId) => states.get(threadId),
    set(threadId, state): void {
      states.set(threadId, state);
    },
    forget(threadId): OpenState | undefined {
      const prior = states.get(threadId);
      states.delete(threadId);
      return prior;
    },
  };
}

/** 커밋·방출 중 중첩 쓰기를 막는 표지(TX-09). 서비스 하나에 하나 */
export interface GuardState {
  writing: boolean;
  notifying: boolean;
}

export function createGuardState(): GuardState {
  return { writing: false, notifying: false };
}

/**
 * thread의 열기 상태를 놓는다: 하트비트를 멈추고, 이 서비스가 직접 얻은 임대(자식 thread)만 반납한다.
 * 호스트가 준 토큰은 호스트가 반납한다
 */
export function releaseOpenSession(
  sessions: OpenSessions,
  leases: LeaseService,
  logger: Logger | undefined,
  threadId: ThreadId,
): void {
  const prior = sessions.forget(threadId);
  if (prior?.role !== "owner") return;
  prior.keepAlive?.[Symbol.dispose]();
  if (!prior.selfAcquired) return;
  const released = leases.release(prior.token);
  if (!released.ok) logger?.warn("session.release_failed", { reason: released.error.kind });
}
