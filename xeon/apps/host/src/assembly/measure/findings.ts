import type {
  EvidenceRef,
  Finding,
  FindingBundle,
  MetricValue,
  SubjectKind,
} from "@fresnel/contracts/wire";
import { postBlockCallsOf } from "./turn-fold.ts";
import {
  BLOCK_REFS,
  blockOfCause,
  isBlockingVerdict,
  postBlockClassOf,
  type BlockRef,
} from "./classify.ts";
import type { TurnBundleRow } from "./store.ts";
import type { DailyCell } from "./turn-fold.ts";
import { queryMetrics } from "./metrics.ts";

// 살펴볼 것 규칙(문서 `review/m5/turn-record-metrics.md` §6, §4.7 규칙 41~43). 순수 함수다.
// 규칙은 카운터(지표)로 발동을 정하고 원본 턴 묶음으로 증거를 고른다. 증거는 보관 기간 안의 턴만 있다(접힌 턴은 증거가 되지 않는다).
// 임계는 문서의 [제안] 값이고 `x.operations.findings.overrides`(규칙 id → 숫자 임계 묶음)로 덮어쓴다.
// 발동은 `minSample`(기본 20)을 넘는 표본에서만 한다(지표 값이 insufficient_sample이면 발동하지 않는다). 규칙 고유 최소 표본은 그보다 클 때만 더 세운다.

const RULE_IDS = [
  "unused_tools",
  "ask_always_denied",
  "ask_always_allowed",
  "hook_slow_faulty",
  "hook_never_reached",
  "skill_activation_drop",
  "skill_never_read",
  "cache_break_by_plugin",
  "instruction_defied",
  "instruction_truncated",
  "repeat_after_block",
  "drive_budget_exhausted",
] as const;
type RuleId = (typeof RULE_IDS)[number];
const RULE_VERSION = 1;

/** 훅 예산(§3.6, 실제 훅 예산 30초). p95가 이 절반 이상이면 느린 훅이다 */
const HOOK_BUDGET_MS = 30_000;

/** 규칙별 임계 [제안]. 키는 덮어쓰기 목록의 이름이다 */
const RULE_DEFAULTS: Readonly<Record<RuleId, Readonly<Record<string, number>>>> = {
  unused_tools: { neverRatio: 0.5, tokensPerTurn: 500, minTurns: 30 },
  ask_always_denied: { minAsks: 5, denyRatio: 0.9 },
  ask_always_allowed: { minAsks: 10, allowRatio: 0.95 },
  hook_slow_faulty: { minRuns: 50, faultRatio: 0.03, p95BudgetRatio: 0.5 },
  hook_never_reached: { minRuns: 50, shadowRatio: 0.95 },
  skill_activation_drop: { segmentTurns: 20, absDiff: 0.2, ratio: 0.5 },
  skill_never_read: { minTurns: 50 },
  cache_break_by_plugin: { minBreaks: 10, turnShare: 0.2 },
  instruction_defied: { minTurns: 20, ratio: 0.3 },
  instruction_truncated: { ratio: 0.1 },
  repeat_after_block: { minBlocks: 10, share: 0.4 },
  drive_budget_exhausted: { minDrive: 5, budgetShare: 0.3 },
};

export type OverrideMap = Readonly<Record<string, Readonly<Record<string, number>>>>;

function thresholdsOf(ruleId: RuleId, overrides: OverrideMap): Readonly<Record<string, number>> {
  return { ...RULE_DEFAULTS[ruleId], ...overrides[ruleId] };
}

/** 발견 후보 한 건. 같은 규칙과 대상이면 같은 발견이다 */
export interface Candidate {
  readonly ruleId: RuleId;
  readonly subject: {
    readonly kind: SubjectKind;
    readonly plugin: string;
    readonly ref: string | null;
  };
  readonly impact: { readonly unit: "tokens_per_turn" | "hits" | "turns"; readonly value: number };
  readonly metrics: Record<string, MetricValue>;
  /** 증거 후보 전부. 최근 턴이 앞에 온다 */
  readonly evidence: readonly EvidenceRef[];
  readonly evidenceAt: readonly number[];
  readonly next: Finding["next"];
}

