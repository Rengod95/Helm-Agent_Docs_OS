// cvE 궤도 판의 기하(순수). 세계 좌표의 원점이 코어 고리의 중심이고, 각도는 화면 기준(0° = 오른쪽, 시계 방향)이다.
// 블록은 고리 위의 정거장, Hook은 지점에서 바깥으로 쌓이고(안쪽이 먼저 돈다), Inject는 고리 안, Drive는 고리 밖의 자기 고리다.
import {
  handoffs,
  slotOf,
  stackAt,
  type Defs,
  type HookPoint,
  type Kind,
  type ProfileModel,
  type Slot,
  type StationId,
} from "./model.ts";

export interface Pt {
  readonly x: number;
  readonly y: number;
}

/** 코어 고리 반지름 */
export const RING = 190;

/** 정거장(블록)의 각도. 왼쪽 "입력 받기"에서 시작해 시계 방향으로 돈다 */
export const STATION_ANGLE: Readonly<Record<StationId, number>> = {
  context: 198,
  model: 240,
  tools: 282,
  ask: 338,
  agents: 30,
  record: 75,
};

/** Hook 지점의 각도. 블록 앞은 그 정거장 조금 앞, 뒤는 조금 뒤 */
export const POINT_ANGLE: Readonly<Record<HookPoint, number>> = {
  input: 166,
  "model.before": 218,
  "tools.before": 252,
  "tools.after": 312,
  "ask.before": 324,
  "agents.before": 14,
  turnEnd: 122,
};

/** 노드 상자(세계 단위). 모양이 종류를 말한다: Inject 알약, Hook 문 카드, 도구 소켓 타일, Drive 고리 */
export const SIZE: Readonly<Record<"inject" | "hook" | "tool" | "bundle", Pt>> = {
  inject: { x: 184, y: 34 },
  hook: { x: 176, y: 48 },
  tool: { x: 60, y: 60 },
  bundle: { x: 156, y: 52 },
};

const GAP = 10;
/** 고리와 첫 노드 사이(정거장 이름이 들어갈 틈) */
const CLEAR = 26;
const INSIDE_X = -6;
const INSIDE_STEP = 42;

export function polar(r: number, deg: number): Pt {
  const a = (deg * Math.PI) / 180;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

/** 각도 방향으로 본 상자의 반 길이 */
function reach(size: Pt, deg: number): number {
  const a = (deg * Math.PI) / 180;
  return Math.abs(Math.cos(a)) * (size.x / 2) + Math.abs(Math.sin(a)) * (size.y / 2);
}

function slotAngle(slot: Slot): number {
  if (slot === "inside") return STATION_ANGLE.context;
  if (slot === "socket") return STATION_ANGLE.tools;
  if (slot === "drive") return 90;
  return POINT_ANGLE[slot];
}

/** 자리가 고리에 닿는 점(붙음 선의 끝) */
export function anchorOf(slot: Slot): Pt {
  return polar(RING, slotAngle(slot));
}

function sizeOfSlot(slot: Slot): Pt {
  return slot === "inside" ? SIZE.inject : slot === "socket" ? SIZE.tool : SIZE.hook;
}

/** 바깥으로 쌓이는 자리의 i번째 중심 */
function radialAt(slot: Slot, i: number): Pt {
  const deg = slotAngle(slot);
  const e = reach(sizeOfSlot(slot), deg);
  return polar(RING + CLEAR + e + i * (2 * e + GAP), deg);
}

/** 고리 안 i번째(n개 중) 중심 */
function insideAt(i: number, n: number): Pt {
  return { x: INSIDE_X, y: (i - (n - 1) / 2) * INSIDE_STEP };
}

interface DriveSpot {
  readonly c: Pt;
  readonly r: number;
}

const DRIVE_SPOTS: readonly DriveSpot[] = [
  { c: { x: -262, y: 322 }, r: 84 },
  { c: { x: 252, y: 336 }, r: 62 },
  { c: { x: -4, y: 452 }, r: 62 },
  { c: { x: -470, y: 150 }, r: 62 },
];

function driveSpot(i: number): DriveSpot {
  return DRIVE_SPOTS[i] ?? { c: { x: -470 + (i - 3) * 150, y: 470 }, r: 56 };
}

type NodeShape = Kind | "bundle";

export interface PlacedNode {
  readonly id: string;
  readonly shape: NodeShape;
  readonly slot: Slot;
  /** 상자 중심 */
  readonly c: Pt;
  /** Drive만: 고리 반지름 */
  readonly r?: number;
  /** 같은 자리에서 몇 번째로 도나(0부터) */
  readonly order: number;
}

interface Tether {
  readonly id: string;
  readonly from: Pt;
  readonly to: Pt;
  /** 커플링(Drive가 루프를 쥠)이면 두 줄 */
  readonly coupling: boolean;
  /** 핸드오프를 받은 동안만 쥐는 Drive(점선) */
  readonly latent: boolean;
}

interface Handoff {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly d: string;
  /** 화살 머리 자리와 방향(도) */
  readonly tip: Pt;
  readonly tipDeg: number;
  readonly mid: Pt;
}

interface GroupArc {
  readonly id: string;
  readonly key: string;
  readonly d: string;
  readonly tab: Pt;
  readonly count: number;
  readonly open: boolean;
}

export interface Board {
  readonly nodes: readonly PlacedNode[];
  readonly tethers: readonly Tether[];
  readonly handoffs: readonly Handoff[];
  readonly groups: readonly GroupArc[];
  /** 무엇이 붙어 있는 지점(고리 위 눈금) */
  readonly usedSlots: readonly Slot[];
  readonly bounds: { readonly min: Pt; readonly max: Pt };
}

function edgeToward(c: Pt, r: number, target: Pt): Pt {
  const dx = target.x - c.x;
  const dy = target.y - c.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: c.x + (dx / len) * r, y: c.y + (dy / len) * r };
}

