// 이 패키지가 발화하는 훅 7개(L1.persistence.spec §7.1, PS-17). 발화는 ExtHost.dispatch로만 한다.
// first 훅(session_before_*)은 커밋 전, 트랜잭션 밖에서 await하고, tap 훅은 커밋 뒤에 발화한다.
import type { ThreadId } from "@fresnel/contracts/conversation";
import type {
  ResourcesDiscoverPayload,
  ResourcesValue,
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
} from "@fresnel/contracts/extensions";
import type { ExtHost } from "@fresnel/ext-host";

/** 훅 발화에 필요한 ExtHost의 부분 */
export type SessionDispatcher = Pick<ExtHost, "dispatch">;

/** 열기 훅(thread.resources)이 아무도 기여하지 않았을 때의 값. 배열은 새로 만든다 */
export function emptyResources(): ResourcesValue {
  return { skillPaths: [], promptPaths: [], themePaths: [], workspaceCandidates: [] };
}

/** 결정이 취소면 그 이유를 돌려주고, 계속이면 undefined */
export interface ThreadHooks {
  /**
   * thread.resources (collect). 대화를 열 때마다 `thread.start` 앞에서 한 번 부른다(H-7). 실패는 열기를 막지 않는다(open)
   * [제안: 사유 `startup`은 새 대화와 포크와 처음 열기, `reload`는 다시 열기다. 열기 사유를 pi 어휘에 맞춘 것이다]
   */
  resources(
    threadId: ThreadId,
    payload: ResourcesDiscoverPayload,
    dispatchKey: string,
  ): Promise<ResourcesValue>;
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
export const NO_THREAD_HOOKS: ThreadHooks = {
  resources: () => Promise.resolve(emptyResources()),
  start: () => Promise.resolve(),
  infoChanged: () => Promise.resolve(),
  beforeSwitch: () => Promise.resolve(undefined),
  beforeFork: () => Promise.resolve(undefined),
  beforeTree: () => Promise.resolve(undefined),
  tree: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};

export function createThreadHooks(ext: SessionDispatcher): ThreadHooks {
  return {
    async resources(threadId, payload, dispatchKey): Promise<ResourcesValue> {
      const outcome = await ext.dispatch("thread.resources", payload, {
        threadId,
        dispatchKey,
        initial: emptyResources(),
      });
      return outcome.value;
    },
    async start(payload, dispatchKey): Promise<void> {
      await ext.dispatch("thread.start", payload, { threadId: payload.threadId, dispatchKey });
    },
    async infoChanged(payload, dispatchKey): Promise<void> {
      await ext.dispatch("thread.info.after", payload, {
        threadId: payload.threadId,
        dispatchKey,
      });
    },
    async beforeSwitch(threadId, payload, dispatchKey) {
      const outcome = await ext.dispatch("thread.switch.before", payload, {
        threadId,
        dispatchKey,
      });
      return outcome.decision;
    },
    async beforeFork(payload, dispatchKey) {
      const outcome = await ext.dispatch("thread.fork.before", payload, {
        threadId: payload.threadId,
        dispatchKey,
      });
      return outcome.decision;
    },
    async beforeTree(payload, dispatchKey) {
      const outcome = await ext.dispatch("thread.tree.before", payload, {
        threadId: payload.threadId,
        dispatchKey,
      });
      return outcome.decision;
    },
    async tree(payload, dispatchKey): Promise<void> {
      await ext.dispatch("thread.tree.after", payload, {
        threadId: payload.threadId,
        dispatchKey,
      });
    },
    async shutdown(threadId, payload, dispatchKey): Promise<void> {
      await ext.dispatch("thread.shutdown", payload, { threadId, dispatchKey });
    },
  };
}
