// cvF 배치(도면). 코어 턴이 가로 레일로 흐르고, 붙는 방식이 곧 자리다:
//   레일 위(기준선 A) = 블록에 들어가는 재료(Inject는 컨텍스트 조립, 도구는 도구 실행),
//   레일 아래(기준선 B) = Hook(블록 앞·뒤와 턴 종료 직전의 마름모 자리),
//   맨 아래(기준선 C) = Drive와 묶음 구역.
// 한 자리에 여럿이면 레일에서 바깥으로 줄을 쌓고, 많으면 칸을 늘린다. 레일의 블록 사이 간격은 매단 것의 폭만큼 벌어진다.
// 묶음은 구역 하나에 구성원을 모으고, 구성원이 붙는 자리에는 참조 표(A1 같은 부품 번호)를 남겨 순서를 지킨다(긴 선이 없다).
// 값은 모두 흐름 좌표(px)이고 순수 계산이다.
import {
  FEED_SPOTS,
  HOOK_SPOTS,
  groupIn,
  spotOrder,
  type Catalog,
  type Profile,
  type SpotKey,
} from "./model.ts";

export const CARD_W = 228;
export const CARD_H = 124;
const REF_H = 30;
const COL_GAP = 16;
const ROW_GAP = 14;
export const BLOCK_W = 124;
export const BLOCK_H = 36;
/** 기준선 A(재료 카드의 아랫선)와 B(Hook 카드의 윗선) */
const FEED_BASE = -64;
const HOOK_BASE = 64;
const FEED_BUS = -42;
const HOOK_BUS = 42;
/** 다음 입력으로 돌아가는 선 */
export const RETURN_Y = 20;
const STACK_SEP = 44;
const ZONE_PAD = 14;
export const ZONE_HEAD = 36;
const BAND_GAP = 76;
const BAND_SEP = 76;
/** 접힌 묶음 뒤로 겹친 카드 두 장의 어긋남 */
export const STACK_OFFSET = 6;

type BlockId = "context" | "model" | "tools" | "ask" | "agents" | "record";
type BoundaryId = "conversation-start" | "input-received" | "before-turn-end";
export type StopId = BlockId | BoundaryId;

interface StopDef {
  readonly id: StopId;
  readonly type: "block" | "boundary";
}

const STOPS: readonly StopDef[] = [
  { id: "conversation-start", type: "boundary" },
  { id: "input-received", type: "boundary" },
  { id: "context", type: "block" },
  { id: "model", type: "block" },
  { id: "tools", type: "block" },
  { id: "ask", type: "block" },
  { id: "agents", type: "block" },
  { id: "before-turn-end", type: "boundary" },
  { id: "record", type: "block" },
];

/** 자리마다 레일 위 어디에 붙나: 정거장 하나(at) 또는 두 정거장 사이(between) */
const SPOT_ANCHOR: Readonly<Record<Exclude<SpotKey, "drive">, readonly [number, number]>> = {
  "feed:context": [2, 2],
  "feed:tools": [4, 4],
  "before:model": [2, 3],
  "before:tools": [3, 4],
  "after:tools": [4, 5],
  "boundary:before-turn-end": [7, 7],
};

interface StopGeo {
  readonly id: StopId;
  readonly type: "block" | "boundary";
  readonly x: number;
  /** 블록 번호(01~06) */
  readonly n: number | null;
}

type StackItem =
  | { readonly type: "card"; readonly name: string }
  /** 묶음 구역에 있는 구성원의 참조 표 */
  | { readonly type: "ref"; readonly name: string; readonly zone: string; readonly mark: string }
  /** `replaces`로 바뀐 내장 도구 */
  | { readonly type: "builtin"; readonly tool: string; readonly by: string };

