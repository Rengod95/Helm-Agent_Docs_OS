import { err, type Result } from "@fresnel/contracts";
import {
  LoopPortKey,
  validateUsage,
  type ExtensionUsage,
  type ManifestIssue,
  pluginDefaultEnabled,
  pluginsOf,
  type RegistrationApi,
  type RegistrationDef,
  type RegistrationHandle,
  type RegistrationId,
  type RegistrationSetup,
  type RegistrationStatus,
} from "@fresnel/contracts/extensions";
import type { CapabilityId } from "@fresnel/contracts/capabilities";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { eraseRegistration } from "../erase.ts";
import { withoutAmbient } from "./ambient.ts";
import {
  newUsage,
  type BoundaryTxn,
  type RegistrationDefinition,
  type Generation,
  type HostCore,
  type InstalledUnit,
  type RegistrationRecord,
  type RegistrationToggleReason,
  type ThreadRuntime,
} from "./core.ts";
import type { AnyState } from "./erased-types.ts";
import { PrimitiveError, type PrimitiveErrorCode } from "./errors.ts";
import type { LeaseBroker } from "./lease.ts";
import { eachInOrder } from "./sequence.ts";
import { capabilityServiceName, toCapabilityIds } from "./services.ts";
import type { StateResetError, StateService } from "./state.ts";

// ── 공개 모양 ──────────────────────────────────────────────────────────────

export interface RegistrationInfo {
  readonly id: RegistrationId;
  readonly extension: string;
  readonly status: RegistrationStatus;
  /** 꺼져 있으면 마지막 세대 */
  readonly generation: number;
  /** requires 기능이 없어 켜지지 못한 경우의 부족 기능 */
  readonly waiting: readonly CapabilityId[];
  readonly drive: "none" | "registered" | "holding" | "error";
  readonly lastError?: { readonly code: PrimitiveErrorCode; readonly message: string };
}

/** install 안의 시작 적용 결과. scope 하나에 하나(X.primitives.spec §3.2) */
export interface RegistrationSetupOutcome {
  readonly scopeId: RegistrationId;
  /** applied: setup 성공, 세대 열림. failed: setup 실패로 disabled. skipped: 초기 요청이 꺼짐. deferred: 실행 중 thread가 있어 다음 경계로 미룸 */
  readonly status: "applied" | "failed" | "skipped" | "deferred";
  readonly failure?: {
    readonly kind: "threw" | "timeout";
    readonly code?: PrimitiveErrorCode;
    readonly error?: unknown;
  };
  /** 이 scope setup 직후 validateUsage 결과 */
  readonly issues: readonly ManifestIssue[];
}

type SetupResult =
  | {
      readonly ok: true;
      readonly generation: Generation;
      readonly issues: readonly ManifestIssue[];
    }
  | {
      readonly ok: false;
      readonly failure: NonNullable<RegistrationSetupOutcome["failure"]>;
      readonly issues: readonly ManifestIssue[];
      readonly waiting: readonly CapabilityId[];
    };

