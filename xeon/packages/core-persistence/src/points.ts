// 이 패키지가 발화하는 확장 지점 7개(L1.persistence.spec §7.1, PS-17). 발화는 ExtHost.dispatch로만 한다.
// first 지점(session_before_*)은 커밋 전, 트랜잭션 밖에서 await하고, tap 지점은 커밋 뒤에 발화한다.
import type { ThreadId } from "@xeon/contracts/conversation";
import type {
  SessionBeforeForkDecision,
  SessionBeforeForkPayload,
  SessionBeforeSwitchPayload,
  SessionBeforeTreeDecision,
  SessionBeforeTreePayload,
  SessionCancelDecision,
  SessionInfoChangedPayload,
  SessionShutdownPayload,
  SessionStartPayload,
  SessionTreePayload,
} from "@xeon/contracts/extensions";
import type { ExtHost } from "@xeon/ext-host";

/** 지점 발화에 필요한 ExtHost의 부분 */
export type SessionDispatcher = Pick<ExtHost, "dispatch">;

/** 결정이 취소면 그 이유를 돌려주고, 계속이면 undefined */
export interface SessionPoints {
  /** session_start (tap). 커밋과 복구 뒤 */
  start(payload: SessionStartPayload, dispatchKey: string): Promise<void>;
  /** session_info_changed (tap, detached). 제목 커밋 뒤 */
  infoChanged(payload: SessionInfoChangedPayload, dispatchKey: string): Promise<void>;
  /** session_before_switch (first). 커밋 없음 */
  beforeSwitch(
    threadId: ThreadId,
    payload: SessionBeforeSwitchPayload,
    dispatchKey: string,
  ): Promise<SessionCancelDecision | undefined>;
  /** session_before_fork (first). fork 커밋 전 */
  beforeFork(
    payload: SessionBeforeForkPayload,
    dispatchKey: string,
  ): Promise<SessionBeforeForkDecision | undefined>;
  /** session_before_tree (first). moveLeaf·revert 커밋 전 */
  beforeTree(
    payload: SessionBeforeTreePayload,
    dispatchKey: string,
  ): Promise<SessionBeforeTreeDecision | undefined>;
  /** session_tree (tap). moveLeaf·revert 커밋 뒤 */
  tree(payload: SessionTreePayload, dispatchKey: string): Promise<void>;
  /** session_shutdown (tap). release 때. 커밋 없음 */
  shutdown(threadId: ThreadId, payload: SessionShutdownPayload, dispatchKey: string): Promise<void>;
}

/** 발화하지 않는다. ExtHost가 없는 조립과 시험이 쓴다 */
export const NO_SESSION_POINTS: SessionPoints = {
  start: () => Promise.resolve(),
  infoChanged: () => Promise.resolve(),
  beforeSwitch: () => Promise.resolve(undefined),
  beforeFork: () => Promise.resolve(undefined),
  beforeTree: () => Promise.resolve(undefined),
  tree: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};

export function createSessionPoints(ext: SessionDispatcher): SessionPoints {
  return {
    async start(payload, dispatchKey): Promise<void> {
      await ext.dispatch("session_start", payload, { threadId: payload.threadId, dispatchKey });
    },
    async infoChanged(payload, dispatchKey): Promise<void> {
      await ext.dispatch("session_info_changed", payload, {
        threadId: payload.threadId,
        dispatchKey,
      });
    },
    async beforeSwitch(threadId, payload, dispatchKey) {
      const outcome = await ext.dispatch("session_before_switch", payload, {
        threadId,
        dispatchKey,
      });
      return outcome.decision;
    },
    async beforeFork(payload, dispatchKey) {
      const outcome = await ext.dispatch("session_before_fork", payload, {
        threadId: payload.threadId,
        dispatchKey,
      });
      return outcome.decision;
    },
    async beforeTree(payload, dispatchKey) {
      const outcome = await ext.dispatch("session_before_tree", payload, {
        threadId: payload.threadId,
        dispatchKey,
      });
      return outcome.decision;
    },
    async tree(payload, dispatchKey): Promise<void> {
      await ext.dispatch("session_tree", payload, { threadId: payload.threadId, dispatchKey });
    },
    async shutdown(threadId, payload, dispatchKey): Promise<void> {
      await ext.dispatch("session_shutdown", payload, { threadId, dispatchKey });
    },
  };
}
