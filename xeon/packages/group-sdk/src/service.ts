import type { ThreadId } from "@fresnel/contracts/conversation";
import type { DriveFrameView, GroupId, RegistrationId } from "@fresnel/contracts/extensions";
import type { ExtHost, RegistrationInfo } from "@fresnel/ext-host";
import {
  GroupServiceName,
  type DriveRole,
  type GroupError,
  type GroupMetricsSummary,
  type GroupService,
  type GroupStatus,
} from "@fresnel/contracts/services";
import { gatherPromotionInput, type PromotionHostView } from "./promotion/gather.ts";
import { buildPromotionReport, type PromotionReport } from "./promotion/report.ts";
import { defaultMetricsRegistry } from "./metrics/registry.ts";
import { summarizeUsage, type ScopeUsage } from "./metrics/usage.ts";
import type { GroupCatalogEntry, GroupCatalogPort } from "./ports/catalog.ts";
import { orchestrationOf } from "./util.ts";

export { GroupServiceName };

/** 서비스가 ExtHost에서 읽는 부분. 시험에서는 테스트 호스트의 `host`를 그대로 넘긴다 */
export type GroupHostView = Pick<
  ExtHost,
  "registrations" | "leaseOf" | "driveFrames" | "queryEvents" | "toolOwner"
>;

export interface GroupServiceDeps {
  readonly host: GroupHostView;
  /**
   * 승격 집계가 쓰는 도구 주인 조회: 대화가 보는 이름으로 찾는다. 도구 이름은 대화마다 정해지므로 같은 이름이 여러 주인에게 있을 수 있다.
   * 없으면 이름만으로 찾는 `host.toolOwner`를 쓴다(이름이 대화마다 다르지 않은 조립)
   */
  readonly toolOwnerIn?: PromotionHostView["toolOwnerIn"];
  readonly catalog: GroupCatalogPort;
  /**
   * 서비스가 상태를 보여 줄 thread. 서비스 한 인스턴스는 활성 thread 하나의 그룹 상태를 보인다
   * (L3.group-sdk.spec §3.8 [가정]). 없으면 null
   */
  readonly currentThread: () => ThreadId | null;
  /** l3.group-sdk.instrumentation 값. 기본 true */
  readonly instrumentation?: () => boolean;
  /**
   * 그룹 계측 요약을 바꿔 넣는다. 없으면 기본 등록부(`defaultMetricsRegistry`)의 카운터와 `refreshUsage`로 캐시한 이벤트 집계를 합친다.
   * 등록되지 않은 그룹은 null이다.
   */
  readonly metrics?: (id: GroupId) => GroupMetricsSummary | null;
  /**
   * 승격 집계(L3.group-sdk.spec §3.12). 없으면 현재 thread의 이벤트로 `gatherPromotionInput`과
   * `buildPromotionReport`를 돌린다. 현재 thread가 없으면 빈 보고다.
   */
  readonly promotion?: () => Promise<PromotionReport>;
}

/** createGroupService가 돌려주는 서비스. 상태를 보일 thread를 알려 주고 그 thread의 이벤트 집계를 갱신한다 */
export interface GroupServiceWithUsage extends GroupService {
  /** 상태를 보이는 thread. 없으면 null */
  currentThread(): ThreadId | null;
  /** thread의 `lease.*`·`turn.*` 이벤트로 임대 시간과 비용 캐시를 다시 셈한다. 조회가 실패하면 캐시를 그대로 둔다 */
  refreshUsage(threadId: ThreadId): Promise<void>;
  /** 현재 thread의 승격 집계(L3.group-sdk.spec §3.12) */
  promotionReport(): Promise<PromotionReport>;
}

/** 활성 thread 하나의 이벤트 집계. `refreshUsage`가 채운다 */
interface UsageCache {
  readonly threadId: ThreadId;
  readonly byScope: ReadonlyMap<RegistrationId, ScopeUsage>;
}

const STATE_INVALID_CODES: ReadonlySet<string> = new Set(["state_schema", "state_too_large"]);
const MIGRATION_CODES: ReadonlySet<string> = new Set([
  "state_migration_missing",
  "state_migration_failed",
  "state_future_version",
]);

function errorOf(info: RegistrationInfo): GroupError | null {
  if (info.lastError === undefined) return null;
  const { code, message } = info.lastError;
  if (info.drive === "error") return { kind: "group.driveThrew", message, atSeq: null };
  if (STATE_INVALID_CODES.has(code)) return { kind: "group.stateInvalid", message, atSeq: null };
  if (MIGRATION_CODES.has(code)) return { kind: "group.migrationFailed", message, atSeq: null };
  return { kind: "group.setupFailed", message, atSeq: null };
}