export interface RegistrationRuntime {
  /** scope 하나의 RegistrationHandle */
  handleOf(record: RegistrationRecord): RegistrationHandle;
  /** install의 RegistrationFn 구현 */
  define<S>(
    unit: InstalledUnit,
    id: RegistrationId,
    def: RegistrationDef<S>,
    setup: RegistrationSetup<S>,
  ): RegistrationHandle;
  /**
   * 토글 요청을 기록한다. 적용은 단계 경계나 유휴 적용에서 한다. threadId가 있으면 그 thread만의 요청이고,
   * 없으면 전체 요청이다(전체 기본값을 바꾸고 thread별 요청을 지운다)
   */
  request(
    record: RegistrationRecord,
    enabled: boolean,
    reason?: RegistrationToggleReason,
    threadId?: ThreadId,
  ): void;
  /** install: 초기 켜기 요청을 정한다. 설정 값이 있으면 매니페스트·정의 기본값을 덮는다 */
  setInitial(record: RegistrationRecord, enabled: boolean): void;
  /** install: 초기 요청이 참이면 바로 켜기를 적용한다(실행 중 thread가 없을 때) */
  startupApply(record: RegistrationRecord): Promise<RegistrationSetupOutcome>;
  /** prepare: 요청과 현재 상태의 차이를 적용한다. 세대 닫기와 setup 실행이 여기서 일어난다 */
  applyToggles(thread: ThreadRuntime, txn: BoundaryTxn): Promise<void>;
  /** settle: 커밋 결과에 따라 세대를 열거나 정리하고, 실패면 되돌린다 */
  settle(thread: ThreadRuntime, txn: BoundaryTxn, result: "committed" | "failed"): Promise<void>;
  /** 경계 없이 즉시 내린다(uninstall, dispose). 열린 임대는 disabled 반납 예정이 된다 */
  teardown(record: RegistrationRecord): Promise<void>;
  /**
   * thread를 열 때 이미 세대가 열린 scope를 그 thread의 켜짐 집합에 올린다(상태 문서 준비 포함).
   * 상태 문서가 맞지 않으면 올리지 않고 진단한다
   */
  seedThread(thread: ThreadRuntime): Promise<void>;
  /** 공급자 재시작으로 apply가 다시 불렸다. 새 세대로 다시 만들 것을 기록하고 적용을 예약한다(N-02) */
  markStale(record: RegistrationRecord, generation: Generation): void;
  /** 한 scope의 status를 요청·세대·thread 켜짐에서 다시 계산한다 */
  refreshStatus(record: RegistrationRecord): void;
  /**
   * 저장된 상태가 스키마·버전 검사를 못 넘겨 이 thread에서 켜지지 못한 scope의 상태 문서를 `initial`로 다시 쓴다(재설정 경로).
   * 마지막 오류가 저장 상태 오류가 아니면 `not_refused`다. 성공하면 thread의 거부와 마지막 오류를 지우고 적용을 예약한다.
   * scope를 다시 켜는 일은 하지 않는다(setup 실패로 꺼진 scope는 호출자가 `enable()`한다)
   */
  resetState(
    record: RegistrationRecord,
    thread: ThreadRuntime,
  ): Promise<Result<{ readonly rev: number }, ResetRegistrationStateError>>;
  info(record: RegistrationRecord): RegistrationInfo;
  /** 실행 중인 thread가 있는가 */
  anyRunning(): boolean;
  /** 정의 하나를 검사해 교체용으로 만든다. 호스트 상태는 바꾸지 않는다. 검사에 실패하면 PrimitiveError를 던진다 */
  describe<S>(
    unit: Pick<InstalledUnit, "name" | "manifest">,
    id: RegistrationId,
    def: RegistrationDef<S>,
    setup: RegistrationSetup<S>,
  ): StagedScope;
  /**
   * 단위 교체를 지금 적용하면 진행 중인 일을 끊게 되는가. 다른 thread가 실행 중이거나 경계를 정산하는 중이거나,
   * 교체 대상 scope의 drive 함수가 호출 중이면 참이다. `current`는 지금 경계를 처리하는 thread다(실행 중이어도 막지 않는다)
   */
  swapBlocked(current: ThreadRuntime | undefined, scopeIds: readonly RegistrationId[]): boolean;
  /** 단위 교체를 적용한다(`ExtHost.replaceUnit`). 호출자가 `swapBlocked`가 거짓임을 확인한 뒤 부른다 */
  applySwap(plan: SwapPlan): Promise<SwapResult>;
}

/** 교체용으로 검사를 마친 scope 정의 하나 */
export interface StagedScope {
  readonly id: RegistrationId;
  readonly plugin: RegistrationDefinition["plugin"];
  readonly initial: boolean;
  readonly def: RegistrationDefinition["def"];
  readonly setup: RegistrationDefinition["setup"];
}

export interface SwapPlan {
  readonly unit: InstalledUnit;
  readonly manifest: RegistrationDefinition["manifest"];
  readonly loadIndex: number;
  /** 새 버전의 scope, 엔트리가 `register`한 순서 */
  readonly staged: readonly StagedScope[];
  /** 참이면 새 버전이 저장된 상태를 받지 못할 때 그 상태를 `initial`로 다시 쓴다(되돌리기 `clearState`) */
  readonly resetRefusedState: boolean;
}

export type SwapResult =
  | {
      readonly ok: true;
      /** 이 교체가 `initial`로 다시 쓴 (thread, scope) 상태 수 */
      readonly statesCleared: number;
    }
  | {
      readonly ok: false;
      readonly scopeId: RegistrationId;
      readonly code: PrimitiveErrorCode;
      readonly message: string;
      readonly cause: unknown;
      /** 옛 정의로 되돌려 다시 켰는가. 거짓이면 `failedToRestore`의 scope가 꺼진 채다 */
      readonly restored: boolean;
      readonly failedToRestore: readonly RegistrationId[];
    };

export type ResetRegistrationStateError = StateResetError | { readonly kind: "not_refused" };

/** 재설정이 고치는 오류: 저장된 상태 문서가 이 판의 선언과 맞지 않는 경우 */
const STORED_STATE_ERRORS: ReadonlySet<PrimitiveErrorCode> = new Set([
  "state_schema",
  "state_future_version",
  "state_migration_missing",
  "state_migration_failed",
]);

export interface RegistrationRuntimeDeps {
  readonly makeApi: (
    record: RegistrationRecord,
    generation: Generation,
  ) => RegistrationApi<AnyState>;
  readonly state: StateService;
  readonly lease: LeaseBroker;
  /** 토글 요청이 들어왔을 때 유휴 적용을 예약한다. threadId가 있으면 그 thread만 */
  readonly requestApply: (threadId?: ThreadId) => void;
  /** 경계 적용의 맨 앞에서 부른다. 기다리는 단위 교체(`replaceUnit`)가 있고 끊을 일이 없으면 적용한다 */
  readonly drainSwaps: (current: ThreadRuntime) => Promise<void> | undefined;
}

function codeOf(error: unknown): PrimitiveErrorCode | undefined {
  return error instanceof PrimitiveError ? error.code : undefined;
}

const NOOP = (): void => {};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "setup failed";
}

interface SwapFailure {
  readonly code: PrimitiveErrorCode;
  readonly message: string;
  readonly cause: unknown;
  /** setup 실패였으면 그 결과. 상태 문서가 거부했으면 없다 */
  readonly result: Extract<SetupResult, { ok: false }> | undefined;
}

