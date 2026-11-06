// P-20 Turn 다시 보기(§6.27, T-VIEW-TURN)의 순수 모델. `measure.turn`이 준 행(`kind`: turn·call·hook·ctx·cache)만 읽고 지어내지 않는다.
// 모르는 종류, 모르는 결과 이름, 빠진 값은 버리거나 원문 그대로 둔다(meas4가 값을 넓혀도 깨지지 않는다). 합치는 점수는 없다.
import type { MeasureRow, MeasureTurnResult } from "@fresnel/contracts/wire";

/** 핸들러 결과의 알려진 이름. wire가 주는 다섯(고침·지나감·막음·실패·건너뜀)이고 사용자 글도 같은 다섯 갈래다 */
export type OutcomeKey = "modified" | "passed" | "blocked" | "failed" | "skipped";

const KNOWN_OUTCOMES: readonly OutcomeKey[] = [
  "modified",
  "passed",
  "blocked",
  "failed",
  "skipped",
];

/** 결과 이름 하나. 모르는 이름은 `key`가 null이고 `raw`만 보인다 */
export interface OutcomeVM {
  readonly key: OutcomeKey | null;
  readonly raw: string;
  /** 실패나 예산 초과처럼 눈여겨볼 결과 */
  readonly problem: boolean;
}

const PROBLEM_OUTCOMES: ReadonlySet<string> = new Set(["failed"]);

export function outcomeOf(raw: string): OutcomeVM {
  const key = KNOWN_OUTCOMES.find((name) => name === raw) ?? null;
  return { key, raw, problem: PROBLEM_OUTCOMES.has(raw) };
}

/** 값 하나를 숫자로 읽는다. 없거나 유한하지 않으면 0 */
function num(row: MeasureRow, name: string): number {
  const value = row.metrics[name];
  return value !== undefined && Number.isFinite(value) ? value : 0;
}

function numOrNull(row: MeasureRow, name: string): number | null {
  const value = row.metrics[name];
  return value !== undefined && Number.isFinite(value) ? value : null;
}

function tag(row: MeasureRow, name: string): string {
  return row.tags[name] ?? "";
}

/** Turn 한 줄(`kind: "turn"`) */
export interface TurnSummaryVM {
  readonly status: string;
  readonly steps: number;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly totalTokens: number;
  readonly usd: number;
}

/** 모델 호출 한 번(`kind: "call"`) */
export interface TurnCallVM {
  readonly role: string;
  readonly model: string;
  readonly durationMs: number;
  readonly firstTokenMs: number | null;
  readonly totalTokens: number;
  readonly cacheRead: number;
  readonly usd: number;
}

/** 훅 발화 시간줄의 한 칸: 핸들러 하나의 실행 */
export interface HookEventVM {
  readonly seq: number;
  readonly step: number;
  readonly hook: string;
  readonly registrationId: string;
  readonly ms: number;
  readonly outcome: OutcomeVM;
}

/** 요청 구성 막대의 한 조각. `owner`가 null이 아니면 절 이름(소유자)이다 */
export type CompositionPart = "system" | "injected" | "volatile" | "history" | "section";

export interface CompositionSegmentVM {
  readonly part: CompositionPart;
  readonly owner: string | null;
  readonly tokens: number;
}

/** 단계 하나의 요청 구성. `tools`는 `total` 밖이라 따로 둔다 */
export interface CompositionBarVM {
  readonly step: number;
  readonly total: number;
  readonly tools: number;
  readonly segments: readonly CompositionSegmentVM[];
}

/** 캐시 사건 하나. 원인 소유자(`owner`)는 호스트가 아는 만큼만 있다 */
export interface CacheEventVM {
  readonly step: number;
  readonly code: string;
  readonly owner: string;
  readonly from: string;
  readonly to: string;
  /** 접두가 바뀐 위치. 모르면 null */
  readonly at: number | null;
  readonly added: number | null;
  readonly removed: number | null;
  /** 캐시 만료(`cache_expired`)일 때 다시 쓴 캐시 토큰과 앞 호출과의 간격(ms). 아니면 null */
  readonly cacheWrite: number | null;
  readonly gapMs: number | null;
}

/** 플러그인 하나가 이 Turn에 낸 몫. 점수가 아니라 칸마다 따로 보인다 */
export interface PluginShareVM {
  readonly owner: string;
  readonly hookMs: number;
  readonly handlers: number;
  readonly problems: number;
  /** 요청 구성에서 이 소유자의 절이 차지한 토큰(단계별 합) */
  readonly sectionTokens: number;
  /** 원인 소유자가 이 플러그인으로 적힌 캐시 사건 수 */
  readonly cacheEvents: number;
}

export interface TurnViewVM {
  readonly summary: TurnSummaryVM | null;
  readonly calls: readonly TurnCallVM[];
  readonly hooks: readonly HookEventVM[];
  readonly hookTotalMs: number;
  readonly bars: readonly CompositionBarVM[];
  readonly cache: readonly CacheEventVM[];
  /** 훅 시간이 긴 순서. 같으면 절 토큰이 큰 순서 */
  readonly plugins: readonly PluginShareVM[];
}

/** 화면 상태. `off`는 측정이 꺼져 있다는 뜻이고, `empty`는 켜져 있으나 이 Turn의 기록이 없다(보존 기간이 지났거나 아직 안 쓰였다) */
export type TurnViewState =
  | { readonly kind: "off" }
  | { readonly kind: "empty" }
  | { readonly kind: "ready"; readonly view: TurnViewVM };

