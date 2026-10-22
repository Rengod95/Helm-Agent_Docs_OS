import { Bug } from "@xeon/contracts";
import {
  LeaseArbiterPortKey,
  LoopPortKey,
  RecordCommitPortKey,
  type DriveLimits,
  type LeaseBudget,
  type LoopHandle,
  type OpenLease,
  type ScopeId,
  type SpawnOutcome,
  type SpawnSpec,
  type TurnInput,
  type TurnOutcome,
} from "@xeon/contracts/extensions";
import type { Usage } from "@xeon/contracts/conversation";
import { withAmbient, type DriveInvocation } from "./ambient.ts";
import type {
  BoundarySignal,
  BoundaryTxn,
  HostCore,
  LeaseRuntime,
  ReleaseReason,
  ScopeRecord,
  ThreadRuntime,
} from "./core.ts";
import { makeDraft } from "./drafts.ts";
import { PrimitiveError } from "./errors.ts";
import type { StateService } from "./state.ts";

export interface LeaseBroker {
  /** openThread: 저장된 열린 임대를 되살린다. 설치되지 않았거나 꺼진 scope의 임대는 restart로 반납 예정이 된다 */
  restore(thread: ThreadRuntime, open: OpenLease | null): void;
  /** scope가 꺼지면 모든 thread에서 그 scope의 임대를 반납 예정(disabled)으로 바꾼다 */
  releaseForScope(scopeId: ScopeId, reason: ReleaseReason): void;
  /** 한 thread에서만 scope가 꺼질 때 그 thread의 임대를 반납 예정으로 바꾼다(P-28) */
  releaseForScopeIn(thread: ThreadRuntime, scopeId: ScopeId, reason: ReleaseReason): void;
  /** prepare: 반납 예정 임대의 lease.released 초안 */
  collectReleases(thread: ThreadRuntime, txn: BoundaryTxn): void;
  /** prepare: 후보 계산과 lease.acquired 초안 */
  grant(thread: ThreadRuntime, txn: BoundaryTxn): void;
  /** settle(committed): 커밋된 반납·부여를 반영한다 */
  applyCommitted(thread: ThreadRuntime, txn: BoundaryTxn): void;
  /** settle 뒤: 경계 종류에 맞게 drive 함수를 부른다 */
  onBoundary(thread: ThreadRuntime, signal: BoundarySignal): void;
  /** 임대를 반납 예정으로 바꾼다. 활성이 아니면 아무 일도 하지 않는다 */
  release(lease: LeaseRuntime, reason: ReleaseReason): void;
}

/**
 * 필드마다 base = 요청 ?? 일반 기본값, 실효 = min(base, 천장). 둘 다 없으면 그 필드는 상한 없음이다
 * (X.primitives.spec §4.4.2, review.decisions-2 U-12). 요청이 천장보다 크면 clamped에 필드 이름을 담는다
 */
function effectiveLimits(
  defaults: DriveLimits,
  ceiling: DriveLimits,
  requested: DriveLimits | undefined,
): { readonly limits: DriveLimits; readonly clamped: readonly string[] } {
  const clamped: string[] = [];
  const out: { maxTurns?: number; maxSpawns?: number; maxTokens?: number } = {};
  for (const key of ["maxTurns", "maxSpawns", "maxTokens"] as const) {
    const fromRequest = requested?.[key];
    const base = fromRequest ?? defaults[key];
    const cap = ceiling[key];
    if (base !== undefined && cap !== undefined) {
      if (fromRequest !== undefined && fromRequest > cap) clamped.push(key);
      out[key] = Math.min(base, cap);
    } else if (base !== undefined) {
      out[key] = base;
    } else if (cap !== undefined) {
      // 요청도 기본값도 없고 천장만 있으면 천장이 곧 상한이다
      out[key] = cap;
    }
  }
  return { limits: out, clamped };
}

function remaining(limit: number | undefined, used: number): number | null {
  return limit === undefined ? null : Math.max(0, limit - used);
}

