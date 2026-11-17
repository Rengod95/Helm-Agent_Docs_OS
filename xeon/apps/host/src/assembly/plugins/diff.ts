import type { PluginCard } from "@fresnel/contracts/extensions";
import type { DiffEntry, DiffRow, WhatItDoesDiff } from "@fresnel/contracts/wire";

// "하는 일의 차이"(M5c §3.1 `WhatItDoesDiff`, §4.7.2). 이전 검토본의 카드와 후보 카드를 칸마다 같은 사실의 목록으로 펼쳐 비교한다.
// 순수 함수다: 파일을 읽지 않고 카드의 값만 본다. 같은 사실(칸, 이름)이 양쪽에 있고 내용이 다르면 changed다.
// `prev`가 null이면 새 플러그인이라 모든 사실이 added다. `next`가 null이면 제거라 모든 사실이 removed다.

/** 목록 상한(wire 스키마의 maxItems)과 글자 상한(what 256, detail 1024). 넘으면 잘라 준다 */
const MAX_ENTRIES = 512;
const MAX_WHAT = 256;
const MAX_DETAIL = 1024;

interface Fact {
  readonly row: DiffRow;
  readonly what: string;
  readonly detail: string;
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit);
}

/** 카드를 사실의 지도로 펼친다. 키는 칸과 이름이다 */
function factsOf(card: PluginCard | null): Map<string, Fact> {
  const facts = new Map<string, Fact>();
  if (card === null) return facts;
  const add = (row: DiffRow, what: string, detail: string): void => {
    facts.set(`${row}|${what}`, { row, what, detail });
  };
  const inject = card.does.inject;
  if (inject !== null) {
    for (const item of inject.instructions.always) {
      add("inject", `instruction:${item.path}`, `${item.bytes} bytes`);
    }
    for (const skill of inject.instructions.skills) {
      add("inject", `skill:${skill.name}`, skill.path);
    }
    for (const tool of inject.tools) {
      add("inject", `tool:${tool.name}`, tool.description ?? "");
    }
    for (const server of inject.mcpServers) {
      add("inject", `mcp:${server.name}`, server.transport);
    }
    for (const agent of inject.agents) add("inject", `agent:${agent}`, "");
    for (const command of inject.commands) add("inject", `command:${command}`, "");
    for (const provider of inject.providers) add("inject", `provider:${provider}`, "");
    for (const ui of inject.ui) add("inject", `ui:${ui.id}`, ui.placement);
    for (const name of inject.replaces) add("replaces", `replaces:${name}`, "");
  }
  const hook = card.does.hook;
  if (hook !== null) {
    for (const item of hook.hooks) {
      add("hook", `hook:${item.name}`, `${item.fold}, ${item.position}, ${item.powers.join("/")}`);
    }
  }
  const drive = card.does.drive;
  if (drive !== null) {
    add("drive", "drive:start", `start=${String(drive.start)}`);
    for (const command of drive.commands) add("drive", `drive:command:${command}`, "");
  }
  add("runs", "runs:code", `code=${String(card.runs.code)}`);
  add("runs", "runs:isolated", `isolated=${String(card.runs.isolated)}`);
  return facts;
}

function toEntry(fact: Fact, detail: string): DiffEntry {
  return {
    row: fact.row,
    what: clip(fact.what, MAX_WHAT),
    detail: clip(detail, MAX_DETAIL),
  };
}

/** 두 값의 차. 한쪽이라도 비어 있으면 모른다(null)다 */
function delta(prev: number | null, next: number | null): number | null {
  if (prev === null || next === null) return null;
  return next - prev;
}

function costDeltaOf(
  prev: PluginCard | null,
  next: PluginCard | null,
): WhatItDoesDiff["costDelta"] {
  if (next === null) {
    if (prev === null) return { always: null, onDemand: null };
    return {
      always: prev.cost.always === null ? null : -prev.cost.always,
      onDemand: prev.cost.onDemand === null ? null : -prev.cost.onDemand,
    };
  }
  if (prev === null) return { always: next.cost.always, onDemand: next.cost.onDemand };
  return {
    always: delta(prev.cost.always, next.cost.always),
    onDemand: delta(prev.cost.onDemand, next.cost.onDemand),
  };
}

/**
 * 이전 검토본 카드와 다음 카드의 "하는 일의 차이". `prev`가 null이면 새 플러그인, `next`가 null이면 제거다.
 * 강제력 변화는 두 카드가 모두 있을 때만 적는다. 비용 변화는 `CostFigures`의 항상·필요할 때 값의 차다.
 */
export function diffCards(prev: PluginCard | null, next: PluginCard | null): WhatItDoesDiff {
  const before = factsOf(prev);
  const after = factsOf(next);
  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const changed: DiffEntry[] = [];
  for (const [key, fact] of after) {
    const old = before.get(key);
    if (old === undefined) {
      added.push(toEntry(fact, fact.detail));
    } else if (old.detail !== fact.detail) {
      changed.push(toEntry(fact, `${old.detail} → ${fact.detail}`));
    }
  }
  for (const [key, fact] of before) {
    if (!after.has(key)) removed.push(toEntry(fact, fact.detail));
  }
  const enforcementChange =
    prev !== null && next !== null && prev.enforcement !== next.enforcement
      ? { from: prev.enforcement, to: next.enforcement }
      : null;
  return {
    added: added.slice(0, MAX_ENTRIES),
    removed: removed.slice(0, MAX_ENTRIES),
    changed: changed.slice(0, MAX_ENTRIES),
    enforcementChange,
    costDelta: costDeltaOf(prev, next),
  };
}
