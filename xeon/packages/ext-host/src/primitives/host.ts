import { err, ok, type Result } from "@xeon/contracts";
import type { IdFactory, ThreadId } from "@xeon/contracts/conversation";
import { portAs } from "../erase.ts";
import type {
  SetupRefusal,
  ExtensionEntry,
  ExtensionManifest,
  ExtensionName,
  ManifestIssue,
  PointName,
  PortKey,
  PortLookup,
  ScopeHandle,
  ScopeId,
  Unsubscribe,
} from "@xeon/contracts/extensions";
import { createCapabilityBindings } from "./bindings.ts";
import { EMPTY_CAPABILITY_DEFS, type CapabilityDefLookup } from "./capability-guard.ts";
import { createLifecycle, type CommittedEvent } from "./lifecycle.ts";
import { createEffectWorker, type EffectWorkerPort } from "./effect-worker.ts";
import { createBoundary, type BoundaryHooks } from "./boundary.ts";
import type {
  ExtChange,
  HostCore,
  InstalledUnit,
  ScopeRecord,
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
import { createScopeApi } from "./host-api.ts";
import { createLeaseBroker } from "./lease.ts";
import { createPortProvider } from "./port-provider.ts";
import { eachInOrder } from "./sequence.ts";
import { createPostQueue } from "./post.ts";
import { createHandlerRegistry } from "./registry.ts";
import { createResourceStore, type ResourcePolicy, type ResourceRegistry } from "./resources.ts";
import { createScopeRuntime, type ScopeInfo, type ScopeSetupOutcome } from "./scope.ts";
import { createStateService } from "./state.ts";

export type {} from "./errors.ts";

/** 확장 호스트 자신(서비스 xeon.ext, 제공 ext-host). ExtHost가 X 타입이라 F에 둘 수 없다 */
export const ExtHostPortKey: PortKey<ExtHost> = { name: "xeon.ext" };
export type {} from "./scope.ts";
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
   * 능력 정의 조회. 능력 래퍼가 재실행되는 코드(on 핸들러, drive 함수)의 호출을 메서드의 `idempotent`·`readOnly` 선언으로 검사한다
   * (ADR-0015 §3.2). 없으면 정의를 모르는 능력이므로 그 문맥의 모든 호출을 거부한다
   */
  readonly capabilityDefs?: CapabilityDefLookup;
  /** 선언 없는 쓰기 요청 워커(ADR-0015 §3.5). 없으면 X의 기본 워커 */
  readonly effectWorker?: EffectWorkerPort;
}

/** loading-trust가 검증을 끝낸 확장 하나. 순서는 loadIndex가 정한다 */
export interface ExtensionUnit {
  readonly manifest: ExtensionManifest;
  readonly entry: ExtensionEntry;
  /** 로드 순번. 0부터. 핸들러 정렬의 둘째 키 */
  readonly loadIndex: number;
  /** 내장 패키지(core-*, cap-*, group-*)면 참. 포트 제공·조회와 xeon.* 서비스 이름을 허용한다 */
  readonly builtin: boolean;
  /**
   * 주 scope의 초기 켜기 요청. `ext.<name>.enabled` 설정 값이 있으면 로더가 넘긴다 [제안].
   * 없으면 ScopeDef.defaultEnabled, 매니페스트 defaultEnabled, true 순으로 정한다(X.primitives.spec §4.5.1)
   */
  readonly initialEnabled?: boolean;
}

