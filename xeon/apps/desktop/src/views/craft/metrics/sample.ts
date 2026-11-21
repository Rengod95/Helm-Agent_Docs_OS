// 개발 빌드 전용 표본(스크린샷과 많은 기록의 장면). 출시 빌드에는 들지 않는다(`metrics-dev.tsx`가 BUILD_CHECKS 아래에서만 불러온다).
// 값의 모양은 엔진 계약(`MetricsQueryResult`, `Finding`) 그대로이고, 엔진이 아직 주지 않는 값(모델 호출 시간 등)은 표본에서도 `unavailable`이다.
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever, ok } from "@fresnel/contracts";
import type {
  EvidenceRef,
  Finding,
  FindingsListResult,
  MetricDef,
  MetricRow,
  MetricValue,
  MetricsQueryResult,
  Profile,
  TurnFlags,
  TurnSummary,
} from "@fresnel/contracts/wire";
import {
  BLOCK_TIME_METRICS,
  DAILY_CONTEXT_METRICS,
  DAILY_METRICS,
  PLUGIN_METRICS,
  RECENT_FIRST_PAGE,
  RECENT_PAGE,
  dayWindowOf,
  type MetricsFilter,
  type PeriodTotals,
  type RecentTurn,
  type TurnBrief,
} from "./model.ts";
import type { Load, MetricsActions, MetricsData, RecentTurns } from "./source.ts";

export const SCENES = [
  "live",
  "sample",
  "few",
  "quiet",
  "empty",
  "loading",
  "failed",
  "offline",
  "unsupported",
  "off",
  "many",
] as const;
export type Scene = (typeof SCENES)[number];

const NOW = Date.UTC(2026, 10, 20, 9, 0, 0);
const DAY = 86_400_000;

function v(value: number, n: number, approx = false): MetricValue {
  return { value, n, state: approx ? "approx" : "exact" };
}
function ratio(value: number, denom: number): MetricValue {
  return { value, n: denom, denom, state: "exact" };
}
const SAMPLE: MetricValue = { value: null, n: 6, state: "insufficient_sample" };
const NOT_RECORDED: MetricValue = {
  value: null,
  n: 0,
  state: "unavailable",
  reason: "not_recorded",
};

interface PluginSeed {
  readonly name: string;
  readonly always: number;
  readonly drive: number;
  readonly onDemand: number;
  readonly hookRuns: number;
  readonly blocked: number;
  readonly asked: number;
  readonly defied: number;
  readonly calls: number;
  readonly fault: number;
}

const SEEDS: readonly PluginSeed[] = [
  {
    name: "repo-guard",
    always: 1840,
    drive: 0,
    onDemand: 0,
    hookRuns: 412,
    blocked: 37,
    asked: 12,
    defied: 9,
    calls: 0,
    fault: 0.004,
  },
  {
    name: "review-flow",
    always: 920,
    drive: 3150,
    onDemand: 640,
    hookRuns: 96,
    blocked: 2,
    asked: 18,
    defied: 0,
    calls: 54,
    fault: 0,
  },
  {
    name: "web-research",
    always: 2310,
    drive: 0,
    onDemand: 1220,
    hookRuns: 0,
    blocked: 0,
    asked: 0,
    defied: 0,
    calls: 188,
    fault: 0,
  },
  {
    name: "commit-style",
    always: 610,
    drive: 0,
    onDemand: 0,
    hookRuns: 203,
    blocked: 21,
    asked: 0,
    defied: 14,
    calls: 0,
    fault: 0.035,
  },
  {
    name: "test-runner",
    always: 480,
    drive: 0,
    onDemand: 980,
    hookRuns: 88,
    blocked: 0,
    asked: 7,
    defied: 0,
    calls: 141,
    fault: 0,
  },
  {
    name: "secrets-shield",
    always: 260,
    drive: 0,
    onDemand: 0,
    hookRuns: 512,
    blocked: 6,
    asked: 3,
    defied: 2,
    calls: 0,
    fault: 0.002,
  },
  {
    name: "docs-voice",
    always: 1320,
    drive: 0,
    onDemand: 0,
    hookRuns: 0,
    blocked: 0,
    asked: 0,
    defied: 0,
    calls: 0,
    fault: 0,
  },
  {
    name: "issue-sync",
    always: 740,
    drive: 0,
    onDemand: 310,
    hookRuns: 0,
    blocked: 0,
    asked: 0,
    defied: 0,
    calls: 23,
    fault: 0,
  },
];

