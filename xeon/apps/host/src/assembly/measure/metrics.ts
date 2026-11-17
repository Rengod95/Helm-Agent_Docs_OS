import { Bug, assertNever } from "@fresnel/contracts";
import labelsJson from "./metric-labels.json";
import type {
  Dim,
  Feasible,
  MetricNote,
  MetricRow,
  MetricValue,
  SubjectKind,
} from "@fresnel/contracts/wire";
import type { DailyCell } from "./turn-fold.ts";

// 지표 카탈로그와 질의 계산(문서 `review/m5/turn-record-metrics.md` §4.7, §5, §5.1). 순수 함수다.
// 입력은 카운터 묶음(`DailyCell`)뿐이다. 원본 창과 `tr_daily`로 접힌 창이 같은 카운터를 주므로 값도 같다(규칙 37~38).
// 값 규칙(규칙 39): 표본이 `minSample` 미만이면 `insufficient_sample`이고 값은 null이다. 계측이 꺼진 턴만 있으면 `unavailable`(measurement_off)이다. 0으로 채우지 않는다.
// 분위수는 2의 거듭제곱 칸 히스토그램의 근사다(칸 k의 대표값은 2^(k-1), 칸 0은 0). 같은 히스토그램이면 원본과 접힌 값이 같다.

/** 가능 열(§5)은 `Feasible`이다: 예 = exact, 근사 = approx, 부분 = partial, 아니오 = no */
export interface MetricCatalogEntry {
  readonly id: string;
  readonly label: { readonly ko: string; readonly en: string };
  readonly unit: string;
  readonly kind: "count" | "ratio" | "tokens" | "ms";
  readonly appliesTo: SubjectKind[];
  readonly feasible: Feasible;
  readonly definitionNote: string | null;
  /** 계산할 수 없는 이유. 있으면 값은 항상 unavailable이다 */
  readonly unavailable: "needs_loader" | "not_recorded" | null;
}

const INST: SubjectKind[] = ["instruction"];
const SKILL: SubjectKind[] = ["skill"];
const TOOL: SubjectKind[] = ["tool"];
const HOOK: SubjectKind[] = ["hook"];
const DRIVE: SubjectKind[] = ["drive"];
const BLOCK: SubjectKind[] = ["block"];

/** 라벨과 정의 노트는 `metric-labels.json`(번역 카탈로그, 검사 대상이 아니다)에서 읽는다. 모양은 컴파일 때 타입 주석으로 확인한다 */
interface LabelDoc {
  readonly labels: Readonly<Record<string, { readonly ko: string; readonly en: string }>>;
  readonly notes: Readonly<Record<string, string>>;
}
const LABEL_DOC: LabelDoc = labelsJson;

function labelOf(id: string): { readonly ko: string; readonly en: string } {
  const label = LABEL_DOC.labels[id];
  if (label === undefined) throw new Bug(`metric-labels.json has no label for ${id}`);
  return label;
}

function notesOf(id: string): string | null {
  return LABEL_DOC.notes[id] ?? null;
}

function entry(
  id: string,
  unit: string,
  kind: MetricCatalogEntry["kind"],
  appliesTo: SubjectKind[],
  feasible: Feasible,
  unavailable: MetricCatalogEntry["unavailable"] = null,
): MetricCatalogEntry {
  return {
    id,
    label: labelOf(id),
    unit,
    kind,
    appliesTo,
    feasible,
    definitionNote: notesOf(id),
    unavailable,
  };
}

const ANSWERS = ["allow", "deny", "answer", "cancelled", "expired", "noninteractive"] as const;
const OUTCOMES = ["pass", "modified", "asked", "blocked", "error", "timeout", "skipped"] as const;
const POST = [
  "stopped",
  "repeat",
  "rewrite",
  "rewrite_text",
  "other_tool_same_target",
  "different_path",
] as const;
/** 반납 사유 값(저장된 `lease.released.reason` 그대로, §3.2 `FrameMark.exitReason`) */
const DRIVE_EXITS = [
  "done",
  "budget",
  "error",
  "idle",
  "revoked",
  "restart",
  "waiting",
  "disabled",
] as const;

