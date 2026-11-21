// 메트릭 화면(C9)의 순수 모델. 엔진 값(`MetricValue`)을 칸으로 바꾸고, 플러그인 표·컨텍스트 분해·날별 흐름·인사이트 묶음을 만든다.
// 규칙: 엔진이 값을 주지 않은 칸(`unavailable`, 행 없음)은 0이 아니라 "아직 기록되지 않음"이고, 표본이 적은 칸은 "표본 부족"이다(M5d 규칙 39).
// 테스트 런과 테스트 챗의 기록은 기본 범위에서 빠진다(M5d §4.6 규칙 33). 사용자가 켤 때만 범위에 든다.
import type {
  EvidenceRef,
  Finding,
  TurnRecord,
  TurnSummary,
  MetricFilter,
  MetricReason,
  MetricRow,
  MetricValue,
  MetricsQueryResult,
  ScopeKind,
} from "@fresnel/contracts/wire";

// ───────── 거르기 ─────────

export const PERIODS = [1, 7, 30] as const;
export type PeriodDays = (typeof PERIODS)[number];

export interface MetricsFilter {
  readonly days: PeriodDays;
  /** null이면 모든 프로필 */
  readonly profileId: string | null;
  /** 참이면 테스트 런·드래프트 덧씌우기·테스트 챗의 기록도 넣는다 */
  readonly includeTests: boolean;
  /**
   * 좁혀 볼 플러그인. null이면 모든 플러그인. 플러그인 칸이 있는 값(컨텍스트, Hook 결정, 표, 인사이트)만 좁혀지고
   * 턴 수와 블록별 시간은 턴 전체의 값이다(엔진 카운터의 블록 칸에는 플러그인이 없다)
   */
  readonly plugin: string | null;
}

export const DEFAULT_FILTER: MetricsFilter = {
  days: 7,
  profileId: null,
  includeTests: false,
  plugin: null,
};

/** 일반 대화와 검토된 일회 덧씌우기. 엔진의 기본 범위와 같다 */
const LIVE_SCOPES: readonly ScopeKind[] = ["live", "overlay_reviewed"];
/** 테스트 기록까지 */
const ALL_SCOPES: readonly ScopeKind[] = [
  "live",
  "overlay_reviewed",
  "overlay_draft",
  "test",
  "craft",
];

export function isPeriod(value: number): value is PeriodDays {
  return PERIODS.some((p) => p === value);
}

/**
 * 화면의 거르기를 엔진의 거르기로 바꾼다. 범위는 늘 명시해 엔진 기본값이 바뀌어도 테스트 기록이 섞이지 않는다.
 * 플러그인 좁히기는 `withPlugin`이 참일 때만 싣는다(턴 수·블록별 시간은 턴 전체로 읽는다)
 */
export function metricFilterOf(filter: MetricsFilter, withPlugin = false): MetricFilter {
  return {
    period: { days: filter.days },
    scopes: [...(filter.includeTests ? ALL_SCOPES : LIVE_SCOPES)],
    ...(filter.profileId === null ? {} : { profileId: filter.profileId }),
    ...(withPlugin && filter.plugin !== null ? { plugin: filter.plugin } : {}),
  };
}

// ───────── 칸 ─────────

/**
 * 표의 칸 하나.
 * - `value`: 값이 있다. `approx`면 근사값이다
 * - `sample`: 표본이 적어 숫자를 내지 않는다(`n`은 지금 표본 수)
 * - `absent`: 엔진이 이 값을 주지 않는다. `reason`이 null이면 행 자체가 없다
 */
export type Cell =
  | { readonly kind: "value"; readonly value: number; readonly approx: boolean; readonly n: number }
  | { readonly kind: "sample"; readonly n: number }
  | { readonly kind: "absent"; readonly reason: MetricReason | null };

const ABSENT: Cell = { kind: "absent", reason: null };