export interface FindingsInput {
  readonly cells: readonly DailyCell[];
  readonly bundles: readonly TurnBundleRow[];
  readonly minSample: number;
  readonly overrides: OverrideMap;
  readonly turnsFull: number;
  readonly turnsOff: number;
}

// 다음 걸음의 label은 메시지 id다. 문장은 클라이언트가 카탈로그에서 고른다(ADR-0016)
const FIX: Finding["next"][number] = { kind: "fix", target: "craft_chat", label: "next.fix" };
const PROMOTE: Finding["next"][number] = {
  kind: "promote",
  target: "craft_chat",
  label: "next.promote",
};
const REMOVE: Finding["next"][number] = { kind: "remove", target: "profile", label: "next.remove" };

/** 증거 후보 한 건: 참조와 턴 시작 시각(정렬용) */
interface EvidenceCandidate {
  readonly ref: EvidenceRef;
  readonly at: number;
}

/** 규칙이 낸 증거를 최근 순으로 정리하고 한 대화에서 다섯 개를 넘기지 않는다(대표 50개는 호출자가 고른다) */
function representativeEvidence(candidates: readonly EvidenceCandidate[]): {
  readonly items: EvidenceRef[];
  readonly at: number[];
} {
  const sorted = candidates.toSorted((a, b) => b.at - a.at);
  const perThread = new Map<string, number>();
  const items: EvidenceRef[] = [];
  const at: number[] = [];
  for (const candidate of sorted) {
    const thread = "threadId" in candidate.ref ? candidate.ref.threadId : "";
    const seen = perThread.get(thread) ?? 0;
    if (seen >= 5) continue;
    perThread.set(thread, seen + 1);
    items.push(candidate.ref);
    at.push(candidate.at);
  }
  return { items, at };
}

function turnRef(bundle: TurnBundleRow): EvidenceRef {
  return { kind: "turn", threadId: bundle.turn.threadId, turnId: bundle.turn.turnId };
}

function evidenceOf(
  bundles: readonly TurnBundleRow[],
  pick: (bundle: TurnBundleRow) => EvidenceRef[],
): EvidenceCandidate[] {
  const out: EvidenceCandidate[] = [];
  for (const bundle of bundles) {
    for (const ref of pick(bundle)) out.push({ ref, at: bundle.turn.startedAt });
  }
  return out;
}

/** 규칙 하나가 낸 후보를 증거와 함께 만든다. 증거가 없으면 후보를 버린다(접힌 턴만 있는 경우) */
function candidateOf(
  ruleId: RuleId,
  subject: Candidate["subject"],
  impact: Candidate["impact"],
  metrics: Record<string, MetricValue>,
  next: Finding["next"],
  candidates: readonly EvidenceCandidate[],
): Candidate {
  return {
    ruleId,
    subject,
    impact,
    metrics,
    evidence: candidates.toSorted((a, b) => b.at - a.at).map((c) => c.ref),
    evidenceAt: candidates.toSorted((a, b) => b.at - a.at).map((c) => c.at),
    next,
  };
}

/** 지표 행을 차원 묶음으로 얻는다. 값은 `queryMetrics`가 준 그대로다 */
function rowsOf(
  input: FindingsInput,
  groupBy: ("plugin" | "hook" | "ref" | "model")[],
  metrics: string[],
) {
  return queryMetrics({
    cells: input.cells,
    metrics,
    groupBy,
    filter: { profileId: null, plugin: null, modelVersion: null, caller: "any" },
    minSample: input.minSample,
    turnsFull: input.turnsFull,
    turnsOff: input.turnsOff,
    partialWindow: false,
  }).rows;
}

function numberOf(value: MetricValue | undefined): number | null {
  return value === undefined || value.value === null ? null : value.value;
}

