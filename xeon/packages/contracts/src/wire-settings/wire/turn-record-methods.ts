import type { TSchema, TUnsafe } from "typebox";
import type { Io, NoParams, Req } from "./schema-kit.ts";
import { NoParamsSchema } from "./schema-kit.ts";
import { EmptyParamsSchema } from "./notifications.ts";
import {
  BacktestCancelParamsSchema,
  BacktestResultParamsSchema,
  BacktestResultResultSchema,
  BacktestRunParamsSchema,
  BacktestRunResultSchema,
  BacktestStatusParamsSchema,
  BacktestStatusResultSchema,
  type BacktestCancelParams,
  type BacktestResultParams,
  type BacktestResultResult,
  type BacktestRunParams,
  type BacktestRunResult,
  type BacktestStatusParams,
  type BacktestStatusResult,
} from "./backtest.ts";
import {
  FindingsBundleParamsSchema,
  FindingsBundleResultSchema,
  FindingsDismissParamsSchema,
  FindingsEvidenceParamsSchema,
  FindingsEvidenceResultSchema,
  FindingsListParamsSchema,
  FindingsListResultSchema,
  MetricsCatalogResultSchema,
  MetricsQueryParamsSchema,
  MetricsQueryResultSchema,
  ProfileCostGetParamsSchema,
  ProfileCostGetResultSchema,
  TestRunCompareParamsSchema,
  TestRunCompareResultSchema,
  TurnRecordGetParamsSchema,
  TurnRecordGetResultSchema,
  TurnRecordListParamsSchema,
  TurnRecordListResultSchema,
  TurnRecordMarkParamsSchema,
  TurnRecordUnwatchParamsSchema,
  TurnRecordWatchParamsSchema,
  TurnRecordWatchResultSchema,
  TurnRecordSearchParamsSchema,
  TurnRecordSearchResultSchema,
  type FindingsBundleParams,
  type FindingsBundleResult,
  type FindingsDismissParams,
  type FindingsEvidenceParams,
  type FindingsEvidenceResult,
  type FindingsListParams,
  type FindingsListResult,
  type MetricsCatalogResult,
  type MetricsQueryParams,
  type MetricsQueryResult,
  type ProfileCostGetParams,
  type ProfileCostGetResult,
  type TestRunCompareParams,
  type TestRunCompareResult,
  type TurnRecordGetParams,
  type TurnRecordGetResult,
  type TurnRecordListParams,
  type TurnRecordListResult,
  type TurnRecordMarkParams,
  type TurnRecordUnwatchParams,
  type TurnRecordWatchParams,
  type TurnRecordWatchResult,
  type TurnRecordSearchParams,
  type TurnRecordSearchResult,
} from "./turn-record.ts";

// 턴 기록과 지표의 메서드 표(M5d, 문서 `review/m5/turn-record-metrics.md` §3.5, §3.8). 처리기는 `apps/host/src/handlers/m5/`가 낸다.
// 지난 턴에 돌려 보기 `backtest.*` 네 개는 아래 `BACKTEST_WIRE_METHODS`에 등록한다(처리기는 아직 없고 실행기는 P1 뒤다). 알림 `turnRecord.delta`와 `backtest.progress`는 `notifications.ts`가 아니라 `methods.ts`의 알림 표에 있다.
// 메서드 이름과 단계 `M5`는 이 문서가 정한다. F §3.3.1 표와 `WIRE_METHODS`가 같아야 한다(wire.doc.test.ts).

/** M5 메서드의 레지스트리 항목. `M4Spec`과 같은 모양이고 단계만 M5다 */
interface M5Spec<P extends TSchema, R extends TSchema> {
  readonly params: P;
  readonly result: R;
  readonly since: "0.1.0";
  readonly status: "active";
  readonly stage: "M5";
}

function m5<P extends TSchema, R extends TSchema>(params: P, result: R): M5Spec<P, R> {
  return { params, result, since: "0.1.0", status: "active", stage: "M5" };
}

type U<T> = TUnsafe<T>;

