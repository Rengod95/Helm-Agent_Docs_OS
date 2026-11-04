import { err, ok, type Result } from "@fresnel/contracts";
import type { DurableEventEnvelope } from "@fresnel/contracts/records";
import type { IdFactory, ThreadId } from "@fresnel/contracts/conversation";
import { portAs } from "../erase.ts";
import { pluginsOf } from "@fresnel/contracts/extensions";
import type {
  SetupRefusal,
  ExtensionEntry,
  ExtensionManifest,
  ExtensionName,
  ManifestIssue,
  HookName,
  PortKey,
  PortLookup,
  RegistrationHandle,
  RegistrationId,
  RegistrationStatus,
  TestRunControlPort,
  TraceReadPort,
  TrustRequest,
  Unsubscribe,
} from "@fresnel/contracts/extensions";
import { isHookUnitName } from "../operations/hooks/names.ts";
import {
  createTraceBuffer,
  DEFAULT_TRACE_SETTINGS,
  type TraceBuffer,
  type TraceSettings,
} from "../operations/trace-buffer.ts";
import { createCapabilityBindings, type CapabilityBindings } from "./bindings.ts";
import { EMPTY_CAPABILITY_DEFS, type CapabilityDefLookup } from "./capability-guard.ts";
import {
  createEventQuery,
  toolOwnerOf,
  type EventPrefixQuery,
  type EventQueryError,
} from "./event-query.ts";
import { createLifecycle, type CommittedEvent } from "./lifecycle.ts";
import { createEffectWorker, type EffectWorkerPort } from "./effect-worker.ts";
import { createBoundary, type BoundaryHooks } from "./boundary.ts";
import type {
  ExtChange,
  HostCore,
  InstalledUnit,
  RegistrationRecord,
  ThreadOpenOptions,
  ThreadRuntime,
  PrimitivesSettingsSource,
  ResolvedDeps,
} from "./core.ts";
import { createCordisBridge } from "./cordis-bridge.ts";
import {
  createDispatcher,
  DEFAULT_DISPATCH_POLICY,
  typedDispatch,
  type DispatchOptions,
  type DispatchOutcome,
  type DispatchPolicy,
  type PayloadOf,
} from "./dispatch.ts";
import { PrimitiveError, type ExtDiagnostic } from "./errors.ts";
import { deepFreeze } from "./freeze.ts";
import { createRegistrationApi } from "./host-api.ts";
import { createLeaseBroker } from "./lease.ts";
import { createPortProvider } from "./port-provider.ts";
import { eachInOrder } from "./sequence.ts";
import { createExtUi, type ExtUi } from "./ext-ui.ts";
import { createPostQueue } from "./post.ts";
import { createHandlerRegistry } from "./registry.ts";
import {
  createResourceStore,
  type ResourcePolicy,
  type ResourceRecord,
  type ResourceRegistry,
} from "./resources.ts";
import {
  createRegistrationRuntime,
  type ResetRegistrationStateError,
  type RegistrationInfo,
  type RegistrationSetupOutcome,
  type StagedScope,
  type SwapPlan,
} from "./registration.ts";
import {
  createExtMethods,
  type ExtMethods,
  type ExtMethodSettled,
  type MethodRun,
} from "./ext-method.ts";
import { createStateService, type StateService } from "./state.ts";
import { createStepPause, type StepPause } from "./step-pause.ts";

export type {} from "./errors.ts";

/** 확장 호스트 자신(서비스 fresnel.ext, 제공 ext-host). ExtHost가 X 타입이라 F에 둘 수 없다 */
export const ExtHostPortKey: PortKey<ExtHost> = { name: "fresnel.ext" };
export type {} from "./registration.ts";
export type {} from "./core.ts";

export interface ExtHostDeps {
  /** 사건 id 발급. 경계 기여 초안의 id에 쓴다 */
  readonly ids: IdFactory;
  /** 밀리초 시각. 시간 예산 측정과 진단에만 쓴다 */
  readonly now: () => number;
  /** 시간 예산 타이머. 반환값은 취소 함수 */
  readonly setTimer: (ms: number, fn: () => void) => () => void;
  /** 순서 키·시간 예산·실패 보고. 기본값 DEFAULT_DISPATCH_POLICY. X.operations가 구현을 넘긴다 */
  readonly policy?: DispatchPolicy;
  /** 리소스(도구, 명령, 단축키, 플래그) 이름 충돌 판정. X.operations가 구현을 넘긴다. 없으면 같은 이름은 거부한다 */
  readonly resourcePolicy?: ResourcePolicy;
  /** scope setup 하나의 시간 예산(ms). 없으면 무제한 */
  readonly setupBudgetMs?: () => number | null;
  /** x.primitives.* 설정 값 읽기 */
  readonly settings: PrimitivesSettingsSource;
  /** 진단 출력. 확장 오류, 경고, 포트 부재 */
  readonly report: (diagnostic: ExtDiagnostic) => void;
  /** 참이면 페이로드·패치·결정 스키마 검사와 페이로드 동결을 켠다. 기본 참 */
  readonly strict?: boolean;
  /**
   * 기능 정의 조회. 기능 래퍼가 재실행되는 코드(on 핸들러, drive 함수)의 호출을 메서드의 `idempotent`·`readOnly` 선언으로 검사한다
   * (ADR-0015 §3.2). 없으면 정의를 모르는 기능이므로 그 문맥의 모든 호출을 거부한다
   */
  readonly capabilityDefs?: CapabilityDefLookup;
  /** 선언 없는 쓰기 요청 워커(ADR-0015 §3.5). 없으면 X의 기본 워커 */
  readonly effectWorker?: EffectWorkerPort;
  /**
   * 계측 설정 읽기(x.operations.trace.*, X.operations §3.9). 없으면 기본값(켬). 조립 루트가 OperationsPolicy.trace를 넘긴다.
   * 값은 Turn이 처음 보일 때 읽는다
   */
  readonly trace?: () => TraceSettings;
  /** 확장 메서드 호출이 처리기에 닿았을 때 한 번 부른다(X.primitives.spec §4.12). 없으면 보고하지 않는다 */
  readonly onMethodSettled?: (info: ExtMethodSettled) => void;
  /**
   * 확장 메서드 처리기를 시간 예산 안에서 실행한다(X.primitives.spec §4.12, X.operations.spec §4.2). X.operations가
   * `OperationsPolicy.runMethod`를 넘긴다. 없으면 예산 없이 실행한다 [제안, M4 T-XV]
   */
  readonly methodRun?: MethodRun;
}

