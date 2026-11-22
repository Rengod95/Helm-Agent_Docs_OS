// cv6 상세 패널 "작동 방식"의 네 줄(시점·입력·영향·출력)과 같은 자리의 합치는 방식을 만드는 순수 함수.
// 값은 계약과 표본에서만 온다: 매니페스트 `hooks`(Hook 이름) → 계약의 `HOOKS`(kind·fold)와 `HOOK_POSITIONS`(자리·powers),
// `requires`·`optional`·`readsRecordKinds`·`replaces`·`provides`·`recordKinds`, 카드의 `cost`, MCP `launch.envNames`, 표본의 구성 요소.
// 지어낸 값은 없다. 화면 글은 message id로만 돌려준다.
// cv3와 다른 점(사용자 2026-11-20): 칩에 내부 이름(Hook 이름 `tool.call.before`, 기능 id, 기록 종류)을 싣지 않는다.
// 그런 값은 같은 말끼리 모아 개수만 남긴다. 사람이 고르거나 적는 이름(파일, 플러그인, MCP 서버, 도구, 환경 변수)만 값으로 남는다.
// 같은 자리에 붙는 Hook이 여럿이면 시점 칩은 하나다.
import type { MessageId } from "@fresnel/client/i18n";
import {
  HOOK_POSITIONS,
  HOOKS,
  type Fold,
  type HookKind,
  type HookName,
  type HookPosition,
  type HookPower,
} from "@fresnel/contracts/extensions";
import type { Anchor, Plugin } from "./model.ts";

export interface Fact {
  readonly word: MessageId;
  /** 사람이 고르거나 적는 이름(파일·플러그인·서버·도구·환경 변수)이나 수. 없으면 null */
  readonly value: string | null;
  /** 같은 말로 모은 칩의 수(내부 이름을 뺀 값). 1이면 보이지 않는다 */
  readonly count: number;
  /** 경고로 보인다(내장 도구 대체, 쓰는 도구) */
  readonly warn: boolean;
  /** 언제 줄의 Hook: 루프 위 자리. 있으면 화면은 `word` 대신 그 자리 말을 쓴다 */
  readonly at: Anchor | null;
}

export interface PluginFacts {
  readonly when: readonly Fact[];
  readonly reads: readonly Fact[];
  readonly changes: readonly Fact[];
  readonly gives: readonly Fact[];
}

interface HookRow {
  readonly hook: HookName;
  /** 루프 위 자리(캔버스의 붙는 자리 말). 자리 없는 소식이면 null */
  readonly anchor: Anchor | null;
  readonly fold: Fold;
  readonly powers: readonly HookPower[];
}

const fact = (word: MessageId, value: string | null = null, warn = false): Fact => ({
  word,
  value,
  warn,
  at: null,
  count: 1,
});

const READS_KIND: Readonly<Record<HookKind, MessageId>> = {
  input: "desktop.craft.canvas.cv3.fact.reads.kind.input",
  request: "desktop.craft.canvas.cv3.fact.reads.kind.request",
  tool: "desktop.craft.canvas.cv3.fact.reads.kind.tool",
  boundary: "desktop.craft.canvas.cv3.fact.reads.kind.boundary",
  thread: "desktop.craft.canvas.cv3.fact.reads.kind.thread",
  lifecycle: "desktop.craft.canvas.cv3.fact.reads.kind.lifecycle",
  guard: "desktop.craft.canvas.cv3.fact.reads.kind.guard",
  ask: "desktop.craft.canvas.cv3.fact.reads.kind.ask",
  agent: "desktop.craft.canvas.cv3.fact.reads.kind.agent",
};

const POWER_WORD: Readonly<Record<HookPower, MessageId>> = {
  observe: "desktop.craft.canvas.cv3.fact.changes.observe",
  modify: "desktop.craft.canvas.cv3.fact.changes.modify",
  decide: "desktop.craft.canvas.cv3.fact.changes.decide",
  contribute: "desktop.craft.canvas.cv3.fact.changes.contribute",
};

export const FOLD_WORD: Readonly<Record<Fold, MessageId>> = {
  chain: "desktop.craft.canvas.cv3.fold.chain",
  first: "desktop.craft.canvas.cv3.fold.first",
  tap: "desktop.craft.canvas.cv3.fold.tap",
  collect: "desktop.craft.canvas.cv3.fold.collect",
};

const DECISION_FACT: Readonly<Record<"block" | "replace" | "ask", MessageId>> = {
  block: "desktop.craft.canvas.cv3.fact.gives.block",
  replace: "desktop.craft.canvas.cv3.fact.gives.replace",
  ask: "desktop.craft.canvas.cv3.fact.gives.ask",
};

/** 계약의 Hook 자리를 캔버스의 붙는 자리 말로. 블록에 붙지 않은 소식은 null */
export function anchorOfPosition(p: HookPosition): Anchor | null {
  if (p.kind === "block") return `${p.side}:${p.block}`;
  if (p.kind === "boundary") return `boundary:${p.boundary}`;
  if (p.kind === "event" && p.anchor !== undefined && p.anchor.block !== "record")
    return `${p.anchor.side}:${p.anchor.block}`;
  return null;
}

/** 매니페스트 `hooks`마다 자리·합치는 방식·할 수 있는 일(계약 값) */
function hookRows(p: Plugin): readonly HookRow[] {
  return p.meta.hooks.map((h) => {
    const pos = HOOK_POSITIONS[h].positions[0];
    return {
      hook: h,
      anchor: pos === undefined ? null : anchorOfPosition(pos),
      fold: HOOKS[h].fold,
      powers: HOOK_POSITIONS[h].powers,
    };
  });
}