function release(lease: LeaseRuntime, reason: ReleaseReason): void {
  if (lease.status !== "active") return;
  lease.status = "releasing";
  lease.reason = reason;
  lease.abort.abort(new DOMException(`lease released: ${reason}`, "AbortError"));
}

function leaseError(lease: LeaseRuntime): PrimitiveError {
  return lease.reason === "budget"
    ? new PrimitiveError("lease_budget", `lease ${lease.leaseId} is out of budget`, {
        scopeId: lease.scopeId,
      })
    : new PrimitiveError("lease_revoked", `lease ${lease.leaseId} is no longer active`, {
        scopeId: lease.scopeId,
      });
}

function budgetOf(lease: LeaseRuntime): LeaseBudget {
  return {
    turns: remaining(lease.limits.maxTurns, lease.used.turns),
    spawns: remaining(lease.limits.maxSpawns, lease.used.spawns),
    tokens: remaining(lease.limits.maxTokens, lease.used.tokens),
  };
}

function tokensOf(usage: Usage | null): number {
  return usage?.totalTokens ?? 0;
}

function assertBudget(lease: LeaseRuntime, kind: "turns" | "spawns"): void {
  const limit = kind === "turns" ? lease.limits.maxTurns : lease.limits.maxSpawns;
  const left = remaining(limit, lease.used[kind]);
  if (left !== null && left <= 0) {
    release(lease, "budget");
    throw leaseError(lease);
  }
}

export interface LeaseBrokerHooks {
  /** 함수 쪽 사유로 반납이 정해진 뒤(error, idle) 다음 경계를 기다리지 않고 유휴 적용을 예약한다 */
  requestApply(threadId: ThreadRuntime["threadId"]): void;
}