export interface ItemGeo {
  readonly item: StackItem;
  readonly spot: SpotKey;
  /** 그 자리의 호출 순서(1부터) */
  readonly order: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface ZoneGeo {
  readonly id: string;
  readonly letter: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly collapsed: boolean;
  readonly members: readonly string[];
}

interface CardGeo {
  readonly name: string;
  readonly spot: SpotKey;
  readonly order: number;
  readonly x: number;
  readonly y: number;
  /** 구역 안이면 구역 id */
  readonly zone: string | null;
  /** 구역 안이면 그 구역의 부품 번호(A1…) */
  readonly mark: string | null;
}

interface PointGeo {
  readonly spot: SpotKey;
  readonly x: number;
  readonly filled: boolean;
}

export interface Layout {
  readonly stops: readonly StopGeo[];
  readonly points: readonly PointGeo[];
  readonly cards: readonly CardGeo[];
  /** 쌓인 줄 안의 참조 표와 내장 도구 표 */
  readonly marks: readonly ItemGeo[];
  readonly zones: readonly ZoneGeo[];
  /** 레일에 붙는 선(장면이 그린다) */
  readonly wires: readonly string[];
  /** 스타트 Drive가 턴을 쥐는 선 */
  readonly startWire: string | null;
  readonly datums: { readonly feed: number; readonly hook: number; readonly drive: number };
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
}

/** 쌓인 줄의 열 수. 화면은 가로가 모자라고 세로가 남으므로 셋까지는 한 열로 쌓는다 */
function colsFor(n: number): number {
  if (n <= 3) return 1;
  if (n <= 8) return 2;
  if (n <= 15) return 3;
  return 4;
}

interface Stack {
  readonly spot: SpotKey;
  readonly items: readonly StackItem[];
  readonly cols: number;
  readonly w: number;
  readonly rows: readonly number[];
  readonly h: number;
}

function itemH(item: StackItem): number {
  return item.type === "card" ? CARD_H : REF_H;
}

function stackOf(spot: SpotKey, items: readonly StackItem[]): Stack {
  const cols = colsFor(items.length);
  const rows: number[] = [];
  for (let r = 0; r * cols < items.length; r++) {
    rows.push(Math.max(...items.slice(r * cols, r * cols + cols).map(itemH)));
  }
  const w = items.length === 0 ? 0 : cols * CARD_W + (cols - 1) * COL_GAP;
  const h = rows.reduce((a, b) => a + b, 0) + Math.max(0, rows.length - 1) * ROW_GAP;
  return { spot, items, cols, w, rows, h };
}

function minGap(a: StopDef, b: StopDef): number {
  if (a.type === "boundary" && b.type === "boundary") return 84;
  if (a.type === "block" && b.type === "block") return BLOCK_W + 26;
  return BLOCK_W / 2 + 44;
}

const LETTERS = "ABCDEFGH";

/** 묶음 구역의 글자(A, B…). 설치된 묶음의 순서를 따르므로 넣고 빼도 바뀌지 않는다 */
export function zoneLetter(profile: Profile, id: string): string {
  return LETTERS[profile.groups.findIndex((g) => g.id === id)] ?? "Z";
}

export function layoutProfile(
  profile: Profile,
  catalog: Catalog,
  collapsed: ReadonlySet<string>,
): Layout {
  // 구역(프로필에 든 묶음)과 구성원의 부품 번호
  const groups = profile.groups.filter((g) => groupIn(profile, g));
  const zoneOf = new Map<string, { readonly id: string; readonly mark: string }>();
  groups.forEach((g) => {
    const letter = zoneLetter(profile, g.id);
    g.members.forEach((m, mi) => {
      zoneOf.set(m, { id: g.id, mark: `${letter}${String(mi + 1)}` });
    });
  });

  // 자리마다 쌓을 것
  const stacks = new Map<SpotKey, Stack>();
  for (const spot of [...FEED_SPOTS, ...HOOK_SPOTS]) {
    const items: StackItem[] = spotOrder(profile, catalog, spot).map((name) => {
      const z = zoneOf.get(name);
      return z === undefined
        ? { type: "card", name }
        : { type: "ref", name, zone: z.id, mark: z.mark };
    });
    if (spot === "feed:tools") {
      for (const name of [...profile.base, ...profile.plugins]) {
        for (const tool of catalog.get(name)?.ext.replaces ?? [])
          items.push({ type: "builtin", tool, by: name });
      }
    }
    stacks.set(spot, stackOf(spot, items));
  }
  const widthAt = (spot: SpotKey): number => stacks.get(spot)?.w ?? 0;

  // 레일: 왼쪽부터 정거장을 놓으며 매단 것끼리 겹치지 않게 벌린다
  const xs: number[] = [0];
  let lastFeed: { readonly x: number; readonly w: number } | null = null;
  let lastHook: { readonly x: number; readonly w: number } | null = null;
  const anchorX = (spot: Exclude<SpotKey, "drive">): number => {
    const [a, b] = SPOT_ANCHOR[spot];
    return ((xs[a] ?? 0) + (xs[b] ?? 0)) / 2;
  };
  for (let i = 1; i < STOPS.length; i++) {
    const prev = STOPS[i - 1];
    const cur = STOPS[i];
    if (prev === undefined || cur === undefined) continue;
    const xPrev = xs[i - 1] ?? 0;
    let x = xPrev + minGap(prev, cur);
    for (const spot of FEED_SPOTS) {
      if (spot === "drive") continue;
      const [a] = SPOT_ANCHOR[spot];
      const w = widthAt(spot);
      if (a !== i || w === 0) continue;
      if (lastFeed !== null) x = Math.max(x, lastFeed.x + (lastFeed.w + w) / 2 + STACK_SEP);
    }
    for (const spot of HOOK_SPOTS) {
      if (spot === "drive") continue;
      const [a, b] = SPOT_ANCHOR[spot];
      const w = widthAt(spot);
      if (b !== i || w === 0 || lastHook === null) continue;
      const need = lastHook.x + (lastHook.w + w) / 2 + STACK_SEP;
      x = a === b ? Math.max(x, need) : Math.max(x, 2 * need - xPrev);
    }
    xs.push(x);
    for (const spot of FEED_SPOTS) {
      if (spot === "drive") continue;
      const w = widthAt(spot);
      if (SPOT_ANCHOR[spot][0] === i && w > 0) lastFeed = { x: anchorX(spot), w };
    }
    for (const spot of HOOK_SPOTS) {
      if (spot === "drive") continue;
      const w = widthAt(spot);
      if (SPOT_ANCHOR[spot][1] === i && w > 0) lastHook = { x: anchorX(spot), w };
    }
  }
  let blockN = 0;
  const stops: StopGeo[] = STOPS.map((s, i) => ({
    id: s.id,
    type: s.type,
    x: xs[i] ?? 0,
    n: s.type === "block" ? ++blockN : null,
  }));
  const stopX = (id: StopId): number => stops.find((s) => s.id === id)?.x ?? 0;

  // 쌓인 줄의 자리와 선
  const cards: CardGeo[] = [];
  const marks: ItemGeo[] = [];
  const wires: string[] = [];
  const points: PointGeo[] = [];
  let hookBand = 0;
  let feedBand = 0;
  for (const [spot, st] of stacks) {
    if (spot === "drive") continue;
    const ax = anchorX(spot);
    const feed = spot.startsWith("feed:");
    // 턴 끝 경계는 원으로 이미 그려지므로 마름모를 겹치지 않는다
    if (!feed && spot !== "boundary:before-turn-end")
      points.push({ spot, x: ax, filled: st.items.length > 0 });
    if (st.items.length === 0) continue;
    if (feed) feedBand = Math.max(feedBand, st.h);
    else hookBand = Math.max(hookBand, st.h);
    const left = ax - st.w / 2;
    const colX = (c: number): number => left + c * (CARD_W + COL_GAP);
    // 줄마다 레일에서 바깥으로
    let edge = feed ? FEED_BASE : HOOK_BASE;
    const farY: number[] = [];
    st.rows.forEach((rowH, r) => {
      st.items.slice(r * st.cols, r * st.cols + st.cols).forEach((item, c) => {
        const h = itemH(item);
        const y = feed ? edge - h : edge;
        const order = r * st.cols + c + 1;
        farY[c] = y + h / 2;
        if (item.type === "card") {
          cards.push({ name: item.name, spot, order, x: colX(c), y, zone: null, mark: null });
        } else {
          marks.push({ item, spot, order, x: colX(c), y, w: CARD_W, h });
        }
      });
      edge = feed ? edge - rowH - ROW_GAP : edge + rowH + ROW_GAP;
    });
    // 정거장 → 버스 → 칸마다 등뼈(카드 사이 틈에서만 보인다)
    const railEdge = feed ? -BLOCK_H / 2 : 0;
    const bus = feed ? FEED_BUS : HOOK_BUS;
    const c0 = colX(0) + CARD_W / 2;
    const c1 = colX(Math.min(st.cols, st.items.length) - 1) + CARD_W / 2;
    wires.push(`M${String(ax)} ${String(railEdge)}V${String(bus)}`);
    if (Math.min(c0, ax) !== Math.max(c1, ax))
      wires.push(`M${String(Math.min(c0, ax))} ${String(bus)}H${String(Math.max(c1, ax))}`);
    farY.forEach((fy, c) => {
      const cx = colX(c) + CARD_W / 2;
      wires.push(`M${String(cx)} ${String(bus)}V${String(fy)}`);
    });
  }

  // 기준선 C: Drive와 묶음 구역
  const driveY = HOOK_BASE + (hookBand === 0 ? 24 : hookBand) + BAND_GAP;
  const zones: ZoneGeo[] = [];
  const inputX = stopX("input-received");
  let cursor = Number.NEGATIVE_INFINITY;
  let startWire: string | null = null;
  const loose = spotOrder(profile, catalog, "drive").filter((n) => !zoneOf.has(n));
  loose.forEach((name, i) => {
    const x =
      i === 0 && name === profile.startDrive
        ? inputX - CARD_W / 2
        : Math.max(cursor + BAND_SEP, inputX - CARD_W / 2);
    cards.push({ name, spot: "drive", order: i + 1, x, y: driveY, zone: null, mark: null });
    cursor = x + CARD_W;
  });
  groups.forEach((g) => {
    const isClosed = collapsed.has(g.id);
    const n = g.members.length;
    const w = isClosed
      ? CARD_W + STACK_OFFSET * 2
      : ZONE_PAD * 2 + n * CARD_W + Math.max(0, n - 1) * COL_GAP;
    const h = isClosed ? CARD_H + STACK_OFFSET * 2 + ZONE_HEAD : ZONE_HEAD + CARD_H + ZONE_PAD;
    const anchors = g.members
      .map((m) => catalog.get(m)?.spot)
      .filter((s): s is Exclude<SpotKey, "drive"> => s !== undefined && s !== "drive")
      .map(anchorX);
    const pref =
      anchors.length > 0
        ? anchors.reduce((a, b) => a + b, 0) / anchors.length - w / 2
        : cursor + BAND_SEP;
    const x = Math.max(pref, cursor + BAND_SEP, inputX - CARD_W / 2);
    const letter = zoneLetter(profile, g.id);
    zones.push({ id: g.id, letter, x, y: driveY, w, h, collapsed: isClosed, members: g.members });
    if (!isClosed) {
      g.members.forEach((m, mi) => {
        cards.push({
          name: m,
          spot: catalog.get(m)?.spot ?? "drive",
          order: mi + 1,
          x: x + ZONE_PAD + mi * (CARD_W + COL_GAP),
          y: driveY + ZONE_HEAD,
          zone: g.id,
          mark: `${letter}${String(mi + 1)}`,
        });
      });
    }
    cursor = x + w;
  });

  // 스타트 Drive가 입력 받기에서 턴을 쥔다
  const start = profile.startDrive;
  if (start !== null) {
    const card = cards.find((c) => c.name === start);
    const zone = zones.find((z) => z.members.includes(start));
    const from =
      card !== undefined
        ? { x: card.x + CARD_W / 2, y: card.y }
        : zone !== undefined
          ? { x: zone.x + zone.w / 2, y: zone.y }
          : null;
    if (from !== null) {
      const bend = driveY - 28;
      startWire =
        from.x === inputX
          ? `M${String(from.x)} ${String(from.y)}V${String(6)}`
          : `M${String(from.x)} ${String(from.y)}V${String(bend)}H${String(inputX)}V${String(6)}`;
    }
  }

  // 경계
  const xsAll = [
    ...stops.map((s) => s.x - BLOCK_W / 2),
    ...stops.map((s) => s.x + BLOCK_W / 2),
    ...cards.map((c) => c.x),
    ...cards.map((c) => c.x + CARD_W),
    ...marks.map((m) => m.x + m.w),
    ...zones.map((z) => z.x + z.w),
  ];
  const minX = Math.min(...xsAll) - 104;
  const maxX = Math.max(...xsAll) + 24;
  const minY = FEED_BASE - Math.max(feedBand, 24) - 56;
  const bandH = Math.max(
    cards.some((c) => c.spot === "drive" && c.zone === null) ? CARD_H : 0,
    ...zones.map((z) => z.h),
  );
  const maxY = driveY + Math.max(bandH, 40) + 24;
  return {
    stops,
    points,
    cards,
    marks,
    zones,
    wires,
    startWire,
    datums: { feed: FEED_BASE, hook: HOOK_BASE, drive: driveY },
    bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
  };
}