export function cellOf(value: MetricValue | undefined): Cell {
  if (value === undefined) return ABSENT;
  if (value.state === "insufficient_sample") return { kind: "sample", n: value.n };
  if (value.state === "unavailable" || value.value === null) {
    return { kind: "absent", reason: value.reason ?? null };
  }
  return { kind: "value", value: value.value, approx: value.state === "approx", n: value.n };
}

/** 비율 값을 횟수로 되돌린다(값 × 분모). 분모가 없거나 값이 없으면 칸 그대로다 */
export function countCellOf(value: MetricValue | undefined): Cell {
  const cell = cellOf(value);
  if (cell.kind !== "value" || value?.denom === undefined) return cell;
  return { kind: "value", value: Math.round(cell.value * value.denom), approx: false, n: cell.n };
}

export function valueOf(cell: Cell): number | null {
  return cell.kind === "value" ? cell.value : null;
}

// ───────── 지표 묶음 ─────────

/** 플러그인 표가 읽는 지표(groupBy plugin) */
export const PLUGIN_METRICS = {
  always: "cost.always",
  drive: "cost.drive",
  onDemand: "cost.on_demand",
  hookRuns: "hook.runs",
  blocked: "hook.outcomes.blocked",
  asked: "hook.outcomes.asked",
  modified: "hook.outcomes.modified",
  fault: "hook.fault_rate",
  defied: "inst.defied_calls",
  calls: "tool.calls",
} as const;

/** 블록별 시간(턴 하나 평균, ms). 모델 호출 시간은 엔진이 아직 기록하지 않는다 */
export const BLOCK_TIME_METRICS = {
  total: "block.time_split",
  model: "block.time_split.model",
  tools: "block.time_split.tools",
  hook: "block.time_split.hook",
  ask: "block.time_split.ask",
  rest: "block.time_split.rest",
} as const;

/** 날별 흐름(groupBy day). 턴 수는 `block.time_split`의 표본 수다 */
export const DAILY_METRICS = {
  turns: "block.time_split",
  calls: "tool.calls",
  hookRuns: "hook.runs",
  blocked: "hook.outcomes.blocked",
  asked: "hook.outcomes.asked",
  modified: "hook.outcomes.modified",
} as const;

/** 버전 전후 비교가 나란히 놓는 지표 */
export const COMPARE_METRICS = [
  "hook.outcomes.blocked",
  "hook.outcomes.asked",
  "hook.fault_rate",
  "tool.error_rate",
  "cost.always",
] as const;
export type CompareMetric = (typeof COMPARE_METRICS)[number];

export function metricIdsOf(table: Readonly<Record<string, string>>): string[] {
  return [...new Set(Object.values(table))];
}

// ───────── 플러그인 표 ─────────

export interface PluginRow {
  readonly plugin: string;
  readonly always: Cell;
  readonly drive: Cell;
  readonly onDemand: Cell;
  /** 아는 컨텍스트 값의 합(토큰/턴). 셋 다 값이 없으면 null */
  readonly context: number | null;
  readonly hookRuns: Cell;
  readonly blocked: Cell;
  readonly asked: Cell;
  readonly modified: Cell;
  readonly fault: Cell;
  readonly defied: Cell;
  readonly calls: Cell;
}

