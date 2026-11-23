// cv6 배치: 코어 루프는 가로 레일(바닥 층), 플러그인 판은 그 위에 뜬 층이다. 위치가 곧 뜻이라 자유 배치가 아니다.
// 레일 위 = 재료(Inject는 컨텍스트 조립, 도구는 도구 실행), 레일 아래 = Hook(블록 앞·뒤, 경계), 맨 위 줄 = Drive와 Drive가 든 묶음.
// 루프에 붙는 문법(넷째 판): 루프 블록의 변에는 쓰이는 자리마다 소켓이 하나씩 있고, 소켓에서는 줄기 하나만 나간다.
//   한 자리에 판이 한 더미면 줄기가 더미를 꿰고(판마다 레일 쪽 변의 패드에 호출 순서 번호), 더미가 여럿이면 줄기가 짧은 버스로
//   갈라져 더미마다 내려간다. 그래서 한 점에 선 수십 개가 달리지 않고, 순서는 번호와 꿰인 차례로 읽힌다.
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
  type Plugin,
  type Relation,
} from "./model.ts";
import { t } from "@fresnel/client/i18n";
import { descriptionTextOf, purposeTextOf } from "../shared-meta.ts";
import { descriptionOf } from "./sample-ext.ts";
import { NEAR_METRICS, type StepMetrics } from "./lod.ts";

/**
 * 판 한 장: 네 종류가 같은 크기다. 참고 그림의 카드(317 × 308, 안쪽 글 다섯 줄)를 실제 px로 옮긴 값이고, 안쪽 글을 네 줄까지 둔다.
 * 가까이(100%)에서 사방 12 안에 머리 20 + 12 + 설명 두 줄 40 + 11 + 안쪽 면(8 + 꼬리표 18 + 5 + 글 네 줄 80 + 8) 119
 * + 11 + 알약 24 + 12 + 푸터 16이 꼭 찬다: 12 + 20 + 12 + 40 + 11 + 119 + 11 + 24 + 12 + 16 + 12 = 289.
 * 책갈피(탭)는 이 상자 바깥, 윗변 위에 솟는다
 */
const PLATE_W = 316;
export const PLATE_H: number = NEAR_METRICS.full;

/**
 * 적은 판: 목적도 설명도 없는 플러그인(필수가 되기 전에 설치된 것). 목적 줄을 그리지 않고 안쪽 면에는 붙는 자리 꼬리표와
 * "설명이 없어요" 경고 한 줄(구슬)만 둔다 [결정: 2026-11-23 사용자, AGE-31].
 * 가까이에서 12 + 머리 20 + 10 + 안쪽 면(8 + 꼬리표 18 + 5 + 경고 20 + 8) 59 + 11 + 알약 24 + 12 + 푸터 16 + 12 = 196
 */
export const PLATE_LEAN_H: number = NEAR_METRICS.lean;

/** 목적이 비었나. 표본은 목적이 카탈로그 키라 늘 있다 */
export function purposeMissing(p: Plugin): boolean {
  return purposeTextOf(p.meta) === null;
}

/** 판 안쪽 면의 글(설명): 내장은 카탈로그, 엔진 카드는 카드 `description`, 표본은 `sample-ext.ts`의 글. 없으면 null */
export function cardDescription(p: Plugin): string | null {
  const own = descriptionTextOf(p.meta);
  if (own !== null) return own;
  const sample = descriptionOf(p.name);
  return sample === null ? null : t(sample);
}

/**
 * 판 높이: 배치 눈금 칸(`lod.ts`의 metricsOf)이 정한다. 가까이에서는 목적도 설명도 없으면 적은 판, 아니면 PLATE_H.
 * 중간에서는 목적이 없으면 목적 줄만큼, 설명이 없으면 안쪽 면 두 줄만큼 준다. 멀리는 모두 같다.
 * 묶음(받침판) 안의 판은 줄을 맞추려고 늘 그 칸의 온전한 높이다
 */