/** 규칙마다 후보를 만든다. 발동은 임계와 표본(minSample)을 모두 넘어야 한다 */
export function evaluateRules(input: FindingsInput): Candidate[] {
  const out: Candidate[] = [];
  const t = (rule: RuleId) => thresholdsOf(rule, input.overrides);

  // 1. 안 불린 광고 도구(플러그인 단위)
  {
    const rule = t("unused_tools");
    for (const row of rowsOf(
      input,
      ["plugin"],
      ["tool.never_called", "tool.never_called.tokens"],
    )) {
      const plugin = row.key.plugin ?? "";
      const never = row.values["tool.never_called"];
      const tokens = numberOf(row.values["tool.never_called.tokens"]);
      if (never === undefined || never.state !== "exact" || never.n === 0 || tokens === null)
        continue;
      const ratio = (never.value ?? 0) / never.n;
      if (ratio < (rule.neverRatio ?? 0) || tokens < (rule.tokensPerTurn ?? 0)) continue;
      out.push(
        candidateOf(
          "unused_tools",
          { kind: "tool", plugin, ref: null },
          { unit: "tokens_per_turn", value: tokens },
          {
            "tool.never_called": never,
            "tool.never_called.tokens": { value: tokens, n: never.n, state: "approx" },
          },
          [FIX, REMOVE],
          evidenceOf(input.bundles, (b) =>
            b.tooluse.some((u) => u.plugin === plugin && u.state !== "deferred" && u.called === 0)
              ? [turnRef(b)]
              : [],
          ),
        ),
      );
    }
  }

  // 2·3. 물음에 거부·허용이 거의 전부인 훅
  for (const [ruleId, answer, need, share] of [
    ["ask_always_denied", "deny", "minAsks", "denyRatio"],
    ["ask_always_allowed", "allow", "minAsks", "allowRatio"],
  ] as const) {
    const rule = t(ruleId);
    const metricId = `hook.ask_answers.${answer}`;
    for (const row of rowsOf(input, ["plugin", "hook"], ["hook.ask_answers", metricId])) {
      const asks = row.values["hook.ask_answers"];
      const ratio = numberOf(row.values[metricId]);
      if (asks === undefined || asks.value === null || asks.value < (rule[need] ?? 0)) continue;
      if (ratio === null || ratio < (rule[share] ?? 1)) continue;
      const plugin = row.key.plugin ?? "";
      const hook = row.key.hook ?? "";
      out.push(
        candidateOf(
          ruleId,
          { kind: "hook", plugin, ref: hook },
          { unit: "hits", value: asks.value },
          { "hook.ask_answers": asks, [metricId]: row.values[metricId] ?? asks },
          ruleId === "ask_always_denied" ? [PROMOTE, REMOVE] : [FIX, REMOVE],
          evidenceOf(input.bundles, (b) =>
            b.hooks
              .filter((h) => h.plugin === plugin && h.hook === hook && h.askAnswer === answer)
              .map((h) => ({
                kind: "hook" as const,
                threadId: b.turn.threadId,
                turnId: b.turn.turnId,
                hookSeq: h.seqGlobal,
              })),
          ),
        ),
      );
    }
  }

  // 4. 느리거나 자주 실패하는 훅
  {
    const rule = t("hook_slow_faulty");
    for (const row of rowsOf(
      input,
      ["plugin", "hook"],
      ["hook.runs", "hook.fault_rate", "hook.duration.p95"],
    )) {
      const runs = row.values["hook.runs"];
      const fault = numberOf(row.values["hook.fault_rate"]);
      const p95 = numberOf(row.values["hook.duration.p95"]);
      if (runs === undefined || runs.value === null || runs.value < (rule.minRuns ?? 0)) continue;
      const slow = p95 !== null && p95 >= HOOK_BUDGET_MS * (rule.p95BudgetRatio ?? 0.5);
      const faulty = fault !== null && fault >= (rule.faultRatio ?? 0.03);
      if (!slow && !faulty) continue;
      const plugin = row.key.plugin ?? "";
      const hook = row.key.hook ?? "";
      out.push(
        candidateOf(
          "hook_slow_faulty",
          { kind: "hook", plugin, ref: hook },
          { unit: "hits", value: runs.value },
          {
            "hook.runs": runs,
            "hook.fault_rate": row.values["hook.fault_rate"] ?? runs,
            "hook.duration.p95": row.values["hook.duration.p95"] ?? runs,
          },
          [FIX],
          evidenceOf(input.bundles, (b) =>
            b.hooks
              .filter(
                (h) =>
                  h.plugin === plugin &&
                  h.hook === hook &&
                  (h.result === "failed" || h.ms >= HOOK_BUDGET_MS * 0.5),
              )
              .map((h) => ({
                kind: "hook" as const,
                threadId: b.turn.threadId,
                turnId: b.turn.turnId,
                hookSeq: h.seqGlobal,
              })),
          ),
        ),
      );
    }
  }

  // 5. 앞 훅에 늘 가려진 훅
  {
    const rule = t("hook_never_reached");
    for (const row of rowsOf(input, ["plugin", "hook"], ["hook.runs", "hook.shadowed"])) {
      const runs = row.values["hook.runs"];
      const shadowed = numberOf(row.values["hook.shadowed"]);
      if (runs === undefined || runs.value === null || runs.value < (rule.minRuns ?? 0)) continue;
      if (shadowed === null || shadowed < (rule.shadowRatio ?? 0)) continue;
      const plugin = row.key.plugin ?? "";
      const hook = row.key.hook ?? "";
      out.push(
        candidateOf(
          "hook_never_reached",
          { kind: "hook", plugin, ref: hook },
          { unit: "hits", value: runs.value },
          { "hook.runs": runs, "hook.shadowed": row.values["hook.shadowed"] ?? runs },
          [FIX, REMOVE],
          evidenceOf(input.bundles, (b) =>
            b.hooks
              .filter((h) => h.plugin === plugin && h.hook === hook && h.result === "skipped")
              .map((h) => ({
                kind: "hook" as const,
                threadId: b.turn.threadId,
                turnId: b.turn.turnId,
                hookSeq: h.seqGlobal,
              })),
          ),
        ),
      );
    }
  }

  // 6. 같은 스킬의 발동률이 두 모델 구간 사이에서 크게 떨어짐(§5.1-③)
  {
    const rule = t("skill_activation_drop");
    const segments = new Map<
      string,
      {
        readonly plugin: string;
        readonly skill: string;
        readonly rows: { model: string; listed: number; rate: number }[];
      }
    >();
    for (const row of rowsOf(
      input,
      ["plugin", "ref", "model"],
      ["skill.listed_turns", "skill.activation_rate"],
    )) {
      const listed = row.values["skill.listed_turns"];
      const rate = numberOf(row.values["skill.activation_rate"]);
      if (listed === undefined || listed.value === null || listed.value < (rule.segmentTurns ?? 0))
        continue;
      if (rate === null || row.key.model === undefined) continue;
      const plugin = row.key.plugin ?? "";
      const skill = row.key.ref ?? "";
      const id = JSON.stringify([plugin, skill]);
      const group = segments.get(id) ?? { plugin, skill, rows: [] };
      group.rows.push({ model: row.key.model, listed: listed.value, rate });
      segments.set(id, group);
    }
    for (const { plugin, skill, rows: list } of segments.values()) {
      if (list.length < 2) continue;
      const hi = list.reduce((best, s) => (s.rate > best.rate ? s : best));
      const lo = list.reduce((best, s) => (s.rate < best.rate ? s : best));
      if (hi.model === lo.model) continue;
      if (hi.rate - lo.rate < (rule.absDiff ?? 0)) continue;
      if (hi.rate === 0 || lo.rate / hi.rate > (rule.ratio ?? 0)) continue;
      out.push(
        candidateOf(
          "skill_activation_drop",
          { kind: "skill", plugin, ref: skill },
          { unit: "turns", value: lo.listed },
          {
            "skill.activation_rate": {
              value: lo.rate,
              n: lo.listed,
              state: "exact",
              denom: lo.listed,
            },
            "skill.listed_turns": { value: lo.listed, n: lo.listed, state: "exact" },
          },
          [FIX],
          evidenceOf(input.bundles, (b) =>
            b.turn.model === lo.model &&
            b.skills.some((s) => s.skill === skill && s.listed && !s.read)
              ? [turnRef(b)]
              : [],
          ),
        ),
      );
    }
  }

  // 7. 목록에 실렸으나 한 번도 읽히지 않은 스킬
  {
    const rule = t("skill_never_read");
    for (const row of rowsOf(
      input,
      ["plugin", "ref"],
      ["skill.listed_turns", "skill.read_turns"],
    )) {
      const listed = row.values["skill.listed_turns"];
      const read = row.values["skill.read_turns"];
      if (listed === undefined || listed.value === null || listed.value < (rule.minTurns ?? 0))
        continue;
      if (read === undefined || read.value !== 0) continue;
      const plugin = row.key.plugin ?? "";
      const skill = row.key.ref ?? "";
      out.push(
        candidateOf(
          "skill_never_read",
          { kind: "skill", plugin, ref: skill },
          { unit: "turns", value: listed.value },
          { "skill.listed_turns": listed, "skill.read_turns": read },
          [FIX, REMOVE],
          evidenceOf(input.bundles, (b) =>
            b.skills.some((s) => s.skill === skill && s.listed && !s.read) ? [turnRef(b)] : [],
          ),
        ),
      );
    }
  }

  // 8. 한 플러그인에 귀속된 관찰 캐시 깨짐(§5.1-⑤, §6). 표본은 그 플러그인이 낀 턴 수이고 영향은 턴당 캐시 쓰기 토큰이다
  {
    const rule = t("cache_break_by_plugin");
    const turns = pluginTurnsOf(input.cells);
    for (const row of rowsOf(
      input,
      ["plugin"],
      [
        "block.cache_breaks_by_plugin",
        "block.cache_breaks_by_plugin.tokens",
        "block.cache_breaks_by_plugin.inferred",
      ],
    )) {
      const plugin = row.key.plugin ?? "";
      const breaks = row.values["block.cache_breaks_by_plugin"];
      const tokens = row.values["block.cache_breaks_by_plugin.tokens"];
      const pluginTurns = turns.get(plugin) ?? 0;
      if (breaks === undefined || breaks.value === null || breaks.value === 0) continue;
      if (tokens === undefined || tokens.value === null) continue;
      if (pluginTurns < input.minSample) continue;
      const share = breaks.value / pluginTurns;
      if (breaks.value < (rule.minBreaks ?? 0) && share < (rule.turnShare ?? 1)) continue;
      out.push(
        candidateOf(
          "cache_break_by_plugin",
          { kind: "block", plugin, ref: dominantBlockOf(input.bundles, plugin) },
          { unit: "tokens_per_turn", value: tokens.value },
          {
            "block.cache_breaks_by_plugin": breaks,
            "block.cache_breaks_by_plugin.tokens": tokens,
            "block.cache_breaks_by_plugin.inferred":
              row.values["block.cache_breaks_by_plugin.inferred"] ?? tokens,
          },
          [FIX],
          evidenceOf(input.bundles, (b) =>
            b.cache
              .filter((c) => c.plugin === plugin && c.observed)
              .map((c) => ({
                kind: "turn" as const,
                threadId: b.turn.threadId,
                turnId: b.turn.turnId,
                stepIndex: c.stepIndex,
              }))
              .filter(
                (ref, index, all) =>
                  all.findIndex((other) => other.stepIndex === ref.stepIndex) === index,
              ),
          ),
        ),
      );
    }
  }

  // 9. 지침이 있는데 같은 플러그인 훅이 막거나 물은 턴 비율(§5.1-①)
  {
    const rule = t("instruction_defied");
    for (const row of rowsOf(input, ["plugin"], ["inst.loaded_turns", "inst.defied"])) {
      const loaded = row.values["inst.loaded_turns"];
      const defied = numberOf(row.values["inst.defied"]);
      if (loaded === undefined || loaded.value === null || loaded.value < (rule.minTurns ?? 0))
        continue;
      if (defied === null || defied < (rule.ratio ?? 0)) continue;
      const plugin = row.key.plugin ?? "";
      out.push(
        candidateOf(
          "instruction_defied",
          { kind: "instruction", plugin, ref: null },
          { unit: "turns", value: loaded.value },
          { "inst.loaded_turns": loaded, "inst.defied": row.values["inst.defied"] ?? loaded },
          [PROMOTE, FIX],
          evidenceOf(input.bundles, (b) => (definedBy(b, plugin) ? [turnRef(b)] : [])),
        ),
      );
    }
  }

  // 10. 잘린 지침이 든 턴 비율
  {
    const rule = t("instruction_truncated");
    for (const row of rowsOf(input, ["plugin"], ["inst.loaded_turns", "inst.truncated"])) {
      const loaded = row.values["inst.loaded_turns"];
      const truncated = numberOf(row.values["inst.truncated"]);
      if (loaded === undefined || loaded.value === null) continue;
      if (truncated === null || truncated < (rule.ratio ?? 0)) continue;
      const plugin = row.key.plugin ?? "";
      out.push(
        candidateOf(
          "instruction_truncated",
          { kind: "instruction", plugin, ref: null },
          { unit: "turns", value: loaded.value },
          { "inst.loaded_turns": loaded, "inst.truncated": row.values["inst.truncated"] ?? loaded },
          [FIX],
          evidenceOf(input.bundles, (b) =>
            b.materials.some((m) => m.plugin === plugin && m.kind === "always" && m.truncated)
              ? [turnRef(b)]
              : [],
          ),
        ),
      );
    }
  }

  // 11. 막은 뒤 같은 시도 또는 우회 의심이 많은 훅
  {
    const rule = t("repeat_after_block");
    for (const row of rowsOf(
      input,
      ["plugin", "hook"],
      ["hook.post_block", "hook.post_block.repeat", "hook.post_block.bypass_suspect"],
    )) {
      const blocks = row.values["hook.post_block"];
      const repeat = numberOf(row.values["hook.post_block.repeat"]);
      const bypass = numberOf(row.values["hook.post_block.bypass_suspect"]);
      if (blocks === undefined || blocks.value === null || blocks.value < (rule.minBlocks ?? 0))
        continue;
      if (repeat === null || bypass === null || repeat + bypass < (rule.share ?? 0)) continue;
      const plugin = row.key.plugin ?? "";
      const hook = row.key.hook ?? "";
      out.push(
        candidateOf(
          "repeat_after_block",
          { kind: "hook", plugin, ref: hook },
          { unit: "hits", value: blocks.value },
          {
            "hook.post_block": blocks,
            "hook.post_block.repeat": row.values["hook.post_block.repeat"] ?? blocks,
          },
          [FIX],
          evidenceOf(input.bundles, (b) => {
            const calls = postBlockCallsOf(b.calls);
            return b.calls
              .filter(
                (c) =>
                  isBlockingVerdict(c.verdict) &&
                  c.blockedPlugin === plugin &&
                  c.blockedHook === hook,
              )
              .filter((c) => {
                const self = calls.find((x) => x.toolCallId === c.toolCallId);
                if (self === undefined) return false;
                const cls = postBlockClassOf(self, calls);
                return (
                  cls === "repeat" ||
                  cls === "rewrite" ||
                  cls === "rewrite_text" ||
                  cls === "other_tool_same_target"
                );
              })
              .map((c) => ({
                kind: "call" as const,
                threadId: b.turn.threadId,
                turnId: b.turn.turnId,
                toolCallId: c.toolCallId,
              }));
          }),
        ),
      );
    }
  }

  // 12. 주도 예산 소진: 반납 사유 `budget`의 비율(§6). 표본은 반납된 주도 프레임 수다. 영향은 소진 횟수다
  {
    const rule = t("drive_budget_exhausted");
    for (const row of rowsOf(
      input,
      ["plugin"],
      ["drive.exit_reasons", "drive.exit_reasons.budget"],
    )) {
      const exits = row.values["drive.exit_reasons"];
      const share = numberOf(row.values["drive.exit_reasons.budget"]);
      if (exits === undefined || exits.value === null || exits.value < (rule.minDrive ?? 0)) {
        continue;
      }
      if (share === null || share < (rule.budgetShare ?? 1)) continue;
      const plugin = row.key.plugin ?? "";
      out.push(
        candidateOf(
          "drive_budget_exhausted",
          { kind: "drive", plugin, ref: null },
          { unit: "hits", value: Math.round(share * exits.value) },
          {
            "drive.exit_reasons": exits,
            "drive.exit_reasons.budget": row.values["drive.exit_reasons.budget"] ?? exits,
          },
          [FIX],
          evidenceOf(input.bundles, (b) =>
            b.frames.some((f) => f.plugin === plugin && f.exitReason === "budget")
              ? [turnRef(b)]
              : [],
          ),
        ),
      );
    }
  }

  return out;
}

