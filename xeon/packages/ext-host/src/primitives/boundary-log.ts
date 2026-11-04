// Test run 단계 경계 기록(X-19, X.primitives.spec §4.4.8 10). host.ts가 `boundary.step.after` 멈춤 기다리기 직전에 한 건씩 붙인다.
// thread마다 최근 MAX_BOUNDARIES건만 두고 오래된 것부터 뺀다. Test run 표지를 지우거나 닫을 때 함께 지운다(forgetTestRun).
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { TestRunBoundary } from "@fresnel/contracts/extensions";

/** thread마다 남기는 경계 기록 수 상한. `testRun.phase`의 `boundaries` 와이어 상한과 같다 */
export const MAX_BOUNDARIES = 200;

export interface BoundaryLog {
  /** 경계 기록 하나를 붙인다. 상한을 넘으면 가장 오래된 기록부터 뺀다 */
  note(threadId: ThreadId, boundary: TestRunBoundary): void;
  /** thread의 기록 복사본. 오래된 것부터 새것 순이다 */
  entriesOf(threadId: ThreadId): readonly TestRunBoundary[];
  /** thread의 기록을 지운다 */
  forget(threadId: ThreadId): void;
}

export function createBoundaryLog(): BoundaryLog {
  const logs = new Map<ThreadId, TestRunBoundary[]>();
  return {
    note(threadId, boundary) {
      const log = logs.get(threadId) ?? [];
      log.push(boundary);
      // 한 번에 하나만 넘으므로 맨 앞 하나만 뺀다
      if (log.length > MAX_BOUNDARIES) log.shift();
      logs.set(threadId, log);
    },
    entriesOf(threadId) {
      return [...(logs.get(threadId) ?? [])];
    },
    forget(threadId) {
      logs.delete(threadId);
    },
  };
}