/** loading-trust가 검증을 끝낸 확장 하나. 순서는 loadIndex가 정한다 */
export interface ExtensionUnit {
  readonly manifest: ExtensionManifest;
  readonly entry: ExtensionEntry;
  /** 로드 순번. 0부터. 핸들러 정렬의 둘째 키 */
  readonly loadIndex: number;
  /** 내장 패키지(core-*, cap-*, group-*)면 참. 포트 제공·조회와 fresnel.* 서비스 이름을 허용한다 */
  readonly builtin: boolean;
  /**
   * 로더가 정한 유효 신뢰 등급(X.loading-trust §4.6: 설치 위치 상한과 요청의 낮은 쪽). 매니페스트의 요청을 그대로 넘기지 않는다.
   * 로더 없이 설치한 단위는 이 값이 없고, 내장이면 builtin, 그 밖이면 가장 낮은 untrusted로 본다(요청을 믿지 않는다)
   */
  readonly trust?: TrustRequest["level"];
  /**
   * 주 scope의 초기 켜기 요청. `ext.<name>.enabled` 설정 값이 있으면 로더가 넘긴다 [제안].
   * 없으면 RegistrationDef.defaultEnabled, 매니페스트 defaultEnabled, true 순으로 정한다(X.primitives.spec §4.5.1)
   */
  readonly initialEnabled?: boolean;
}

export interface InstallResult {
  readonly name: ExtensionName;
  /** 엔트리가 정의한 scope. 엔트리가 던졌으면 빈 배열 */
  readonly registrations: readonly RegistrationId[];
  /** 매니페스트에 선언했지만 엔트리가 `register`하지 않은 플러그인의 Registration id(로더 진단 `plugin_not_registered`) */
  readonly unregistered: readonly RegistrationId[];
  /** 엔트리 본문이 던진 값. 있으면 setups는 비어 있고 등록은 남지 않는다 */
  readonly entryError?: unknown;
  readonly setups: readonly RegistrationSetupOutcome[];
  /** setups[].issues의 합 */
  readonly issues: readonly ManifestIssue[];
}

/** registerPlatform이 돌려주는 시작 실패. module은 PlatformModule.name이다 */
export interface PlatformSetupError {
  readonly kind: "setup_failed";
  readonly module: string;
  readonly reason: string;
  readonly cause: unknown;
}

/** L0 플랫폼 패키지(platform-*)의 등록 단위. 매니페스트가 없고 on·post·drive·scope를 쓰지 않는다 */
export interface PlatformModule {
  /** 패키지 매니페스트 이름. 예: "platform-store" */
  readonly name: string;
  /** 실패할 수 있는 시작은 err를 돌려준다. 던지면 버그다(포트 조회 실패 같은 호출 계약 위반) */
  setup(
    ctx: PlatformContext,
  ): void | Result<void, SetupRefusal> | Promise<void | Result<void, SetupRefusal>>;
}

/** L0 setup이 받는 좁은 객체. Cordis Context는 넘기지 않는다 */
export interface PlatformContext {
  /** fresnel.* 포트 제공 */
  providePort<Api>(key: PortKey<Api>, impl: Api): void;
  /** 먼저 등록된 다른 L0 포트 조회. 없으면 port_unavailable */
  port<Api>(key: PortKey<Api>): Api;
  /** 호스트 dispose 때 역순으로 실행한다 */
  onDispose(fn: () => void | Promise<void>): void;
}

/** install의 선택 인자 */
interface InstallOptions {
  readonly signal?: AbortSignal;
}

/** replaceUnit의 선택 인자 */
export interface ReplaceOptions {
  readonly signal?: AbortSignal;
  /** 참이면 새 버전이 저장된 상태를 받지 못할 때 그 상태를 `initial`로 다시 쓴다(되돌리기 `clearState`) */
  readonly resetRefusedState?: boolean;
}

/** 교체를 시작하지 못한 이유. 이때 아무것도 바뀌지 않았다 */
export type ReplaceFailure =
  | { readonly kind: "not_installed" }
  | { readonly kind: "entry_failed"; readonly error: unknown }
  /** 매니페스트에 선언했지만 엔트리가 `register`하지 않은 플러그인이 있다 */
  | { readonly kind: "plugins_unregistered"; readonly registrations: readonly RegistrationId[] };

/** 단계 경계에서 적용한 교체의 끝 */
export type SwapOutcome =
  | { readonly status: "applied"; readonly statesCleared: number }
  | {
      readonly status: "failed";
      readonly scopeId: RegistrationId;
      readonly code: string;
      readonly message: string;
      readonly cause: unknown;
      /** 옛 정의로 되돌려 다시 열었는가 */
      readonly restored: boolean;
      readonly failedToRestore: readonly RegistrationId[];
    }
  /** 적용되기 전에 더 새로운 교체가 들어왔다 */
  | { readonly status: "superseded" }
  /** 적용되기 전에 확장이 제거되었거나 호스트가 해제되었다 */
  | { readonly status: "cancelled" };

export interface ReplaceStarted {
  /** now: 이 호출이 돌아오기 전에 적용이 끝났다(`applied`가 이미 정해졌다). nextStepBoundary: 실행 중인 step이 끝난 경계를 기다린다 */
  readonly appliesAt: "now" | "nextStepBoundary";
  readonly applied: Promise<SwapOutcome>;
}

