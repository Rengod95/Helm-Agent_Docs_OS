// cvB 캔버스의 순수 배치. 턴은 둥근 사각 궤도(빛길)이고, 블록 여섯은 궤도 위의 프리즘 틀, 경계 셋은 궤도 위의 작은 마름모다.
// 흐름은 시계 방향이다: 왼쪽 위 "입력 받기" → 위 변(컨텍스트 조립, 모델 호출) → 오른쪽 변(도구 실행) → 아래 변(사람에게 묻기, 서브에이전트, 기록)
// → 왼쪽 아래 "턴 종료 직전" → 다시 입력 받기. 대화 시작은 궤도 밖에서 한 번 들어온다.
// 플러그인 결정은 틀 바깥에 기둥(rod)으로 꿰여 매달린다. 앞(before)은 흐름의 위쪽 끝, 뒤(after)는 아래쪽 끝, 넣음(feed)은 가운데 소켓이다.
// Drive는 궤도 안쪽(턴을 쥐는 자리)에 놓이고, 플러그인 ↔ 플러그인 핸드오프는 휘는 빛줄기로 잇는다. 묶음은 안쪽에 그릇으로 놓인다.
import { assertNever } from "@fresnel/contracts";
import {
  anchorKey,
  groupOf,
  handoffsOf,
  orderAt,
  rankAt,
  type Anchor,
  type Block,
  type Boundary,
  type Catalog,
  type CvbPlugin,
  type Group,
  type ProfileState,
  type Side,
} from "./model.ts";

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** 크리스탈(플러그인) 크기. Drive는 한 단계 크다 */
const CRYSTAL = { w: 176, h: 54 } as const;
const DRIVE = { w: 196, h: 62 } as const;
const STACK_GAP = 12;
const STATION = { w: 132, h: 40 } as const;
const GROUP_HEAD = 36;
const GROUP_PAD = 12;
const GROUP_CLOSED = { w: 196, h: 58 } as const;
const CORNER = 44;
// 오른쪽 변 틀(도구 실행)이 안쪽으로 반쯤 들어오므로 그만큼 비우고 기둥이 보일 틈을 둔다
const ZONE_INSET = { x: 66 + 30, y: 58 } as const;
// Drive 자리의 계단: 다음 것은 오른쪽으로 STAIR_X, 아래로 STAIR_GAP만큼 내려 선다(빛줄기가 아래로 꺾여 든다)
const STAIR_X = 138;
const STAIR_GAP = 44;
/** 기둥 소켓이 틀 끝에서 들어온 거리 */
const SOCKET_INSET = 18;

/** 흐름 방향(틀이 놓인 변) */
type Flow = "right" | "down" | "left" | "up";

export type LayoutNode =
  | {
      readonly type: "station";
      readonly id: string;
      readonly block: Block;
      readonly box: Box;
      readonly flow: Flow;
      readonly target: boolean;
      readonly count: number;
    }
  | {
      readonly type: "gate";
      readonly id: string;
      readonly boundary: Boundary;
      readonly box: Box;
      readonly outside: boolean;
      readonly target: boolean;
      readonly count: number;
    }
  | {
      readonly type: "crystal";
      readonly id: string;
      readonly plugin: CvbPlugin;
      readonly box: Box;
      readonly ghost: boolean;
      readonly base: boolean;
      readonly start: boolean;
      readonly rank: number | null;
      readonly group: string | null;
    }
  | {
      readonly type: "group";
      readonly id: string;
      readonly group: Group;
      readonly box: Box;
      readonly open: boolean;
      readonly kinds: readonly CvbPlugin["kind"][];
    }
  | {
      readonly type: "zone";
      readonly id: string;
      readonly box: Box;
      readonly target: boolean;
      readonly empty: boolean;
    };

