import { parseJson } from "@fresnel/contracts";
import {
  hookOutcomeOf,
  isBlockingVerdict,
  postBlockClassOf,
  type PostBlockCall,
} from "./classify.ts";
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
  /** 키에 쓰는 열만 본다(모델, 프로필, 범위, 수준) */
  readonly turn: Pick<TrTurnRow, "model" | "profileId" | "scopeKind" | "level">;
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

  // ---- 아래는 지표 전용 카운터다. 기존 주체(turn, hook, call, tool, skill, cost)의 칸은 건드리지 않는다 ----

  put("turn_level", "", "", "", turn.level, null, false);

  // 훅 표시값 일곱 갈래(§4.5)와 건너뜀 뒤의 가림. 주체 `hook`과 나누어 기존 집계 시험의 칸을 그대로 둔다
  for (const hook of input.hooks) {
    const caller = hook.toolCallId === null ? "" : (callerOf.get(hook.toolCallId) ?? "");
    const outcome = hookOutcomeOf({
      result: hook.result,
      reason: hook.reason,
      decision: hook.decision,
    });
    put("hook_outcome", hook.plugin, hook.hook, caller, `outcome:${outcome}`, null, false);
    // 앞 훅 때문에 이르지 못한 실행(§5 hook.shadowed): 건너뛰었고 막은 훅 이름이 있다
    if (hook.result === "skipped" && hook.skippedBy !== null) {
      put("hook_outcome", hook.plugin, hook.hook, caller, "shadowed", null, false);
    }
  }

  // 막힌 호출 뒤의 행동(§5.1-②). 키의 플러그인과 훅은 막은 쪽이다. 막은 쪽이 없으면(사람 거부) 빈 문자열이다
  const postCalls = postBlockCallsOf(input.calls);
  for (const call of input.calls) {
    if (!isBlockingVerdict(call.verdict)) continue;
    const self = postCalls.find((c) => c.toolCallId === call.toolCallId);
    if (self === undefined) continue;
    const cls = postBlockClassOf(self, postCalls);
    put(
      "postblock",
      call.blockedPlugin ?? "",
      call.blockedHook ?? "",
      "",
      `post:${cls}`,
      null,
      false,
    );
  }

  // 실행 결과: 실행 칸과 오류 칸, 결과 토큰 분포(§5의 tool.error_rate, tool.result_tokens)
  for (const call of input.calls) {
    if (call.execStatus !== null) {
      put("call_exec", call.plugin, call.tool, call.caller, "executed", null, false);
    }
    if (call.execStatus === "error") {
      put("call_exec", call.plugin, call.tool, call.caller, "error", null, false);
    }
    if (call.resultTokens !== null) {
      put(
        "call_exec",
        call.plugin,
        call.tool,
        call.caller,
        "result_tokens",
        call.resultTokens,
        true,
      );
    }
  }

  // 지연 도구가 이 턴에서 활성화됐나(§5 tool.deferred_activation)
  for (const tool of input.tooluse) {
    if (tool.state === "activated")
      put("tool_state", tool.plugin, tool.tool, "", "activated_turns", null, false);
  }

  // 스킬을 읽은 출처(§5 skill.read_origin)
  for (const skill of input.skills) {
    if (skill.read && skill.via !== null) {
      put("skill_via", skill.plugin, skill.skill, "", `via:${skill.via}`, null, false);
    }
  }

  // 지침(always 재료)과 그 재료를 둔 플러그인의 훅 막음(§5.1-①). 지침이 실렸는데 같은 플러그인 훅이 막거나 물은 호출
  const loaded = new Map<string, { tokens: number; truncated: boolean }>();
  for (const material of latest.values()) {
    if (material.kind !== "always") continue;
    const prev = loaded.get(material.plugin) ?? { tokens: 0, truncated: false };
    loaded.set(material.plugin, {
      tokens: prev.tokens + material.tokens,
      truncated: prev.truncated,
    });
  }
  for (const material of input.materials) {
    if (material.kind !== "always" || !material.truncated) continue;
    const prev = loaded.get(material.plugin);
    if (prev !== undefined) loaded.set(material.plugin, { ...prev, truncated: true });
  }
  const defiedCalls = new Map<string, Set<string>>();
  for (const hook of input.hooks) {
    if (hook.toolCallId === null) continue;
    if (hook.result !== "blocked" && hook.askVia === null) continue;
    const call = input.calls.find((c) => c.toolCallId === hook.toolCallId);
    if (call === undefined || !isBlockingVerdict(call.verdict)) continue;
    const set = defiedCalls.get(hook.plugin) ?? new Set<string>();
    set.add(call.toolCallId);
    defiedCalls.set(hook.plugin, set);
  }
  for (const [plugin, info] of loaded) {
    put("instruction", plugin, "", "", "loaded_turns", null, false);
    put("instruction", plugin, "", "", "always_tokens", info.tokens, true);
    if (info.truncated) put("instruction", plugin, "", "", "truncated_turns", null, false);
    const calls = defiedCalls.get(plugin);
    if (calls !== undefined && calls.size > 0) {
      put("instruction", plugin, "", "", "defied_turns", null, false);
      for (let i = 0; i < calls.size; i += 1) {
        put("instruction", plugin, "", "", "defied_calls", null, false);
      }
    }
  }

  return [...cells.values()];
}

/** 같은 턴의 호출을 분류 입력으로 바꾼다. `meta_json.argTokens`가 없으면 빈 목록이다 */
export function postBlockCallsOf(calls: readonly TrCallRow[]): PostBlockCall[] {
  return calls.map((call) => ({
    toolCallId: call.toolCallId,
    stepIndex: call.stepIndex ?? -1,
    tool: call.tool,
    callKey: call.callKey,
    targetKey: call.targetKey,
    argTokens: argTokensOf(call.metaJson),
  }));
}

function argTokensOf(metaJson: string): readonly string[] {
  const read = parseJson(metaJson);
  const value: unknown = read.ok ? read.value : undefined;
  if (typeof value !== "object" || value === null || !("argTokens" in value)) return [];
  const tokens = value.argTokens;
  if (!Array.isArray(tokens)) return [];
  return tokens.filter((token): token is string => typeof token === "string");
}