/** 지표 카탈로그. §5의 행 전부이고, 분포 지표는 갈래마다 한 줄씩 더 낸다(`hook.outcomes.<갈래>`) [제안] */
export const METRIC_CATALOG: readonly MetricCatalogEntry[] = [
  entry("inst.loaded_turns", "turns", "count", INST, "exact"),
  entry("inst.tokens", "tokens", "tokens", INST, "approx"),
  entry("inst.tokens.p95", "tokens", "tokens", INST, "approx"),
  entry("inst.truncated", "ratio", "ratio", INST, "partial"),
  entry("inst.defied", "ratio", "ratio", INST, "approx"),
  entry("inst.defied_calls", "calls", "count", INST, "approx"),
  entry("skill.listed_turns", "turns", "count", SKILL, "exact"),
  entry("skill.read_turns", "turns", "count", SKILL, "partial"),
  entry("skill.activation_rate", "ratio", "ratio", SKILL, "partial"),
  entry("skill.read_origin", "ratio", "ratio", SKILL, "exact"),
  entry("skill.activation_by_model", "ratio", "ratio", SKILL, "approx"),
  entry("skill.never_read", "items", "count", SKILL, "partial"),
  entry("tool.calls", "calls", "count", TOOL, "exact"),
  entry("tool.calls.executed", "calls", "count", TOOL, "exact"),
  entry("tool.error_rate", "ratio", "ratio", TOOL, "exact"),
  entry("tool.duration", "ms", "ms", TOOL, "approx"),
  entry("tool.duration.p95", "ms", "ms", TOOL, "approx"),
  entry("tool.result_tokens", "tokens", "tokens", TOOL, "approx"),
  entry("tool.result_tokens.p95", "tokens", "tokens", TOOL, "approx"),
  entry("tool.never_called", "items", "count", TOOL, "exact"),
  entry("tool.never_called.tokens", "tokens", "tokens", TOOL, "approx"),
  entry("tool.deferred_activation", "ratio", "ratio", TOOL, "exact"),
  entry("hook.runs", "runs", "count", HOOK, "exact"),
  entry("hook.outcomes", "runs", "count", HOOK, "exact"),
  ...OUTCOMES.map((o) => entry(`hook.outcomes.${o}`, "ratio", "ratio", HOOK, "exact")),
  entry("hook.ask_answers", "runs", "count", HOOK, "exact"),
  ...ANSWERS.map((a) => entry(`hook.ask_answers.${a}`, "ratio", "ratio", HOOK, "exact")),
  entry("hook.duration", "ms", "ms", HOOK, "approx"),
  entry("hook.duration.p95", "ms", "ms", HOOK, "approx"),
  entry("hook.fault_rate", "ratio", "ratio", HOOK, "exact"),
  entry("hook.fault_rate.timeout", "ratio", "ratio", HOOK, "exact"),
  entry("hook.hit_rate", "ratio", "ratio", HOOK, "exact"),
  entry("hook.shadowed", "ratio", "ratio", HOOK, "exact"),
  entry("hook.post_block", "runs", "count", HOOK, "exact"),
  ...POST.map((p) =>
    entry(
      `hook.post_block.${p}`,
      "ratio",
      "ratio",
      HOOK,
      p === "rewrite_text" ? "approx" : "partial",
    ),
  ),
  entry("hook.post_block.bypass_suspect", "ratio", "ratio", HOOK, "approx"),
  entry("drive.entries", "runs", "count", DRIVE, "exact"),
  entry("drive.usage_vs_limit", "ratio", "ratio", DRIVE, "exact"),
  entry("drive.usage_vs_limit.spawns", "ratio", "ratio", DRIVE, "exact"),
  entry("drive.usage_vs_limit.tokens", "ratio", "ratio", DRIVE, "exact"),
  entry("drive.exit_reasons", "runs", "count", DRIVE, "exact"),
  ...DRIVE_EXITS.map((r) => entry(`drive.exit_reasons.${r}`, "ratio", "ratio", DRIVE, "exact")),
  entry("drive.asks", "runs", "count", DRIVE, "exact"),
  entry("block.time_split", "ms", "ms", BLOCK, "approx"),
  entry("block.time_split.tools", "ms", "ms", BLOCK, "approx"),
  entry("block.time_split.hook", "ms", "ms", BLOCK, "approx"),
  entry("block.time_split.ask", "ms", "ms", BLOCK, "approx"),
  entry("block.time_split.model", "ms", "ms", BLOCK, "approx", "not_recorded"),
  entry("block.time_split.rest", "ms", "ms", BLOCK, "approx"),
  entry("block.compactions", "runs", "count", BLOCK, "exact", "not_recorded"),
  entry("block.cache_hit_rate", "ratio", "ratio", BLOCK, "approx"),
  entry("block.cache_breaks", "runs", "count", BLOCK, "partial"),
  entry("block.cache_breaks.predicted", "runs", "count", BLOCK, "partial"),
  entry("block.cache_breaks.unattributed", "ratio", "ratio", BLOCK, "approx"),
  entry("block.cache_breaks_by_plugin", "runs", "count", BLOCK, "approx"),
  entry("block.cache_breaks_by_plugin.inferred", "ratio", "ratio", BLOCK, "approx"),
  entry("block.cache_breaks_by_plugin.tokens", "tokens", "tokens", BLOCK, "approx"),
  entry(
    "ver.compare",
    "ratio",
    "ratio",
    ["tool", "hook", "instruction", "skill"],
    "approx",
    "not_recorded",
  ),
  entry("cost.always", "tokens", "tokens", ["instruction", "tool"], "approx"),
  entry("cost.drive", "tokens", "tokens", ["drive"], "approx"),
  entry("cost.on_demand", "tokens", "tokens", ["skill", "tool"], "approx"),
];