export function plateHeightOf(p: Plugin, m: StepMetrics = NEAR_METRICS): number {
  const noPurpose = purposeMissing(p);
  const noDescription = cardDescription(p) === null;
  if (noPurpose && noDescription) return m.lean;
  return m.full - (noPurpose ? m.noPurpose : 0) - (noDescription ? m.noDescription : 0);
}
/** 탭이 카드 윗변 위로 솟는 높이의 상한(멀리 단계). 판 위에 늘 이만큼 비워 둔다 */
export const TAB_ROOM = 36;
// 더미 안 판 사이(위 판의 순서 번호와 아래 판의 탭이 함께 들어갈 만큼)와 옆 더미 사이는 배치 눈금 칸(`StepMetrics`)의
// stackGap, colGap이다: 화면에서 세로 32, 가로 24로 고르다(100%에서 52, 24)
/** 한 더미의 판 수: 붙은 수의 제곱근쯤(둘 이상). 넘치면 옆에 새 더미를 세운다. 낮고 넓게 두어 맞춤 보기가 읽을 만한 배율이 되게 */
function wrapOf(count: number): number {
  return Math.max(2, Math.ceil(Math.sqrt(count * 0.8)));
}
/** Drive 줄이 레일 끝을 넘으면 그 위에 새 줄을 둔다 */
const DRIVE_ROW_GAP = 40;
/** Drive 줄의 판 사이(핸드오프 선이 곧게 지나는 자리) */
const DRIVE_GAP = 72;
const PED_PAD = 12;
/** 받침판 머리: 묶음 이름 줄 + 구성원 판의 탭 자리 */
const PED_HEAD = 36 + TAB_ROOM;
/** 접힌 묶음(판 더미): 뒤 판 두 장이 비켜 선다 */
export const PILE_OFFSET = 7;
/** 레일 블록의 반 높이 */
export const RAIL_HALF = 24;
/** 레일 블록의 변에서 판까지. Hook 줄의 탭이 가장 높이 솟아도(멀리 단계 36) 버스(32)와 12가 남는다. 처음 여는 배율(50%)에서 루프가 1920×1080에 다 들게 96에서 줄였다 */
const LANE_GAP = 80;
/** 버스가 서는 곳: 블록의 변에서 이만큼 바깥(판과 변의 가운데쯤) */
const BUS_OFF = 32;
/** 재료 줄 맨 위(탭 끝)에서 Drive 줄 바닥까지(같은 까닭으로 112에서 96으로) */
const DRIVE_LIFT = 60 + TAB_ROOM;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface PlateGeo extends Rect {
  readonly placed: Placed;
  /** 같은 더미 안에서 몇째인가 */
  readonly stackIndex: number;
  readonly lane: Lane;
  /** 묶음 받침판 안에 있나 */
  readonly inBundle: string | null;
  /** 레일 쪽 변. 패드(순서 번호)와 종류 색 테가 이 변에 선다. Hook 줄은 위, 나머지는 아래 */
  readonly lip: "top" | "bottom";
  /** 핸드오프를 내보내나(오른쪽 변 패드) */
  readonly handoffOut: boolean;
  /** 핸드오프를 받는 변: 왼쪽(같은 줄에서 곧게), 아래(사이에 다른 판이 있어 밑으로 돌아 들어옴), 받지 않음 */
  readonly handoffIn: "left" | "bottom" | null;
}

export interface BundleGeo extends Rect {
  readonly id: string;
  readonly members: readonly string[];
  readonly kinds: readonly Kind[];
  readonly lane: Lane;
  readonly collapsed: boolean;
}

/** 판·묶음에서 레일로 가는 선 한 가닥: 직각으로 꺾이고 모서리만 둥글다(관계 선과 달리 실선, 종류 색, 끝에 화살표 없음) */
interface WireGeo {
  readonly id: string;
  readonly d: string;
  readonly kind: Kind;
  readonly owners: readonly string[];
  /** 버스(여러 더미로 갈라지는 가로 선)인가 */
  readonly bus: boolean;
  /** 이 선이 들어가는 소켓(`자리|변`). 고른 판의 선이면 소켓의 화살촉도 함께 밝힌다 */
  readonly socket: string;
}

