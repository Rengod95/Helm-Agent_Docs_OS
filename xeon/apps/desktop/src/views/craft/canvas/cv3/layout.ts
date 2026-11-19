// cv3 배치: 코어 루프는 가로 레일(바닥 층), 플러그인 판은 그 위에 뜬 층이다. 위치가 곧 뜻이라 자유 배치가 아니다.
// 레일 위 = 재료(Inject는 컨텍스트 조립, 도구는 도구 실행), 레일 아래 = Hook(블록 앞·뒤, 경계), 맨 위 줄 = Drive와 Drive가 든 묶음.
// 판은 붙는 자리 바로 위·아래에 세로 더미로 서고(같은 자리에서는 호출 순서대로), 더미가 겹치지 않게 레일이 늘어난다.
import {
  BLOCKS,
  BUILDER,
  laneOf,
  placedOf,
  relationsOf,
  type Anchor,
  type BlockId,
  type BoundaryId,
  type CanvasProfile,
  type Kind,
  type Lane,
  type Placed,
  type Relation,
  type RelationKind,
} from "./model.ts";

/** 판 한 장: 네 종류가 같은 크기다. 높이는 가까이에서 이름·종류·하는 일 두 줄이 꼭 차는 만큼(빈 위아래 여백이 없게) */
const PLATE_W = 240;
const PLATE_H = 108;
const STACK_GAP = 16;
const COL_GAP = 20;
/** 한 더미의 판 수: 붙은 수의 제곱근쯤(둘 이상). 넘치면 옆에 새 더미를 세운다. 낮고 넓게 두어 맞춤 보기가 읽을 만한 배율이 되게 */
function wrapOf(count: number): number {
  return Math.max(2, Math.ceil(Math.sqrt(count * 0.8)));
}
/** Drive 줄이 레일 끝을 넘으면 그 위에 새 줄을 둔다 */
const DRIVE_ROW_GAP = 40;
const PED_PAD = 12;
const PED_HEAD = 40;
/** 접힌 묶음(판 더미): 뒤 판 두 장이 비켜 선다 */
export const PILE_OFFSET = 7;
export const RAIL_HALF = 24;
/** 레일에서 판까지. 판이 바닥 띠 밖(띠 가장자리 바로 위·아래)에 뜨게 띠보다 조금 크다 */
const LANE_GAP = 96;
const DRIVE_GAP = 76;
/** 바닥 띠(한 단계 밝은 무대)의 반 높이 */
export const BAND_HALF = 112;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface PlateGeo extends Rect {
  readonly placed: Placed;
  /** 같은 더미 안에서 몇째인가(번호 표시) */
  readonly stackIndex: number;
  readonly lane: Lane;
  /** 묶음 받침판 안에 있나 */
  readonly inBundle: string | null;
}

export interface BundleGeo extends Rect {
  readonly id: string;
  readonly members: readonly string[];
  readonly kinds: readonly Kind[];
  readonly lane: Lane;
  readonly collapsed: boolean;
}

interface WireGeo {
  readonly id: string;
  /** 판·묶음 쪽 끝 */
  readonly x1: number;
  readonly y1: number;
  /** 레일 쪽 끝 */
  readonly x2: number;
  readonly y2: number;
  readonly kind: Kind;
  /** 접힌 묶음에서 합쳐진 수(1이면 표시하지 않는다) */
  readonly count: number;
  readonly owners: readonly string[];
}

interface StationGeo {
  readonly id: BlockId;
  readonly x0: number;
  readonly x1: number;
}

interface BoundaryGeo {
  readonly id: BoundaryId;
  readonly x: number;
}

interface TickGeo {
  readonly anchor: Anchor;
  readonly x: number;
  /** 위(재료)인가 아래(Hook)인가 */
  readonly side: "top" | "bottom";
  readonly used: boolean;
}

interface RelationGeo {
  readonly relation: Relation;
  readonly d: string;
  /** 말을 붙이는 곳 */
  readonly lx: number;
  readonly ly: number;
  /** 층을 넘는 선(대체)인가 */
  readonly cross: boolean;
}