function sumKnown(cells: readonly Cell[]): number | null {
  const known = cells.map(valueOf).filter((v): v is number => v !== null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
}

function pluginRowOf(plugin: string, values: MetricRow["values"]): PluginRow {
  const always = cellOf(values[PLUGIN_METRICS.always]);
  const drive = cellOf(values[PLUGIN_METRICS.drive]);
  const onDemand = cellOf(values[PLUGIN_METRICS.onDemand]);
  return {
    plugin,
    always,
    drive,
    onDemand,
    context: sumKnown([always, drive, onDemand]),
    hookRuns: cellOf(values[PLUGIN_METRICS.hookRuns]),
    blocked: countCellOf(values[PLUGIN_METRICS.blocked]),
    asked: countCellOf(values[PLUGIN_METRICS.asked]),
    modified: countCellOf(values[PLUGIN_METRICS.modified]),
    fault: cellOf(values[PLUGIN_METRICS.fault]),
    defied: cellOf(values[PLUGIN_METRICS.defied]),
    calls: cellOf(values[PLUGIN_METRICS.calls]),
  };
}

/** 플러그인 표의 행. 컨텍스트를 많이 쓰는 순, 같으면 Hook을 많이 돈 순, 그다음 이름 순이다 */
export function pluginRowsOf(result: MetricsQueryResult): PluginRow[] {
  const rows = result.rows
    .map((row) => ({ plugin: row.key.plugin ?? "", values: row.values }))
    .filter((row) => row.plugin !== "")
    .map((row) => pluginRowOf(row.plugin, row.values));
  return rows.toSorted(
    (a, b) =>
      (b.context ?? -1) - (a.context ?? -1) ||
      (valueOf(b.hookRuns) ?? -1) - (valueOf(a.hookRuns) ?? -1) ||
      a.plugin.localeCompare(b.plugin),
  );
}

/** 표에서 정렬할 수 있는 열 */
export type PluginSort = "context" | "blocked" | "asked" | "defied" | "calls";

export function sortPluginRows(rows: readonly PluginRow[], by: PluginSort): PluginRow[] {
  if (by === "context") return [...rows];
  const key = (row: PluginRow): number => valueOf(row[by]) ?? -1;
  return rows.toSorted((a, b) => key(b) - key(a) || a.plugin.localeCompare(b.plugin));
}

// ───────── 컨텍스트 분해 ─────────

/** 컨텍스트의 세 갈래: 늘 실림(지침, 도구 정의), Drive가 실음, 필요할 때 실림(스킬 본문) */
export const CONTEXT_PARTS = ["always", "drive", "onDemand"] as const;
export type ContextPart = (typeof CONTEXT_PARTS)[number];

export interface ContextSlice {
  readonly plugin: string;
  readonly parts: Readonly<Record<ContextPart, number>>;
  readonly total: number;
}

export interface ContextBreakdown {
  /** 값이 있는 플러그인. 많이 쓰는 순 */
  readonly slices: readonly ContextSlice[];
  /** 갈래별 합 */
  readonly totals: Readonly<Record<ContextPart, number>>;
  readonly total: number;
  /** 값이 없는 플러그인(표본 부족 또는 기록 없음) */
  readonly missing: readonly string[];
}

export function contextOf(rows: readonly PluginRow[]): ContextBreakdown {
  const slices: ContextSlice[] = [];
  const missing: string[] = [];
  for (const row of rows) {
    if (row.context === null) {
      missing.push(row.plugin);
      continue;
    }
    const parts = {
      always: valueOf(row.always) ?? 0,
      drive: valueOf(row.drive) ?? 0,
      onDemand: valueOf(row.onDemand) ?? 0,
    };
    slices.push({ plugin: row.plugin, parts, total: parts.always + parts.drive + parts.onDemand });
  }
  const sorted = slices.toSorted((a, b) => b.total - a.total || a.plugin.localeCompare(b.plugin));
  const totals = {
    always: sorted.reduce((s, x) => s + x.parts.always, 0),
    drive: sorted.reduce((s, x) => s + x.parts.drive, 0),
    onDemand: sorted.reduce((s, x) => s + x.parts.onDemand, 0),
  };
  return {
    slices: sorted,
    totals,
    total: totals.always + totals.drive + totals.onDemand,
    missing,
  };
}

/** 막대에 이름을 달 플러그인 수. 나머지는 "그 밖의 N개"로 접는다 */
export const CONTEXT_TOP = 6;

export interface FoldedSlices {
  readonly shown: readonly ContextSlice[];
  readonly rest: { readonly count: number; readonly total: number } | null;
}

export function foldSlices(slices: readonly ContextSlice[], top: number): FoldedSlices {
  if (slices.length <= top) return { shown: slices, rest: null };
  const rest = slices.slice(top);
  return {
    shown: slices.slice(0, top),
    rest: { count: rest.length, total: rest.reduce((s, x) => s + x.total, 0) },
  };
}

// ───────── 블록별 시간 ─────────

const TIME_BLOCKS = ["model", "tools", "hook", "ask", "rest"] as const;
export type TimeBlock = (typeof TIME_BLOCKS)[number];

export interface BlockTime {
  readonly total: Cell;
  readonly blocks: readonly { readonly block: TimeBlock; readonly cell: Cell }[];
}

export function blockTimeOf(result: MetricsQueryResult): BlockTime {
  const values = result.rows[0]?.values ?? {};
  return {
    total: cellOf(values[BLOCK_TIME_METRICS.total]),
    blocks: TIME_BLOCKS.map((block) => ({
      block,
      cell: cellOf(values[BLOCK_TIME_METRICS[block]]),
    })),
  };
}

// ───────── 날별 흐름 ─────────

export interface DayPoint {
  /** `YYYY-MM-DD`(UTC 날짜, 엔진의 `day` 차원) */
  readonly day: string;
  /** 그날 기록된 턴 수. 그날 행이 없으면 0이다(기록이 없었다) */
  readonly turns: number;
  readonly calls: number | null;
  readonly blocked: number | null;
  readonly asked: number | null;
  readonly modified: number | null;
}

const DAY_MS = 86_400_000;

export function dayKeyOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 창(`window`)의 날마다 한 점. 엔진이 행을 주지 않은 날은 턴 0이다 */
export function dailyOf(result: MetricsQueryResult): DayPoint[] {
  const byDay = new Map<string, MetricRow["values"]>();
  for (const row of result.rows) {
    const day = row.key.day;
    if (day !== undefined) byDay.set(day, row.values);
  }
  const days: string[] = [];
  const start = Date.parse(`${dayKeyOf(result.window.from)}T00:00:00Z`);
  for (let at = start; at < result.window.to; at += DAY_MS) days.push(dayKeyOf(at));
  return days.map((day) => {
    const values = byDay.get(day);
    if (values === undefined) {
      return { day, turns: 0, calls: 0, blocked: 0, asked: 0, modified: 0 };
    }
    return {
      day,
      turns: values[DAILY_METRICS.turns]?.n ?? 0,
      calls: valueOf(cellOf(values[DAILY_METRICS.calls])),
      blocked: valueOf(countCellOf(values[DAILY_METRICS.blocked])),
      asked: valueOf(countCellOf(values[DAILY_METRICS.asked])),
      modified: valueOf(countCellOf(values[DAILY_METRICS.modified])),
    };
  });
}

// ───────── 머리 숫자의 작은 그림 ─────────
// 머리 숫자 칸마다 그 값의 흐름을 작게 보인다(AGE-36 넷째 판). 값은 엔진이 실제로 주는 것만 쓴다:
// 턴·막음·물음은 날별 흐름(`groupBy day`), 턴당 컨텍스트는 날 × 플러그인(`groupBy day, plugin`)의 갈래 합, 지난 기간은 같은 길이의 앞 창(`period {from, to}`)이다.

/** 날 × 플러그인으로 읽는 컨텍스트 지표 */
export const DAILY_CONTEXT_METRICS = {
  always: "cost.always",
  drive: "cost.drive",
  onDemand: "cost.on_demand",
} as const;

/** 지난 기간의 턴 수는 블록별 시간의 표본 수다(날별 흐름의 턴 수와 같은 셈) */
export const PREVIOUS_TURN_METRIC = "block.time_split";

/** 플러그인 행들의 칸 하나를 더한다. 값이 있는 칸만 더하고, 하나라도 빠졌으면 근사다. 값이 하나도 없으면 첫 칸(사유) 그대로다 */
export function sumCells(rows: readonly PluginRow[], pick: (row: PluginRow) => Cell): Cell {
  const cells = rows.map(pick);
  const known = cells.filter((c) => c.kind === "value");
  if (known.length === 0) return cells[0] ?? ABSENT;
  return {
    kind: "value",
    value: known.reduce((s, c) => s + (valueOf(c) ?? 0), 0),
    approx: known.length < cells.length,
    n: 0,
  };
}

export interface DayContext {
  readonly day: string;
  /** 그날 턴 하나에 플러그인들이 실은 토큰의 합. 그날 값을 낸 플러그인이 없으면 null(표본 부족이거나 턴이 없었다) */
  readonly total: number | null;
}

/** 날마다 턴당 플러그인 컨텍스트. `days`의 순서를 따른다(날별 흐름과 같은 날들) */
export function dailyContextOf(result: MetricsQueryResult, days: readonly string[]): DayContext[] {
  const byDay = new Map<string, number>();
  for (const row of result.rows) {
    const day = row.key.day;
    if (day === undefined) continue;
    const known = Object.values(DAILY_CONTEXT_METRICS)
      .map((id) => valueOf(cellOf(row.values[id])))
      .filter((x): x is number => x !== null);
    if (known.length === 0) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + known.reduce((a, b) => a + b, 0));
  }
  return days.map((day) => ({ day, total: byDay.get(day) ?? null }));
}