function pluginRow(s: PluginSeed, scale: number): MetricRow {
  const runs = Math.round(s.hookRuns * scale);
  return {
    key: { plugin: s.name },
    values: {
      [PLUGIN_METRICS.always]: v(s.always, 140, true),
      [PLUGIN_METRICS.drive]: s.drive === 0 ? v(0, 140, true) : v(s.drive, 31, true),
      [PLUGIN_METRICS.onDemand]: v(s.onDemand, 140, true),
      [PLUGIN_METRICS.hookRuns]: v(runs, runs),
      [PLUGIN_METRICS.blocked]:
        runs < 20 ? SAMPLE : ratio(s.blocked / Math.max(1, s.hookRuns), runs),
      [PLUGIN_METRICS.asked]: runs < 20 ? SAMPLE : ratio(s.asked / Math.max(1, s.hookRuns), runs),
      [PLUGIN_METRICS.modified]: runs < 20 ? SAMPLE : ratio(0.01, runs),
      [PLUGIN_METRICS.fault]: runs < 20 ? SAMPLE : ratio(s.fault, runs),
      [PLUGIN_METRICS.defied]: v(Math.round(s.defied * scale), 140, true),
      [PLUGIN_METRICS.calls]: v(Math.round(s.calls * scale), Math.round(s.calls * scale)),
    },
  };
}

function manySeeds(): PluginSeed[] {
  const out: PluginSeed[] = [...SEEDS];
  const stems = [
    "lint",
    "fmt",
    "deploy",
    "bench",
    "notes",
    "triage",
    "scan",
    "lsp",
    "i18n",
    "sql",
    "infra",
    "pr",
    "ci",
    "mail",
    "cal",
    "graph",
  ];
  for (let i = 0; out.length < 64; i += 1) {
    const stem = stems[i % stems.length] ?? "x";
    out.push({
      name: `${stem}-${String(Math.floor(i / stems.length) + 2)}`,
      always: 120 + ((i * 137) % 900),
      drive: i % 9 === 0 ? 800 + ((i * 53) % 1400) : 0,
      onDemand: (i * 71) % 600,
      hookRuns: i % 3 === 0 ? 40 + ((i * 29) % 300) : 0,
      blocked: i % 3 === 0 ? (i * 7) % 19 : 0,
      asked: i % 5 === 0 ? (i * 3) % 11 : 0,
      defied: i % 6 === 0 ? (i % 5) + 1 : 0,
      calls: i % 2 === 0 ? (i * 13) % 160 : 0,
      fault: i % 11 === 0 ? 0.05 : 0,
    });
  }
  return out;
}

function window(days: number): { readonly from: number; readonly to: number } {
  return { from: NOW - days * DAY, to: NOW };
}

function pluginsResult(days: number, many: boolean): MetricsQueryResult {
  const scale = days / 7;
  const seeds = many ? manySeeds() : SEEDS;
  return {
    window: window(days),
    rows: seeds.map((s) => pluginRow(s, scale * (many ? 6 : 1))),
    notes: [],
  };
}

function blocksResult(days: number): MetricsQueryResult {
  return {
    window: window(days),
    rows: [
      {
        key: {},
        values: {
          [BLOCK_TIME_METRICS.total]: v(18_400, 140, true),
          [BLOCK_TIME_METRICS.model]: NOT_RECORDED,
          [BLOCK_TIME_METRICS.tools]: v(6_900, 140, true),
          [BLOCK_TIME_METRICS.hook]: v(820, 140, true),
          [BLOCK_TIME_METRICS.ask]: v(3_100, 140, true),
          [BLOCK_TIME_METRICS.rest]: v(7_580, 140, true),
        },
      },
    ],
    notes: [],
  };
}