/** 이 thread가 scope를 켜 두기를 바라는가: thread별 요청이 있으면 그것, 없으면 전체 기본값 */
function wantedBy(thread: ThreadRuntime, record: RegistrationRecord): boolean {
  return thread.want.get(record.id)?.enabled ?? record.desired;
}

/** 정의 하나를 검사한다. id는 확장 이름으로 시작해야 하고 매니페스트에 선언된 플러그인이어야 한다 */
function describeScope<S>(
  unit: Pick<InstalledUnit, "name" | "manifest">,
  id: RegistrationId,
  def: RegistrationDef<S>,
  setup: RegistrationSetup<S>,
): StagedScope {
  if (id !== unit.name && !id.startsWith(`${unit.name}/`)) {
    throw new PrimitiveError(
      "registration_foreign_id",
      `registration id ${id} does not start with the extension name ${unit.name}`,
      { scopeId: id },
    );
  }
  const plugin = pluginsOf(unit.manifest).find((entry) => entry.registrationId === id);
  if (plugin === undefined) {
    throw new PrimitiveError(
      "registration_unknown_plugin",
      `registration id ${id} is not a plugin declared in the manifest of ${unit.name}`,
      { scopeId: id },
    );
  }
  const erased = eraseRegistration(def, setup);
  return {
    id,
    plugin,
    initial: def.defaultEnabled ?? pluginDefaultEnabled(unit.manifest, plugin),
    def: erased.def,
    setup: erased.setup,
  };
}

function recordOf(unit: InstalledUnit, staged: StagedScope): RegistrationRecord {
  return {
    id: staged.id,
    extension: unit.name,
    manifest: unit.manifest,
    plugin: staged.plugin,
    loadIndex: unit.loadIndex,
    builtin: unit.builtin,
    def: staged.def,
    setup: staged.setup,
    desired: staged.initial,
    reason: undefined,
    status: staged.initial ? "enabling" : "disabled",
    generationCount: 0,
    generation: null,
    lastError: undefined,
    waiting: [],
    driveError: false,
    busy: false,
  };
}

function definitionOf(record: RegistrationRecord): RegistrationDefinition {
  return {
    manifest: record.manifest,
    plugin: record.plugin,
    loadIndex: record.loadIndex,
    builtin: record.builtin,
    def: record.def,
    setup: record.setup,
  };
}

function assignDefinition(record: RegistrationRecord, definition: RegistrationDefinition): void {
  record.manifest = definition.manifest;
  record.plugin = definition.plugin;
  record.loadIndex = definition.loadIndex;
  record.builtin = definition.builtin;
  record.def = definition.def;
  record.setup = definition.setup;
}

type BringUpFailure = {
  readonly ok: false;
  readonly record: RegistrationRecord;
  readonly failure: SwapFailure;
};

