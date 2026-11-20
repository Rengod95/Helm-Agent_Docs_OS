// 트레이스(C8)의 순수 모델. 턴 기록 하나(`TurnRecord`)를 두 가지로 읽게 만든다:
// - 시간 순서: 줄(모델 호출, Hook, 도구, 사람에게 묻기, Drive)마다 구간. 시각은 턴 시작부터의 ms다(턴 전 Hook은 0).
// - 블록의 자리: 기본 턴 흐름의 여섯 블록(컨텍스트 조립 … 기록)에 무엇이 실렸고 어떤 Hook이 무엇을 정했나.
// Hook 자리 이름은 내부 이름(`tool.call.before`)이 아니라 블록 이름과 앞·뒤로 말한다(`BLOCK_MODEL`).
import { hookDisplayOutcomeOf } from "@fresnel/client";
import { BLOCK_MODEL } from "@fresnel/contracts/blocks";
import type { BlockId, HookOutcomeOrSkipped } from "@fresnel/contracts/extensions";
import type {
  CallRecord,
  FrameMark,
  HookRun,
  Material,
  ModelCall,
  TurnRecord,
} from "@fresnel/contracts/wire";

// ───────── Hook 자리 ─────────

export type { BlockId };
export const BLOCK_IDS: readonly BlockId[] = [
  "context",
  "model",
  "tools",
  "ask",
  "agents",
  "record",
];

/** Hook 하나가 앉은 자리: 블록과 앞·뒤·사건, 또는 경계(대화 시작, 입력 받기, 턴 종료 직전) */
export type HookPlace =
  | { readonly kind: "block"; readonly block: BlockId; readonly side: "before" | "after" | "event" }
  | {
      readonly kind: "boundary";
      readonly id: string;
      readonly label: { readonly ko: string; readonly en: string };
    }
  | { readonly kind: "unknown" };

const PLACE_BY_HOOK: ReadonlyMap<string, HookPlace> = (() => {
  const map = new Map<string, HookPlace>();
  for (const block of BLOCK_MODEL.blocks) {
    const id = block.id;
    for (const h of block.hooks.before) map.set(h, { kind: "block", block: id, side: "before" });
    for (const h of block.hooks.after) map.set(h, { kind: "block", block: id, side: "after" });
    for (const h of block.hooks.events) {
      if (!map.has(h)) map.set(h, { kind: "block", block: id, side: "event" });
    }
  }
  for (const boundary of BLOCK_MODEL.boundaries) {
    for (const h of boundary.hooks) {
      if (!map.has(h)) map.set(h, { kind: "boundary", id: boundary.id, label: boundary.label });
    }
  }
  return map;
})();

export function hookPlaceOf(hook: string): HookPlace {
  return PLACE_BY_HOOK.get(hook) ?? { kind: "unknown" };
}

/** 블록의 표시 이름(엔진의 블록 모델 문구) */
export function blockLabelOf(id: BlockId, locale: string): string {
  const block = BLOCK_MODEL.blocks.find((b) => b.id === id);
  if (block === undefined) return id;
  return locale.startsWith("ko") ? block.label.ko : block.label.en;
}

// ───────── Hook 결과 ─────────

export type Outcome = HookOutcomeOrSkipped;

function outcomeOf(run: HookRun): Outcome {
  return hookDisplayOutcomeOf(run);
}

/** 의도한 막음과 고장(오류·시간 초과)을 가른다 */
export function isFault(outcome: Outcome): boolean {
  return outcome === "error" || outcome === "timeout";
}

/** 턴의 모든 Hook 실행(턴 전, 단계, 도구 호출 아래)과 그 단계 번호(턴 전은 null) */
export interface HookEntry {
  readonly run: HookRun;
  readonly step: number | null;
  readonly call: CallRecord | null;
  readonly outcome: Outcome;
  readonly place: HookPlace;
}

export function hookEntryOf(run: HookRun, step: number | null, call: CallRecord | null): HookEntry {
  return { run, step, call, outcome: outcomeOf(run), place: hookPlaceOf(run.hook) };
}

/** 시각 순서로 줄 세운다(같은 시각이면 실행 순서) */
export function sortEntries(entries: readonly HookEntry[]): HookEntry[] {
  return entries.toSorted((a, b) => a.run.atMs - b.run.atMs || a.run.seq - b.run.seq);
}

