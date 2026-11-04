// operations 도메인의 모든 export(패키지 내부용 포함). 루트(src/index.ts)는 공개 이름만 다시 내보낸다.
import { err, ok, type Result } from "@fresnel/contracts";
import {
  HOOKS,
  type ExtensionLayer,
  type ExtensionName,
  type PortLookup,
} from "@fresnel/contracts/extensions";
import type { ProjectorFailure } from "@fresnel/contracts/records";
import type { ResourcePolicy } from "../primitives/resources.ts";
import type {
  DispatchPolicy,
  HandlerEntryInfo,
  HandlerFailure,
} from "../primitives/dispatch-types.ts";
import type { ExtMethodSettled, MethodRun } from "../primitives/ext-method.ts";
import type { InstallSource, TrustLevel } from "../loading-trust/trust/levels.ts";
import {
  createAutoDisabler,
  createLogNotifier,
  type AutoDisabler,
  type OperationsNotifier,
  type RegistrationControl,
} from "./auto-disable.ts";
import {
  budgetMsFrom,
  runWithBudget,
  type BudgetDeps,
  type BudgetGate,
  type BudgetOutcome,
} from "./budget.ts";
import {
  createFailureLedger,
  fromHandlerFailure,
  fromMethodSettled,
  type FailureLedger,
} from "./failure.ts";
import { isHookUnitName } from "./hooks/names.ts";
import { createHookOrderState, type HookOrderState } from "./hook-order.ts";
import { createResourcePolicy, NO_RESERVED_NAMES, type ReservedNames } from "./naming.ts";
import type { OperationsSettingsSource } from "./settings-keys.ts";
import { createExtStorageManager, type ExtStorageManager } from "./storage/ext-storage.ts";
import { DEFAULT_TRACE_SETTINGS, type TraceSettings } from "./trace-buffer.ts";
import {
  assignTier,
  createTierTable,
  tierOfFrom,
  type HookId,
  type Tier,
  type TierError,
  type TierTable,
} from "./tier.ts";

export {
  allowedInSafeMode,
  NO_STARTUP_OPTIONS,
  shouldSuggestSafeMode,
  startupFilter,
  type LoadCandidate,
  type SafeModeSource,
  type StartupOptions,
} from "./safe-mode.ts";
export {
  assignTier,
  compareOrderKey,
  GUARD_EXTENSIONS,
  orderKeyOf,
  ownerKey,
  TIERS,
  type Tier,
} from "./tier.ts";
export {
  checkOrder,
  createHookOrderState,
  hookOrderOf,
  hookOrderValue,
  previewOrder,
  type AutoDisableNote,
  type GuardRiskNote,
  type HookOrderMap,
  type HookOrderState,
  type OrderPreview,
  type OrderRow,
  type PreviewRef,
  type PreviewRow,
  type SkipNote,
  type SkipReason,
  type ValueChangeNote,
} from "./hook-order.ts";
export {
  awaitUser,
  budgetClassOf,
  budgetMsFrom,
  DEFAULT_BUDGETS_MS,
  runWithBudget,
  STREAM_TAP_HOOKS,
} from "./budget.ts";
export type { BudgetClass, BudgetTable } from "./budget.ts";
export {
  createResourcePolicy,
  NO_RESERVED_NAMES,
  qualifiedName,
  resolveNames,
  type NamedResourceKind,
  type ReservedNames,
  type ResolvedName,
  type ResourceClaim,
} from "./naming.ts";
export {
  createFailureLedger,
  fromHandlerFailure,
  fromMethodSettled,
  type FailureStats,
  type HandlerOutcomeRecord,
} from "./failure.ts";
export {
  createAutoDisabler,
  createLogNotifier,
  createRegistrationControl,
  createVolatileNotifier,
  DEFAULT_AUTO_DISABLE,
  judgeAutoDisable,
  type AutoDisablePolicy,
  type OperationsNotifier,
  type ScopeChangeReason,
  type RegistrationControl,
  type RegistrationToggleSource,
} from "./auto-disable.ts";
export {
  createStaticOperationsSettings,
  operationsSettings,
  type OperationsSettingsSource,
  type StaticOperationsSettings,
} from "./settings-keys.ts";
export {
  createTraceBuffer,
  DEFAULT_TRACE_SETTINGS,
  type TraceBuffer,
  type TraceSettings,
} from "./trace-buffer.ts";
export {
  createExtStorageManager,
  storageOf,
  type ExtProjection,
  type ExtQuery,
  type ExtStorage,
  type ExtStorageManager,
  type ExtTableReader,
  type ExtTables,
  type ExtTableWriter,
} from "./storage/ext-storage.ts";
export type { ExtRowError, ExtStorageError } from "./storage/errors.ts";
export {
  columnsOf,
  columnTypeOf,
  extTableName,
  extTablePrefix,
  parseExtTableName,
  RESERVED_LOCAL_TABLES,
  tableDdl,
  THREAD_COLUMN,
  type ExtTableDef,
  type ExtTableDefs,
} from "./storage/tables.ts";
export { checkStatement } from "./storage/guard.ts";

