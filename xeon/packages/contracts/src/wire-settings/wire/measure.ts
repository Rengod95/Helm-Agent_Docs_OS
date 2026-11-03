import { Type, type TUnsafe } from "typebox";
import type { SchemaProof } from "../../base/index.ts";
import { closed, m4, request, type Io, type M4Spec, type Req } from "./schema-kit.ts";

// F.wire-settings.spec §3.3.8(측정 읽기, T-MEAS-READ). 원천은 호스트의 측정 저장소 `measure.db`다(L4.host-service.spec §4.20).
// 메서드 이름 `measure.turn`, `measure.daily`는 [제안]이다.

const ThreadRef = Type.String({ minLength: 1, maxLength: 64 });
const Kind = Type.String({ minLength: 1, maxLength: 32 });
const Metric = Type.String({ minLength: 1, maxLength: 160 });
const Count = Type.Integer({ minimum: 0 });

/** 상한. 한 Turn의 행은 호출, 핸들러(500), 단계별 구성·캐시를 합쳐도 이 안에 든다 */
export const MEASURE_TURN_ROWS_MAX = 4000;
/** 일별 집계 상한(10년) */
export const MEASURE_DAILY_DAYS_MAX = 3650;

/** 측정 한 줄. `kind`는 `turn`, `call`, `hook`, `ctx`, `cache` 가운데 하나이고 `metrics`·`tags`의 이름은 kind마다 다르다 */
export interface MeasureRow {
  readonly at: number;
  readonly kind: string;
  readonly metrics: Readonly<Record<string, number>>;
  readonly tags: Readonly<Record<string, string>>;
}
const MeasureRowShape = closed({
  at: Type.Number(),
  kind: Kind,
  metrics: Type.Record(Type.String(), Type.Number()),
  tags: Type.Record(Type.String(), Type.String()),
});

/** `measure.turn` params */
export interface MeasureTurnParams {
  readonly threadId: string;
  readonly turnId: string;
}
const MeasureTurnParamsShape = request({ threadId: ThreadRef, turnId: ThreadRef });
export const MeasureTurnParamsSchema: TUnsafe<Req<MeasureTurnParams>> = Type.Unsafe<
  Req<MeasureTurnParams>
>(
  MeasureTurnParamsShape satisfies SchemaProof<
    Req<MeasureTurnParams>,
    typeof MeasureTurnParamsShape
  >,
);

/** `measure.turn` 결과. 측정이 꺼져 있으면 `enabled`가 거짓이고 `rows`는 비어 있다. 보존 기간이 지난 Turn도 빈 목록이다 */
export interface MeasureTurnResult {
  readonly enabled: boolean;
  readonly rows: readonly MeasureRow[];
}
const MeasureTurnResultShape = closed({
  enabled: Type.Boolean(),
  rows: Type.Array(MeasureRowShape, { maxItems: MEASURE_TURN_ROWS_MAX }),
});
export const MeasureTurnResultSchema: TUnsafe<MeasureTurnResult> = Type.Unsafe<MeasureTurnResult>(
  MeasureTurnResultShape satisfies SchemaProof<MeasureTurnResult, typeof MeasureTurnResultShape>,
);

/** `measure.daily` params. `kind`와 `metric`은 저장소의 이름 그대로다(예: `call`, `firstTokenMs`) */
export interface MeasureDailyParams {
  readonly kind: string;
  readonly metric: string;
}
const MeasureDailyParamsShape = request({ kind: Kind, metric: Metric });
export const MeasureDailyParamsSchema: TUnsafe<Req<MeasureDailyParams>> = Type.Unsafe<
  Req<MeasureDailyParams>
>(
  MeasureDailyParamsShape satisfies SchemaProof<
    Req<MeasureDailyParams>,
    typeof MeasureDailyParamsShape
  >,
);

/** 일별 집계 한 줄. `day`는 UTC 날짜 `YYYY-MM-DD`다 */
export interface MeasureDay {
  readonly day: string;
  readonly count: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
}
const MeasureDayShape = closed({
  day: Type.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }),
  count: Count,
  sum: Type.Number(),
  min: Type.Number(),
  max: Type.Number(),
});

/** `measure.daily` 결과. 날짜 순이다 */
export interface MeasureDailyResult {
  readonly enabled: boolean;
  readonly days: readonly MeasureDay[];
}
const MeasureDailyResultShape = closed({
  enabled: Type.Boolean(),
  days: Type.Array(MeasureDayShape, { maxItems: MEASURE_DAILY_DAYS_MAX }),
});
export const MeasureDailyResultSchema: TUnsafe<MeasureDailyResult> =
  Type.Unsafe<MeasureDailyResult>(
    MeasureDailyResultShape satisfies SchemaProof<
      MeasureDailyResult,
      typeof MeasureDailyResultShape
    >,
  );

type U<T> = TUnsafe<T>;
export interface MeasureWireSchemas {
  "measure.turn": Io<U<Req<MeasureTurnParams>>, U<MeasureTurnResult>>;
  "measure.daily": Io<U<Req<MeasureDailyParams>>, U<MeasureDailyResult>>;
}
type Table = {
  readonly [M in keyof MeasureWireSchemas]: M4Spec<
    MeasureWireSchemas[M]["params"],
    MeasureWireSchemas[M]["result"]
  >;
};
export const MEASURE_WIRE_METHODS: Table = {
  "measure.turn": m4(MeasureTurnParamsSchema, MeasureTurnResultSchema),
  "measure.daily": m4(MeasureDailyParamsSchema, MeasureDailyResultSchema),
};