const CATALOG_BY_ID: ReadonlyMap<string, MetricCatalogEntry> = new Map(
  METRIC_CATALOG.map((m) => [m.id, m]),
);

export function metricIsKnown(id: string): boolean {
  return CATALOG_BY_ID.has(id);
}

// ---- 필터와 묶음 -------------------------------------------------------------

/** 필터의 정규화 값. 기간과 범위는 저장소 질의가 쓰고 여기서는 카운터 키를 거른다 */
export interface CounterFilter {
  readonly profileId: string | null;
  readonly plugin: string | null;
  readonly modelVersion: string | null;
  readonly caller: "main" | "subagent" | "any";
}

/** 카운터 키에서 차원 값을 꺼낸다. 버전 차원은 카운터에 없어 null이다 */
function dimValueOf(cell: DailyCell, dim: Dim): string | null {
  switch (dim) {
    case "plugin":
      return cell.key.plugin;
    case "ref":
    case "hook":
      return cell.key.ref;
    case "model":
      return cell.key.model;
    case "profile":
      return cell.key.profile;
    case "scope":
      return cell.key.scopeKind;
    case "caller":
      return cell.key.caller;
    case "day":
      return cell.key.day;
    case "pluginVersion":
      return null;
    default:
      return assertNever(dim, "dimValueOf");
  }
}

/** 필터가 카운터를 거른다. 호출자 필터는 호출 단위 키(caller가 빈 문자열이 아닌 칸)에만 건다 */
export function passesFilter(cell: DailyCell, filter: CounterFilter): boolean {
  if (filter.profileId !== null && cell.key.profile !== filter.profileId) return false;
  if (filter.modelVersion !== null && cell.key.model !== filter.modelVersion) return false;
  if (filter.plugin !== null && cell.key.plugin !== filter.plugin) return false;
  if (filter.caller !== "any" && cell.key.caller !== "" && cell.key.caller !== filter.caller) {
    return false;
  }
  return true;
}

// ---- 값 만들기 ---------------------------------------------------------------

function countOf(cells: readonly DailyCell[]): number {
  return cells.reduce((sum, cell) => sum + cell.agg.n, 0);
}

function sumOf(cells: readonly DailyCell[]): number {
  return cells.reduce((sum, cell) => sum + cell.agg.sum, 0);
}

function pick(
  cells: readonly DailyCell[],
  subject: string,
  counter: (name: string) => boolean,
): DailyCell[] {
  return cells.filter((cell) => cell.key.subject === subject && counter(cell.key.counter));
}

function exactly(name: string): (counter: string) => boolean {
  return (counter) => counter === name;
}

function countValue(n: number): MetricValue {
  return { value: n, n, state: "exact" };
}

function rateValue(
  num: number,
  den: number,
  minSample: number,
  state: "exact" | "approx",
): MetricValue {
  if (den === 0 || den < minSample) {
    return { value: null, n: den, denom: den, state: "insufficient_sample" };
  }
  return { value: num / den, n: den, denom: den, state };
}

function quantileValue(cells: readonly DailyCell[], p: number, minSample: number): MetricValue {
  const merged: number[] = Array.from({ length: 20 }, () => 0);
  let total = 0;
  for (const cell of cells) {
    const hist = cell.agg.hist;
    if (hist === null) continue;
    hist.forEach((count, index) => {
      merged[index] = (merged[index] ?? 0) + count;
    });
    total += hist.reduce((sum, count) => sum + count, 0);
  }
  if (total === 0 || total < minSample) {
    return { value: null, n: total, state: "insufficient_sample" };
  }
  const rank = Math.max(1, Math.ceil(p * total));
  let cumulative = 0;
  for (let bucket = 0; bucket < merged.length; bucket += 1) {
    cumulative += merged[bucket] ?? 0;
    if (cumulative >= rank) return { value: representativeOf(bucket), n: total, state: "approx" };
  }
  return { value: representativeOf(merged.length - 1), n: total, state: "approx" };
}

