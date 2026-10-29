import { attempt } from "@xeon/contracts";
import type { ExtensionName, ScopeId } from "@xeon/contracts/extensions";
import type { ScopeChangedPayload, ScopeHandlerFailedPayload } from "@xeon/contracts/records";
import type { FailureLedger, FailureStats, HandlerOutcomeRecord } from "./failure.ts";
import { ownerKey, type HandlerOwnerKey, type HookId, type Tier } from "./tier.ts";

export interface AutoDisablePolicy {
  readonly enabled: boolean;
  /** 연속 실패 기준 */
  readonly consecutive: number;
  /** 최근 호출 창 크기 */
  readonly windowSize: number;
  /** 실패율 기준을 적용하는 최소 실패 수 */
  readonly minFailures: number;
  /** 0~1 */
  readonly failureRate: number;
}

export const DEFAULT_AUTO_DISABLE: AutoDisablePolicy = {
  enabled: true,
  consecutive: 5,
  windowSize: 50,
  minFailures: 10,
  failureRate: 0.5,
};

/** 자동 끄기 대상에서 빼는 tier. essential 확장도 뺀다(X.loading-trust.spec §4.3.2) */
const AUTO_DISABLE_EXEMPT_TIERS: ReadonlySet<Tier> = new Set<Tier>(["guard", "core"]);

export type AutoDisableVerdict =
  | { readonly disable: false }
  | {
      readonly disable: true;
      readonly rule: "consecutive" | "rate";
      readonly stats: FailureStats;
    };

/** 순수 함수. exempt가 참이면 항상 disable:false */
export function judgeAutoDisable(
  stats: FailureStats,
  policy: AutoDisablePolicy,
  exempt: boolean,
): AutoDisableVerdict {
  if (!policy.enabled || exempt) return { disable: false };
  if (stats.consecutive >= policy.consecutive) return { disable: true, rule: "consecutive", stats };
  if (
    stats.windowFailures >= policy.minFailures &&
    stats.windowCalls > 0 &&
    stats.windowFailures / stats.windowCalls >= policy.failureRate
  ) {
    return { disable: true, rule: "rate", stats };
  }
  return { disable: false };
}

/** scope 끄기 요청 사유. F.records ScopeChangedPayload.reason의 값 정본(F.records.spec §3.3) */
export type ScopeChangeReason = NonNullable<ScopeChangedPayload["reason"]>;

/**
 * scope 제어 포트. 조립 루트가 ExtHost에 늦게 연결한다. 요청만 기록하고 적용은 다음 단계 경계다
 */
export interface ScopeControl {
  requestDisable(scopeId: ScopeId, reason: ScopeChangeReason): void;
  requestEnable(scopeId: ScopeId, reason: ScopeChangeReason): void;
  scopesOf(extension: ExtensionName): readonly ScopeId[];
}

/** ExtHost에서 ScopeControl을 만드는 재료. primitives의 scopeToggleSourceOf가 돌려준다 */
export interface ScopeToggleSource {
  scopes(): readonly { readonly id: ScopeId; readonly extension: ExtensionName }[];
  request(scopeId: ScopeId, enabled: boolean, reason: ScopeChangeReason): void;
}

export function createScopeControl(source: ScopeToggleSource): ScopeControl {
  return {
    requestDisable: (scopeId, reason) => {
      source.request(scopeId, false, reason);
    },
    requestEnable: (scopeId, reason) => {
      source.request(scopeId, true, reason);
    },
    scopesOf: (extension) =>
      source
        .scopes()
        .filter((scope) => scope.extension === extension)
        .map((scope) => scope.id),
  };
}

/** 사용자 알림 포트. 구현은 휘발 이벤트 발신이다(X.operations.spec §4.3.4) */
export interface OperationsNotifier {
  handlerFailed(outcome: HandlerOutcomeRecord, stats: FailureStats): void;
  autoDisabled(
    key: HandlerOwnerKey,
    verdict: Extract<AutoDisableVerdict, { readonly disable: true }>,
  ): void;
  /**
   * disableNow 호출을 알린다. disabled가 거짓이면 면제 주체라 끄지 않았다(M3-REQ-36).
   * 이름은 투영기 실패 경로에서 먼저 쓰였고, cause는 격리 재시작 한도 초과도 받는다(X.operations.spec §4.3.4)
   */
  projectionFailed(
    key: HandlerOwnerKey,
    cause: "isolation_restart_limit" | "projection_failed",
    disabled: boolean,
  ): void;
}

/** 운영 로그에만 남기는 기본 알림. 휘발 이벤트 kind scope.handler_failed 발신은 L4 조립이 연결한다(O-09) */
export function createLogNotifier(log: (line: string) => void): OperationsNotifier {
  return {
    handlerFailed(outcome, stats) {
      log(
        `handler failed: ${ownerKey(outcome.owner)} ${outcome.point} ${outcome.result} (consecutive ${stats.consecutive})`,
      );
    },
    autoDisabled(key, verdict) {
      log(`auto-disabled: ${key} by ${verdict.rule}`);
    },
    projectionFailed(key, cause, disabled) {
      log(`forced disable: ${key} (${cause}) ${disabled ? "disabled" : "kept enabled (exempt)"}`);
    },
  };
}

/** 휘발 발신 포트. 발신(`emit`)과 운영 로그(`log`)는 조립 루트가 넘긴다 */
export interface VolatileNotifierDeps {
  readonly emit: (payload: ScopeHandlerFailedPayload) => void;
  readonly log: (line: string) => void;
}

/** `scope.handler_failed` 페이로드 message의 상한(F.records ScopeHandlerFailedPayloadSchema) */
const HANDLER_FAILED_MESSAGE_MAX = 4000;

function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "unknown error";
}

