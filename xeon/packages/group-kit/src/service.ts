import { assertNever } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import {
  LoopPortKey,
  type GroupId,
  type LeaseArbiterPort,
  type ScopeId,
  type Unsubscribe,
} from "@xeon/contracts/extensions";
import { SessionFeedPortKey, type ExtHost, type ScopeInfo } from "@xeon/ext-host";
import {
  GroupServiceName,
  type DriveHolderSetting,
  type DriveRole,
  type GroupCommandError,
  type GroupError,
  type GroupMetricsSummary,
  type GroupResult,
  type GroupStatus,
  type HolderReceipt,
  type ToggleReceipt,
} from "@xeon/contracts/services";
import { defaultDriveArbiter, leaseArbiterPort, type DriveArbiter } from "./arbiter.ts";
import type { GroupResetError, GroupServiceWithUsage } from "./commands.ts";
import { gatherPromotionInput } from "./promotion/gather.ts";
import { buildPromotionReport, type PromotionReport } from "./promotion/report.ts";
import { defaultMetricsRegistry } from "./metrics/registry.ts";
import { summarizeUsage, type ScopeUsage } from "./metrics/usage.ts";
import { createLeaseRejections } from "./lease-rejections.ts";
import type { GroupCatalogEntry, GroupCatalogPort } from "./ports/catalog.ts";
import type {
  DriveHolderSettingsPort,
  HolderSettingScope,
  HolderWriteError,
} from "./ports/holder.ts";

export { GroupServiceName };

/** 서비스가 ExtHost에서 읽는 부분. 시험에서는 테스트 호스트의 `host`를 그대로 넘긴다 */
export type GroupHostView = Pick<
  ExtHost,
  | "scopes"
  | "scope"
  | "leaseOf"
  | "onChange"
  | "ports"
  | "queryEvents"
  | "toolOwner"
  | "resetScopeState"
>;

export interface GroupServiceDeps {
  readonly host: GroupHostView;
  readonly catalog: GroupCatalogPort;
  readonly holder: DriveHolderSettingsPort;
  /**
   * 서비스가 상태를 보여 줄 thread. 서비스 한 인스턴스는 활성 thread 하나의 그룹 상태를 보인다
   * (L3.group-kit.spec §3.8 [가정]). 없으면 null
   */
  readonly currentThread: () => ThreadId | null;
  /** onChange 구독자가 던진 값을 받는다. 기록하거나 알리는 일을 해야 한다(TY-25) */
  readonly report: (cause: unknown) => void;
  readonly arbiter?: DriveArbiter;
  /** l3.group-kit.instrumentation 값. 기본 true */
  readonly instrumentation?: () => boolean;
  /**
   * 그룹 계측 요약을 바꿔 넣는다. 없으면 기본 등록부(`defaultMetricsRegistry`)의 카운터와 `refreshUsage`로 캐시한 이벤트 집계를 합친다.
   * 등록되지 않은 그룹은 null이다.
   */
  readonly metrics?: (id: GroupId) => GroupMetricsSummary | null;
  /**
   * 승격 집계(L3.group-kit.spec §3.12). `/group status`가 후보 줄을 낼 때 부른다. 없으면 현재 thread의 이벤트로 `gatherPromotionInput`과
   * `buildPromotionReport`를 돌린다. 현재 thread가 없으면 빈 보고다.
   */
  readonly promotion?: () => Promise<PromotionReport>;
}

/** 활성 thread 하나의 이벤트 집계. `refreshUsage`가 채운다 */
interface UsageCache {
  readonly threadId: ThreadId;
  readonly byScope: ReadonlyMap<ScopeId, ScopeUsage>;
}

const STATE_INVALID_CODES: ReadonlySet<string> = new Set(["state_schema", "state_too_large"]);
const MIGRATION_CODES: ReadonlySet<string> = new Set([
  "state_migration_missing",
  "state_migration_failed",
  "state_future_version",
]);

function errorOf(info: ScopeInfo): GroupError | null {
  if (info.lastError === undefined) return null;
  const { code, message } = info.lastError;
  if (info.drive === "error") return { kind: "group.driveThrew", message, atSeq: null };
  if (STATE_INVALID_CODES.has(code)) return { kind: "group.stateInvalid", message, atSeq: null };
  if (MIGRATION_CODES.has(code)) return { kind: "group.migrationFailed", message, atSeq: null };
  return { kind: "group.setupFailed", message, atSeq: null };
}

function driveRoleOf(
  entry: GroupCatalogEntry,
  info: ScopeInfo | undefined,
  rejected: boolean,
): DriveRole {
  if (!entry.manifest.usesDrive || info === undefined) return "none";
  if (info.status !== "enabled" && info.status !== "disabling") return "none";
  switch (info.drive) {
    case "holding":
      return "holder";
    case "error":
      return "error";
    case "registered":
      return rejected ? "rejected" : "waiting";
    case "none":
      return "none";
    default:
      return assertNever(info.drive, "ScopeInfo.drive");
  }
}