/**
 * 그룹의 drive 역할을 thread의 주도권 스택(`driveFrames`, drive-isolation.md 2.1·2.6)에서 읽는다. `at`은 그룹 프레임의 스택 인덱스(없으면 -1)다.
 * 맨 위 프레임(주도 중이거나 질문 대기 중)은 `holder`, 그 아래 프레임(맡기고 기다리는 중)은 `waiting`이다.
 * 스택에 없으면 `none`이다. drive 오류는 `error`다.
 */
function driveRoleOf(
  entry: GroupCatalogEntry,
  info: RegistrationInfo | undefined,
  frames: readonly DriveFrameView[],
  at: number,
): DriveRole {
  if (orchestrationOf(entry.manifest)?.drives !== true || info === undefined) return "none";
  if (info.status !== "enabled" && info.status !== "disabling") return "none";
  if (info.drive === "error") return "error";
  if (at < 0) return "none";
  return at === frames.length - 1 ? "holder" : "waiting";
}

/**
 * `fresnel.groups` 서비스 구현(L3.group-sdk.spec §3.8). 그룹 목록과 상태를 낸다.
 * 상태는 `ExtHost.registrations()`·`driveFrames()`를 부를 때마다 새로 읽는다. 따로 쌓아 두는 사본이 없다.
 */
export function createGroupService(deps: GroupServiceDeps): GroupServiceWithUsage {
  let usage: UsageCache | undefined;

  /**
   * 기본 계측 요약: 카운터(등록부)에 캐시한 이벤트 집계를 더한다. 토큰과 비용은 이벤트 집계(`turn.completed`와 `agent.settled`) 하나에서 오고(카운터 `addUsage`는 더하지 않는다)
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
      costUsd: cached?.costUsd ?? 0,
      leaseMs: cached?.leaseMs ?? 0,
    };
  }

  /** 현재 thread의 주도권 스택. thread가 없으면 빈 스택이다 */
  function framesOf(thread: ThreadId | null): readonly DriveFrameView[] {
    return thread === null ? [] : deps.host.driveFrames(thread);
  }

  function statusOf(entry: GroupCatalogEntry): GroupStatus {
    const id = entry.manifest.name;
    const info = deps.host.registrations().find((scope) => scope.id === id);
    const thread = deps.currentThread();
    const frames = framesOf(thread);
    // 그룹의 프레임은 플러그인 이름으로 찾는다(DriveFrameView.plugin = scope의 확장 이름)
    const at =
      info === undefined ? -1 : frames.findIndex((frame) => frame.plugin === info.extension);
    const frame = at < 0 ? undefined : frames[at];
    const scope = info?.status ?? "disabled";
    const instrumented = deps.instrumentation?.() ?? true;
    return {
      id,
      displayName: entry.manifest.displayName ?? id,
      scope,
      pendingToggle: scope === "enabling" ? "enable" : scope === "disabling" ? "disable" : null,
      usesDrive: orchestrationOf(entry.manifest)?.drives === true,
      drive: driveRoleOf(entry, info, frames, at),
      leaseId: frame?.leaseId ?? null,
      lastError: info === undefined ? null : errorOf(info),
      recordKinds: (orchestrationOf(entry.manifest)?.recordKinds ?? []).map((decl) => decl.kind),
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

  /** 현재 thread의 이벤트로 승격 보고를 만든다. thread가 없으면 빈 입력이다 */
  async function defaultPromotion(): Promise<PromotionReport> {
    const thread = deps.currentThread();
    const input = await gatherPromotionInput(
      {
        registrations: () => deps.host.registrations(),
        queryEvents: (threadId, query) => deps.host.queryEvents(threadId, query),
        toolOwnerIn: deps.toolOwnerIn ?? ((name) => deps.host.toolOwner(name)),
      },
      thread === null ? [] : [thread],
    );
    return buildPromotionReport(input);
  }

  return {
    list,
    currentThread: () => deps.currentThread(),
    promotionReport: () => (deps.promotion ?? defaultPromotion)(),
    async refreshUsage(threadId) {
      const leases = await deps.host.queryEvents(threadId, { kindPrefix: "lease." });
      const turns = await deps.host.queryEvents(threadId, { kindPrefix: "turn." });
      const agents = await deps.host.queryEvents(threadId, { kindPrefix: "agent." });
      // 조회가 실패하면 캐시를 그대로 둔다. 이전 값이 남고 상태 조회는 실패하지 않는다
      if (!leases.ok || !turns.ok || !agents.ok) return;
      const ordered = [...leases.value, ...turns.value, ...agents.value].toSorted(
        (a, b) => a.seq - b.seq,
      );
      usage = { threadId, byScope: summarizeUsage(ordered) };
    },
  };
}