/**
 * 실패마다 휘발 이벤트 `scope.handler_failed`를 보내고, 같은 운영 로그 줄을 남긴다(`createLogNotifier`와 같은 줄).
 * autoDisabled는 로그만 남긴다. 자동 끄기 사실은 내구 `scope.changed`(reason auto_disable)가 이미 적는다
 * (X.operations.spec §4.3.4). 발신이 던지면 운영 로그에 남기고 호출자에게 던지지 않는다.
 */
export function createVolatileNotifier(deps: VolatileNotifierDeps): OperationsNotifier {
  const logOnly = createLogNotifier(deps.log);
  return {
    handlerFailed(outcome, stats) {
      logOnly.handlerFailed(outcome, stats);
      const payload: ScopeHandlerFailedPayload = {
        owner: ownerKey(outcome.owner),
        point: outcome.point,
        result: outcome.result,
        message: (outcome.message ?? "").slice(0, HANDLER_FAILED_MESSAGE_MAX),
        consecutive: Math.max(1, stats.consecutive),
      };
      const sent = attempt(() => {
        deps.emit(payload);
      });
      if (!sent.ok) {
        deps.log(
          `scope.handler_failed not emitted: ${payload.owner} ${payload.point} (${reasonOf(sent.error.cause)})`,
        );
      }
    },
    autoDisabled(key, verdict) {
      logOnly.autoDisabled(key, verdict);
    },
    projectionFailed(key, cause, disabled) {
      logOnly.projectionFailed(key, cause, disabled);
    },
  };
}

export interface AutoDisabler {
  /** 장부에 기록하고 판정한다. 기준을 넘으면 ScopeControl.requestDisable(…, "auto_disable")을 부른다 */
  onOutcome(outcome: HandlerOutcomeRecord): void;
  /** 사용자가 다시 켤 때. 장부를 비우고 requestEnable을 부른다 */
  reenable(key: HandlerOwnerKey): void;
  /**
   * 기준과 무관하게 바로 끈다. 격리 확장의 재시작 한도 초과와 투영기 실패에서 쓴다.
   * 면제 주체(isExempt, 면제 tier)는 끄지 않고 projectionFailed(…, false)만 보낸다. 이미 꺼진 주체는 다시 알리지 않는다
   */
  disableNow(key: HandlerOwnerKey, cause: "isolation_restart_limit" | "projection_failed"): void;
  /** 이번 프로세스에서 자동으로 꺼진 주체 */
  disabled(): readonly HandlerOwnerKey[];
}

export interface AutoDisablerDeps {
  readonly ledger: FailureLedger;
  /** 설정 live 반영 */
  readonly policy: () => AutoDisablePolicy;
  readonly scopes: ScopeControl;
  readonly hooks: { disable(id: HookId): void; enable(id: HookId): void };
  readonly notifier: OperationsNotifier;
  /** essential 확장 등 tier 밖의 면제. 없으면 면제 tier만 본다 */
  readonly isExempt?: (key: HandlerOwnerKey) => boolean;
  /**
   * 주체의 tier 조회. disableNow는 호출자가 tier를 주지 않으므로 이것으로 면제 tier를 본다.
   * 표에 없으면(undefined) tier 면제는 적용되지 않고 isExempt만 본다
   */
  readonly tierOf?: (key: HandlerOwnerKey) => Tier | undefined;
}

export function createAutoDisabler(deps: AutoDisablerDeps): AutoDisabler {
  const disabled = new Set<HandlerOwnerKey>();

  function applyDisable(key: HandlerOwnerKey): void {
    disabled.add(key);
    if (key.startsWith("ext:")) {
      for (const scopeId of deps.scopes.scopesOf(key.slice("ext:".length))) {
        deps.scopes.requestDisable(scopeId, "auto_disable");
      }
    } else {
      deps.hooks.disable(key.slice("hook:".length));
    }
  }

  return {
    onOutcome(outcome) {
      const stats = deps.ledger.record(outcome);
      if (
        outcome.result === "ok" ||
        outcome.result === "aborted" ||
        outcome.result === "value_from_tap"
      ) {
        return;
      }
      deps.notifier.handlerFailed(outcome, stats);
      const key = ownerKey(outcome.owner);
      // 이미 끄기를 요청했으면 두 번째 요청을 만들지 않는다
      if (disabled.has(key)) return;
      const exempt = AUTO_DISABLE_EXEMPT_TIERS.has(outcome.tier) || deps.isExempt?.(key) === true;
      const verdict = judgeAutoDisable(stats, deps.policy(), exempt);
      if (!verdict.disable) return;
      applyDisable(key);
      deps.notifier.autoDisabled(key, verdict);
    },
    reenable(key) {
      deps.ledger.reset(key);
      disabled.delete(key);
      if (key.startsWith("ext:")) {
        for (const scopeId of deps.scopes.scopesOf(key.slice("ext:".length))) {
          deps.scopes.requestEnable(scopeId, "request");
        }
      } else {
        deps.hooks.enable(key.slice("hook:".length));
      }
    },
    disableNow(key, cause) {
      const tier = deps.tierOf?.(key);
      const exempt =
        (tier !== undefined && AUTO_DISABLE_EXEMPT_TIERS.has(tier)) ||
        deps.isExempt?.(key) === true;
      if (exempt) {
        // 면제 주체는 실패가 날 때마다 알린다. 끄지 않으므로 중복 억제 대상이 아니다
        deps.notifier.projectionFailed(key, cause, false);
        return;
      }
      // 이미 끈 주체는 두 번 끄지도, 두 번 알리지도 않는다
      if (disabled.has(key)) return;
      applyDisable(key);
      deps.notifier.projectionFailed(key, cause, true);
    },
    disabled: () => [...disabled],
  };
}