export * from "./hooks/index.ts";

export interface OperationsDeps {
  readonly now: () => number;
  readonly setTimer: (ms: number, fn: () => void) => () => void;
  /** x.operations.* 유효 값 읽기. 조립 루트가 설정 서비스에 연결해 넘긴다 */
  readonly settings: OperationsSettingsSource;
  /** ExtHost보다 먼저 만들어지므로 조립 루트가 늦게 연결한다 */
  readonly scopes: RegistrationControl;
  readonly notifier?: OperationsNotifier;
  readonly hooks?: { disable(id: HookId): void; enable(id: HookId): void };
  /** 포트 조회. 정책이 ExtHost보다 먼저 만들어지므로 조립 루트가 ExtHost.ports를 가리키는 늦은 연결로 넘긴다 */
  readonly ports: PortLookup;
  /** 진단 출력(운영 로그). 기본은 버린다 */
  readonly log?: (line: string) => void;
  /** 저장 영역이 생성한 모든 SQL 문장에 checkStatement를 적용한다. 테스트·디버그 빌드용 */
  readonly guardStatements?: boolean;
  /** 외부 확장이 짧은 이름으로 쓸 수 없는 내장 이름. 기본은 없음(내장 패키지의 등록만 짧은 이름을 지킨다) */
  readonly reservedNames?: ReservedNames;
  /** 답할 화면이 있나(연결된 클라이언트). 없으면 자동 끄기 기준을 넘어도 묻지도 끄지도 않는다 [결정: 2026-11-04 사용자] */
  readonly canAsk?: () => boolean;
}

/** admit이 받는 확장 정보. LoadedExtensionInfo의 부분형이다(타입 순환을 피하려고 구조로 적는다) */
export interface AdmitInfo {
  readonly name: ExtensionName;
  readonly source: InstallSource;
  readonly trust: TrustLevel;
  readonly essential: boolean;
}

export interface OperationsPolicy extends DispatchPolicy {
  /** 성공 보고. 연속 실패 수를 0으로 돌리고 창에 넣는다 */
  onHandlerSettled(entry: HandlerEntryInfo, activeMs: number): void;
  /** runWithBudget으로 핸들러를 실행한다. gate는 핸들러 UI 포트 래퍼에 넘어가 사용자 응답 대기를 뺀다 */
  run<T>(
    entry: HandlerEntryInfo,
    work: (signal: AbortSignal, gate: BudgetGate) => T | Promise<T>,
    outer: AbortSignal | undefined,
  ): Promise<BudgetOutcome<T>>;
  /**
   * 확장 메서드 처리기를 `x.operations.budget.uiMs` 예산 안에서 실행한다. `ExtHostDeps.methodRun`에 넘긴다.
   * gate는 `hostOf(g).awaitUser`가 쓰고 대기 동안 예산 시계를 멈춘다(X.primitives.spec §4.12) [제안, M4 T-XV]
   */
  readonly runMethod: MethodRun;
  /**
   * 확장 메서드 호출의 보고를 장부에 넣는다. `ExtHostDeps.onMethodSettled`에 넘긴다. params_invalid(호출한 쪽의 잘못)와
   * aborted(취소)는 세지 않는다. ok는 성공, threw·timeout·result_invalid는 실패로 훅 실패와 같은 경로를 탄다(X.operations.spec §4.3) [제안]
   */
  readonly onMethodSettled: (info: ExtMethodSettled) => void;
  readonly tiers: TierTable;
  /** 훅별 순서 덮어쓰기 상태. handlerOrder는 적용 중인 값을, onStepBoundary는 보류 중인 값을 적용한다 */
  readonly hookOrder: HookOrderState;
  readonly ledger: FailureLedger;
  readonly autoDisabler: AutoDisabler;
  /** 확장 전용 저장 영역 관리자. storageOf(g)가 쓴다 */
  readonly storage: ExtStorageManager;
  /** 리소스 이름 충돌 판정. 조립 루트가 `ExtHostDeps.resourcePolicy`에 넘긴다(O-19) */
  readonly resources: ResourcePolicy;
  /** 로더가 확장을 설치하기 전(6a단계)에 부른다. assignTier 결과를 표에 넣고 면제 여부(essential)를 기억한다 */
  admit(info: AdmitInfo, layer: ExtensionLayer): Result<Tier, TierError>;
  /** 확장 제거나 설치 실패 때 표와 장부에서 뺀다 */
  forget(name: ExtensionName): void;
  /** x.operations.budget.setupMs 유효 값. 조립 루트가 ExtHostDeps.setupBudgetMs에 넘긴다 */
  setupBudgetMs(): number;
  /** x.operations.trace.* 유효 값(X.operations §3.9). 조립 루트가 ExtHostDeps.trace에 넘긴다 */
  trace(): TraceSettings;
}