export function hookEntriesOf(record: TurnRecord): HookEntry[] {
  const out: HookEntry[] = [];
  const push = (run: HookRun, step: number | null, call: CallRecord | null): void => {
    out.push(hookEntryOf(run, step, call));
  };
  for (const run of record.turnHooks) push(run, null, null);
  for (const step of record.steps) {
    for (const run of step.hooks) push(run, step.stepIndex, null);
    for (const call of step.calls) for (const run of call.hooks) push(run, step.stepIndex, call);
  }
  return out.toSorted((a, b) => a.run.atMs - b.run.atMs || a.run.seq - b.run.seq);
}

const OUTCOME_ORDER: readonly Outcome[] = [
  "blocked",
  "asked",
  "modified",
  "error",
  "timeout",
  "pass",
  "skipped",
];

/** 결과별 개수(0인 것은 뺀다). 순서는 `OUTCOME_ORDER` */
export function outcomeCountsOf(
  entries: readonly HookEntry[],
): { readonly outcome: Outcome; readonly n: number }[] {
  return OUTCOME_ORDER.map((outcome) => ({
    outcome,
    n: entries.filter((e) => e.outcome === outcome).length,
  })).filter((c) => c.n > 0);
}

// ───────── 시간 순서 ─────────

export const LANES = ["model", "hook", "tool", "ask", "drive"] as const;
export type Lane = (typeof LANES)[number];

export interface Span {
  readonly id: string;
  readonly lane: Lane;
  readonly startMs: number;
  /** 아직 끝나지 않았으면 null(턴이 도는 중) */
  readonly endMs: number | null;
  readonly label: string;
  readonly plugin: string | null;
  readonly outcome: Outcome | null;
  readonly step: number | null;
  /** Drive 줄의 깊이(0부터) */
  readonly depth: number;
}

function modelSpan(call: ModelCall, step: number, i: number): Span {
  return {
    id: `m:${String(step)}:${String(i)}`,
    lane: "model",
    startMs: call.startedAtMs,
    endMs: call.startedAtMs + call.durationMs,
    label: call.modelId,
    plugin: null,
    outcome: null,
    step,
    depth: 0,
  };
}

function hookSpan(entry: HookEntry): Span {
  return {
    id: `h:${entry.run.registrationId}:${String(entry.run.seq)}:${String(entry.run.atMs)}:${entry.run.toolCallId ?? ""}`,
    lane: "hook",
    startMs: entry.run.atMs,
    endMs: entry.run.atMs + Math.max(entry.run.ms, 0),
    label: entry.run.plugin,
    plugin: entry.run.plugin,
    outcome: entry.outcome,
    step: entry.step,
    depth: 0,
  };
}

function callSpans(call: CallRecord, step: number): Span[] {
  const spans: Span[] = [];
  const exec = call.exec;
  if (exec !== null) {
    spans.push({
      id: `t:${call.toolCallId}`,
      lane: "tool",
      startMs: exec.startedAtMs,
      endMs: exec.durationMs === null ? null : exec.startedAtMs + exec.durationMs,
      label: call.tool,
      plugin: call.plugin,
      outcome: null,
      step,
      depth: 0,
    });
    if (call.approval !== null && call.approval.waitMs > 0) {
      spans.push({
        id: `a:${call.toolCallId}`,
        lane: "ask",
        startMs: Math.max(0, exec.startedAtMs - call.approval.waitMs),
        endMs: exec.startedAtMs,
        label: call.tool,
        plugin: call.plugin,
        outcome: null,
        step,
        depth: 0,
      });
    }
  }
  return spans;
}

function frameSpan(frame: FrameMark, i: number): Span {
  return {
    id: `d:${frame.leaseId ?? String(i)}`,
    lane: "drive",
    startMs: frame.enteredAtMs,
    endMs: frame.exitedAtMs,
    label: frame.plugin ?? "",
    plugin: frame.plugin,
    outcome: null,
    step: null,
    depth: frame.depth,
  };
}

export function spansOf(record: TurnRecord): Span[] {
  const spans: Span[] = [];
  for (const step of record.steps) {
    step.modelCalls.forEach((call, i) => {
      spans.push(modelSpan(call, step.stepIndex, i));
    });
    for (const call of step.calls) spans.push(...callSpans(call, step.stepIndex));
  }
  for (const entry of hookEntriesOf(record)) {
    spans.push(hookSpan(entry));
    const ask = entry.run.ask;
    if (ask !== null && ask.waitMs > 0) {
      spans.push({
        id: `ha:${entry.run.registrationId}:${String(entry.run.seq)}:${String(entry.run.atMs)}`,
        lane: "ask",
        startMs: entry.run.atMs + entry.run.ms,
        endMs: entry.run.atMs + entry.run.ms + ask.waitMs,
        label: entry.run.plugin,
        plugin: entry.run.plugin,
        outcome: "asked",
        step: entry.step,
        depth: 0,
      });
    }
  }
  record.frames.forEach((frame, i) => {
    spans.push(frameSpan(frame, i));
  });
  return spans;
}

