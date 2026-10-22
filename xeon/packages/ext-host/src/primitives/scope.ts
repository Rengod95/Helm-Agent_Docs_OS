import { assertNever } from "@xeon/contracts";
import {
  LoopPortKey,
  validateUsage,
  type ExtensionUsage,
  type ManifestIssue,
  type ScopeApi,
  type ScopeDef,
  type ScopeHandle,
  type ScopeId,
  type ScopeSetup,
  type ScopeStatus,
} from "@xeon/contracts/extensions";
import type { CapabilityId } from "@xeon/contracts/capabilities";
import { eraseScope } from "../erase.ts";
import { withoutAmbient } from "./ambient.ts";
import {
  newUsage,
  type BoundaryTxn,
  type Generation,
  type HostCore,
  type InstalledUnit,
  type ScopeRecord,
  type ScopeToggleReason,
  type ThreadRuntime,
} from "./core.ts";
import type { AnyState } from "./erased-types.ts";
import { PrimitiveError, type PrimitiveErrorCode } from "./errors.ts";
import type { LeaseBroker } from "./lease.ts";
import { eachInOrder } from "./sequence.ts";
import { capabilityServiceName, toCapabilityIds } from "./services.ts";
import type { StateService } from "./state.ts";

// ── 공개 모양 ──────────────────────────────────────────────────────────────

export interface ScopeInfo {
  readonly id: ScopeId;
  readonly extension: string;
  readonly status: ScopeStatus;
  /** 꺼져 있으면 마지막 세대 */
  readonly generation: number;
  /** requires 능력이 없어 켜지지 못한 경우의 부족 능력 */
  readonly waiting: readonly CapabilityId[];
  readonly drive: "none" | "registered" | "holding" | "error";
  readonly lastError?: { readonly code: PrimitiveErrorCode; readonly message: string };
}

/** install 안의 시작 적용 결과. scope 하나에 하나(X.primitives.spec §3.2) */
export interface ScopeSetupOutcome {
  readonly scopeId: ScopeId;
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
      readonly failure: NonNullable<ScopeSetupOutcome["failure"]>;
      readonly issues: readonly ManifestIssue[];
      readonly waiting: readonly CapabilityId[];
    };

export interface ScopeRuntime {
  /** scope 하나의 ScopeHandle */
  handleOf(record: ScopeRecord): ScopeHandle;
  /** install의 ScopeFn 구현 */
  define<S>(unit: InstalledUnit, id: ScopeId, def: ScopeDef<S>, setup: ScopeSetup<S>): ScopeHandle;
  /** 토글 요청을 기록한다. 적용은 단계 경계나 유휴 적용에서 한다 */
  request(record: ScopeRecord, enabled: boolean, reason?: ScopeToggleReason): void;
  /** install: 초기 켜기 요청을 정한다. 설정 값이 있으면 매니페스트·정의 기본값을 덮는다 */
  setInitial(record: ScopeRecord, enabled: boolean): void;
  /** install: 초기 요청이 참이면 바로 켜기를 적용한다(실행 중 thread가 없을 때) */
  startupApply(record: ScopeRecord): Promise<ScopeSetupOutcome>;
  /** prepare: 요청과 현재 상태의 차이를 적용한다. 세대 닫기와 setup 실행이 여기서 일어난다 */
  applyToggles(thread: ThreadRuntime, txn: BoundaryTxn): Promise<void>;
  /** settle: 커밋 결과에 따라 세대를 열거나 정리하고, 실패면 되돌린다 */
  settle(thread: ThreadRuntime, txn: BoundaryTxn, result: "committed" | "failed"): Promise<void>;
  /** 경계 없이 즉시 내린다(uninstall, dispose). 열린 임대는 disabled 반납 예정이 된다 */
  teardown(record: ScopeRecord): Promise<void>;
  info(record: ScopeRecord): ScopeInfo;
  /** 실행 중인 thread가 있는가 */
  anyRunning(): boolean;
}

export interface ScopeRuntimeDeps {
  readonly makeApi: (record: ScopeRecord, generation: Generation) => ScopeApi<AnyState>;
  readonly state: StateService;
  readonly lease: LeaseBroker;
  /** 토글 요청이 들어왔을 때 유휴 적용을 예약한다 */
  readonly requestApply: () => void;
}

function codeOf(error: unknown): PrimitiveErrorCode | undefined {
  return error instanceof PrimitiveError ? error.code : undefined;
}

const NOOP = (): void => {};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "setup failed";
}