export interface ProfileLayout {
  readonly plates: readonly PlateGeo[];
  readonly bundles: readonly BundleGeo[];
  readonly wires: readonly WireGeo[];
  readonly stations: readonly StationGeo[];
  readonly boundaries: readonly BoundaryGeo[];
  readonly ticks: readonly TickGeo[];
  readonly relations: readonly RelationGeo[];
  /** 빌더(프로필 밖, 바닥에 놓인 윤곽) */
  readonly builder: Rect | null;
  /** 레일의 왼끝과 오른끝(루프 되돌이 선) */
  readonly railX0: number;
  readonly railX1: number;
  readonly bounds: Rect;
}

/** 레일 위 자리의 순서. 블록마다 앞·가운데(재료)·뒤 */
type Stop =
  | { readonly type: "boundary"; readonly id: BoundaryId }
  | { readonly type: "before" | "center" | "after"; readonly block: BlockId };

const STOPS: readonly Stop[] = [
  { type: "boundary", id: "conversation-start" },
  { type: "boundary", id: "input-received" },
  ...BLOCKS.flatMap((block): Stop[] => [
    { type: "before", block },
    { type: "center", block },
    { type: "after", block },
  ]),
  { type: "boundary", id: "before-turn-end" },
];

function stopAnchors(s: Stop): readonly Anchor[] {
  if (s.type === "boundary") return [`boundary:${s.id}`];
  if (s.type === "before") return [`before:${s.block}`];
  if (s.type === "after") return [`after:${s.block}`];
  if (s.block === "context") return ["feed:context"];
  if (s.block === "tools") return ["feed:tools"];
  return [];
}

/** 이웃한 두 자리 사이의 최소 거리 */
function minStep(a: Stop, b: Stop): number {
  if (a.type === "boundary" && b.type === "boundary") return 104;
  if (a.type === "boundary" || b.type === "boundary") return 86;
  if (a.type === "after" && b.type === "before") return 62;
  return 58;
}

/** 묶음이 설 줄: Drive가 들었으면 Drive 줄, 아니면 구성원이 많은 쪽 */
function bundleLane(members: readonly Placed[]): Lane {
  if (members.some((m) => m.plugin.kind === "drive")) return "drive";
  const feed = members.filter((m) => laneOf(m.plugin.anchor) === "feed").length;
  return feed * 2 > members.length ? "feed" : "hook";
}

/** 받침판: 구성원 판이 매니페스트 순서대로 왼쪽에서 오른쪽으로 나란히 선다 */
function pedestalSize(count: number): { w: number; h: number } {
  return {
    w: PED_PAD * 2 + count * PLATE_W + (count - 1) * COL_GAP,
    h: PED_HEAD + PLATE_H + PED_PAD,
  };
}

const PILE_W = PLATE_W + PILE_OFFSET * 2;
/** 접힌 더미의 윗판은 판보다 조금 높다(묶음 이름 + 구성원 줄) */
const PILE_H = PLATE_H + 36 + PILE_OFFSET * 2;

/** 한 자리에 서는 것: 판 하나, 또는 묶음 하나(펼친 받침판이나 접힌 더미) */
type Item =
  | { readonly type: "plate"; readonly placed: Placed }
  | { readonly type: "bundle"; readonly id: string; readonly members: readonly Placed[] };

function itemSize(item: Item, collapsed: ReadonlySet<string>): { w: number; h: number } {
  if (item.type === "plate") return { w: PLATE_W, h: PLATE_H };
  if (collapsed.has(item.id)) return { w: PILE_W, h: PILE_H };
  return pedestalSize(item.members.length);
}

/** 더미(세로로 쌓인 것)들. 한 더미에 wrapOf(판 수)까지, 넘치면 옆 더미로 */
function columnsOf(items: readonly Item[]): Item[][] {
  const wrap = wrapOf(items.length);
  const cols: Item[][] = [];
  for (const it of items) {
    const last = cols[cols.length - 1];
    if (
      it.type === "bundle" ||
      last === undefined ||
      last.length >= wrap ||
      last[0]?.type === "bundle"
    )
      cols.push([it]);
    else last.push(it);
  }
  return cols;
}

