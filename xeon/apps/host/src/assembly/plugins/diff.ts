import type { CardScript, InjectInventory, PluginCard } from "@fresnel/contracts/extensions";
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

type McpServerCard = InjectInventory["mcpServers"][number];

/**
 * MCP 서버의 비교 값. stdio는 승인하면 실행될 명령 줄이라 명령, 인자, 환경 변수 이름, 작업 폴더 가운데 하나라도 바뀌면 바뀐 것이다.
 * 인자는 JSON 배열로 적어 공백이 든 인자와 여러 인자가 같은 글로 보이지 않게 한다. `launch`가 없는 옛 카드는 전송만 적는다.
 */
function mcpDetailOf(server: McpServerCard): string {
  const launch = server.launch ?? null;
  if (launch === null) return server.transport;
  const parts = [`stdio: ${launch.command}`];
  if (launch.args.length > 0) parts.push(JSON.stringify(launch.args));
  if (launch.envNames.length > 0) parts.push(`[env: ${launch.envNames.join(",")}]`);
  if (launch.cwd !== null) parts.push(`[cwd: ${launch.cwd}]`);
  return parts.join(" ");
}

/**
 * 스크립트의 비교 값. 실행기, 상대 파일과 인자(JSON 배열), 선언된 환경 변수 이름, 기한이 하나라도 바뀌면 바뀐 것이다.
 * 기한도 넣는 것은 명령이 같아도 오래 도는 쪽으로 바뀐 갱신을 조용히 넘기지 않으려는 것이다.
 * 선언했지만 넘기지 않은 환경 변수 이름(`envNotPassed`)도 한 줄로 싣는다(AGE-33 enDep 11). 넘기는 이름이 같아도 이 목록이 바뀌면 바뀐 것이다.
 */
function scriptDetailOf(script: CardScript): string {
  const { launch } = script;
  const parts = [`${launch.command} ${JSON.stringify(launch.args)}`];
  if (launch.envNames.length > 0) parts.push(`[env: ${launch.envNames.join(",")}]`);
  const notPassed = script.envNotPassed ?? [];
  if (notPassed.length > 0) parts.push(`[not passed: ${notPassed.join(",")}]`);
  parts.push(`[timeout: ${script.timeoutMs}ms]`);
  return parts.join(" ");
}

/** 카드를 사실의 지도로 펼친다. 키는 칸과 이름이다. `withDependencies`가 거짓이면 의존 칸은 펼치지 않는다(옛 카드와 비교하지 않는다) */
function factsOf(card: PluginCard | null, withDependencies: boolean): Map<string, Fact> {
  const facts = new Map<string, Fact>();
  if (card === null) return facts;
  const add = (row: DiffRow, what: string, detail: string): void => {
    facts.set(`${row}|${what}`, { row, what, detail });
  };
  // 기대는 줄(`dependsOn`)만 본다. 이 플러그인에 기대는 쪽은 다른 플러그인의 선언이라 이 검토의 변화가 아니다
  if (withDependencies && card.dependencies !== undefined) {
    for (const line of card.dependencies.dependsOn) {
      add(
        "dependencies",
        `dependsOn:${line.from}->${line.target}`,
        `${line.kind}, range ${line.range ?? "any"}`,
      );
    }
  }
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
      add("inject", `mcp:${server.name}`, mcpDetailOf(server));
    }
    // 옛 카드에는 `scripts` 칸이 없다
    for (const script of inject.scripts ?? []) {
      add("inject", `script:${script.name}`, scriptDetailOf(script));
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
  // 의존 칸은 두 쪽 모두 있을 때만 비교한다. 옛 카드(`dependencies` 없음)와 견주면 없던 줄이 늘어난 것처럼 보인다
  const withDependencies =
    (prev === null || prev.dependencies !== undefined) &&
    (next === null || next.dependencies !== undefined);
  const before = factsOf(prev, withDependencies);
  const after = factsOf(next, withDependencies);
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