/** 루프 블록 변의 소켓: 쓰이는 자리마다 하나. 줄기 하나가 여기서 나간다 */
interface SocketGeo {
  readonly anchor: Anchor;
  readonly x: number;
  readonly side: "top" | "bottom";
  readonly kind: Kind;
  /** 이 자리에 붙은 판 수(2 이상이면 줄기에 수가 붙는다) */
  readonly count: number;
  /** 수를 붙일 곳(줄기 가운데) */
  readonly cy: number;
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

/** 쓰이지 않는 자리의 작은 눈금(붙을 수 있는 곳) */
interface TickGeo {
  readonly anchor: Anchor;
  readonly x: number;
  readonly side: "top" | "bottom";
}

interface RelationGeo {
  readonly relation: Relation;
  readonly d: string;
  /** 말을 붙이는 곳 */
  readonly lx: number;
  readonly ly: number;
  /** 층을 넘는 선(대체)인가 */
  readonly cross: boolean;
  /** 말을 붙이지 않는다(곧게 이어진 핸드오프: 선의 색과 패드가 뜻을 말한다) */
  readonly quiet: boolean;
}

export interface ProfileLayout {
  readonly plates: readonly PlateGeo[];
  readonly bundles: readonly BundleGeo[];
  readonly wires: readonly WireGeo[];
  readonly sockets: readonly SocketGeo[];
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

/** 블록 칸이 자기 앞·뒤 자리에서 바깥으로 나간 폭 */
const STATION_EAR = 26;

/**
 * 이웃한 두 자리 사이의 최소 거리. 블록과 블록 사이는 칸 사이가 56 이상 비게(셋째 판은 14까지 좁아졌다),
 * 블록 안(앞 → 가운데 → 뒤)은 이름이 들어갈 만큼
 */
function minStep(a: Stop, b: Stop): number {
  if (a.type === "boundary" && b.type === "boundary") return 112;
  if (a.type === "boundary" || b.type === "boundary") return 104;
  if (a.type === "after" && b.type === "before") return STATION_EAR * 2 + 56;
  return 64;
}

/** 묶음이 설 줄: Drive가 들었으면 Drive 줄, 아니면 구성원이 많은 쪽 */
function bundleLane(members: readonly Placed[]): Lane {
  if (members.some((m) => m.plugin.kind === "drive")) return "drive";
  const feed = members.filter((m) => laneOf(m.plugin.anchor) === "feed").length;
  return feed * 2 > members.length ? "feed" : "hook";
}

/** 받침판: 구성원 판이 매니페스트 순서대로 왼쪽에서 오른쪽으로 나란히 선다. 높이는 그 칸의 온전한 판을 따른다 */
function pedestalSize(count: number, m: StepMetrics): { w: number; h: number } {
  return {
    w: PED_PAD * 2 + count * PLATE_W + (count - 1) * m.colGap,
    h: PED_HEAD + m.full + PED_PAD,
  };
}

const PILE_W = PLATE_W + PILE_OFFSET * 2;
/** 접힌 더미의 윗판은 판보다 조금 높다(묶음 이름 + 구성원 줄) */
const PILE_H = PLATE_H + 40 + PILE_OFFSET * 2;

/** 한 자리에 서는 것: 판 하나, 또는 묶음 하나(펼친 받침판이나 접힌 더미) */
type Item =
  | { readonly type: "plate"; readonly placed: Placed }
  | { readonly type: "bundle"; readonly id: string; readonly members: readonly Placed[] };

/** 한 배치의 공통 값: 접힌 묶음과 배치 눈금 칸 */
interface Sizing {
  readonly collapsed: ReadonlySet<string>;
  readonly m: StepMetrics;
}

function itemSize(item: Item, z: Sizing): { w: number; h: number } {
  if (item.type === "plate") return { w: PLATE_W, h: plateHeightOf(item.placed.plugin, z.m) };
  if (z.collapsed.has(item.id)) return { w: PILE_W, h: PILE_H };
  return pedestalSize(item.members.length, z.m);
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

function colWidth(col: readonly Item[], z: Sizing): number {
  return Math.max(...col.map((it) => itemSize(it, z).w));
}

function colHeight(col: readonly Item[], z: Sizing): number {
  return col.reduce((s, it, i) => s + itemSize(it, z).h + (i > 0 ? z.m.stackGap : 0), 0);
}

function widthOf(cols: readonly (readonly Item[])[], z: Sizing): number {
  if (cols.length === 0) return 0;
  return cols.reduce((s, c, i) => s + colWidth(c, z) + (i > 0 ? z.m.colGap : 0), 0);
}

/**
 * 프로필의 배치. `metrics`는 배치 눈금 칸의 판 높이와 판 사이다(기본은 가까이). 캔버스는 배율이 칸을 넘을 때 이것을 바꾸고,
 * 두 칸 사이를 옮겨 가는 동안에는 `mixMetrics`로 섞은 값을 넘긴다(배치가 값에 이어져 있어 판과 선이 부드럽게 움직인다)
 */
export function layoutProfile(
  profile: CanvasProfile,
  collapsed: ReadonlySet<string>,
  metrics: StepMetrics = NEAR_METRICS,
): ProfileLayout {
  const z: Sizing = { collapsed, m: metrics };
  const colGap = metrics.colGap;
  const stackGap = metrics.stackGap;
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
    // 스타트 Drive의 선이 입력 받기로 곧게 내려가는 자리를 재료 줄에 비워 둔다
    if (s.type === "boundary" && s.id === "input-received" && profile.startDrive !== null)
      passWidth = 28;
    const aw = Math.max(widthOf(aCols, z), passWidth);
    const bw = widthOf(bCols, z);
    const prev = STOPS[i - 1];
    let x = prev === undefined ? 0 : prevX + minStep(prev, s);
    if (aw > 0) x = Math.max(x, aboveRight + aw / 2);
    if (bw > 0) x = Math.max(x, belowRight + bw / 2);
    if (aw > 0) aboveRight = x + aw / 2 + colGap;
    if (bw > 0) belowRight = x + bw / 2 + colGap;
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
  STOPS.forEach((s, i) => {
    const x = stopX[i] ?? 0;
    if (s.type === "boundary") boundaries.push({ id: s.id, x });
    if (s.type === "before") {
      const after = STOPS.findIndex((o) => o.type === "after" && o.block === s.block);
      stations.push({ id: s.block, x0: x - STATION_EAR, x1: (stopX[after] ?? x) + STATION_EAR });
    }
  });

  // ── 판 놓기 ──
  /** 핸드오프가 들어오는 변은 모든 판이 놓인 뒤에 정해진다(그 사이만 고쳐 쓴다) */
  const plates: (Omit<PlateGeo, "handoffIn"> & { handoffIn: PlateGeo["handoffIn"] })[] = [];
  const bundles: BundleGeo[] = [];
  const wires: WireGeo[] = [];
  /** 소켓: (자리, 변)마다 하나. 붙은 판 수를 센다 */
  const sockets = new Map<string, SocketGeo>();
  const addSocket = (a: Anchor, side: "top" | "bottom", kind: Kind, count: number): void => {
    const key = `${a}|${side}`;
    const prev = sockets.get(key);
    const cy = side === "top" ? -RAIL_HALF - BUS_OFF / 2 : RAIL_HALF + BUS_OFF / 2;
    sockets.set(key, {
      anchor: a,
      x: anchorX.get(a) ?? 0,
      side,
      kind: prev?.kind ?? kind,
      count: (prev?.count ?? 0) + count,
      cy,
    });
  };
  const feedBottom = -RAIL_HALF - LANE_GAP;
  const hookTop = RAIL_HALF + LANE_GAP;
  let feedTop = feedBottom;
  const handoffs = relationsOf(profile).filter((r) => r.kind === "handoff");

  const placeItem = (
    it: Item,
    x: number,
    y: number,
    lane: Lane,
    stackIndex: number,
  ): { w: number; h: number } => {
    const size = itemSize(it, z);
    const plateOf = (
      m: Placed,
      px: number,
      py: number,
      k: number,
      inBundle: string | null,
    ): PlateGeo => ({
      x: px,
      y: py,
      w: PLATE_W,
      h: inBundle === null ? plateHeightOf(m.plugin, metrics) : metrics.full,
      placed: m,
      stackIndex: k,
      lane,
      inBundle,
      lip: lipOf(lane),
      handoffOut: handoffs.some((r) => r.from === m.plugin.name),
      handoffIn: null,
    });
    if (it.type === "plate") {
      plates.push(plateOf(it.placed, x, y, stackIndex, null));
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
        plates.push(plateOf(m, x + PED_PAD + k * (PLATE_W + colGap), y + PED_HEAD, k, it.id));
      });
    }
    return size;
  };