function colWidth(col: readonly Item[], collapsed: ReadonlySet<string>): number {
  return Math.max(...col.map((it) => itemSize(it, collapsed).w));
}

function colHeight(col: readonly Item[], collapsed: ReadonlySet<string>): number {
  return col.reduce((s, it, i) => s + itemSize(it, collapsed).h + (i > 0 ? STACK_GAP : 0), 0);
}

function widthOf(cols: readonly (readonly Item[])[], collapsed: ReadonlySet<string>): number {
  if (cols.length === 0) return 0;
  return cols.reduce((s, c, i) => s + colWidth(c, collapsed) + (i > 0 ? COL_GAP : 0), 0);
}

export function layoutProfile(
  profile: CanvasProfile,
  collapsed: ReadonlySet<string>,
): ProfileLayout {
  const placed = placedOf(profile);
  const membersOf = (id: string): Placed[] =>
    placed.filter((p) => p.source.type === "bundle" && p.source.id === id);

  // 자리마다 위(재료)·아래(Hook) 항목. 묶음은 첫 구성원의 자리(그 줄)에 선다
  const above = new Map<Anchor, Item[]>();
  const below = new Map<Anchor, Item[]>();
  const driveItems: Item[] = [];
  const push = (m: Map<Anchor, Item[]>, a: Anchor, it: Item): void => {
    const list = m.get(a) ?? [];
    list.push(it);
    m.set(a, list);
  };
  const bundleDone = new Set<string>();
  for (const p of placed) {
    if (p.source.type === "bundle") {
      const id = p.source.id;
      if (bundleDone.has(id)) continue;
      bundleDone.add(id);
      const members = membersOf(id);
      const lane = bundleLane(members);
      const item: Item = { type: "bundle", id, members };
      if (lane === "drive") driveItems.push(item);
      else {
        const first = members.find((m) => laneOf(m.plugin.anchor) === lane) ?? members[0];
        if (first !== undefined) push(lane === "feed" ? above : below, first.plugin.anchor, item);
      }
      continue;
    }
    const lane = laneOf(p.plugin.anchor);
    const item: Item = { type: "plate", placed: p };
    if (lane === "drive") driveItems.push(item);
    else push(lane === "feed" ? above : below, p.plugin.anchor, item);
  }
  // Drive 줄의 묶음 구성원이 레일로 내려가는 선은 재료 줄을 지난다: 그 자리를 비워 둔다
  const passing = new Set<Anchor>();
  for (const it of driveItems) {
    if (it.type !== "bundle") continue;
    for (const m of it.members) if (m.plugin.anchor !== "drive") passing.add(m.plugin.anchor);
  }

  // ── 레일: 왼쪽부터 자리를 놓는다 ──
  const anchorX = new Map<Anchor, number>();
  const aboveCols = new Map<Anchor, Item[][]>();
  const belowCols = new Map<Anchor, Item[][]>();
  const stopX: number[] = [];
  let aboveRight = Number.NEGATIVE_INFINITY;
  let belowRight = Number.NEGATIVE_INFINITY;
  let prevX = 0;
  STOPS.forEach((s, i) => {
    const anchors = stopAnchors(s);
    const aCols: Item[][] = [];
    const bCols: Item[][] = [];
    let passWidth = 0;
    for (const a of anchors) {
      aCols.push(...columnsOf(above.get(a) ?? []));
      bCols.push(...columnsOf(below.get(a) ?? []));
      if (passing.has(a)) passWidth = 28;
    }
    const aw = Math.max(widthOf(aCols, collapsed), passWidth);
    const bw = widthOf(bCols, collapsed);
    const prev = STOPS[i - 1];
    let x = prev === undefined ? 0 : prevX + minStep(prev, s);
    if (aw > 0) x = Math.max(x, aboveRight + aw / 2);
    if (bw > 0) x = Math.max(x, belowRight + bw / 2);
    if (aw > 0) aboveRight = x + aw / 2 + COL_GAP;
    if (bw > 0) belowRight = x + bw / 2 + COL_GAP;
    stopX.push(x);
    prevX = x;
    for (const a of anchors) {
      anchorX.set(a, x);
      aboveCols.set(a, columnsOf(above.get(a) ?? []));
      belowCols.set(a, columnsOf(below.get(a) ?? []));
    }
  });

  const stations: StationGeo[] = [];
  const boundaries: BoundaryGeo[] = [];
  const ticks: TickGeo[] = [];
  STOPS.forEach((s, i) => {
    const x = stopX[i] ?? 0;
    if (s.type === "boundary") boundaries.push({ id: s.id, x });
    if (s.type === "before") {
      const after = STOPS.findIndex((t) => t.type === "after" && t.block === s.block);
      stations.push({ id: s.block, x0: x - 22, x1: (stopX[after] ?? x) + 22 });
    }
  });
  for (const block of BLOCKS) {
    for (const side of ["before", "after"] as const) {
      const a: Anchor = `${side}:${block}`;
      const x = anchorX.get(a) ?? 0;
      ticks.push({ anchor: a, x, side: "bottom", used: (below.get(a) ?? []).length > 0 });
    }
  }
  for (const a of ["feed:context", "feed:tools"] as const) {
    ticks.push({
      anchor: a,
      x: anchorX.get(a) ?? 0,
      side: "top",
      used: (above.get(a) ?? []).length > 0,
    });
  }

  // ── 판 놓기 ──
  const plates: PlateGeo[] = [];
  const bundles: BundleGeo[] = [];
  const wires: WireGeo[] = [];
  const feedBottom = -RAIL_HALF - LANE_GAP;
  const hookTop = RAIL_HALF + LANE_GAP;
  let feedTop = feedBottom;

  const placeItem = (
    it: Item,
    x: number,
    y: number,
    lane: Lane,
    stackIndex: number,
  ): { w: number; h: number } => {
    const size = itemSize(it, collapsed);
    if (it.type === "plate") {
      plates.push({ ...size, x, y, placed: it.placed, stackIndex, lane, inBundle: null });
      return size;
    }
    const isCollapsed = collapsed.has(it.id);
    bundles.push({
      ...size,
      x,
      y,
      id: it.id,
      members: it.members.map((m) => m.plugin.name),
      kinds: [...new Set(it.members.map((m) => m.plugin.kind))],
      lane,
      collapsed: isCollapsed,
    });
    if (!isCollapsed) {
      it.members.forEach((m, k) => {
        plates.push({
          x: x + PED_PAD + k * (PLATE_W + COL_GAP),
          y: y + PED_HEAD,
          w: PLATE_W,
          h: PLATE_H,
          placed: m,
          stackIndex: k,
          lane,
          inBundle: it.id,
        });
      });
    }
    return size;
  };

  /** 묶음의 선: 펼치면 구성원마다, 접으면 자리마다 하나(합친 수) */
  const bundleWires = (b: BundleGeo, members: readonly Placed[], fromTop: boolean): void => {
    const anchored = members.filter((m) => m.plugin.anchor !== "drive");
    const ey = fromTop ? b.y : b.y + b.h;
    if (b.collapsed) {
      const byAnchor = new Map<Anchor, Placed[]>();
      for (const m of anchored)
        byAnchor.set(m.plugin.anchor, [...(byAnchor.get(m.plugin.anchor) ?? []), m]);
      [...byAnchor].forEach(([a, ms], k) => {
        const first = ms[0];
        if (first === undefined) return;
        const off = (k - (byAnchor.size - 1) / 2) * 26;
        wires.push({
          id: `bundle:${b.id}:${a}`,
          x1: b.x + b.w / 2 + off,
          y1: ey,
          x2: anchorX.get(a) ?? 0,
          y2: railY(a, fromTop),
          kind: first.plugin.kind,
          count: ms.length,
          owners: ms.map((m) => m.plugin.name),
        });
      });
      return;
    }
    for (const m of anchored) {
      const plate = plates.find((p) => p.placed.plugin.name === m.plugin.name);
      if (plate === undefined) continue;
      // 받침판 안의 판에서 바로 나와 받침판 가장자리를 지나 레일로 간다
      wires.push({
        id: `plate:${m.plugin.name}`,
        x1: plate.x + plate.w / 2,
        y1: fromTop ? plate.y : plate.y + plate.h,
        x2: anchorX.get(m.plugin.anchor) ?? 0,
        y2: railY(m.plugin.anchor, fromTop),
        kind: m.plugin.kind,
        count: 1,
        owners: [m.plugin.name],
      });
    }
  };

  for (const [a, cols] of aboveCols) {
    if (cols.length === 0) continue;
    const cx = anchorX.get(a) ?? 0;
    let x = cx - widthOf(cols, collapsed) / 2;
    for (const col of cols) {
      const cw = colWidth(col, collapsed);
      const ch = colHeight(col, collapsed);
      let y = feedBottom - ch;
      feedTop = Math.min(feedTop, y);
      col.forEach((it, k) => {
        const size = placeItem(it, x + (cw - itemSize(it, collapsed).w) / 2, y, "feed", k);
        y += size.h + STACK_GAP;
      });
      const last = col[col.length - 1];
      if (last?.type === "plate")
        wires.push({
          id: `col:${a}:${String(x)}`,
          x1: x + cw / 2,
          y1: feedBottom - ch,
          x2: cx,
          y2: -RAIL_HALF,
          kind: last.placed.plugin.kind,
          count: 1,
          owners: col.flatMap((it) => (it.type === "plate" ? [it.placed.plugin.name] : [])),
        });
      x += cw + COL_GAP;
    }
  }
  for (const [a, cols] of belowCols) {
    if (cols.length === 0) continue;
    const cx = anchorX.get(a) ?? 0;
    let x = cx - widthOf(cols, collapsed) / 2;
    for (const col of cols) {
      const cw = colWidth(col, collapsed);
      const ch = colHeight(col, collapsed);
      let y = hookTop;
      col.forEach((it, k) => {
        const size = placeItem(it, x + (cw - itemSize(it, collapsed).w) / 2, y, "hook", k);
        y += size.h + STACK_GAP;
      });
      const first = col[0];
      if (first?.type === "plate")
        wires.push({
          id: `col:${a}:${String(x)}`,
          x1: x + cw / 2,
          y1: hookTop + ch,
          x2: cx,
          y2: RAIL_HALF,
          kind: first.placed.plugin.kind,
          count: 1,
          owners: col.flatMap((it) => (it.type === "plate" ? [it.placed.plugin.name] : [])),
        });
      x += cw + COL_GAP;
    }
  }

  // ── Drive 줄: 스타트 Drive가 입력 받기 위에, 핸드오프 사슬 순서로 오른쪽에 ──
  const driveBottom = feedTop - DRIVE_GAP;
  const startName = profile.startDrive;
  const nameOf = (it: Item): readonly string[] =>
    it.type === "plate" ? [it.placed.plugin.name] : it.members.map((m) => m.plugin.name);
  const ordered: Item[] = [];
  const visit = (name: string): void => {
    const it = driveItems.find((d) => nameOf(d).includes(name));
    if (it === undefined || ordered.includes(it)) return;
    ordered.push(it);
    for (const member of nameOf(it)) {
      const p = placed.find((q) => q.plugin.name === member);
      for (const to of p?.plugin.shared.handoffTo ?? []) visit(to);
    }
  };
  if (startName !== null) visit(startName);
  for (const it of driveItems) {
    const first = nameOf(it)[0];
    if (first !== undefined) visit(first);
  }
  const rowStart = (anchorX.get("boundary:input-received") ?? 0) - PLATE_W / 2;
  const rowEnd = (stopX[stopX.length - 1] ?? 0) + 80;
  let cursor = rowStart;
  let rowBottom = driveBottom;
  let rowHeight = 0;
  for (const it of ordered) {
    const size = itemSize(it, collapsed);
    let x = cursor;
    if (it.type === "bundle") {
      const xs = it.members.flatMap((m) =>
        m.plugin.anchor === "drive" ? [] : [anchorX.get(m.plugin.anchor) ?? 0],
      );
      if (xs.length > 0)
        x = Math.max(cursor, xs.reduce((s, v) => s + v, 0) / xs.length - size.w / 2);
    }
    // 레일 끝을 넘으면 위에 새 줄(핸드오프 사슬 순서는 그대로 왼쪽에서)
    if (x + size.w > rowEnd && cursor > rowStart) {
      rowBottom -= rowHeight + DRIVE_ROW_GAP;
      rowHeight = 0;
      x = rowStart;
    }
    placeItem(it, x, rowBottom - size.h, "drive", 0);
    rowHeight = Math.max(rowHeight, size.h);
    cursor = x + size.w + COL_GAP + 36;
  }
  // 스타트 Drive는 입력 받기 경계로 내려간다(턴을 쥔다)
  const startPlate = plates.find((p) => p.placed.start);
  if (startPlate !== undefined) {
    wires.push({
      id: "start",
      x1: startPlate.x + startPlate.w / 2,
      y1: startPlate.y + startPlate.h,
      x2: anchorX.get("boundary:input-received") ?? 0,
      y2: -RAIL_HALF,
      kind: "drive",
      count: 1,
      owners: [startPlate.placed.plugin.name],
    });
  }
  for (const b of bundles) {
    bundleWires(b, membersOf(b.id), b.lane === "hook");
  }

  // ── 관계 선 ──
  const rectOf = (name: string): Rect | null => {
    const plate = plates.find((p) => p.placed.plugin.name === name);
    if (plate !== undefined) return plate;
    return bundles.find((b) => b.collapsed && b.members.includes(name)) ?? null;
  };
  const relations = relationsOf(profile);
  let builder: Rect | null = null;
  const created = relations.find((r) => r.kind === "creates");
  if (created !== undefined) {
    const target = rectOf(created.to);
    if (target !== null)
      builder = { x: target.x + target.w + 56, y: target.y + 26, w: 236, h: 104 };
  }
  const relGeo: RelationGeo[] = [];
  const pairCount = new Map<string, number>();
  // 핸드오프가 먼저 곧은 자리를 갖고, 같은 쌍의 다른 관계는 둘레로 돈다
  const routed = relations.toSorted(
    (a, b) => Number(b.kind === "handoff") - Number(a.kind === "handoff"),
  );
  const laneAt = (name: string): Lane =>
    plates.find((p) => p.placed.plugin.name === name)?.lane ??
    bundles.find((b) => b.members.includes(name))?.lane ??
    "drive";
  for (const r of routed) {
    const from = r.from === BUILDER ? builder : rectOf(r.from);
    if (from === null) continue;
    if (r.kind === "replaces") {
      const tools = stations.find((s) => s.id === "tools");
      if (tools === undefined) continue;
      const tx = (tools.x0 + tools.x1) / 2 + 30;
      const sx = from.x + from.w / 2 + 40;
      const sy = from.y + from.h;
      const ty = -RAIL_HALF;
      relGeo.push({
        relation: r,
        d: `M${n(sx)} ${n(sy)} C${n(sx)} ${n((sy + ty) / 2)} ${n(tx)} ${n((sy + ty) / 2)} ${n(tx)} ${n(ty)}`,
        lx: tx,
        ly: ty - 22,
        cross: true,
      });
      continue;
    }
    const to = rectOf(r.to);
    if (to === null || to === from) continue;
    const key = [r.from, r.to].toSorted().join("|");
    const k = pairCount.get(key) ?? 0;
    pairCount.set(key, k + 1);
    relGeo.push({
      relation: r,
      ...route(from, to, k, laneAt(r.to) === "feed" ? "above" : "below"),
      cross: false,
    });
  }

  // ── 경계 ──
  const xs: number[] = [];
  const ys: number[] = [];
  for (const r of [...plates, ...bundles]) {
    xs.push(r.x, r.x + r.w);
    ys.push(r.y, r.y + r.h);
  }
  if (builder !== null) {
    xs.push(builder.x, builder.x + builder.w);
    ys.push(builder.y, builder.y + builder.h);
  }
  const railX0 = (stopX[0] ?? 0) - 40;
  const railX1 = (stopX[stopX.length - 1] ?? 0) + 40;
  xs.push(railX0 - 40, railX1 + 40);
  ys.push(-BAND_HALF + 40, BAND_HALF - 40);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return {
    plates,
    bundles,
    wires,
    stations,
    boundaries,
    ticks,
    relations: relGeo,
    builder,
    railX0,
    railX1,
    bounds: { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 },
  };
}

