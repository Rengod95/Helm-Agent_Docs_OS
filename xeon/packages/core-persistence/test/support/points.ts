// 훅 발화를 기록하는 ThreadHooks 대역(L1.persistence.spec §7.1). first 훅은 설정한 대로 취소하거나 요약을 준다.
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ThreadHooks } from "../../src/index.ts";

export interface PointCall {
  readonly point: string;
  readonly threadId: ThreadId;
  readonly payload: unknown;
}

export interface RecordingHooksOptions {
  /** 훅 이름 → 취소 이유. 있으면 그 first 훅이 취소를 결정한다 */
  readonly cancel?: Readonly<
    Partial<Record<"thread.switch.before" | "thread.fork.before" | "thread.tree.before", string>>
  >;
  /** session_before_tree가 계속하면서 주는 요약 */
  readonly treeSummary?: { readonly summary: string };
}

export function recordingHooks(options: RecordingHooksOptions = {}): {
  readonly points: ThreadHooks;
  readonly calls: PointCall[];
} {
  const calls: PointCall[] = [];
  const record = (point: string, threadId: ThreadId, payload: unknown): void => {
    calls.push({ point, threadId, payload });
  };
  const points: ThreadHooks = {
    start(payload) {
      record("thread.start", payload.threadId, payload);
      return Promise.resolve();
    },
    infoChanged(payload) {
      record("thread.info.after", payload.threadId, payload);
      return Promise.resolve();
    },
    beforeSwitch(threadId, payload) {
      record("thread.switch.before", threadId, payload);
      const reason = options.cancel?.["thread.switch.before"];
      return Promise.resolve(reason === undefined ? undefined : { cancel: true, reason });
    },
    beforeFork(payload) {
      record("thread.fork.before", payload.threadId, payload);
      const reason = options.cancel?.["thread.fork.before"];
      return Promise.resolve(
        reason === undefined ? { cancel: false as const } : { cancel: true as const, reason },
      );
    },
    beforeTree(payload) {
      record("thread.tree.before", payload.threadId, payload);
      const reason = options.cancel?.["thread.tree.before"];
      if (reason !== undefined) return Promise.resolve({ cancel: true as const, reason });
      return Promise.resolve({
        cancel: false as const,
        ...(options.treeSummary === undefined
          ? {}
          : { summary: { summary: options.treeSummary.summary, details: null } }),
      });
    },
    tree(payload) {
      record("thread.tree.after", payload.threadId, payload);
      return Promise.resolve();
    },
    shutdown(threadId, payload) {
      record("thread.shutdown", threadId, payload);
      return Promise.resolve();
    },
  };
  return { points, calls };
}
