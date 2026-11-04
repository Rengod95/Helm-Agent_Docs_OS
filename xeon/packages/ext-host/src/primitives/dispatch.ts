import { assertNever, attempt, Bug, parse } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  HOOKS,
  type ChainHookName,
  type CollectHookName,
  type FirstHookName,
  type HookName,
  type RegistrationId,
  type TraceFailureReason,
} from "@fresnel/contracts/extensions";
import { eraseDispatchOptions, restoreOutcome } from "../erase.ts";
import type { TraceBuffer, TraceDispatch } from "../operations/trace-buffer.ts";
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
import { foldCollect } from "./fold/collect.ts";
import type { FoldEnv, RunResult } from "./fold/env.ts";
import { foldFirst } from "./fold/first.ts";
import { foldTap } from "./fold/tap.ts";
import { deepFreeze } from "./freeze.ts";
import { orderEntries } from "./order.ts";
import type { HandlerEntry, HandlerRegistry } from "./registry.ts";
import type { StepPause } from "./step-pause.ts";

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
  readonly stateOf: (threadId: ThreadId, scopeId: RegistrationId) => unknown;
  /** detached tap의 작업을 호스트가 추적한다(whenSettled가 기다리고 거부는 진단으로 남긴다) */
  readonly track: (task: Promise<unknown>) => void;
  /** thread가 닫히면 중단되는 신호. 없으면(열지 않은 thread) undefined. detached tap은 세션 종료 뒤 실행하지 않고 결과를 버린다 */
  readonly threadSignal: (threadId: ThreadId) => AbortSignal | undefined;
  /** 계측 기록기(X-15). 디스패치마다 시작하고 핸들러 실행마다 기록한다. 없으면 계측하지 않는다 */
  readonly trace?: Pick<TraceBuffer, "start">;
  /**
   * Test run 단계 경계 멈춤(X-19). `boundary.step.after`의 처리가 끝난 뒤 멈춘 thread를 기다린다. 없으면 멈추지 않는다
   */
  readonly stepPause?: Pick<StepPause, "hold">;
}

export interface Dispatcher {
  dispatch(
    point: HookName,
    payload: unknown,
    options: AnyDispatchOptions,
  ): Promise<AnyDispatchOutcome>;
}

const NOOP_GATE: HandlerGate = { pause: () => {}, resume: () => {} };
const NOOP = (): void => {};

function isFirstHook(point: HookName): point is FirstHookName {
  return HOOKS[point].fold === "first";
}

function isChainHook(point: HookName): point is ChainHookName {
  return HOOKS[point].fold === "chain";
}

