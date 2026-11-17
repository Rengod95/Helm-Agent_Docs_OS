import { createHash } from "node:crypto";
import { canonicalJson } from "@fresnel/contracts";
import type { StepContextWarning } from "@fresnel/contracts/conversation";
import type {
  AdvertisedFact,
  ContextMaterialFact,
  ContextTraceEvent,
} from "@fresnel/contracts/extensions";
import type { Advertised, CacheBreak, Material, PluginCost } from "@fresnel/contracts/wire";
import type { TrCacheRow, TrMaterialRow, TrToolUseRow } from "./turn-tables.ts";

// 조립 재료·광고·캐시 원인의 값 만들기(정본 `docs/xeon/review/m5/turn-record-metrics.md` §3.2, §3.3, §4.1 규칙 8, §4.5 규칙 26~30).
// 순수 함수다: 저장소와 시계를 모르고, 턴의 상태(TurnDraft)도 모른다. 쓰는 쪽(`turn-writer.ts`)이 상태를 넣고 결과를 행으로 쓴다.

/** 턴 하나의 재료 줄 상한(§4.1 규칙 8). 넘는 재료는 `elided.materials`에 센다 */
export const MAX_MATERIAL_ROWS_PER_TURN = 200;
/** 턴 하나의 도구 행 상한(§4.1 규칙 8). 넘는 도구는 `elided.tools`에 센다 */
const MAX_TOOL_ROWS_PER_TURN = 256;
/** 턴 하나의 스킬 이름 상한(§4.1 규칙 8). 넘는 스킬은 `elided.skills`에 센다 */
export const MAX_SKILL_ROWS_PER_TURN = 256;

/** 저장 문자열 이름의 상한(와이어 스키마의 `Name`). 넘는 이름은 잘라 쓴다 */
const NAME_MAX = 96;
/** 앞 호출과 간격이 이 값을 넘으면 캐시 만료(ttl)로 본다(§4.5 규칙 30) */
const CACHE_TTL_MS = 300_000;
/** 캐시 쓰기가 이 토큰 수 아래면 접두를 새로 쓴 것으로 보지 않는다(§4.5 규칙 30 사용량 판정) */
const CACHE_EXPIRED_MIN_WRITE = 1000;

/** 단계 하나의 조립 사실(측정 싱크의 `step_context`) */
export type StepContextEvent = Extract<ContextTraceEvent, { readonly kind: "step_context" }>;

/** 턴에서 읽은 스킬 하나. 같은 이름은 처음 읽은 한 번만 남긴다(`tr_skill` 기본 키) */
export interface TurnSkillRead {
  readonly name: string;
  readonly plugin: string;
  readonly stepIndex: number;
  readonly tokens: number;
}

/** 턴 안의 도구 줄. 첫 광고 토큰과 소유자는 고정, 상태와 호출 수는 갱신한다 */
export interface TurnToolRow {
  readonly name: string;
  readonly plugin: string;
  readonly tokens: number;
  state: "advertised" | "deferred" | "activated";
  called: number;
}