function summaryOf(rows: readonly MeasureRow[]): TurnSummaryVM | null {
  const row = rows.find((candidate) => candidate.kind === "turn");
  if (row === undefined) return null;
  return {
    status: tag(row, "status"),
    steps: num(row, "steps"),
    input: num(row, "input"),
    output: num(row, "output"),
    cacheRead: num(row, "cacheRead"),
    cacheWrite: num(row, "cacheWrite"),
    totalTokens: num(row, "totalTokens"),
    usd: num(row, "usd"),
  };
}

function callsOf(rows: readonly MeasureRow[]): readonly TurnCallVM[] {
  return rows
    .filter((row) => row.kind === "call")
    .map((row) => ({
      role: tag(row, "role"),
      model: tag(row, "model"),
      durationMs: num(row, "durationMs"),
      firstTokenMs: numOrNull(row, "firstTokenMs"),
      totalTokens: num(row, "totalTokens"),
      cacheRead: num(row, "cacheRead"),
      usd: num(row, "usd"),
    }));
}

function hooksOf(rows: readonly MeasureRow[]): readonly HookEventVM[] {
  return rows
    .filter((row) => row.kind === "hook")
    .map((row, index) => ({ row, index }))
    .map(({ row, index }) => ({
      index,
      event: {
        seq: num(row, "seq"),
        step: num(row, "step"),
        hook: tag(row, "hook"),
        registrationId: tag(row, "registrationId"),
        ms: num(row, "ms"),
        outcome: outcomeOf(tag(row, "result")),
      },
    }))
    .toSorted((a, b) => a.event.seq - b.event.seq || a.index - b.index)
    .map(({ event }) => event);
}

const SECTION_PREFIX = "section.";

function barsOf(rows: readonly MeasureRow[]): readonly CompositionBarVM[] {
  return rows
    .filter((row) => row.kind === "ctx")
    .map((row) => {
      const segments: CompositionSegmentVM[] = [
        { part: "system", owner: null, tokens: num(row, "system") },
      ];
      for (const [name, value] of Object.entries(row.metrics)) {
        if (!name.startsWith(SECTION_PREFIX) || !Number.isFinite(value)) continue;
        segments.push({ part: "section", owner: name.slice(SECTION_PREFIX.length), tokens: value });
      }
      segments.push(
        { part: "injected", owner: null, tokens: num(row, "injected") },
        { part: "volatile", owner: null, tokens: num(row, "volatile") },
        { part: "history", owner: null, tokens: num(row, "history") },
      );
      return {
        step: num(row, "step"),
        total: num(row, "total"),
        tools: num(row, "tools"),
        segments: segments.filter((segment) => segment.tokens > 0),
      };
    })
    .toSorted((a, b) => a.step - b.step);
}

function cacheOf(rows: readonly MeasureRow[]): readonly CacheEventVM[] {
  return rows
    .filter((row) => row.kind === "cache")
    .map((row) => {
      const at = numOrNull(row, "at");
      return {
        step: num(row, "step"),
        code: tag(row, "code"),
        owner: tag(row, "owner"),
        from: tag(row, "from"),
        to: tag(row, "to"),
        at: at === null || at < 0 ? null : at,
        added: numOrNull(row, "added"),
        removed: numOrNull(row, "removed"),
        cacheWrite: numOrNull(row, "cacheWrite"),
        gapMs: numOrNull(row, "gapMs"),
      };
    })
    .toSorted((a, b) => a.step - b.step);
}

function pluginsOf(
  hooks: readonly HookEventVM[],
  bars: readonly CompositionBarVM[],
  cache: readonly CacheEventVM[],
): readonly PluginShareVM[] {
  const byOwner = new Map<string, { -readonly [K in keyof PluginShareVM]: PluginShareVM[K] }>();
  const slot = (owner: string): { -readonly [K in keyof PluginShareVM]: PluginShareVM[K] } => {
    const found = byOwner.get(owner);
    if (found !== undefined) return found;
    const made = {
      owner,
      hookMs: 0,
      handlers: 0,
      problems: 0,
      sectionTokens: 0,
      cacheEvents: 0,
    };
    byOwner.set(owner, made);
    return made;
  };
  for (const hook of hooks) {
    if (hook.registrationId === "") continue;
    const share = slot(hook.registrationId);
    share.hookMs += hook.ms;
    share.handlers += 1;
    if (hook.outcome.problem) share.problems += 1;
  }
  for (const bar of bars) {
    for (const segment of bar.segments) {
      if (segment.part === "section" && segment.owner !== null) {
        slot(segment.owner).sectionTokens += segment.tokens;
      }
    }
  }
  // 캐시 사건의 원인이 이 Turn의 플러그인으로 적힌 때만 그 플러그인 몫에 센다(`context-hook` 같은 종류 이름은 플러그인이 아니다)
  for (const event of cache) {
    const share = byOwner.get(event.owner);
    if (share !== undefined) share.cacheEvents += 1;
  }
  return [...byOwner.values()].toSorted(
    (a, b) =>
      b.hookMs - a.hookMs || b.sectionTokens - a.sectionTokens || a.owner.localeCompare(b.owner),
  );
}

/** `measure.turn` 결과를 화면 상태로 바꾼다 */
export function turnViewOf(result: MeasureTurnResult): TurnViewState {
  if (!result.enabled) return { kind: "off" };
  if (result.rows.length === 0) return { kind: "empty" };
  const hooks = hooksOf(result.rows);
  const bars = barsOf(result.rows);
  const cache = cacheOf(result.rows);
  return {
    kind: "ready",
    view: {
      summary: summaryOf(result.rows),
      calls: callsOf(result.rows),
      hooks,
      hookTotalMs: hooks.reduce((sum, hook) => sum + hook.ms, 0),
      bars,
      cache,
      plugins: pluginsOf(hooks, bars, cache),
    },
  };
}