function dailyResult(days: number, many: boolean): MetricsQueryResult {
  const rows: MetricRow[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(NOW - i * DAY).toISOString().slice(0, 10);
    const weekday = new Date(NOW - i * DAY).getUTCDay();
    const base = many ? 140 : 22;
    const turns =
      weekday === 0 || weekday === 6
        ? Math.round(base * 0.25)
        : base + ((i * 37) % Math.round(base * 0.9));
    if (turns === 0) continue;
    const runs = turns * 6;
    rows.push({
      key: { day },
      values: {
        [DAILY_METRICS.turns]: { value: 18_000, n: turns, state: "approx" },
        [DAILY_METRICS.calls]: v(turns * 4, turns * 4),
        [DAILY_METRICS.hookRuns]: v(runs, runs),
        [DAILY_METRICS.blocked]: ratio(((i * 13) % 9) / runs + 0.01, runs),
        [DAILY_METRICS.asked]: ratio(((i * 7) % 5) / runs + 0.004, runs),
        [DAILY_METRICS.modified]: ratio(((i * 5) % 4) / runs + 0.006, runs),
      },
    });
  }
  return { window: window(days), rows, notes: [] };
}

/** 플러그인 하나로 좁혀 본 날별 결정(표본). 턴 수 칸은 플러그인 칸이 없어 비어 있다 */
function focusDailyResult(days: number, plugin: string): MetricsQueryResult {
  const seed = SEEDS.find((x) => x.name === plugin);
  const weight = seed === undefined ? 0.2 : Math.min(1, (seed.blocked + seed.asked) / 40);
  const rows: MetricRow[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(NOW - i * DAY).toISOString().slice(0, 10);
    const runs = 40;
    rows.push({
      key: { day },
      values: {
        [DAILY_METRICS.hookRuns]: v(runs, runs),
        [DAILY_METRICS.blocked]: ratio((((i * 11) % 7) * weight) / runs, runs),
        [DAILY_METRICS.asked]: ratio((((i * 5) % 4) * weight) / runs, runs),
        [DAILY_METRICS.modified]: ratio((((i * 3) % 3) * weight) / runs, runs),
      },
    });
  }
  return { window: window(days), rows, notes: [] };
}

/** 턴이 적은 장면(6턴): 비율 칸은 표본 부족이고 날별 결정도 엔진이 내지 않는다 */
function fewResults(days: number): {
  readonly plugins: MetricsQueryResult;
  readonly daily: MetricsQueryResult;
  readonly blocks: MetricsQueryResult;
} {
  const few: MetricValue = { value: null, n: 6, state: "insufficient_sample" };
  const plugins = SEEDS.slice(0, 4).map((s): MetricRow => ({
    key: { plugin: s.name },
    values: {
      [PLUGIN_METRICS.always]: v(s.always, 6, true),
      [PLUGIN_METRICS.drive]: v(s.drive, 6, true),
      [PLUGIN_METRICS.onDemand]: v(s.onDemand, 6, true),
      [PLUGIN_METRICS.hookRuns]: v(Math.round(s.hookRuns / 40), Math.round(s.hookRuns / 40)),
      [PLUGIN_METRICS.blocked]: few,
      [PLUGIN_METRICS.asked]: few,
      [PLUGIN_METRICS.modified]: few,
      [PLUGIN_METRICS.fault]: few,
      [PLUGIN_METRICS.defied]: v(s.defied === 0 ? 0 : 1, 6, true),
      [PLUGIN_METRICS.calls]: v(Math.round(s.calls / 30), Math.round(s.calls / 30)),
    },
  }));
  const dayRows: MetricRow[] = [
    { day: 1, turns: 2 },
    { day: 0, turns: 4 },
  ].map((x) => ({
    key: { day: new Date(NOW - x.day * DAY).toISOString().slice(0, 10) },
    values: {
      [DAILY_METRICS.turns]: { value: null, n: x.turns, state: "insufficient_sample" },
      [DAILY_METRICS.calls]: v(x.turns * 3, x.turns * 3),
      [DAILY_METRICS.hookRuns]: v(x.turns * 5, x.turns * 5),
      [DAILY_METRICS.blocked]: { value: null, n: x.turns * 5, state: "insufficient_sample" },
      [DAILY_METRICS.asked]: { value: null, n: x.turns * 5, state: "insufficient_sample" },
      [DAILY_METRICS.modified]: { value: null, n: x.turns * 5, state: "insufficient_sample" },
    },
  }));
  const blocks: MetricsQueryResult = {
    window: window(days),
    rows: [
      {
        key: {},
        values: Object.fromEntries(
          Object.values(BLOCK_TIME_METRICS).map((m) => [
            m,
            m === BLOCK_TIME_METRICS.model ? NOT_RECORDED : few,
          ]),
        ),
      },
    ],
    notes: [],
  };
  return {
    plugins: { window: window(days), rows: plugins, notes: [] },
    daily: { window: window(days), rows: dayRows, notes: [] },
    blocks,
  };
}