/** 선 셋: 궤도(빛길), 기둥(코어 ↔ 플러그인 붙음), 빛줄기(플러그인 ↔ 플러그인 핸드오프). entry는 대화 시작의 들어옴 */
export type Line =
  | { readonly kind: "track"; readonly id: string; readonly d: string }
  | { readonly kind: "entry"; readonly id: string; readonly d: string }
  | {
      readonly kind: "rod";
      readonly id: string;
      readonly d: string;
      readonly ghost: boolean;
      readonly lit: boolean;
    }
  | {
      readonly kind: "beam";
      readonly id: string;
      readonly d: string;
      readonly mid: Point;
      readonly end: Point;
      readonly endAngle: number;
      readonly start: Point;
      readonly startAngle: number;
      readonly back: boolean;
      readonly lit: boolean;
    };

/** 틀 가장자리의 소켓(마름모). side로 앞·뒤·넣음을 가른다 */
interface Socket {
  readonly id: string;
  readonly at: Point;
  readonly side: Side | "gate";
  readonly lit: boolean;
}

/** 흐름 방향 표시(궤도 위 작은 꺾쇠) */
interface Chevron {
  readonly at: Point;
  readonly angle: number;
}

export interface Layout {
  readonly nodes: readonly LayoutNode[];
  readonly lines: readonly Line[];
  readonly sockets: readonly Socket[];
  readonly chevrons: readonly Chevron[];
  readonly bounds: Box;
}

export interface LayoutInput {
  readonly state: ProfileState;
  readonly catalog: Catalog;
  /** 펼친 묶음 id */
  readonly open: ReadonlySet<string>;
  /** 끌어 놓는 중인 플러그인(그 자리에 빈 자리를 그린다) */
  readonly ghost: string | null;
  /** 고른 플러그인(그 기둥과 빛줄기를 밝힌다) */
  readonly selected: string | null;
}

interface StationSpec {
  readonly block: Block;
  readonly flow: Flow;
  /** 변 위의 위치(0~1). 위·아래 변은 x, 오른쪽 변은 y */
  readonly t: number;
}

const STATIONS: readonly StationSpec[] = [
  { block: "context", flow: "right", t: 0.27 },
  { block: "model", flow: "right", t: 0.7 },
  { block: "tools", flow: "down", t: 0.5 },
  { block: "ask", flow: "left", t: 0.79 },
  { block: "agents", flow: "left", t: 0.5 },
  { block: "record", flow: "left", t: 0.21 },
];

const SIDES: readonly Side[] = ["before", "feed", "after"];