/** 한 기간의 머리 숫자. 엔진이 값을 주지 않았으면 null이다(0으로 채우지 않는다) */
export interface PeriodTotals {
  readonly turns: number | null;
  readonly context: number | null;
  readonly blocked: number | null;
  readonly asked: number | null;
  readonly defied: number | null;
}

/** 지난 기간의 플러그인 표(`groupBy plugin`)와 턴 표본(블록별 시간)에서 머리 숫자를 낸다 */
export function periodTotalsOf(
  plugins: MetricsQueryResult,
  blocks: MetricsQueryResult,
): PeriodTotals {
  const rows = pluginRowsOf(plugins);
  const turnValue = blocks.rows[0]?.values[PREVIOUS_TURN_METRIC];
  const context = contextOf(rows);
  return {
    turns: turnValue === undefined || turnValue.state === "unavailable" ? null : turnValue.n,
    context: context.slices.length === 0 ? null : context.total,
    blocked: valueOf(sumCells(rows, (r) => r.blocked)),
    asked: valueOf(sumCells(rows, (r) => r.asked)),
    defied: valueOf(sumCells(rows, (r) => r.defied)),
  };
}

/** 지난 기간 대비 바뀐 몫(+0.12 = 12% 늘었다). 어느 쪽이든 값이 없거나 지난 값이 0이면 null(그리지 않는다) */
export function changeOf(now: number | null, before: number | null): number | null {
  if (now === null || before === null || before <= 0) return null;
  return (now - before) / before;
}