/** 칸의 대표값. 칸 0은 0, 칸 k는 비트 길이가 k인 값들의 낮은 끝 2^(k-1)이다 */
function representativeOf(bucket: number): number {
  return bucket === 0 ? 0 : 2 ** (bucket - 1);
}

function unavailableValue(
  reason: "measurement_off" | "not_recorded" | "needs_loader",
): MetricValue {
  return { value: null, n: 0, state: "unavailable", reason };
}

// ---- 지표 계산 ---------------------------------------------------------------

interface ComputeContext {
  readonly minSample: number;
}

type Compute = (cells: readonly DailyCell[], ctx: ComputeContext) => MetricValue;

/** 같은 키로 묶어 이름별 합을 낸다(도구, 스킬 단위 표본) */
function byRef(
  cells: readonly DailyCell[],
  subject: string,
): Map<string, { readonly plugin: string; readonly ref: string; readonly cells: DailyCell[] }> {
  const out = new Map<string, { plugin: string; ref: string; cells: DailyCell[] }>();
  for (const cell of cells) {
    if (cell.key.subject !== subject) continue;
    const id = JSON.stringify([cell.key.plugin, cell.key.ref]);
    const group = out.get(id) ?? { plugin: cell.key.plugin, ref: cell.key.ref, cells: [] };
    group.cells.push(cell);
    out.set(id, group);
  }
  return out;
}

const hookRuns = (cells: readonly DailyCell[]): number =>
  countOf(
    pick(cells, "hook", (name) =>
      ["passed", "modified", "blocked", "failed", "skipped"].includes(name),
    ),
  );

const outcomeCount = (cells: readonly DailyCell[], name: string): number =>
  countOf(pick(cells, "hook_outcome", exactly(`outcome:${name}`)));

const postCount = (cells: readonly DailyCell[], name: string): number =>
  countOf(pick(cells, "postblock", exactly(`post:${name}`)));

const askCount = (cells: readonly DailyCell[]): number =>
  countOf(pick(cells, "hook", (name) => name.startsWith("ask:")));

function instDefied(cells: readonly DailyCell[], ctx: ComputeContext): MetricValue {
  const loaded = countOf(pick(cells, "instruction", exactly("loaded_turns")));
  const defied = countOf(pick(cells, "instruction", exactly("defied_turns")));
  return rateValue(defied, loaded, ctx.minSample, "approx");
}

function skillRate(cells: readonly DailyCell[], ctx: ComputeContext): MetricValue {
  const listed = countOf(pick(cells, "skill", exactly("listed_turns")));
  const read = countOf(pick(cells, "skill", exactly("read_turns")));
  return rateValue(read, listed, ctx.minSample, "exact");
}