/** 플러그인이 낀 턴 수(`plugin_turns` 칸). 캐시 깨짐의 표본이다 */
function pluginTurnsOf(cells: readonly DailyCell[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const cell of cells) {
    if (cell.key.subject !== "cache" || cell.key.counter !== "plugin_turns") continue;
    out.set(cell.key.plugin, (out.get(cell.key.plugin) ?? 0) + cell.agg.n);
  }
  return out;
}

/** 플러그인의 관찰 깨짐이 가장 많이 난 블록(`finding.subject.ref`). 동점이면 `BLOCK_REFS` 순서가 이긴다 */
function dominantBlockOf(bundles: readonly TurnBundleRow[], plugin: string): BlockRef {
  const counts = new Map<BlockRef, number>();
  for (const bundle of bundles) {
    for (const row of bundle.cache) {
      if (row.plugin !== plugin || !row.observed) continue;
      const block = blockOfCause(row.kind);
      counts.set(block, (counts.get(block) ?? 0) + 1);
    }
  }
  let best: BlockRef = "model";
  let bestCount = 0;
  for (const block of BLOCK_REFS) {
    const count = counts.get(block) ?? 0;
    if (count > bestCount) {
      best = block;
      bestCount = count;
    }
  }
  return best;
}

/** 이 턴에서 플러그인의 지침이 실렸고 그 플러그인 훅이 막거나 물은 호출이 있나(§5.1-① 정의) */
function definedBy(bundle: TurnBundleRow, plugin: string): boolean {
  const loaded = bundle.materials.some((m) => m.plugin === plugin && m.kind === "always");
  if (!loaded) return false;
  return bundle.hooks.some((h) => {
    if (h.plugin !== plugin || h.toolCallId === null) return false;
    if (h.result !== "blocked" && h.askVia === null) return false;
    const call = bundle.calls.find((c) => c.toolCallId === h.toolCallId);
    return call !== undefined && isBlockingVerdict(call.verdict);
  });
}