/** 전체 가운데 몫(0~1). 전체가 없거나 0이면 null */
export function shareOf(part: number | null, whole: number | null): number | null {
  if (part === null || whole === null || whole <= 0) return null;
  return Math.min(1, Math.max(0, part / whole));
}

/** 지난 기간의 창: 지금 기간 바로 앞의 같은 길이 */
export function previousWindowOf(
  days: number,
  now: number,
): { readonly from: number; readonly to: number } {
  return { from: now - 2 * days * DAY_MS, to: now - days * DAY_MS };
}

// ───────── 인사이트 ─────────

const IMPACT_UNITS = ["tokens_per_turn", "hits", "turns"] as const;
export type ImpactUnit = (typeof IMPACT_UNITS)[number];

export interface InsightGroup {
  readonly unit: ImpactUnit;
  readonly items: readonly Finding[];
}

/** 단위별로 묶고 묶음 안은 영향이 큰 순이다. 빈 묶음은 뺀다 */
export function insightGroupsOf(findings: readonly Finding[]): InsightGroup[] {
  return IMPACT_UNITS.map((unit) => ({
    unit,
    items: findings
      .filter((f) => f.impact.unit === unit)
      .toSorted((a, b) => b.impact.value - a.impact.value || a.id.localeCompare(b.id)),
  })).filter((group) => group.items.length > 0);
}