function railY(a: Anchor, fromBelow: boolean): number {
  if (laneOf(a) === "feed") return -RAIL_HALF;
  return fromBelow ? RAIL_HALF : -RAIL_HALF;
}

function n(v: number): string {
  return String(Math.round(v * 10) / 10);
}

/**
 * 같은 층 안의 관계 선: 직선과 직각으로만 간다(레일로 내려가는 곡선과 헷갈리지 않게).
 * 가로로 떨어져 있으면 마주 보는 옆면끼리, 세로로 떨어져 있으면 위아래 면끼리 잇는다. 같은 쌍의 둘째 선은 비켜 선다
 */
function route(
  a: Rect,
  b: Rect,
  k: number,
  side: "above" | "below",
): { d: string; lx: number; ly: number } {
  const off = k * 16;
  const acx = a.x + a.w / 2;
  const bcx = b.x + b.w / 2;
  const acy = a.y + a.h / 2;
  const bcy = b.y + b.h / 2;
  const gapX = b.x > a.x + a.w ? b.x - (a.x + a.w) : a.x > b.x + b.w ? a.x - (b.x + b.w) : -1;
  // 같은 줄의 이웃: 둘째 관계이거나 사이가 좁으면 판 사이를 지나지 않고 줄 둘레(괄호 모양)로 돈다
  if (gapX >= 0 && (k > 0 || gapX < 140)) {
    const sx = acx + (bcx > acx ? 40 : -40);
    const tx = bcx + (bcx > acx ? -40 : 40);
    const lane =
      side === "above"
        ? Math.min(a.y, b.y) - 30 - k * 30
        : Math.max(a.y + a.h, b.y + b.h) + 30 + k * 30;
    const sy = side === "above" ? a.y : a.y + a.h;
    const ty = side === "above" ? b.y : b.y + b.h;
    return {
      d: `M${n(sx)} ${n(sy)} L${n(sx)} ${n(lane)} L${n(tx)} ${n(lane)} L${n(tx)} ${n(ty)}`,
      lx: (sx + tx) / 2,
      ly: lane,
    };
  }
  if (gapX >= 0) {
    const right = bcx > acx;
    const sx = right ? a.x + a.w : a.x;
    const tx = right ? b.x : b.x + b.w;
    const sy = acy - 18 + off;
    const ty = bcy - 18 + off;
    if (Math.abs(sy - ty) < 2)
      return { d: `M${n(sx)} ${n(sy)} L${n(tx)} ${n(ty)}`, lx: (sx + tx) / 2, ly: sy - 10 };
    const mx = (sx + tx) / 2;
    return {
      d: `M${n(sx)} ${n(sy)} L${n(mx)} ${n(sy)} L${n(mx)} ${n(ty)} L${n(tx)} ${n(ty)}`,
      lx: mx,
      ly: Math.min(sy, ty) - 10,
    };
  }
  const down = bcy > acy;
  const sx = acx + 54 + off;
  const tx = bcx + 54 + off;
  const sy = down ? a.y + a.h : a.y;
  const ty = down ? b.y : b.y + b.h;
  if (Math.abs(sx - tx) < 2)
    return { d: `M${n(sx)} ${n(sy)} L${n(tx)} ${n(ty)}`, lx: sx + 8, ly: (sy + ty) / 2 };
  const my = (sy + ty) / 2;
  return {
    d: `M${n(sx)} ${n(sy)} L${n(sx)} ${n(my)} L${n(tx)} ${n(my)} L${n(tx)} ${n(ty)}`,
    lx: (sx + tx) / 2,
    ly: my - 8,
  };
}

/** 관계 종류마다 선의 문법(그리는 쪽과 범례가 같이 쓴다) */
export const RELATION_DASH: Readonly<Record<RelationKind, string>> = {
  handoff: "",
  depends: "6 4",
  reads: "1.5 4",
  creates: "10 4 2 4",
  replaces: "3 3",
};