/** 턴 길이(ms). 끝났으면 끝 시각, 도는 중이면 지금까지 받은 가장 늦은 구간 끝(알림이 올 때마다 늘어난다) */
export function turnLengthOf(record: TurnRecord, spans: readonly Span[]): number {
  if (record.endedAt !== null) return Math.max(1, record.endedAt - record.startedAt);
  return Math.max(1, ...spans.map((s) => s.endMs ?? s.startMs));
}

/** 단계의 경계(턴 시작부터 ms). 단계의 첫 모델 호출 시작이 그 단계의 시작이다 */
export function stepMarksOf(
  record: TurnRecord,
): { readonly step: number; readonly atMs: number }[] {
  return record.steps
    .map((s) => ({ step: s.stepIndex, atMs: s.modelCalls[0]?.startedAtMs ?? null }))
    .filter((s): s is { step: number; atMs: number } => s.atMs !== null);
}

// ───────── 실린 것 ─────────

export interface LoadedGroup {
  readonly plugin: string;
  readonly instruction: number;
  readonly skills: number;
  readonly tools: number;
  readonly other: number;
  readonly truncated: boolean;
  readonly items: readonly Material[];
}

/**
 * 플러그인별로 실린 재료. 단계마다 같은 컨텍스트를 다시 보내므로 단계 합이 아니라 서로 다른 재료(플러그인, 종류, 참조)마다
 * 한 번 센다. 같은 재료가 단계마다 크기가 다르면 가장 큰 값이다. 토큰이 많은 순
 */
export function loadedOf(record: TurnRecord): LoadedGroup[] {
  const distinct = new Map<string, Material>();
  for (const step of record.steps) {
    for (const m of step.materials) {
      const key = `${m.plugin}\u0000${m.material}\u0000${m.ref}`;
      const seen = distinct.get(key);
      if (seen === undefined || m.tokens > seen.tokens) distinct.set(key, m);
    }
  }
  const by = new Map<string, Material[]>();
  for (const m of distinct.values()) by.set(m.plugin, [...(by.get(m.plugin) ?? []), m]);
  const groups = [...by.entries()].map(([plugin, items]) => {
    const sum = (pick: (m: Material) => boolean): number =>
      items.filter(pick).reduce((s, m) => s + m.tokens, 0);
    return {
      plugin,
      instruction: sum(
        (m) =>
          m.material === "instruction" || m.material === "memory" || m.material === "hook_text",
      ),
      skills: sum((m) => m.material === "skill_index" || m.material === "skill_body"),
      tools: sum((m) => m.material === "tool_defs"),
      other: 0,
      truncated: items.some((m) => m.truncated),
      items,
    };
  });
  return groups.toSorted(
    (a, b) =>
      b.instruction + b.skills + b.tools - (a.instruction + a.skills + a.tools) ||
      a.plugin.localeCompare(b.plugin),
  );
}

// ───────── Drive ─────────

/** Drive 경로: 깊이 순으로 이름. 이름 없는 맨 아래 칸은 기본 턴 흐름이다 */
export function drivePathOf(frames: readonly FrameMark[]): FrameMark[] {
  return frames.toSorted((a, b) => a.depth - b.depth || a.enteredAtMs - b.enteredAtMs);
}

function ratio(used: number, limit: number | undefined): number | null {
  return limit === undefined || limit <= 0 ? null : Math.min(1, used / limit);
}

/** 한도 대비 사용(0~1). 한도가 없으면 null */
export function usageOf(frame: FrameMark): {
  readonly turns: number | null;
  readonly tokens: number | null;
  readonly spawns: number | null;
} {
  return {
    turns: ratio(frame.used.turns, frame.limits.maxTurns),
    tokens: ratio(frame.used.tokens, frame.limits.maxTokens),
    spawns: ratio(frame.used.spawns, frame.limits.maxSpawns),
  };
}

// ───────── 비용 ─────────

export interface TurnTotals {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly modelCalls: number;
  readonly toolCalls: number;
}

export function totalsOf(record: TurnRecord): TurnTotals {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let modelCalls = 0;
  let toolCalls = 0;
  for (const step of record.steps) {
    for (const call of step.modelCalls) {
      input += call.usage.input;
      output += call.usage.output;
      cacheRead += call.usage.cacheRead;
      cacheWrite += call.usage.cacheWrite;
      modelCalls += 1;
    }
    toolCalls += step.calls.length;
  }
  return { input, output, cacheRead, cacheWrite, modelCalls, toolCalls };
}
