import { parse, parseJson } from "@fresnel/contracts";
import { Type } from "typebox";
import {
  blockOfCause,
  hookOutcomeOf,
  isBlockingVerdict,
  postBlockClassOf,
  type BlockRef,
  type PostBlockCall,
} from "./classify.ts";
import type {
  DailyKey,
  TrCacheRow,
  TrCallRow,
  TrFrameRow,
  TrHookRow,
  TrMaterialRow,
  TrSkillRow,
  TrStepRow,
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
  /** 키에 쓰는 열과 시간(블록 시간, §5)만 본다 */
  readonly turn: Pick<
    TrTurnRow,
    "model" | "profileId" | "scopeKind" | "level" | "startedAt" | "endedAt"
  >;
  readonly calls: readonly TrCallRow[];
  readonly hooks: readonly TrHookRow[];
  readonly materials: readonly TrMaterialRow[];
  readonly tooluse: readonly TrToolUseRow[];
  readonly skills: readonly TrSkillRow[];
  /** 단계 행(모델 사용량, 캐시 지표 §5 block.*) */
  readonly steps: readonly TrStepRow[];
  /** 캐시 깨짐 원인 행(§5 block.cache_breaks*) */
  readonly cache: readonly TrCacheRow[];
  /** 주도 프레임 행(§5 drive.*) */
  readonly frames: readonly TrFrameRow[];
}

/** 카운터 한 줄을 더하는 함수. `foldTurn`의 키 조립을 감춘다 */
type Put = (
  subject: string,
  plugin: string,
  ref: string,
  caller: string,
  counter: string,
  value: number | null,
  withHist: boolean,
) => void;

/** 프레임 한도와 사용량의 숫자 칸. 없는 칸은 빠진다(저장 값이 깨졌으면 빈 값이다) */
const FrameNumbersShape = Type.Object({
  turns: Type.Optional(Type.Number()),
  spawns: Type.Optional(Type.Number()),
  tokens: Type.Optional(Type.Number()),
  maxTurns: Type.Optional(Type.Number()),
  maxSpawns: Type.Optional(Type.Number()),
  maxTokens: Type.Optional(Type.Number()),
});

function frameNumbersOf(json: string): {
  readonly turns?: number;
  readonly spawns?: number;
  readonly tokens?: number;
  readonly maxTurns?: number;
  readonly maxSpawns?: number;
  readonly maxTokens?: number;
} {
  const read = parseJson(json);
  if (!read.ok) return {};
  const checked = parse(FrameNumbersShape, read.value);
  return checked.ok ? checked.value : {};
}

/**
 * 블록 시간(§5 block.time_split). 턴마다 한 번씩 센다. 도구는 실행 시간, 훅은 활성 시간(사람 대기 뺌), 사람 대기는 물음의 대기 시간이다.
 * 모델 대기는 단계 행에 없어서 나머지에 든다. 나머지는 턴 시간에서 셋을 뺀 값이고 0 아래로 내리지 않는다.
 */
function foldBlockTime(input: TurnFoldInput, put: Put): void {
  const toolsMs = input.calls.reduce((sum, call) => sum + (call.execMs ?? 0), 0);
  const hookMs = input.hooks.reduce((sum, hook) => sum + hook.ms, 0);
  const askMs = input.hooks.reduce((sum, hook) => sum + (hook.askMs ?? 0), 0);
  put("block", "", "", "", "tools_ms", toolsMs, false);
  put("block", "", "", "", "hook_ms", hookMs, false);
  put("block", "", "", "", "ask_ms", askMs, false);
  if (input.turn.endedAt === null) return;
  const total = Math.max(0, input.turn.endedAt - input.turn.startedAt);
  put("block", "", "", "", "turn_ms", total, false);
  put("block", "", "", "", "rest_ms", Math.max(0, total - toolsMs - hookMs - askMs), false);
}

/**
 * 모델 사용량과 캐시 깨짐(§5 block.cache_hit_rate, block.cache_breaks*). 단계마다 한 번씩 센다.
 * 깨짐은 플러그인이 있는 원인마다 한 줄(키 `cache`, 플러그인과 블록)로 센다. 같은 단계의 같은 플러그인은 한 번이다.
 * `plugin_turns`는 그 플러그인이 낀 턴 수로 분모다.
 */