/** 지표 id → 계산. 분포의 갈래는 아래에서 만든다 */
const COMPUTE = new Map<string, Compute>([
  [
    "inst.loaded_turns",
    (c) => countValue(countOf(pick(c, "instruction", exactly("loaded_turns")))),
  ],
  [
    "inst.tokens",
    (c, x) => quantileValue(pick(c, "instruction", exactly("always_tokens")), 0.5, x.minSample),
  ],
  [
    "inst.tokens.p95",
    (c, x) => quantileValue(pick(c, "instruction", exactly("always_tokens")), 0.95, x.minSample),
  ],
  [
    "inst.truncated",
    (c, x) =>
      rateValue(
        countOf(pick(c, "instruction", exactly("truncated_turns"))),
        countOf(pick(c, "instruction", exactly("loaded_turns"))),
        x.minSample,
        "exact",
      ),
  ],
  ["inst.defied", instDefied],
  [
    "inst.defied_calls",
    (c) => countValue(countOf(pick(c, "instruction", exactly("defied_calls")))),
  ],
  ["skill.listed_turns", (c) => countValue(countOf(pick(c, "skill", exactly("listed_turns"))))],
  ["skill.read_turns", (c) => countValue(countOf(pick(c, "skill", exactly("read_turns"))))],
  ["skill.activation_rate", skillRate],
  [
    "skill.read_origin",
    (c, x) => {
      const origin = pick(c, "skill_via", (name) => name.startsWith("via:"));
      const model = countOf(pick(c, "skill_via", exactly("via:model")));
      return rateValue(model, countOf(origin), x.minSample, "exact");
    },
  ],
  ["skill.activation_by_model", skillRate],
  [
    "skill.never_read",
    (c, x) => {
      let never = 0;
      let considered = 0;
      for (const group of byRef(c, "skill").values()) {
        const listed = countOf(group.cells.filter((cell) => cell.key.counter === "listed_turns"));
        if (listed < x.minSample) continue;
        considered += 1;
        const read = countOf(group.cells.filter((cell) => cell.key.counter === "read_turns"));
        if (read === 0) never += 1;
      }
      return {
        value: never,
        n: considered,
        state: considered === 0 ? "insufficient_sample" : "exact",
      };
    },
  ],
  ["tool.calls", (c) => countValue(countOf(pick(c, "call", () => true)))],
  ["tool.calls.executed", (c) => countValue(countOf(pick(c, "call", exactly("allowed"))))],
  [
    "tool.error_rate",
    (c, x) =>
      rateValue(
        countOf(pick(c, "call_exec", exactly("error"))),
        countOf(pick(c, "call_exec", exactly("executed"))),
        x.minSample,
        "exact",
      ),
  ],
  [
    "tool.duration",
    (c, x) =>
      quantileValue(
        pick(c, "call", () => true),
        0.5,
        x.minSample,
      ),
  ],
  [
    "tool.duration.p95",
    (c, x) =>
      quantileValue(
        pick(c, "call", () => true),
        0.95,
        x.minSample,
      ),
  ],
  [
    "tool.result_tokens",
    (c, x) => quantileValue(pick(c, "call_exec", exactly("result_tokens")), 0.5, x.minSample),
  ],
  [
    "tool.result_tokens.p95",
    (c, x) => quantileValue(pick(c, "call_exec", exactly("result_tokens")), 0.95, x.minSample),
  ],
  [
    "tool.never_called",
    (c, x) => {
      let never = 0;
      let considered = 0;
      for (const group of byRef(c, "tool").values()) {
        const advertised = group.cells.filter((cell) => cell.key.counter === "advertised_turns");
        const n = countOf(advertised);
        if (n < x.minSample) continue;
        considered += 1;
        if (countOf(group.cells.filter((cell) => cell.key.counter === "called")) === 0) never += 1;
      }
      return {
        value: never,
        n: considered,
        state: considered === 0 ? "insufficient_sample" : "exact",
      };
    },
  ],
  [
    "tool.never_called.tokens",
    (c, x) => {
      let tokens = 0;
      let turns = 0;
      for (const group of byRef(c, "tool").values()) {
        const advertised = group.cells.filter((cell) => cell.key.counter === "advertised_turns");
        const n = countOf(advertised);
        if (n < x.minSample) continue;
        if (countOf(group.cells.filter((cell) => cell.key.counter === "called")) !== 0) continue;
        tokens += sumOf(advertised) / n;
        turns += 1;
      }
      return { value: tokens, n: turns, state: turns === 0 ? "insufficient_sample" : "approx" };
    },
  ],
  [
    "tool.deferred_activation",
    (c, x) => {
      const activated = countOf(pick(c, "tool_state", exactly("activated_turns")));
      const deferred = countOf(pick(c, "tool", exactly("deferred_turns")));
      return rateValue(activated, activated + deferred, x.minSample, "exact");
    },
  ],
  ["hook.runs", (c) => countValue(hookRuns(c))],
  ["hook.ask_answers", (c) => countValue(askCount(c))],
  [
    "hook.duration",
    (c, x) =>
      quantileValue(
        pick(c, "hook", () => true),
        0.5,
        x.minSample,
      ),
  ],
  [
    "hook.duration.p95",
    (c, x) =>
      quantileValue(
        pick(c, "hook", () => true),
        0.95,
        x.minSample,
      ),
  ],
  [
    "hook.fault_rate",
    (c, x) =>
      rateValue(countOf(pick(c, "hook", exactly("failed"))), hookRuns(c), x.minSample, "exact"),
  ],
  [
    "hook.fault_rate.timeout",
    (c, x) =>
      rateValue(
        countOf(pick(c, "hook", exactly("reason:timeout"))),
        hookRuns(c),
        x.minSample,
        "exact",
      ),
  ],
  [
    "hook.hit_rate",
    (c, x) => {
      const hits =
        outcomeCount(c, "blocked") + outcomeCount(c, "modified") + outcomeCount(c, "asked");
      const runs = outcomeTotal(c);
      return rateValue(hits, runs, x.minSample, "exact");
    },
  ],
  [
    "hook.shadowed",
    (c, x) =>
      rateValue(
        countOf(pick(c, "hook_outcome", exactly("shadowed"))),
        outcomeTotal(c),
        x.minSample,
        "exact",
      ),
  ],
  ["hook.post_block", (c) => countValue(postTotal(c))],
  [
    "hook.post_block.bypass_suspect",
    (c, x) => {
      const suspect =
        postCount(c, "rewrite") +
        postCount(c, "rewrite_text") +
        postCount(c, "other_tool_same_target");
      return rateValue(suspect, postTotal(c), x.minSample, "approx");
    },
  ],
  ["cost.always", (c, x) => meanValue(pick(c, "cost", exactly("always")), x.minSample)],
  ["cost.drive", (c, x) => meanValue(pick(c, "cost", exactly("drive")), x.minSample)],
  ["cost.on_demand", (c, x) => meanValue(pick(c, "cost", exactly("on_demand")), x.minSample)],
  // 블록 시간: 턴마다 한 번 센 합의 평균(ms/턴). 모델 대기는 행에 없어 `block.time_split.model`은 not_recorded다
  ["block.time_split", (c, x) => meanValue(pick(c, "block", exactly("turn_ms")), x.minSample)],
  [
    "block.time_split.tools",
    (c, x) => meanValue(pick(c, "block", exactly("tools_ms")), x.minSample),
  ],
  ["block.time_split.hook", (c, x) => meanValue(pick(c, "block", exactly("hook_ms")), x.minSample)],
  ["block.time_split.ask", (c, x) => meanValue(pick(c, "block", exactly("ask_ms")), x.minSample)],
  ["block.time_split.rest", (c, x) => meanValue(pick(c, "block", exactly("rest_ms")), x.minSample)],
  // 캐시 적중: 칸의 합 비율(cacheRead / (input + cacheRead + cacheWrite))
  [
    "block.cache_hit_rate",
    (c, x) => sumRatio(c, "block", "cache_read", "cache_input", x.minSample, "approx"),
  ],
  ["block.cache_breaks", (c) => breakCount(c, "break_observed")],
  ["block.cache_breaks.predicted", (c) => breakCount(c, "break_predicted")],
  [
    "block.cache_breaks.unattributed",
    (c, x) =>
      rateValue(
        countOf(pick(c, "block", exactly("break_unattributed"))),
        countOf(pick(c, "block", exactly("break_observed"))),
        x.minSample,
        "approx",
      ),
  ],
  [
    "block.cache_breaks_by_plugin",
    (c) => countValue(countOf(pick(c, "cache", exactly("break_observed")))),
  ],
  [
    "block.cache_breaks_by_plugin.inferred",
    (c, x) =>
      rateValue(
        countOf(pick(c, "cache", exactly("break_inferred"))),
        countOf(pick(c, "cache", exactly("break_observed"))),
        x.minSample,
        "approx",
      ),
  ],
  // 관찰된 깨짐의 캐시 쓰기 토큰을 플러그인 턴 수로 나눈 값(턴당 토큰, §6 cache_break_by_plugin의 영향)
  [
    "block.cache_breaks_by_plugin.tokens",
    (c, x) => {
      const turns = countOf(pick(c, "cache", exactly("plugin_turns")));
      if (turns === 0 || turns < x.minSample) {
        return { value: null, n: turns, state: "insufficient_sample" };
      }
      const write = sumOf(pick(c, "cache", exactly("break_write")));
      return { value: write / turns, n: turns, state: "approx" };
    },
  ],
  // 주도: 프레임 행이 있을 때만 값이 있다(`valuesFor`가 행이 없으면 not_recorded로 막는다)
  ["drive.entries", (c) => countValue(countOf(pick(c, "drive", exactly("entries"))))],
  ["drive.exit_reasons", (c) => countValue(driveExits(c))],
  ["drive.asks", (c) => countValue(countOf(pick(c, "drive", exactly("asks"))))],
  [
    "drive.usage_vs_limit",
    (c, x) => sumRatio(c, "drive", "used:turns", "limit:turns", x.minSample, "exact"),
  ],
  [
    "drive.usage_vs_limit.spawns",
    (c, x) => sumRatio(c, "drive", "used:spawns", "limit:spawns", x.minSample, "exact"),
  ],
  [
    "drive.usage_vs_limit.tokens",
    (c, x) => sumRatio(c, "drive", "used:tokens", "limit:tokens", x.minSample, "exact"),
  ],
]);

