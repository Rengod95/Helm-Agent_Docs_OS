import type { HookName, TraceFailureReason } from "@fresnel/contracts/extensions";
import type { HandlerFailure, HandlerFailureReason, HandlerRef } from "../dispatch-types.ts";
import type { HandlerEntry } from "../registry.ts";

/** 값을 낸 실행. `startedAt`은 디스패처 시계의 시작 시각이다 */
interface OkRun {
  readonly kind: "ok";
  readonly value: unknown;
  readonly activeMs: number;
  readonly startedAt: number;
}
/** 예외·시간 초과 */
interface FailedRun {
  readonly kind: "failed";
  readonly failure: HandlerFailure;
  readonly startedAt: number;
}
/** 외부 중단 */
interface AbortedRun {
  readonly kind: "aborted";
  readonly startedAt: number;
  readonly elapsedMs: number;
}
/** 핸들러 한 번 실행한 결과. 예외·시간 초과는 failed, 외부 중단은 aborted다 */
export type RunResult = OkRun | FailedRun | AbortedRun;

/** 값을 낸 실행을 fold가 어떻게 받아들였는가(계측 결과 다섯 중 값을 내고 끝난 넷) */
type OkVerdict =
  | { readonly result: "passed" }
  | { readonly result: "blocked" }
  /** 값이 결과에 반영됐다. 크기는 계측이 켜졌을 때만 센다 */
  | { readonly result: "modified"; readonly value: unknown }
  | {
      readonly result: "failed";
      readonly reason: Exclude<TraceFailureReason, "threw" | "timeout">;
    };

/** fold 알고리즘이 디스패처에서 받는 도구 묶음 */
export interface FoldEnv {
  readonly point: HookName;
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
  /** 값을 낸 실행의 계측 기록. 계측이 꺼져 있으면 아무 일도 하지 않는다 */
  noteOk(entry: HandlerEntry, run: OkRun, verdict: OkVerdict): void;
  /** 실패·중단한 실행의 계측 기록(`failed`, `skipped`) */
  noteLost(entry: HandlerEntry, run: FailedRun | AbortedRun): void;
  /** 앞 핸들러 `by`가 멈춰서 실행하지 못한 핸들러들의 계측 기록(`skipped`) */
  skip(entries: readonly HandlerEntry[], by: HandlerEntry): void;
}
