import type { PointName } from "@xeon/contracts/extensions";
import type { HandlerFailure, HandlerFailureReason, HandlerRef } from "../dispatch-types.ts";
import type { HandlerEntry } from "../registry.ts";

/** 핸들러 한 번 실행한 결과. 예외·시간 초과는 failed, 외부 중단은 aborted다 */
export type RunResult =
  | { readonly kind: "ok"; readonly value: unknown; readonly activeMs: number }
  | { readonly kind: "failed"; readonly failure: HandlerFailure }
  | { readonly kind: "aborted" };

/** fold 알고리즘이 디스패처에서 받는 도구 묶음 */
export interface FoldEnv {
  readonly point: PointName;
  /** 참이면 chain 패치 스키마도 검사한다 */
  readonly strict: boolean;
  runOne(entry: HandlerEntry, args: readonly unknown[]): Promise<RunResult>;
  /** 실패를 정책과 진단에 보고한다 */
  fail(failure: HandlerFailure): void;
  /** 실패로 보고되지 않은 호출을 성공 보고한다 */
  settled(entry: HandlerEntry, activeMs: number): void;
  failureOf(
    entry: HandlerEntry,
    reason: HandlerFailureReason,
    error: unknown,
    elapsedMs: number,
  ): HandlerFailure;
  refOf(entry: HandlerEntry): HandlerRef;
}
