// cvH 플러그인 내부의 배치(순수). 캔버스와 같은 선로 문법을 한 단계 안에서 다시 쓴다:
//   Drive: 맨 위에 코어 루프 한 토막, 입력 받기에서 내려오는 자기 순환선. 단계가 정거장이고 나란한 단계는 겹선(갈래가 벌어졌다 모인다),
//          마지막 단계에서 첫 단계로 되돌이 선, 오른쪽 끝에서 핸드오프(다른 Drive의 종착역)와 반납(코어 루프로) 두 출구.
//   Inject: 넣는 것마다 정거장이 선 지선. 항상 싣는 지침은 실선, 필요할 때 읽는 스킬은 점선이고 둘 다 컨텍스트 조립에 합류한다.
//   Hook: 본선 한 토막을 가로지르는 건널목과 그 아래 처리기, 처리기가 낼 수 있는 결정마다 출구(통과·막기·대체·묻기).
//   도구: 도구 실행에서 갈라진 측선 위 MCP 서버 역과 도구 정거장들(쓰기 도구는 채운 표).
import type { SharedPlugin } from "../shared-sample.ts";
import { orthoPath, slotOf, type Kind, type Rect, type SlotId } from "./model.ts";

export interface InsideLine {
  readonly key: string;
  readonly d: string;
  readonly role:
    | "core"
    | "own"
    | "lane"
    | "return"
    | "exit"
    | "handoff"
    | "branch"
    | "onDemand"
    | "muted";
  readonly kind: Kind | null;
}

type StopRole = "core" | "step" | "lane" | "server" | "crossing";

export interface InsideStop {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly role: StopRole;
  /** 단계 id, 갈래 이름, 정거장 자리 등 화면이 글로 옮길 값 */
  readonly ref: string;
  readonly order: number | null;
}

type InsideCardType =
  | "instruction"
  | "skill"
  | "memory"
  | "tool"
  | "handler"
  | "outcome"
  | "terminus"
  | "settings"
  | "risk"
  | "launch";

export interface InsideCard {
  readonly key: string;
  readonly type: InsideCardType;
  readonly rect: Rect;
  /** 카드가 보일 값(파일 이름, 도구 이름, 결정 등) */
  readonly ref: string;
  /** 이 플러그인이 실제로 하는가(결정 출구는 낼 수 있는 것만 켠다) */
  readonly active: boolean;
  readonly writes?: boolean;
}

export interface InsideChip {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly mono: boolean;
}

export interface InsideScene {
  readonly lines: readonly InsideLine[];
  readonly stops: readonly InsideStop[];
  readonly cards: readonly InsideCard[];
  readonly chips: readonly InsideChip[];
  readonly bounds: Rect;
}

const STEP_GAP = 230;
const LANE_GAP = 74;
const FOOT_W = 300;

function bounds(
  cards: readonly InsideCard[],
  stops: readonly InsideStop[],
  extra: readonly { x: number; y: number }[],
): Rect {
  const xs = [
    ...cards.flatMap((c) => [c.rect.x, c.rect.x + c.rect.w]),
    ...stops.map((s) => s.x),
    ...extra.map((e) => e.x),
  ];
  const ys = [
    ...cards.flatMap((c) => [c.rect.y, c.rect.y + c.rect.h]),
    ...stops.map((s) => s.y),
    ...extra.map((e) => e.y),
  ];
  const x = Math.min(...xs) - 60;
  const y = Math.min(...ys) - 60;
  return { x, y, w: Math.max(...xs) + 60 - x, h: Math.max(...ys) + 60 - y };
}

/** 설정·위험 카드를 아래 줄에 나란히 */
function footCards(p: SharedPlugin, top: number, left: number): InsideCard[] {
  const out: InsideCard[] = [];
  let x = left;
  if (p.settings.length > 0) {
    out.push({
      key: "settings",
      type: "settings",
      rect: { x, y: top, w: FOOT_W, h: 44 + p.settings.length * 24 },
      ref: "",
      active: true,
    });
    x += FOOT_W + 24;
  }
  out.push({
    key: "risk",
    type: "risk",
    rect: { x, y: top, w: FOOT_W, h: 116 },
    ref: p.risk,
    active: true,
  });
  return out;
}