  /**
   * 한 자리의 더미들을 레일에 잇는다. 소켓에서 줄기가 나가고, 더미가 하나면 줄기가 그대로 더미를 꿰며,
   * 여럿이면 버스(가로 선)로 갈라져 더미마다 내려가 꿴다. `side`는 블록의 어느 변인가
   */
  const wireColumns = (
    a: Anchor,
    cols: readonly { readonly cx: number; readonly plates: readonly PlateGeo[] }[],
    side: "top" | "bottom",
  ): void => {
    const all = cols.flatMap((c) => c.plates);
    const first = all[0];
    if (first === undefined) return;
    const kind = first.placed.plugin.kind;
    const owners = all.map((p) => p.placed.plugin.name);
    const sign = side === "top" ? -1 : 1;
    const edge = sign * RAIL_HALF;
    const busY = sign * (RAIL_HALF + BUS_OFF);
    const ax = anchorX.get(a) ?? 0;
    addSocket(a, side, kind, all.length);
    /** 더미의 먼 쪽 끝(마지막 판의 레일 쪽 변). 줄기는 그 앞 판들 뒤를 지나 거기까지 꿴다 */
    const far = (ps: readonly PlateGeo[]): number => {
      const p = ps[ps.length - 1];
      if (p === undefined) return busY;
      return side === "top" ? p.y + p.h : p.y;
    };
    const one = cols.length === 1 ? cols[0] : undefined;
    if (one !== undefined && Math.abs(one.cx - ax) < 1) {
      wires.push({
        id: `trunk:${a}:${side}`,
        d: `M${n(ax)} ${n(edge)} V${n(far(one.plates))}`,
        kind,
        owners,
        bus: false,
        socket: `${a}|${side}`,
      });
      return;
    }
    wires.push({
      id: `trunk:${a}:${side}`,
      d: `M${n(ax)} ${n(edge)} V${n(busY)}`,
      kind,
      owners,
      bus: false,
      socket: `${a}|${side}`,
    });
    const xs = [ax, ...cols.map((c) => c.cx)];
    wires.push({
      id: `bus:${a}:${side}`,
      d: `M${n(Math.min(...xs))} ${n(busY)} H${n(Math.max(...xs))}`,
      kind,
      owners,
      bus: true,
      socket: `${a}|${side}`,
    });
    for (const c of cols) {
      wires.push({
        id: `drop:${a}:${side}:${n(c.cx)}`,
        d: `M${n(c.cx)} ${n(busY)} V${n(far(c.plates))}`,
        kind,
        owners: c.plates.map((p) => p.placed.plugin.name),
        bus: false,
        socket: `${a}|${side}`,
      });
    }
  };