/** 블록의 깨짐 계산: 관찰(또는 예측)된 단계 수. 분모는 단계 수다 */
function breakCount(cells: readonly DailyCell[], counter: string): MetricValue {
  const steps = countOf(pick(cells, "block", exactly("steps")));
  return {
    value: countOf(pick(cells, "block", exactly(counter))),
    n: steps,
    denom: steps,
    state: "exact",
  };
}

/** 주도 프레임의 반납 수(사유가 있는 프레임). 사유별 칸의 분모다 */
function driveExits(cells: readonly DailyCell[]): number {
  return countOf(pick(cells, "drive", exactly("exits")));
}

/** 칸 합의 비율. 분모 칸이 없거나 표본이 적거나 합이 0이면 `insufficient_sample`이다 */
function sumRatio(
  cells: readonly DailyCell[],
  subject: string,
  numerator: string,
  denominator: string,
  minSample: number,
  state: "exact" | "approx",
): MetricValue {
  const denCells = pick(cells, subject, exactly(denominator));
  const n = countOf(denCells);
  const den = sumOf(denCells);
  if (n === 0 || n < minSample || den === 0) {
    return { value: null, n, state: "insufficient_sample" };
  }
  return { value: sumOf(pick(cells, subject, exactly(numerator))) / den, n, state };
}