function driveScene(p: SharedPlugin): InsideScene {
  const steps = p.steps ?? [];
  const lines: InsideLine[] = [];
  const stops: InsideStop[] = [];
  const cards: InsideCard[] = [];
  const chips: InsideChip[] = [];
  const coreY = -250;
  // 단계 x: 나란한 단계는 앞뒤로 갈림·모음 자리를 더 둔다
  let x = 160;
  const xs: number[] = [];
  for (const s of steps) {
    if (s.parallel > 1) x += 60;
    xs.push(x);
    x += STEP_GAP + (s.parallel > 1 ? 60 : 0);
  }
  const first = xs[0] ?? 160;
  const last = xs[xs.length - 1] ?? first;
  const endX = last + 170;
  // 코어 루프 토막: 입력 받기에서 자기 순환선이 내려오고, 반납은 오른쪽에서 다시 올라간다
  lines.push({
    key: "core",
    d: `M-80 ${String(coreY)} L${String(endX + 200)} ${String(coreY)}`,
    role: "core",
    kind: null,
  });
  stops.push({
    key: "core:input",
    x: 0,
    y: coreY,
    role: "core",
    ref: "input-received",
    order: null,
  });
  stops.push({
    key: "core:end",
    x: endX + 60,
    y: coreY,
    role: "core",
    ref: "before-turn-end",
    order: null,
  });
  lines.push({
    key: "descend",
    d: `M0 ${String(coreY)} L0 ${String(coreY + 40)} A12 12 0 1 1 0.1 ${String(coreY + 40)} L0 -28 Q0 0 28 0 L${String(first)} 0`,
    role: "own",
    kind: "drive",
  });
  // 본 순환선과 단계
  steps.forEach((s, i) => {
    const sx = xs[i] ?? 0;
    const prev = steps[i - 1];
    const prevX = (xs[i - 1] ?? 0) + (prev !== undefined && prev.parallel > 1 ? 110 : 0);
    const inX = sx - (s.parallel > 1 ? 110 : 0);
    if (i > 0)
      lines.push({
        key: `seg:${String(i)}`,
        d: `M${String(prevX)} 0 L${String(inX)} 0`,
        role: "own",
        kind: "drive",
      });
    if (s.parallel > 1) {
      const n = s.parallel;
      const fork = sx - 110;
      const join = sx + 110;
      for (let k = 0; k < n; k++) {
        const y = (k - (n - 1) / 2) * LANE_GAP;
        lines.push({
          key: `lane:${String(i)}:${String(k)}`,
          d: `M${String(fork)} 0 C${String(fork + 50)} 0 ${String(fork + 40)} ${String(y)} ${String(fork + 90)} ${String(y)} L${String(join - 90)} ${String(y)} C${String(join - 40)} ${String(y)} ${String(join - 50)} 0 ${String(join)} 0`,
          role: "lane",
          kind: "drive",
        });
        stops.push({
          key: `lane:${String(i)}:${String(k)}`,
          x: sx,
          y,
          role: "lane",
          ref: s.lanes?.[k] ?? String(k + 1),
          order: k + 1,
        });
      }
      stops.push({
        key: `step:${s.id}`,
        x: sx,
        y: -((n - 1) / 2) * LANE_GAP - 56,
        role: "step",
        ref: s.id,
        order: i + 1,
      });
      chips.push({ key: `fork:${String(i)}`, x: fork, y: 26, text: `×${String(n)}`, mono: true });
      const lanesSetting = p.settings.find((x2) => x2.key === "explorers");
      if (lanesSetting !== undefined && s.id === "explore")
        chips.push({
          key: "lanes-setting",
          x: sx,
          y: ((n - 1) / 2) * LANE_GAP + 40,
          text: `${lanesSetting.key} ${lanesSetting.value}`,
          mono: true,
        });
    } else {
      stops.push({ key: `step:${s.id}`, x: sx, y: 0, role: "step", ref: s.id, order: i + 1 });
    }
  });
  // 되돌이: 마지막 단계에서 첫 단계로, 아래로 크게 돈다
  const maxLane = Math.max(1, ...steps.map((s) => s.parallel));
  const loopY = ((maxLane - 1) / 2) * LANE_GAP + 110;
  lines.push({
    key: "return",
    d: orthoPath(
      [
        { x: last, y: 0 },
        { x: last + 60, y: 0 },
        { x: last + 60, y: loopY },
        { x: first - 60, y: loopY },
        { x: first - 60, y: 0 },
        { x: first, y: 0 },
      ],
      26,
    ),
    role: "return",
    kind: "drive",
  });
  const rounds = p.settings.find((s) => s.key === "maxRounds" || s.key === "retries");
  chips.push({
    key: "return",
    x: (first + last) / 2,
    y: loopY,
    text: rounds === undefined ? "" : `${rounds.key} ${rounds.value}`,
    mono: true,
  });
  // 출구: 반납(코어 루프로 올라감), 핸드오프(다른 Drive 종착역)
  lines.push({
    key: "done",
    d: orthoPath(
      [
        { x: last, y: 0 },
        { x: endX, y: 0 },
        { x: endX, y: coreY + 60 },
        { x: endX + 60, y: coreY },
      ],
      30,
    ),
    role: "exit",
    kind: "drive",
  });
  chips.push({ key: "done", x: endX, y: coreY / 2, text: "done", mono: true });
  (p.handoffTo ?? []).forEach((to, i) => {
    const ty = 90 + i * 120;
    lines.push({
      key: `handoff:${to}`,
      d: `M${String(endX)} 0 C${String(endX + 60)} 0 ${String(endX + 60)} ${String(ty + 34)} ${String(endX + 130)} ${String(ty + 34)}`,
      role: "handoff",
      kind: "drive",
    });
    cards.push({
      key: `terminus:${to}`,
      type: "terminus",
      rect: { x: endX + 130, y: ty, w: 220, h: 68 },
      ref: to,
      active: true,
    });
  });
  // 위: 지침(이 Drive가 싣는 것) — 첫 단계 바로 위에서 내려와 닿는다(나란한 단계의 표와 겹치지 않게 첫 단계 쪽에 둔다)
  p.instructions.forEach((file, i) => {
    const cx = first - 105 - i * 230;
    const lx = cx + 105;
    cards.push({
      key: `ins:${file}`,
      type: "instruction",
      rect: { x: cx, y: coreY + 50, w: 210, h: 60 },
      ref: file,
      active: true,
    });
    lines.push({
      key: `ins:${file}`,
      d: `M${String(lx)} ${String(coreY + 110)} L${String(lx)} -20`,
      role: "branch",
      kind: "inject",
    });
  });
  cards.push(...footCards(p, loopY + 70, first - 60));
  return {
    lines,
    stops,
    cards,
    chips,
    bounds: bounds(cards, stops, [
      { x: -80, y: coreY - 40 },
      { x: endX + 220, y: loopY + 40 },
    ]),
  };
}

