import { attempt } from "@fresnel/contracts";
import { HOOKS, type FailurePolicy, type Fold } from "@fresnel/contracts/extensions";
import type { HandlerFailure, HandlerFailureReason } from "../primitives/dispatch-types.ts";
import type { ExtMethodSettled } from "../primitives/ext-method.ts";
import type { HandlerOwner, HandlerOwnerKey, Tier } from "./tier.ts";
import { ownerKey } from "./tier.ts";

/** primitives의 HandlerFailureReason에서 value_from_tap을 뺀 것 + 외부 훅·격리 실패(X.operations.spec §3.3) */
type FailureKind =
  | Exclude<HandlerFailureReason, "value_from_tap">
  | "hook_exit"
  | "hook_output"
  | "hook_spawn"
  | "isolation_exited";

type HandlerResultKind = "ok" | "aborted" | "value_from_tap" | FailureKind;

/** 확장 메서드 호출 기록의 점. 훅 지점이 아니므로 HOOKS에 없고, 동사는 `verb`로 구분한다 [제안] */
const EXT_METHOD_POINT = "ext.method" as const;

export interface HandlerOutcomeRecord {
  readonly owner: HandlerOwner;
  readonly tier: Tier;
  /** 훅 지점. 확장 메서드 호출의 기록이면 `"ext.method"`다 */
  readonly point: HandlerFailure["point"] | "ext.method";
  /** 훅의 fold. 메서드 기록에는 없다 */
  readonly fold?: Fold;
  /** 그 훅 선언의 실패 정책(`HOOKS[point].failure`). 장부는 이 값으로 기록한 실패의 결과를 구분한다. 메서드 기록에는 없다 */
  readonly failure?: FailurePolicy;
  /** 확장 메서드의 동사. 메서드 기록에만 있다 */
  readonly verb?: string;
  readonly result: HandlerResultKind;
  /** 멈춘 시간을 뺀 실행 시간 */
  readonly activeMs: number;
  /** deps.now() */
  readonly at: number;
  /** 오류 메시지 앞 500자 */
  readonly message?: string;
}

export interface FailureStats {
  readonly consecutive: number;
  readonly windowCalls: number;
  readonly windowFailures: number;
  readonly totalCalls: number;
  readonly totalFailures: number;
  readonly lastFailure?: HandlerOutcomeRecord;
}

export interface FailureLedger {
  /** aborted와 value_from_tap은 창에 넣지 않고 연속 수도 바꾸지 않는다 */
  record(outcome: HandlerOutcomeRecord): FailureStats;
  stats(key: HandlerOwnerKey): FailureStats;
  reset(key: HandlerOwnerKey): void;
  snapshot(): ReadonlyMap<HandlerOwnerKey, FailureStats>;
}

const MESSAGE_LIMIT = 500;

function textOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  // 순환 참조 등으로 직렬화하지 못하는 값은 고정 문구로 대신한다. 원인(cause)은 진단 메시지에 싣지 않는다
  const json = attempt(() => JSON.stringify(error));
  return json.ok && typeof json.value === "string" ? json.value : "unknown error";
}

function messageOf(error: unknown): string | undefined {
  if (error === undefined) return undefined;
  return textOf(error).slice(0, MESSAGE_LIMIT);
}

/** primitives HandlerFailure → 장부 기록. value_from_tap은 기록만 하고 실패로 세지 않는다 */
export function fromHandlerFailure(
  failure: HandlerFailure,
  tier: Tier,
  at: number,
): HandlerOutcomeRecord {
  const message = messageOf(failure.error);
  return {
    owner: { type: "extension", name: failure.handler.extension, scopeId: failure.handler.scopeId },
    tier,
    point: failure.point,
    fold: HOOKS[failure.point].fold,
    failure: HOOKS[failure.point].failure,
    result: failure.reason,
    activeMs: failure.elapsedMs,
    at,
    ...(message === undefined ? {} : { message }),
  };
}

/**
 * 확장 메서드 호출의 보고 → 장부 기록. 호출한 쪽의 잘못(params_invalid)과 취소(aborted)는 세지 않으므로 기록이 없다(undefined).
 * ok는 성공으로, threw·timeout·result_invalid는 실패로 기록한다. 소유는 확장이라 훅 실패와 같은 키(`ext:<이름>`)를 쓴다
 */
export function fromMethodSettled(
  info: ExtMethodSettled,
  tier: Tier,
  at: number,
): HandlerOutcomeRecord | undefined {
  if (info.outcome === "params_invalid" || info.outcome === "aborted") return undefined;
  return {
    owner: { type: "extension", name: info.extension, scopeId: info.scopeId },
    tier,
    point: EXT_METHOD_POINT,
    verb: info.verb,
    result: info.outcome,
    activeMs: info.activeMs,
    at,
    ...(info.message === undefined ? {} : { message: info.message }),
  };
}

interface LedgerEntry {
  consecutive: number;
  /** true는 실패. 최근 windowSize번의 호출 */
  window: boolean[];
  totalCalls: number;
  totalFailures: number;
  lastFailure: HandlerOutcomeRecord | undefined;
}

const EMPTY_STATS: FailureStats = {
  consecutive: 0,
  windowCalls: 0,
  windowFailures: 0,
  totalCalls: 0,
  totalFailures: 0,
};

function statsOf(entry: LedgerEntry): FailureStats {
  return {
    consecutive: entry.consecutive,
    windowCalls: entry.window.length,
    windowFailures: entry.window.filter(Boolean).length,
    totalCalls: entry.totalCalls,
    totalFailures: entry.totalFailures,
    ...(entry.lastFailure === undefined ? {} : { lastFailure: entry.lastFailure }),
  };
}

export function createFailureLedger(options: { readonly windowSize: number }): FailureLedger {
  const entries = new Map<HandlerOwnerKey, LedgerEntry>();

  function entryOf(key: HandlerOwnerKey): LedgerEntry {
    let entry = entries.get(key);
    if (entry === undefined) {
      entry = {
        consecutive: 0,
        window: [],
        totalCalls: 0,
        totalFailures: 0,
        lastFailure: undefined,
      };
      entries.set(key, entry);
    }
    return entry;
  }

  return {
    record(outcome) {
      const key = ownerKey(outcome.owner);
      if (outcome.result === "aborted" || outcome.result === "value_from_tap") {
        const existing = entries.get(key);
        return existing === undefined ? EMPTY_STATS : statsOf(existing);
      }
      const entry = entryOf(key);
      const failed = outcome.result !== "ok";
      entry.totalCalls += 1;
      entry.window.push(failed);
      if (entry.window.length > options.windowSize) {
        entry.window.splice(0, entry.window.length - options.windowSize);
      }
      if (failed) {
        entry.consecutive += 1;
        entry.totalFailures += 1;
        entry.lastFailure = outcome;
      } else {
        entry.consecutive = 0;
      }
      return statsOf(entry);
    },
    stats(key) {
      const entry = entries.get(key);
      return entry === undefined ? EMPTY_STATS : statsOf(entry);
    },
    reset(key) {
      entries.delete(key);
    },
    snapshot() {
      return new Map([...entries].map(([key, entry]) => [key, statsOf(entry)]));
    },
  };
}
