// 메트릭 화면의 원천. 실제 엔진에서 칸마다 따로 읽는다(한 칸이 늦거나 실패해도 나머지는 보인다, craft-flows 화면 10.1).
// 화면은 이 모양(`MetricsData`)만 보고 그린다. 개발 빌드의 표본 장면(`sample.ts`)도 같은 모양을 만든다.
import { detach, err, ok, rethrow, type Result } from "@fresnel/contracts";
import type {
  EvidenceRef,
  Finding,
  FindingsListResult,
  MetricDef,
  MetricsQueryResult,
  Profile,
} from "@fresnel/contracts/wire";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLinkPhase, useThreadSummaries } from "../../../state/engine/index.ts";
import { useShellActions } from "../../../state/shell/index.ts";
import { useOpenTestChat } from "../test-chat/use-test-chat.ts";
import { useCommands, type CommandError } from "../../commands.ts";
import { perfViewOf, type PerfTurnInput } from "@fresnel/client/workbench";
import { tabLinkOf } from "../../workbench/tab-read.ts";
import { openTrace } from "../trace/target.ts";
import {
  BLOCK_TIME_METRICS,
  COMPARE_METRICS,
  CURVE_TURNS_MAX,
  DAILY_CONTEXT_METRICS,
  DAILY_METRICS,
  DEFAULT_FILTER,
  EMPTY_PROMOTION,
  PLUGIN_METRICS,
  PREVIOUS_TURN_METRIC,
  PROMOTION_THREADS_MAX,
  RECENT_FIRST_PAGE,
  RECENT_PAGE,
  briefOfRecord,
  curveThreadOf,
  metricFilterOf,
  metricIdsOf,
  periodTotalsOf,
  previousWindowOf,
  recentParamsOf,
  type MetricsFilter,
  type PeriodTotals,
  type PromotionReport,
  type RecentTurn,
  type TurnBrief,
  type TurnCurve,
} from "./model.ts";

export type Link = ReturnType<typeof tabLinkOf>;

/**
 * 칸 하나의 읽기 상태.
 * - `unsupported`: 연결된 엔진에 메서드가 없다(엔진 미준비, 화면 10.3). 가짜 값 대신 "아직 없어요"를 보인다
 * - `offline`: 연결이 없고 읽은 값도 없다. 읽은 값이 있으면 `ready`에 `stale`로 남긴다
 */
export type Load<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "offline" }
  | { readonly kind: "unsupported" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly value: T; readonly stale: boolean };

export interface PluginVersionRow {
  readonly hash: string;
  readonly approvedAt: string;
  readonly current: boolean;
}

export interface MetricsActions {
  readonly reload: () => void;
  readonly dismiss: (findingId: string) => Promise<Result<null, CommandError>>;
  /** 근거를 들고 테스트 챗을 연다(고치기, 막기로 올리기) */
  readonly openFix: (finding: Finding) => Promise<Result<null, CommandError>>;
  /** `withDependents`가 참이면 이 플러그인에 꼭 기대는 것도 같이 뺀다(AGE-33) */
  readonly removeFromProfile: (
    profile: Profile,
    plugin: string,
    withDependents?: boolean,
  ) => Promise<Result<null, CommandError>>;
  readonly openTurn: (ref: EvidenceRef) => void;
  readonly evidence: (
    findingId: string,
    cursor: string | null,
  ) => Promise<
    Result<{ readonly items: EvidenceRef[]; readonly next: string | null }, CommandError>
  >;
  /**
   * 최근 턴 한 쪽(`turnRecord.recent`). 지금 거르기(기간·프로필·테스트 기록·플러그인)를 따르고, `day`가 있으면 그 UTC 하루만 읽는다.
   * 첫 쪽은 `cursor` null이다
   */
  readonly recentPage: (
    day: string | null,
    cursor: string | null,
  ) => Promise<Result<RecentPage, CommandError>>;
  /** 턴 하나의 줄 값(근거 턴 줄). 엔진에 턴 id로 거르는 목록이 없어 턴 기록 하나를 읽어 뽑는다. 기록이 없으면 null */
  readonly turnBrief: (
    threadId: string,
    turnId: string,
  ) => Promise<Result<TurnBrief | null, CommandError>>;
  readonly versions: (plugin: string) => Promise<Result<readonly PluginVersionRow[], CommandError>>;
  readonly compare: (
    plugin: string,
    a: string,
    b: string,
  ) => Promise<Result<MetricsQueryResult, CommandError>>;
}

/** 최근 턴 한 쪽. `next`가 null이면 마지막 쪽이다 */
interface RecentPage {
  readonly items: readonly RecentTurn[];
  readonly next: string | null;
}

