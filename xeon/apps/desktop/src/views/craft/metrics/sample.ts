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
} from "@fresnel/contracts/wire";
import { BLOCK_TIME_METRICS, DAILY_METRICS, PLUGIN_METRICS, type MetricsFilter } from "./model.ts";
import type { Load, MetricsActions, MetricsData } from "./source.ts";

export const SCENES = [
  "live",
  "sample",
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
      },
    });
  }
  return { window: window(days), rows, notes: [] };
}

function evidence(n: number): EvidenceRef[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: "turn" as const,
    threadId: "thr_sample",
    turnId: `trn_sample_${String(i + 1)}`,
  }));
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
  for (let i = 0; i < 13; i += 1) {
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
  };
  const all = (load: Load<never>): MetricsData => ({
    ...base,
    plugins: load,
    blocks: load,
    daily: load,
    findings: load,
    dismissed: load,
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
      };
    }
    case "sample":
    case "many": {
      const list = findings(many);
      return {
        ...base,
        plugins: ready(pluginsResult(days, many)),
        blocks: ready(blocksResult(days)),
        daily: ready(dailyResult(days, many)),
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