export interface InstallResult {
  readonly name: ExtensionName;
  /** 엔트리가 정의한 scope. 엔트리가 던졌으면 빈 배열 */
  readonly scopes: readonly ScopeId[];
  /** 엔트리 본문이 던진 값. 있으면 setups는 비어 있고 등록은 남지 않는다 */
  readonly entryError?: unknown;
  readonly setups: readonly ScopeSetupOutcome[];
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
  /** xeon.* 포트 제공 */
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

export interface ExtHost {
  /** L0 플랫폼 패키지를 등록한다. 조립 루트가 확장 설치 전에 부른다. setup이 err를 돌려주면 등록을 거두고 그 오류를 돌려준다(시작 실패). 던지면 그대로 던진다(버그) */
  registerPlatform(module: PlatformModule): Promise<Result<void, PlatformSetupError>>;
  /**
   * 엔트리를 실행해 scope 정의를 모으고, 기본 활성 scope의 켜기를 시작 적용한다.
   * signal이 중단되면 엔트리 실행을 기다리지 않고 entryError(scope_setup_failed)로 끝낸다
   */
  install(unit: ExtensionUnit, options?: InstallOptions): Promise<InstallResult>;
  /** 모든 scope를 내리고 정의를 지운다. 경계 없이 즉시 해제한다 */
  uninstall(name: ExtensionName): Promise<void>;
  /** 포트 조회. 같은 패키지의 loading-trust·operations와 조립 루트가 쓴다 */
  readonly ports: PortLookup;
  scope(id: ScopeId): ScopeHandle | undefined;
  scopes(): readonly ScopeInfo[];
  /** L1이 지점을 발화할 때 부른다 */
  dispatch<N extends PointName>(
    point: N,
    payload: PayloadOf<N>,
    options: DispatchOptions<N>,
  ): Promise<DispatchOutcome<N>>;
  /** L1 루프가 단계 경계와 유휴 진입 때 부른다 */
  readonly boundary: BoundaryHooks;
  /**
   * 이벤트가 커밋된 뒤 부른다. kind가 `LIFECYCLE_POINTS`에 있으면 수명주기 지점(`lifecycle.agent.settled`,
   * `lifecycle.lease.rejected`)을 디스패치한다. X가 낸 경계 기여(`lease.rejected`)는 `boundary.settle`이 직접 알리므로
   * L1이 자기 커밋(위임 정착 `agent.settled`)을 알릴 때 쓴다. 끝나기를 기다린다
   */
  afterCommit(threadId: ThreadId, events: readonly CommittedEvent[]): Promise<void>;
  /** thread를 열 때(새로 만들거나 재개할 때, 되감기 뒤) 상태 판, 켜짐 상태, 열린 임대를 읽어 들인다 */
  openThread(threadId: ThreadId, options?: ThreadOpenOptions): Promise<void>;
  closeThread(threadId: ThreadId): Promise<void>;
  /** thread의 현재 임대. 없거나 반납이 커밋되었으면 null(L3.group-kit.spec §3.13 요청 2) */
  leaseOf(threadId: ThreadId): LeaseInfo | null;
  /**
   * scope 토글 요청, 적용, 임대 부여·반납이 일어나면 알린다(L3.group-kit.spec §3.13 요청 3). 적용과 임대 변화는 경계 커밋 뒤에 부른다.
   * 구독자의 예외는 진단으로 남기고 다른 구독자에게 전달을 이어 간다
   */
  onChange(listener: (change: ExtChange) => void): Unsubscribe;
  /** L4가 읽는 명령·키 조합·플래그·렌더러 표(X.primitives.spec §3.9) */
  readonly resources: ResourceRegistry;
  /** 모든 scope를 즉시 끄고 Cordis 루트를 해제한다. 프로세스 종료용 */
  dispose(): Promise<void>;
}

/** thread 하나의 임대 정보 */
export interface LeaseInfo {
  readonly leaseId: string;
  readonly scopeId: ScopeId;
  readonly leaseEpoch: number;
  /** active: 사용 중. releasing: 반납이 정해졌고 다음 경계에서 커밋된다 */
  readonly status: "active" | "releasing";
}

/** 패키지 안(testing, loading-trust, operations)에서만 쓰는 호스트 내부 */
export interface ExtHostInternals {
  readonly core: HostCore;
  /** 추적 중인 작업(drive 호출, 유휴 적용, 능력 바인딩)이 모두 끝나기를 기다린다 */
  whenSettled(): Promise<void>;
  /** 토글 요청을 사유와 함께 기록한다(X.operations ScopeControl의 바탕). threadId가 있으면 그 thread만의 요청이다 */
  requestScope(
    scopeId: ScopeId,
    enabled: boolean,
    reason?: ScopeToggleRequestReason,
    threadId?: ThreadId,
  ): void;
}

type ScopeToggleRequestReason = "request" | "auto_disable" | "safe_mode" | "startup_disable";

/** X.operations ScopeControl의 재료. 조립 루트가 createScopeControl에 넘긴다 */
export interface ScopeToggleSourceOf {
  scopes(): readonly { readonly id: ScopeId; readonly extension: ExtensionName }[];
  request(
    scopeId: ScopeId,
    enabled: boolean,
    reason: ScopeToggleRequestReason,
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
export function scopeToggleSourceOf(host: ExtHost): ScopeToggleSourceOf {
  const internals = hostInternalsOf(host);
  return {
    scopes: () => host.scopes().map((info) => ({ id: info.id, extension: info.extension })),
    request: (scopeId, enabled, reason, threadId) => {
      internals.requestScope(scopeId, enabled, reason, threadId);
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
              "scope_setup_failed",
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
          reject(new PrimitiveError("scope_setup_failed", "install was cancelled"));
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
    }),
    ports,
    scopes: new Map(),
    threads: new Map(),
    units: new Map(),
    track(task) {
      const guarded = task.catch((cause: unknown) => {
        report({
          level: "error",
          code: "handler_failed",
          message: "background task failed",
          cause,
        });
      });
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
  const kick: { directCommitted: (thread: ThreadRuntime, record: ScopeRecord) => void } = {
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
  const scope = createScopeRuntime(core, {
    makeApi: (record, generation) =>
      createScopeApi(
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
  });
  const lifecycle = createLifecycle(core);
  const boundary = createBoundary(core, scope, lease, effects, lifecycle);
  late.requestApply = (id) => {
    if (core.threads.has(id)) boundary.requestApply(id);
  };

  // 서비스 xeon.ext. 시작하자마자 provide하지만 Cordis 전이는 비동기라 install이 준비를 기다린다
  const selfFiber = bridge.openFiber({
    name: "xeon.ext",
    inject: [],
    apply: (fiber) => {
      fiber.provide(ExtHostPortKey.name, host);
      return Promise.resolve();
    },
  });
  const ready = selfFiber.settled;

  async function install(unit: ExtensionUnit, options?: InstallOptions): Promise<InstallResult> {
    await ready;
    const name = unit.manifest.name;
    if (core.units.has(name)) {
      throw new PrimitiveError("scope_duplicate", `extension ${name} is already installed`, {
        scopeId: name,
      });
    }
    const installed: InstalledUnit = {
      name,
      manifest: deepFreeze(structuredClone(unit.manifest)),
      loadIndex: unit.loadIndex,
      builtin: unit.builtin,
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
            scope: (id, def, setup) => scope.define(installed, id, def, setup),
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
      return { name, scopes: [], entryError, setups: [], issues: [] };
    }
    const setups: ScopeSetupOutcome[] = [];
    await eachInOrder(installed.scopeIds, async (id) => {
      const record = core.scopes.get(id);
      if (record === undefined) return "continue";
      if (unit.initialEnabled !== undefined && id === name) {
        scope.setInitial(record, unit.initialEnabled);
      }
      setups.push(await scope.startupApply(record));
      return "continue";
    });
    // 열려 있는 유휴 thread에서 켜짐 기록과 임대 부여를 판단하게 한다
    if (core.threads.size > 0) boundary.requestApply();
    return {
      name,
      scopes: [...installed.scopeIds],
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
              throw new PrimitiveError("scope_setup_failed", `${module.name} did not start`);
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
    async uninstall(name) {
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
    scope(id) {
      const record = core.scopes.get(id);
      return record === undefined ? undefined : scope.handleOf(record);
    },
    scopes() {
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
      await boundary.openThread(threadId, options);
      core.track(lifecycle.flush(threadId));
    },
    closeThread: (threadId) => boundary.closeThread(threadId),
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
      await eachInOrder([...core.threads.keys()], async (threadId) => {
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
          code: "scope_inactive",
          message: `host dispose gave up waiting after ${DISPOSE_GRACE_MS}ms for an abandoned setup`,
        });
      }
    },
  };

  internalsByHost.set(host, {
    core,
    whenSettled: () => core.whenSettled(),
    requestScope(scopeId, enabled, reason, threadId) {
      const record = core.scopes.get(scopeId);
      if (record === undefined) return;
      scope.request(record, enabled, reason === "request" ? undefined : reason, threadId);
    },
  });
  return host;
}