function injectScene(p: SharedPlugin): InsideScene {
  const lines: InsideLine[] = [];
  const stops: InsideStop[] = [];
  const cards: InsideCard[] = [];
  const all: readonly {
    readonly type: "instruction" | "skill" | "memory";
    readonly items: readonly string[];
  }[] = [
    { type: "instruction", items: p.instructions },
    { type: "memory", items: p.memory },
    { type: "skill", items: p.skills },
  ];
  const rows = all.filter((r) => r.items.length > 0);
  const W = 196;
  const per = 4;
  const longest = Math.max(1, ...rows.map((r) => Math.min(per, r.items.length)));
  const mergeX = 80 + longest * (W + 30) + 120;
  const coreY = -170;
  lines.push({
    key: "core",
    d: `M-60 ${String(coreY)} L${String(mergeX + 360)} ${String(coreY)}`,
    role: "core",
    kind: null,
  });
  stops.push({
    key: "core:context",
    x: mergeX + 120,
    y: coreY,
    role: "core",
    ref: "context",
    order: null,
  });
  stops.push({
    key: "core:model",
    x: mergeX + 300,
    y: coreY,
    role: "core",
    ref: "model",
    order: null,
  });
  let y = 0;
  rows.forEach((row, ri) => {
    const lineY = y;
    const rowsNeeded = Math.ceil(row.items.length / per);
    row.items.forEach((item, i) => {
      const r = Math.floor(i / per);
      const c = i % per;
      cards.push({
        key: `${row.type}:${item}`,
        type: row.type,
        rect: { x: 80 + c * (W + 30), y: lineY + 22 + r * 86, w: W, h: 62 },
        ref: item,
        active: true,
      });
    });
    const role = row.type === "skill" ? "onDemand" : "own";
    const mx = mergeX + 120 - 56 - ri * 18;
    lines.push({
      key: `line:${row.type}`,
      d: `M40 ${String(lineY)} L${String(mx - 30)} ${String(lineY)} C${String(mx)} ${String(lineY)} ${String(mx)} ${String(lineY - 10)} ${String(mx)} ${String(lineY - 40)} L${String(mx)} ${String(coreY + 40)} C${String(mx)} ${String(coreY + 14)} ${String(mx + 16)} ${String(coreY)} ${String(mx + 44)} ${String(coreY)}`,
      role,
      kind: "inject",
    });
    for (let r = 0; r < rowsNeeded; r++) {
      const count = Math.min(per, row.items.length - r * per);
      for (let c = 0; c < count; c++) {
        const sx = 80 + c * (W + 30) + 24;
        lines.push({
          key: `tick:${row.type}:${String(r)}:${String(c)}`,
          d: `M${String(sx)} ${String(lineY)} L${String(sx)} ${String(lineY + 22 + r * 86)}`,
          role: "branch",
          kind: "inject",
        });
      }
    }
    y += 22 + rowsNeeded * 86 + 40;
  });
  cards.push(...footCards(p, y + 20, 80));
  return {
    lines,
    stops,
    cards,
    chips: [],
    bounds: bounds(cards, stops, [
      { x: -60, y: coreY - 40 },
      { x: mergeX + 380, y: 0 },
    ]),
  };
}