  /** 받침판 안의 구성원(묶음): 판마다 레일 쪽 변에서 나와 직각으로 소켓에 닿는다 */
  const memberWire = (plate: PlateGeo, a: Anchor, fromTop: boolean, count: number): void => {
    const side = laneOf(a) === "feed" || !fromTop ? "top" : "bottom";
    const sign = side === "top" ? -1 : 1;
    const ax = anchorX.get(a) ?? 0;
    const busY = sign * (RAIL_HALF + BUS_OFF);
    const sx = plate.x + plate.w / 2;
    const sy = side === "top" ? plate.y + plate.h : plate.y;
    addSocket(a, side, plate.placed.plugin.kind, count);
    wires.push({
      id: `member:${plate.placed.plugin.name}`,
      d: elbow(sx, sy, ax, busY, sign * RAIL_HALF),
      kind: plate.placed.plugin.kind,
      owners: [plate.placed.plugin.name],
      bus: false,
      socket: `${a}|${side}`,
    });
  };

  for (const [a, cols] of aboveCols) {
    if (cols.length === 0) continue;
    const cx = anchorX.get(a) ?? 0;
    let x = cx - widthOf(cols, z) / 2;
    const plateCols: { cx: number; plates: PlateGeo[] }[] = [];
    for (const col of cols) {
      const cw = colWidth(col, z);
      const ch = colHeight(col, z);
      // 재료 줄은 레일에서 위로 쌓는다: 첫 판(호출 순서 1)이 레일에 가깝다
      let y = feedBottom;
      feedTop = Math.min(feedTop, feedBottom - ch);
      const mine: PlateGeo[] = [];
      col.forEach((it, k) => {
        const size = itemSize(it, z);
        y -= size.h;
        placeItem(it, x + (cw - size.w) / 2, y, "feed", k);
        const last = plates[plates.length - 1];
        if (it.type === "plate" && last !== undefined) mine.push(last);
        y -= stackGap;
      });
      if (mine.length > 0) plateCols.push({ cx: x + cw / 2, plates: mine });
      x += cw + colGap;
    }
    wireColumns(a, plateCols, "top");
  }
  for (const [a, cols] of belowCols) {
    if (cols.length === 0) continue;
    const cx = anchorX.get(a) ?? 0;
    let x = cx - widthOf(cols, z) / 2;
    const plateCols: { cx: number; plates: PlateGeo[] }[] = [];
    for (const col of cols) {
      const cw = colWidth(col, z);
      let y = hookTop;
      const mine: PlateGeo[] = [];
      col.forEach((it, k) => {
        const size = placeItem(it, x + (cw - itemSize(it, z).w) / 2, y, "hook", k);
        const last = plates[plates.length - 1];
        if (it.type === "plate" && last !== undefined) mine.push(last);
        y += size.h + stackGap;
      });
      if (mine.length > 0) plateCols.push({ cx: x + cw / 2, plates: mine });
      x += cw + colGap;
    }
    wireColumns(a, plateCols, "bottom");
  }

