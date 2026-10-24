// 확장 지점 발화를 기록하는 SessionPoints 대역(L1.persistence.spec §7.1). first 지점은 설정한 대로 취소하거나 요약을 준다.
import type { ThreadId } from "@xeon/contracts/conversation";
import type { SessionPoints } from "../../src/index.ts";

export interface PointCall {
  readonly point: string;
  readonly threadId: ThreadId;
  readonly payload: unknown;
}

export interface RecordingPointsOptions {
  /** 지점 이름 → 취소 이유. 있으면 그 first 지점이 취소를 결정한다 */
  readonly cancel?: Readonly<
    Partial<Record<"session_before_switch" | "session_before_fork" | "session_before_tree", string>>
  >;
  /** session_before_tree가 계속하면서 주는 요약 */
  readonly treeSummary?: { readonly summary: string };
}

export function recordingPoints(options: RecordingPointsOptions = {}): {
  readonly points: SessionPoints;
  readonly calls: PointCall[];
} {
  const calls: PointCall[] = [];
  const record = (point: string, threadId: ThreadId, payload: unknown): void => {
    calls.push({ point, threadId, payload });
  };
  const points: SessionPoints = {
    start(payload) {
      record("session_start", payload.threadId, payload);
      return Promise.resolve();
    },
    infoChanged(payload) {
      record("session_info_changed", payload.threadId, payload);
      return Promise.resolve();
    },
    beforeSwitch(threadId, payload) {
      record("session_before_switch", threadId, payload);
      const reason = options.cancel?.session_before_switch;
      return Promise.resolve(reason === undefined ? undefined : { cancel: true, reason });
    },
    beforeFork(payload) {
      record("session_before_fork", payload.threadId, payload);
      const reason = options.cancel?.session_before_fork;
      return Promise.resolve(
        reason === undefined ? { cancel: false as const } : { cancel: true as const, reason },
      );
    },
    beforeTree(payload) {
      record("session_before_tree", payload.threadId, payload);
      const reason = options.cancel?.session_before_tree;
      if (reason !== undefined) return Promise.resolve({ cancel: true as const, reason });
      return Promise.resolve({
        cancel: false as const,
        ...(options.treeSummary === undefined
          ? {}
          : { summary: { summary: options.treeSummary.summary, details: null } }),
      });
    },
    tree(payload) {
      record("session_tree", payload.threadId, payload);
      return Promise.resolve();
    },
    shutdown(threadId, payload) {
      record("session_shutdown", threadId, payload);
      return Promise.resolve();
    },
  };
  return { points, calls };
}