export function createLeaseBroker(
  core: HostCore,
  stateService: StateService,
  hooks: LeaseBrokerHooks,
): LeaseBroker {
  function loopStatusIdle(threadId: LeaseRuntime["threadId"]): boolean {
    const loop = core.ports.get(LoopPortKey);
    return loop === undefined || loop.status(threadId) !== "running";
  }

  function warnPortOnce(thread: ThreadRuntime, name: string): void {
    if (thread.warnedPorts.has(name)) return;
    thread.warnedPorts.add(name);
    core.deps.report({
      level: "warning",
      code: "port_unavailable",
      message: `${name} is not provided, so no drive lease is granted`,
    });
  }

  function makeLoopHandle(
    thread: ThreadRuntime,
    lease: LeaseRuntime,
    invocation: DriveInvocation,
  ): LoopHandle {
    const requireLoop = () => {
      const loop = core.ports.get(LoopPortKey);
      if (loop === undefined) {
        throw new PrimitiveError("port_unavailable", "xeon.loop (LoopPort) is not provided", {
          scopeId: lease.scopeId,
        });
      }
      return loop;
    };
    return {
      async turn(input: TurnInput): Promise<TurnOutcome> {
        if (lease.status !== "active") throw leaseError(lease);
        assertBudget(lease, "turns");
        const loop = requireLoop();
        const index = invocation.i;
        invocation.i += 1;
        const requestId = input.requestId ?? `${lease.leaseId}:${invocation.baseRev}.${index}`;
        const result = await loop.runTurn({
          threadId: lease.threadId,
          scopeId: lease.scopeId,
          leaseId: lease.leaseId,
          leaseEpoch: lease.leaseEpoch,
          requestId,
          input: input.input,
          // 반납이 진행 중인 turn을 끊지 않게 lease.signal이 아니라 thread 신호를 넘긴다
          signal: thread.abort.signal,
        });
        if (!result.replayed) {
          lease.used.turns += 1;
          lease.used.tokens += tokensOf(result.usage);
          invocation.effects += 1;
        }
        return result.outcome;
      },
      async spawn(spec: SpawnSpec): Promise<SpawnOutcome> {
        if (lease.status !== "active") throw leaseError(lease);
        assertBudget(lease, "spawns");
        const loop = requireLoop();
        const index = invocation.i;
        invocation.i += 1;
        const requestId = spec.requestId ?? `${lease.leaseId}:${invocation.baseRev}.${index}`;
        const result = await loop.spawn({
          threadId: lease.threadId,
          scopeId: lease.scopeId,
          leaseId: lease.leaseId,
          leaseEpoch: lease.leaseEpoch,
          requestId,
          spec,
          signal: lease.abort.signal,
        });
        if (!result.replayed) {
          lease.used.spawns += 1;
          lease.used.tokens += tokensOf(result.usage);
          invocation.effects += 1;
        }
        return result.outcome;
      },
      get budget(): LeaseBudget {
        return budgetOf(lease);
      },
      get signal(): AbortSignal {
        return lease.abort.signal;
      },
    };
  }

  async function invoke(thread: ThreadRuntime, lease: LeaseRuntime): Promise<void> {
    const record = core.scopes.get(lease.scopeId);
    const generation = record?.generation;
    if (record === undefined || generation === null || generation === undefined) {
      release(lease, "disabled");
      lease.running = false;
      return;
    }
    if (generation.stale) {
      // 공급자 재시작으로 세대를 다시 만드는 중이다. 임대는 두고 다음 경계에서 새 drive 함수로 이어 간다
      lease.running = false;
      lease.wantInvoke = true;
      return;
    }
    const drive = generation.drive;
    if (drive === null) {
      release(lease, "disabled");
      lease.running = false;
      return;
    }
    const baseRev = stateService.revOf(thread.threadId, lease.scopeId);
    const invocation: DriveInvocation = { leaseId: lease.leaseId, baseRev, i: 0, effects: 0 };
    lease.lastBaseRev = baseRev;
    const handle = makeLoopHandle(thread, lease, invocation);
    try {
      await withAmbient(
        {
          threadId: thread.threadId,
          scopeId: lease.scopeId,
          dispatchKey: null,
          counter: 0,
          drive: invocation,
          handler: null,
        },
        () => drive.fn(handle, stateService.docOf(thread.threadId, lease.scopeId)),
      );
    } catch (error) {
      lease.running = false;
      if (lease.status !== "active") {
        // 상한 소진·회수로 이미 반납이 정해졌다. 함수가 그 거부를 그대로 던진 것은 오류가 아니다
        if (lease.status === "releasing") hooks.requestApply(thread.threadId);
        return;
      }
      record.driveError = true;
      record.lastError = {
        code: error instanceof PrimitiveError ? error.code : "scope_setup_failed",
        message: error instanceof Error ? error.message : "drive function threw",
      };
      core.deps.report({
        level: "error",
        code: error instanceof PrimitiveError ? error.code : "handler_failed",
        scopeId: lease.scopeId,
        extension: record.extension,
        message: "drive function threw; lease released with error",
        cause: error,
      });
      release(lease, "error");
      hooks.requestApply(thread.threadId);
      return;
    }
    lease.running = false;
    if (lease.status !== "active") {
      if (lease.status === "releasing") hooks.requestApply(thread.threadId);
      return;
    }
    // 같은 상태 판으로 효과 없이 두 번 연속 반환하면 idle 반납(X.primitives.spec §4.4.3)
    if (invocation.effects > 0) {
      lease.idleStreak = 0;
    } else if (lease.idleRev === baseRev) {
      lease.idleStreak += 1;
    } else {
      lease.idleRev = baseRev;
      lease.idleStreak = 1;
    }
    if (lease.idleStreak >= 2) {
      release(lease, "idle");
      hooks.requestApply(thread.threadId);
      return;
    }
    // 실행 중에 호출 조건이 지나갔고 thread가 유휴면 바로 다시 부른다
    if (lease.missed && loopStatusIdle(thread.threadId)) {
      start(thread, lease);
    }
  }

  function start(thread: ThreadRuntime, lease: LeaseRuntime): void {
    lease.running = true;
    lease.wantInvoke = false;
    lease.missed = false;
    core.track(invoke(thread, lease));
  }

  function candidatesFor(thread: ThreadRuntime, txn: BoundaryTxn): ScopeRecord[] {
    const out: ScopeRecord[] = [];
    for (const record of core.scopes.values()) {
      if (record.driveError) continue;
      const activeHere = thread.active.has(record.id) || txn.activating.includes(record);
      if (!activeHere) continue;
      const generation = record.generation;
      if (generation === null || generation.stale) continue;
      if (!generation.open && !txn.opening.includes(record)) continue;
      if (generation.drive === null) continue;
      const cooled = thread.cooldown.get(record.id);
      if (cooled !== undefined && cooled === stateService.revOf(thread.threadId, record.id)) {
        continue;
      }
      out.push(record);
    }
    return out;
  }

  return {
    restore(thread, open) {
      if (open === null) return;
      const record = core.scopes.get(open.scopeId);
      const lease: LeaseRuntime = {
        leaseId: open.leaseId,
        scopeId: open.scopeId,
        threadId: thread.threadId,
        leaseEpoch: open.leaseEpoch,
        limits: open.limits,
        used: { ...open.used },
        status: "active",
        reason: undefined,
        abort: new AbortController(),
        idleStreak: 0,
        idleRev: null,
        lastBaseRev: null,
        running: false,
        wantInvoke: true,
        missed: false,
        committed: true,
      };
      thread.lease = lease;
      thread.leaseEpochs.set(
        open.scopeId,
        Math.max(open.leaseEpoch, thread.leaseEpochs.get(open.scopeId) ?? 0),
      );
      const alive =
        record !== undefined &&
        thread.active.has(open.scopeId) &&
        record.generation?.open === true &&
        !record.generation.stale;
      if (!alive) release(lease, "restart");
    },
    releaseForScope(scopeId, reason) {
      for (const thread of core.threads.values()) {
        if (thread.lease?.scopeId === scopeId) release(thread.lease, reason);
      }
    },
    releaseForScopeIn(thread, scopeId, reason) {
      if (thread.lease?.scopeId === scopeId) release(thread.lease, reason);
    },
    release,
    collectReleases(thread, txn) {
      const lease = thread.lease;
      if (lease !== null && lease.status === "active" && lease.committed) {
        // 사용자가 다른 그룹을 구동 그룹으로 골랐고 그 그룹이 후보이면 현재 임대를 회수한다(P-22 revoked)
        const named = core.deps.settings.activeDriveGroup(thread.threadId);
        if (named !== null && named !== lease.scopeId) {
          const target = candidatesFor(thread, txn).find((record) => record.id === named);
          if (target !== undefined) release(lease, "revoked");
        }
      }
      if (lease === null || lease.status !== "releasing" || !lease.committed) return;
      if (lease.reason === undefined) throw new Bug("lease.releasing_without_reason");
      txn.drafts.push(
        makeDraft(core.deps.ids, {
          threadId: thread.threadId,
          kind: "lease.released",
          payload: { leaseId: lease.leaseId, scopeId: lease.scopeId, reason: lease.reason },
          turnId: txn.signal.turnId,
          stepId: txn.signal.stepId,
        }),
      );
      txn.releasing.push(lease);
    },
    grant(thread, txn) {
      if (thread.lease !== null || txn.grant !== null || txn.releasing.length > 0) return;
      const loop = core.ports.get(LoopPortKey);
      const records = core.ports.get(RecordCommitPortKey);
      const candidates = candidatesFor(thread, txn);
      if (candidates.length === 0) return;
      if (loop === undefined || records === undefined) {
        warnPortOnce(thread, loop === undefined ? "xeon.loop" : "xeon.session");
        return;
      }
      let chosen: ScopeRecord | undefined;
      const arbiter = core.ports.get(LeaseArbiterPortKey);
      if (arbiter !== undefined) {
        const picked = arbiter.choose(
          thread.threadId,
          candidates.map((record) => ({
            scopeId: record.id,
            extension: record.extension,
            loadIndex: record.loadIndex,
            defaultEnabled: record.def.defaultEnabled ?? record.manifest.defaultEnabled ?? true,
          })),
        );
        chosen = candidates.find((record) => record.id === picked);
      } else if (candidates.length === 1) {
        chosen = candidates[0];
      } else {
        const active = core.deps.settings.activeDriveGroup(thread.threadId);
        chosen = candidates.find((record) => record.id === active);
        if (chosen === undefined) {
          core.deps.report({
            level: "warning",
            code: "drive_conflict",
            message: `drive groups ${candidates.map((record) => record.id).join(", ")} are enabled; set x.primitives.activeDriveGroup`,
          });
        }
      }
      const generation = chosen?.generation;
      if (chosen === undefined || generation === null || generation === undefined) return;
      const drive = generation.drive;
      if (drive === null) return;
      const { limits, clamped } = effectiveLimits(
        core.deps.settings.driveDefaultLimits(thread.threadId),
        core.deps.settings.driveLimits(thread.threadId),
        drive.options.limits,
      );
      if (clamped.length > 0) {
        core.deps.report({
          level: "info",
          code: "drive_limits_clamped",
          scopeId: chosen.id,
          extension: chosen.extension,
          message: `drive limits ${clamped.join(", ")} were clamped to the ceiling x.primitives.driveLimits`,
        });
      }
      const draft = makeDraft(core.deps.ids, {
        threadId: thread.threadId,
        kind: "lease.acquired",
        payload: { leaseId: "", scopeId: chosen.id, limits },
        turnId: txn.signal.turnId,
        stepId: txn.signal.stepId,
      });
      // 임대 id는 부여 초안의 이벤트 id를 그대로 쓴다(불투명 문자열, 40자 이하)
      const leaseId = draft.id;
      txn.drafts.push({ ...draft, payload: { leaseId, scopeId: chosen.id, limits } });
      txn.grant = {
        leaseId,
        scopeId: chosen.id,
        threadId: thread.threadId,
        leaseEpoch: (thread.leaseEpochs.get(chosen.id) ?? 0) + 1,
        limits,
        used: { turns: 0, spawns: 0, tokens: 0 },
        status: "active",
        reason: undefined,
        abort: new AbortController(),
        idleStreak: 0,
        idleRev: null,
        lastBaseRev: null,
        running: false,
        wantInvoke: true,
        missed: false,
        committed: false,
      };
    },
    applyCommitted(thread, txn) {
      for (const lease of txn.releasing) {
        lease.status = "released";
        if (thread.lease === lease) thread.lease = null;
        if (lease.reason === "idle" || lease.reason === "budget") {
          thread.cooldown.set(lease.scopeId, stateService.revOf(thread.threadId, lease.scopeId));
        }
        core.notify({ kind: "lease", scopeId: lease.scopeId, threadId: thread.threadId });
      }
      const grant = txn.grant;
      if (grant !== null) {
        grant.committed = true;
        thread.lease = grant;
        thread.leaseEpochs.set(grant.scopeId, grant.leaseEpoch);
        core.notify({ kind: "lease", scopeId: grant.scopeId, threadId: thread.threadId });
      }
      // 반납이 커밋되면 같은 경계에서 못 한 다음 후보의 부여를 이어서 판단한다
      if (txn.releasing.length > 0) hooks.requestApply(thread.threadId);
    },
    onBoundary(thread, signal) {
      if (signal.kind === "turn_settled") thread.cooldown.clear();
      const lease = thread.lease;
      if (lease === null || lease.status !== "active" || !lease.committed) return;
      const record = core.scopes.get(lease.scopeId);
      if (record === undefined || record.generation?.open !== true) return;
      if (signal.kind === "step_end") return;
      if (lease.running) {
        lease.missed = true;
        return;
      }
      const changed = stateService.revOf(thread.threadId, lease.scopeId) !== lease.lastBaseRev;
      const due = lease.wantInvoke || signal.kind === "turn_settled" || changed;
      if (due && loopStatusIdle(thread.threadId)) start(thread, lease);
    },
  };
}
