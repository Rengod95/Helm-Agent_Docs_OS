import type {
  ItemId,
  ItemRecord,
  StepComposition,
  StepContextWarning,
  Usage,
} from "@fresnel/contracts/conversation";
import type { AgentRow, TurnSummary } from "../../../state/engine/index.ts";

// 컨텍스트 탭(DP-201~203)의 순수 모델. 채움과 자동 요약 문턱, 턴별 채움과 구성, 토큰·비용 합, 실린 도구 목록을 거울 값에서 만든다.
// 구성은 엔진이 단계마다 기록한 어림(`step.completed.composition`, 글자 수 / 4)이고, 채움은 마지막 모델 호출의 실제 문맥 토큰(`usage.get`)이다.

// ── 채움 ───────────────────────────────────────────────────────────────

export interface CompactPolicy {
  readonly autoCompact: boolean;
  readonly reserveTokens: number;
}

/** 채움과 자동 요약까지의 거리. `limit`을 모르면 비율을 지어내지 않는다 */
export type ContextFill =
  | { readonly kind: "none" }
  | { readonly kind: "noLimit"; readonly used: number }
  | {
      readonly kind: "known";
      readonly used: number;
      readonly limit: number;
      /** 0~100(넘치면 100) */
      readonly percent: number;
      /** 자동 요약 문턱(토큰). 정책을 모르거나 꺼져 있으면 null */
      readonly threshold: number | null;
      /** 문턱 상태. `unknown`은 정책을 읽지 못했다 */
      readonly compaction:
        | { readonly kind: "left"; readonly tokens: number }
        | { readonly kind: "over" }
        | { readonly kind: "off" }
        | { readonly kind: "unknown" };
    };

export function contextFillOf(
  usage: { readonly tokens: number; readonly limit: number | null } | null,
  policy: CompactPolicy | null,
): ContextFill {
  if (usage === null) return { kind: "none" };
  if (usage.limit === null || usage.limit <= 0) return { kind: "noLimit", used: usage.tokens };
  const { limit } = usage;
  const used = usage.tokens;
  const percent = Math.min(100, Math.round((used / limit) * 100));
  if (policy === null) {
    return {
      kind: "known",
      used,
      limit,
      percent,
      threshold: null,
      compaction: { kind: "unknown" },
    };
  }
  if (!policy.autoCompact) {
    return { kind: "known", used, limit, percent, threshold: null, compaction: { kind: "off" } };
  }
  const threshold = Math.max(0, limit - policy.reserveTokens);
  return {
    kind: "known",
    used,
    limit,
    percent,
    threshold,
    compaction: used >= threshold ? { kind: "over" } : { kind: "left", tokens: threshold - used },
  };
}

// ── 턴별 채움과 구성 ────────────────────────────────────────────────────

/** caustic ContextAnalytics의 기둥 수 */
const ROUND_COLUMNS = 12;

export interface ContextRound {
  /** 대화 안 턴 번호(1부터, 거울이 가진 턴 안에서) */
  readonly number: number;
  /** 창 대비 %(0~100, 소수 한 자리) */
  readonly total: number;
  /** 그 턴 출력 토큰의 창 대비 %(기둥 안 몫) */
  readonly out: number;
  readonly tokens: number;
  readonly composition: StepComposition | null;
}

const percentOf = (tokens: number, limit: number): number =>
  Math.min(100, Math.round((tokens / limit) * 1000) / 10);

/** 최근 턴 12개(문맥 토큰을 아는 턴만). 오래된 것이 앞이다 */
export function roundsOf(turns: readonly TurnSummary[], limit: number): readonly ContextRound[] {
  const known = turns
    .map((turn, index) => ({ turn, number: index + 1 }))
    .filter(({ turn }) => turn.lastContextTokens !== null && turn.lastContextTokens > 0);
  return known.slice(-ROUND_COLUMNS).map(({ turn, number }) => {
    const tokens = turn.lastContextTokens ?? 0;
    const total = percentOf(tokens, limit);
    return {
      number,
      total,
      out: Math.min(total, percentOf(turn.usage?.output ?? 0, limit)),
      tokens,
      composition: turn.composition,
    };
  });
}

export type CompositionKey = "system" | "tools" | "rules" | "history";

export interface CompositionPart {
  readonly key: CompositionKey;
  readonly tokens: number;
  /** 창 대비 %. 합이 100을 넘으면 비례로 줄인다 */
  readonly percent: number;
  /** 규칙 갈래의 안쪽(절 이름별, 확장이 더한 몫, 환경) */
  readonly detail: readonly { readonly name: string; readonly tokens: number }[];
}

/**
 * 구성 어림을 네 갈래로 나눈다: 기본 프롬프트(system), 도구 정의(tools), 규칙·확장·환경(절 + injected + volatile), 대화 기록(history).
 * 도구 정의는 요청의 `tools`라 `total` 밖이지만 창을 차지하므로 함께 그린다
 */