  // ── Drive 줄: 스타트 Drive가 입력 받기 위에, 핸드오프 사슬 순서로 오른쪽에 ──
  const driveBottom = feedTop - DRIVE_LIFT;
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
    const size = itemSize(it, z);
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
    cursor = x + size.w + DRIVE_GAP;
  }
  // 스타트 Drive는 입력 받기 경계로 내려간다(턴을 쥔다)
  const startPlate = plates.find((p) => p.placed.start);
  const inputX = anchorX.get("boundary:input-received") ?? 0;
  if (startPlate !== undefined) {
    wires.push({
      id: "start",
      d: elbow(
        startPlate.x + startPlate.w / 2,
        startPlate.y + startPlate.h,
        inputX,
        feedBottom + 20,
        -RAIL_HALF,
      ),
      kind: "drive",
      owners: [startPlate.placed.plugin.name],
      bus: false,
      socket: "boundary:input-received|top",
    });
    addSocket("boundary:input-received", "top", "drive", 1);
  }
  // 묶음의 구성원: 펼치면 판마다, 접으면 자리마다 하나(더미 가운데에서)
  for (const b of bundles) {
    const members = membersOf(b.id).filter((m) => m.plugin.anchor !== "drive");
    const fromTop = b.lane === "hook";
    if (b.collapsed) {
      const byAnchor = new Map<Anchor, Placed[]>();
      for (const m of members)
        byAnchor.set(m.plugin.anchor, [...(byAnchor.get(m.plugin.anchor) ?? []), m]);
      [...byAnchor].forEach(([a, ms], k) => {
        const first = ms[0];
        if (first === undefined) return;
        const off = (k - (byAnchor.size - 1) / 2) * 26;
        const side = laneOf(a) === "feed" || !fromTop ? "top" : "bottom";
        const sign = side === "top" ? -1 : 1;
        addSocket(a, side, first.plugin.kind, ms.length);
        wires.push({
          id: `bundle:${b.id}:${a}`,
          d: elbow(
            b.x + b.w / 2 + off,
            fromTop ? b.y : b.y + b.h,
            anchorX.get(a) ?? 0,
            sign * (RAIL_HALF + BUS_OFF),
            sign * RAIL_HALF,
          ),
          kind: first.plugin.kind,
          owners: ms.map((m) => m.plugin.name),
          bus: false,
          socket: `${a}|${side}`,
        });
      });
      continue;
    }
    for (const m of members) {
      const plate = plates.find((p) => p.placed.plugin.name === m.plugin.name);
      if (plate !== undefined) memberWire(plate, m.plugin.anchor, fromTop, 1);
    }
  }