export type ReplaceResult = Result<ReplaceStarted, ReplaceFailure>;

export type ResetRegistrationStateHostError =
  | ResetRegistrationStateError
  | { readonly kind: "unknown_registration" }
  | { readonly kind: "thread_not_open" };

export interface ExtHost {
  /** L0 플랫폼 패키지를 등록한다. 조립 루트가 확장 설치 전에 부른다. setup이 err를 돌려주면 등록을 거두고 그 오류를 돌려준다(시작 실패). 던지면 그대로 던진다(버그) */
  registerPlatform(module: PlatformModule): Promise<Result<void, PlatformSetupError>>;
  /**
   * 엔트리를 실행해 scope 정의를 모으고, 기본 활성 scope의 켜기를 시작 적용한다.
   * signal이 중단되면 엔트리 실행을 기다리지 않고 entryError(registration_setup_failed)로 끝낸다
   */
  install(unit: ExtensionUnit, options?: InstallOptions): Promise<InstallResult>;
  /** 모든 scope를 내리고 정의를 지운다. 경계 없이 즉시 해제한다 */
  uninstall(name: ExtensionName): Promise<void>;
  /**
   * 설치된 확장의 정의를 새 버전으로 바꾼다(F.extensions.spec §4.5, X.primitives.spec §4.4.10). 새 엔트리는 호스트 상태를 건드리지 않고
   * 먼저 실행해 검사한다. 실패하면 옛 버전이 그대로 돈다. 적용은 단계 경계에서 한다: 실행 중인 turn의 step은 끊지 않고 옛 세대의
   * 핸들러가 끝낸다. 실행 중인 thread가 없으면 바로 적용한다
   */
  replaceUnit(unit: ExtensionUnit, options?: ReplaceOptions): Promise<ReplaceResult>;
  /** 포트 조회. 같은 패키지의 loading-trust·operations와 조립 루트가 쓴다 */
  readonly ports: PortLookup;
  registration(id: RegistrationId): RegistrationHandle | undefined;
  registrations(): readonly RegistrationInfo[];
  /** L1이 지점을 발화할 때 부른다 */
  dispatch<N extends HookName>(
    point: N,
    payload: PayloadOf<N>,
    options: DispatchOptions<N>,
  ): Promise<DispatchOutcome<N>>;
  /** L1 루프가 단계 경계와 유휴 진입 때 부른다 */
  readonly boundary: BoundaryHooks;
  /**
   * 이벤트가 커밋된 뒤 부른다. kind가 `LIFECYCLE_HOOKS`에 있으면 수명주기 지점(`lifecycle.agent.settled`,
   * `lifecycle.lease.rejected`)을 디스패치한다. X가 낸 경계 기여(`lease.rejected`)는 `boundary.settle`이 직접 알리므로
   * L1이 자기 커밋(위임 정착 `agent.settled`)을 알릴 때 쓴다. 끝나기를 기다린다
   */
  afterCommit(threadId: ThreadId, events: readonly CommittedEvent[]): Promise<void>;
  /**
   * thread를 열 때(새로 만들거나 재개할 때, 되감기 뒤) 상태 판, 켜짐 상태, 열린 임대를 읽어 들인다.
   * `testRun`이 참이면 Test run 대화로 표지한다(X-19). 다시 열거나 닫으면 멈춤 상태는 지워진다
   */
  openThread(threadId: ThreadId, options?: ThreadOpenOptions): Promise<void>;
  /** thread를 닫는다. Test run 표지와 멈춘 단계 경계를 풀어 기다리던 dispatch가 끝나게 한다 */
  closeThread(threadId: ThreadId): Promise<void>;
  /** thread의 현재 임대. 없거나 반납이 커밋되었으면 null(L3.group-sdk.spec §3.13 요청 2) */
  leaseOf(threadId: ThreadId): LeaseInfo | null;
  /**
   * scope 토글 요청, 적용, 임대 부여·반납이 일어나면 알린다(L3.group-sdk.spec §3.13 요청 3). 적용과 임대 변화는 경계 커밋 뒤에 부른다.
   * 구독자의 예외는 진단으로 남기고 다른 구독자에게 전달을 이어 간다
   */
  onChange(listener: (change: ExtChange) => void): Unsubscribe;
  /** L4가 읽는 명령·키 조합·플래그·렌더러 표(X.primitives.spec §3.9) */
  readonly resources: ResourceRegistry;
  /** 확장 메서드 표와 호출(X.primitives.spec §3.9.2, §4.12). 조립 루트가 wire `ext.<확장>.<동사>`를 이 함수로 넘긴다 */
  readonly methods: ExtMethods;
  /** 화면(Plugin UI)이 대화 입력 큐에 넣고 승인을 청하는 길. wire `ext.ui.post`·`ext.ui.requestApproval`이 쓴다 */
  readonly ui: ExtUi;
  /**
   * 활성 가지의 내구 이벤트를 kind 접두로 조회한다(M3-REQ-39, L3.group-sdk.spec §3.13 요청 5). `fresnel.session`의 `readBranch` 포트가 없으면
   * `port_unavailable`이다. 확장 scope에는 열지 않는 호스트용 조회다
   */
  queryEvents(
    threadId: ThreadId,
    query: EventPrefixQuery,
  ): Promise<Result<readonly DurableEventEnvelope[], EventQueryError>>;
  /**
   * 저장된 상태가 스키마·버전 검사를 못 넘겨 켜지지 못한 scope의 상태를 선언의 `initial`로 다시 쓴다(재설정 경로).
   * 대상 thread가 열려 있고 그 scope의 마지막 오류가 저장 상태 오류(`state_schema`, `state_future_version`, `state_migration_*`)여야 한다.
   * 성공해도 scope를 켜지 않는다. setup 실패로 꺼진 scope는 호출자가 `scope(id).enable()`로 다시 켠다
   */
  resetRegistrationState(
    threadId: ThreadId,
    scopeId: RegistrationId,
  ): Promise<Result<{ readonly rev: number }, ResetRegistrationStateHostError>>;
  /** 도구 이름(노출 이름 또는 등록 이름)을 등록한 scope의 리소스 기록. 없으면 undefined(M3-REQ-39 도구 소유 scope 조회) */
  toolOwner(name: string): ResourceRecord | undefined;
  /** 모든 scope를 즉시 끄고 Cordis 루트를 해제한다. 프로세스 종료용 */
  dispose(): Promise<void>;
}

