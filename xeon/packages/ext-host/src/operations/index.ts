// operations 도메인의 모든 export(패키지 내부용 포함). 루트(src/index.ts)는 공개 이름만 다시 내보낸다.
import { err, ok, type Result } from "@xeon/contracts";
import {
  POINTS,
  type ExtensionManifest,
  type ExtensionName,
  type PortLookup,
} from "@xeon/contracts/extensions";
import type { ProjectorFailure } from "@xeon/contracts/records";
import type { ResourcePolicy } from "../primitives/resources.ts";
import type {
  DispatchPolicy,
  HandlerEntryInfo,
  HandlerFailure,
} from "../primitives/dispatch-types.ts";
import type { InstallSource, TrustLevel } from "../loading-trust/trust/levels.ts";
import {
  createAutoDisabler,
  createLogNotifier,
  type AutoDisabler,
  type OperationsNotifier,
  type ScopeControl,
} from "./auto-disable.ts";
import {
  budgetMsFrom,
  runWithBudget,
  type BudgetDeps,
  type BudgetGate,
  type BudgetOutcome,
} from "./budget.ts";
import { createFailureLedger, fromHandlerFailure, type FailureLedger } from "./failure.ts";
import { createResourcePolicy, NO_RESERVED_NAMES, type ReservedNames } from "./naming.ts";
import type { OperationsSettingsSource } from "./settings-keys.ts";
import { createExtStorageManager, type ExtStorageManager } from "./storage/ext-storage.ts";
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
  assignTier,
  compareOrderKey,
  GUARD_EXTENSIONS,
  orderKeyOf,
  ownerKey,
  TIERS,
  type Tier,
} from "./tier.ts";
export {
  awaitUser,
  budgetClassOf,
  budgetMsFrom,
  DEFAULT_BUDGETS_MS,
  runWithBudget,
  STREAM_TAP_POINTS,
} from "./budget.ts";
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
  type FailureStats,
  type HandlerOutcomeRecord,
} from "./failure.ts";
export {
  createAutoDisabler,
  createLogNotifier,
  createScopeControl,
  DEFAULT_AUTO_DISABLE,
  judgeAutoDisable,
  type AutoDisablePolicy,
  type OperationsNotifier,
  type ScopeChangeReason,
  type ScopeControl,
  type ScopeToggleSource,
} from "./auto-disable.ts";
export {
  createStaticOperationsSettings,
  operationsSettings,
  type OperationsSettingsSource,
  type StaticOperationsSettings,
} from "./settings-keys.ts";
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

export interface OperationsDeps {
  readonly now: () => number;
  readonly setTimer: (ms: number, fn: () => void) => () => void;
  /** x.operations.* 유효 값 읽기. 조립 루트가 설정 서비스에 연결해 넘긴다 */
  readonly settings: OperationsSettingsSource;
  /** ExtHost보다 먼저 만들어지므로 조립 루트가 늦게 연결한다 */
  readonly scopes: ScopeControl;
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
  readonly tiers: TierTable;
  readonly ledger: FailureLedger;
  readonly autoDisabler: AutoDisabler;
  /** 확장 전용 저장 영역 관리자. storageOf(g)가 쓴다 */
  readonly storage: ExtStorageManager;
  /** 리소스 이름 충돌 판정. 조립 루트가 `ExtHostDeps.resourcePolicy`에 넘긴다(O-19) */
  readonly resources: ResourcePolicy;
  /** 로더가 확장을 설치하기 전(6a단계)에 부른다. assignTier 결과를 표에 넣고 면제 여부(essential)를 기억한다 */
  admit(info: AdmitInfo, layer: ExtensionManifest["layer"]): Result<Tier, TierError>;
  /** 확장 제거나 설치 실패 때 표와 장부에서 뺀다 */
  forget(name: ExtensionName): void;
  /** x.operations.budget.setupMs 유효 값. 조립 루트가 ExtHostDeps.setupBudgetMs에 넘긴다 */
  setupBudgetMs(): number;
}

const NOOP_HOOKS = { disable: () => {}, enable: () => {} };

export function createOperationsPolicy(deps: OperationsDeps): OperationsPolicy {
  const tiers = createTierTable();
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

  return {
    tierOf: tierOfFrom(tiers),
    budgetMs: budgetOf,
    onHandlerFailure(failure: HandlerFailure) {
      autoDisabler.onOutcome(
        fromHandlerFailure(failure, tierFor(failure.handler.extension), deps.now()),
      );
    },
    onHandlerSettled(entry, activeMs) {
      autoDisabler.onOutcome({
        owner: { type: "extension", name: entry.extension, scopeId: entry.scopeId },
        tier: tierFor(entry.extension),
        point: entry.point,
        fold: POINTS[entry.point].fold,
        result: "ok",
        activeMs,
        at: deps.now(),
      });
    },
    run(entry, work, outer) {
      return runWithBudget(work, budgetOf(entry), budgetDeps, outer);
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
  };
}