/** 개발용 장면의 대화 제목. 화면 글자이므로 카탈로그에서 꺼낸다 */
function titlesOf(): readonly (string | null)[] {
  return [
    t("desktop.craft.metrics.dev.sample.title1"),
    t("desktop.craft.metrics.dev.sample.title2"),
    t("desktop.craft.metrics.dev.sample.title3"),
    t("desktop.craft.metrics.dev.sample.title4"),
    null,
    t("desktop.craft.metrics.dev.sample.title5"),
  ];
}

function flagsOf(patch: Partial<TurnFlags>): TurnFlags {
  return {
    blockedIntent: 0,
    blockedFault: 0,
    deniedPolicy: 0,
    deniedHuman: 0,
    deniedNoninteractive: 0,
    replaced: 0,
    cancelledAsk: 0,
    asked: 0,
    modified: 0,
    timedOut: 0,
    failed: 0,
    drive: false,
    cacheBreak: false,
    subagents: 0,
    truncatedMaterials: 0,
    draftActive: false,
    untrackedWrite: false,
    ...patch,
  };
}

function fewAt(x: RecentTurn, i: number): RecentTurn {
  return {
    title: x.title,
    turn: { ...x.turn, startedAt: NOW - (i < 4 ? i * 3_600_000 : DAY + i * 3_600_000) },
  };
}

/** 표본 대화(여섯). 대화 id는 트레이스 표본이 받는 모양(`thr_sample…`)이고 제목은 개발용 카탈로그에서 온다 */
const SAMPLE_THREADS = 6;
function sampleThreadOf(i: number): string {
  return `thr_sample_${String(i % SAMPLE_THREADS)}`;
}
function sampleTitleOf(threadId: string): string | null {
  const k = Number(threadId.slice(threadId.lastIndexOf("_") + 1));
  return Number.isInteger(k) ? (titlesOf()[k % SAMPLE_THREADS] ?? null) : null;
}

function sampleFlags(i: number): TurnFlags {
  return flagsOf({
    blockedIntent: i % 5 === 1 ? 1 : 0,
    asked: i % 3 === 2 ? 1 : 0,
    modified: i % 4 === 3 ? 2 : 0,
    timedOut: i === 9 ? 1 : 0,
  });
}

/** 최근 턴(표본) 전부. 턴 id는 트레이스 표본이 받는 모양(`trn_sample_N`)이다 */
function recentSample(count: number, days: number): RecentTurn[] {
  const turns: RecentTurn[] = [];
  for (let i = 0; i < count; i += 1) {
    const startedAt = NOW - Math.round((i * (days * DAY)) / Math.max(count, 1) / 1.15) - i * 97_000;
    const status: TurnSummary["status"] = i === 0 ? "open" : i === 7 ? "interrupted" : "completed";
    const threadId = sampleThreadOf(i);
    turns.push({
      title: sampleTitleOf(threadId),
      turn: {
        threadId,
        turnId: `trn_sample_${String(i + 1)}`,
        startedAt,
        endedAt: status === "open" ? null : startedAt + 15_000,
        status,
        scope: "live",
        complete: i !== 4 && i !== 0,
        profileId: "prof_daily",
        stepCount: 1 + (i % 4),
        callCount: (i * 3) % 7,
        flags: sampleFlags(i),
        frameDepthMax: 0,
        childCount: 0,
      },
    });
  }
  return turns;
}