function outcomeTotal(cells: readonly DailyCell[]): number {
  return countOf(pick(cells, "hook_outcome", (name) => name.startsWith("outcome:")));
}

function postTotal(cells: readonly DailyCell[]): number {
  return countOf(pick(cells, "postblock", (name) => name.startsWith("post:")));
}

function meanValue(cells: readonly DailyCell[], minSample: number): MetricValue {
  const n = countOf(cells);
  if (n === 0 || n < minSample) return { value: null, n, state: "insufficient_sample" };
  return { value: sumOf(cells) / n, n, state: "approx" };
}

// 분포의 갈래는 같은 계산을 이름만 바꿔 낸다
COMPUTE.set("hook.outcomes", (c) => countValue(outcomeTotal(c)));
for (const outcome of OUTCOMES) {
  COMPUTE.set(`hook.outcomes.${outcome}`, (c, x) =>
    rateValue(outcomeCount(c, outcome), outcomeTotal(c), x.minSample, "exact"),
  );
}
for (const answer of ANSWERS) {
  COMPUTE.set(`hook.ask_answers.${answer}`, (c, x) =>
    rateValue(
      countOf(pick(c, "hook", exactly(`ask:${answer}`))),
      askCount(c),
      x.minSample,
      "exact",
    ),
  );
}
for (const posted of POST) {
  COMPUTE.set(`hook.post_block.${posted}`, (c, x) => {
    // 인자 토큰 목록이 한 번도 없으면 `rewrite_text`는 겹침을 잴 수 없다. 0으로 세지 않는다
    if (posted === "rewrite_text" && countOf(pick(c, "postblock", exactly("args_known"))) === 0) {
      return unavailableValue("not_recorded");
    }
    return rateValue(postCount(c, posted), postTotal(c), x.minSample, "approx");
  });
}
for (const reason of DRIVE_EXITS) {
  COMPUTE.set(`drive.exit_reasons.${reason}`, (c, x) =>
    rateValue(
      countOf(pick(c, "drive", exactly(`exit:${reason}`))),
      driveExits(c),
      x.minSample,
      "exact",
    ),
  );
}

// ---- 질의 -------------------------------------------------------------------

export interface MetricsQueryInput {
  readonly cells: readonly DailyCell[];
  readonly metrics: readonly string[];
  readonly groupBy: readonly Dim[];
  readonly filter: CounterFilter;
  readonly minSample: number;
  /** 창의 턴 수(계측 켜짐, 꺼짐). 꺼진 턴만 있으면 값은 measurement_off다 */
  readonly turnsFull: number;
  readonly turnsOff: number;
  /** 창의 일부가 보관 기간을 넘어 접힌 날에 기대는지(주석용) */
  readonly partialWindow: boolean;
}

export interface MetricsQueryOutput {
  readonly rows: MetricRow[];
  readonly notes: MetricNote[];
}

