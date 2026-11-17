import type {
  DailyKey,
  TrCallRow,
  TrHookRow,
  TrMaterialRow,
  TrSkillRow,
  TrToolUseRow,
  TrTurnRow,
} from "./turn-tables.ts";

// 턴 하나의 하위 행을 `tr_daily` 카운터로 접는다(문서 §4.7 규칙 38, §5의 "집계" 열). 순수 함수다. 쓰기와 합치기는 `store.ts`가 한다.
// 키는 `DailyKey`뿐이다. 대화 id, 도구 인자, 훅 사유 본문은 키와 값 어디에도 들어가지 않는다.
// 시간 분포(훅 `ms`, 호출 `execMs`, 턴별 비용 합)는 2의 거듭제곱 칸 히스토그램으로 접는다.

/** 히스토그램 칸 수. 칸 0은 값 0, 칸 k(1 ≤ k < 19)는 비트 길이가 k인 값, 칸 19는 그 이상 전부다 */
export const HIST_CELLS = 20;

/** 카운터 한 줄의 집계. `n`은 행 수, `sum`·`min`·`max`·`hist`는 값이 있는 행만 센다 */
export interface Aggregate {
  readonly n: number;
  readonly sum: number;
  readonly min: number | null;
  readonly max: number | null;
  /** 값을 받는 카운터만 히스토그램이 있다 */
  readonly hist: readonly number[] | null;
}

export interface DailyCell {
  readonly key: DailyKey;
  readonly agg: Aggregate;
}

export interface TurnFoldInput {
  /** 턴 시작 시각의 UTC 날짜 `YYYY-MM-DD` */
  readonly day: string;
  readonly turn: TrTurnRow;
  readonly calls: readonly TrCallRow[];
  readonly hooks: readonly TrHookRow[];
  readonly materials: readonly TrMaterialRow[];
  readonly tooluse: readonly TrToolUseRow[];
  readonly skills: readonly TrSkillRow[];
}

function emptyAggregate(withHist: boolean): Aggregate {
  return {
    n: 0,
    sum: 0,
    min: null,
    max: null,
    hist: withHist ? Array.from({ length: HIST_CELLS }, () => 0) : null,
  };
}

function histBucket(value: number): number {
  let rest = Math.floor(Math.max(0, value));
  let bucket = 0;
  while (rest > 0 && bucket < HIST_CELLS - 1) {
    rest = Math.floor(rest / 2);
    bucket += 1;
  }
  return bucket;
}

/** 행 하나를 더한다. `value`가 없으면 `n`만 센다 */
function addSample(agg: Aggregate, value: number | null): Aggregate {
  if (value === null) return { ...agg, n: agg.n + 1 };
  const hist = agg.hist;
  const cell = histBucket(value);
  return {
    n: agg.n + 1,
    sum: agg.sum + value,
    min: agg.min === null ? value : Math.min(agg.min, value),
    max: agg.max === null ? value : Math.max(agg.max, value),
    hist: hist === null ? null : hist.map((count, index) => (index === cell ? count + 1 : count)),
  };
}

function pickBound(
  a: number | null,
  b: number | null,
  choose: (x: number, y: number) => number,
): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return choose(a, b);
}

/** 두 집계를 합친다. 같은 키의 행이 여러 턴이나 기존 저장값에서 올 때 쓴다 */
export function mergeAggregates(a: Aggregate, b: Aggregate): Aggregate {
  const ha = a.hist;
  const hb = b.hist;
  let hist: readonly number[] | null = ha ?? hb;
  if (ha !== null && hb !== null) {
    hist = ha.map((count, index) => count + (hb[index] ?? 0));
  }
  return {
    n: a.n + b.n,
    sum: a.sum + b.sum,
    min: pickBound(a.min, b.min, Math.min),
    max: pickBound(a.max, b.max, Math.max),
    hist,
  };
}

/** 키의 식별 문자열. 같은 키면 같은 문자열이다 */
export function dailyId(key: DailyKey): string {
  return JSON.stringify([
    key.day,
    key.subject,
    key.plugin,
    key.ref,
    key.model,
    key.profile,
    key.scopeKind,
    key.caller,
    key.counter,
  ]);
}

