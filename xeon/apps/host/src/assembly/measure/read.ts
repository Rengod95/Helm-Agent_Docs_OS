import { err, ok, type Result } from "@fresnel/contracts";
import type { MeasureStore, MeasureStoreError } from "./store.ts";

// T-MEAS-READ. 측정 저장소를 wire(`measure.turn`, `measure.daily`)가 읽는 포트다. 읽기만 하고 켬 여부는 호출자가 준다.
// 저장소를 열지 못했거나 이미 닫혔으면 `enabled`가 거짓이 아니라 저장소 오류(`closed`)로 알린다. 열지 못한 경우는 빈 결과다(측정 없이 간다).

/** wire 한 줄. 저장소의 `MeasureRecord`에서 thread·Turn 식별자를 뺀 모양이다 */
interface MeasureRowView {
  readonly at: number;
  readonly kind: string;
  readonly metrics: Readonly<Record<string, number>>;
  readonly tags: Readonly<Record<string, string>>;
}

interface MeasureDayView {
  readonly day: string;
  readonly count: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
}

/** 처리기가 쓰는 포트. 값은 저장소가 준 그대로다 */
export interface MeasurePort {
  turn(
    threadId: string,
    turnId: string,
  ): Result<
    { readonly enabled: boolean; readonly rows: readonly MeasureRowView[] },
    MeasureStoreError
  >;
  daily(
    kind: string,
    metric: string,
  ): Result<
    { readonly enabled: boolean; readonly days: readonly MeasureDayView[] },
    MeasureStoreError
  >;
}

export interface MeasureReadSource {
  /** 열린 저장소. 열지 못했으면 undefined */
  readonly store: () => MeasureStore | undefined;
  /** `x.operations.trace.enabled`의 현재 값 */
  readonly enabled: () => boolean;
}

export function createMeasurePort(source: MeasureReadSource): MeasurePort {
  return {
    turn(threadId, turnId) {
      const store = source.store();
      if (!source.enabled() || store === undefined)
        return ok({ enabled: source.enabled(), rows: [] });
      const rows = store.turn(threadId, turnId);
      if (!rows.ok) return err(rows.error);
      return ok({
        enabled: true,
        rows: rows.value.map((row) => ({
          at: row.at,
          kind: row.kind,
          metrics: row.metrics,
          tags: row.tags,
        })),
      });
    },
    daily(kind, metric) {
      const store = source.store();
      if (!source.enabled() || store === undefined)
        return ok({ enabled: source.enabled(), days: [] });
      const days = store.daily(kind, metric);
      if (!days.ok) return err(days.error);
      return ok({
        enabled: true,
        days: days.value.map((day) => ({
          day: day.day,
          count: day.count,
          sum: day.sum,
          min: day.min,
          max: day.max,
        })),
      });
    },
  };
}