/** thread 하나의 임대 정보 */
export interface LeaseInfo {
  readonly leaseId: string;
  readonly scopeId: RegistrationId;
  readonly leaseEpoch: number;
  /** active: 사용 중. releasing: 반납이 정해졌고 다음 경계에서 커밋된다 */
  readonly status: "active" | "releasing";
}

/** 패키지 안(testing, loading-trust, operations)에서만 쓰는 호스트 내부 */
export interface ExtHostInternals {
  readonly core: HostCore;
  /** 계측 링 버퍼(X-15). traceReadOf가 읽는다 */
  readonly trace: TraceBuffer;
  /** 지금 바인딩된 기능 공급자(`extReadViewOf`가 읽는다) */
  readonly bound: CapabilityBindings["bound"];
  /** 추적 중인 작업(drive 호출, 유휴 적용, 기능 바인딩)이 모두 끝나기를 기다린다 */
  whenSettled(): Promise<void>;
  /** 토글 요청을 사유와 함께 기록한다(X.operations RegistrationControl의 바탕). threadId가 있으면 그 thread만의 요청이다 */
  requestScope(
    scopeId: RegistrationId,
    enabled: boolean,
    reason?: RegistrationToggleRequestReason,
    threadId?: ThreadId,
  ): void;
  /** thread가 Test run 대화인가(`openThread`에 `testRun` 참으로 열었다). testRunControlOf가 읽는다 */
  readonly isTestRun: (threadId: ThreadId) => boolean;
  /** Test run 단계 경계 멈춤 상태(X-19). dispatch가 `boundary.step.after` 뒤에 기다리고 testRunControlOf가 요청을 바꾼다 */
  readonly stepPause: StepPause;
  /** 상태 판 읽기(커밋된 판). testRunControlOf의 phase가 쓴다 */
  readonly state: Pick<StateService, "docOf" | "revOf">;
}

type RegistrationToggleRequestReason = "request" | "auto_disable" | "safe_mode" | "startup_disable";

/** X.operations RegistrationControl의 재료. 조립 루트가 createRegistrationControl에 넘긴다 */
export interface RegistrationToggleSourceOf {
  scopes(): readonly { readonly id: RegistrationId; readonly extension: ExtensionName }[];
  request(
    scopeId: RegistrationId,
    enabled: boolean,
    reason: RegistrationToggleRequestReason,
    threadId?: ThreadId,
  ): void;
}

const internalsByHost = new WeakMap<ExtHost, ExtHostInternals>();

/** 같은 패키지에서 ExtHost의 내부를 얻는다. 루트(src/index.ts)로는 내보내지 않는다 */
export function hostInternalsOf(host: ExtHost): ExtHostInternals {
  const found = internalsByHost.get(host);
  if (found === undefined) {
    throw new PrimitiveError(
      "no_context",
      "hostInternalsOf needs an ExtHost created by createExtHost",
    );
  }
  return found;
}

/** ExtHost의 scope 토글 요청 통로. 사유를 scope.changed에 싣는다(X.operations.spec §4.3.4) */
export function registrationToggleSourceOf(host: ExtHost): RegistrationToggleSourceOf {
  const internals = hostInternalsOf(host);
  return {
    scopes: () => host.registrations().map((info) => ({ id: info.id, extension: info.extension })),
    request: (scopeId, enabled, reason, threadId) => {
      internals.requestScope(scopeId, enabled, reason, threadId);
    },
  };
}

/**
 * 계측 읽기 포트(X-15·X-6). 원천은 이 호스트의 링 버퍼다. `ext.timings`와 `trace.turn`(wire)이 쓴다.
 * turn()은 버퍼 밖이거나 계측이 꺼져 있으면 undefined다. wire 쪽이 enabled()로 traceEnabled를 채운다(X.operations §3.9)
 */
export function traceReadOf(host: ExtHost): TraceReadPort {
  // 내부는 부를 때 얻는다. createExtHost가 만들지 않은 대역 ExtHost로도 포트를 만들 수 있게 한다(조립 시험)
  return {
    enabled: () => hostInternalsOf(host).trace.enabled(),
    turn: (threadId, turnId) => hostInternalsOf(host).trace.turn(threadId, turnId),
    timings: (filter) => hostInternalsOf(host).trace.timings(filter),
  };
}

/** 상태 문서의 `phase` 문자열. 문서가 객체가 아니거나 `phase`가 문자열이 아니면 null */
function phaseValueOf(doc: unknown): string | null {
  if (typeof doc !== "object" || doc === null || !("phase" in doc)) return null;
  return typeof doc.phase === "string" ? doc.phase : null;
}

/**
 * Test run 단계 경계 멈춤 제어 포트(X-19, X.primitives.spec §4.4.8). wire `testRun.*`이 쓴다.
 * pause는 요청만 남기고 다음 `boundary.step.after` 처리 뒤에 적용한다. 멈춘 동안 drive 락은 그대로 있다.
 * phase는 읽기만 한다. drive 락 보유자의 그룹 선언(`composition.phases`)과 커밋된 상태 판의 `phase`를 본다
 */
