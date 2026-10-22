import { assertNever, Bug, parse } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import {
  POINTS,
  type ChainPointName,
  type FirstPointName,
  type PointName,
  type ScopeId,
} from "@xeon/contracts/extensions";
import { eraseDispatchOptions, restoreOutcome } from "../erase.ts";
import { withAmbient } from "./ambient.ts";
import type {
  AnyDispatchOptions,
  AnyDispatchOutcome,
  DispatchOptions,
  DispatchOutcome,
  DispatchPolicy,
  HandlerEntryInfo,
  HandlerFailure,
  HandlerFailureReason,
  HandlerGate,
  HandlerRef,
  HandlerRunOutcome,
  PayloadOf,
} from "./dispatch-types.ts";
import type { ExtDiagnostic } from "./errors.ts";
import { foldChain } from "./fold/chain.ts";
import type { FoldEnv, RunResult } from "./fold/env.ts";
import { foldFirst } from "./fold/first.ts";
import { foldTap } from "./fold/tap.ts";
import { deepFreeze } from "./freeze.ts";
import type { HandlerEntry, HandlerRegistry } from "./registry.ts";

export {
  DEFAULT_DISPATCH_POLICY,
  type ChainOutcome,
  type DispatchOptions,
  type DispatchOutcome,
  type DispatchPolicy,
  type FirstOutcome,
  type HandlerEntryInfo,
  type HandlerFailure,
  type HandlerGate,
  type HandlerRef,
  type HandlerRunOutcome,
  type PayloadOf,
  type TapOutcome,
} from "./dispatch-types.ts";

export interface DispatcherDeps {
  readonly registry: HandlerRegistry;
  readonly policy: DispatchPolicy;
  readonly now: () => number;
  readonly setTimer: (ms: number, fn: () => void) => () => void;
  /** 참이면 페이로드·패치 스키마 검사와 페이로드 동결을 켠다 */
  readonly strict: boolean;
  readonly report: (diagnostic: ExtDiagnostic) => void;
  /** 핸들러 ctx.state. 디스패치 시작 때의 마지막 커밋 상태 */
  readonly stateOf: (threadId: ThreadId, scopeId: ScopeId) => unknown;
}

export interface Dispatcher {
  dispatch(
    point: PointName,
    payload: unknown,
    options: AnyDispatchOptions,
  ): Promise<AnyDispatchOutcome>;
}

const NOOP_GATE: HandlerGate = { pause: () => {}, resume: () => {} };
const NOOP = (): void => {};

function isFirstPoint(point: PointName): point is FirstPointName {
  return POINTS[point].fold === "first";
}

function isChainPoint(point: PointName): point is ChainPointName {
  return POINTS[point].fold === "chain";
}

function failureOf(
  entry: HandlerEntry,
  reason: HandlerFailureReason,
  error: unknown,
  elapsedMs: number,
): HandlerFailure {
  return {
    point: entry.point,
    handler: refOf(entry),
    reason,
    ...(error === undefined ? {} : { error }),
    elapsedMs,
  };
}

function infoOf(entry: HandlerEntry): HandlerEntryInfo {
  return {
    point: entry.point,
    scopeId: entry.scopeId,
    extension: entry.extension,
    layer: entry.layer,
    builtin: entry.builtin,
    loadIndex: entry.loadIndex,
    seq: entry.seq,
  };
}

function refOf(entry: HandlerEntry): HandlerRef {
  return { scopeId: entry.scopeId, extension: entry.extension, seq: entry.seq };
}

function combineSignals(...signals: readonly (AbortSignal | undefined)[]): AbortSignal | undefined {
  const present = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (present.length === 0) return undefined;
  const [only] = present;
  return present.length === 1 && only !== undefined ? only : AbortSignal.any(present);
}

/** 정렬 키 (tierOf, loadIndex, seq)의 사전식 오름차순(F.extensions.spec §4.2) */
function sortEntries(
  entries: readonly HandlerEntry[],
  policy: DispatchPolicy,
): readonly HandlerEntry[] {
  const keyed = entries.map((entry) => ({ entry, tier: policy.tierOf(infoOf(entry)) }));
  keyed.sort(
    (a, b) => a.tier - b.tier || a.entry.loadIndex - b.entry.loadIndex || a.entry.seq - b.entry.seq,
  );
  return keyed.map((item) => item.entry);
}

/** 디스패처 자체 실행기. 정책에 run이 없을 때 쓴다(X.primitives.spec §4.2 ownRun) */
function ownRun<T>(
  work: (signal: AbortSignal, gate: HandlerGate) => Promise<T>,
  budgetMs: number | null,
  outer: AbortSignal | undefined,
  deps: Pick<DispatcherDeps, "now" | "setTimer" | "report">,
  label: string,
): Promise<HandlerRunOutcome<T>> {
  const controller = new AbortController();
  const startedAt = deps.now();
  return new Promise((resolve) => {
    let done = false;
    let cancelTimer: () => void = NOOP;
    const onOuterAbort = (): void => {
      controller.abort(outer?.reason);
      finish({ kind: "aborted", reason: outer?.reason });
    };
    function finish(outcome: HandlerRunOutcome<T>): void {
      if (done) return;
      done = true;
      cancelTimer();
      outer?.removeEventListener("abort", onOuterAbort);
      resolve(outcome);
    }
    if (outer?.aborted === true) {
      finish({ kind: "aborted", reason: outer.reason });
      return;
    }
    outer?.addEventListener("abort", onOuterAbort, { once: true });
    if (budgetMs !== null) {
      cancelTimer = deps.setTimer(budgetMs, () => {
        if (done) return;
        controller.abort(new DOMException(`handler budget ${budgetMs}ms exceeded`, "TimeoutError"));
        finish({ kind: "timeout", budgetMs });
      });
    }
    work(controller.signal, NOOP_GATE).then(
      // 예산 초과 뒤에 끝난 값은 finish가 버린다
      (value) => {
        finish({ kind: "settled", value, activeMs: deps.now() - startedAt });
        return undefined;
      },
      (error: unknown) => {
        if (!done) {
          finish({ kind: "threw", error, activeMs: deps.now() - startedAt });
          return undefined;
        }
        // 결과가 이미 정해진 뒤의 늦은 오류는 결과와 장부에 영향이 없다. 진단만 남긴다
        deps.report({
          level: "info",
          code: "handler_failed",
          message: `late handler error discarded: ${label}`,
          cause: error,
        });
        return undefined;
      },
    );
  });
}

