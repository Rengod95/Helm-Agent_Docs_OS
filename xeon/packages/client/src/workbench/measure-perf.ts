// P-20 성능 측정 첫 화면(§6.27, T-VIEW-PERF)의 순수 모델: 최근 달라진 것, 이상 신호, 읽어 볼 Turn, 플러그인 부담 표, Turn 번호 곡선.
// 합치는 점수와 숫자 판은 만들지 않는다. 모든 칸은 wire가 준 값에서 바로 나오고, 값이 없는 칸(플러그인별 비용)은 null이다.
import type { MeasureDay, MeasureTurnResult } from "@fresnel/contracts/wire";
import { turnViewOf, type TurnViewVM } from "./measure-turn.ts";

/** 지표 하나의 일별 집계 */
export interface DailySeries {
  readonly kind: string;
  readonly metric: string;
  readonly days: readonly MeasureDay[];
}

/** 하루 평균. 기록이 없으면 null */
function meanOf(days: readonly MeasureDay[]): number | null {
  const count = days.reduce((total, day) => total + day.count, 0);
  if (count === 0) return null;
  return days.reduce((total, day) => total + day.sum, 0) / count;
}

/** "달라졌다"고 보이는 변화의 기준(비율). [제안] 기본값이라 사용자 결정 전까지 이 값을 쓴다 */
export const CHANGE_THRESHOLD = 0.2;

export type ChangeDirection = "up" | "down" | "same";

/** 최근 달라진 것 한 줄: 가장 최근 날의 평균과 그 앞 날들의 평균 */
export interface ChangeVM {
  readonly kind: string;
  readonly metric: string;
  readonly day: string;
  readonly latest: number;
  readonly before: number;
  /** (latest - before) / before. before가 0이면 null */
  readonly ratio: number | null;
  readonly direction: ChangeDirection;
}

export function changesOf(series: readonly DailySeries[]): readonly ChangeVM[] {
  const out: ChangeVM[] = [];
  for (const one of series) {
    const sorted = one.days.toSorted((a, b) => a.day.localeCompare(b.day));
    const last = sorted.at(-1);
    if (last === undefined || last.count === 0) continue;
    const before = meanOf(sorted.slice(0, -1));
    if (before === null) continue;
    const latest = last.sum / last.count;
    const ratio = before === 0 ? null : (latest - before) / before;
    const moved = ratio === null ? latest !== before : Math.abs(ratio) >= CHANGE_THRESHOLD;
    const direction: ChangeDirection = !moved ? "same" : latest > before ? "up" : "down";
    out.push({
      kind: one.kind,
      metric: one.metric,
      day: last.day,
      latest,
      before,
      ratio,
      direction,
    });
  }
  return out;
}

/** 읽은 Turn 하나. `turnId`와 번호(읽은 목록 안의 차례, 1부터) */
export interface PerfTurnInput {
  readonly turnId: string;
  readonly result: MeasureTurnResult;
}

export type SignalKind = "problem" | "cacheBreak" | "heavy";

/** 이상 신호 한 줄. 눌러서 그 Turn으로 내려간다 */
export interface SignalVM {
  readonly kind: SignalKind;
  readonly turnId: string;
  readonly number: number;
  /** problem: 실패·예산 초과 핸들러 수, cacheBreak: 캐시 사건 수, heavy: 토큰 수 */
  readonly count: number;
}

export interface CurvePointVM {
  readonly turnId: string;
  readonly number: number;
  readonly totalTokens: number;
  readonly usd: number;
  /** 호출 시간 합(ms) */
  readonly durationMs: number;
}

/** 플러그인 부담 표 한 줄: 읽은 Turn 전체의 합과 Turn당 평균 */
export interface BurdenRowVM {
  readonly owner: string;
  readonly turns: number;
  readonly sectionTokens: number;
  /** 문맥에 더한 토큰의 Turn당 평균(절 토큰, 없으면 훅 글자 수 추정) */
  readonly tokensPerTurn: number;
  /** 한 Turn이라도 훅 글자 수에서 추정한 값이 들었으면 true. 화면은 추정이라고 밝힌다 */
  readonly tokensEstimated: boolean;
  readonly hookMs: number;
  readonly msPerTurn: number;
  readonly problems: number;
  readonly cacheEvents: number;
  /** 플러그인별 비용은 wire에 없다 */
  readonly costUsd: number | null;
  /** 이 플러그인이 훅 시간을 가장 많이 쓴 Turn. 눌러서 내려갈 곳 */
  readonly worstTurnId: string;
}

export interface PerfViewVM {
  readonly changes: readonly ChangeVM[];
  readonly signals: readonly SignalVM[];
  /** 읽어 볼 Turn: 신호가 많은 순서, 같으면 토큰이 큰 순서 */
  readonly toRead: readonly SignalTurnVM[];
  readonly burden: readonly BurdenRowVM[];
  readonly curve: readonly CurvePointVM[];
}

export interface SignalTurnVM {
  readonly turnId: string;
  readonly number: number;
  readonly signals: readonly SignalKind[];
  readonly totalTokens: number;
}

export type PerfState =
  | { readonly kind: "off" }
  | { readonly kind: "empty" }
  | { readonly kind: "ready"; readonly view: PerfViewVM };