/** 발견 id. 규칙과 대상으로 정해서 기간이 바뀌어도 같다(FNV-1a 32비트 해시) */
export function findingIdOf(candidate: Pick<Candidate, "ruleId" | "subject">): string {
  const text = JSON.stringify([
    candidate.ruleId,
    candidate.subject.kind,
    candidate.subject.plugin,
    candidate.subject.ref,
  ]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${candidate.ruleId}-${hash.toString(16).padStart(8, "0")}`;
}

/** 근거 지문: 규칙 id, 대상, 대표 지표 값(§4.7 규칙 42). 두 배 이상 바뀌면 다시 연다 */
function fingerprintOf(candidate: Candidate): { readonly value: number } {
  return { value: candidate.impact.value };
}

/** 치운 발견이 다시 열리는지. 시각이 지났거나 근거 값이 두 배 이상 또는 절반 이하로 바뀌었을 때 */
export function reopens(
  stored: { readonly fingerprint: string; readonly snoozeUntil: number | null },
  current: { readonly value: number },
  now: number,
): boolean {
  if (stored.snoozeUntil !== null && now >= stored.snoozeUntil) return true;
  const parsed = parseFingerprint(stored.fingerprint);
  if (parsed === null) return true;
  if (parsed === 0) return current.value > 0;
  return current.value >= parsed * 2 || current.value * 2 <= parsed;
}

function parseFingerprint(text: string): number | null {
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** 저장할 지문 문자열 */
export function fingerprintText(candidate: Candidate): string {
  return String(fingerprintOf(candidate).value);
}

/** 발견 한 건으로 묶는다(증거는 대표 50개) */
export function toFinding(candidate: Candidate, state: "open" | "dismissed"): Finding {
  const picked = representativeEvidence(
    candidate.evidence.map((ref, index) => ({ ref, at: candidate.evidenceAt[index] ?? 0 })),
  );
  return {
    id: findingIdOf(candidate),
    ruleId: candidate.ruleId,
    ruleVersion: RULE_VERSION,
    subject: candidate.subject,
    impact: candidate.impact,
    metrics: candidate.metrics,
    evidence: picked.items.slice(0, 50),
    evidenceTotal: candidate.evidence.length,
    next: candidate.next,
    state,
  };
}

/** 근거 묶음(§4.7 규칙 43). id, 해시, 숫자만 싣는다. 바이트 수를 함께 돌려준다(상한 확인은 호출자) */
export function bundleOf(finding: Finding): {
  readonly bundle: FindingBundle;
  readonly bytes: number;
} {
  const bundle: FindingBundle = {
    findingId: finding.id,
    ruleId: finding.ruleId,
    subject: finding.subject,
    impact: finding.impact,
    metrics: finding.metrics,
    evidence: finding.evidence.slice(0, 50),
    evidenceTotal: finding.evidenceTotal,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(bundle)).byteLength;
  return { bundle, bytes };
}
