import { assertNever } from "@xeon/contracts";
import { POINTS, type PointDecl, type PointName } from "@xeon/contracts/extensions";
import type {
  HandlerEntryInfo,
  HandlerGate,
  HandlerRunOutcome,
} from "../primitives/dispatch-types.ts";

export type BudgetClass = "first" | "chain" | "tap" | "streamTap" | "shutdown" | "setup" | "hook";

export type BudgetTable = { readonly [C in BudgetClass]: number };

/** §4.2.2 표의 기본값. 설정 키 x.operations.budget.*의 default와 같다(§6) */
export const DEFAULT_BUDGETS_MS: BudgetTable = {
  first: 30_000,
  chain: 10_000,
  tap: 5_000,
  streamTap: 1_000,
  shutdown: 2_000,
  setup: 10_000,
  hook: 30_000,
};

/** 고빈도 관찰 지점. streamTap 예산을 쓴다 */
export const STREAM_TAP_POINTS: readonly PointName[] = [
  "message_update",
  "provider_stream_event",
  "tool_execution_update",
];

/** 순수 함수. setup(값은 OperationsPolicy.setupBudgetMs)과 외부 훅은 이 함수를 쓰지 않는다 */
export function budgetClassOf(point: PointDecl): Exclude<BudgetClass, "setup" | "hook"> {
  switch (point.fold) {
    case "first":
      return "first";
    case "chain":
      return "chain";
    case "tap":
      if (point.name === "session_shutdown") return "shutdown";
      return STREAM_TAP_POINTS.includes(point.name) ? "streamTap" : "tap";
    default:
      return assertNever(point.fold, "PointDecl.fold");
  }
}

/** DispatchPolicy.budgetMs 구현. 지점 등급과 유효 설정 값으로 정한다 */
export function budgetMsFrom(
  budgets: () => BudgetTable,
): (entry: HandlerEntryInfo) => number | null {
  return (entry) => budgets()[budgetClassOf(POINTS[entry.point])];
}

/** 핸들러가 사용자 응답을 기다리는 동안 예산 시계를 멈춘다. 중첩 호출을 센다 */
export interface BudgetGate extends HandlerGate {
  /** 남은 예산(ms). 멈춘 동안에는 줄지 않는다. 예산이 없으면 Infinity */
  readonly remainingMs: number;
}

/** X.primitives.spec §3.4 HandlerRunOutcome과 같은 타입. DispatchPolicy.run의 반환형이다 */
export type BudgetOutcome<T> = HandlerRunOutcome<T>;

/** ExtHostDeps의 now·setTimer와 같은 함수를 받는다 */
export interface BudgetDeps {
  readonly now: () => number;
  /** 반환값은 취소 함수 */
  readonly setTimer: (ms: number, fn: () => void) => () => void;
}

const NOOP = (): void => {};

/**
 * work를 예산 안에서 실행한다. 예산을 넘으면 work에 준 signal을 TimeoutError DOMException으로 abort하고
 * 곧바로 timeout을 돌려준다. 그 뒤에 work가 낸 값과 예외는 버린다. outer가 abort되면 aborted다.
 * budgetMs가 null이면 예산 없이 실행한다(drive 등 시간 예산 밖 호출용).
 * 사용자 응답 대기(gate.pause ~ gate.resume) 시간은 예산에서 뺀다(X.operations.spec §4.2.3)
 */
export function runWithBudget<T>(
  work: (signal: AbortSignal, gate: BudgetGate) => T | Promise<T>,
  budgetMs: number | null,
  deps: BudgetDeps,
  outer?: AbortSignal,
): Promise<BudgetOutcome<T>> {
  const controller = new AbortController();
  return new Promise((resolve) => {
    let done = false;
    let cancelTimer = NOOP;
    // 시계: 멈추지 않은 구간의 길이를 모은다
    let activeMs = 0;
    let resumedAt = deps.now();
    let pauseDepth = 0;

    const activeNow = (): number => activeMs + (pauseDepth === 0 ? deps.now() - resumedAt : 0);

    function onOuterAbort(): void {
      controller.abort(outer?.reason);
      finish({ kind: "aborted", reason: outer?.reason });
    }

    function finish(outcome: BudgetOutcome<T>): void {
      if (done) return;
      done = true;
      cancelTimer();
      outer?.removeEventListener("abort", onOuterAbort);
      resolve(outcome);
    }

    function arm(): void {
      cancelTimer();
      if (budgetMs === null) return;
      const left = Math.max(0, budgetMs - activeNow());
      cancelTimer = deps.setTimer(left, () => {
        if (done) return;
        controller.abort(new DOMException(`handler budget ${budgetMs}ms exceeded`, "TimeoutError"));
        finish({ kind: "timeout", budgetMs });
      });
    }

    const gate: BudgetGate = {
      pause() {
        if (done) return;
        if (pauseDepth === 0) {
          activeMs += deps.now() - resumedAt;
          cancelTimer();
          cancelTimer = NOOP;
        }
        pauseDepth += 1;
      },
      resume() {
        if (done || pauseDepth === 0) return;
        pauseDepth -= 1;
        if (pauseDepth === 0) {
          resumedAt = deps.now();
          arm();
        }
      },
      get remainingMs(): number {
        return budgetMs === null ? Number.POSITIVE_INFINITY : Math.max(0, budgetMs - activeNow());
      },
    };

    if (outer?.aborted === true) {
      finish({ kind: "aborted", reason: outer.reason });
      return;
    }
    outer?.addEventListener("abort", onOuterAbort, { once: true });
    arm();
    Promise.resolve()
      .then(() => work(controller.signal, gate))
      .then(
        (value) => {
          finish({ kind: "settled", value, activeMs: activeNow() });
          return undefined;
        },
        (error: unknown) => {
          // 결과가 이미 정해진 뒤의 늦은 값·예외는 버린다
          finish({ kind: "threw", error, activeMs: activeNow() });
          return undefined;
        },
      );
  });
}

export { awaitUser } from "../primitives/user-wait.ts";