export interface TurnRecordWireSchemas {
  "turnRecord.list": Io<U<Req<TurnRecordListParams>>, U<TurnRecordListResult>>;
  "turnRecord.get": Io<U<Req<TurnRecordGetParams>>, U<TurnRecordGetResult>>;
  "turnRecord.search": Io<U<Req<TurnRecordSearchParams>>, U<TurnRecordSearchResult>>;
  "turnRecord.mark": Io<U<Req<TurnRecordMarkParams>>, typeof EmptyParamsSchema>;
  "turnRecord.watch": Io<U<Req<TurnRecordWatchParams>>, U<TurnRecordWatchResult>>;
  "turnRecord.unwatch": Io<U<Req<TurnRecordUnwatchParams>>, typeof EmptyParamsSchema>;
  "metrics.catalog": Io<U<NoParams>, U<MetricsCatalogResult>>;
  "metrics.query": Io<U<Req<MetricsQueryParams>>, U<MetricsQueryResult>>;
  "findings.list": Io<U<Req<FindingsListParams>>, U<FindingsListResult>>;
  "findings.evidence": Io<U<Req<FindingsEvidenceParams>>, U<FindingsEvidenceResult>>;
  "findings.dismiss": Io<U<Req<FindingsDismissParams>>, typeof EmptyParamsSchema>;
  "findings.bundle": Io<U<Req<FindingsBundleParams>>, U<FindingsBundleResult>>;
  "profileCost.get": Io<U<Req<ProfileCostGetParams>>, U<ProfileCostGetResult>>;
  "testRun.compare": Io<U<Req<TestRunCompareParams>>, U<TestRunCompareResult>>;
}

type Table = {
  readonly [M in keyof TurnRecordWireSchemas]: M5Spec<
    TurnRecordWireSchemas[M]["params"],
    TurnRecordWireSchemas[M]["result"]
  >;
};

export const TURN_RECORD_WIRE_METHODS: Table = {
  "turnRecord.list": m5(TurnRecordListParamsSchema, TurnRecordListResultSchema),
  "turnRecord.get": m5(TurnRecordGetParamsSchema, TurnRecordGetResultSchema),
  "turnRecord.search": m5(TurnRecordSearchParamsSchema, TurnRecordSearchResultSchema),
  "turnRecord.mark": m5(TurnRecordMarkParamsSchema, EmptyParamsSchema),
  "turnRecord.watch": m5(TurnRecordWatchParamsSchema, TurnRecordWatchResultSchema),
  "turnRecord.unwatch": m5(TurnRecordUnwatchParamsSchema, EmptyParamsSchema),
  "metrics.catalog": m5(NoParamsSchema, MetricsCatalogResultSchema),
  "metrics.query": m5(MetricsQueryParamsSchema, MetricsQueryResultSchema),
  "findings.list": m5(FindingsListParamsSchema, FindingsListResultSchema),
  "findings.evidence": m5(FindingsEvidenceParamsSchema, FindingsEvidenceResultSchema),
  "findings.dismiss": m5(FindingsDismissParamsSchema, EmptyParamsSchema),
  "findings.bundle": m5(FindingsBundleParamsSchema, FindingsBundleResultSchema),
  "profileCost.get": m5(ProfileCostGetParamsSchema, ProfileCostGetResultSchema),
  "testRun.compare": m5(TestRunCompareParamsSchema, TestRunCompareResultSchema),
};

/** 지난 턴에 돌려 보기의 메서드 표(§3.5). 알림 `backtest.progress`는 `methods.ts`의 알림 표에 있다 */
export interface BacktestWireSchemas {
  "backtest.run": Io<U<Req<BacktestRunParams>>, U<BacktestRunResult>>;
  "backtest.status": Io<U<Req<BacktestStatusParams>>, U<BacktestStatusResult>>;
  "backtest.result": Io<U<Req<BacktestResultParams>>, U<BacktestResultResult>>;
  "backtest.cancel": Io<U<Req<BacktestCancelParams>>, typeof EmptyParamsSchema>;
}

type BacktestTable = {
  readonly [M in keyof BacktestWireSchemas]: M5Spec<
    BacktestWireSchemas[M]["params"],
    BacktestWireSchemas[M]["result"]
  >;
};

export const BACKTEST_WIRE_METHODS: BacktestTable = {
  "backtest.run": m5(BacktestRunParamsSchema, BacktestRunResultSchema),
  "backtest.status": m5(BacktestStatusParamsSchema, BacktestStatusResultSchema),
  "backtest.result": m5(BacktestResultParamsSchema, BacktestResultResultSchema),
  "backtest.cancel": m5(BacktestCancelParamsSchema, EmptyParamsSchema),
};