  // 쓰이지 않는 자리는 작은 눈금으로 남긴다(붙을 수 있는 곳)
  const ticks: TickGeo[] = [];
  for (const block of BLOCKS) {
    for (const side of ["before", "after"] as const) {
      const a: Anchor = `${side}:${block}`;
      if (!sockets.has(`${a}|bottom`))
        ticks.push({ anchor: a, x: anchorX.get(a) ?? 0, side: "bottom" });
    }
  }
  for (const a of ["feed:context", "feed:tools"] as const) {
    if (!sockets.has(`${a}|top`)) ticks.push({ anchor: a, x: anchorX.get(a) ?? 0, side: "top" });
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
      builder = clearOf({ x: target.x + target.w + 56, y: target.y + 26, w: 236, h: 104 }, [
        ...plates,
        ...bundles,
      ]);
  }
  const relGeo: RelationGeo[] = [];
  const pairCount = new Map<string, number>();
  /** 핸드오프를 받는 판마다 들어오는 변 */
  const inSide = new Map<string, "left" | "bottom">();
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
        quiet: false,
      });
      continue;
    }
    const to = rectOf(r.to);
    if (to === null || to === from) continue;
    const key = [r.from, r.to].toSorted().join("|");
    const k = pairCount.get(key) ?? 0;
    pairCount.set(key, k + 1);
    if (r.kind === "handoff") {
      const others = [...plates, ...bundles.filter((x) => x.collapsed)].filter(
        (o) => o !== from && o !== to,
      );
      const h = handoffRoute(from, to, others);
      inSide.set(r.to, h.enter);
      relGeo.push({ relation: r, d: h.d, lx: h.lx, ly: h.ly, quiet: h.quiet, cross: false });
      continue;
    }
    relGeo.push({
      relation: r,
      ...route(from, to, k, laneAt(r.to) === "feed" ? "above" : "below"),
      cross: false,
      quiet: false,
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
  ys.push(-RAIL_HALF - 40, RAIL_HALF + 72);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  for (const p of plates) p.handoffIn = inSide.get(p.placed.plugin.name) ?? null;
  return {
    plates,
    bundles,
    wires,
    sockets: [...sockets.values()],
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

/** 빌더 윤곽이 판·묶음과 겹치면 겹친 것의 아래로 내린다(아래로만 움직이므로 끝난다) */
function clearOf(r: Rect, others: readonly Rect[]): Rect {
  let y = r.y;
  for (;;) {
    const hit = others.find(
      (o) => r.x < o.x + o.w && o.x < r.x + r.w && y < o.y + o.h + 24 && o.y - 24 < y + r.h,
    );
    if (hit === undefined) return { ...r, y };
    y = hit.y + hit.h + 24;
  }
}

/** 판의 레일 쪽 변: Hook 줄(레일 아래)은 위, 나머지(레일 위)는 아래 */
function lipOf(l: Lane): PlateGeo["lip"] {
  return l === "hook" ? "top" : "bottom";
}

function n(v: number): string {
  return String(Math.round(v * 10) / 10);
}

/** 꺾이는 모서리의 반지름(참고 그림의 선: 10) */
const BEND = 10;

/** 꺾은선(가로·세로 마디)의 모서리를 반지름 BEND로 둥글게 */
function rounded(points: readonly (readonly [number, number])[]): string {
  const first = points[0];
  if (first === undefined) return "";
  const out = [`M${n(first[0])} ${n(first[1])}`];
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p === undefined) continue;
    const prev = points[i - 1] ?? p;
    const next = points[i + 1];
    if (next === undefined) {
      out.push(`L${n(p[0])} ${n(p[1])}`);
      continue;
    }
    const inLen = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    const outLen = Math.hypot(next[0] - p[0], next[1] - p[1]);
    const r = Math.min(BEND, inLen / 2, outLen / 2);
    if (r < 0.5 || inLen === 0 || outLen === 0) {
      out.push(`L${n(p[0])} ${n(p[1])}`);
      continue;
    }
    const ax = p[0] - ((p[0] - prev[0]) / inLen) * r;
    const ay = p[1] - ((p[1] - prev[1]) / inLen) * r;
    const bx = p[0] + ((next[0] - p[0]) / outLen) * r;
    const by = p[1] + ((next[1] - p[1]) / outLen) * r;
    out.push(`L${n(ax)} ${n(ay)}`, `Q${n(p[0])} ${n(p[1])} ${n(bx)} ${n(by)}`);
  }
  return out.join(" ");
}

/**
 * 판에서 소켓까지 직각 선 하나: 세로로 `midY`까지, 가로로 소켓의 x까지, 다시 세로로 블록 변(`edgeY`)까지. 모서리는 둥글다
 */
function elbow(sx: number, sy: number, tx: number, midY: number, edgeY: number): string {
  if (Math.abs(sx - tx) < 1) return `M${n(sx)} ${n(sy)} V${n(edgeY)}`;
  const dirX = tx > sx ? 1 : -1;
  const r = Math.min(BEND, Math.abs(tx - sx) / 2, Math.abs(midY - sy) / 2 || BEND);
  const v1 = midY > sy ? 1 : -1;
  const v2 = edgeY > midY ? 1 : -1;
  return [
    `M${n(sx)} ${n(sy)}`,
    `V${n(midY - v1 * r)}`,
    `Q${n(sx)} ${n(midY)} ${n(sx + dirX * r)} ${n(midY)}`,
    `H${n(tx - dirX * r)}`,
    `Q${n(tx)} ${n(midY)} ${n(tx)} ${n(midY + v2 * r)}`,
    `V${n(edgeY)}`,
  ].join(" ");
}

/**
 * 핸드오프: 보내는 Drive의 오른쪽 변 패드(판 높이의 가운데)에서 나간다. 같은 줄에서 사이에 다른 판이 없으면 받는 Drive의 왼쪽 변 패드로
 * 곧게 들어간다. 사이에 다른 판이 있으면(묶음 안의 둘째 구성원 등) 그 판 뒤로 지나 가지 않고, 판들 밑으로 돌아 받는 판의 아래 변 패드로
 * 들어간다(앞 판이 넘겨주는 것처럼 읽히지 않게). 짧은 선에는 말을 붙이지 않는다(보라 실선과 양 끝 패드가 핸드오프다)
 */
function handoffRoute(
  a: Rect,
  b: Rect,
  others: readonly Rect[],
): { d: string; lx: number; ly: number; quiet: boolean; enter: "left" | "bottom" } {
  const sy = a.y + a.h / 2;
  const ty = b.y + b.h / 2;
  const sx = a.x + a.w;
  const tx = b.x;
  const lo = Math.min(sy, ty);
  const hi = Math.max(sy, ty);
  const blocked = others.filter(
    (o) => o.x < tx && o.x + o.w > sx && o.y < hi + 4 && o.y + o.h > lo - 4,
  );
  const first = blocked.toSorted((p, q) => p.x - q.x)[0];
  if (first !== undefined && tx > sx) {
    // 밑으로 돌기: 막는 판 앞에서 내려가, 막는 판들과 받는 판의 아래보다 22 밑을 지나, 받는 판 아래 변 가운데로 올라간다
    const turnX = first.x - 22;
    const under = Math.max(b.y + b.h, ...blocked.map((o) => o.y + o.h)) + 22;
    const bx = b.x + b.w / 2;
    const r = BEND;
    return {
      d: [
        `M${n(sx)} ${n(sy)}`,
        `H${n(turnX - r)}`,
        `Q${n(turnX)} ${n(sy)} ${n(turnX)} ${n(sy + r)}`,
        `V${n(under - r)}`,
        `Q${n(turnX)} ${n(under)} ${n(turnX + r)} ${n(under)}`,
        `H${n(bx - r)}`,
        `Q${n(bx)} ${n(under)} ${n(bx)} ${n(under - r)}`,
        `V${n(b.y + b.h)}`,
      ].join(" "),
      lx: (sx + turnX) / 2,
      ly: sy - 12,
      quiet: turnX - sx < 160,
      enter: "bottom",
    };
  }
  if (Math.abs(sy - ty) < 2)
    return {
      d: `M${n(sx)} ${n(sy)} H${n(tx)}`,
      lx: (sx + tx) / 2,
      ly: sy - 12,
      quiet: tx - sx < 160,
      enter: "left",
    };
  const mx = (sx + tx) / 2;
  const r = Math.min(BEND, Math.abs(ty - sy) / 2, Math.abs(tx - sx) / 2);
  const dx = tx > sx ? 1 : -1;
  const dy = ty > sy ? 1 : -1;
  return {
    d: [
      `M${n(sx)} ${n(sy)}`,
      `H${n(mx - dx * r)}`,
      `Q${n(mx)} ${n(sy)} ${n(mx)} ${n(sy + dy * r)}`,
      `V${n(ty - dy * r)}`,
      `Q${n(mx)} ${n(ty)} ${n(mx + dx * r)} ${n(ty)}`,
      `H${n(tx)}`,
    ].join(" "),
    lx: (sx + mx) / 2,
    ly: sy - 12,
    quiet: mx - sx < 120,
    enter: "left",
  };
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
      d: rounded([
        [sx, sy],
        [sx, lane],
        [tx, lane],
        [tx, ty],
      ]),
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
      d: rounded([
        [sx, sy],
        [mx, sy],
        [mx, ty],
        [tx, ty],
      ]),
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
    d: rounded([
      [sx, sy],
      [sx, my],
      [tx, my],
      [tx, ty],
    ]),
    lx: (sx + tx) / 2,
    ly: my - 8,
  };
}