/** 모델 호출 사용량 한 덩어리(캐시 판정의 입력) */
export interface CacheUsage {
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

/** 이름을 와이어 상한에 맞춘다 */
export function nameOf(text: string): string {
  return text.length <= NAME_MAX ? text : text.slice(0, NAME_MAX);
}

/** 재료 목록의 지문(`tr_step.materials_fp`). 같은 목록이면 같은 값이다 */
export function materialsFingerprintOf(materials: readonly ContextMaterialFact[]): string {
  const digest = createHash("sha256")
    .update(canonicalJson(materials.map((m) => [m.plugin, m.material, m.ref, m.tokens])))
    .digest("hex");
  return `sha256:${digest}`;
}

/** 한 단계의 재료 가름. 턴의 남은 상한만큼 싣고(`kept`), 그 가운데 이 턴에서 처음 나타난 것만 행으로 쓴다(`fresh`) */
export function materialPlanOf(input: {
  readonly materials: readonly ContextMaterialFact[];
  readonly budget: number;
  readonly seen: ReadonlySet<string>;
}): { readonly kept: Material[]; readonly fresh: Material[]; readonly elided: number } {
  const kept = input.materials.slice(0, Math.max(0, input.budget));
  const fresh: ContextMaterialFact[] = [];
  const keys = new Set<string>();
  for (const material of kept) {
    const key = materialKeyOf(material);
    if (input.seen.has(key) || keys.has(key)) continue;
    keys.add(key);
    fresh.push(material);
  }
  return {
    kept: kept.map(materialOf),
    fresh: fresh.map(materialOf),
    elided: input.materials.length - kept.length,
  };
}

/** 재료 한 줄의 키. 턴 안에서 같은 키는 처음 한 번만 행으로 쓴다(`tr_material` 기본 키와 같다) */
export function materialKeyOf(material: { readonly plugin: string; readonly ref: string }): string {
  return `${material.plugin}\u0000${material.ref}`;
}

function materialOf(material: ContextMaterialFact): Material {
  return {
    plugin: nameOf(material.plugin),
    versionId: material.versionId,
    registrationId: material.registrationId,
    kind: material.kind,
    material: material.material,
    ref: material.ref,
    tokens: material.tokens,
    truncated: material.truncated,
    omitted: material.omitted,
    itemId: material.itemId,
    attribution: material.attribution,
  };
}

/** 재료 한 줄의 저장 모양(`tr_material`) */
export function trMaterialRowOf(
  material: Material,
  base: { readonly threadId: string; readonly turnId: string; readonly stepIndex: number },
): TrMaterialRow {
  return {
    threadId: base.threadId,
    turnId: base.turnId,
    stepIndex: base.stepIndex,
    ref: material.ref,
    plugin: material.plugin,
    kind: material.kind,
    material: material.material,
    tokens: material.tokens,
    truncated: material.truncated,
    omitted: material.omitted,
    itemId: material.itemId,
    attribution: material.attribution,
  };
}

/**
 * 광고 도구를 턴의 도구 줄에 합친다. 처음 보는 도구는 새 줄(상한 안에서), 상태가 바뀐 도구는 상태만 고친다, 이번 단계에 부른 도구는 호출 수를 센다.
 * 돌려주는 `stepTools`는 이번 단계에 새로 광고되었거나 상태가 바뀐 줄이다(§3.2 `tools`는 턴에서 처음 광고된 단계 기준)
 */
export function noteToolRows(input: {
  readonly tools: Map<string, TurnToolRow>;
  /** 이번 단계의 광고. 측정 싱크가 없었으면 없다(호출 수만 센다) */
  readonly advertised: AdvertisedFact | undefined;
  readonly calledNames: readonly string[];
}): { readonly stepTools: TurnToolRow[]; readonly touched: Set<string>; readonly elided: number } {
  const stepTools: TurnToolRow[] = [];
  const touched = new Set<string>();
  let elided = input.advertised?.toolsOmitted ?? 0;
  for (const fact of input.advertised?.tools ?? []) {
    const name = nameOf(fact.name);
    const known = input.tools.get(name);
    if (known === undefined) {
      if (input.tools.size >= MAX_TOOL_ROWS_PER_TURN) {
        elided += 1;
        continue;
      }
      const created: TurnToolRow = {
        name,
        plugin: nameOf(fact.plugin),
        tokens: fact.tokens,
        state: fact.state,
        called: 0,
      };
      input.tools.set(name, created);
      stepTools.push(created);
      touched.add(name);
      continue;
    }
    if (known.state !== fact.state) {
      known.state = fact.state;
      stepTools.push(known);
      touched.add(name);
    }
  }
  for (const name of input.calledNames) {
    const known = input.tools.get(nameOf(name));
    if (known === undefined) continue;
    known.called += 1;
    touched.add(known.name);
  }
  return { stepTools, touched, elided };
}

/** 광고 요약의 저장 모양(§3.2 `Advertised`). `tools`는 이번 단계에 새로 나온 줄이다 */
export function advertisedRecordOf(
  fact: AdvertisedFact,
  stepTools: readonly TurnToolRow[],
): Advertised {
  return {
    count: fact.count,
    tokens: fact.tokens,
    deferredCount: fact.deferredCount,
    removedCount: fact.removedCount,
    fingerprint: fact.fingerprint,
    byPlugin: fact.byPlugin.map((row) => ({
      plugin: nameOf(row.plugin),
      count: row.count,
      tokens: row.tokens,
      deferred: row.deferred,
      activated: row.activated,
    })),
    tools: stepTools.map((row) => ({
      name: row.name,
      plugin: row.plugin,
      tokens: row.tokens,
      state: row.state,
      called: row.called,
    })),
  };
}

/** 턴의 도구 줄 하나의 저장 모양(`tr_tooluse`) */
export function trToolUseRowOf(
  row: TurnToolRow,
  base: { readonly threadId: string; readonly turnId: string },
): TrToolUseRow {
  return {
    threadId: base.threadId,
    turnId: base.turnId,
    tool: row.name,
    plugin: row.plugin,
    tokens: row.tokens,
    state: row.state,
    called: row.called,
  };
}

// ---- 캐시 원인(§4.5 규칙 30) ----------------------------------------------

/**
 * 사용량으로 본 캐시 깨짐. 앞 호출과 같은 모델이고, 캐시 쓰기가 `CACHE_EXPIRED_MIN_WRITE` 이상이며 앞 쓰기의 두 배 넘게 늘고
 * 읽기는 앞 읽기의 반 아래로 줄었을 때다. 기록기의 `measure_raw kind=cache` 판정과 같은 규칙이다
 */
export function cacheExpired(
  prior: (CacheUsage & { readonly model: string }) | undefined,
  current: CacheUsage & { readonly model: string },
): boolean {
  if (prior === undefined || prior.model !== current.model) return false;
  if (prior.cacheRead + prior.cacheWrite === 0) return false;
  if (current.cacheWrite < CACHE_EXPIRED_MIN_WRITE || current.cacheWrite < prior.cacheWrite * 2) {
    return false;
  }
  return current.cacheRead <= prior.cacheRead / 2;
}

type CacheCause = CacheBreak["causes"][number];

function isStructural(warning: StepContextWarning): boolean {
  return (
    warning.code === "cache_prefix_reset" ||
    warning.code === "cache_reset_model_switch" ||
    warning.code === "tools_deferred"
  );
}

/** 구조 경고 하나의 원인. 바꾼 플러그인이 하나로 정해질 때만 `plugin`을 쓰고, 아니면 후보를 `registrations`에 둔다 */
function causeOf(
  warning: StepContextWarning,
  pluginOfTool: (name: string) => string | undefined,
): CacheCause {
  if (warning.code === "cache_prefix_reset") {
    const plugins = warning.plugins ?? [];
    const changed = warning.changed ?? [];
    const onlySections = changed.length > 0 && changed.every((part) => part === "sections");
    return {
      kind: onlySections ? "section" : "prefix_reset",
      plugin: plugins.length === 1 && plugins[0] !== undefined ? nameOf(plugins[0]) : null,
      registrations: (warning.owners ?? []).slice(0, 64),
      evidence: "declared",
    };
  }
  if (warning.code === "tools_deferred") {
    const names = [...(warning.added ?? []), ...(warning.removed ?? [])];
    const owners = new Set<string>();
    let resolved = names.length > 0;
    for (const name of names) {
      const owner = pluginOfTool(name);
      if (owner === undefined) resolved = false;
      else owners.add(owner);
    }
    const only = [...owners];
    return {
      kind: "toolset",
      plugin: resolved && only.length === 1 && only[0] !== undefined ? nameOf(only[0]) : null,
      registrations: [],
      evidence: "declared",
    };
  }
  return { kind: "model_switch", plugin: null, registrations: [], evidence: "declared" };
}

/**
 * 한 단계의 캐시 깨짐(§4.5 규칙 30). 순서가 정한다.
 * - 구조 경고가 있으면 원인은 경고다(`declared`). 사용량도 깨졌으면 `observed: true`, 아니면 예측만(`observed: false`).
 * - 구조 경고가 없고 사용량만 깨졌으면 원인은 `ttl`(앞 호출과 5분 넘게 떨어짐), `compaction`(압축이 이 단계 앞에 있었음), 아니면 `unknown`(추정)이다.
 * - 둘 다 없으면 `null`이다.
 */
export function cacheBreakOf(input: {
  readonly warnings: readonly StepContextWarning[];
  /** 이 단계의 모델 호출 사용량 합. 모델 호출이 없었으면 `undefined` */
  readonly current:
    | (CacheUsage & { readonly model: string; readonly startedAt: number })
    | undefined;
  /** 앞 모델 호출(같은 대화)의 사용량과 끝난 시각 */
  readonly prior: (CacheUsage & { readonly model: string; readonly endedAt: number }) | undefined;
  /** 이 단계 앞에 `thread.compacted`가 있었나 */
  readonly compacted: boolean;
  readonly pluginOfTool: (name: string) => string | undefined;
}): CacheBreak | null {
  const structural = input.warnings.filter(isStructural);
  const usageBroke = input.current !== undefined && cacheExpired(input.prior, input.current);
  if (structural.length === 0 && !usageBroke) return null;
  const usage = input.current ?? { cacheRead: 0, cacheWrite: 0 };
  const causes: CacheCause[] = [];
  let observed = usageBroke;
  if (structural.length > 0) {
    for (const warning of structural) causes.push(causeOf(warning, input.pluginOfTool));
  } else {
    observed = true;
    const gap =
      input.current === undefined || input.prior === undefined
        ? 0
        : input.current.startedAt - input.prior.endedAt;
    const kind: CacheCause["kind"] =
      input.prior !== undefined && gap > CACHE_TTL_MS
        ? "ttl"
        : input.compacted
          ? "compaction"
          : "unknown";
    causes.push({ kind, plugin: null, registrations: [], evidence: "inferred" });
  }
  return {
    observed,
    causes,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    priorCacheRead: input.prior?.cacheRead ?? null,
    priorCacheWrite: input.prior?.cacheWrite ?? null,
  };
}

/** 캐시 원인 한 줄의 저장 모양(`tr_cache`). `n`은 단계 안의 원인 순번이다 */
export function trCacheRowsOf(
  cache: CacheBreak,
  base: { readonly threadId: string; readonly turnId: string; readonly stepIndex: number },
): TrCacheRow[] {
  return cache.causes.map((cause, n) => ({
    threadId: base.threadId,
    turnId: base.turnId,
    stepIndex: base.stepIndex,
    n,
    observed: cache.observed,
    kind: cause.kind,
    plugin: cause.plugin,
    registrations: JSON.stringify(cause.registrations),
    evidence: cause.evidence,
    cacheRead: cache.cacheRead,
    cacheWrite: cache.cacheWrite,
    priorCacheRead: cache.priorCacheRead,
    priorCacheWrite: cache.priorCacheWrite,
  }));
}

// ---- 플러그인별 비용(§3.3) ------------------------------------------------

/**
 * 턴의 플러그인별 비용(`TurnRecord.cost`). 재료와 광고는 마지막 단계 기준 한 번만 센다(§3.3).
 * `always`는 항상 실린 재료와 지연이 아닌 광고 도구(활성화 도구 제외), `drive`는 주도 재료, `onDemand`는 스킬 본문과 활성화한 도구다.
 * `shared`는 그 플러그인 몫으로 적힌 재료 가운데 귀속이 `shared`인 것이 있으면 참이다
 */
export function pluginCostOf(input: {
  readonly materials: readonly Material[];
  readonly tools: readonly {
    readonly plugin: string;
    readonly tokens: number;
    readonly state: TurnToolRow["state"];
  }[];
  readonly skills: readonly { readonly plugin: string; readonly tokens: number }[];
}): PluginCost[] {
  const rows = new Map<
    string,
    { always: number; drive: number; onDemand: number; shared: boolean }
  >();
  const rowOf = (
    plugin: string,
  ): { always: number; drive: number; onDemand: number; shared: boolean } => {
    const found = rows.get(plugin);
    if (found !== undefined) return found;
    const created = { always: 0, drive: 0, onDemand: 0, shared: false };
    rows.set(plugin, created);
    return created;
  };
  for (const material of input.materials) {
    const row = rowOf(material.plugin);
    if (material.kind === "always") row.always += material.tokens;
    else if (material.kind === "drive") row.drive += material.tokens;
    else row.onDemand += material.tokens;
    if (material.attribution === "shared") row.shared = true;
  }
  for (const tool of input.tools) {
    const row = rowOf(tool.plugin);
    if (tool.state === "advertised") row.always += tool.tokens;
    else if (tool.state === "activated") row.onDemand += tool.tokens;
  }
  for (const skill of input.skills) {
    rowOf(skill.plugin).onDemand += skill.tokens;
  }
  return [...rows.entries()]
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([plugin, row]) => ({
      plugin,
      always: row.always,
      drive: row.drive,
      onDemand: row.onDemand,
      shared: row.shared,
    }));
}