export function testRunControlOf(host: ExtHost): TestRunControlPort {
  // 내부는 부를 때 얻는다. createExtHost가 만들지 않은 대역 ExtHost로도 포트를 만들 수 있게 한다(조립 시험)
  return {
    pause(threadId) {
      const { isTestRun, stepPause } = hostInternalsOf(host);
      if (!isTestRun(threadId)) return err({ kind: "not_a_test_run" });
      stepPause.pause(threadId);
      return ok({ paused: true });
    },
    resume(threadId) {
      const { isTestRun, stepPause } = hostInternalsOf(host);
      if (!isTestRun(threadId)) return err({ kind: "not_a_test_run" });
      if (!stepPause.resume(threadId)) return err({ kind: "not_paused" });
      return ok({ paused: false });
    },
    step(threadId) {
      const { isTestRun, stepPause } = hostInternalsOf(host);
      if (!isTestRun(threadId)) return err({ kind: "not_a_test_run" });
      if (!stepPause.step(threadId)) return err({ kind: "not_paused" });
      return ok({ paused: true });
    },
    phase(threadId) {
      const { core, isTestRun, state } = hostInternalsOf(host);
      if (!isTestRun(threadId)) return err({ kind: "not_a_test_run" });
      // 보유자는 `leaseOf`가 보는 자료와 같다. 커밋되지 않았거나 반납이 커밋된 임대는 보유자가 아니다
      const lease = host.leaseOf(threadId);
      const record = lease === null ? undefined : core.scopes.get(lease.scopeId);
      const phases = record?.manifest.group?.composition?.phases;
      if (record === undefined || phases === undefined) {
        return ok({ phase: null, group: null, seq: null });
      }
      const value = phaseValueOf(state.docOf(threadId, record.id));
      const phase = value !== null && phases.nodes.some((node) => node.id === value) ? value : null;
      return ok({ phase, group: record.extension, seq: state.revOf(threadId, record.id) });
    },
  };
}

const NOOP = (): void => {};

/** 종료 때 끝나지 않는 해제(버려진 setup 등)를 이만큼만 기다린다 */
const DISPOSE_GRACE_MS = 5_000;

/** task가 grace 안에 끝나지 않으면 false를 돌려준다. 거부는 onError로 넘긴다 */
async function waitWithin(
  task: Promise<void>,
  graceMs: number,
  setTimer: ExtHostDeps["setTimer"],
): Promise<boolean> {
  let cancel = NOOP;
  const expired = new Promise<false>((resolve) => {
    cancel = setTimer(graceMs, () => {
      resolve(false);
    });
  });
  try {
    return await Promise.race([task.then(() => true as const), expired]);
  } finally {
    cancel();
  }
}

async function withBudget<T>(
  task: Promise<T>,
  budgetMs: number | null,
  setTimer: ExtHostDeps["setTimer"],
  signal: AbortSignal | undefined,
): Promise<T> {
  if (budgetMs === null && signal === undefined) return task;
  let cancel = NOOP;
  const contenders: Promise<T>[] = [task];
  if (budgetMs !== null) {
    contenders.push(
      new Promise<never>((_resolve, reject) => {
        cancel = setTimer(budgetMs, () => {
          reject(
            new PrimitiveError(
              "registration_setup_failed",
              `entry exceeded its time budget (${budgetMs}ms)`,
            ),
          );
        });
      }),
    );
  }
  let unlisten = NOOP;
  if (signal !== undefined) {
    contenders.push(
      new Promise<never>((_resolve, reject) => {
        const onAbort = (): void => {
          reject(new PrimitiveError("registration_setup_failed", "install was cancelled"));
        };
        if (signal.aborted) onAbort();
        signal.addEventListener("abort", onAbort, { once: true });
        unlisten = () => {
          signal.removeEventListener("abort", onAbort);
        };
      }),
    );
  }
  try {
    return await Promise.race(contenders);
  } finally {
    cancel();
    unlisten();
  }
}

