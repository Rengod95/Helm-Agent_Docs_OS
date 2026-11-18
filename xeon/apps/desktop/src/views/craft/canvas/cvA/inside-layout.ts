// cvA 플러그인 내부의 배치. 프로필 캔버스와 같은 문법을 한 단계 안으로 가져온다:
// 가운데 가로줄은 이 플러그인이 "하는 일"(Drive는 자기 단계의 줄, Hook은 붙는 곳과 핸들러, Inject·도구는 들어가는 곳),
// 위는 재료(지침·스킬·도구·MCP 서버·메모리), 아래는 설정과 권한 판이다. 좌표는 흐름 좌표, 가로줄이 y=0이다.
import { TAG_H, TAG_W } from "./layout.ts";
import {
  stationOfPort,
  type Decision,
  type Grant,
  type Part,
  type PluginSpec,
  type Port,
  type Setting,
  type StationId,
  type Step,
} from "./model.ts";

const PART_W = 164;
const PART_H = 40;
const STEP_W = 128;
const STEP_H = 46;
export const HANDLER_W = 248;
export const HANDLER_H = 100;
const GHOST_W = 152;
const GHOST_H = 46;
const READ_W = 248;
const ROW = 26;
const READ_HEAD = 36;

type InsideItem =
  | { readonly type: "part"; readonly part: Part }
  | { readonly type: "step"; readonly step: Step; readonly lane: number }
  | {
      readonly type: "handler";
      readonly port: Port;
      readonly decision: Decision;
      readonly guard: boolean;
    }
  | { readonly type: "ghost"; readonly name: string; readonly role: "handoffTo" | "handoffFrom" }
  | { readonly type: "settings"; readonly rows: readonly Setting[] }
  | { readonly type: "grants"; readonly rows: readonly Grant[]; readonly code: boolean };