/**
 * 기간의 최근 턴 첫 쪽(플러그인 좁히기 없이, 200개까지). 머리 숫자와 날별 결정이 턴 요약의 합을 쓸 때와 "최근 턴" 목록의 첫 쪽이 이것이다
 */
export interface RecentTurns {
  readonly turns: readonly RecentTurn[];
  readonly next: string | null;
}

export interface MetricsData {
  readonly link: Link;
  readonly filter: MetricsFilter;
  readonly setFilter: (next: MetricsFilter) => void;
  readonly profiles: Load<readonly Profile[]>;
  readonly catalog: Load<ReadonlyMap<string, MetricDef>>;
  readonly plugins: Load<MetricsQueryResult>;
  readonly blocks: Load<MetricsQueryResult>;
  readonly daily: Load<MetricsQueryResult>;
  /** 플러그인을 좁혀 볼 때 그 플러그인의 날별 Hook 결정. 좁히지 않으면 null */
  readonly focusDaily: Load<MetricsQueryResult> | null;
  readonly findings: Load<FindingsListResult>;
  readonly dismissed: Load<FindingsListResult>;
  readonly recent: Load<RecentTurns>;
  /** 턴 번호 곡선: 기간에 턴이 가장 많은 대화의 최근 턴(`CURVE_TURNS_MAX`개)을 `measure.turn`으로 읽는다 */
  readonly curve: Load<TurnCurve>;
  /** 같이 쓰는 도구 후보(승격 보고). 최근 턴이 든 대화들로 읽는다 */
  readonly promotion: Load<PromotionReport>;
  /** 날 × 플러그인의 컨텍스트(`groupBy day, plugin`). 머리 숫자의 컨텍스트 흐름이 쓴다 */
  readonly dailyContext: Load<MetricsQueryResult>;
  /** 지난 기간(지금 기간 바로 앞의 같은 길이)의 머리 숫자. 보존 기간 밖이면 값이 null이다 */
  readonly previous: Load<PeriodTotals>;
  /** 대화 제목(근거 턴 줄). 모르는 대화면 null */
  readonly threadTitle: (threadId: string) => string | null;
  /** 엔진의 최소 표본 수. 못 읽으면 null */
  readonly minSample: number | null;
  readonly actions: MetricsActions;
}

interface Slot<T> {
  readonly key: string;
  readonly result: Result<T, CommandError>;
}

/** 읽은 결과와 연결 상태로 칸의 상태를 정한다. 키가 다르면 다른 거르기의 값이라 쓰지 않는다 */
export function loadOf<T>(slot: Slot<T> | null, key: string, link: Link): Load<T> {
  const mine = slot !== null && slot.key === key ? slot.result : null;
  if (mine !== null && mine.ok) return { kind: "ready", value: mine.value, stale: link !== "live" };
  if (link === "offline") return { kind: "offline" };
  if (mine === null || link === "pending") return { kind: "loading" };
  return mine.error.kind === "unsupported" ? { kind: "unsupported" } : { kind: "error" };
}

/** 연결이 살아 있을 때 `key`가 바뀌면 읽는다. `nonce`가 바뀌면 다시 읽는다 */
function useRead<T>(
  key: string,
  link: Link,
  nonce: number,
  load: () => Promise<Result<T, CommandError>>,
): Load<T> {
  const [slot, setSlot] = useState<Slot<T> | null>(null);
  useEffect(() => {
    if (link !== "live") return undefined;
    let active = true;
    const run = async (): Promise<void> => {
      const result = await load();
      if (active) setSlot({ key, result });
    };
    detach(run(), rethrow);
    return () => {
      active = false;
    };
    // `load`는 `key`가 정한다(같은 키에 같은 읽기를 준다)
  }, [key, link, nonce]);
  return loadOf(slot, key, link);
}