/** 읽어 볼 Turn과 신호 줄의 상한 */
export const TO_READ_MAX = 5;
/** 무거운 Turn으로 보는 기준: 읽은 Turn의 중앙값 토큰의 몇 배인가([제안] 기본 2배). Turn이 4개 미만이면 보지 않는다 */
export const HEAVY_FACTOR = 2;
const HEAVY_MIN_TURNS = 4;

function medianOf(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const low = sorted[mid - 1];
  const high = sorted[mid];
  if (high === undefined) return 0;
  return sorted.length % 2 === 1 || low === undefined ? high : (low + high) / 2;
}

interface Read {
  readonly turnId: string;
  readonly number: number;
  readonly view: TurnViewVM;
}

function tokensOf(view: TurnViewVM): number {
  if (view.summary !== null) return view.summary.totalTokens;
  return view.calls.reduce((total, call) => total + call.totalTokens, 0);
}

export function perfViewOf(
  series: readonly DailySeries[],
  turns: readonly PerfTurnInput[],
): PerfState {
  const reads: Read[] = [];
  let anyOff = false;
  for (const [index, turn] of turns.entries()) {
    const state = turnViewOf(turn.result);
    if (state.kind === "off") anyOff = true;
    if (state.kind === "ready") {
      reads.push({ turnId: turn.turnId, number: index + 1, view: state.view });
    }
  }
  const changes = changesOf(series);
  if (reads.length === 0 && changes.length === 0) return { kind: anyOff ? "off" : "empty" };

  const curve: CurvePointVM[] = reads.map((read) => ({
    turnId: read.turnId,
    number: read.number,
    totalTokens: tokensOf(read.view),
    usd: read.view.summary?.usd ?? read.view.calls.reduce((total, call) => total + call.usd, 0),
    durationMs: read.view.calls.reduce((total, call) => total + call.durationMs, 0),
  }));

  const median = curve.length >= HEAVY_MIN_TURNS ? medianOf(curve.map((p) => p.totalTokens)) : 0;
  const signals: SignalVM[] = [];
  const byTurn = new Map<string, SignalKind[]>();
  const add = (signal: SignalVM): void => {
    signals.push(signal);
    byTurn.set(signal.turnId, [...(byTurn.get(signal.turnId) ?? []), signal.kind]);
  };
  for (const read of reads) {
    const problems = read.view.hooks.filter((hook) => hook.outcome.problem).length;
    if (problems > 0)
      add({ kind: "problem", turnId: read.turnId, number: read.number, count: problems });
    if (read.view.cache.length > 0) {
      add({
        kind: "cacheBreak",
        turnId: read.turnId,
        number: read.number,
        count: read.view.cache.length,
      });
    }
    const tokens = tokensOf(read.view);
    if (median > 0 && tokens >= median * HEAVY_FACTOR) {
      add({ kind: "heavy", turnId: read.turnId, number: read.number, count: tokens });
    }
  }
  const toRead = reads
    .flatMap((read) => {
      const kinds = byTurn.get(read.turnId);
      return kinds === undefined
        ? []
        : [
            {
              turnId: read.turnId,
              number: read.number,
              signals: kinds,
              totalTokens: tokensOf(read.view),
            },
          ];
    })
    .toSorted((a, b) => b.signals.length - a.signals.length || b.totalTokens - a.totalTokens)
    .slice(0, TO_READ_MAX);

  const owners = new Map<
    string,
    {
      turns: number;
      sectionTokens: number;
      tokens: number;
      estimated: boolean;
      hookMs: number;
      problems: number;
      cacheEvents: number;
      worstMs: number;
      worstTurnId: string;
    }
  >();
  for (const read of reads) {
    for (const plugin of read.view.plugins) {
      const row = owners.get(plugin.owner) ?? {
        turns: 0,
        sectionTokens: 0,
        tokens: 0,
        estimated: false,
        hookMs: 0,
        problems: 0,
        cacheEvents: 0,
        worstMs: -1,
        worstTurnId: read.turnId,
      };
      row.turns += 1;
      row.sectionTokens += plugin.sectionTokens;
      row.tokens += plugin.tokens;
      row.estimated = row.estimated || plugin.tokensEstimated;
      row.hookMs += plugin.hookMs;
      row.problems += plugin.problems;
      row.cacheEvents += plugin.cacheEvents;
      if (plugin.hookMs > row.worstMs) {
        row.worstMs = plugin.hookMs;
        row.worstTurnId = read.turnId;
      }
      owners.set(plugin.owner, row);
    }
  }
  const burden: BurdenRowVM[] = [...owners.entries()]
    .map(([owner, row]) => ({
      owner,
      turns: row.turns,
      sectionTokens: row.sectionTokens,
      tokensPerTurn: Math.round(row.tokens / row.turns),
      tokensEstimated: row.estimated,
      hookMs: row.hookMs,
      msPerTurn: Math.round(row.hookMs / row.turns),
      problems: row.problems,
      cacheEvents: row.cacheEvents,
      costUsd: null,
      worstTurnId: row.worstTurnId,
    }))
    .toSorted(
      (a, b) =>
        b.hookMs - a.hookMs || b.tokensPerTurn - a.tokensPerTurn || a.owner.localeCompare(b.owner),
    );

  return { kind: "ready", view: { changes, signals, toRead, burden, curve } };
}