// ── 배율 칸이 바뀔 때 제자리에 남기기(cvZoom, AGE-31) ─────────────────

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * 판 높이가 바뀌는 동안 화면에 붙들어 둘 자리: 포인터(또는 화면 가운데)에서 가장 가까운 판과, 그 판에 대한 점의 자리.
 * 가로는 판 왼쪽 변에서의 거리(너비는 바뀌지 않는다). 세로는 판 안이면 높이에 대한 비율, 위나 아래면 가까운 변에서의 거리다
 */
export interface Hold {
  readonly name: string;
  readonly dx: number;
  readonly y:
    | { readonly at: "in"; readonly f: number }
    | { readonly at: "top" | "bottom"; readonly d: number };
}

/** 점(배치 좌표)에서 가장 가까운 판으로 붙들 자리를 만든다. 판이 없으면 null */
export function holdAt(layout: ProfileLayout, p: Point): Hold | null {
  let best: PlateGeo | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const r of layout.plates) {
    const ox = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
    const oy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
    const d = Math.hypot(ox, oy);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  if (best === null) return null;
  const dx = p.x - best.x;
  if (p.y < best.y) return { name: best.placed.plugin.name, dx, y: { at: "top", d: p.y - best.y } };
  if (p.y > best.y + best.h)
    return { name: best.placed.plugin.name, dx, y: { at: "bottom", d: p.y - (best.y + best.h) } };
  const f = best.h > 0 ? (p.y - best.y) / best.h : 0;
  return { name: best.placed.plugin.name, dx, y: { at: "in", f } };
}

/** 붙든 자리가 이 배치에서 어디인가. 그 판이 없으면 null */
export function holdPoint(layout: ProfileLayout, h: Hold): Point | null {
  const r = layout.plates.find((p) => p.placed.plugin.name === h.name);
  if (r === undefined) return null;
  const x = r.x + h.dx;
  const at = h.y;
  if (at.at === "in") return { x, y: r.y + at.f * r.h };
  return { x, y: (at.at === "top" ? r.y : r.y + r.h) + at.d };
}