export function compositionPartsOf(
  composition: StepComposition,
  limit: number,
): readonly CompositionPart[] {
  const sections = Object.entries(composition.sections)
    .filter(([, tokens]) => tokens > 0)
    .map(([name, tokens]) => ({ name, tokens }));
  const rulesDetail = [
    ...sections,
    ...(composition.injected > 0 ? [{ name: "injected", tokens: composition.injected }] : []),
    ...(composition.volatile > 0 ? [{ name: "volatile", tokens: composition.volatile }] : []),
  ];
  const parts: { key: CompositionKey; tokens: number; detail: CompositionPart["detail"] }[] = [
    { key: "system", tokens: composition.system, detail: [] },
    { key: "tools", tokens: composition.tools, detail: [] },
    {
      key: "rules",
      tokens: rulesDetail.reduce((sum, d) => sum + d.tokens, 0),
      detail: rulesDetail,
    },
    { key: "history", tokens: composition.history, detail: [] },
  ];
  const sum = parts.reduce((n, p) => n + p.tokens, 0);
  const scale = sum > limit ? limit / sum : 1;
  return parts.map((p): CompositionPart => ({
    key: p.key,
    tokens: p.tokens,
    detail: p.detail,
    percent: percentOf(p.tokens * scale, limit),
  }));
}

// ── 토큰과 비용 ─────────────────────────────────────────────────────────

export interface UsageTotals {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly total: number;
  /** 비용 합. 기록된 비용이 하나도 없으면 null */
  readonly cost: number | null;
}

const ZERO: UsageTotals = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
  cost: null,
};

function addUsage(sum: UsageTotals, usage: Usage): UsageTotals {
  const cost = usage.cost.total;
  return {
    input: sum.input + usage.input,
    output: sum.output + usage.output,
    cacheRead: sum.cacheRead + usage.cacheRead,
    cacheWrite: sum.cacheWrite + usage.cacheWrite,
    total: sum.total + usage.totalTokens,
    cost: cost > 0 ? (sum.cost ?? 0) + cost : sum.cost,
  };
}

interface ModelUsage {
  readonly model: string;
  readonly total: number;
  readonly cost: number | null;
}

export interface UsageReport {
  readonly main: UsageTotals;
  /** 하위 에이전트 합. 하위 에이전트가 없으면 null */
  readonly agents: UsageTotals | null;
  readonly agentCount: number;
  /** 모델별(이 대화의 턴만). 토큰이 많은 순 */
  readonly byModel: readonly ModelUsage[];
  /** 끝난 턴 수(사용량을 아는 턴) */
  readonly turns: number;
}

export function usageReportOf(
  turns: readonly TurnSummary[],
  agents: readonly AgentRow[],
): UsageReport {
  let main = ZERO;
  let counted = 0;
  const models = new Map<string, UsageTotals>();
  for (const turn of turns) {
    if (turn.rawUsage === null) continue;
    counted += 1;
    main = addUsage(main, turn.rawUsage);
    const key = turn.model ?? "";
    models.set(key, addUsage(models.get(key) ?? ZERO, turn.rawUsage));
  }
  let agentSum: UsageTotals | null = null;
  for (const row of agents) {
    if (row.agent.usage === null) continue;
    agentSum = addUsage(agentSum ?? ZERO, row.agent.usage);
  }
  const byModel = [...models]
    .filter(([model]) => model !== "")
    .map(([model, sum]) => ({ model, total: sum.total, cost: sum.cost }))
    .toSorted((a, b) => b.total - a.total);
  return { main, agents: agentSum, agentCount: agents.length, byModel, turns: counted };
}

// ── 실린 도구 ───────────────────────────────────────────────────────────

export interface LoadedTools {
  /** 지금 모델에 광고된 도구 이름(접두와 그 뒤 도구 변경 item을 차례로 적용). 이름순 */
  readonly names: readonly string[];
  /** 다음 접두 고정 때 더해질 도구(마지막 턴의 `tools_deferred` 경고) */
  readonly deferred: readonly string[];
}

function namesOf(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const list: readonly unknown[] = value;
  const names: string[] = [];
  for (const entry of list) {
    if (typeof entry === "object" && entry !== null && "name" in entry) {
      const { name } = entry;
      if (typeof name === "string" && name !== "") names.push(name);
    }
  }
  return names;
}

export function loadedToolsOf(
  itemIds: readonly ItemId[],
  items: Readonly<Record<string, ItemRecord>>,
  warnings: readonly StepContextWarning[],
): LoadedTools | null {
  const names = new Set<string>();
  let seen = false;
  for (const id of itemIds) {
    const item = items[id];
    if (item?.kind !== "system") continue;
    const added = namesOf(item.message.toolsAdded);
    const removed = namesOf(item.message.toolsRemoved);
    if (added.length === 0 && removed.length === 0) continue;
    seen = true;
    for (const name of added) names.add(name);
    for (const name of removed) names.delete(name);
  }
  if (!seen) return null;
  const deferred = new Set<string>();
  for (const warning of warnings) {
    if (warning.code !== "tools_deferred") continue;
    for (const name of warning.added ?? []) if (!names.has(name)) deferred.add(name);
  }
  return {
    names: [...names].toSorted((a, b) => a.localeCompare(b)),
    deferred: [...deferred].toSorted((a, b) => a.localeCompare(b)),
  };
}