export function createDispatcher(deps: DispatcherDeps): Dispatcher {
  const { policy } = deps;

  function fail(failure: HandlerFailure): void {
    try {
      policy.onHandlerFailure(failure);
    } catch (error) {
      deps.report({
        level: "error",
        code: "handler_failed",
        message: "policy threw",
        cause: error,
      });
    }
    deps.report({
      level: failure.reason === "value_from_tap" ? "info" : "warning",
      code: "handler_failed",
      scopeId: failure.handler.scopeId,
      extension: failure.handler.extension,
      message: `${failure.point} handler ${failure.reason}`,
      ...(failure.error === undefined ? {} : { cause: failure.error }),
    });
  }

  function makeEnv(point: PointName, options: AnyDispatchOptions): FoldEnv {
    async function runOne(entry: HandlerEntry, args: readonly unknown[]): Promise<RunResult> {
      const info = infoOf(entry);
      const outer = combineSignals(options.signal, entry.signal);
      const state = deps.stateOf(options.threadId, entry.scopeId);
      const work = (signal: AbortSignal, _gate: HandlerGate): Promise<unknown> =>
        Promise.resolve().then(() =>
          withAmbient(
            {
              threadId: options.threadId,
              scopeId: entry.scopeId,
              dispatchKey: options.dispatchKey,
              counter: 0,
              drive: null,
            },
            () =>
              entry.fn(...args, {
                scopeId: entry.scopeId,
                state,
                threadId: options.threadId,
                signal,
              }),
          ),
        );
      const outcome =
        policy.run === undefined
          ? await ownRun(work, policy.budgetMs(info), outer, deps, `${point}@${entry.scopeId}`)
          : await policy.run(info, work, outer);
      switch (outcome.kind) {
        case "settled":
          return { kind: "ok", value: outcome.value, activeMs: outcome.activeMs };
        case "threw":
          return {
            kind: "failed",
            failure: failureOf(entry, "threw", outcome.error, outcome.activeMs),
          };
        case "timeout":
          return {
            kind: "failed",
            failure: failureOf(entry, "timeout", undefined, outcome.budgetMs),
          };
        case "aborted":
          return { kind: "aborted" };
        default:
          return assertNever(outcome, "RunOutcome");
      }
    }
    return {
      point,
      strict: deps.strict,
      runOne,
      fail,
      settled(entry, activeMs) {
        try {
          policy.onHandlerSettled?.(infoOf(entry), activeMs);
        } catch (error) {
          deps.report({
            level: "error",
            code: "handler_failed",
            message: "policy threw",
            cause: error,
          });
        }
      },
      failureOf,
      refOf,
    };
  }

  return {
    async dispatch(point, payload, options) {
      const decl = POINTS[point];
      if (deps.strict) {
        const checked = parse(decl.payload, payload);
        if (!checked.ok) {
          const first = checked.error.issues[0];
          throw new Bug(
            `dispatch.payload_invalid: ${point} ${first === undefined ? "" : `${first.path} ${first.message}`}`,
          );
        }
        deepFreeze(payload);
      }
      if (decl.finalize === "boundary" && options.finalize === undefined) {
        throw new Bug(`dispatch.finalize_missing: ${point} requires options.finalize`);
      }
      const entries = sortEntries(deps.registry.snapshot(point), policy);
      const env = makeEnv(point, options);
      const fold = decl.fold;
      switch (fold) {
        case "tap":
          return foldTap(env, entries, payload);
        case "first":
          if (!isFirstPoint(point)) throw new Bug(`dispatch.fold_mismatch: ${point}`);
          return foldFirst(env, point, entries, payload);
        case "chain":
          if (!isChainPoint(point)) throw new Bug(`dispatch.fold_mismatch: ${point}`);
          return foldChain(env, point, entries, payload, {
            initial: options.initial,
            finalize: options.finalize,
          });
        default:
          return assertNever(fold, "PointDecl.fold");
      }
    },
  };
}

/** 지점 이름이 N인 타입 있는 호출로 좁힌다. 타입은 지점 표가 보장하고 런타임 값은 그대로다 */
export function typedDispatch<N extends PointName>(
  dispatcher: Dispatcher,
  point: N,
  payload: PayloadOf<N>,
  options: DispatchOptions<N>,
): Promise<DispatchOutcome<N>> {
  return restoreOutcome(dispatcher.dispatch(point, payload, eraseDispatchOptions(options)), point);
}