/** 표본 턴 전부에서 첫 쪽(200)과 쪽 읽기를 만든다. 날을 고르면 그 UTC 하루만 */
function recentPagesOf(all: readonly RecentTurn[]): {
  readonly first: RecentTurns;
  readonly page: MetricsActions["recentPage"];
} {
  const first: RecentTurns = {
    turns: all.slice(0, RECENT_FIRST_PAGE),
    next: all.length > RECENT_FIRST_PAGE ? String(RECENT_FIRST_PAGE) : null,
  };
  return {
    first,
    page: (day, cursor) => {
      const list =
        day === null
          ? all
          : all.filter((r) => {
              const w = dayWindowOf(day);
              return r.turn.startedAt >= w.from && r.turn.startedAt < w.to;
            });
      const start = cursor === null ? 0 : Number(cursor);
      const items = list.slice(start, start + RECENT_PAGE);
      const next = start + RECENT_PAGE < list.length ? String(start + RECENT_PAGE) : null;
      return Promise.resolve(ok({ items, next }));
    },
  };
}

/** 근거 턴 하나의 줄 값(표본). 턴 번호로 시각과 결정을 정한다 */
function sampleBrief(threadId: string, turnId: string): TurnBrief {
  const n = Number(turnId.slice(turnId.lastIndexOf("_") + 1));
  const i = Number.isInteger(n) ? n : 0;
  return {
    threadId,
    turnId,
    startedAt: NOW - i * 3_100_000,
    status: "completed",
    complete: true,
    stepCount: 1 + (i % 4),
    callCount: (i * 3) % 7,
    flags: sampleFlags(i),
  };
}

function evidence(n: number): EvidenceRef[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: "turn" as const,
    threadId: sampleThreadOf(i),
    turnId: `trn_sample_${String(i * 3 + 2)}`,
  }));
}

/** 날 × 플러그인의 컨텍스트(표본). 행 수가 엔진 상한(1000) 안에 들게 앞의 여섯 플러그인만, 날마다 조금씩 오르내린다 */
function dailyContextResult(days: number, daily: MetricsQueryResult): MetricsQueryResult {
  const rows: MetricRow[] = [];
  for (const row of daily.rows) {
    const day = row.key.day;
    if (day === undefined) continue;
    const at = Date.parse(`${day}T00:00:00Z`);
    const k = Math.round((NOW - at) / DAY);
    const wave = 1 + 0.08 * Math.sin(k * 1.3) - 0.012 * k;
    for (const seed of SEEDS.slice(0, 6)) {
      rows.push({
        key: { day, plugin: seed.name },
        values: {
          [DAILY_CONTEXT_METRICS.always]: v(Math.round(seed.always * wave), 20, true),
          [DAILY_CONTEXT_METRICS.drive]: v(Math.round(seed.drive * wave), 20, true),
          [DAILY_CONTEXT_METRICS.onDemand]: v(Math.round(seed.onDemand * wave), 20, true),
        },
      });
    }
  }
  return { window: window(days), rows, notes: [] };
}

/** 지난 기간(표본): 지금보다 조금 적거나 많다. 표본이 적은 장면은 지난 기간 기록이 없다 */
function previousOf(days: number, many: boolean, empty: boolean): PeriodTotals {
  if (empty) return { turns: null, context: null, blocked: null, asked: null, defied: null };
  const scale = (days / 7) * (many ? 6 : 1);
  return {
    turns: Math.round(148 * (days / 7) * (many ? 6.2 : 1)),
    context: 13_900,
    blocked: Math.round(74 * scale),
    asked: Math.round(36 * scale),
    defied: Math.round(25 * scale),
  };
}

function finding(
  id: string,
  ruleId: string,
  kind: Finding["subject"]["kind"],
  plugin: string,
  ref: string | null,
  impact: Finding["impact"],
  metrics: Finding["metrics"],
  evidenceTotal: number,
  next: Finding["next"],
): Finding {
  return {
    id,
    ruleId,
    ruleVersion: 1,
    subject: { kind, plugin, ref },
    impact,
    metrics,
    evidence: evidence(Math.min(evidenceTotal, 50)),
    evidenceTotal,
    next,
    state: "open",
  };
}

const FIX = { kind: "fix", target: "craft_chat", label: "next.fix" } as const;
const PROMOTE = { kind: "promote", target: "craft_chat", label: "next.promote" } as const;
const REMOVE = { kind: "remove", target: "profile", label: "next.remove" } as const;