function isCollectHook(point: HookName): point is CollectHookName {
  return HOOKS[point].fold === "collect";
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

/** 값을 낸 핸들러의 바뀐 크기. 값의 JSON 문자 수다. 직렬화할 수 없는 값은 0이다. 계측이 켜졌을 때만 부른다 */
function sizeOfValue(value: unknown): number {
  const size = attempt(() => JSON.stringify(value).length);
  return size.ok ? size.value : 0;
}

/** 실패 이유를 계측 이유로 옮긴다. `value_from_tap`은 실행 실패가 아니라 쓰이지 않는다 */
function lostReason(reason: HandlerFailureReason): TraceFailureReason {
  return reason === "value_from_tap" ? "result_invalid" : reason;
}

function combineSignals(...signals: readonly (AbortSignal | undefined)[]): AbortSignal | undefined {
  const present = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (present.length === 0) return undefined;
  const [only] = present;
  return present.length === 1 && only !== undefined ? only : AbortSignal.any(present);
}

/**
 * 디스패치 순서. 정렬 키 (tierOf, loadIndex, seq)의 사전식 오름차순(F.extensions.spec §4.2) 뒤에 훅별 순서 덮어쓰기를 적용한다.
 * 디스패치와 읽기 조회(extReadViewOf().handlers)가 이 함수를 같이 써서 순서가 어긋나지 않게 한다
 */
export function sortEntries(
  entries: readonly HandlerEntry[],
  point: HookName,
  policy: DispatchPolicy,
): readonly HandlerEntry[] {
  const keyed = entries.map((entry) => ({ entry, tier: policy.tierOf(infoOf(entry)) }));
  keyed.sort(
    (a, b) => a.tier - b.tier || a.entry.loadIndex - b.entry.loadIndex || a.entry.seq - b.entry.seq,
  );
  const sorted = keyed.map((item) => item.entry);
  return orderEntries(sorted, policy.handlerOrder?.(point));
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

  function makeEnv(
    point: HookName,
    options: AnyDispatchOptions,
    trace: TraceDispatch | undefined,
  ): FoldEnv {
    async function runOne(entry: HandlerEntry, args: readonly unknown[]): Promise<RunResult> {
      const info = infoOf(entry);
      const outer = combineSignals(options.signal, entry.signal);
      const state = deps.stateOf(options.threadId, entry.scopeId);
      const work = (signal: AbortSignal, gate: HandlerGate): Promise<unknown> =>
        Promise.resolve().then(() =>
          withAmbient(
            {
              threadId: options.threadId,
              scopeId: entry.scopeId,
              point,
              dispatchKey: options.dispatchKey,
              counter: 0,
              drive: null,
              handler: { signal, gate },
              ...(trace === undefined ? {} : { trace }),
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
      const startedAt = deps.now();
      const outcome =
        policy.run === undefined
          ? await ownRun(work, policy.budgetMs(info), outer, deps, `${point}@${entry.scopeId}`)
          : await policy.run(info, work, outer);
      switch (outcome.kind) {
        case "settled":
          return {
            kind: "ok",
            value: outcome.value,
            activeMs: outcome.activeMs,
            startedAt,
          };
        case "threw":
          return {
            kind: "failed",
            failure: failureOf(entry, "threw", outcome.error, outcome.activeMs),
            startedAt,
          };
        case "timeout":
          return {
            kind: "failed",
            failure: failureOf(entry, "timeout", undefined, outcome.budgetMs),
            startedAt,
          };
        case "aborted":
          return { kind: "aborted", startedAt, elapsedMs: deps.now() - startedAt };
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
      noteOk(entry, run, verdict) {
        if (trace === undefined) return;
        trace.record({
          registrationId: entry.scopeId,
          durationMs: run.activeMs,
          startedAt: run.startedAt,
          result: verdict.result,
          size: verdict.result === "modified" ? sizeOfValue(verdict.value) : 0,
          skippedBy: null,
          reason: verdict.result === "failed" ? verdict.reason : null,
        });
      },
      noteLost(entry, run) {
        if (trace === undefined) return;
        trace.record({
          registrationId: entry.scopeId,
          durationMs: run.kind === "failed" ? run.failure.elapsedMs : run.elapsedMs,
          startedAt: run.startedAt,
          result: run.kind === "failed" ? "failed" : "skipped",
          size: 0,
          skippedBy: null,
          reason: run.kind === "failed" ? lostReason(run.failure.reason) : null,
        });
      },
      skip(entries, by) {
        if (trace === undefined) return;
        const at = deps.now();
        for (const entry of entries) {
          trace.record({
            registrationId: entry.scopeId,
            durationMs: 0,
            startedAt: at,
            result: "skipped",
            size: 0,
            skippedBy: by.scopeId,
            reason: null,
          });
        }
      },
    };
  }

  return {
    async dispatch(point, payload, options) {
      const decl = HOOKS[point];
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
      // 계측 기록기는 디스패치마다 한 번 시작한다. 계측이 꺼졌거나 Turn을 정할 수 없으면 undefined다(X.operations §4.8.1)
      const trace = deps.trace?.start({
        threadId: options.threadId,
        dispatchKey: options.dispatchKey,
        hook: point,
        now: deps.now(),
      });
      // 단계가 새로 시작될 때 보류 중인 순서 변경을 적용한다. 이 호출은 아래 스냅샷과 정렬보다 앞선다
      if (point === "boundary.turn.before" || point === "boundary.step.before") {
        policy.onStepBoundary?.();
      }
      const entries = sortEntries(
        deps.registry
          .snapshot(point, options.threadId)
          .filter(
            (entry) => options.onlyScope === undefined || entry.scopeId === options.onlyScope,
          ),
        point,
        policy,
      );
      const fold = decl.fold;
      if (fold === "tap" && decl.dispatch === "detached") {
        // 완료를 기다리지 않는다. 핸들러는 이 호출이 돌아온 뒤에 순서대로 실행하고, 실패는 정책과 진단으로만 보고한다.
        // 디스패치 전체의 취소 신호는 쓰지 않는다(호출한 turn이 끝나도 계속 돈다). thread가 닫히면 중단한다
        const threadSignal = deps.threadSignal(options.threadId);
        const detachedOptions: AnyDispatchOptions = {
          threadId: options.threadId,
          dispatchKey: options.dispatchKey,
          ...(threadSignal === undefined ? {} : { signal: threadSignal }),
        };
        const env = makeEnv(point, detachedOptions, trace);
        deps.track(
          Promise.resolve().then(async () => {
            await foldTap(env, entries, payload);
            return undefined;
          }),
        );
        return { fold: "tap", detached: true, failures: [] };
      }
      const env = makeEnv(point, options, trace);
      switch (fold) {
        case "tap":
          return foldTap(env, entries, payload);
        case "first":
          if (!isFirstHook(point)) throw new Bug(`dispatch.fold_mismatch: ${point}`);
          return foldFirst(env, point, entries, payload);
        case "chain": {
          if (!isChainHook(point)) throw new Bug(`dispatch.fold_mismatch: ${point}`);
          const outcome = await foldChain(env, point, entries, payload, {
            initial: options.initial,
            finalize: options.finalize,
          });
          // X-19: 단계 경계 처리가 끝난 뒤에 멈춘다. 그래서 단계 끝 커밋과 다음 단계(새 turn, drive 재호출)가 멈춘 동안 시작되지 않는다.
          // 이 훅 이름만 검사하므로 다른 디스패치는 Map 조회도 하지 않는다
          if (point === "boundary.step.after" && deps.stepPause !== undefined) {
            await deps.stepPause.hold(options.threadId, options.signal);
          }
          return outcome;
        }
        case "collect":
          if (!isCollectHook(point)) throw new Bug(`dispatch.fold_mismatch: ${point}`);
          return foldCollect(env, point, entries, payload, { initial: options.initial });
        default:
          return assertNever(fold, "HookDecl.fold");
      }
    },
  };
}

/** 훅 이름이 N인 타입 있는 호출로 좁힌다. 타입은 훅 표가 보장하고 런타임 값은 그대로다 */
export function typedDispatch<N extends HookName>(
  dispatcher: Dispatcher,
  point: N,
  payload: PayloadOf<N>,
  options: DispatchOptions<N>,
): Promise<DispatchOutcome<N>> {
  return restoreOutcome(dispatcher.dispatch(point, payload, eraseDispatchOptions(options)), point);
}
