import type { WireParams, WireRequestOptions } from "@fresnel/contracts/wire";
import { callTurnRecord, type TurnRecordConnection } from "./call.ts";
import type { TurnRecordRead } from "./read.ts";

// 지난 턴에 돌려 보기의 호출 틀(M5d-2, `review/m5/turn-record-metrics.md` §3.5). 요청과 응답 모양은 F의 메서드 표(`WireParams`, `WireResult`)에서 가져온다.
// 진행 알림 `backtest.progress`는 여기서 구독하지 않는다. 화면이 생길 때 더한다.

/** 돌려 보기를 시작한다(`backtest.run`). 받은 실행 id로 `backtestStatus`와 `backtestResult`를 부른다 */
export function runBacktest(
  connection: TurnRecordConnection,
  params: WireParams<"backtest.run">,
  options?: WireRequestOptions,
): TurnRecordRead<"backtest.run"> {
  return callTurnRecord(connection, "backtest.run", params, options);
}

/** 실행의 상태와 진행 칸(`backtest.status`). 없는 실행은 `runNotFound`다 */
export function backtestStatus(
  connection: TurnRecordConnection,
  params: WireParams<"backtest.status">,
  options?: WireRequestOptions,
): TurnRecordRead<"backtest.status"> {
  return callTurnRecord(connection, "backtest.status", params, options);
}

/** 결과의 한 쪽(`backtest.result`). `summary`는 같은 실행의 요약이라 쪽마다 같다. `next`가 null이면 마지막 쪽이다 */
export function backtestResult(
  connection: TurnRecordConnection,
  params: WireParams<"backtest.result">,
  options?: WireRequestOptions,
): TurnRecordRead<"backtest.result"> {
  return callTurnRecord(connection, "backtest.result", params, options);
}

/** 실행을 멈춘다(`backtest.cancel`). 결과는 `{}`다 */
export function cancelBacktest(
  connection: TurnRecordConnection,
  params: WireParams<"backtest.cancel">,
  options?: WireRequestOptions,
): TurnRecordRead<"backtest.cancel"> {
  return callTurnRecord(connection, "backtest.cancel", params, options);
}