const NOOP_HOOKS = { disable: () => {}, enable: () => {} };

export function createOperationsPolicy(deps: OperationsDeps): OperationsPolicy {
  const tiers = createTierTable();
  // 외부 훅 단위의 tier는 훅이 적힌 범위가 정한다(X.operations.spec §4.7.6). 단위를 싣을 때 조립이 `tiers`에 넣는다
  const essentials = new Set<ExtensionName>();
  const budgetOf = budgetMsFrom(() => deps.settings.budgets());
  const budgetDeps: BudgetDeps = { now: deps.now, setTimer: deps.setTimer };
  // 창 크기는 설정을 live로 반영한다: 호출마다 현재 값을 읽는다
  const ledger = createFailureLedger({
    get windowSize(): number {
      return deps.settings.autoDisable().windowSize;
    },
  });
  const autoDisabler = createAutoDisabler({
    ledger,
    policy: () => deps.settings.autoDisable(),
    scopes: deps.scopes,
    hooks: deps.hooks ?? NOOP_HOOKS,
    notifier: deps.notifier ?? createLogNotifier(deps.log ?? (() => {})),
    isExempt: (key) => key.startsWith("ext:") && essentials.has(key.slice("ext:".length)),
    tierOf: (key) => (key.startsWith("ext:") ? tiers.get(key.slice("ext:".length)) : undefined),
    ...(deps.canAsk === undefined ? {} : { canAsk: deps.canAsk }),
  });
  const storage = createExtStorageManager({
    ports: deps.ports,
    now: deps.now,
    guard: deps.guardStatements ?? false,
    onProjectionFailure: (extension: ExtensionName, _failure: ProjectorFailure) => {
      autoDisabler.disableNow(`ext:${extension}`, "projection_failed");
    },
  });

  function tierFor(extension: ExtensionName): Tier {
    return tiers.get(extension) ?? "builtin";
  }
  // 저장된 순서는 만들 때 읽고, 조립이 설정 파일을 읽은 뒤 start로 다시 든다. 이후 바뀐 순서는 단계 경계에서만 적용한다
  const hookOrder = createHookOrderState(() => deps.settings.hookOrder?.() ?? new Map());

  return {
    tierOf: tierOfFrom(tiers),
    // 외부 훅 단위는 훅마다 자기 예산을 쓴다(실행기가 건다). 단위 핸들러에는 바깥 예산을 걸지 않는다
    budgetMs: (entry) => (isHookUnitName(entry.extension) ? null : budgetOf(entry)),
    handlerOrder: (point) => hookOrder.applied(point),
    onStepBoundary() {
      hookOrder.applyPending();
    },
    hookOrder,
    onHandlerFailure(failure: HandlerFailure) {
      // 외부 훅의 실패는 실행기가 `hook:<id>`로 직접 장부에 넣는다
      if (isHookUnitName(failure.handler.extension)) return;
      autoDisabler.onOutcome(
        fromHandlerFailure(failure, tierFor(failure.handler.extension), deps.now()),
      );
    },
    onHandlerSettled(entry, activeMs) {
      if (isHookUnitName(entry.extension)) return;
      autoDisabler.onOutcome({
        owner: { type: "extension", name: entry.extension, scopeId: entry.scopeId },
        tier: tierFor(entry.extension),
        point: entry.point,
        fold: HOOKS[entry.point].fold,
        failure: HOOKS[entry.point].failure,
        result: "ok",
        activeMs,
        at: deps.now(),
      });
    },
    run(entry, work, outer) {
      return runWithBudget(work, budgetOf(entry), budgetDeps, outer);
    },
    runMethod(work, outer) {
      return runWithBudget(work, deps.settings.budgets().ui, budgetDeps, outer);
    },
    onMethodSettled(info) {
      const record = fromMethodSettled(info, tierFor(info.extension), deps.now());
      if (record !== undefined) autoDisabler.onOutcome(record);
    },
    tiers,
    ledger,
    autoDisabler,
    storage,
    resources: createResourcePolicy(deps.reservedNames ?? NO_RESERVED_NAMES),
    admit(info, layer): Result<Tier, TierError> {
      const assigned = assignTier({
        name: info.name,
        source: info.source,
        trust: info.trust,
        layer,
      });
      if (!assigned.ok) return err(assigned.error);
      tiers.set(info.name, assigned.value);
      if (info.essential) essentials.add(info.name);
      return ok(assigned.value);
    },
    forget(name) {
      tiers.delete(name);
      essentials.delete(name);
      ledger.reset(`ext:${name}`);
      storage.release(name);
    },
    setupBudgetMs: () => deps.settings.budgets().setup,
    trace: () => deps.settings.trace?.() ?? DEFAULT_TRACE_SETTINGS,
  };
}