function foldCache(input: TurnFoldInput, put: Put, costPlugins: ReadonlySet<string>): void {
  for (const step of input.steps) {
    put("block", "", "", "", "steps", null, false);
    const usage = step.input + step.cacheRead + step.cacheWrite;
    if (usage > 0) {
      put("block", "", "", "", "cache_read", step.cacheRead, false);
      put("block", "", "", "", "cache_input", usage, false);
    }
  }

  const byStep = new Map<number, TrCacheRow[]>();
  for (const row of input.cache) {
    const list = byStep.get(row.stepIndex) ?? [];
    list.push(row);
    byStep.set(row.stepIndex, list);
  }
  const attributed = new Set<string>();
  for (const rows of byStep.values()) {
    const observed = rows.some((row) => row.observed);
    put("block", "", "", "", observed ? "break_observed" : "break_predicted", null, false);
    if (observed && rows.every((row) => row.plugin === null)) {
      put("block", "", "", "", "break_unattributed", null, false);
    }
    const perPlugin = new Map<
      string,
      {
        readonly ref: BlockRef;
        readonly observed: boolean;
        readonly inferred: boolean;
        readonly write: number;
      }
    >();
    for (const row of rows) {
      if (row.plugin === null) continue;
      const prev = perPlugin.get(row.plugin);
      perPlugin.set(row.plugin, {
        ref: prev?.ref ?? blockOfCause(row.kind),
        observed: (prev?.observed ?? false) || row.observed,
        inferred: (prev?.inferred ?? false) || row.evidence === "inferred",
        write: row.cacheWrite,
      });
    }
    for (const [plugin, info] of perPlugin) {
      attributed.add(plugin);
      if (!info.observed) {
        put("cache", plugin, info.ref, "", "break_predicted", null, false);
        continue;
      }
      put("cache", plugin, info.ref, "", "break_observed", null, false);
      if (info.inferred) put("cache", plugin, info.ref, "", "break_inferred", null, false);
      put("cache", plugin, info.ref, "", "break_write", info.write, false);
    }
  }
  for (const plugin of new Set([...costPlugins, ...attributed])) {
    put("cache", plugin, "", "", "plugin_turns", null, false);
  }
}

/**
 * 주도 프레임(§5 drive.*). 맨 위가 플러그인인 프레임(깊이 1 이상)만 센다.
 * `frame_turns`는 프레임 행을 가진 턴 수다. 0이면 지표는 `not_recorded`다(enC2m이 프레임을 쓰기 전).
 * 주도 중 물음은 물음 행이 든 시각이 프레임 구간에 드는 가장 깊은 프레임의 플러그인에 센다.
 */
function foldFrames(input: TurnFoldInput, put: Put): void {
  if (input.frames.length > 0) put("drive", "", "", "", "frame_turns", null, false);
  for (const frame of input.frames) {
    if (frame.plugin === null) continue;
    const plugin = frame.plugin;
    put("drive", plugin, "", "", "entries", null, false);
    if (frame.exitReason !== null) {
      put("drive", plugin, "", "", "exits", null, false);
      put("drive", plugin, "", "", `exit:${frame.exitReason}`, null, false);
    }
    const numbers = frameNumbersOf(frame.limitsJson);
    const used = frameNumbersOf(frame.usedJson);
    const pairs = [
      [numbers.maxTurns, used.turns, "turns"],
      [numbers.maxSpawns, used.spawns, "spawns"],
      [numbers.maxTokens, used.tokens, "tokens"],
    ] as const;
    for (const [limit, usedValue, name] of pairs) {
      if (limit === undefined || usedValue === undefined) continue;
      put("drive", plugin, "", "", `limit:${name}`, limit, false);
      put("drive", plugin, "", "", `used:${name}`, usedValue, false);
    }
  }
  for (const hook of input.hooks) {
    if (hook.askVia === null) continue;
    let owner: TrFrameRow | undefined;
    for (const frame of input.frames) {
      if (frame.plugin === null || hook.atMs < frame.enteredAtMs) continue;
      if (frame.exitedAtMs !== null && hook.atMs >= frame.exitedAtMs) continue;
      if (owner === undefined || frame.depth > owner.depth) owner = frame;
    }
    if (owner !== undefined && owner.plugin !== null) {
      put("drive", owner.plugin, "", "", "asks", null, false);
    }
  }
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
    // 인자 토큰 목록이 기록된 막힌 호출 수. 목록이 없으면 `rewrite_text`는 판정할 수 없어서 값이 없다(not_recorded)
    if (argTokenListOf(call.metaJson) !== null) {
      put(
        "postblock",
        call.blockedPlugin ?? "",
        call.blockedHook ?? "",
        "",
        "args_known",
        null,
        false,
      );
    }
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

  foldBlockTime(input, put);
  foldCache(input, put, new Set(costs.keys()));
  foldFrames(input, put);

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
    argTokens: argTokenListOf(call.metaJson) ?? [],
  }));
}

/**
 * `meta_json.argTokens`의 토큰 목록. 목록이 없거나 모양이 다르면 null이다.
 * 수집기는 지금 인자 토큰 수(숫자)만 쓰므로 목록이 없는 호출이 많다(§5.1-② rewrite_text는 목록이 필요하다)
 */
function argTokenListOf(metaJson: string): readonly string[] | null {
  const read = parseJson(metaJson);
  const value: unknown = read.ok ? read.value : undefined;
  if (typeof value !== "object" || value === null || !("argTokens" in value)) return null;
  const tokens = value.argTokens;
  if (!Array.isArray(tokens)) return null;
  return tokens.filter((token): token is string => typeof token === "string");
}
