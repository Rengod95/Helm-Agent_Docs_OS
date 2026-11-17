import type {
  HookName,
  HookRunDecision,
  TraceAsk,
  TraceFailureReason,
} from "@fresnel/contracts/extensions";
import type { HandlerFailure, HandlerFailureReason, HandlerRef } from "../dispatch-types.ts";
import type { HandlerEntry } from "../registry.ts";
import type { WaitTotals } from "../user-wait.ts";

/** 값을 낸 실행. `startedAt`은 디스패처 시계의 시작 시각이다. `waits`는 그 실행이 사람을 기다린 합계다 */
interface OkRun {
  readonly kind: "ok";
  readonly value: unknown;
  readonly activeMs: number;
  readonly startedAt: number;
  readonly waits: WaitTotals;
}
/** 예외·시간 초과 */
interface FailedRun {
  readonly kind: "failed";
  readonly failure: HandlerFailure;
  readonly startedAt: number;
  readonly waits: WaitTotals;
}
/** 외부 중단 */
interface AbortedRun {
  readonly kind: "aborted";
  readonly startedAt: number;
  readonly elapsedMs: number;
  readonly waits: WaitTotals;
}
/** 핸들러 한 번 실행한 결과. 예외·시간 초과는 failed, 외부 중단은 aborted다 */
export type RunResult = OkRun | FailedRun | AbortedRun;

/**
 * 사람 대기 메타데이터(턴 기록 §4.2 규칙 14). `decision`이 `ask`면 코어가 카드를 띄운 것(`via: "decision"`), 그 밖에 기다렸으면
 * 핸들러가 직접 기다린 것(`via: "awaitUser"`)이다. 둘 다 없으면 생략한다. 승인 id와 답은 호스트가 도구 호출의 승인에서 채운다
 */
export function askOf(decision: HookRunDecision, waits: WaitTotals): TraceAsk | undefined {
  if (decision === "ask") {
    return {
      via: "decision",
      waits: waits.count,
      waitMs: waits.ms,
      approvalId: null,
      answer: null,
    };
  }
  if (waits.count > 0) {
    return {
      via: "awaitUser",
      waits: waits.count,
      waitMs: waits.ms,
      approvalId: null,
      answer: null,
    };
  }
  return undefined;
}

/** 값을 낸 실행을 fold가 어떻게 받아들였는가(계측 결과 다섯 중 값을 내고 끝난 넷) */
type OkVerdictResult =
  | { readonly result: "passed" }
  | { readonly result: "blocked" }
  /** 값이 결과에 반영됐다. 크기는 계측이 켜졌을 때만 센다 */
  | { readonly result: "modified"; readonly value: unknown }
  | {
      readonly result: "failed";
      readonly reason: Exclude<TraceFailureReason, "threw" | "timeout">;
    };

/**
 * 값을 낸 실행의 기록. `decision`은 낸 결정이다(M5e 스펙 §4.5). 합치기 지점의 `ask`·`replace`는 결과가 `passed`이고
 * 결정만 이 칸에 남는다. 칸이 없으면 디스패처가 값에서 `none`을 정한다. 계측 기록기가 항목에 싣는다
 */
type OkVerdict = OkVerdictResult & { readonly decision?: HookRunDecision };

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