function findings(many: boolean): Finding[] {
  const base: Finding[] = [
    finding(
      "instruction_defied-1",
      "instruction_defied",
      "instruction",
      "commit-style",
      "commit-message",
      { unit: "turns", value: 14 },
      { "inst.defied": ratio(0.34, 41), "inst.defied_calls": v(14, 41, true) },
      14,
      [PROMOTE, REMOVE],
    ),
    finding(
      "unused_tools-1",
      "unused_tools",
      "tool",
      "web-research",
      "fetch_pdf",
      { unit: "tokens_per_turn", value: 1180 },
      { "tool.never_called": v(3, 140), "tool.never_called.tokens": v(1180, 140, true) },
      140,
      [FIX, REMOVE],
    ),
    finding(
      "ask_always_denied-1",
      "ask_always_denied",
      "hook",
      "repo-guard",
      "tool.call.before",
      { unit: "hits", value: 12 },
      { "hook.ask_answers.deny": ratio(0.92, 13), "hook.ask_answers": v(13, 13) },
      12,
      [PROMOTE, REMOVE],
    ),
    finding(
      "hook_slow_faulty-1",
      "hook_slow_faulty",
      "hook",
      "commit-style",
      "tool.call.before",
      { unit: "hits", value: 7 },
      { "hook.fault_rate": ratio(0.035, 203), "hook.duration.p95": v(16_384, 203, true) },
      7,
      [FIX, REMOVE],
    ),
    finding(
      "drive_budget_exhausted-1",
      "drive_budget_exhausted",
      "drive",
      "review-flow",
      null,
      { unit: "turns", value: 9 },
      { "drive.usage_vs_limit": ratio(0.97, 31) },
      9,
      [FIX, REMOVE],
    ),
  ];
  if (!many) return base;
  const extra: Finding[] = [];
  const rules = [
    "skill_never_read",
    "cache_break_by_plugin",
    "instruction_truncated",
    "repeat_after_block",
    "skill_activation_drop",
  ] as const;
  for (let i = 0; i < 15; i += 1) {
    const rule = rules[i % rules.length] ?? "skill_never_read";
    extra.push(
      finding(
        `${rule}-m${String(i)}`,
        rule,
        i % 2 === 0 ? "skill" : "block",
        `lint-${String(i + 2)}`,
        null,
        { unit: i % 3 === 0 ? "tokens_per_turn" : "turns", value: 40 + i * 17 },
        {},
        20 + i,
        [FIX, REMOVE],
      ),
    );
  }
  return [...base, ...extra];
}

// 표본의 이름(프로필 이름, 지표 이름)은 엔진이 주는 데이터를 흉내 낸다. 글은 개발용 카탈로그 키에서 온다
function profiles(): readonly Profile[] {
  return [
    {
      id: "default",
      title: t("desktop.craft.metrics.dev.sample.profileDefault"),
      builtin: true,
      plugins: SEEDS.slice(0, 6).map((s) => ({ name: s.name })),
      settings: [],
      startDrive: null,
      updatedAt: "2026-11-18T10:00:00Z",
      rev: 4,
    },
    {
      id: "review",
      title: t("desktop.craft.metrics.dev.sample.profileReview"),
      builtin: false,
      plugins: [{ name: "review-flow" }, { name: "repo-guard" }, { name: "commit-style" }],
      settings: [],
      startDrive: "review-flow",
      updatedAt: "2026-11-19T10:00:00Z",
      rev: 2,
    },
  ];
}

const CATALOG_ROWS: readonly (readonly [string, MessageId, MetricDef["kind"]])[] = [
  ["inst.defied", "desktop.craft.metrics.dev.sample.instDefied", "ratio"],
  ["inst.defied_calls", "desktop.craft.metrics.dev.sample.instDefiedCalls", "count"],
  ["tool.never_called", "desktop.craft.metrics.dev.sample.toolNeverCalled", "count"],
  ["tool.never_called.tokens", "desktop.craft.metrics.dev.sample.toolNeverCalledTokens", "tokens"],
  ["hook.ask_answers.deny", "desktop.craft.metrics.dev.sample.askDeny", "ratio"],
  ["hook.ask_answers", "desktop.craft.metrics.dev.sample.askAnswers", "count"],
  ["hook.fault_rate", "desktop.craft.metrics.dev.sample.hookFault", "ratio"],
  ["hook.duration.p95", "desktop.craft.metrics.dev.sample.hookP95", "ms"],
  ["drive.usage_vs_limit", "desktop.craft.metrics.dev.sample.driveUsage", "ratio"],
];

