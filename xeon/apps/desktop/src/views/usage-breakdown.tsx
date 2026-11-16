// 사용량 내역(N-3)의 순수 모델. 이 대화의 합계(`usage.get`의 session 게이지: 토큰, 비용, 요청, 캐시 읽기·쓰기)와
// 가장 나중 턴의 입력·출력·캐시·비용과 호출 수(`measure.turn`)를 읽는다. 값을 지어내지 않는다.
// 상태 줄 컨텍스트 칸의 내역 팝오버(그림 부품)는 없앴다(DP-207: 칸이 컨텍스트 탭을 열고, 그 탭의 사용량 표가 같은 값을 보인다).
import { turnViewOf } from "@fresnel/client/workbench";
import type { MeasureTurnResult, UsageGauge } from "@fresnel/contracts/wire";

/** 대화 합계 */
export interface UsageTotals {
  readonly tokens: number;
  readonly usd: number;
  readonly requests: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

/** 가장 나중 턴의 내역. 호출 수는 main 호출만 센다 */
export interface TurnBreakdown {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly usd: number;
  readonly calls: number;
  /** main 호출들이 모델에서 보낸 시간 합(ms) */
  readonly modelMs: number;
  /** main 호출 사이의 틈 합(ms). 도구 실행과 승인 대기가 합쳐 있다 */
  readonly waitMs: number;
}

/** session 창 게이지를 단위별로 합친다 */
export function totalsOf(gauges: readonly UsageGauge[]): UsageTotals {
  const sum = (unit: UsageGauge["unit"]): number =>
    gauges
      .filter((gauge) => gauge.window === "session" && gauge.unit === unit)
      .reduce((total, gauge) => total + gauge.used, 0);
  return {
    tokens: sum("tokens"),
    usd: sum("usd"),
    requests: sum("requests"),
    cacheRead: sum("cacheRead"),
    cacheWrite: sum("cacheWrite"),
  };
}

/** `measure.turn` 결과에서 Turn 내역을 읽는다. 측정이 꺼졌거나 Turn 행이 없으면 null이다 */
export function turnBreakdownOf(result: MeasureTurnResult): TurnBreakdown | null {
  const state = turnViewOf(result);
  if (state.kind !== "ready" || state.view.summary === null) return null;
  const { summary, calls, phases } = state.view;
  const main = calls.filter((call) => call.role === "main");
  return {
    input: summary.input,
    output: summary.output,
    cacheRead: summary.cacheRead,
    cacheWrite: summary.cacheWrite,
    usd: summary.usd,
    calls: main.length,
    modelMs: main.reduce((total, call) => total + call.durationMs, 0),
    waitMs: phases
      .filter((phase) => phase.kind === "wait")
      .reduce((total, phase) => total + phase.ms, 0),
  };
}