export function createExtHost(deps: ExtHostDeps): ExtHost {
  const report = deps.report;
  const resolved: ResolvedDeps = {
    ids: deps.ids,
    now: deps.now,
    setTimer: deps.setTimer,
    policy: deps.policy ?? DEFAULT_DISPATCH_POLICY,
    settings: deps.settings,
    report,
    strict: deps.strict ?? true,
    setupBudgetMs: deps.setupBudgetMs ?? (() => null),
  };
  const bridge = createCordisBridge((cause) => {
    report({ level: "error", code: "handler_failed", message: "cordis effect failed", cause });
  });
  const registry = createHandlerRegistry();
  const pending = new Set<Promise<unknown>>();
  const listeners = new Set<(change: ExtChange) => void>();
  const bindings = createCapabilityBindings(bridge, report, () =>
    deps.settings.capabilityProviders(),
  );
  // 계측 링 버퍼는 호스트마다 하나다. 설정이 없으면 기본값(켬)을 쓴다. 외부 훅 단위의 행은 숨기고 훅마다 `hook:<id>` 행을 실행기가 넣는다
  const traceBuffer = createTraceBuffer({
    settings: deps.trace ?? (() => DEFAULT_TRACE_SETTINGS),
    hidden: isHookUnitName,
  });
  // Test run 단계 경계 멈춤(X-19). 멈춤 상태와 Test run 표지는 호스트마다 하나다
  const stepPause = createStepPause();
  const testRunThreads = new Set<ThreadId>();
  /** Test run 표지와 멈춤 상태를 함께 지운다. 멈춘 경계가 있으면 풀려서 기다리던 dispatch가 끝난다 */
  const forgetTestRun = (threadId: ThreadId): void => {
    testRunThreads.delete(threadId);
    stepPause.release(threadId);
  };

  const ports: PortLookup = {
    get<Api>(key: PortKey<Api>): Api | undefined {
      const service = bridge.service(key.name);
      if (service === undefined) return undefined;
      const value: unknown =
        key.member === undefined ? service : Reflect.get(Object(service), key.member);
      if (value === undefined) return undefined;
      return portAs(key, value);
    },
  };

  // 서비스 객체가 만들어지기 전에도 쓸 수 있는 자리. 아래에서 채운다
  const services: {
    state: ReturnType<typeof createStateService> | undefined;
  } = { state: undefined };

  const core: HostCore = {
    deps: resolved,
    bridge,
    registry,
    dispatcher: createDispatcher({
      registry,
      policy: resolved.policy,
      now: resolved.now,
      setTimer: resolved.setTimer,
      strict: resolved.strict,
      report,
      stateOf: (threadId, scopeId) => services.state?.docOf(threadId, scopeId),
      track: (task) => {
        core.track(task);
      },
      threadSignal: (threadId) => core.threads.get(threadId)?.abort.signal,
      trace: traceBuffer,
      stepPause,
    }),
    ports,
    scopes: new Map(),
    threads: new Map(),
    units: new Map(),
    track(task, options) {
      const guarded = task.catch((cause: unknown) => {
        report({
          level: "error",
          code: "handler_failed",
          message: "background task failed",
          cause,
        });
      });
      // 버려진 작업은 거부만 보고하고 whenSettled가 기다리지 않는다(끝나지 않을 수 있다)
      if (options?.abandoned === true) return;
      pending.add(guarded);
      const forget = (): undefined => {
        pending.delete(guarded);
        return undefined;
      };
      guarded.then(forget, forget);
    },
    whenSettled: () => settleAll(64),
    flushBindings: () => bindings.settled(),
    activeIn(threadId, scopeId) {
      const thread = core.threads.get(threadId);
      return thread === undefined ? true : thread.active.has(scopeId);
    },
    notify(change) {
      for (const listener of listeners) {
        try {
          listener(change);
        } catch (cause) {
          report({
            level: "error",
            code: "handler_failed",
            scopeId: change.scopeId,
            message: "an ExtHost.onChange listener threw",
            cause,
          });
        }
      }
    },
  };

  async function settleAll(rounds: number): Promise<void> {
    if (rounds === 0) return;
    await bindings.settled();
    await bridge.quiesce();
    if (pending.size === 0) return;
    await Promise.all(pending);
    await settleAll(rounds - 1);
  }

  const resources = createResourceStore({ ports, policy: deps.resourcePolicy, report });
  const methods = createExtMethods({
    core,
    resources,
    onMethodSettled: deps.onMethodSettled,
    methodRun: deps.methodRun,
  });
  const kick: { directCommitted: (thread: ThreadRuntime, record: RegistrationRecord) => void } = {
    directCommitted: () => {},
  };
  const state = createStateService(core, {
    directCommitted: (thread, record) => {
      kick.directCommitted(thread, record);
    },
  });
  services.state = state;
  const post = createPostQueue(core);
  const effects =
    deps.effectWorker ?? createEffectWorker(core, deps.capabilityDefs ?? EMPTY_CAPABILITY_DEFS);
  // 순환 참조(경계 ↔ 임대 ↔ scope)는 지연 호출 자리로 푼다
  const late: { requestApply: (threadId: ThreadId) => void } = { requestApply: () => {} };
  const lease = createLeaseBroker(core, state, { requestApply: (id) => late.requestApply(id) });
  kick.directCommitted = (thread, record) => {
    lease.onDirectCommit(thread, record.id);
  };
  const scope = createRegistrationRuntime(core, {
    makeApi: (record, generation) =>
      createRegistrationApi(
        {
          core,
          state,
          post,
          bindings,
          resources,
          capabilityDefs: deps.capabilityDefs ?? EMPTY_CAPABILITY_DEFS,
          effects,
        },
        record,
        generation,
      ),
    state,
    lease,
    requestApply: (threadId) => {
      if (threadId === undefined) boundary.requestApply();
      else if (core.threads.has(threadId)) boundary.requestApply(threadId);
    },
    drainSwaps: (current) => (pendingSwaps.size === 0 ? undefined : drainSwaps(current)),
  });
  const lifecycle = createLifecycle(core);
  const boundary = createBoundary(core, scope, lease, effects, lifecycle);
  late.requestApply = (id) => {
    if (core.threads.has(id)) boundary.requestApply(id);
  };

  // 서비스 fresnel.ext. 시작하자마자 provide하지만 Cordis 전이는 비동기라 install이 준비를 기다린다
  const selfFiber = bridge.openFiber({
    name: "fresnel.ext",
    inject: [],
    apply: (fiber) => {
      fiber.provide(ExtHostPortKey.name, host);
      return Promise.resolve();
    },
  });
  const ready = selfFiber.settled;

  // 단계 경계를 기다리는 단위 교체. 확장 이름마다 하나다(더 새로운 것이 앞의 것을 대신한다)
  const pendingSwaps = new Map<
    ExtensionName,
    { readonly plan: SwapPlan; readonly resolve: (outcome: SwapOutcome) => void }
  >();
  let draining = false;

  /** 끊을 일이 없는 교체를 적용한다. 경계 적용의 맨 앞과 `replaceUnit`이 부른다 */
  async function drainSwaps(current: ThreadRuntime | undefined): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      await eachInOrder(pendingSwaps, async ([name, waiting]) => {
        if (scope.swapBlocked(current, waiting.plan.unit.scopeIds)) return "continue";
        pendingSwaps.delete(name);
        const result = await scope.applySwap(waiting.plan);
        waiting.resolve(
          result.ok
            ? { status: "applied", statesCleared: result.statesCleared }
            : {
                status: "failed",
                scopeId: result.scopeId,
                code: result.code,
                message: result.message,
                cause: result.cause,
                restored: result.restored,
                failedToRestore: result.failedToRestore,
              },
        );
        return "continue";
      });
    } finally {
      draining = false;
    }
  }

  function cancelSwap(name: ExtensionName, outcome: SwapOutcome): void {
    const waiting = pendingSwaps.get(name);
    if (waiting === undefined) return;
    pendingSwaps.delete(name);
    waiting.resolve(outcome);
  }

  async function replaceUnit(
    unit: ExtensionUnit,
    options?: ReplaceOptions,
  ): Promise<ReplaceResult> {
    await ready;
    const name = unit.manifest.name;
    const installed = core.units.get(name);
    if (installed === undefined) return err({ kind: "not_installed" });
    const manifest = deepFreeze(structuredClone(unit.manifest));
    const view = { name, manifest };
    // 1. 호스트 상태를 건드리지 않고 새 엔트리를 실행해 정의를 모은다
    const staged: StagedScope[] = [];
    try {
      await withBudget(
        Promise.resolve().then(() =>
          unit.entry({
            manifest,
            register: (id, def, setup) => {
              if (staged.some((item) => item.id === id)) {
                throw new PrimitiveError(
                  "registration_duplicate",
                  `scope ${id} is already defined`,
                  {
                    scopeId: id,
                  },
                );
              }
              staged.push(scope.describe(view, id, def, setup));
              return stagedHandle(id);
            },
          }),
        ),
        resolved.setupBudgetMs(),
        resolved.setTimer,
        options?.signal,
      );
    } catch (error) {
      return err({ kind: "entry_failed", error });
    }
    const unregistered = pluginsOf(manifest)
      .map((entry) => entry.registrationId)
      .filter((id) => !staged.some((item) => item.id === id));
    if (unregistered.length > 0)
      return err({ kind: "plugins_unregistered", registrations: unregistered });
    // 2. 경계를 기다리는 교체로 올린다
    const settled = Promise.withResolvers<SwapOutcome>();
    cancelSwap(name, { status: "superseded" });
    pendingSwaps.set(name, {
      plan: {
        unit: installed,
        manifest,
        loadIndex: unit.loadIndex,
        staged,
        resetRefusedState: options?.resetRefusedState === true,
      },
      resolve: settled.resolve,
    });
    // 3. 끊을 일이 없으면 바로 적용한다. 열린 thread가 없으면 경계가 없으니 지금 하고, 있으면 유휴 thread의 적용을 시작한다
    if (core.threads.size === 0) await drainSwaps(undefined);
    else {
      boundary.requestApply();
      if (!scope.anyRunning()) await core.whenSettled();
    }
    return ok({
      appliesAt: pendingSwaps.has(name) ? "nextStepBoundary" : "now",
      applied: settled.promise,
    });
  }

  /** replaceUnit 중 엔트리가 돌려받는 핸들. 교체가 적용되기 전에는 켜기·끄기를 받지 않는다 */
  function stagedHandle(id: RegistrationId): RegistrationHandle {
    return {
      id,
      get status(): RegistrationStatus {
        return core.scopes.get(id)?.status ?? "disabled";
      },
      enable: () => {},
      disable: () => {},
    };
  }

  async function install(unit: ExtensionUnit, options?: InstallOptions): Promise<InstallResult> {
    await ready;
    const name = unit.manifest.name;
    if (core.units.has(name)) {
      throw new PrimitiveError("registration_duplicate", `extension ${name} is already installed`, {
        scopeId: name,
      });
    }
    const installed: InstalledUnit = {
      name,
      manifest: deepFreeze(structuredClone(unit.manifest)),
      loadIndex: unit.loadIndex,
      builtin: unit.builtin,
      trust: unit.trust ?? (unit.builtin ? "builtin" : "untrusted"),
      scopeIds: [],
    };
    core.units.set(name, installed);
    let entryFailed = false;
    let entryError: unknown;
    try {
      await withBudget(
        Promise.resolve().then(() =>
          unit.entry({
            manifest: installed.manifest,
            register: (id, def, setup) => scope.define(installed, id, def, setup),
          }),
        ),
        resolved.setupBudgetMs(),
        resolved.setTimer,
        options?.signal,
      );
    } catch (error) {
      entryFailed = true;
      entryError = error;
    }
    if (entryFailed) {
      for (const id of installed.scopeIds) core.scopes.delete(id);
      core.units.delete(name);
      return { name, registrations: [], unregistered: [], entryError, setups: [], issues: [] };
    }
    const setups: RegistrationSetupOutcome[] = [];
    await eachInOrder(installed.scopeIds, async (id) => {
      const record = core.scopes.get(id);
      if (record === undefined) return "continue";
      if (unit.initialEnabled !== undefined && id === name) {
        scope.setInitial(record, unit.initialEnabled);
      }
      setups.push(await scope.startupApply(record));
      return "continue";
    });
    // 플러그인 그룹은 한 번에 켜고 끈다: 구성원 하나의 setup이 실패하면 그룹 전체 켜기가 실패한다.
    // 이미 켜진 구성원은 다음 경계에서 되돌린다 [제안: F.extensions.spec §4.5]
    const memberIds = new Set(
      pluginsOf(installed.manifest)
        .filter((entry) => entry.inGroup)
        .map((entry) => entry.registrationId),
    );
    if (
      memberIds.size > 1 &&
      setups.some((outcome) => outcome.status === "failed" && memberIds.has(outcome.scopeId))
    ) {
      await eachInOrder([...memberIds], async (id) => {
        const record = core.scopes.get(id);
        if (record === undefined || !record.desired) return "continue";
        // 열린 thread가 없으면 적용할 경계가 없으므로 바로 내린다
        if (core.threads.size === 0) await scope.teardown(record);
        else scope.request(record, false, undefined, undefined);
        return "continue";
      });
    }
    // 열려 있는 유휴 thread에서 켜짐 기록과 임대 부여를 판단하게 한다
    if (core.threads.size > 0) boundary.requestApply();
    return {
      name,
      registrations: [...installed.scopeIds],
      unregistered: pluginsOf(installed.manifest)
        .map((entry) => entry.registrationId)
        .filter((id) => !installed.scopeIds.includes(id)),
      setups,
      issues: setups.flatMap((outcome) => outcome.issues),
    };
  }

  const host: ExtHost = {
    async registerPlatform(module) {
      await ready;
      const disposers: (() => void | Promise<void>)[] = [];
      const captured: { error?: unknown; set: boolean } = { set: false };
      const started: { failure: SetupRefusal | undefined } = { failure: undefined };
      const opened = bridge.openFiber({
        name: `platform:${module.name}`,
        inject: [],
        apply: async (fiber) => {
          const provider = createPortProvider(fiber);
          fiber.effect(
            () => () =>
              eachInOrder(disposers.splice(0).toReversed(), async (dispose) => {
                try {
                  await dispose();
                } catch (cause) {
                  report({
                    level: "error",
                    code: "handler_failed",
                    message: `onDispose of platform ${module.name} threw`,
                    cause,
                  });
                }
                return "continue";
              }),
            "platform.onDispose",
          );
          try {
            const returned = await module.setup({
              providePort: (key, impl) => {
                provider.provide(key, impl);
              },
              port: (key) => {
                const port = ports.get(key);
                if (port === undefined) {
                  throw new PrimitiveError("port_unavailable", `port ${key.name} is not provided`);
                }
                return port;
              },
              onDispose: (fn) => {
                disposers.push(fn);
              },
            });
            if (typeof returned === "object" && !returned.ok) {
              // Cordis는 apply가 던져야 fiber를 실패로 닫는다. 던진 값은 아래에서 start.failure로 바꾼다
              started.failure = returned.error;
              throw new PrimitiveError("registration_setup_failed", `${module.name} did not start`);
            }
          } catch (error) {
            captured.error = error;
            captured.set = true;
            throw error;
          }
        },
      });
      const settled = await opened.settled;
      if (!settled.ok) {
        await opened.dispose();
        const failure = started.failure;
        if (failure !== undefined) {
          return err({
            kind: "setup_failed",
            module: module.name,
            reason: failure.reason,
            cause: failure.cause,
          });
        }
        throw captured.set ? captured.error : settled.error;
      }
      return ok(undefined);
    },
    install,
    replaceUnit,
    async uninstall(name) {
      cancelSwap(name, { status: "cancelled" });
      const unit = core.units.get(name);
      if (unit === undefined) return;
      await eachInOrder(unit.scopeIds, async (id) => {
        const record = core.scopes.get(id);
        if (record === undefined) return "continue";
        await scope.teardown(record);
        core.scopes.delete(id);
        return "continue";
      });
      core.units.delete(name);
      boundary.requestApply();
    },
    ports,
    resources,
    methods,
    ui: createExtUi(core),
    queryEvents: createEventQuery(ports),
    async resetRegistrationState(threadId, scopeId) {
      const record = core.scopes.get(scopeId);
      if (record === undefined) return err({ kind: "unknown_registration" });
      const thread = core.threads.get(threadId);
      if (thread === undefined) return err({ kind: "thread_not_open" });
      return scope.resetState(record, thread);
    },
    toolOwner: (name) => toolOwnerOf(resources, name),
    registration(id) {
      const record = core.scopes.get(id);
      return record === undefined ? undefined : scope.handleOf(record);
    },
    registrations() {
      return [...core.scopes.values()].map((record) => scope.info(record));
    },
    dispatch(point, payload, options) {
      return typedDispatch(core.dispatcher, point, payload, options);
    },
    boundary: {
      prepare: (signal) => boundary.prepare(signal),
      settle: (signal, result) => boundary.settle(signal, result),
    },
    afterCommit: (threadId, events) => lifecycle.afterCommit(threadId, events),
    openThread: async (threadId, options) => {
      lifecycle.attach();
      // 열기는 멈춤을 새로 시작한다. 표지는 열린 뒤에만 단다(열지 못한 thread를 Test run으로 남기지 않는다)
      forgetTestRun(threadId);
      await boundary.openThread(threadId, options);
      if (options?.testRun === true) testRunThreads.add(threadId);
      core.track(lifecycle.flush(threadId));
    },
    closeThread: async (threadId) => {
      forgetTestRun(threadId);
      // 닫힌 대화의 계측 기록은 메모리에서 푼다. Turn 수 상한이 없으므로 닫기가 유일한 해제 경로다(X.operations §4.8.3)
      traceBuffer.forgetThread(threadId);
      await boundary.closeThread(threadId);
    },
    leaseOf(threadId) {
      const held = core.threads.get(threadId)?.lease;
      if (held === null || held === undefined || held.status === "released") return null;
      if (!held.committed) return null;
      return {
        leaseId: held.leaseId,
        scopeId: held.scopeId,
        leaseEpoch: held.leaseEpoch,
        status: held.status,
      };
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async dispose() {
      for (const name of pendingSwaps.keys()) cancelSwap(name, { status: "cancelled" });
      await eachInOrder([...core.threads.keys()], async (threadId) => {
        forgetTestRun(threadId);
        traceBuffer.forgetThread(threadId);
        await boundary.closeThread(threadId);
        return "continue";
      });
      await eachInOrder([...core.scopes.values()].toReversed(), async (record) => {
        await scope.teardown(record);
        return "continue";
      });
      lifecycle.detach();
      core.scopes.clear();
      core.units.clear();
      const finished = await waitWithin(
        (async () => {
          await core.whenSettled();
          await bindings.dispose();
          await selfFiber.dispose();
          await bridge.dispose();
        })(),
        DISPOSE_GRACE_MS,
        resolved.setTimer,
      );
      if (!finished) {
        report({
          level: "warning",
          code: "registration_inactive",
          message: `host dispose gave up waiting after ${DISPOSE_GRACE_MS}ms for an abandoned setup`,
        });
      }
    },
  };

  internalsByHost.set(host, {
    core,
    trace: traceBuffer,
    bound: () => bindings.bound(),
    whenSettled: () => core.whenSettled(),
    requestScope(scopeId, enabled, reason, threadId) {
      const record = core.scopes.get(scopeId);
      if (record === undefined) return;
      scope.request(record, enabled, reason === "request" ? undefined : reason, threadId);
    },
    isTestRun: (threadId) => testRunThreads.has(threadId),
    stepPause,
    state,
  });
  return host;
}