export interface InsideNode {
  readonly id: string;
  readonly item: InsideItem;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

type InsideLinkType = "flow" | "attach" | "handoff" | "feed";

interface InsideLink {
  readonly id: string;
  readonly type: InsideLinkType;
  readonly d: string;
}

/** 가로줄 위의 표지: 코어 자리의 메아리(이름표), 경계, 핸드오프 나감·들어옴, 끝 */
interface InsideMark {
  readonly kind: "station" | "boundary" | "port" | "exit" | "entry" | "end";
  readonly x: number;
  readonly y: number;
  readonly station?: StationId;
  readonly port?: Port;
}

export interface InsideLayout {
  readonly nodes: readonly InsideNode[];
  readonly links: readonly InsideLink[];
  readonly marks: readonly InsideMark[];
  /** 가로줄(없으면 null) */
  readonly line: { readonly x1: number; readonly x2: number } | null;
  /** 재료 묶음 위의 꺾쇠(Drive 지침이 단계 전체에 걸린다) */
  /** 재료 묶음을 받치는 꺾쇠(`tick`은 끝 눈금의 방향과 길이: 양수는 아래, 음수는 위) */
  readonly spans: readonly Span[];
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
}

const r = (n: number): string => String(Math.round(n * 10) / 10);

function readoutHeight(rows: number, extra: number): number {
  return READ_HEAD + Math.max(1, rows) * ROW + extra + 8;
}

/** 아래 판 둘(설정, 권한). 가운데를 기준으로 나란히 */
function readouts(spec: PluginSpec, top: number, cx: number): InsideNode[] {
  const out: InsideNode[] = [];
  const { settings, grants, code } = spec.inside;
  const both = settings.length > 0 && (grants.length > 0 || code);
  const gap = 24;
  if (settings.length > 0) {
    out.push({
      id: "settings",
      item: { type: "settings", rows: settings },
      x: both ? cx - READ_W - gap / 2 : cx - READ_W / 2,
      y: top,
      w: READ_W,
      h: readoutHeight(settings.length, 0),
    });
  }
  if (grants.length > 0 || code) {
    out.push({
      id: "grants",
      item: { type: "grants", rows: grants, code },
      x: both ? cx + gap / 2 : cx - READ_W / 2,
      y: top,
      w: READ_W,
      h: readoutHeight(grants.length, code ? 50 : 0),
    });
  }
  return out;
}

function bounds(
  nodes: readonly InsideNode[],
  extraX: readonly number[],
  extraY: readonly number[],
): InsideLayout["bounds"] {
  const xs = [...extraX, ...nodes.map((n) => n.x), ...nodes.map((n) => n.x + n.w)];
  const ys = [...extraY, ...nodes.map((n) => n.y), ...nodes.map((n) => n.y + n.h)];
  const x = Math.min(...xs) - 40;
  const y = Math.min(...ys) - 60;
  return { x, y, w: Math.max(...xs) + 40 - x, h: Math.max(...ys) + 40 - y };
}

/** 재료 격자: 가운데 cx, 맨 아래 줄의 바닥이 bottom */
function partGrid(parts: readonly Part[], cols: number, cx: number, bottom: number): InsideNode[] {
  const rows = Math.ceil(parts.length / cols);
  const gx = PART_W + 18;
  const gy = PART_H + 14;
  return parts.map((part, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const inRow = Math.min(cols, parts.length - row * cols);
    const x0 = cx - ((inRow - 1) * gx) / 2;
    return {
      id: `part:${part.id}`,
      item: { type: "part", part },
      x: x0 + col * gx - PART_W / 2,
      y: bottom - PART_H - (rows - 1 - row) * gy,
      w: PART_W,
      h: PART_H,
    };
  });
}

interface Span {
  readonly x1: number;
  readonly x2: number;
  readonly y: number;
  readonly tick: number;
}

/** 격자 전체를 감싸는 꺾쇠 자리: 칸마다 선을 내리면 위 칸의 선이 아래 칸을 뚫으므로 묶음을 한 번에 받친다 */
function spanOf(grid: readonly InsideNode[], y: number, tick: number): Span {
  return {
    x1: Math.min(...grid.map((n) => n.x)) - 10,
    x2: Math.max(...grid.map((n) => n.x + n.w)) + 10,
    y,
    tick,
  };
}

/** 재료들 → 버스 → 한 점으로 내려가는 선 */
function busTo(
  nodes: readonly InsideNode[],
  to: { x: number; y: number },
  busY: number,
  id: string,
): InsideLink[] {
  const links: InsideLink[] = nodes.map((n) => ({
    id: `${id}:${n.id}`,
    type: "feed",
    d: `M${r(n.x + n.w / 2)} ${r(n.y + n.h)}V${r(busY)}H${r(to.x)}`,
  }));
  links.push({ id: `${id}:down`, type: "feed", d: `M${r(to.x)} ${r(busY)}V${r(to.y)}` });
  return links;
}

function layoutDrive(spec: PluginSpec, start: boolean, receivesFrom: string | null): InsideLayout {
  const steps = spec.inside.steps ?? [];
  const gap = 196;
  const nodes: InsideNode[] = [];
  const links: InsideLink[] = [];
  const marks: InsideMark[] = [];
  let x = 0;
  marks.push(
    start ? { kind: "station", x, y: 0, station: "input-received" } : { kind: "entry", x, y: 0 },
  );
  if (receivesFrom !== null) {
    nodes.push({
      id: `ghost:${receivesFrom}`,
      item: { type: "ghost", name: receivesFrom, role: "handoffFrom" },
      x: -GHOST_W - 130,
      y: -GHOST_H / 2,
      w: GHOST_W,
      h: GHOST_H,
    });
    links.push({
      id: "handoff:in",
      type: "handoff",
      d: `M${r(-130)} ${r(-8)}C${r(-80)} ${r(-60)} ${r(-40)} ${r(-60)} ${r(-12)} ${r(-10)}`,
    });
  }
  let prevRight = start ? TAG_W / 2 : 8;
  let prevYs: number[] = [0];
  const stepXs: number[] = [];
  for (const step of steps) {
    x += gap;
    stepXs.push(x);
    const lanes = Math.max(1, step.lanes);
    const ys = Array.from({ length: lanes }, (_, i) => (i - (lanes - 1) / 2) * 62);
    ys.forEach((y, lane) => {
      nodes.push({
        id: `step:${step.id}:${String(lane)}`,
        item: { type: "step", step, lane: lanes > 1 ? lane + 1 : 0 },
        x: x - STEP_W / 2,
        y: y - STEP_H / 2,
        w: STEP_W,
        h: STEP_H,
      });
    });
    // 갈래와 합침: 앞 단계의 오른쪽 가운데에서 이 단계의 왼쪽 가운데로 직각
    const midX = (prevRight + x - STEP_W / 2) / 2;
    for (const py of prevYs) {
      for (const y of ys) {
        if (prevYs.length > 1 && ys.length > 1) continue;
        links.push({
          id: `flow:${step.id}:${String(py)}:${String(y)}`,
          type: "flow",
          d: `M${r(prevRight)} ${r(py)}H${r(midX)}V${r(y)}H${r(x - STEP_W / 2)}`,
        });
      }
    }
    prevRight = x + STEP_W / 2;
    prevYs = ys;
  }
  x += gap * 0.75;
  const handoff = spec.inside.handoff ?? [];
  for (const py of prevYs) {
    links.push({
      id: `flow:end:${String(py)}`,
      type: "flow",
      d: `M${r(prevRight)} ${r(py)}H${r((prevRight + x) / 2)}V0H${r(x - 8)}`,
    });
  }
  marks.push({ kind: handoff.length > 0 ? "exit" : "end", x, y: 0 });
  handoff.forEach((name, i) => {
    const gx = x + 120;
    const gy = -GHOST_H / 2 + i * (GHOST_H + 16);
    nodes.push({
      id: `ghost:${name}`,
      item: { type: "ghost", name, role: "handoffTo" },
      x: gx,
      y: gy,
      w: GHOST_W,
      h: GHOST_H,
    });
    links.push({
      id: `handoff:${name}`,
      type: "handoff",
      d: `M${r(x + 8)} ${r(-6)}C${r(x + 50)} ${r(-56)} ${r(gx - 50)} ${r(gy - 30)} ${r(gx)} ${r(gy + 14)}`,
    });
  });
  // 지침은 단계 전체에 걸린다: 위에 놓고 꺾쇠로 잡는다
  const first = stepXs[0] ?? 0;
  const last = stepXs[stepXs.length - 1] ?? 0;
  const top = Math.min(...nodes.filter((n) => n.item.type === "step").map((n) => n.y), -STEP_H / 2);
  const spanY = top - 34;
  const parts = partGrid(spec.inside.parts, 3, (first + last) / 2, spanY - 40);
  nodes.push(...parts);
  for (const p of parts) {
    links.push({
      id: `feed:${p.id}`,
      type: "feed",
      d: `M${r(p.x + p.w / 2)} ${r(p.y + p.h)}V${r(spanY)}`,
    });
  }
  const bottom = Math.max(
    ...nodes.filter((n) => n.item.type === "step").map((n) => n.y + n.h),
    STEP_H / 2,
  );
  nodes.push(...readouts(spec, bottom + 70, (first + last) / 2));
  return {
    nodes,
    links,
    marks,
    line: { x1: -60, x2: x + 4 },
    spans:
      parts.length > 0
        ? [{ x1: first - STEP_W / 2 - 10, x2: last + STEP_W / 2 + 10, y: spanY, tick: 8 }]
        : [],
    bounds: bounds(nodes, [-90, x + 60], [spanY - 40]),
  };
}

function layoutHook(spec: PluginSpec): InsideLayout {
  const handler = spec.inside.handler ?? {
    port: spec.port ?? "tools.before",
    decision: spec.decision ?? "block",
  };
  const { station, side } = stationOfPort(handler.port);
  const nodes: InsideNode[] = [];
  const marks: InsideMark[] = [];
  const px = 0;
  const sx = side === "before" ? TAG_W / 2 + 40 : side === "after" ? -TAG_W / 2 - 40 : 0;
  marks.push(
    side === null
      ? { kind: "boundary", x: px, y: 0, station }
      : { kind: "station", x: sx, y: 0, station },
  );
  marks.push({ kind: "port", x: px, y: 0, port: handler.port });
  const hy = 70;
  nodes.push({
    id: "handler",
    item: {
      type: "handler",
      port: handler.port,
      decision: handler.decision,
      guard: spec.guard === true,
    },
    x: px - HANDLER_W / 2,
    y: hy,
    w: HANDLER_W,
    h: HANDLER_H,
  });
  const parts = partGrid(spec.inside.parts, 3, px, -60);
  nodes.push(...parts);
  nodes.push(...readouts(spec, hy + HANDLER_H + 56, px));
  const links: InsideLink[] = [
    { id: "attach", type: "attach", d: `M${r(px)} 6V${r(hy - 6)}` },
    ...(parts.length > 0 ? busTo(parts, { x: px, y: -TAG_H / 2 }, -36, "feed") : []),
  ];
  return {
    nodes,
    links,
    marks,
    line: { x1: -260, x2: 260 },
    spans: [],
    bounds: bounds(nodes, [-280, 280], [-80]),
  };
}

function layoutFeed(spec: PluginSpec): InsideLayout {
  const station: StationId = spec.kind === "tool" ? "tools" : "context";
  const nodes: InsideNode[] = [];
  const links: InsideLink[] = [];
  const servers = spec.inside.parts.filter((p) => p.unit === "server");
  const rest = spec.inside.parts.filter((p) => p.unit !== "server");
  const cols = rest.length > 6 ? 4 : 3;
  const grid = partGrid(rest, cols, 0, -84);
  nodes.push(...grid);
  const spans: Span[] = [];
  if (grid.length > 0) {
    const under = spanOf(grid, -84 + 14, -8);
    spans.push(under);
    links.push({ id: "feed:down", type: "feed", d: `M0 ${r(under.y)}V${r(-TAG_H / 2 - 8)}` });
  }
  const topOfGrid = Math.min(...grid.map((n) => n.y), -84);
  const over = grid.length > 0 ? spanOf(grid, topOfGrid - 14, 8) : null;
  if (over !== null && servers.length > 0) spans.push(over);
  servers.forEach((part, i) => {
    const node: InsideNode = {
      id: `part:${part.id}`,
      item: { type: "part", part },
      x: -PART_W / 2 + i * (PART_W + 18),
      y: topOfGrid - 96,
      w: PART_W,
      h: PART_H,
    };
    nodes.push(node);
    const cx = node.x + node.w / 2;
    links.push({
      id: `serve:${part.id}`,
      type: "feed",
      d: `M${r(cx)} ${r(node.y + node.h)}V${r(over === null ? -TAG_H / 2 - 8 : over.y)}`,
    });
  });
  nodes.push(...readouts(spec, 70, 0));
  return {
    nodes,
    links,
    marks: [{ kind: "station", x: 0, y: 0, station }],
    line: { x1: -260, x2: 260 },
    spans,
    bounds: bounds(nodes, [-280, 280], [-40]),
  };
}

/**
 * 플러그인 하나의 내부 배치. `start`는 이 프로필의 스타트 Drive인지, `receivesFrom`은 이 Drive에 핸드오프하는 플러그인.
 */
export function layoutInside(
  spec: PluginSpec,
  start: boolean,
  receivesFrom: string | null,
): InsideLayout {
  if (spec.kind === "drive") return layoutDrive(spec, start, receivesFrom);
  if (spec.kind === "hook") return layoutHook(spec);
  return layoutFeed(spec);
}