/** 내부 이름(기능 id, 기록 종류)은 싣지 않고 수만 남긴다 */
function counted(into: Fact[], word: MessageId, n: number): void {
  if (n > 0) into.push({ ...fact(word), count: n });
}

function unique<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

/**
 * 네 줄(시점·입력·영향·출력)의 값. `start`는 이 프로필의 스타트 Drive인가, `handoffFrom`은 이 Drive로 넘겨주는 Drive들이다.
 * Hook은 시점 줄에 자리 말로(같은 자리는 하나), 입력 줄에 Hook 종류(kind)의 말로, 영향 줄에 powers의 말로 선다. Hook 이름은 싣지 않는다
 */
export function pluginFacts(
  p: Plugin,
  ctx: { readonly start: boolean; readonly handoffFrom: readonly string[] },
): PluginFacts {
  const s = p.shared;
  const m = p.meta;
  const rows = hookRows(p);
  const when: Fact[] = [];
  const reads: Fact[] = [];
  const changes: Fact[] = [];
  const gives: Fact[] = [];

  // 시점
  if (p.kind === "inject") {
    if (s.instructions.length > 0 || s.memory.length > 0)
      when.push(fact("desktop.craft.canvas.cv3.fact.when.everyTurn"));
    if (s.skills.length > 0) when.push(fact("desktop.craft.canvas.cv3.fact.when.onDemand"));
  }
  if (p.kind === "tool")
    when.push(fact("desktop.craft.canvas.cv3.fact.when.modelCalls", s.mcp?.server ?? p.name));
  if (p.kind === "drive") {
    if (ctx.start) when.push(fact("desktop.craft.canvas.cv3.fact.when.start"));
    for (const from of ctx.handoffFrom)
      when.push(fact("desktop.craft.canvas.cv3.fact.when.handoffIn", from));
    if (!ctx.start && ctx.handoffFrom.length === 0)
      when.push(fact("desktop.craft.canvas.cv3.fact.when.picked"));
  }
  for (const r of rows)
    when.push({ ...fact("desktop.craft.canvas.cv3.fact.when.event"), at: r.anchor });

  // 입력
  for (const k of unique(rows.map((r) => HOOKS[r.hook].kind))) reads.push(fact(READS_KIND[k]));
  for (const f of [...s.instructions, ...s.memory])
    reads.push(fact("desktop.craft.canvas.cv3.fact.reads.file", f));
  if (s.skills.length > 0)
    reads.push(fact("desktop.craft.canvas.cv3.fact.reads.skills", String(s.skills.length)));
  counted(reads, "desktop.craft.canvas.cv3.fact.reads.records", m.readsRecordKinds.length);
  counted(reads, "desktop.craft.canvas.cv3.fact.reads.needs", m.requires.length);
  counted(reads, "desktop.craft.canvas.cv3.fact.reads.optional", m.optional.length);
  for (const e of m.launch?.envNames ?? [])
    reads.push(fact("desktop.craft.canvas.cv3.fact.reads.env", e));

  // 영향
  if (p.kind === "inject" && m.cost.always !== null)
    changes.push(fact("desktop.craft.canvas.cv3.fact.changes.context"));
  if (p.kind === "drive") changes.push(fact("desktop.craft.canvas.cv3.fact.changes.holdsTurn"));
  const powers = unique(rows.flatMap((r) => r.powers));
  const acting = powers.filter((w) => w !== "observe");
  for (const w of acting.length > 0 ? acting : powers) changes.push(fact(POWER_WORD[w]));
  for (const tool of m.replaces)
    changes.push(fact("desktop.craft.canvas.cv3.fact.changes.replaces", tool, true));
  const tools = s.mcp?.tools ?? [];
  const writes = tools.filter((x) => x.writes).length;
  if (writes > 0)
    changes.push(
      fact(
        "desktop.craft.canvas.cv3.fact.changes.writeTools",
        `${String(writes)}/${String(tools.length)}`,
        true,
      ),
    );

  // 출력
  if (s.decision !== undefined) gives.push(fact(DECISION_FACT[s.decision]));
  if (tools.length > 0)
    gives.push(fact("desktop.craft.canvas.cv3.fact.gives.tools", String(tools.length)));
  for (const to of s.handoffTo ?? [])
    gives.push(fact("desktop.craft.canvas.cv3.fact.gives.handoff", to));
  counted(gives, "desktop.craft.canvas.cv3.fact.gives.capability", m.provides.length);
  counted(gives, "desktop.craft.canvas.cv3.fact.gives.record", m.recordKinds.length);

  return { when: merge(when), reads: merge(reads), changes: merge(changes), gives: merge(gives) };
}

/** 같은 자리의 Hook들이 합쳐지는 방식(중복 없이). 화면은 FOLD_WORD로 한 문장씩 보인다 */
export function foldsOf(p: Plugin): readonly Fold[] {
  return unique(hookRows(p).map((r) => r.fold));
}

/**
 * 같은 말(자리 말이 있으면 같은 자리)의 칩은 하나로 모은다.
 * 값이 없는 칩끼리는 수를 더하고, 값이 있는 칩끼리는 값을 쉼표로 잇는다. 자리 칩은 같은 자리면 하나만 남는다
 */
function merge(xs: readonly Fact[]): readonly Fact[] {
  const out: Fact[] = [];
  for (const f of xs) {
    const same = out.findIndex(
      (o) => o.word === f.word && o.at === f.at && (o.value === null) === (f.value === null),
    );
    const prev = out[same];
    if (prev === undefined) {
      out.push(f);
      continue;
    }
    if (f.at !== null) continue;
    out[same] =
      prev.value === null || f.value === null
        ? { ...prev, count: prev.count + f.count, warn: prev.warn || f.warn }
        : { ...prev, value: `${prev.value}, ${f.value}`, warn: prev.warn || f.warn };
  }
  return out;
}