/** 인사이트 하나가 화면에 보이는 숫자 근거. 값이 있는 것 먼저, 많아야 `limit`개 */
export function insightFiguresOf(
  finding: Finding,
  limit: number,
): readonly { readonly metric: string; readonly cell: Cell }[] {
  const all = Object.entries(finding.metrics).map(([metric, value]) => ({
    metric,
    cell: cellOf(value),
  }));
  return all
    .toSorted((a, b) => Number(b.cell.kind === "value") - Number(a.cell.kind === "value"))
    .slice(0, limit);
}

// ───────── 최근 턴(트레이스로 가는 길) ─────────
// 엔진이 모든 대화의 턴을 시작 시각 역순으로 쪽 단위로 준다(`turnRecord.recent`, AGE-36). 기간·프로필·플러그인·범위로 거른다.
// 첫 쪽은 크게(200) 읽는다: 날별 결정을 턴 요약의 합으로 보일 수 있는 날(`coveredDays`)이 이 쪽에 든 턴으로 정해진다.

/** 첫 쪽과 이어 읽는 쪽의 크기(엔진 최대 200) */
export const RECENT_FIRST_PAGE = 200;
export const RECENT_PAGE = 50;

export interface RecentTurn {
  readonly turn: TurnSummary;
  /** 대화 제목. 없으면 null(화면은 "제목 없는 대화") */
  readonly title: string | null;
}

/** 줄 하나가 그리는 턴의 값. 최근 턴은 턴 요약 전체를, 근거 턴은 턴 기록에서 뽑은 이 값을 쓴다 */
export type TurnBrief = Pick<
  TurnSummary,
  "threadId" | "turnId" | "startedAt" | "status" | "complete" | "stepCount" | "callCount" | "flags"
>;

/** `YYYY-MM-DD`(UTC)의 하루(시작 포함, 끝 제외, epoch ms). 날별 기둥과 같은 UTC 날이다 */
export function dayWindowOf(day: string): { readonly from: number; readonly to: number } {
  const from = Date.parse(`${day}T00:00:00Z`);
  return { from, to: from + DAY_MS };
}

/**
 * 화면의 거르기를 `turnRecord.recent`의 거르기로 바꾼다(쪽 커서와 크기는 부르는 쪽이 붙인다).
 * 날을 고르면 그 UTC 하루, 아니면 기간의 시작부터(끝은 열어 두어 새 턴이 든다). 플러그인 좁히기는 `withPlugin`이 참일 때만 싣는다
 */
export function recentParamsOf(
  filter: MetricsFilter,
  now: number,
  day: string | null,
  withPlugin: boolean,
): {
  readonly from: number;
  readonly to?: number;
  readonly profileId?: string;
  readonly plugin?: string;
  readonly scopes: ScopeKind[];
} {
  return {
    ...(day === null ? { from: now - filter.days * DAY_MS } : dayWindowOf(day)),
    scopes: [...(filter.includeTests ? ALL_SCOPES : LIVE_SCOPES)],
    ...(filter.profileId === null ? {} : { profileId: filter.profileId }),
    ...(withPlugin && filter.plugin !== null ? { plugin: filter.plugin } : {}),
  };
}

/** 줄의 열쇠(대화 + 턴) */
export function turnKeyOf(turn: { readonly threadId: string; readonly turnId: string }): string {
  return `${turn.threadId}:${turn.turnId}`;
}

/**
 * 첫 쪽을 다시 읽었을 때 이미 이어 읽은 줄을 버리지 않고 합친다: 새 첫 쪽이 앞에, 그 뒤에 새 첫 쪽에 없는 옛 줄이 남는다.
 * 새 턴이 생겨 첫 쪽이 바뀌어도 사용자가 내려 읽던 목록이 처음으로 돌아가지 않는다
 */
