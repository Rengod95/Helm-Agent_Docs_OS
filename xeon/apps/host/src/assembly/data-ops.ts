import { join } from "node:path";
import { attempt, type Clock, type Logger } from "@xeon/contracts";
import type { SessionService } from "@xeon/contracts/records";
import { pruneSpill } from "@xeon/platform-exec";
import type { OpenedStore } from "@xeon/platform-store";

// L4.host-service.spec §4.18(보관 정리와 블롭 GC 연결), L0.exec.spec §3.8.2, L0.store.spec §4.9, L1.persistence.spec §6.1.
// 조립 루트가 열기 때 한 번 돌리고 그 뒤 하루마다 다시 돌린다. 실패는 로그로만 남기고 호스트를 멈추지 않는다.

/** 하루(ms). 보관 정리와 블롭 GC의 반복 주기 */
export const DATA_OPS_DAY_MS = 86_400_000;
/** 블롭 GC 첫 실행까지의 지연(ms). 열기 직후 저장소 쓰기와 겹치지 않게 한다 [결정: 오케스트레이터 기본값] */
export const BLOB_GC_FIRST_RUN_MS = 60_000;
/** 상태 디렉터리 아래 spill 폴더 이름(`execOptionsOf`와 같은 값) */
const SPILL_DIR_NAME = "spill";

/** 호스트 타이머(`setTimer`와 같은 모양). 돌려준 함수가 타이머를 끊는다 */
export type DataOpsSetTimer = (ms: number, fn: () => void) => () => void;

export interface DataOpsDeps {
  /** 상태 디렉터리(`os.dirs.state`) */
  readonly stateDir: string;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly setTimer: DataOpsSetTimer;
  /** l0.exec.spillRetentionDays. 실행할 때마다 읽는다. 0이면 아무것도 지우지 않는다 */
  readonly spillRetentionDays: () => number;
  /** l0.store.blobGcEnabled. 실행할 때마다 읽는다. 꺼져 있으면 GC를 부르지 않는다 */
  readonly blobGcEnabled: () => boolean;
  /**
   * 이 프로세스가 블롭 GC를 돌릴 자격이 있는가. 스케줄 실행권이 없으면 false다. 실행권은 서비스 모드가 쥔다
   * (`schedule.start()`가 서비스 모드에서만 틱을 돌린다, HS-40). `scheduler` 임대를 잡는 구현은 아직 없다 [미결]
   */
  readonly runsBlobGc: boolean;
  readonly store: Pick<OpenedStore, "gcBlobs">;
  readonly query: Pick<SessionService["query"], "liveBlobRefs">;
}

export interface DataOps {
  /** 남은 타이머를 모두 끊는다. 끊은 뒤 호출은 아무 일도 하지 않는다 */
  close(): void;
}

/**
 * 보관 정리와 블롭 GC를 시작한다. 보관 정리(spill)는 바로 한 번 돌고 하루마다 다시 돈다. 블롭 GC는 자격이 있을 때만
 * 첫 실행을 `BLOB_GC_FIRST_RUN_MS` 뒤에 걸고 그 뒤 하루마다 돈다. 설정이 꺼져 있으면 그 주기에 아무 일도 하지 않는다.
 */
export function startDataOps(deps: DataOpsDeps): DataOps {
  const timers: { spill: (() => void) | undefined; gc: (() => void) | undefined } = {
    spill: undefined,
    gc: undefined,
  };
  const state = { closed: false };

  const arm = (slot: keyof typeof timers, ms: number, run: () => void): void => {
    if (state.closed) return;
    timers[slot] = deps.setTimer(ms, () => {
      timers[slot] = undefined;
      run();
    });
  };

  function pruneSpillNow(): void {
    const maxAgeDays = deps.spillRetentionDays();
    if (maxAgeDays > 0) {
      const report = pruneSpill({
        dir: join(deps.stateDir, SPILL_DIR_NAME),
        maxAgeDays,
        now: deps.clock.now(),
      });
      if (!report.ok) {
        deps.logger.warn("spill.prune_failed", { kind: report.error.kind });
      } else if (report.value.removed > 0 || report.value.failed > 0) {
        deps.logger.info("spill.pruned", {
          removed: report.value.removed,
          bytesFreed: report.value.bytesFreed,
          failed: report.value.failed,
        });
      }
    }
    arm("spill", DATA_OPS_DAY_MS, pruneSpillNow);
  }

  function runBlobGc(): void {
    const refs = deps.query.liveBlobRefs();
    if (!refs.ok) {
      deps.logger.warn("store.blob_gc_failed", { kind: refs.error.kind });
      return;
    }
    // 뿌리 집합은 세션이 참조하는 블롭 해시다. 블롭 쓰기 뒤 커밋 전인 블롭은 `blobGraceMs`가 지킨다(L0.store.spec §4.9)
    const report = attempt(() => deps.store.gcBlobs({ liveRefs: new Set(refs.value) }));
    if (!report.ok) {
      deps.logger.warn("store.blob_gc_failed", { kind: "threw" });
      return;
    }
    if (!report.value.ok) {
      deps.logger.warn("store.blob_gc_failed", { kind: report.value.error.kind });
      return;
    }
    const gc = report.value.value;
    deps.logger.info("store.blob_gc", {
      rows: gc.rows,
      orphanFiles: gc.orphanFiles,
      tmpFiles: gc.tmpFiles,
      deferred: gc.deferred,
      truncated: gc.truncated,
    });
  }

  function blobGcNow(): void {
    if (deps.blobGcEnabled()) runBlobGc();
    arm("gc", DATA_OPS_DAY_MS, blobGcNow);
  }

  pruneSpillNow();
  if (deps.runsBlobGc) arm("gc", BLOB_GC_FIRST_RUN_MS, blobGcNow);

  return {
    close: () => {
      state.closed = true;
      timers.spill?.();
      timers.gc?.();
      timers.spill = undefined;
      timers.gc = undefined;
    },
  };
}