/**
 * `xeon.groups` 서비스 구현(L3.group-kit.spec §3.8). X `LeaseArbiterPort.choose`와 그룹 목록·전환·구동 그룹 선택을 한 객체로 낸다.
 * 상태는 `ExtHost.scopes()`·`leaseOf()`를 부를 때마다 새로 읽는다. 따로 쌓아 두는 사본이 없다.
 */
/** 설정 쓰기 실패를 서비스 오류로 옮긴다. 관리 범위의 잠금만 `group.settingLocked`고 나머지는 이유를 그대로 싣는다 */
function groupErrorOf(error: HolderWriteError): GroupCommandError {
  switch (error.kind) {
    case "locked":
      return { kind: "group.settingLocked", key: error.key };
    case "unwritable":
      return { kind: "group.settingUnwritable", key: error.key, reason: error.reason };
    default:
      return assertNever(error, "HolderWriteError");
  }
}

export function createGroupService(deps: GroupServiceDeps): GroupServiceWithUsage {
  const arbiter = deps.arbiter ?? defaultDriveArbiter;
  const port: LeaseArbiterPort = leaseArbiterPort(arbiter, {
    holderSetting: (threadId) => deps.holder.read(threadId),
  });
  const listeners = new Set<(groups: readonly GroupStatus[]) => void>();
  let hostSubscription: Unsubscribe | undefined;
  let scheduled = false;
  const rejections = createLeaseRejections();
  let usage: UsageCache | undefined;

  /**
   * 기본 계측 요약: 카운터(등록부)에 캐시한 이벤트 집계를 더한다. 비용은 카운터 `addUsage`와 `turn.completed`의 합이고
   * 임대 시간은 `lease.*`에서 온다. 캐시는 그 thread를 `refreshUsage`로 갱신했을 때만 있다.
   */
  function summaryOf(id: GroupId, thread: ThreadId | null): GroupMetricsSummary | null {
    if (deps.metrics !== undefined) return deps.metrics(id);
    const handle = defaultMetricsRegistry.get(id);
    if (handle === undefined) return null;
    const counted = handle.snapshot();
    const cached =
      thread !== null && usage?.threadId === thread ? usage.byScope.get(id) : undefined;
    return {
      denies: counted.denies,
      posts: counted.posts,
      spawns: counted.spawns,
      delegates: counted.delegates,
      costUsd: counted.costUsd + (cached?.costUsd ?? 0),
      leaseMs: cached?.leaseMs ?? 0,
    };
  }

  /** 커밋 피드 포트가 올라와 있으면 구독한다. 포트가 늦게 올라올 수 있어 읽을 때마다 확인한다 */
  function attachFeed(): void {
    const feed = deps.host.ports.get(SessionFeedPortKey);
    if (feed !== undefined) rejections.attach(feed, schedule);
  }

  function statusOf(entry: GroupCatalogEntry): GroupStatus {
    attachFeed();
    const id = entry.manifest.name;
    const info = deps.host.scopes().find((scope) => scope.id === id);
    const thread = deps.currentThread();
    const lease = thread === null ? null : deps.host.leaseOf(thread);
    const scope = info?.status ?? "disabled";
    const instrumented = deps.instrumentation?.() ?? true;
    return {
      id,
      displayName: entry.manifest.displayName ?? id,
      scope,
      pendingToggle: scope === "enabling" ? "enable" : scope === "disabling" ? "disable" : null,
      usesDrive: entry.manifest.usesDrive,
      drive: driveRoleOf(entry, info, thread !== null && rejections.has(thread, id)),
      leaseId: lease !== null && lease.scopeId === id ? lease.leaseId : null,
      lastError: info === undefined ? null : errorOf(info),
      recordKinds: (entry.manifest.recordKinds ?? []).map((decl) => decl.kind),
      metrics: instrumented ? summaryOf(id, thread) : null,
    };
  }

  /** 정렬: holder, 켜진 그룹(로드 순서), 꺼진 그룹(이름순) */
  function list(): readonly GroupStatus[] {
    const ranked = deps.catalog.groups().map((entry) => ({ entry, status: statusOf(entry) }));
    const rank = (item: (typeof ranked)[number]): number => {
      if (item.status.drive === "holder") return 0;
      return item.status.scope === "enabled" || item.status.scope === "disabling" ? 1 : 2;
    };
    return ranked
      .toSorted((a, b) => {
        const byRank = rank(a) - rank(b);
        if (byRank !== 0) return byRank;
        return rank(a) === 2
          ? a.status.id.localeCompare(b.status.id)
          : a.entry.loadIndex - b.entry.loadIndex;
      })
      .map((item) => item.status);
  }

  function knownIds(): readonly GroupId[] {
    return deps.catalog.groups().map((entry) => entry.manifest.name);
  }

  function find(id: string): GroupCatalogEntry | undefined {
    return deps.catalog.groups().find((entry) => entry.manifest.name === id);
  }

  function turnRunning(): boolean {
    const thread = deps.currentThread();
    if (thread === null) return false;
    return deps.host.ports.get(LoopPortKey)?.status(thread) === "running";
  }

  function flush(): void {
    scheduled = false;
    if (listeners.size === 0) return;
    const groups = list();
    for (const listener of listeners) {
      try {
        listener(groups);
      } catch (cause) {
        deps.report(cause);
      }
    }
  }

  /** 같은 동기 구간의 변경은 구독자에게 한 번만 알린다 */
  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(flush);
  }

  function toggle(id: string, enabled: boolean): GroupResult<ToggleReceipt> {
    const handle = find(id) === undefined ? undefined : deps.host.scope(id);
    if (handle === undefined) {
      return { ok: false, error: { kind: "group.unknown", id, known: knownIds() } };
    }
    if (enabled) handle.enable();
    else handle.disable();
    schedule();
    return {
      ok: true,
      value: {
        id,
        status: handle.status,
        appliesAt: turnRunning() ? "nextStepBoundary" : "now",
      },
    };
  }

  /** 지정한 그룹이 X의 임대 후보인가: 켜져 있고 drive를 등록했고 오류 상태가 아니다 */
  function isCandidate(scopeId: ScopeId): boolean {
    const info = deps.host.scopes().find((scope) => scope.id === scopeId);
    return info !== undefined && info.status === "enabled" && info.drive === "registered";
  }

  function appliesAtOf(
    next: DriveHolderSetting,
    target: ThreadId | null,
  ): HolderReceipt["appliesAt"] {
    const thread = target ?? deps.currentThread();
    const lease = thread === null ? null : deps.host.leaseOf(thread);
    if (next === null) return "now";
    if (lease === null) return "nextStepBoundary";
    if (lease.scopeId === next) return "now";
    // X는 이름을 지정한 그룹이 후보이면 다음 경계에서 현재 임대를 revoked로 반납한다(X.primitives.spec §4.4.1 5번)
    return isCandidate(next) ? "nextStepBoundary" : "afterLeaseRelease";
  }

  /** 현재 thread의 이벤트로 승격 보고를 만든다. thread가 없으면 빈 입력이다 */
  async function defaultPromotion(): Promise<PromotionReport> {
    const thread = deps.currentThread();
    const input = await gatherPromotionInput(deps.host, thread === null ? [] : [thread]);
    return buildPromotionReport(input);
  }

  return {
    choose: (threadId, candidates) => port.choose(threadId, candidates),
    list,
    currentThread: () => deps.currentThread(),
    promotionReport: () => (deps.promotion ?? defaultPromotion)(),
    async resetState(id) {
      if (find(id) === undefined) {
        return { ok: false, error: { kind: "group.unknown", id, known: knownIds() } };
      }
      const thread = deps.currentThread();
      if (thread === null) return { ok: false, error: { kind: "group.noThread" } };
      const reset = await deps.host.resetScopeState(thread, id);
      if (reset.ok) {
        schedule();
        return { ok: true, value: reset.value };
      }
      const error: GroupResetError =
        reset.error.kind === "not_refused"
          ? { kind: "group.notResettable", id }
          : { kind: "group.resetFailed", id, message: reset.error.kind };
      return { ok: false, error };
    },
    async refreshUsage(threadId) {
      const leases = await deps.host.queryEvents(threadId, { kindPrefix: "lease." });
      const turns = await deps.host.queryEvents(threadId, { kindPrefix: "turn." });
      // 조회가 실패하면 캐시를 그대로 둔다. 이전 값이 남고 상태 조회는 실패하지 않는다
      if (!leases.ok || !turns.ok) return;
      const ordered = [...leases.value, ...turns.value].toSorted((a, b) => a.seq - b.seq);
      usage = { threadId, byScope: summarizeUsage(ordered) };
    },
    status(id) {
      const entry = find(id);
      if (entry === undefined) {
        return { ok: false, error: { kind: "group.unknown", id, known: knownIds() } };
      }
      return { ok: true, value: statusOf(entry) };
    },
    enable: (id) => toggle(id, true),
    disable: (id) => toggle(id, false),
    async setDriveHolder(holder, options) {
      const scope: HolderSettingScope = options?.scope ?? "session";
      const next: DriveHolderSetting = holder === "auto" ? null : holder;
      if (next !== null) {
        const entry = find(next);
        if (entry === undefined) {
          return { ok: false, error: { kind: "group.unknown", id: next, known: knownIds() } };
        }
        if (!entry.manifest.usesDrive) {
          return { ok: false, error: { kind: "group.noDrive", id: entry.manifest.name } };
        }
      }
      const target = options?.threadId ?? null;
      const appliesAt = appliesAtOf(next, target);
      const written = await deps.holder.write(next, scope, target);
      if (!written.ok) {
        return { ok: false, error: groupErrorOf(written.error) };
      }
      schedule();
      return { ok: true, value: { holder: next, scope, appliesAt } };
    },
    onChange(listener) {
      listeners.add(listener);
      hostSubscription ??= deps.host.onChange(schedule);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          hostSubscription?.();
          hostSubscription = undefined;
        }
      };
    },
    driveHolderSetting: () => deps.holder.read(deps.currentThread()),
  };
}