function catalog(): ReadonlyMap<string, MetricDef> {
  return new Map(
    CATALOG_ROWS.map(([id, key, kind]) => [
      id,
      {
        id,
        label: { ko: t(key), en: t(key) },
        unit: kind,
        kind,
        appliesTo: [],
        feasible: "exact",
        definitionNote: null,
      },
    ]),
  );
}

function ready<T>(value: T): Load<T> {
  return { kind: "ready", value, stale: false };
}

const NO_ACTIONS: MetricsActions = {
  reload: () => {},
  dismiss: () => Promise.resolve(ok(null)),
  openFix: () => Promise.resolve(ok(null)),
  removeFromProfile: () => Promise.resolve(ok(null)),
  openTurn: () => {},
  evidence: () => Promise.resolve(ok({ items: [], next: null })),
  recentPage: () => Promise.resolve(ok({ items: [], next: null })),
  turnBrief: (threadId, turnId) => Promise.resolve(ok(sampleBrief(threadId, turnId))),
  versions: () =>
    Promise.resolve(
      ok([
        { hash: "sha256:9c1f2e7a51", approvedAt: "2026-11-19T08:00:00Z", current: true },
        { hash: "sha256:4b7d0aa3c2", approvedAt: "2026-11-12T08:00:00Z", current: false },
      ]),
    ),
  compare: (_plugin, a, b) =>
    Promise.resolve(
      ok({
        window: window(30),
        rows: [
          {
            key: { pluginVersion: a },
            values: {
              "hook.outcomes.blocked": ratio(0.12, 220),
              "hook.outcomes.asked": ratio(0.05, 220),
              "hook.fault_rate": ratio(0.031, 220),
              "tool.error_rate": ratio(0.04, 300),
              "cost.always": v(780, 60, true),
            },
          },
          {
            key: { pluginVersion: b },
            values: {
              "hook.outcomes.blocked": ratio(0.07, 180),
              "hook.outcomes.asked": ratio(0.06, 180),
              "hook.fault_rate": SAMPLE,
              "tool.error_rate": ratio(0.03, 260),
              "cost.always": v(610, 48, true),
            },
          },
        ],
        notes: [{ metric: "hook.outcomes.blocked", code: "confounded", text: null }],
      }),
    ),
};