export function createScopeRuntime(core: HostCore, deps: ScopeRuntimeDeps): ScopeRuntime {
  /** 세대의 onDispose를 등록 역순으로 차례로 실행한다. 예외는 기록하고 다음으로 간다 */
  async function runDisposers(record: ScopeRecord, generation: Generation): Promise<void> {
    const list = generation.disposers.splice(0).toReversed();
    await eachInOrder(list, async (dispose) => {
      try {
        await dispose();
      } catch (error) {
        core.deps.report({
          level: "error",
          code: "scope_inactive",
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
  async function disposeGeneration(record: ScopeRecord, generation: Generation): Promise<void> {
    generation.open = false;
    generation.closed = true;
    generation.abort.abort(new DOMException(`scope ${record.id} generation closed`, "AbortError"));
    if (generation.opened !== null) {
      try {
        await generation.opened.dispose();
      } catch (error) {
        core.deps.report({
          level: "error",
          code: "scope_inactive",
          scopeId: record.id,
          extension: record.extension,
          message: `fiber of scope ${record.id} failed to dispose`,
          cause: error,
        });
      }
    }
    await runDisposers(record, generation);
  }

  function missingCapabilities(record: ScopeRecord): readonly CapabilityId[] {
    return toCapabilityIds((record.manifest.requires ?? []).map((req) => req.id)).filter(
      (id) => core.bridge.service(capabilityServiceName(id)) === undefined,
    );
  }

  async function runSetup(record: ScopeRecord): Promise<SetupResult> {
    record.busy = true;
    try {
      return await runSetupInner(record);
    } finally {
      record.busy = false;
    }
  }

  async function runSetupInner(record: ScopeRecord): Promise<SetupResult> {
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
    };
    // 공급자 연쇄가 끝나기를 기다린 뒤 의존 능력이 있는지 본다
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
      inject: toCapabilityIds((record.manifest.requires ?? []).map((req) => req.id)).map(
        capabilityServiceName,
      ),
      apply: async (fiber) => {
        generation.fiber = fiber;
        // onDispose 묶음 effect: 등록 역순으로 차례로 실행한다(Cordis는 effect를 동시에 해제한다)
        fiber.effect(() => () => runDisposers(record, generation), "scope.onDispose");
        const api = deps.makeApi(record, generation);
        generation.api = api;
        try {
          const returned = await withoutAmbient(() => record.setup(api));
          if (typeof returned === "object" && !returned.ok) {
            // setup이 시작할 수 없다고 값으로 알렸다. fiber는 던져야 닫히므로 같은 실패 경로로 보낸다
            throw new PrimitiveError("scope_setup_failed", returned.error.reason, {
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
      // 늦게 끝난 setup의 등록은 세대가 닫혀 있어 scope_inactive로 버려진다
      generation.closed = true;
      generation.abort.abort(new DOMException("scope setup budget exceeded", "TimeoutError"));
      core.track(
        opened.dispose().catch((error: unknown) => {
          core.deps.report({
            level: "warning",
            code: "scope_inactive",
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
    const issues = validateUsage(record.manifest, usage);
    if (issues.some((issue) => issue.severity === "error")) {
      await disposeGeneration(record, generation);
      return { ok: false, failure: { kind: "threw" }, issues, waiting: [] };
    }
    return { ok: true, generation, issues };
  }

  function markFailed(
    record: ScopeRecord,
    result: Extract<SetupResult, { ok: false }>,
    error?: PrimitiveError,
  ): void {
    record.status = "disabled";
    record.desired = false;
    record.generation = null;
    record.waiting = result.waiting;
    const code: PrimitiveErrorCode = error?.code ?? result.failure.code ?? "scope_setup_failed";
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
      code: "scope_setup_failed",
      scopeId: record.id,
      extension: record.extension,
      message: record.lastError.message,
      ...(result.failure.error === undefined ? {} : { cause: result.failure.error }),
    });
  }

  function anyRunning(): boolean {
    const loop = core.ports.get(LoopPortKey);
    if (loop === undefined) return false;
    for (const threadId of core.threads.keys()) {
      if (loop.status(threadId) === "running") return true;
    }
    return false;
  }

  const handles = new WeakMap<ScopeRecord, ScopeHandle>();

  function handleOf(record: ScopeRecord): ScopeHandle {
    const cached = handles.get(record);
    if (cached !== undefined) return cached;
    const handle: ScopeHandle = {
      id: record.id,
      get status(): ScopeStatus {
        return record.status;
      },
      enable: () => toggle(record, true, undefined),
      disable: () => toggle(record, false, undefined),
    };
    handles.set(record, handle);
    return handle;
  }

  return {
    anyRunning,
    define(unit, id, def, setup) {
      const existing = core.scopes.get(id);
      if (existing !== undefined) {
        throw new PrimitiveError("scope_duplicate", `scope ${id} is already defined`, {
          scopeId: id,
        });
      }
      if (id !== unit.name && !id.startsWith(`${unit.name}/`)) {
        throw new PrimitiveError(
          "scope_foreign_id",
          `scope id ${id} does not start with the extension name ${unit.name}`,
          { scopeId: id },
        );
      }
      const isPrimary = id === unit.name;
      const initial = isPrimary
        ? (def.defaultEnabled ?? unit.manifest.defaultEnabled ?? true)
        : (def.defaultEnabled ?? false);
      const erased = eraseScope(def, setup);
      const record: ScopeRecord = {
        id,
        extension: unit.name,
        manifest: unit.manifest,
        loadIndex: unit.loadIndex,
        builtin: unit.builtin,
        ...erased,
        desired: initial,
        reason: undefined,
        status: initial ? "enabling" : "disabled",
        generationCount: 0,
        generation: null,
        lastError: undefined,
        waiting: [],
        driveError: false,
        busy: false,
      };
      core.scopes.set(id, record);
      unit.scopeIds.push(id);
      return handleOf(record);
    },
    handleOf,
    setInitial(record, enabled) {
      record.desired = enabled;
      record.status = enabled ? "enabling" : "disabled";
    },
    request(record, enabled, reason) {
      toggle(record, enabled, reason);
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
      result.generation.open = true;
      record.generation = result.generation;
      record.status = "enabled";
      record.waiting = [];
      record.lastError = undefined;
      return { scopeId: record.id, status: "applied", issues: result.issues };
    },
    async applyToggles(thread, txn) {
      const records = [...core.scopes.values()].toSorted(
        (a, b) => a.loadIndex - b.loadIndex || a.id.localeCompare(b.id),
      );
      // 끄기를 먼저: 핸들러 제외 → 임대 반납 예정
      for (const record of records) {
        const generation = record.generation;
        if (!record.desired && generation !== null && generation.open) {
          generation.open = false;
          txn.closing.push(record);
          deps.lease.releaseForScope(record.id, "disabled");
        }
      }
      // 켜기는 로드 순서대로 하나씩: 공급자가 먼저 켜져야 소비자의 능력 의존이 채워진다
      await eachInOrder(records, async (record) => {
        if (!record.desired || record.generation !== null || record.busy) return "continue";
        const stored = deps.state.checkStored(record, thread);
        if (stored !== undefined) {
          markFailed(
            record,
            {
              ok: false,
              failure: { kind: "threw", code: stored.code },
              issues: [],
              waiting: [],
            },
            stored,
          );
          return "continue";
        }
        const result = await runSetup(record);
        if (!result.ok) {
          markFailed(record, result);
          return "continue";
        }
        record.generation = result.generation;
        record.waiting = [];
        txn.opening.push(record);
        return "continue";
      });
    },
    async settle(_thread, txn, result) {
      if (result === "committed") {
        for (const record of txn.opening) {
          const generation = record.generation;
          if (generation === null) continue;
          generation.open = true;
          // 커밋하는 동안 끄기 요청이 들어왔으면 다음 경계에서 닫는다
          record.status = record.desired ? "enabled" : "disabling";
          record.lastError = undefined;
        }
        await eachInOrder(txn.closing, async (record) => {
          const generation = record.generation;
          if (generation !== null) await disposeGeneration(record, generation);
          record.generation = null;
          record.status = record.desired ? "enabling" : "disabled";
          return "continue";
        });
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
        record.status = "enabling";
        return "continue";
      });
      for (const record of txn.closing) {
        const generation = record.generation;
        if (generation !== null && !generation.closed) generation.open = true;
      }
    },
    async teardown(record) {
      const generation = record.generation;
      record.desired = false;
      deps.lease.releaseForScope(record.id, "disabled");
      if (generation !== null) await disposeGeneration(record, generation);
      record.generation = null;
      record.status = "disabled";
    },
    info(record) {
      const holding = [...core.threads.values()].some(
        (thread) => thread.lease?.scopeId === record.id && thread.lease.status === "active",
      );
      const drive: ScopeInfo["drive"] = record.driveError
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

  function toggle(
    record: ScopeRecord,
    enabled: boolean,
    reason: ScopeToggleReason | undefined,
  ): void {
    record.desired = enabled;
    record.reason = reason;
    switch (record.status) {
      case "enabled":
        if (!enabled) record.status = "disabling";
        break;
      case "disabling":
        if (enabled) record.status = "enabled";
        break;
      case "disabled":
        if (enabled) {
          record.status = "enabling";
          record.driveError = false;
          record.lastError = undefined;
        }
        break;
      case "enabling":
        if (!enabled) record.status = "disabled";
        break;
      default:
        assertNever(record.status, "ScopeStatus");
    }
    deps.requestApply();
  }
}