const BEFORE_AFTER: Readonly<Record<string, readonly [SlotId, SlotId]>> = {
  "model.before": ["context", "model"],
  "tools.before": ["model", "tools"],
  "tools.after": ["tools", "ask"],
  "before-turn-end": ["record", "input-received"],
};

function hookScene(p: SharedPlugin): InsideScene {
  const lines: InsideLine[] = [];
  const stops: InsideStop[] = [];
  const cards: InsideCard[] = [];
  const chips: InsideChip[] = [];
  const point = slotOf(p);
  const [a, b] = BEFORE_AFTER[point] ?? ["model", "tools"];
  const cx = 420;
  lines.push({ key: "core", d: `M-40 0 L${String(cx * 2 + 160)} 0`, role: "core", kind: null });
  stops.push({ key: "core:a", x: 120, y: 0, role: "core", ref: a, order: null });
  stops.push({ key: "core:b", x: cx * 2 - 20, y: 0, role: "core", ref: b, order: null });
  stops.push({ key: "crossing", x: cx, y: 0, role: "crossing", ref: point, order: null });
  lines.push({
    key: "cross",
    d: `M${String(cx)} -40 L${String(cx)} 120`,
    role: "own",
    kind: "hook",
  });
  cards.push({
    key: "handler",
    type: "handler",
    rect: { x: cx - 160, y: 120, w: 320, h: 92 },
    ref: p.name,
    active: true,
  });
  // 결정 출구: 막기(차막이), 대체(우회선), 묻기(사람에게 묻기로 가지)
  const can = (d: "block" | "replace" | "ask"): boolean => p.decision === d;
  const outs: readonly { readonly d: "block" | "replace" | "ask"; readonly x: number }[] = [
    { d: "block", x: cx - 300 },
    { d: "replace", x: cx },
    { d: "ask", x: cx + 300 },
  ];
  for (const o of outs) {
    cards.push({
      key: `out:${o.d}`,
      type: "outcome",
      rect: { x: o.x - 120, y: 300, w: 240, h: 74 },
      ref: o.d,
      active: can(o.d),
    });
    lines.push({
      key: `out:${o.d}`,
      d: orthoPath(
        [
          { x: cx, y: 212 },
          { x: cx, y: 250 },
          { x: o.x, y: 250 },
          { x: o.x, y: 300 },
        ],
        16,
      ),
      role: can(o.d) ? "own" : "muted",
      kind: "hook",
    });
  }
  chips.push({ key: "pass", x: cx + 140, y: -18, text: "pass", mono: true });
  cards.push(...footCards(p, 420, cx - 300));
  return {
    lines,
    stops,
    cards,
    chips,
    bounds: bounds(cards, stops, [
      { x: -40, y: -80 },
      { x: cx * 2 + 160, y: 0 },
    ]),
  };
}