function centerOf(box: Box): Point {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

function sizeOf(plugin: CvbPlugin): { readonly w: number; readonly h: number } {
  return plugin.kind === "drive" ? DRIVE : CRYSTAL;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function path(points: readonly Point[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${round(p.x)} ${round(p.y)}`).join(" ");
}

/** 꺾인 선(가로 먼저 또는 세로 먼저). 모서리를 6만큼 둥글린다 */
function elbow(from: Point, to: Point, first: "h" | "v"): string {
  if (from.x === to.x || from.y === to.y) return path([from, to]);
  const mid: Point = first === "h" ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
  return roundedPath([from, mid, to]);
}

/** 꺾이는 점들을 지나는 선. 꺾는 자리를 둥글린다 */
function roundedPath(points: readonly Point[], radius = 6): string {
  const first = points[0];
  if (first === undefined) return "";
  let d = `M${round(first.x)} ${round(first.y)}`;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    if (prev === undefined || cur === undefined) continue;
    if (next === undefined) {
      d += ` L${round(cur.x)} ${round(cur.y)}`;
      continue;
    }
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r <= 0) {
      d += ` L${round(cur.x)} ${round(cur.y)}`;
      continue;
    }
    const a: Point = {
      x: cur.x - ((cur.x - prev.x) / inLen) * r,
      y: cur.y - ((cur.y - prev.y) / inLen) * r,
    };
    const b: Point = {
      x: cur.x + ((next.x - cur.x) / outLen) * r,
      y: cur.y + ((next.y - cur.y) / outLen) * r,
    };
    d += ` L${round(a.x)} ${round(a.y)} Q${round(cur.x)} ${round(cur.y)} ${round(b.x)} ${round(b.y)}`;
  }
  return d;
}

/** 한 자리에 매달릴 플러그인(묶음에 든 것은 빼고, 끌어 놓는 중이면 그 끝에 빈 자리) */
interface Hang {
  readonly id: string;
  readonly ghost: boolean;
}

function hangsAt(input: LayoutInput, key: string): readonly Hang[] {
  const ids = orderAt(input.state, input.catalog, key).filter(
    (id) => groupOf(input.state, id) === null,
  );
  const out: Hang[] = ids.map((id) => ({ id, ghost: false }));
  const ghost = input.ghost === null ? undefined : input.catalog.get(input.ghost);
  if (
    ghost !== undefined &&
    anchorKey(ghost.anchor) === key &&
    !out.some((h) => h.id === ghost.id)
  ) {
    out.push({ id: ghost.id, ghost: true });
  }
  return out;
}

function sideKey(block: Block, side: Side): string {
  return anchorKey({ at: "block", block, side });
}

interface Builder {
  readonly nodes: LayoutNode[];
  readonly lines: Line[];
  readonly sockets: Socket[];
}

function crystalNode(
  input: LayoutInput,
  hang: Hang,
  box: Box,
  group: string | null,
): LayoutNode | null {
  const plugin = input.catalog.get(hang.id);
  if (plugin === undefined) return null;
  const entry = input.state.entries.find((e) => e.plugin === hang.id);
  return {
    type: "crystal",
    id: hang.ghost ? `ghost:${hang.id}` : hang.id,
    plugin,
    box,
    ghost: hang.ghost,
    base: entry?.base === true,
    start: input.state.startDrive === hang.id,
    rank: hang.ghost ? null : rankAt(input.state, input.catalog, hang.id),
    group,
  };
}

/** 틀 가장자리의 소켓 위치. outer는 궤도 바깥 변, inner는 안쪽 변 */
function socketPoint(box: Box, flow: Flow, side: Side, face: "outer" | "inner"): Point {
  const c = centerOf(box);
  const along = side === "feed" ? 0 : side === "before" ? -1 : 1;
  switch (flow) {
    case "right":
      return {
        x: c.x + along * (box.w / 2 - SOCKET_INSET),
        y: face === "outer" ? box.y : box.y + box.h,
      };
    case "left":
      return {
        x: c.x - along * (box.w / 2 - SOCKET_INSET),
        y: face === "outer" ? box.y + box.h : box.y,
      };
    case "down":
      return {
        x: face === "outer" ? box.x + box.w : box.x,
        y: c.y + along * 10,
      };
    case "up":
      return {
        x: face === "outer" ? box.x : box.x + box.w,
        y: c.y - along * 10,
      };
    default:
      return assertNever(flow, "cvB.socketPoint");
  }
}

function isLit(input: LayoutInput, id: string): boolean {
  return input.selected === id;
}

/** 위·아래 변의 틀: 소켓마다 기둥 하나, 크리스탈이 바깥쪽으로 쌓인다 */
function hangHorizontal(
  b: Builder,
  input: LayoutInput,
  station: Box,
  block: Block,
  flow: "right" | "left",
): void {
  const active = SIDES.map((side) => ({
    side,
    hangs: hangsAt(input, sideKey(block, side)),
  })).filter((s) => s.hangs.length > 0);
  const ordered = flow === "right" ? active : active.toReversed();
  const colW = CRYSTAL.w + 16;
  const total = ordered.length * colW - 16;
  const c = centerOf(station);
  const outward = flow === "right" ? -1 : 1;
  const edgeY = flow === "right" ? station.y : station.y + station.h;
  ordered.forEach((col, ci) => {
    const colX = c.x - total / 2 + ci * colW + CRYSTAL.w / 2;
    const socket = socketPoint(station, flow, col.side, "outer");
    const elbowY = edgeY + outward * 14;
    let lastCenter: Point = { x: colX, y: elbowY };
    let anyLit = false;
    col.hangs.forEach((hang, i) => {
      const plugin = input.catalog.get(hang.id);
      if (plugin === undefined) return;
      const size = sizeOf(plugin);
      const near = edgeY + outward * 30;
      const y =
        outward < 0 ? near - (i + 1) * size.h - i * STACK_GAP : near + i * (size.h + STACK_GAP);
      const box: Box = { x: colX - size.w / 2, y, w: size.w, h: size.h };
      const node = crystalNode(input, hang, box, null);
      if (node !== null) b.nodes.push(node);
      lastCenter = centerOf(box);
      if (isLit(input, hang.id)) anyLit = true;
    });
    const ghostOnly = col.hangs.every((h) => h.ghost);
    b.lines.push({
      kind: "rod",
      id: `rod:${block}:${col.side}`,
      d: roundedPath([socket, { x: socket.x, y: elbowY }, { x: colX, y: elbowY }, lastCenter]),
      ghost: ghostOnly,
      lit: anyLit,
    });
    b.sockets.push({ id: `sock:${block}:${col.side}`, at: socket, side: col.side, lit: anyLit });
  });
}

/** 오른쪽 변의 틀: 크리스탈이 바깥 한 줄로 선다. 위에서 아래로 불리는 차례(앞 → 넣음 → 뒤)다 */
function hangVertical(b: Builder, input: LayoutInput, station: Box, block: Block): void {
  const before = hangsAt(input, sideKey(block, "before"));
  const feed = hangsAt(input, sideKey(block, "feed"));
  const after = hangsAt(input, sideKey(block, "after"));
  const column: { readonly hang: Hang; readonly side: Side }[] = [
    ...before.map((hang) => ({ hang, side: "before" as const })),
    ...feed.map((hang) => ({ hang, side: "feed" as const })),
    ...after.map((hang) => ({ hang, side: "after" as const })),
  ];
  if (column.length === 0) return;
  const c = centerOf(station);
  const heights = column.map((item) => {
    const plugin = input.catalog.get(item.hang.id);
    return plugin === undefined ? CRYSTAL.h : sizeOf(plugin).h;
  });
  const total = heights.reduce((sum, h) => sum + h, 0) + (column.length - 1) * STACK_GAP;
  const left = station.x + station.w + 40;
  const busX = station.x + station.w + 18;
  let y = c.y - total / 2;
  const lit = new Map<Side, boolean>();
  const ghost = new Map<Side, boolean>();
  column.forEach((item, i) => {
    const plugin = input.catalog.get(item.hang.id);
    const h = heights[i] ?? CRYSTAL.h;
    if (plugin === undefined) return;
    const size = sizeOf(plugin);
    const box: Box = { x: left, y, w: size.w, h };
    const node = crystalNode(input, item.hang, box, null);
    if (node !== null) b.nodes.push(node);
    const socket = socketPoint(station, "down", item.side, "outer");
    const mid = centerOf(box);
    b.lines.push({
      kind: "rod",
      id: `rod:${block}:${item.side}:${item.hang.id}`,
      d: roundedPath([
        socket,
        { x: busX, y: socket.y },
        { x: busX, y: mid.y },
        { x: left + 8, y: mid.y },
      ]),
      ghost: item.hang.ghost,
      lit: isLit(input, item.hang.id),
    });
    if (isLit(input, item.hang.id)) lit.set(item.side, true);
    ghost.set(item.side, (ghost.get(item.side) ?? true) && item.hang.ghost);
    y += h + STACK_GAP;
  });
  for (const side of SIDES) {
    if (!column.some((item) => item.side === side)) continue;
    b.sockets.push({
      id: `sock:${block}:${side}`,
      at: socketPoint(station, "down", side, "outer"),
      side,
      lit: lit.get(side) === true,
    });
  }
}

/** 왼쪽 경계 마름모: 크리스탈이 바깥(왼쪽) 한 줄로 선다 */
function hangGate(b: Builder, input: LayoutInput, gate: Box, boundary: Boundary): number {
  const hangs = hangsAt(input, anchorKey({ at: "boundary", boundary }));
  if (hangs.length === 0) return 0;
  const c = centerOf(gate);
  const total = hangs.length * CRYSTAL.h + (hangs.length - 1) * STACK_GAP;
  const right = gate.x - 36;
  let y = c.y - total / 2;
  let anyLit = false;
  hangs.forEach((hang) => {
    const box: Box = { x: right - CRYSTAL.w, y, w: CRYSTAL.w, h: CRYSTAL.h };
    const node = crystalNode(input, hang, box, null);
    if (node !== null) b.nodes.push(node);
    const mid = centerOf(box);
    const lit = isLit(input, hang.id);
    if (lit) anyLit = true;
    b.lines.push({
      kind: "rod",
      id: `rod:${boundary}:${hang.id}`,
      d: roundedPath([
        { x: gate.x, y: c.y },
        { x: right + 16, y: c.y },
        { x: right + 16, y: mid.y },
        { x: right - 8, y: mid.y },
      ]),
      ghost: hang.ghost,
      lit,
    });
    y += CRYSTAL.h + STACK_GAP;
  });
  b.sockets.push({ id: `sock:${boundary}`, at: { x: gate.x, y: c.y }, side: "gate", lit: anyLit });
  return CRYSTAL.w + 36;
}

/** 안쪽(Drive 자리)에 놓일 것: 묶음에 들지 않은 Drive와 묶음 */
type ZoneItem =
  | { readonly kind: "drive"; readonly hang: Hang }
  | { readonly kind: "group"; readonly group: Group; readonly open: boolean };

function zoneItems(input: LayoutInput): readonly ZoneItem[] {
  const drives = hangsAt(input, "drive");
  const start = input.state.startDrive;
  const sorted = drives.toSorted((a, b) => (a.id === start ? -1 : b.id === start ? 1 : 0));
  return [
    ...sorted.map((hang) => ({ kind: "drive" as const, hang })),
    ...input.state.groups.map((group) => ({
      kind: "group" as const,
      group,
      open: input.open.has(group.id),
    })),
  ];
}

function groupSize(
  input: LayoutInput,
  group: Group,
  open: boolean,
): { readonly w: number; readonly h: number } {
  if (!open) return GROUP_CLOSED;
  const sizes = group.members.flatMap((id) => {
    const plugin = input.catalog.get(id);
    return plugin === undefined ? [] : [sizeOf(plugin)];
  });
  const w = Math.max(...sizes.map((s) => s.w), CRYSTAL.w) + GROUP_PAD * 2;
  const h =
    GROUP_HEAD + sizes.reduce((sum, s) => sum + s.h, 0) + (sizes.length - 1) * 10 + GROUP_PAD;
  return { w, h };
}

function itemSize(input: LayoutInput, item: ZoneItem): { readonly w: number; readonly h: number } {
  if (item.kind === "group") return groupSize(input, item.group, item.open);
  const plugin = input.catalog.get(item.hang.id);
  return plugin === undefined ? DRIVE : sizeOf(plugin);
}

/** 묶음 안의 플러그인이 붙는 틀 소켓(궤도 안쪽 면) */
interface InnerTarget {
  readonly at: Point;
  readonly flow: Flow;
}

export function layoutProfile(input: LayoutInput): Layout {
  const b: Builder = { nodes: [], lines: [], sockets: [] };
  const items = zoneItems(input);
  const sizes = items.map((item) => itemSize(input, item));
  const zoneContentW = Math.max(0, ...sizes.map((s, i) => i * STAIR_X + s.w));
  const zoneContentH =
    sizes.reduce((sum, s) => sum + s.h, 0) + Math.max(0, items.length - 1) * STAIR_GAP;

  // 위 변의 폭 요구(틀마다 매달린 기둥 수)
  const topNeed = STATIONS.filter((s) => s.flow === "right").reduce((sum, s) => {
    const cols = SIDES.filter((side) => hangsAt(input, sideKey(s.block, side)).length > 0).length;
    return sum + Math.max(STATION.w, cols * (CRYSTAL.w + 16)) + 60;
  }, CORNER * 2);
  const width = Math.max(600, zoneContentW + ZONE_INSET.x * 2 + 40, topNeed);
  const toolsCount =
    hangsAt(input, sideKey("tools", "before")).length +
    hangsAt(input, sideKey("tools", "feed")).length +
    hangsAt(input, sideKey("tools", "after")).length;
  const height = Math.max(
    360,
    zoneContentH + ZONE_INSET.y * 2 + 64,
    toolsCount * (CRYSTAL.h + STACK_GAP) + 40,
  );

  // 궤도(빛길)
  b.lines.push({
    kind: "track",
    id: "track",
    d: `M${CORNER} 0 H${width - CORNER} Q${width} 0 ${width} ${CORNER} V${height - CORNER} Q${width} ${height} ${width - CORNER} ${height} H${CORNER} Q0 ${height} 0 ${height - CORNER} V${CORNER} Q0 0 ${CORNER} 0 Z`,
  });

  const targetKey = ghostKey(input);
  const targets = (anchor: (side: Side) => Anchor): boolean =>
    targetKey !== null && SIDES.some((side) => anchorKey(anchor(side)) === targetKey);

  // 블록 틀
  const stationBoxes = new Map<Block, { readonly box: Box; readonly flow: Flow }>();
  for (const spec of STATIONS) {
    const cols = SIDES.filter(
      (side) => hangsAt(input, sideKey(spec.block, side)).length > 0,
    ).length;
    const w =
      spec.flow === "down" ? STATION.w : Math.max(STATION.w, cols * (CRYSTAL.w + 16) - 16 + 8);
    const c: Point =
      spec.flow === "right"
        ? { x: width * spec.t, y: 0 }
        : spec.flow === "left"
          ? { x: width * spec.t, y: height }
          : { x: width, y: height * spec.t };
    const box: Box = { x: c.x - w / 2, y: c.y - STATION.h / 2, w, h: STATION.h };
    stationBoxes.set(spec.block, { box, flow: spec.flow });
    const count = SIDES.reduce(
      (sum, side) => sum + orderAt(input.state, input.catalog, sideKey(spec.block, side)).length,
      0,
    );
    b.nodes.push({
      type: "station",
      id: `station:${spec.block}`,
      block: spec.block,
      box,
      flow: spec.flow,
      target: targets((side) => ({ at: "block", block: spec.block, side })),
      count,
    });
    if (spec.flow === "down") hangVertical(b, input, box, spec.block);
    else if (spec.flow === "right" || spec.flow === "left")
      hangHorizontal(b, input, box, spec.block, spec.flow);
  }

  // 경계(왼쪽 변 두 개, 대화 시작은 바깥)
  const gateSize = 18;
  const gateAt = (boundary: Boundary, c: Point, outside: boolean): Box => {
    const box: Box = { x: c.x - gateSize / 2, y: c.y - gateSize / 2, w: gateSize, h: gateSize };
    b.nodes.push({
      type: "gate",
      id: `gate:${boundary}`,
      boundary,
      box,
      outside,
      target: targetKey === anchorKey({ at: "boundary", boundary }),
      count: orderAt(input.state, input.catalog, anchorKey({ at: "boundary", boundary })).length,
    });
    return box;
  };
  const inputGate = gateAt("input-received", { x: 0, y: height * 0.3 }, false);
  const endGate = gateAt("before-turn-end", { x: 0, y: height * 0.72 }, false);
  const inputReach = hangGate(b, input, inputGate, "input-received");
  hangGate(b, input, endGate, "before-turn-end");
  const startX = -Math.max(64, inputReach + 40);
  const startGate = gateAt("conversation-start", { x: startX, y: height * 0.3 - 46 }, true);
  hangGate(b, input, startGate, "conversation-start");
  const sc = centerOf(startGate);
  const ic = centerOf(inputGate);
  b.lines.push({
    kind: "entry",
    id: "entry",
    d: roundedPath(
      [
        { x: sc.x + gateSize / 2, y: sc.y },
        { x: ic.x - 22, y: sc.y },
        { x: ic.x - 22, y: ic.y },
        { x: ic.x - gateSize / 2, y: ic.y },
      ],
      10,
    ),
  });

  // Drive 자리(안쪽)
  const zone: Box = {
    x: ZONE_INSET.x,
    y: ZONE_INSET.y,
    w: width - ZONE_INSET.x * 2,
    h: height - ZONE_INSET.y * 2,
  };
  b.nodes.push({
    type: "zone",
    id: "zone",
    box: zone,
    target: targetKey === "drive",
    empty: items.length === 0,
  });
  const placed = new Map<string, Box>();
  const x0 = zone.x + (zone.w - zoneContentW) / 2;
  let y = zone.y + (zone.h - zoneContentH) / 2;
  items.forEach((item, i) => {
    const size = sizes[i] ?? DRIVE;
    const box: Box = { x: x0 + i * STAIR_X, y, w: size.w, h: size.h };
    if (item.kind === "drive") {
      const node = crystalNode(input, item.hang, box, null);
      if (node !== null) b.nodes.push(node);
      placed.set(item.hang.id, box);
    } else {
      placeGroup(b, input, item.group, item.open, box, placed, stationBoxes);
    }
    y += size.h + STAIR_GAP;
  });

  // 핸드오프 빛줄기
  for (const handoff of handoffsOf(input.state, input.catalog)) {
    const from = placed.get(handoff.from);
    const to = placed.get(handoff.to);
    if (from === undefined || to === undefined) continue;
    const lit = isLit(input, handoff.from) || isLit(input, handoff.to);
    b.lines.push(beamBetween(`beam:${handoff.from}:${handoff.to}`, from, to, handoff.back, lit));
  }

  // 흐름 꺾쇠(틀 사이 빈 곳)
  const chevrons: Chevron[] = [
    { at: { x: width * 0.1, y: 0 }, angle: 0 },
    { at: { x: width * 0.49, y: 0 }, angle: 0 },
    { at: { x: width * 0.9, y: 0 }, angle: 0 },
    { at: { x: width, y: height * 0.18 }, angle: 90 },
    { at: { x: width, y: height * 0.82 }, angle: 90 },
    { at: { x: width * 0.64, y: height }, angle: 180 },
    { at: { x: width * 0.355, y: height }, angle: 180 },
    { at: { x: 0, y: height * 0.51 }, angle: 270 },
  ];

  return {
    nodes: b.nodes,
    lines: b.lines,
    sockets: b.sockets,
    chevrons,
    bounds: boundsOf(b.nodes, width, height),
  };
}

function placeGroup(
  b: Builder,
  input: LayoutInput,
  group: Group,
  open: boolean,
  box: Box,
  placed: Map<string, Box>,
  stations: ReadonlyMap<Block, { readonly box: Box; readonly flow: Flow }>,
): void {
  const kinds = group.members.flatMap((id) => {
    const plugin = input.catalog.get(id);
    return plugin === undefined ? [] : [plugin.kind];
  });
  b.nodes.push({ type: "group", id: `group:${group.id}`, group, box, open, kinds });
  let y = box.y + GROUP_HEAD;
  for (const id of group.members) {
    const plugin = input.catalog.get(id);
    if (plugin === undefined) continue;
    const size = sizeOf(plugin);
    const member: Box = open ? { x: box.x + (box.w - size.w) / 2, y, w: size.w, h: size.h } : box;
    if (open) {
      const node = crystalNode(input, { id, ghost: false }, member, group.id);
      if (node !== null) b.nodes.push(node);
      y += size.h + 10;
    }
    placed.set(id, member);
    // 묶음 안의 Hook·Inject·도구는 틀 안쪽 면 소켓으로 기둥을 잇는다
    if (plugin.anchor.at !== "block") continue;
    const station = stations.get(plugin.anchor.block);
    if (station === undefined) continue;
    const target: InnerTarget = {
      at: socketPoint(station.box, station.flow, plugin.anchor.side, "inner"),
      flow: station.flow,
    };
    const from = centerOf(member);
    const lit = isLit(input, id) || isLit(input, `group:${group.id}`);
    const start: Point =
      target.flow === "down" || target.flow === "up"
        ? { x: member.x + member.w, y: from.y }
        : { x: from.x, y: target.flow === "right" ? member.y : member.y + member.h };
    b.lines.push({
      kind: "rod",
      id: `rod:group:${group.id}:${id}`,
      d: elbow(start, target.at, target.flow === "down" || target.flow === "up" ? "h" : "v"),
      ghost: false,
      lit,
    });
    b.sockets.push({ id: `sock:inner:${id}`, at: target.at, side: plugin.anchor.side, lit });
  }
}

function bezierMid(p0: Point, p1: Point, p2: Point, p3: Point): Point {
  return {
    x: 0.125 * p0.x + 0.375 * p1.x + 0.375 * p2.x + 0.125 * p3.x,
    y: 0.125 * p0.y + 0.375 * p1.y + 0.375 * p2.y + 0.125 * p3.y,
  };
}

function curve(start: Point, c1: Point, c2: Point, end: Point): string {
  return `M${round(start.x)} ${round(start.y)} C${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(end.x)} ${round(end.y)}`;
}

/**
 * 두 상자를 잇는 빛줄기(핸드오프). 받는 쪽이 아래에 있으면 보내는 쪽 바닥에서 내려와 받는 쪽 옆면으로 든다.
 * 같은 높이면 오른쪽(왼쪽) 변에서 나가 맞은 변으로 든다.
 */
export function beamBetween(id: string, from: Box, to: Box, back: boolean, lit: boolean): Line {
  const a = centerOf(from);
  const c = centerOf(to);
  if (to.y >= from.y + from.h + 8) {
    const toRight = c.x >= a.x;
    const start: Point = { x: a.x, y: from.y + from.h };
    const end: Point = { x: toRight ? to.x : to.x + to.w, y: c.y };
    const c1: Point = { x: start.x, y: start.y + (end.y - start.y) * 0.8 };
    const c2: Point = {
      x: end.x - (toRight ? 1 : -1) * Math.max(24, Math.abs(end.x - start.x) * 0.55),
      y: end.y,
    };
    return {
      kind: "beam",
      id,
      d: curve(start, c1, c2, end),
      mid: bezierMid(start, c1, c2, end),
      end,
      endAngle: toRight ? 0 : 180,
      start,
      startAngle: 270,
      back,
      lit,
    };
  }
  const forward = c.x >= a.x;
  const start: Point = { x: forward ? from.x + from.w : from.x, y: a.y };
  const end: Point = { x: forward ? to.x : to.x + to.w, y: c.y };
  const dx = Math.max(40, Math.abs(end.x - start.x) * 0.5);
  const s = forward ? 1 : -1;
  const c1: Point = { x: start.x + s * dx, y: start.y };
  const c2: Point = { x: end.x - s * dx, y: end.y };
  const mid: Point = {
    x: 0.125 * start.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * end.x,
    y: 0.125 * start.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * end.y,
  };
  return {
    kind: "beam",
    id,
    d: `M${round(start.x)} ${round(start.y)} C${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(end.x)} ${round(end.y)}`,
    mid,
    end,
    endAngle: forward ? 0 : 180,
    start,
    startAngle: forward ? 180 : 0,
    back,
    lit,
  };
}

function ghostKey(input: LayoutInput): string | null {
  if (input.ghost === null) return null;
  const plugin = input.catalog.get(input.ghost);
  return plugin === undefined ? null : anchorKey(plugin.anchor);
}

function boundsOf(nodes: readonly LayoutNode[], width: number, height: number): Box {
  let minX = -40;
  let minY = -40;
  let maxX = width + 40;
  let maxY = height + 40;
  for (const node of nodes) {
    minX = Math.min(minX, node.box.x);
    minY = Math.min(minY, node.box.y);
    maxX = Math.max(maxX, node.box.x + node.box.w);
    maxY = Math.max(maxY, node.box.y + node.box.h);
  }
  // 경계 이름(마름모 옆 글)이 들 자리
  return { x: minX - 24, y: minY - 24, w: maxX - minX + 48, h: maxY - minY + 64 };
}
