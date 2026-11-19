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
import { useLinkPhase } from "../../../state/engine/index.ts";
import { useShellActions } from "../../../state/shell/index.ts";
import { useCommands, type CommandError } from "../../commands.ts";
import { tabLinkOf } from "../../workbench/tab-read.ts";
import { openTrace } from "../trace/target.ts";
import {
  BLOCK_TIME_METRICS,
  COMPARE_METRICS,
  DAILY_METRICS,
  PLUGIN_METRICS,
  metricFilterOf,
  metricIdsOf,
  type MetricsFilter,
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
  readonly removeFromProfile: (
    profile: Profile,
    plugin: string,
  ) => Promise<Result<null, CommandError>>;
  readonly openTurn: (ref: EvidenceRef) => void;
  readonly evidence: (
    findingId: string,
    cursor: string | null,
  ) => Promise<
    Result<{ readonly items: EvidenceRef[]; readonly next: string | null }, CommandError>
  >;
  readonly versions: (plugin: string) => Promise<Result<readonly PluginVersionRow[], CommandError>>;
  readonly compare: (
    plugin: string,
    a: string,
    b: string,
  ) => Promise<Result<MetricsQueryResult, CommandError>>;
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
  readonly findings: Load<FindingsListResult>;
  readonly dismissed: Load<FindingsListResult>;
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
  const link = tabLinkOf(useLinkPhase());
  const [filter, setFilter] = useState<MetricsFilter>({
    days: 7,
    profileId: null,
    includeTests: false,
  });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);
  const filterKey = JSON.stringify(filter);
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
      openFix: async (finding) => {
        const opened = await m.openCraftChat({
          plugin: finding.subject.plugin,
          reuse: "last",
          context: [{ kind: "finding", findingId: finding.id }],
        });
        if (!opened.ok) return opened;
        // 테스트 챗 창(C7)이 아직 없어 대화 영역에서 그 대화를 연다. 창이 생기면 이 자리만 바꾼다
        commands.selectThread(opened.value.threadId);
        shell.switchArea("chat");
        return ok(null);
      },
      removeFromProfile: async (profile, plugin) => {
        const removed = await m.removeFromProfile(profile.id, plugin, profile.rev);
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
    [commands, m, shell, reload, filter],
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
    findings,
    dismissed,
    actions,
  };
}