function toolScene(p: SharedPlugin, launch: boolean): InsideScene {
  const lines: InsideLine[] = [];
  const stops: InsideStop[] = [];
  const cards: InsideCard[] = [];
  const tools = p.mcp?.tools ?? [];
  const per = 6;
  const W = 168;
  const coreY = 0;
  lines.push({
    key: "core",
    d: `M-40 ${String(coreY)} L${String(per * (W + 22) + 260)} ${String(coreY)}`,
    role: "core",
    kind: null,
  });
  stops.push({ key: "core:tools", x: 80, y: coreY, role: "core", ref: "tools", order: null });
  stops.push({
    key: "core:ask",
    x: per * (W + 22) + 160,
    y: coreY,
    role: "core",
    ref: "ask",
    order: null,
  });
  const serverY = -150;
  lines.push({
    key: "siding",
    d: `M160 0 C200 0 220 -14 220 -40 L220 ${String(serverY + 30)} C220 ${String(serverY)} 240 ${String(serverY)} 270 ${String(serverY)} L${String(per * (W + 22) + 120)} ${String(serverY)}`,
    role: "own",
    kind: "tool",
  });
  stops.push({
    key: "server",
    x: 300,
    y: serverY,
    role: "server",
    ref: p.mcp?.server ?? p.name,
    order: null,
  });
  tools.forEach((tool, i) => {
    const r = Math.floor(i / per);
    const c = i % per;
    const x = 120 + c * (W + 22);
    const y = serverY - 90 - r * 70;
    cards.push({
      key: `tool:${tool.name}`,
      type: "tool",
      rect: { x, y, w: W, h: 48 },
      ref: tool.name,
      active: true,
      writes: tool.writes,
    });
    if (r === 0)
      lines.push({
        key: `tick:${String(c)}`,
        d: `M${String(x + 20)} ${String(serverY)} L${String(x + 20)} ${String(y + 48)}`,
        role: "branch",
        kind: "tool",
      });
  });
  const rowsUp = Math.ceil(tools.length / per);
  for (let r = 1; r < rowsUp; r++) {
    const yTop = serverY - 90 - r * 70 + 48;
    lines.push({
      key: `col:${String(r)}`,
      d: `M${String(120 + 20 - 14)} ${String(serverY)} L${String(120 + 20 - 14)} ${String(yTop - 24)}`,
      role: "branch",
      kind: "tool",
    });
  }
  // 차막이: 측선 끝
  lines.push({
    key: "buffer",
    d: `M${String(per * (W + 22) + 120)} ${String(serverY - 10)} L${String(per * (W + 22) + 120)} ${String(serverY + 10)}`,
    role: "own",
    kind: "tool",
  });
  let footX = 80;
  if (launch) {
    cards.push({
      key: "launch",
      type: "launch",
      rect: { x: footX, y: 60, w: 420, h: 96 },
      ref: "",
      active: true,
    });
    footX += 444;
  }
  cards.push(...footCards(p, 60, footX));
  return {
    lines,
    stops,
    cards,
    chips: [],
    bounds: bounds(cards, stops, [
      { x: -40, y: 0 },
      { x: per * (W + 22) + 260, y: 0 },
    ]),
  };
}

export function insideScene(p: SharedPlugin, opts: { readonly launch: boolean }): InsideScene {
  if (p.kind === "drive") return driveScene(p);
  if (p.kind === "inject") return injectScene(p);
  if (p.kind === "hook") return hookScene(p);
  return toolScene(p, opts.launch);
}