/** 장면 하나의 원천. `live`는 부르는 쪽이 실제 원천을 쓴다 */
export function sampleData(
  scene: Exclude<Scene, "live">,
  filter: MetricsFilter,
  setFilter: (next: MetricsFilter) => void,
  actions: Partial<MetricsActions>,
): MetricsData {
  const many = scene === "many";
  const days = many ? 30 : filter.days;
  const base = {
    link: scene === "offline" ? ("offline" as const) : ("live" as const),
    filter: many ? { ...filter, days: 30 as const } : filter,
    setFilter,
    profiles: ready(profiles()),
    catalog: ready(catalog()),
    actions: { ...NO_ACTIONS, ...actions },
    minSample: 20,
    focusDaily:
      filter.plugin === null
        ? null
        : ready(focusDailyResult(many ? 30 : filter.days, filter.plugin)),
    threadTitle: sampleTitleOf,
  };
  /** 표본 턴 전부로 최근 턴의 첫 쪽과 쪽 읽기를, 날별 흐름으로 날 × 플러그인 컨텍스트를, 그리고 지난 기간을 붙인다 */
  const extras = (
    turns: readonly RecentTurn[],
    daily: MetricsQueryResult,
    list: readonly Finding[],
    few = false,
  ): Pick<MetricsData, "recent" | "dailyContext" | "previous" | "actions"> => {
    const pages = recentPagesOf(turns);
    return {
      recent: ready(pages.first),
      dailyContext: ready(
        few ? { window: window(days), rows: [], notes: [] } : dailyContextResult(days, daily),
      ),
      previous: ready(previousOf(days, many, few)),
      actions: {
        ...base.actions,
        recentPage: pages.page,
        evidence: (findingId) => {
          const f = list.find((x) => x.id === findingId);
          return Promise.resolve(
            ok({
              items: f === undefined ? [] : evidence(Math.min(f.evidenceTotal, 200)),
              next: null,
            }),
          );
        },
      },
    };
  };
  const all = (load: Load<never>): MetricsData => ({
    ...base,
    focusDaily: filter.plugin === null ? null : load,
    plugins: load,
    blocks: load,
    daily: load,
    findings: load,
    dismissed: load,
    recent: load,
    dailyContext: load,
    previous: load,
  });
  switch (scene) {
    case "loading":
      return all({ kind: "loading" });
    case "failed":
      return all({ kind: "error" });
    case "offline":
      return all({ kind: "offline" });
    case "unsupported":
      return all({ kind: "unsupported" });
    case "empty": {
      const empty: MetricsQueryResult = { window: window(days), rows: [], notes: [] };
      const none: FindingsListResult = { asOf: NOW, dataRevision: 1, findings: [] };
      return {
        ...base,
        plugins: ready(empty),
        blocks: ready(empty),
        daily: ready(empty),
        findings: ready(none),
        dismissed: ready(none),
        ...extras([], empty, [], true),
      };
    }
    case "few": {
      const r = fewResults(days);
      const none: FindingsListResult = { asOf: NOW, dataRevision: 1, findings: [] };
      return {
        ...base,
        plugins: ready(r.plugins),
        blocks: ready(r.blocks),
        daily: ready(r.daily),
        findings: ready(none),
        dismissed: ready(none),
        // 6턴은 이틀에 나뉜다(어제 2, 오늘 4): 메트릭의 날별 턴 수와 같게
        ...extras(recentSample(6, 2).map(fewAt), r.daily, [], true),
      };
    }
    case "off": {
      const off: MetricsQueryResult = {
        window: window(days),
        rows: SEEDS.slice(0, 3).map((s) => ({
          key: { plugin: s.name },
          values: Object.fromEntries(
            Object.values(PLUGIN_METRICS).map((m) => [
              m,
              {
                value: null,
                n: 0,
                state: "unavailable",
                reason: "measurement_off",
              } satisfies MetricValue,
            ]),
          ),
        })),
        notes: [{ metric: "*", code: "measurement_off", text: null }],
      };
      return {
        ...base,
        plugins: ready(off),
        blocks: ready(blocksResult(days)),
        daily: ready(dailyResult(days, false)),
        findings: ready({ asOf: NOW, dataRevision: 1, findings: [] }),
        dismissed: ready({ asOf: NOW, dataRevision: 1, findings: [] }),
        ...extras(recentSample(24, days), dailyResult(days, false), []),
      };
    }
    case "quiet":
      return {
        ...base,
        plugins: ready(pluginsResult(days, false)),
        blocks: ready(blocksResult(days)),
        daily: ready(dailyResult(days, false)),
        findings: ready({ asOf: NOW, dataRevision: 1, findings: [] }),
        dismissed: ready({ asOf: NOW, dataRevision: 1, findings: [] }),
        ...extras(recentSample(40, days), dailyResult(days, false), []),
      };
    case "sample":
    case "many": {
      const list = findings(many);
      const daily = dailyResult(days, many);
      return {
        ...base,
        ...extras(recentSample(many ? 640 : 172, days), daily, list),
        plugins: ready(pluginsResult(days, many)),
        blocks: ready(blocksResult(days)),
        daily: ready(daily),
        findings: ready({ asOf: NOW, dataRevision: 3, findings: list }),
        dismissed: ready({
          asOf: NOW,
          dataRevision: 3,
          findings: [
            {
              ...finding(
                "skill_never_read-d",
                "skill_never_read",
                "skill",
                "docs-voice",
                "tone-guide",
                { unit: "turns", value: 66 },
                {},
                66,
                [FIX, REMOVE],
              ),
              state: "dismissed",
            },
          ],
        }),
      };
    }
    default:
      return assertNever(scene, "Scene");
  }
}
