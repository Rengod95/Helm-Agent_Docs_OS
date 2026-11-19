// cv3 상세 패널 "설명과 동작"의 네 줄(언제 끼어드나, 무엇을 읽나, 무엇을 바꾸나, 무엇을 내나)과 "작동"의 Hook 줄을 만드는 순수 함수.
// 값은 계약과 표본에서만 온다: 매니페스트 `hooks`(Hook 이름) → 계약의 `HOOKS`(kind·fold)와 `HOOK_POSITIONS`(자리·powers),
// `requires`·`optional`·`readsRecordKinds`·`replaces`·`provides`·`recordKinds`, 카드의 `cost`, MCP `launch.envNames`, 표본의 구성 요소.
// 지어낸 값은 없다. 화면 글은 message id로만 돌려준다(값 칩은 계약의 이름 그대로).
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
  /** 계약의 이름 그대로 보이는 값(칩). 없으면 null */
  readonly value: string | null;
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

export interface HookRow {
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
function anchorOfPosition(p: HookPosition): Anchor | null {
  if (p.kind === "block") return `${p.side}:${p.block}`;
  if (p.kind === "boundary") return `boundary:${p.boundary}`;
  if (p.kind === "event" && p.anchor !== undefined && p.anchor.block !== "record")
    return `${p.anchor.side}:${p.anchor.block}`;
  return null;
}

/** 매니페스트 `hooks`마다 자리·합치는 방식·할 수 있는 일(계약 값) */
export function hookRows(p: Plugin): readonly HookRow[] {
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

function unique<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

/**
 * 네 줄의 값. `start`는 이 프로필의 스타트 Drive인가, `handoffFrom`은 이 Drive로 넘겨주는 Drive들이다.
 * Hook 이름은 언제 줄에 자리 말과 함께, 읽나 줄에는 Hook 종류(kind)의 말로, 바꾸나 줄에는 powers의 말로 선다
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

  // 언제
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
    when.push({ ...fact("desktop.craft.canvas.cv3.fact.when.event", r.hook), at: r.anchor });

  // 읽나
  for (const k of unique(rows.map((r) => HOOKS[r.hook].kind))) reads.push(fact(READS_KIND[k]));
  for (const f of [...s.instructions, ...s.memory])
    reads.push(fact("desktop.craft.canvas.cv3.fact.reads.file", f));
  if (s.skills.length > 0)
    reads.push(fact("desktop.craft.canvas.cv3.fact.reads.skills", String(s.skills.length)));
  for (const r of m.readsRecordKinds)
    reads.push(fact("desktop.craft.canvas.cv3.fact.reads.records", r));
  for (const n of m.requires) reads.push(fact("desktop.craft.canvas.cv3.fact.reads.needs", n.id));
  for (const n of m.optional)
    reads.push(fact("desktop.craft.canvas.cv3.fact.reads.optional", n.id));
  for (const e of m.launch?.envNames ?? [])
    reads.push(fact("desktop.craft.canvas.cv3.fact.reads.env", e));

  // 바꾸나
  if (p.kind === "inject" && m.cost.always !== null)
    changes.push(fact("desktop.craft.canvas.cv3.fact.changes.context"));
  if (p.kind === "drive") changes.push(fact("desktop.craft.canvas.cv3.fact.changes.holdsTurn"));
  const powers = unique(rows.flatMap((r) => r.powers));
  const acting = powers.filter((w) => w !== "observe");
  for (const w of acting.length > 0 ? acting : powers) {
    const hooks = rows.filter((r) => r.powers.includes(w)).map((r) => r.hook);
    changes.push(fact(POWER_WORD[w], hooks.join(", ")));
  }
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

  // 내나
  if (s.decision !== undefined) gives.push(fact(DECISION_FACT[s.decision]));
  if (tools.length > 0)
    gives.push(fact("desktop.craft.canvas.cv3.fact.gives.tools", String(tools.length)));
  for (const to of s.handoffTo ?? [])
    gives.push(fact("desktop.craft.canvas.cv3.fact.gives.handoff", to));
  for (const c of m.provides)
    gives.push(fact("desktop.craft.canvas.cv3.fact.gives.capability", c.id));
  for (const r of m.recordKinds) gives.push(fact("desktop.craft.canvas.cv3.fact.gives.record", r));

  return { when, reads: merge(reads), changes, gives: merge(gives) };
}

/** 같은 말의 칩은 하나로 모은다(값은 쉼표로). 자리 말이 있는 칩은 그대로 둔다 */
function merge(xs: readonly Fact[]): readonly Fact[] {
  const out: Fact[] = [];
  for (const f of xs) {
    const same = out.findIndex((o) => o.word === f.word && o.at === null && f.at === null);
    const prev = out[same];
    if (prev === undefined || prev.value === null || f.value === null) {
      out.push(f);
      continue;
    }
    out[same] = { ...prev, value: `${prev.value}, ${f.value}`, warn: prev.warn || f.warn };
  }
  return out;
}
