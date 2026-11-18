import type { BacktestSettingsValues } from "./scope.ts";

// 돌려 보기 설정 값(turn-record-metrics.md §3.6, `x.operations.backtest.*`). 값은 실행을 시작할 때 한 번 읽는다.
// 키가 없거나 모양이 틀리면 문서의 기본값이다. 키 정의와 범위는 `packages/ext-host/src/operations/settings-keys.ts`가 정한다.

/** 설정 키의 기본값(§3.6 표) */
const BACKTEST_DEFAULTS: BacktestSettingsValues = {
  maxTurns: 50,
  maxCalls: 2000,
  callTimeoutMs: 5000,
  totalTimeoutMs: 120000,
};

function integerOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : fallback;
}

/** `read(key)`로 `x.operations.backtest.*`의 값을 읽어 유효한 묶음으로 만든다 */
export function backtestSettingsOf(read: (key: string) => unknown): BacktestSettingsValues {
  return {
    maxTurns: integerOr(read("x.operations.backtest.maxTurns"), BACKTEST_DEFAULTS.maxTurns),
    maxCalls: integerOr(read("x.operations.backtest.maxCalls"), BACKTEST_DEFAULTS.maxCalls),
    callTimeoutMs: integerOr(
      read("x.operations.backtest.callTimeoutMs"),
      BACKTEST_DEFAULTS.callTimeoutMs,
    ),
    totalTimeoutMs: integerOr(
      read("x.operations.backtest.totalTimeoutMs"),
      BACKTEST_DEFAULTS.totalTimeoutMs,
    ),
  };
}