/** 상자 가장자리에서 목표 쪽 점 */
function boxEdgeToward(c: Pt, size: Pt, target: Pt): Pt {
  const dx = target.x - c.x;
  const dy = target.y - c.y;
  const sx = dx === 0 ? Infinity : size.x / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : size.y / 2 / Math.abs(dy);
  const s = Math.min(sx, sy, 1);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

function nodeSize(n: PlacedNode): Pt {
  if (n.shape === "drive") return { x: (n.r ?? 60) * 2, y: (n.r ?? 60) * 2 };
  return SIZE[n.shape];
}

function nodeEdge(n: PlacedNode, target: Pt): Pt {
  return n.shape === "drive"
    ? edgeToward(n.c, n.r ?? 60, target)
    : boxEdgeToward(n.c, nodeSize(n), target);
}

const f = (v: number): string => v.toFixed(1);

/** 두 Drive 사이의 핸드오프 호. 원점에서 먼 쪽으로 휜다(고리를 가로지르지 않는다) */
function handoffPath(a: PlacedNode, b: PlacedNode): Omit<Handoff, "id" | "from" | "to"> {
  const mx = (a.c.x + b.c.x) / 2;
  const my = (a.c.y + b.c.y) / 2;
  const ml = Math.hypot(mx, my) || 1;
  const bend = Math.max(90, Math.hypot(b.c.x - a.c.x, b.c.y - a.c.y) * 0.28);
  const ctrl = { x: mx + (mx / ml) * bend, y: my + (my / ml) * bend };
  const start = nodeEdge(a, ctrl);
  const end = nodeEdge(b, ctrl);
  const tipDeg = (Math.atan2(end.y - ctrl.y, end.x - ctrl.x) * 180) / Math.PI;
  const mid = {
    x: 0.25 * start.x + 0.5 * ctrl.x + 0.25 * end.x,
    y: 0.25 * start.y + 0.5 * ctrl.y + 0.25 * end.y,
  };
  return {
    d: `M${f(start.x)} ${f(start.y)} Q${f(ctrl.x)} ${f(ctrl.y)} ${f(end.x)} ${f(end.y)}`,
    tip: end,
    tipDeg,
    mid,
  };
}

function angleOf(p: Pt): number {
  const deg = (Math.atan2(p.y, p.x) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}

/** 묶음의 호: 구성원 둘레를 지나는 바깥 궤도 한 토막. 짧은 쪽으로 돈다 */
function groupArc(angles: readonly number[], radius: number): { d: string; mid: number } {
  const sorted = angles.toSorted((a, b) => a - b);
  // 가장 큰 빈틈의 반대편이 호다
  let gapAt = 0;
  let gap = -1;
  sorted.forEach((a, i) => {
    const next = sorted[(i + 1) % sorted.length] ?? a;
    const g = (next - a + 360) % 360 || 360;
    if (g > gap) {
      gap = g;
      gapAt = i;
    }
  });
  const start = sorted[(gapAt + 1) % sorted.length] ?? 0;
  const sweep = 360 - gap;
  const p0 = polar(radius, start);
  const p1 = polar(radius, start + sweep);
  const large = sweep > 180 ? 1 : 0;
  return {
    d: `M${f(p0.x)} ${f(p0.y)} A${f(radius)} ${f(radius)} 0 ${String(large)} 1 ${f(p1.x)} ${f(p1.y)}`,
    mid: start + sweep / 2,
  };
}

const GROUP_RADIUS = 380;

/** 프로필 하나를 판 위에 놓는다. `closed`는 접힌 묶음 id */
export function layoutBoard(profile: ProfileModel, defs: Defs, closed: ReadonlySet<string>): Board {
  const hidden = new Map<string, string>();
  for (const g of profile.groups) {
    if (closed.has(g.id)) for (const m of g.members) hidden.set(m, g.id);
  }
  const nodes: PlacedNode[] = [];
  const tethers: Tether[] = [];
  const usedSlots: Slot[] = [];
  const inside = stackAt(profile, defs, "inside");
  const radialSlots: readonly Slot[] = [
    "input",
    "model.before",
    "tools.before",
    "socket",
    "tools.after",
    "ask.before",
    "agents.before",
    "turnEnd",
  ];

  inside.forEach((id, i) => {
    const c = insideAt(i, inside.length);
    const n: PlacedNode = { id, shape: "inject", slot: "inside", c, order: i };
    if (!hidden.has(id)) nodes.push(n);
  });
  if (inside.length > 0) usedSlots.push("inside");

  for (const slot of radialSlots) {
    const stack = stackAt(profile, defs, slot);
    if (stack.length > 0) usedSlots.push(slot);
    stack.forEach((id, i) => {
      const shape: NodeShape = slot === "socket" ? "tool" : "hook";
      nodes.push({ id, shape, slot, c: radialAt(slot, i), order: i });
    });
  }

  const drives = stackAt(profile, defs, "drive");
  const start = profile.startDrive;
  const orderedDrives =
    start !== null && drives.includes(start)
      ? [start, ...drives.filter((d) => d !== start)]
      : drives;
  orderedDrives.forEach((id, i) => {
    const spot = driveSpot(i);
    nodes.push({ id, shape: "drive", slot: "drive", c: spot.c, r: spot.r, order: i });
  });

  // 접힌 묶음: 구성원 대신 묶음 노드 하나. 자리는 묶음 호의 가운데 바깥
  const groups: GroupArc[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const g of profile.groups) {
    const members = g.members.map((m) => byId.get(m)).filter((n) => n !== undefined);
    if (members.length === 0) continue;
    const arc = groupArc(
      members.map((m) => angleOf(m.c)),
      GROUP_RADIUS,
    );
    const open = !closed.has(g.id);
    const tab = polar(GROUP_RADIUS, arc.mid);
    groups.push({ id: g.id, key: g.key, d: arc.d, tab, count: members.length, open });
    if (!open) {
      const c = polar(GROUP_RADIUS + 24, arc.mid);
      nodes.push({ id: g.id, shape: "bundle", slot: "tools.after", c, order: 0 });
    }
  }
  const visible = nodes.filter((n) => !hidden.has(n.id));
  const placed = new Map(visible.map((n) => [n.id, n]));
  const stand = (id: string): PlacedNode | undefined => {
    const group = hidden.get(id);
    return placed.get(group ?? id);
  };

  // 붙음 선: 자리의 노드 가운데 고리에 가장 가까운 것만 고리에 닿고, 나머지는 앞 노드에 잇는다(쌓임)
  for (const slot of [...radialSlots, "inside" as const]) {
    const stack = stackAt(profile, defs, slot);
    let prev: PlacedNode | null = null;
    for (const id of stack) {
      const n = stand(id);
      if (n === undefined || n === prev) continue;
      if (slot === "inside") {
        const anchor = anchorOf("inside");
        tethers.push({
          id: `t:${id}`,
          from: nodeEdge(n, anchor),
          to: anchor,
          coupling: false,
          latent: false,
        });
      } else {
        const target = prev === null ? anchorOf(slot) : prev.c;
        const from = nodeEdge(n, target);
        const to = prev === null ? target : nodeEdge(prev, n.c);
        tethers.push({ id: `t:${id}`, from, to, coupling: false, latent: false });
      }
      prev = n;
    }
  }
  // 커플링: Drive 고리가 코어 고리를 쥔다. 스타트 Drive는 늘, 나머지는 핸드오프를 받은 동안만(점선)
  for (const id of orderedDrives) {
    const n = stand(id);
    if (n === undefined || n.shape !== "drive") continue;
    const to = edgeToward({ x: 0, y: 0 }, RING, n.c);
    tethers.push({
      id: `c:${id}`,
      from: nodeEdge(n, { x: 0, y: 0 }),
      to,
      coupling: true,
      latent: id !== orderedDrives[0],
    });
  }

  const links: Handoff[] = [];
  for (const h of handoffs(profile, defs)) {
    const a = stand(h.from);
    const b = stand(h.to);
    if (a === undefined || b === undefined || a === b) continue;
    links.push({ id: `h:${h.from}>${h.to}`, from: a.id, to: b.id, ...handoffPath(a, b) });
  }

  return { nodes: visible, tethers, handoffs: links, groups, usedSlots, bounds: boundsOf(visible) };
}

function boundsOf(nodes: readonly PlacedNode[]): { min: Pt; max: Pt } {
  let min = { x: -RING - 40, y: -RING - 40 };
  let max = { x: RING + 40, y: RING + 40 };
  for (const n of nodes) {
    const s = nodeSize(n);
    const pad = n.shape === "drive" ? 26 : n.shape === "tool" ? 20 : 0;
    min = { x: Math.min(min.x, n.c.x - s.x / 2 - pad), y: Math.min(min.y, n.c.y - s.y / 2 - pad) };
    max = { x: Math.max(max.x, n.c.x + s.x / 2 + pad), y: Math.max(max.y, n.c.y + s.y / 2 + pad) };
  }
  return { min, max };
}

/** 끌어 놓을 수 있는 자리 하나. 바(쌓인 노드 사이에 끼우기)나 빈 상자(맨 끝) */
export interface DropTarget {
  readonly key: string;
  readonly slot: Slot;
  readonly index: number;
  readonly c: Pt;
  readonly shape: "bar" | "box" | "ring";
  /** 바·상자의 방향(도): 쌓이는 방향 */
  readonly deg: number;
  readonly size: Pt;
}

/** 플러그인 하나를 놓을 수 있는 자리들. 자리는 플러그인이 정하고, 사용자는 그 자리 안의 순서를 고른다 */
export function dropTargets(profile: ProfileModel, defs: Defs, id: string): readonly DropTarget[] {
  const def = defs[id];
  if (def === undefined) return [];
  const slot = slotOf(def);
  const rest: ProfileModel = { ...profile, entries: profile.entries.filter((e) => e.id !== id) };
  const stack = stackAt(rest, defs, slot);
  const n = stack.length;
  const out: DropTarget[] = [];
  if (slot === "drive") {
    const spot = driveSpot(stackAt(rest, defs, "drive").length);
    return [
      {
        key: "drive:end",
        slot,
        index: n,
        c: spot.c,
        shape: "ring",
        deg: 0,
        size: { x: spot.r, y: spot.r },
      },
    ];
  }
  const firstGuardless = stack.findIndex((s) => defs[s]?.guard !== true);
  const lowest = def.guard === true ? 0 : firstGuardless < 0 ? n : firstGuardless;
  for (let i = lowest; i <= n; i += 1) {
    if (slot === "inside") {
      const c = insideAt(i, n + 1);
      out.push({
        key: `${slot}:${String(i)}`,
        slot,
        index: i,
        c,
        shape: "box",
        deg: 90,
        size: SIZE.inject,
      });
      continue;
    }
    const deg = slotAngle(slot);
    const size = sizeOfSlot(slot);
    if (i === n) {
      out.push({
        key: `${slot}:${String(i)}`,
        slot,
        index: i,
        c: radialAt(slot, i),
        shape: "box",
        deg,
        size,
      });
    } else {
      const e = reach(size, deg);
      const at = radialAt(slot, i);
      const c = {
        x: at.x - Math.cos((deg * Math.PI) / 180) * (e + GAP / 2),
        y: at.y - Math.sin((deg * Math.PI) / 180) * (e + GAP / 2),
      };
      out.push({ key: `${slot}:${String(i)}`, slot, index: i, c, shape: "bar", deg, size });
    }
  }
  return out;
}

/** 놓기: 포인터(세계 좌표)에서 가장 가까운 자리. 반경 밖이면 없음 */
export function nearestTarget(
  targets: readonly DropTarget[],
  p: Pt,
  radius: number,
): DropTarget | null {
  let best: DropTarget | null = null;
  let bestD = radius;
  for (const t of targets) {
    const d = Math.hypot(t.c.x - p.x, t.c.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

/** 고리 위 정거장 사이의 흐름 표식(시계 방향) 자리 */
export function flowMarks(): readonly { readonly c: Pt; readonly deg: number }[] {
  const order = Object.values(STATION_ANGLE).toSorted((a, b) => a - b);
  return order.map((a, i) => {
    const b = order[(i + 1) % order.length] ?? a;
    const mid = a + ((b - a + 360) % 360) / 2;
    return { c: polar(RING, mid), deg: mid + 90 };
  });
}