export function mergeFirstPage(
  fresh: readonly RecentTurn[],
  old: readonly RecentTurn[],
): RecentTurn[] {
  const seen = new Set(fresh.map((r) => turnKeyOf(r.turn)));
  return [...fresh, ...old.filter((r) => !seen.has(turnKeyOf(r.turn)))];
}

/** 인사이트 근거가 가리키는 턴(대화 + 턴). 같은 턴은 한 번, 근거 순서대로. 돌려 본 턴(backtest)은 트레이스가 없어 뺀다 */
export function evidenceTurnsOf(
  refs: readonly EvidenceRef[],
): { readonly threadId: string; readonly turnId: string }[] {
  const seen = new Set<string>();
  const out: { threadId: string; turnId: string }[] = [];
  for (const ref of refs) {
    if (ref.kind === "backtest") continue;
    const key = turnKeyOf(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ threadId: ref.threadId, turnId: ref.turnId });
  }
  return out;
}

/** 턴 기록 하나에서 줄의 값을 뽑는다(근거 턴 줄) */
export function briefOfRecord(record: TurnRecord): TurnBrief {
  return {
    threadId: record.threadId,
    turnId: record.turnId,
    startedAt: record.startedAt,
    status: record.status,
    complete: record.complete,
    stepCount: record.steps.length,
    callCount: record.steps.reduce((s, step) => s + step.calls.length, 0),
    flags: record.flags,
  };
}

export function turnsOnDay(turns: readonly RecentTurn[], day: string): RecentTurn[] {
  return turns.filter((r) => dayKeyOf(r.turn.startedAt) === day);
}

/** 턴 요약의 결정 수(있는 그대로의 합). 막음은 의도한 막음만, 고장으로 막힌 것은 `fault`다 */
export interface RawDecisions {
  readonly blocked: number;
  readonly asked: number;
  readonly modified: number;
  readonly fault: number;
}

export function rawDecisionsOf(turns: readonly TurnSummary[]): RawDecisions {
  return turns.reduce<RawDecisions>(
    (acc, t) => ({
      blocked: acc.blocked + t.flags.blockedIntent,
      asked: acc.asked + t.flags.asked,
      modified: acc.modified + t.flags.modified,
      fault: acc.fault + t.flags.blockedFault + t.flags.timedOut + t.flags.failed,
    }),
    { blocked: 0, asked: 0, modified: 0, fault: 0 },
  );
}

/** 끊겼다 이어졌거나 기록이 모자란 턴(`complete: false`). 도는 턴(`open`)은 아직 모른다 */
export function isPartialTurn(turn: Pick<TurnSummary, "complete" | "status">): boolean {
  return !turn.complete && turn.status !== "open";
}

/**
 * 날마다 읽은 턴이 그날 턴 전부인가. 메트릭의 그날 턴 수와 읽은 턴 수가 같으면 그날의 결정 수를 턴 요약의 합으로 보일 수 있다.
 * 메트릭이 그날 턴 수를 모르면(0) 덮었다고 보지 않는다
 */
export function coveredDays(
  daily: readonly DayPoint[],
  turns: readonly RecentTurn[],
): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const r of turns) {
    const day = dayKeyOf(r.turn.startedAt);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return new Set(
    daily.filter((p) => p.turns > 0 && (counts.get(p.day) ?? 0) >= p.turns).map((p) => p.day),
  );
}

// ───────── 표본 ─────────

/**
 * 기간 안에 모인 턴 수와 엔진의 최소 표본 수(설정 `x.operations.metrics.minSample`). 최소 표본을 못 읽었으면 null이다.
 * `short`는 비율·평균이 보이려면 더 모여야 할 턴 수(0이면 다 모였다)
 */
export interface SampleStatus {
  readonly turns: number;
  readonly min: number | null;
  readonly short: number | null;
}

export function sampleStatusOf(turns: number, min: number | null): SampleStatus {
  return { turns, min, short: min === null ? null : Math.max(0, min - turns) };
}