/** 실제 엔진의 메트릭 원천 */
export function useMetricsSource(): MetricsData {
  const commands = useCommands();
  const shell = useShellActions();
  const openTestChat = useOpenTestChat();
  const link = tabLinkOf(useLinkPhase());
  const [filter, setFilter] = useState<MetricsFilter>(DEFAULT_FILTER);
  const threads = useThreadSummaries();
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);
  // 플러그인 좁히기는 턴 전체 값(표, 블록별 시간, 턴 수, 인사이트 읽기)을 다시 읽지 않는다
  const filterKey = JSON.stringify({ ...filter, plugin: null });
  const wireFilter = metricFilterOf(filter);
  const m = commands.craftMetrics;

  const profiles = useRead("profiles", link, nonce, async () => {
    const got = await m.profiles();
    return got.ok ? ok(got.value.profiles) : got;
  });
  const catalog = useRead("catalog", link, nonce, async () => {
    const got = await m.catalog();
    return got.ok ? ok(new Map(got.value.metrics.map((d) => [d.id, d]))) : got;
  });
  const plugins = useRead(`plugins:${filterKey}`, link, nonce, () =>
    m.query({ metrics: metricIdsOf(PLUGIN_METRICS), filter: wireFilter, groupBy: ["plugin"] }),
  );
  const blocks = useRead(`blocks:${filterKey}`, link, nonce, () =>
    m.query({ metrics: metricIdsOf(BLOCK_TIME_METRICS), filter: wireFilter }),
  );
  const daily = useRead(`daily:${filterKey}`, link, nonce, () =>
    m.query({ metrics: metricIdsOf(DAILY_METRICS), filter: wireFilter, groupBy: ["day"] }),
  );
  const focusKey = `focus:${JSON.stringify(filter)}`;
  const focusLoad = useRead(focusKey, link, nonce, () =>
    filter.plugin === null
      ? Promise.resolve(err<CommandError>({ kind: "unsupported" }))
      : m.query({
          metrics: metricIdsOf(DAILY_METRICS),
          filter: metricFilterOf(filter, true),
          groupBy: ["day"],
        }),
  );
  const focusDaily = filter.plugin === null ? null : focusLoad;
  const minSampleLoad = useRead("minSample", link, nonce, () => m.minSample());
  const minSample = minSampleLoad.kind === "ready" ? minSampleLoad.value : null;

  // 지난 기간: 지금 기간 바로 앞의 같은 길이. 머리 숫자의 "지난 기간보다"가 쓴다. 보존 기간 밖이면 엔진이 값을 주지 않는다
  const [now] = useState(() => Date.now());
  const previous = useRead(`previous:${filterKey}`, link, nonce, async () => {
    const period = previousWindowOf(filter.days, now);
    const prevFilter = { ...wireFilter, period };
    const [prevPlugins, prevBlocks] = await Promise.all([
      m.query({ metrics: metricIdsOf(PLUGIN_METRICS), filter: prevFilter, groupBy: ["plugin"] }),
      m.query({ metrics: [PREVIOUS_TURN_METRIC], filter: prevFilter }),
    ]);
    if (!prevPlugins.ok) return prevPlugins;
    if (!prevBlocks.ok) return prevBlocks;
    return ok(periodTotalsOf(prevPlugins.value, prevBlocks.value));
  });
  const dailyContext = useRead(`dailyContext:${filterKey}`, link, nonce, () =>
    m.query({
      metrics: metricIdsOf(DAILY_CONTEXT_METRICS),
      filter: wireFilter,
      groupBy: ["day", "plugin"],
    }),
  );

  // 최근 턴의 첫 쪽(`turnRecord.recent`). 키에 가장 최근에 움직인 대화의 마지막 턴과 움직인 시각을 넣어,
  // 새 턴이 생기거나 도는 턴이 끝날 때만 다시 읽는다(쉬는 화면은 읽지 않는다)
  const latest = threads.reduce<(typeof threads)[number] | null>(
    (best, th) => (best === null || th.updatedAt > best.updatedAt ? th : best),
    null,
  );
  const titles = new Map<string, string | null>(threads.map((th) => [th.threadId, th.title]));
  const recentKey = `recent:${filterKey}:${latest === null ? "" : `${latest.threadId}@${latest.lastTurnId ?? ""}@${latest.updatedAt}`}`;
  const recent = useRead(recentKey, link, nonce, async () => {
    const got = await m.recent({
      ...recentParamsOf(filter, now, null, false),
      limit: RECENT_FIRST_PAGE,
    });
    return got.ok ? ok({ turns: got.value.items, next: got.value.next }) : got;
  });

  // 턴 번호 곡선: 최근 첫 쪽에서 고른 대화의 턴 목록이 키다. 목록이 바뀔 때만 턴을 다시 읽는다.
  // 최근 턴을 아직 못 읽었으면(로딩·실패) 곡선도 같은 상태다
  const pick = recent.kind === "ready" ? curveThreadOf(recent.value.turns, CURVE_TURNS_MAX) : null;
  const curveKey =
    pick === null ? "curve:none" : `curve:${pick.threadId}:${pick.turnIds.join(",")}`;
  const curveRead = useRead(
    curveKey,
    link,
    nonce,
    async (): Promise<Result<TurnCurve, CommandError>> => {
      if (pick === null) return ok({ kind: "none" });
      const got = await Promise.all(
        pick.turnIds.map((turnId) => commands.measure.turn(pick.threadId, turnId)),
      );
      // 번호는 읽은 턴 안의 차례다(`perfViewOf`가 주는 그대로). 읽지 못한 턴은 빼고 잇는다
      const read: PerfTurnInput[] = [];
      got.forEach((result, index) => {
        const turnId = pick.turnIds[index];
        if (result.ok && turnId !== undefined) read.push({ turnId, result: result.value });
      });
      const failed = got.flatMap((result) => (result.ok ? [] : [result.error]));
      const firstError = failed[0];
      if (read.length === 0 && firstError !== undefined) return err(firstError);
      const state = perfViewOf([], read);
      if (state.kind === "off") return ok({ kind: "off" });
      if (state.kind === "empty") return ok({ kind: "none" });
      return ok({
        kind: "ready",
        threadId: pick.threadId,
        title: pick.title,
        capped: pick.capped,
        points: state.view.curve,
      });
    },
  );
  const curve: Load<TurnCurve> = recent.kind === "ready" ? curveRead : recent;

  // 같이 쓰는 도구: 최근 첫 쪽의 대화 id(중복 없이, 상한까지)로 승격 보고를 읽는다. 대화가 없으면 엔진을 부르지 않는다
  const threadIds =
    recent.kind === "ready"
      ? [...new Set(recent.value.turns.map((r) => r.turn.threadId))].slice(0, PROMOTION_THREADS_MAX)
      : null;
  const promotionKey = threadIds === null ? "promotion:none" : `promotion:${threadIds.join(",")}`;
  const promotionRead = useRead(
    promotionKey,
    link,
    nonce,
    async (): Promise<Result<PromotionReport, CommandError>> => {
      if (threadIds === null || threadIds.length === 0) return ok(EMPTY_PROMOTION);
      return commands.measure.promotion(threadIds);
    },
  );
  const promotion: Load<PromotionReport> = recent.kind === "ready" ? promotionRead : recent;

  const findingParams = {
    period: { days: filter.days },
    ...(filter.profileId === null ? {} : { profileId: filter.profileId }),
  };
  const findings = useRead(`findings:${filterKey}`, link, nonce, () =>
    m.findings({ ...findingParams, state: "open" }),
  );
  const dismissed = useRead(`dismissed:${filterKey}`, link, nonce, () =>
    m.findings({ ...findingParams, state: "dismissed" }),
  );

  const actions = useMemo<MetricsActions>(
    () => ({
      reload,
      dismiss: async (findingId) => {
        const done = await m.dismiss(findingId, null);
        if (done.ok) reload();
        return done;
      },
      // 근거를 들고 Craft의 테스트 챗 창(C7)을 연다. 창은 메트릭 위에 뜨고 화면을 옮기지 않는다
      openFix: (finding) =>
        openTestChat({
          plugin: finding.subject.plugin,
          reuse: "last",
          context: [{ kind: "finding", findingId: finding.id }],
        }),
      removeFromProfile: async (profile, plugin, withDependents) => {
        const removed = await m.removeFromProfile(profile.id, plugin, profile.rev, withDependents);
        if (!removed.ok) return removed;
        reload();
        return ok(null);
      },
      openTurn: (ref) => {
        if (ref.kind === "backtest") return;
        openTrace({ threadId: ref.threadId, turnId: ref.turnId, from: "metrics" });
        shell.updatePlace({ screen: "trace", scroll: 0 });
      },
      evidence: async (findingId, cursor) => {
        const got = await m.evidence(findingId, cursor);
        return got.ok ? ok({ items: got.value.items, next: got.value.next }) : got;
      },
      recentPage: async (day, cursor) => {
        const got = await m.recent({
          ...recentParamsOf(filter, now, day, true),
          limit: RECENT_PAGE,
          ...(cursor === null ? {} : { cursor }),
        });
        return got.ok ? ok({ items: got.value.items, next: got.value.next }) : got;
      },
      turnBrief: async (threadId, turnId) => {
        const got = await m.turn(threadId, turnId);
        if (!got.ok) return got;
        return ok(got.value.record === null ? null : briefOfRecord(got.value.record));
      },
      versions: async (plugin) => {
        const got = await m.plugin(plugin);
        return got.ok ? ok(got.value.versions) : got;
      },
      compare: async (plugin, a, b) => {
        if (a === b) return err({ kind: "rejected", code: null });
        return m.query({
          metrics: [...COMPARE_METRICS],
          filter: { ...metricFilterOf(filter), plugin },
          compare: { by: "pluginVersion", a, b },
        });
      },
    }),
    [commands, m, shell, reload, filter, now, openTestChat],
  );

  return {
    link,
    filter,
    setFilter,
    profiles,
    catalog,
    plugins,
    blocks,
    daily,
    focusDaily,
    findings,
    dismissed,
    recent,
    curve,
    promotion,
    dailyContext,
    previous,
    threadTitle: (threadId) => titles.get(threadId) ?? null,
    minSample,
    actions,
  };
}
