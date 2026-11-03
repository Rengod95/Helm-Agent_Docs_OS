import { join } from "node:path";
import { parse, type Logger } from "@fresnel/contracts";
import { TurnCompletedPayloadSchema } from "@fresnel/contracts/conversation";
import type { CommitBatch, SessionService } from "@fresnel/contracts/records";
import {
  DEFAULT_RETENTION_DAYS,
  openMeasureStore,
  type MeasureRecord,
  type MeasureStore,
} from "./store.ts";

/** 측정 DB 파일 이름 */
const MEASURE_DB_FILE_NAME = "measure.db";

// T-MEAS-STORE. 내구 이벤트 피드에서 Turn 경계(`turn.completed`)를 보고 Turn 하나의 요약을 측정 저장소에 쓴다.
// 커밋 경로 안에서는 모으기만 하고(TX-09) 쓰기는 마이크로태스크에서 한 묶음으로 한다. 그래서 모델 호출 경로가 SQLite 쓰기를 기다리지 않는다.
// 켜기와 끄기는 `x.operations.trace.enabled`(`enabled()`)로 묶는다. 꺼져 있으면 모으지도 쓰지도 않는다.
// 이 모듈이 쓰는 건 `turn.completed`에서 뽑은 `turn` 종류 한 가지뿐이다. 모델 호출, 핸들러 결과, 요청 구성, 캐시 사건 기록은 뒤 트랙(T-MEAS-CALL·HOOK·CTX·CACHE)이 같은 저장소에 더한다.

interface MeasureRecorderDeps {
  readonly session: Pick<SessionService, "feed">;
  readonly store: MeasureStore;
  /** 켬 여부(`x.operations.trace.enabled`의 현재 값) */
  readonly enabled: () => boolean;
  readonly logger: Logger;
}

/** `turn.completed` 한 건의 측정 한 줄. 사용량이 없는 종료(중단 등)는 토큰과 비용을 0으로 둔다 */
function turnRecord(event: CommitBatch["events"][number]): MeasureRecord | undefined {
  if (event.kind !== "turn.completed") return undefined;
  const parsed = parse(TurnCompletedPayloadSchema, event.payload);
  if (!parsed.ok) return undefined;
  const { usage, status, stepCount } = parsed.value;
  return {
    at: event.recordedAt,
    threadId: event.threadId,
    turnId: event.turnId,
    kind: "turn",
    metrics: {
      steps: stepCount,
      input: usage?.input ?? 0,
      output: usage?.output ?? 0,
      cacheRead: usage?.cacheRead ?? 0,
      cacheWrite: usage?.cacheWrite ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
      usd: usage?.cost.total ?? 0,
    },
    tags: { status },
  };
}

/** 피드를 구독해 Turn 경계마다 한 묶음을 쓴다. 돌려주는 함수가 구독을 끊고 남은 묶음을 쓴다 */
function startMeasureRecorder(deps: MeasureRecorderDeps): () => void {
  let pending: MeasureRecord[] = [];
  let scheduled = false;

  function flush(): void {
    scheduled = false;
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    const written = deps.store.writeBatch(batch);
    if (!written.ok) {
      deps.logger.warn("measure.write_failed", {
        reason: written.error.kind,
        dropped: batch.length,
      });
    }
  }

  const off = deps.session.feed.onCommit((batch) => {
    if (!deps.enabled()) return;
    for (const event of batch.events) {
      const record = turnRecord(event);
      if (record !== undefined) pending.push(record);
    }
    if (pending.length > 0 && !scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  });

  return () => {
    off();
    flush();
  };
}

export interface MeasurementDeps {
  /** 측정 DB를 둘 폴더(대화 DB와 같은 데이터 폴더). 파일 이름은 `measure.db`다 */
  readonly dir: string;
  readonly session: Pick<SessionService, "feed">;
  readonly enabled: () => boolean;
  readonly logger: Logger;
  readonly now: () => number;
  /** 원본 보관 일수(기본 30) */
  readonly retentionDays?: number;
}

/**
 * 측정 저장소를 열고 보존 정리를 한 번 한 뒤 기록기를 켠다. 열지 못하면 로그만 남기고 측정 없이 간다(측정은 대화를 막지 않는다).
 * 돌려주는 함수가 기록기를 끊고 저장소를 닫는다
 */
export function startMeasurement(deps: MeasurementDeps): () => void {
  const opened = openMeasureStore(join(deps.dir, MEASURE_DB_FILE_NAME));
  if (!opened.ok) {
    deps.logger.warn("measure.open_failed", { reason: opened.error.kind });
    return () => undefined;
  }
  const store = opened.value;
  const pruned = store.prune(deps.now(), deps.retentionDays ?? DEFAULT_RETENTION_DAYS);
  if (!pruned.ok) deps.logger.warn("measure.prune_failed", { reason: pruned.error.kind });
  const stop = startMeasureRecorder({
    session: deps.session,
    store,
    enabled: deps.enabled,
    logger: deps.logger,
  });
  return () => {
    stop();
    store.close();
  };
}