/** 묶음 값으로 한 행을 만든다. 카탈로그 불가 이유가 있는 지표는 계산 없이 unavailable이다 */
function valuesFor(
  cells: readonly DailyCell[],
  input: MetricsQueryInput,
  framesRecorded: boolean,
): Record<string, MetricValue> {
  const values: Record<string, MetricValue> = {};
  for (const id of input.metrics) {
    const def = CATALOG_BY_ID.get(id);
    if (def === undefined) continue;
    if (def.unavailable !== null) {
      values[id] = unavailableValue(def.unavailable);
      continue;
    }
    if (input.turnsFull === 0 && input.turnsOff > 0) {
      values[id] = unavailableValue("measurement_off");
      continue;
    }
    // 주도 지표는 프레임 행이 한 번도 없으면 값이 없다(enC2m이 프레임을 쓰기 전). 0으로 채우지 않는다
    if (def.appliesTo.includes("drive") && !framesRecorded) {
      values[id] = unavailableValue("not_recorded");
      continue;
    }
    const compute = COMPUTE.get(id);
    values[id] =
      compute === undefined
        ? unavailableValue("not_recorded")
        : compute(cells, { minSample: input.minSample });
  }
  return values;
}

/**
 * 지표 질의. 필터를 거른 카운터를 묶음 차원(`groupBy`)으로 나눠 행마다 값을 낸다.
 * `pluginVersion` 차원은 카운터 키에 없어서 그 묶음의 값은 전부 `not_recorded`다.
 */
export function queryMetrics(input: MetricsQueryInput): MetricsQueryOutput {
  const filtered = input.cells.filter((cell) => passesFilter(cell, input.filter));
  // 프레임 기록 여부는 플러그인 칸이 없는 표지(`frame_turns`)로 본다. 플러그인 필터로 걸러지지 않게 뺀다
  const framesRecorded = input.cells.some(
    (cell) =>
      cell.key.subject === "drive" &&
      cell.key.counter === "frame_turns" &&
      passesFilter(cell, { ...input.filter, plugin: null }),
  );
  const groups = new Map<string, { key: Partial<Record<Dim, string>>; cells: DailyCell[] }>();
  if (input.groupBy.length === 0) {
    groups.set("{}", { key: {}, cells: filtered });
  } else {
    for (const cell of filtered) {
      const key: Partial<Record<Dim, string>> = {};
      for (const dim of input.groupBy) {
        const value = dimValueOf(cell, dim);
        if (value !== null) key[dim] = value;
      }
      const id = JSON.stringify(key);
      const group = groups.get(id) ?? { key, cells: [] };
      group.cells.push(cell);
      groups.set(id, group);
    }
  }
  const rows: MetricRow[] = [];
  for (const group of groups.values()) {
    rows.push({ key: group.key, values: valuesFor(group.cells, input, framesRecorded) });
  }
  if (rows.length === 0) {
    rows.push({ key: {}, values: valuesFor([], input, framesRecorded) });
  }
  const notes: MetricNote[] = [];
  for (const id of input.metrics) {
    if (input.turnsOff > 0) {
      notes.push({ metric: id, code: "measurement_off", text: null });
    }
    if (input.partialWindow) {
      notes.push({ metric: id, code: "partial_window", text: null });
    }
  }
  return { rows, notes };
}

export interface CompareInput extends MetricsQueryInput {
  readonly by: "model";
  readonly a: string;
  readonly b: string;
}

/**
 * 모델 버전으로 두 그룹을 나란히 낸다(규칙 40). 카운터 키에 모델이 있어 거르기만 하면 된다.
 * 버전과 개정은 키에 없어 `turn-read.ts`가 원본 턴으로 나눈다(`compareByGroups`).
 * 다른 차원(프로필 id)이 두 그룹에서 함께 바뀌었으면 `confounded` 주석을 단다. 인과는 말하지 않는다.
 */
export function compareMetrics(input: CompareInput): MetricsQueryOutput {
  const groupA = queryMetrics({
    ...input,
    groupBy: [],
    filter: { ...input.filter, modelVersion: input.a },
  });
  const groupB = queryMetrics({
    ...input,
    groupBy: [],
    filter: { ...input.filter, modelVersion: input.b },
  });
  const rows: MetricRow[] = [
    { key: { model: input.a }, values: groupA.rows[0]?.values ?? {} },
    { key: { model: input.b }, values: groupB.rows[0]?.values ?? {} },
  ];
  const profiles = (model: string): Set<string> =>
    new Set(
      input.cells
        .filter((cell) => cell.key.model === model && cell.key.subject === "turn")
        .map((cell) => cell.key.profile),
    );
  const pa = profiles(input.a);
  const pb = profiles(input.b);
  const changed = [...pa].some((p) => !pb.has(p)) || [...pb].some((p) => !pa.has(p));
  const notes: MetricNote[] = changed
    ? input.metrics.map((id) => ({ metric: id, code: "confounded", text: null }))
    : [];
  return { rows, notes };
}
