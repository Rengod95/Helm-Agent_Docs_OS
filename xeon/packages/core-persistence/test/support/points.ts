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
    Partial<Record<"session.switch.before" | "session.fork.before" | "session.tree.before", string>>
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
      record("session.start", payload.threadId, payload);
      return Promise.resolve();
    },
    infoChanged(payload) {
      record("session.info.after", payload.threadId, payload);
      return Promise.resolve();
    },
    beforeSwitch(threadId, payload) {
      record("session.switch.before", threadId, payload);
      const reason = options.cancel?.["session.switch.before"];
      return Promise.resolve(reason === undefined ? undefined : { cancel: true, reason });
    },
    beforeFork(payload) {
      record("session.fork.before", payload.threadId, payload);
      const reason = options.cancel?.["session.fork.before"];
      return Promise.resolve(
        reason === undefined ? { cancel: false as const } : { cancel: true as const, reason },
      );
    },
    beforeTree(payload) {
      record("session.tree.before", payload.threadId, payload);
      const reason = options.cancel?.["session.tree.before"];
      if (reason !== undefined) return Promise.resolve({ cancel: true as const, reason });
      return Promise.resolve({
        cancel: false as const,
        ...(options.treeSummary === undefined
          ? {}
          : { summary: { summary: options.treeSummary.summary, details: null } }),
      });
    },
    tree(payload) {
      record("session.tree.after", payload.threadId, payload);
      return Promise.resolve();
    },
    shutdown(threadId, payload) {
      record("session.shutdown", threadId, payload);
      return Promise.resolve();
    },
  };
  return { points, calls };
}
