import type { ThreadId } from "@xeon/contracts/conversation";
import type {
  ChainSig,
  CollectSig,
  ExtensionName,
  FirstSig,
  PointName,
  PointSignatures,
  ScopeId,
  TapSig,
} from "@xeon/contracts/extensions";
import type { HandlerEntryInfo } from "./registry.ts";

export type { HandlerEntryInfo } from "./registry.ts";

// ── 디스패치 타입 (X.primitives.spec §3.3) ────────────────────────────────

export type PayloadOf<N extends PointName> = PointSignatures[N]["payload"];

interface DispatchOptionsBase {
  readonly threadId: ThreadId;
  /** 결정적 키. 같은 지점이 같은 위치에서 다시 발화하면 같은 값. 예: "<stepId>:tool.call.before:<toolCallId>"(lifecycle 지점은 이벤트 id) */
  readonly dispatchKey: string;
  /** 디스패치 전체의 취소 신호. 핸들러 ctx.signal의 부모다 */
  readonly signal?: AbortSignal;
}

export type DispatchOptions<N extends PointName> =
  PointSignatures[N] extends ChainSig<infer _P, infer V, infer _X>
    ? DispatchOptionsBase & {
        /** chain 초기값. 지점이 만든다 */
        readonly initial: V;
        /** POINTS[N].finalize가 "boundary"면 필수. 모든 핸들러 뒤 L1이 최종 값을 검증·보정한다 */
        readonly finalize?: (value: V) => V;
      }
    : PointSignatures[N] extends CollectSig<infer _P, infer V, infer _C>
      ? DispatchOptionsBase & {
          /** collect 초기값. 지점이 만들고 모은 기여가 이 값에 한 번 병합된다 */
          readonly initial: V;
        }
      : DispatchOptionsBase;

/** 지점 종류를 지운 옵션. 내부 디스패처가 쓴다 */
export interface AnyDispatchOptions extends DispatchOptionsBase {
  readonly initial?: unknown;
  readonly finalize?: (value: unknown) => unknown;
}

export interface HandlerRef {
  readonly scopeId: ScopeId;
  readonly extension: ExtensionName;
  /** 레지스트리 등록 순번 */
  readonly seq: number;
}

export type HandlerFailureReason =
  | "threw"
  | "timeout"
  | "result_invalid"
  | "merge_rejected"
  | "value_from_tap";

export interface HandlerFailure {
  readonly point: PointName;
  readonly handler: HandlerRef;
  readonly reason: HandlerFailureReason;
  readonly error?: unknown;
  readonly elapsedMs: number;
}

export interface TapOutcome {
  readonly fold: "tap";
  /** detached 지점이면 참. 이때 핸들러는 디스패치가 돌려준 뒤에 실행되고 failures는 늘 비어 있다(실패는 policy.onHandlerFailure로만 보고) */
  readonly detached: boolean;
  readonly failures: readonly HandlerFailure[];
}

export interface FirstOutcome<D> {
  readonly fold: "first";
  /** 결정. 아무 핸들러도 결정하지 않았으면 undefined */
  readonly decision: D | undefined;
  readonly decidedBy: HandlerRef | null;
  /** 참이면 decision은 FIRST_DENY 값이다(핸들러 실패로 대체됨) */
  readonly substituted: boolean;
  readonly failures: readonly HandlerFailure[];
}

export interface ChainOutcome<V> {
  readonly fold: "chain";
  /** finalize를 거친 최종 값 */
  readonly value: V;
  readonly applied: readonly HandlerRef[];
  readonly failures: readonly HandlerFailure[];
  /** stop 규칙으로 뒤 핸들러를 건너뛰었으면 참 */
  readonly stopped: boolean;
}

export interface CollectOutcome<V> {
  readonly fold: "collect";
  /** 모은 기여를 initial에 한 번 병합한 값. 기여가 없으면 initial 그대로다 */
  readonly value: V;
  /** 기여를 낸 핸들러. 등록 순서다 */
  readonly contributed: readonly HandlerRef[];
  readonly failures: readonly HandlerFailure[];
}

export type DispatchOutcome<N extends PointName> =
  PointSignatures[N] extends TapSig<infer _P>
    ? TapOutcome
    : PointSignatures[N] extends FirstSig<infer _P, infer D>
      ? FirstOutcome<D>
      : PointSignatures[N] extends ChainSig<infer _P, infer V, infer _X>
        ? ChainOutcome<V>
        : PointSignatures[N] extends CollectSig<infer _P, infer V, infer _C>
          ? CollectOutcome<V>
          : never;

/** 지점 종류를 지운 결과 */
export type AnyDispatchOutcome =
  | TapOutcome
  | FirstOutcome<unknown>
  | ChainOutcome<unknown>
  | CollectOutcome<unknown>;

// ── DispatchPolicy (X.primitives.spec §3.4) ───────────────────────────────

/** 핸들러 실행 중 사용자 응답 대기 동안 예산 시계를 멈추는 장치 */
export interface HandlerGate {
  pause(): void;
  resume(): void;
}

/** DispatchPolicy.run 결과. X.operations의 BudgetOutcome과 같은 모양 */
export type HandlerRunOutcome<T> =
  | { readonly kind: "settled"; readonly value: T; readonly activeMs: number }
  | { readonly kind: "threw"; readonly error: unknown; readonly activeMs: number }
  | { readonly kind: "timeout"; readonly budgetMs: number }
  | { readonly kind: "aborted"; readonly reason: unknown };

/** X.operations가 구현한다. 디스패처는 값을 해석하지 않고 쓰기만 한다 */
export interface DispatchPolicy {
  /** 정렬 첫째 키. 작을수록 먼저. 정수 */
  tierOf(entry: HandlerEntryInfo): number;
  /** 핸들러 하나의 시간 예산(ms). null이면 무제한. run이 있으면 디스패처는 이 값을 쓰지 않는다 */
  budgetMs(entry: HandlerEntryInfo): number | null;
  /** 실패 보고. 동기, 예외를 던지지 않는다 */
  onHandlerFailure(failure: HandlerFailure): void;
  /** 선택. 성공 보고. 핸들러 호출이 실패로 보고되지 않았을 때 한 번 부른다 */
  onHandlerSettled?(entry: HandlerEntryInfo, activeMs: number): void;
  /** 선택. 있으면 디스패처가 자기 타이머 대신 이 함수로 핸들러를 실행한다 */
  run?<T>(
    entry: HandlerEntryInfo,
    work: (signal: AbortSignal, gate: HandlerGate) => T | Promise<T>,
    outer: AbortSignal | undefined,
  ): Promise<HandlerRunOutcome<T>>;
}

/** tier 0, 예산 없음. 실패 기록은 ExtHostDeps.report가 맡는다. onHandlerSettled·run 없음 */
export const DEFAULT_DISPATCH_POLICY: DispatchPolicy = {
  tierOf: () => 0,
  budgetMs: () => null,
  onHandlerFailure: () => {},
};
