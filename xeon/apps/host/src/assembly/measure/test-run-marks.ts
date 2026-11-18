import type { Clock, Logger } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { MeasureStore } from "./store.ts";
import type { TrThreadRow } from "./turn-tables.ts";

// Test run 대화의 표지를 측정 저장소의 `tr_thread`에 내구 기록한다(정본 `docs/xeon/review/m5/turn-record-metrics.md` §4.6 규칙 32).
// 메모리 표지(`Set`, `Map`)는 그대로 두고, 같은 대화를 이 표로도 적는다. 재시작 뒤에는 `recall`이 표지를 되살린다.
// 계측 설정과 무관하게 쓴다. 저장소가 없거나 쓰지 못하면 메모리 표지만 남는다(폴백). 대화를 지우면 `forgetThread`가 행을 지운다.

/** 대화 범위 표지의 값. `test`는 Test run 대화, `craft`는 테스트 대화(M5c §4.8.9, 규칙 36)다 */
type ThreadScopeMark = "test" | "craft";

export interface TestRunMarks {
  /**
   * 표지를 쓴다. 이미 있는 행의 생성 시각과 대상 확장은 지킨다. 쓰지 못했으면 거짓이다.
   * `scopeKind`를 생략하면 `test`다. `craft`는 테스트 대화의 턴을 `scope_kind = craft`로 적게 한다
   */
  remember(
    threadId: ThreadId,
    testBaseProfile: string | null,
    scopeKind?: ThreadScopeMark,
  ): boolean;
  /** 저장된 표지. Test run 대화가 아니거나 저장소가 없으면 undefined */
  recall(threadId: ThreadId): TrThreadRow | undefined;
}

export interface TestRunMarksDeps {
  /** 열린 측정 저장소. 열지 못했으면 undefined */
  readonly store: () => MeasureStore | undefined;
  readonly clock: Pick<Clock, "now">;
  readonly logger: Logger;
}

export function createTestRunMarks(deps: TestRunMarksDeps): TestRunMarks {
  return {
    remember(threadId, testBaseProfile, scopeKind = "test") {
      const store = deps.store();
      if (store === undefined) return false;
      const existing = store.getThread(threadId);
      if (!existing.ok) {
        deps.logger.warn("measure.test_marker_read_failed", { reason: existing.error.kind });
        return false;
      }
      const row = existing.value;
      const written = store.upsertThread({
        threadId,
        scopeKind,
        testBaseProfile,
        testTarget: row?.testTarget ?? null,
        runGroupId: row?.runGroupId ?? null,
        inputHash: row?.inputHash ?? null,
        createdAt: row?.createdAt ?? deps.clock.now(),
        draftJson: row?.draftJson ?? null,
      });
      if (!written.ok) {
        deps.logger.warn("measure.test_marker_write_failed", { reason: written.error.kind });
        return false;
      }
      return true;
    },
    recall(threadId) {
      const store = deps.store();
      if (store === undefined) return undefined;
      const found = store.getThread(threadId);
      if (!found.ok) {
        deps.logger.warn("measure.test_marker_read_failed", { reason: found.error.kind });
        return undefined;
      }
      return found.value?.scopeKind === "test" ? found.value : undefined;
    },
  };
}