/**
 * 턴 하나를 카운터 묶음으로 접는다.
 * - turn: `turns`(턴 수)
 * - hook: 키 `result` 값(`passed`, `modified`, `blocked`, `failed`, `skipped`, 시간 분포는 `ms`), `reason:<사유>`, `ask:<답>`
 * - call: 키 `verdict` 값(시간 분포는 `execMs`)
 * - tool: `advertised_turns`(광고됨, 토큰 합), `deferred_turns`, `called`(호출이 있었던 턴)
 * - skill: `listed_turns`, `read_turns`(읽은 토큰 합)
 * - cost: `always`, `drive`, `on_demand`. 턴의 플러그인별 합이 한 행이고 시간 분포는 그 합이다. 재료는 같은 (플러그인, 참조, 종류)의 마지막 단계 것만 센다
 */
export function foldTurn(input: TurnFoldInput): readonly DailyCell[] {
  const { turn } = input;
  const cells = new Map<string, DailyCell>();
  const put = (
    subject: string,
    plugin: string,
    ref: string,
    caller: string,
    counter: string,
    value: number | null,
    withHist: boolean,
  ): void => {
    const key: DailyKey = {
      day: input.day,
      subject,
      plugin,
      ref,
      model: turn.model ?? "",
      profile: turn.profileId ?? "",
      scopeKind: turn.scopeKind,
      caller,
      counter,
    };
    const id = dailyId(key);
    const agg = addSample(cells.get(id)?.agg ?? emptyAggregate(withHist), value);
    cells.set(id, { key, agg });
  };

  put("turn", "", "", "", "turns", null, false);

  const callerOf = new Map<string, string>();
  for (const call of input.calls) callerOf.set(call.toolCallId, call.caller);

  for (const hook of input.hooks) {
    const caller = hook.toolCallId === null ? "" : (callerOf.get(hook.toolCallId) ?? "");
    put("hook", hook.plugin, hook.hook, caller, hook.result, hook.ms, true);
    if (hook.reason !== null) {
      put("hook", hook.plugin, hook.hook, caller, `reason:${hook.reason}`, null, false);
    }
    if (hook.askAnswer !== null) {
      put("hook", hook.plugin, hook.hook, caller, `ask:${hook.askAnswer}`, null, false);
    }
  }

  for (const call of input.calls) {
    put("call", call.plugin, call.tool, call.caller, call.verdict, call.execMs, true);
  }

  for (const tool of input.tooluse) {
    if (tool.state === "deferred") {
      put("tool", tool.plugin, tool.tool, "", "deferred_turns", null, false);
    } else {
      put("tool", tool.plugin, tool.tool, "", "advertised_turns", tool.tokens, false);
    }
    if (tool.called > 0) put("tool", tool.plugin, tool.tool, "", "called", null, false);
  }

  for (const skill of input.skills) {
    if (skill.listed) put("skill", skill.plugin, skill.skill, "", "listed_turns", null, false);
    if (skill.read) put("skill", skill.plugin, skill.skill, "", "read_turns", skill.tokens, false);
  }

  // 재료: 같은 (플러그인, 참조, 종류)는 마지막 단계 행만 센다(§3.4 `tr_material`의 주석)
  const latest = new Map<string, TrMaterialRow>();
  for (const material of input.materials) {
    const id = JSON.stringify([material.plugin, material.ref, material.kind]);
    const prev = latest.get(id);
    if (prev === undefined || material.stepIndex > prev.stepIndex) latest.set(id, material);
  }
  const costs = new Map<string, Map<string, number>>();
  const addCost = (plugin: string, counter: string, tokens: number): void => {
    const per = costs.get(plugin) ?? new Map<string, number>();
    per.set(counter, (per.get(counter) ?? 0) + tokens);
    costs.set(plugin, per);
  };
  for (const material of latest.values()) {
    if (material.kind === "always" || material.kind === "drive" || material.kind === "on_demand") {
      addCost(material.plugin, material.kind, material.tokens);
    }
  }
  for (const tool of input.tooluse) {
    if (tool.state === "advertised") addCost(tool.plugin, "always", tool.tokens);
    if (tool.state === "activated") addCost(tool.plugin, "on_demand", tool.tokens);
  }
  for (const [plugin, per] of costs) {
    for (const [counter, tokens] of per) put("cost", plugin, "", "", counter, tokens, true);
  }

  return [...cells.values()];
}
