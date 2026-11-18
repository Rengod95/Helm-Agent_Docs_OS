import { attemptAsync, type Result } from "@fresnel/contracts";
import {
  WIRE_ERRORS,
  WireError,
  type HostConnection,
  type WireParams,
  type WireRequestOptions,
  type WireResult,
} from "@fresnel/contracts/wire";

// 턴 기록과 지표 메서드의 호출 틀(M5d, `review/m5/turn-record-metrics.md` §3.5, §3.8). 연결은 `request`와 `onNotification`만 쓴다.
// 오류는 화면이 구분하는 wire 코드 넷, 그 밖의 호스트 오류(`host`), 응답을 받지 못한 전송 실패(`transport`)로 나눈다.

/** 턴 기록·지표·발견·비용·테스트 실행 비교의 메서드 이름 */
export type TurnRecordMethod =
  | "turnRecord.list"
  | "turnRecord.get"
  | "turnRecord.search"
  | "turnRecord.mark"
  | "turnRecord.watch"
  | "turnRecord.unwatch"
  | "metrics.catalog"
  | "metrics.query"
  | "findings.list"
  | "findings.evidence"
  | "findings.dismiss"
  | "findings.bundle"
  | "profileCost.get"
  | "testRun.compare";

/**
 * 턴 기록 호출이 실패한 이유.
 * - `turnNotFound`(3501): 로그에도 없는 턴이다. 기록이 꺼졌거나 지워진 턴은 오류가 아니라 `absent`로 온다
 * - `unknownMetric`(3511), `filterInvalid`(3512), `findingNotFound`(3531): 해당 wire 오류
 * - `host`: 그 밖의 wire 오류. `error`에 그대로 싣는다
 * - `transport`: 응답을 받지 못했다(연결이 닫혔거나 시한이 지났거나 중단됐다). `cause`는 `HostClientError`다
 */
export type TurnRecordFailure =
  | { readonly kind: "turnNotFound" }
  | { readonly kind: "unknownMetric" }
  | { readonly kind: "filterInvalid" }
  | { readonly kind: "findingNotFound" }
  | { readonly kind: "host"; readonly error: WireError }
  | { readonly kind: "transport"; readonly cause: unknown };

/** 던져진 값을 실패 갈래로 바꾼다. 입력은 `unknown`이다(경계). `WireError`가 아니면 전송 실패다 */
export function turnRecordFailureOf(cause: unknown): TurnRecordFailure {
  if (!(cause instanceof WireError)) return { kind: "transport", cause };
  if (cause.code === WIRE_ERRORS["turnRecord.turnNotFound"].code) return { kind: "turnNotFound" };
  if (cause.code === WIRE_ERRORS["metrics.unknownMetric"].code) return { kind: "unknownMetric" };
  if (cause.code === WIRE_ERRORS["metrics.filterInvalid"].code) return { kind: "filterInvalid" };
  if (cause.code === WIRE_ERRORS["findings.notFound"].code) return { kind: "findingNotFound" };
  return { kind: "host", error: cause };
}

/** 턴 기록 호출에 쓰는 연결. `HostConnection`이 이 모양을 만족하고, 시험은 `fakeConnection`을 쓴다 */
export type TurnRecordConnection = Pick<HostConnection, "request" | "onNotification">;

/** 와이어 호출 하나를 `Result`로 바꾼다. 던진 값은 `turnRecordFailureOf`가 가른다 */
export async function callTurnRecord<M extends TurnRecordMethod>(
  connection: TurnRecordConnection,
  method: M,
  params: WireParams<M>,
  options?: WireRequestOptions,
): Promise<Result<WireResult<M>, TurnRecordFailure>> {
  const outcome = await attemptAsync(() => connection.request(method, params, options));
  if (outcome.ok) return outcome;
  return { ok: false, error: turnRecordFailureOf(outcome.error.cause) };
}