export function createRegistrationRuntime(
  core: HostCore,
  deps: RegistrationRuntimeDeps,
): RegistrationRuntime {
  /** 세대의 onDispose를 등록 역순으로 차례로 실행한다. 예외는 기록하고 다음으로 간다 */
  async function runDisposers(record: RegistrationRecord, generation: Generation): Promise<void> {
    const list = generation.disposers.splice(0).toReversed();
    await eachInOrder(list, async (dispose) => {
      try {
        await dispose();
      } catch (error) {
        core.deps.report({
          level: "error",
          code: "registration_inactive",
          scopeId: record.id,
          extension: record.extension,
          message: `onDispose of scope ${record.id} threw`,
          cause: error,
        });
      }
      return "continue";
    });
  }

  /** 세대를 완전히 정리한다: 닫기 → 중단 신호 → fiber 해제(등록 해제기 실행) → onDispose */
  async function disposeGeneration(
    record: RegistrationRecord,
    generation: Generation,
  ): Promise<void> {
    generation.open = false;
    generation.closed = true;
    generation.abort.abort(new DOMException(`scope ${record.id} generation closed`, "AbortError"));
    if (generation.opened !== null) {
      try {
        await generation.opened.dispose();
      } catch (error) {
        core.deps.report({
          level: "error",
          code: "registration_inactive",
          scopeId: record.id,
          extension: record.extension,
          message: `fiber of scope ${record.id} failed to dispose`,
          cause: error,
        });
      }
    }
    await runDisposers(record, generation);
  }

  function missingCapabilities(record: RegistrationRecord): readonly CapabilityId[] {
    return toCapabilityIds((record.plugin.decl.requires ?? []).map((req) => req.id)).filter(
      (id) => core.bridge.service(capabilityServiceName(id)) === undefined,
    );
  }

  async function runSetup(record: RegistrationRecord): Promise<SetupResult> {
    record.busy = true;
    try {
      return await runSetupInner(record);
    } finally {
      record.busy = false;
    }
  }

  async function runSetupInner(record: RegistrationRecord): Promise<SetupResult> {
    record.generationCount += 1;
    const generation: Generation = {
      scopeId: record.id,
      number: record.generationCount,
      abort: new AbortController(),
      setupPhase: true,
      open: false,
      closed: false,
      opened: null,
      fiber: null,
      usage: newUsage(),
      drive: null,
      disposers: [],
      api: null,
      migration: null,
      stale: false,
      closing: false,
    };
    // 공급자 연쇄가 끝나기를 기다린 뒤 의존 기능이 있는지 본다
    await core.flushBindings();
    await core.bridge.quiesce();
    const missing = missingCapabilities(record);
    if (missing.length > 0) {
      generation.closed = true;
      return {
        ok: false,
        failure: { kind: "threw", code: "capability_unavailable" },
        issues: [],
        waiting: missing,
      };
    }
    const captured: { error?: unknown; set: boolean } = { set: false };
    const opened = core.bridge.openFiber({
      name: `${record.id}#${generation.number}`,
      inject: toCapabilityIds((record.plugin.decl.requires ?? []).map((req) => req.id)).map(
        capabilityServiceName,
      ),
      apply: async (fiber) => {
        if (generation.fiber !== null) {
          // 공급자가 내려갔다 올라와 Cordis가 apply를 다시 불렀다. setup을 바로 다시 실행하지 않고 다음 단계 경계에서
          // 새 세대로 만든다(review.open-issues N-02, 결정 D8). 이 fiber의 등록은 공급자가 내려갈 때 이미 해제되었다
          markStale(record, generation);
          return;
        }
        generation.fiber = fiber;
        // onDispose 묶음 effect: 등록 역순으로 차례로 실행한다(Cordis는 effect를 동시에 해제한다)
        fiber.effect(() => () => runDisposers(record, generation), "scope.onDispose");
        const api = deps.makeApi(record, generation);
        generation.api = api;
        try {
          const returned = await withoutAmbient(() => record.setup(api));
          if (typeof returned === "object" && !returned.ok) {
            // setup이 시작할 수 없다고 값으로 알렸다. fiber는 던져야 닫히므로 같은 실패 경로로 보낸다
            throw new PrimitiveError("registration_setup_failed", returned.error.reason, {
              scopeId: record.id,
              cause: returned.error.cause,
            });
          }
        } catch (error) {
          captured.error = error;
          captured.set = true;
          throw error;
        } finally {
          generation.setupPhase = false;
        }
      },
    });
    generation.opened = opened;

    const budget = core.deps.setupBudgetMs();
    let cancelTimer: () => void = NOOP;
    const timeout = new Promise<"timeout">((resolve) => {
      if (budget === null) return;
      cancelTimer = core.deps.setTimer(budget, () => resolve("timeout"));
    });
    const raced = await Promise.race([opened.settled, timeout]);
    cancelTimer();

    if (raced === "timeout") {
      // 늦게 끝난 setup의 등록은 세대가 닫혀 있어 registration_inactive로 버려진다
      generation.closed = true;
      generation.abort.abort(new DOMException("scope setup budget exceeded", "TimeoutError"));
      core.track(
        opened.dispose().catch((error: unknown) => {
          core.deps.report({
            level: "warning",
            code: "registration_inactive",
            scopeId: record.id,
            message: "late fiber of a timed out setup failed to dispose",
            cause: error,
          });
        }),
        { abandoned: true },
      );
      return { ok: false, failure: { kind: "timeout" }, issues: [], waiting: [] };
    }
    if (!raced.ok) {
      const error = captured.set ? captured.error : raced.error;
      await disposeGeneration(record, generation);
      const code = codeOf(error);
      return {
        ok: false,
        failure: { kind: "threw", ...(code === undefined ? {} : { code }), error },
        issues: [],
        waiting: [],
      };
    }
    const usage: ExtensionUsage = {
      on: [...generation.usage.on],
      post: generation.usage.post,
      drive: generation.usage.drive,
      capabilities: [...generation.usage.capabilities],
      recordKinds: [...generation.usage.recordKinds],
      readsRecordKinds: [...generation.usage.readsRecordKinds],
    };
    const issues = validateUsage(record.manifest, record.plugin, usage);
    if (issues.some((issue) => issue.severity === "error")) {
      await disposeGeneration(record, generation);
      return { ok: false, failure: { kind: "threw" }, issues, waiting: [] };
    }
    return { ok: true, generation, issues };
  }

  function markFailed(
    record: RegistrationRecord,
    result: Extract<SetupResult, { ok: false }>,
    error?: PrimitiveError,
  ): void {
    record.desired = false;
    for (const thread of core.threads.values()) {
      thread.want.delete(record.id);
      thread.active.delete(record.id);
    }
    record.generation = null;
    record.status = "disabled";
    record.waiting = result.waiting;
    const code: PrimitiveErrorCode =
      error?.code ?? result.failure.code ?? "registration_setup_failed";
    record.lastError = {
      code,
      message:
        error?.message ??
        (result.failure.kind === "timeout"
          ? `setup of ${record.id} exceeded its time budget`
          : messageOf(result.failure.error ?? `setup of ${record.id} failed`)),
    };
    core.deps.report({
      level: "error",
      code: "registration_setup_failed",
      scopeId: record.id,
      extension: record.extension,
      message: record.lastError.message,
      ...(result.failure.error === undefined ? {} : { cause: result.failure.error }),
    });
  }

  function swapBlocked(
    current: ThreadRuntime | undefined,
    scopeIds: readonly RegistrationId[],
  ): boolean {
    if (scopeIds.some((id) => core.scopes.get(id)?.busy === true)) return true;
    const loop = core.ports.get(LoopPortKey);
    for (const thread of core.threads.values()) {
      const held = thread.lease;
      if (held !== null && held.running && scopeIds.includes(held.scopeId)) return true;
      if (thread === current) continue;
      if (thread.txn !== null || thread.idleApply !== null) return true;
      if (loop?.status(thread.threadId) === "running") return true;
    }
    return false;
  }

  /** 새 정의로 세대를 다시 만든다. 실패하면 만들어 둔 세대를 모두 닫고 처음 실패한 scope와 값을 돌려준다 */
  async function bringUp(
    records: readonly RegistrationRecord[],
    resetRefusedState: boolean,
    cleared: { count: number },
  ): Promise<{ readonly ok: true } | BringUpFailure> {
    const made: { readonly record: RegistrationRecord; readonly generation: Generation }[] = [];
    const failed: { value: BringUpFailure | undefined } = { value: undefined };
    await eachInOrder(records, async (record) => {
      const result = await runSetup(record);
      if (result.ok) {
        made.push({ record, generation: result.generation });
        return "continue";
      }
      const error = result.failure.error;
      failed.value = {
        ok: false,
        record,
        failure: {
          code: result.failure.code ?? "registration_setup_failed",
          message:
            result.failure.kind === "timeout"
              ? `setup of ${record.id} exceeded its time budget`
              : messageOf(error ?? `setup of ${record.id} failed`),
          cause: error ?? result.failure.kind,
          result,
        },
      };
      return "stop";
    });
    // 모든 setup이 끝난 뒤에 저장된 상태를 맞춘다. 그 scope를 켜 둔 thread마다 본다
    if (failed.value === undefined) {
      await eachInOrder(made, async (item) => {
        await eachInOrder([...core.threads.values()], async (thread) => {
          if (!thread.active.has(item.record.id)) return "continue";
          let refused = await deps.state.prepareStored(item.record, item.generation, thread);
          if (refused !== undefined && resetRefusedState && STORED_STATE_ERRORS.has(refused.code)) {
            const reset = await deps.state.resetStored(item.record, thread);
            if (reset.ok) {
              cleared.count += 1;
              refused = await deps.state.prepareStored(item.record, item.generation, thread);
            }
          }
          if (refused === undefined) return "continue";
          failed.value = {
            ok: false,
            record: item.record,
            failure: {
              code: refused.code,
              message: refused.message,
              cause: refused,
              result: undefined,
            },
          };
          return "stop";
        });
        return failed.value === undefined ? "continue" : "stop";
      });
    }
    if (failed.value !== undefined) {
      await eachInOrder(made.toReversed(), async (item) => {
        await disposeGeneration(item.record, item.generation);
        if (item.generation.number === item.record.generationCount)
          item.record.generationCount -= 1;
        return "continue";
      });
      return failed.value;
    }
    for (const item of made) {
      item.record.generation = item.generation;
      item.record.waiting = [];
      item.record.lastError = undefined;
      item.generation.open = true;
    }
    return { ok: true };
  }

  /** 임대를 쥔 scope의 drive 함수는 새 세대의 것으로 다음 경계에서 다시 부른다. 임대는 반납하지 않는다 */
  function keepDriving(records: readonly RegistrationRecord[]): void {
    for (const thread of core.threads.values()) {
      const held = thread.lease;
      if (held === null || held.status !== "active") continue;
      if (!records.some((record) => record.id === held.scopeId)) continue;
      held.wantInvoke = true;
    }
  }

  async function applySwap(plan: SwapPlan): Promise<SwapResult> {
    const unit = plan.unit;
    const newIds = new Set(plan.staged.map((item) => item.id));
    const removed = unit.scopeIds.filter((id) => !newIds.has(id));
    const kept = plan.staged
      .map((item) => core.scopes.get(item.id))
      .filter((record): record is RegistrationRecord => record !== undefined);
    const previous = new Map<RegistrationId, RegistrationDefinition>();
    const previousUnit = { manifest: unit.manifest, loadIndex: unit.loadIndex };
    // 열린 세대가 있던 scope만 다시 만든다. 꺼져 있던 scope는 정의만 바뀌고 다음에 켤 때 새 정의로 돈다
    const live = kept.filter((record) => record.generation !== null && !record.generation.closed);
    // 1. 옛 세대를 닫고(등록 해제기 실행) 정의를 바꾼다. 같은 이름의 도구와 포트를 새 세대가 이어받으려면 먼저 내려야 한다
    await eachInOrder(kept.toReversed(), async (record) => {
      previous.set(record.id, definitionOf(record));
      const generation = record.generation;
      if (generation !== null && live.includes(record)) {
        record.generation = null;
        await disposeGeneration(record, generation);
      }
      return "continue";
    });
    unit.manifest = plan.manifest;
    unit.loadIndex = plan.loadIndex;
    for (const item of plan.staged) {
      const record = core.scopes.get(item.id);
      if (record === undefined) continue;
      assignDefinition(record, {
        manifest: plan.manifest,
        plugin: item.plugin,
        loadIndex: plan.loadIndex,
        builtin: unit.builtin,
        def: item.def,
        setup: item.setup,
      });
    }
    // 2. 새 세대
    const cleared = { count: 0 };
    const brought = await bringUp(live, plan.resetRefusedState, cleared);
    if (!brought.ok) {
      // 3. 실패: 옛 정의로 되돌려 다시 연다. 실패한 새 버전의 기록은 남기지 않는다
      unit.manifest = previousUnit.manifest;
      unit.loadIndex = previousUnit.loadIndex;
      for (const record of kept) {
        const before = previous.get(record.id);
        if (before !== undefined) assignDefinition(record, before);
      }
      const restoring = await bringUp(live, false, { count: 0 });
      const failedToRestore: RegistrationId[] = [];
      if (!restoring.ok) {
        // 옛 정의도 다시 열리지 않는다(환경이 바뀌었다). 이 단위의 열려 있던 scope는 꺼진 채다
        for (const record of live) failedToRestore.push(record.id);
        markFailed(
          restoring.record,
          restoring.failure.result ?? {
            ok: false,
            failure: { kind: "threw", code: restoring.failure.code },
            issues: [],
            waiting: [],
          },
        );
      }
      for (const record of live) refreshStatus(record);
      keepDriving(live);
      deps.requestApply();
      return {
        ok: false,
        scopeId: brought.record.id,
        code: brought.failure.code,
        message: brought.failure.message,
        cause: brought.failure.cause,
        restored: failedToRestore.length === 0,
        failedToRestore,
      };
    }
    // 4. 성공: 새 버전에 없는 scope는 내리고, 새로 생긴 scope는 정의한다. 켜는 일은 다음 경계가 한다
    await eachInOrder(removed, async (id) => {
      const record = core.scopes.get(id);
      if (record === undefined) return "continue";
      await teardown(record);
      core.scopes.delete(id);
      core.notify({ kind: "scope", scopeId: id, threadId: null });
      return "continue";
    });
    for (const item of plan.staged) {
      if (!core.scopes.has(item.id)) core.scopes.set(item.id, recordOf(unit, item));
    }
    unit.scopeIds.splice(0, unit.scopeIds.length, ...plan.staged.map((item) => item.id));
    for (const record of kept) refreshStatus(record);
    for (const record of live) core.notify({ kind: "scope", scopeId: record.id, threadId: null });
    keepDriving(live);
    deps.requestApply();
    return { ok: true, statesCleared: cleared.count };
  }

  function anyRunning(): boolean {
    const loop = core.ports.get(LoopPortKey);
    if (loop === undefined) return false;
    for (const threadId of core.threads.keys()) {
      if (loop.status(threadId) === "running") return true;
    }
    return false;
  }

  /** 어느 thread라도 켜 두기를 바라는가. 열린 thread가 없으면 전체 기본값이다 */
  function wantedAnywhere(record: RegistrationRecord): boolean {
    if (core.threads.size === 0) return record.desired;
    return [...core.threads.values()].some((thread) => wantedBy(thread, record));
  }

  /** 세대를 계속 열어 둘 이유가 있는가: 켜 두기를 바라거나 이미 켜져 있는 thread가 있다 */
  function neededAnywhere(record: RegistrationRecord): boolean {
    if (core.threads.size === 0) return record.desired;
    return [...core.threads.values()].some(
      (thread) => thread.active.has(record.id) || wantedBy(thread, record),
    );
  }

  function refreshStatus(record: RegistrationRecord): void {
    const generation = record.generation;
    const live = generation !== null && generation.open && !generation.stale;
    const wanted = wantedAnywhere(record);
    if (live) {
      record.status = wanted ? "enabled" : "disabling";
    } else if (generation !== null && generation.closing) {
      record.status = "disabling";
    } else {
      record.status = wanted ? "enabling" : "disabled";
    }
  }

  /** 공급자 재시작으로 Cordis가 apply를 다시 불렀다. 새 세대로 다시 만들 것을 기록하고 적용을 예약한다(N-02, 결정 D8) */
  function markStale(record: RegistrationRecord, generation: Generation): void {
    if (generation.stale || generation.closed) return;
    generation.stale = true;
    generation.open = false;
    core.deps.report({
      level: "info",
      code: "scope_notice",
      scopeId: record.id,
      extension: record.extension,
      message: `a provider of ${record.id} restarted; setup runs again at the next step boundary`,
    });
    refreshStatus(record);
    core.notify({ kind: "scope", scopeId: record.id, threadId: null });
    deps.requestApply();
  }

  async function teardown(record: RegistrationRecord): Promise<void> {
    const generation = record.generation;
    record.desired = false;
    for (const thread of core.threads.values()) {
      thread.want.delete(record.id);
      thread.active.delete(record.id);
    }
    deps.lease.releaseForRegistration(record.id, "disabled");
    record.generation = null;
    if (generation !== null) await disposeGeneration(record, generation);
    record.status = "disabled";
  }

  const handles = new WeakMap<RegistrationRecord, RegistrationHandle>();

  function handleOf(record: RegistrationRecord): RegistrationHandle {
    const cached = handles.get(record);
    if (cached !== undefined) return cached;
    const handle: RegistrationHandle = {
      id: record.id,
      get status(): RegistrationStatus {
        return record.status;
      },
      enable: () => toggle(record, true, undefined, undefined),
      disable: () => toggle(record, false, undefined, undefined),
    };
    handles.set(record, handle);
    return handle;
  }

  function refuse(record: RegistrationRecord, thread: ThreadRuntime, error: PrimitiveError): void {
    thread.refused.add(record.id);
    record.lastError = { code: error.code, message: error.message };
    core.deps.report({
      level: "error",
      code: error.code,
      scopeId: record.id,
      extension: record.extension,
      message: `scope ${record.id} was not enabled in thread ${thread.threadId}: ${error.message}`,
      cause: error,
    });
    core.notify({ kind: "scope", scopeId: record.id, threadId: thread.threadId });
  }

  /** stale 세대를 정리하고 새 세대를 만들 수 있게 record.generation을 비운다 */
  async function discardStale(record: RegistrationRecord): Promise<void> {
    const generation = record.generation;
    if (generation === null || !generation.stale) return;
    record.generation = null;
    await disposeGeneration(record, generation);
  }

  function toggle(
    record: RegistrationRecord,
    enabled: boolean,
    reason: RegistrationToggleReason | undefined,
    threadId: ThreadId | undefined,
  ): void {
    if (threadId === undefined) {
      record.desired = enabled;
      record.reason = reason;
      for (const thread of core.threads.values()) {
        thread.want.delete(record.id);
        thread.refused.delete(record.id);
      }
      if (enabled && record.status === "disabled") {
        record.driveError = false;
        record.lastError = undefined;
      }
    } else {
      const thread = core.threads.get(threadId);
      if (thread === undefined) return;
      thread.want.set(record.id, { enabled, reason });
      thread.refused.delete(record.id);
      if (enabled) record.driveError = false;
    }
    refreshStatus(record);
    core.notify({ kind: "scope", scopeId: record.id, threadId: threadId ?? null });
    deps.requestApply(threadId);
  }

  return {
    anyRunning,
    refreshStatus,
    describe: (unit, id, def, setup) => describeScope(unit, id, def, setup),
    swapBlocked,
    applySwap,
    define(unit, id, def, setup) {
      const existing = core.scopes.get(id);
      if (existing !== undefined) {
        throw new PrimitiveError("registration_duplicate", `scope ${id} is already defined`, {
          scopeId: id,
        });
      }
      const staged = describeScope(unit, id, def, setup);
      const record = recordOf(unit, staged);
      core.scopes.set(id, record);
      unit.scopeIds.push(id);
      return handleOf(record);
    },
    handleOf,
    setInitial(record, enabled) {
      record.desired = enabled;
      record.status = enabled ? "enabling" : "disabled";
    },
    request(record, enabled, reason, threadId) {
      toggle(record, enabled, reason, threadId);
    },
    markStale,
    async resetState(record, thread) {
      const code = record.lastError?.code;
      if (code === undefined || !STORED_STATE_ERRORS.has(code)) return err({ kind: "not_refused" });
      const reset = await deps.state.resetStored(record, thread);
      if (!reset.ok) return reset;
      thread.refused.delete(record.id);
      record.lastError = undefined;
      refreshStatus(record);
      core.notify({ kind: "scope", scopeId: record.id, threadId: thread.threadId });
      deps.requestApply(thread.threadId);
      return reset;
    },
    async startupApply(record) {
      if (!record.desired) return { scopeId: record.id, status: "skipped", issues: [] };
      if (anyRunning() || record.busy)
        return { scopeId: record.id, status: "deferred", issues: [] };
      const result = await runSetup(record);
      if (!result.ok) {
        markFailed(record, result);
        return {
          scopeId: record.id,
          status: "failed",
          failure: result.failure,
          issues: result.issues,
        };
      }
      record.generation = result.generation;
      record.waiting = [];
      record.lastError = undefined;
      // 이미 열린 thread는 바로 켠다. scope.changed 기록은 다음 유휴 적용이 남긴다
      await eachInOrder([...core.threads.values()], async (thread) => {
        if (!wantedBy(thread, record)) return "continue";
        const refused = await deps.state.prepareStored(record, result.generation, thread);
        if (refused !== undefined) {
          refuse(record, thread, refused);
          return "continue";
        }
        thread.active.add(record.id);
        return "continue";
      });
      result.generation.open = true;
      refreshStatus(record);
      return { scopeId: record.id, status: "applied", issues: result.issues };
    },
    async seedThread(thread) {
      const records = [...core.scopes.values()].toSorted(
        (a, b) => a.loadIndex - b.loadIndex || a.id.localeCompare(b.id),
      );
      await eachInOrder(records, async (record) => {
        const generation = record.generation;
        if (generation === null || !generation.open || generation.stale) return "continue";
        if (!wantedBy(thread, record) || thread.active.has(record.id)) return "continue";
        const refused = await deps.state.prepareStored(record, generation, thread);
        if (refused !== undefined) {
          refuse(record, thread, refused);
          return "continue";
        }
        thread.active.add(record.id);
        return "continue";
      });
    },
    async applyToggles(thread, txn) {
      // 기다리는 교체가 없으면 await하지 않는다(경계 적용의 마이크로태스크 순서를 바꾸지 않는다)
      const draining = deps.drainSwaps(thread);
      if (draining !== undefined) await draining;
      const records = [...core.scopes.values()].toSorted(
        (a, b) => a.loadIndex - b.loadIndex || a.id.localeCompare(b.id),
      );
      // 공급자 재시작으로 낡은 세대는 먼저 치운다. 새 세대는 아래 켜기 단계에서 만든다
      await eachInOrder(records, async (record) => {
        if (record.generation?.stale === true && !record.busy) await discardStale(record);
        return "continue";
      });
      // 끄기를 먼저: 이 thread의 핸들러 제외 → 임대 반납 예정
      for (const record of records) {
        if (!thread.active.has(record.id) || wantedBy(thread, record)) continue;
        thread.active.delete(record.id);
        txn.deactivating.push(record);
        deps.lease.releaseForRegistrationIn(thread, record.id, "disabled");
      }
      // 어느 thread도 쓰지 않는 세대는 닫는다
      for (const record of records) {
        const generation = record.generation;
        if (generation === null || !generation.open || generation.closing) continue;
        if (neededAnywhere(record)) continue;
        generation.open = false;
        generation.closing = true;
        txn.closing.push(record);
      }
      // 켜기는 로드 순서대로 하나씩: 공급자가 먼저 켜져야 소비자의 기능 의존이 채워진다
      await eachInOrder(records, async (record) => {
        if (!wantedBy(thread, record)) return "continue";
        const existing = record.generation;
        // 켜짐 집합에 있어도 세대가 없으면(낡은 세대를 치운 뒤) 다시 만든다
        if (thread.active.has(record.id) && existing !== null) return "continue";
        if (thread.refused.has(record.id) || record.busy) return "continue";
        if (existing !== null) {
          // 다른 thread가 쓰는 열린 세대에는 setup 없이 이 thread만 더한다. 닫히는 중이면 다음 적용에서 다시 만든다
          if (!existing.open || existing.closing) return "continue";
          const refused = await deps.state.prepareStored(record, existing, thread);
          if (refused !== undefined) {
            refuse(record, thread, refused);
            return "continue";
          }
          txn.activating.push(record);
          return "continue";
        }
        const result = await runSetup(record);
        if (!result.ok) {
          markFailed(record, result);
          return "continue";
        }
        const refused = await deps.state.prepareStored(record, result.generation, thread);
        if (refused !== undefined) {
          await disposeGeneration(record, result.generation);
          if (result.generation.number === record.generationCount) record.generationCount -= 1;
          markFailed(
            record,
            { ok: false, failure: { kind: "threw", code: refused.code }, issues: [], waiting: [] },
            refused,
          );
          return "continue";
        }
        record.generation = result.generation;
        record.waiting = [];
        txn.opening.push(record);
        txn.activating.push(record);
        return "continue";
      });
      for (const record of records) refreshStatus(record);
    },
    async settle(thread, txn, result) {
      if (result === "committed") {
        for (const record of txn.opening) {
          const generation = record.generation;
          if (generation === null) continue;
          generation.open = true;
          record.lastError = undefined;
        }
        for (const record of txn.activating) {
          thread.active.add(record.id);
          record.lastError = undefined;
        }
        await eachInOrder(txn.closing, async (record) => {
          const generation = record.generation;
          // 커밋하는 동안 다시 필요해진 세대는 닫지 않는다
          if (generation !== null && !neededAnywhere(record)) {
            record.generation = null;
            await disposeGeneration(record, generation);
          } else if (generation !== null) {
            generation.closing = false;
            generation.open = true;
          }
          return "continue";
        });
        for (const record of core.scopes.values()) refreshStatus(record);
        for (const record of [...txn.activating, ...txn.deactivating, ...txn.closing]) {
          core.notify({ kind: "scope", scopeId: record.id, threadId: thread.threadId });
        }
        return;
      }
      await eachInOrder(txn.opening, async (record) => {
        const generation = record.generation;
        if (generation !== null) {
          await disposeGeneration(record, generation);
          // 커밋되지 못한 세대의 번호를 돌려준다. 다시 적용하면 같은 번호가 되어 커밋 키가 같다(boundary commitPlanOf)
          if (generation.number === record.generationCount) record.generationCount -= 1;
        }
        record.generation = null;
        return "continue";
      });
      for (const record of txn.closing) {
        const generation = record.generation;
        if (generation !== null && !generation.closed) {
          generation.closing = false;
          generation.open = true;
        }
      }
      for (const record of txn.deactivating) {
        const generation = record.generation;
        if (generation !== null && !generation.closed) thread.active.add(record.id);
      }
      for (const record of core.scopes.values()) refreshStatus(record);
    },
    teardown,
    info(record) {
      const holding = [...core.threads.values()].some(
        (thread) => thread.lease?.scopeId === record.id && thread.lease.status === "active",
      );
      const drive: RegistrationInfo["drive"] = record.driveError
        ? "error"
        : holding
          ? "holding"
          : record.generation?.drive !== undefined && record.generation.drive !== null
            ? "registered"
            : "none";
      return {
        id: record.id,
        extension: record.extension,
        status: record.status,
        generation: record.generationCount,
        waiting: record.waiting,
        drive,
        ...(record.lastError === undefined ? {} : { lastError: record.lastError }),
      };
    },
  };
}
