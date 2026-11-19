// cvA(HUD) 프로필 캔버스의 배치: 턴의 레일을 가로로 깔고, 레일 위에 Inject·도구(들어가는 것), 아래에 Hook(걸리는 것),
// 맨 위에 Drive 줄을 둔다. 같은 곳에 붙는 것은 세로 줄(스택)로 쌓고 줄 왼쪽의 등뼈(spine)로 그 자리에 잇는다.
// 줄끼리 겹치면 가로로 밀어 낸다(바라는 자리의 평균을 지키는 묶음 펴기). 좌표는 흐름 좌표이고 레일이 y=0이다.
// 그리기용 경로(SVG d)도 여기서 만든다. 순수 함수라 시험이 값을 비교한다.
import {
  RAIL,
  groupOf,
  handoffsOf,
  isBoundary,
  stackId,
  stackKeyOf,
  stacksOf,
  stationOfPort,
  targetsFor,
  type Catalog,
  type Kind,
  type Port,
  type ProfileModel,
  type StackKey,
  type StationId,
  type Target,
} from "./model.ts";

export const NODE_W = 152;
export const NODE_H = 46;
const PITCH = 58;
/** 레일 자리 사이 */
const STATION_GAP = 120;
export const TAG_W = 94;
export const TAG_H = 26;
const FEED_GAP = 66;
const HOOK_GAP = 66;
/** 등뼈로 꺾이는 높이(레일에서) */
const ELBOW = 36;
const SPINE_INSET = 14;
const DRIVE_RISE = 108;
const FRAME_PAD = 14;
const FRAME_TAB = 26;

export interface Point {
  readonly x: number;
  readonly y: number;
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface StationGeo {
  readonly id: StationId;
  readonly x: number;
  readonly boundary: boolean;
}

type Item =
  | { readonly type: "plugin"; readonly name: string }
  | { readonly type: "group"; readonly group: string; readonly members: readonly string[] };

interface NodeGeo extends Box {
  /** 화면 id: 플러그인 이름 또는 `group:<id>` */
  readonly id: string;
  readonly item: Item;
  readonly stack: string;
  readonly index: number;
  /** 줄 안 순서(1부터). 줄에 둘 이상일 때만 0보다 크다 */
  readonly order: number;
}

type LinkType = "attach" | "start" | "handoff";

interface LinkGeo {
  readonly id: string;
  readonly type: LinkType;
  /** 이 선이 나오는 노드 id(고르면 밝아진다) */
  readonly from: string;
  readonly to: string | null;
  readonly d: string;
  /** 붙는 쪽 종류(레일 쪽 표식의 빛) */
  readonly kind: Kind;
  readonly draft: boolean;
}

/** 줄 순서 숫자(등뼈 옆) */
/** 순서 숫자: 등뼈와 노드 사이 틈, 붙음 선 바로 위(옆 노드에 가리지 않는다) */
interface OrderMark extends Point {
  readonly value: number;
}

/** 레일에 걸린 자리 표식(Hook 걸쇠, Inject 들어감, 스타트) */
interface Clamp extends Point {
  readonly kind: "hook" | "feed" | "start";
  readonly from: readonly string[];
}

export interface FrameGeo extends Box {
  readonly group: string;
  readonly members: readonly string[];
}

type SlotShape = "ghost" | "bar-h" | "bar-v";

export interface SlotGeo extends Box {
  readonly target: Target;
  readonly shape: SlotShape;
  /** 이 자리가 닿는 레일의 점(빈 줄의 자리면 그리로 점선을 긋는다) */
  readonly rail: Point | null;
  /** 맞히기 기준점 */
  readonly anchor: Point;
}

export interface ProfileLayout {
  readonly xs: RailXs;
  readonly stations: readonly StationGeo[];
  readonly ports: ReadonlyMap<Port, Point>;
  readonly nodes: readonly NodeGeo[];
  readonly links: readonly LinkGeo[];
  readonly orders: readonly OrderMark[];
  readonly clamps: readonly Clamp[];
  readonly frames: readonly FrameGeo[];
  readonly rail: { readonly x1: number; readonly x2: number };
  /** 턴 끝에서 다음 입력으로 돌아오는 길과 그 위의 기록 */
  readonly back: { readonly d: string; readonly y: number; readonly record: Point };
  readonly bounds: Box;
}

const r = (n: number): string => String(Math.round(n * 10) / 10);

/** 레일 자리의 x. 무엇이 붙은 자리 둘레는 넓게, 빈 자리끼리는 좁게 둔다(화면에 크게 들어오게) */
type RailXs = ReadonlyMap<StationId, number>;

const QUIET_GAP = 106;

function railXs(profile: ProfileModel, catalog: Catalog): RailXs {
  const busy = new Set<StationId>();
  for (const s of stacksOf(profile, catalog)) {
    if (s.key.lane === "feed") busy.add(s.key.station);
    else if (s.key.lane === "hook") busy.add(stationOfPort(s.key.port).station);
    else if (profile.startDrive !== null) busy.add("input-received");
  }
  const xs = new Map<StationId, number>();
  let x = 0;
  RAIL.forEach((id, i) => {
    const prev = RAIL[i - 1];
    if (prev !== undefined) x += busy.has(prev) || busy.has(id) ? STATION_GAP : QUIET_GAP;
    xs.set(id, x);
  });
  return xs;
}

function xOf(xs: RailXs, id: StationId): number {
  return xs.get(id) ?? 0;
}

function portPoint(port: Port, xs: RailXs): Point {
  const { station, side } = stationOfPort(port);
  const x = xOf(xs, station);
  if (side === null) return { x, y: 0 };
  return { x: side === "before" ? x - TAG_W / 2 - 12 : x + TAG_W / 2 + 12, y: 0 };
}

/**
 * 바라는 가운데들을 겹치지 않게 편다. 겹치는 것끼리 묶고, 묶음은 바라는 자리의 평균을 가운데로 둔다.
 * 들어온 순서는 바라는 자리 순으로 정렬해 지킨다(같으면 들어온 순서).
 */
export function spread(wants: readonly number[], gap: number): readonly number[] {
  const order = wants
    .map((want, i) => ({ want, i }))
    .toSorted((a, b) => a.want - b.want || a.i - b.i);
  interface Cluster {
    ids: number[];
    sum: number;
    x0: number;
  }
  const clusters: Cluster[] = [];
  for (const { want, i } of order) {
    clusters.push({ ids: [i], sum: want, x0: want });
    for (;;) {
      const cur = clusters.at(-1);
      const prev = clusters.at(-2);
      if (cur === undefined || prev === undefined) break;
      if (prev.x0 + prev.ids.length * gap <= cur.x0) break;
      clusters.pop();
      prev.ids.push(...cur.ids);
      prev.sum += cur.sum;
      prev.x0 = prev.sum / prev.ids.length - ((prev.ids.length - 1) * gap) / 2;
    }
  }
  const out = Array.from({ length: wants.length }, () => 0);
  for (const c of clusters) c.ids.forEach((id, k) => (out[id] = c.x0 + k * gap));
  return out;
}

function feedTop(index: number): number {
  return -(FEED_GAP + NODE_H) - index * PITCH;
}

function hookTop(index: number): number {
  return HOOK_GAP + index * PITCH;
}

/** 줄의 바라는 가운데(레일의 그 자리) */
function wantOf(key: StackKey, xs: RailXs): number {
  if (key.lane === "feed") return xOf(xs, key.station);
  if (key.lane === "hook") return portPoint(key.port, xs).x;
  return xOf(xs, "input-received");
}

/** 레일에서 그 줄이 닿는 점 */
function anchorOf(key: StackKey, xs: RailXs): Point {
  if (key.lane === "feed") return { x: xOf(xs, key.station), y: -TAG_H / 2 };
  if (key.lane === "hook") return portPoint(key.port, xs);
  return { x: xOf(xs, "input-received"), y: -TAG_H / 2 };
}

interface Line {
  readonly key: StackKey;
  readonly items: readonly Item[];
}

function itemId(item: Item): string {
  return item.type === "plugin" ? item.name : `group:${item.group}`;
}

/** 접힌 묶음은 줄에서 구성원을 지우고 묶음 하나로 선다(Drive가 있으면 Drive 줄, 없으면 첫 구성원의 줄) */
function linesOf(
  profile: ProfileModel,
  catalog: Catalog,
  closed: ReadonlySet<string>,
): readonly Line[] {
  const stacks = stacksOf(profile, catalog);
  const home = new Map<string, string>();
  for (const g of profile.groups) {
    if (!closed.has(g.id)) continue;
    const drive = g.members.find((m) => catalog.get(m)?.kind === "drive");
    const first = drive ?? g.members[0];
    const spec = first === undefined ? undefined : catalog.get(first);
    if (spec !== undefined) home.set(g.id, stackId(stackKeyOf(spec)));
  }
  const lines: Line[] = stacks.map((s) => {
    const items: Item[] = [];
    const placed = new Set<string>();
    for (const name of s.members) {
      const g = groupOf(profile, name);
      if (g === undefined || !closed.has(g.id)) {
        items.push({ type: "plugin", name });
        continue;
      }
      if (home.get(g.id) === stackId(s.key) && !placed.has(g.id)) {
        placed.add(g.id);
        items.push({ type: "group", group: g.id, members: g.members });
      }
    }
    return { key: s.key, items };
  });
  // 접힌 묶음의 집 줄이 비어 없어졌으면(구성원이 다른 줄에만 있으면) 그 줄을 만든다
  for (const [group, sid] of home) {
    if (lines.some((l) => l.items.some((i) => i.type === "group" && i.group === group))) continue;
    const g = profile.groups.find((x) => x.id === group);
    const stack = stacks.find((s) => stackId(s.key) === sid);
    if (g !== undefined && stack !== undefined)
      lines.push({ key: stack.key, items: [{ type: "group", group, members: g.members }] });
  }
  return lines.filter((l) => l.items.length > 0);
}

function kindOfItem(item: Item, catalog: Catalog): Kind {
  if (item.type === "plugin") return catalog.get(item.name)?.kind ?? "inject";
  return item.members.some((m) => catalog.get(m)?.kind === "drive") ? "drive" : "hook";
}

export function layoutProfile(
  profile: ProfileModel,
  catalog: Catalog,
  closed: ReadonlySet<string>,
): ProfileLayout {
  const xs = railXs(profile, catalog);
  const stations: StationGeo[] = RAIL.map((id) => ({
    id,
    x: xOf(xs, id),
    boundary: isBoundary(id),
  }));
  const ports = new Map<Port, Point>();
  const lines = linesOf(profile, catalog, closed);
  const feeds = lines.filter((l) => l.key.lane === "feed");
  const hooks = lines.filter((l) => l.key.lane === "hook");
  const drive = lines.find((l) => l.key.lane === "drive");
  const nodes: NodeGeo[] = [];
  const centerOf = new Map<string, number>();

  const columns = (ls: readonly Line[], gap: number): void => {
    const placed = spread(
      ls.map((l) => wantOf(l.key, xs)),
      gap,
    );
    ls.forEach((l, i) => centerOf.set(stackId(l.key), placed[i] ?? 0));
  };
  columns(feeds, NODE_W + 36);
  columns(hooks, NODE_W + 22);

  const maxFeed = Math.max(1, ...feeds.map((l) => l.items.length));
  const driveTop = feedTop(maxFeed - 1) - DRIVE_RISE;

  for (const l of [...feeds, ...hooks]) {
    const cx = centerOf.get(stackId(l.key)) ?? 0;
    l.items.forEach((item, index) => {
      nodes.push({
        id: itemId(item),
        item,
        stack: stackId(l.key),
        index,
        order: l.items.length > 1 ? index + 1 : 0,
        x: cx - NODE_W / 2,
        y: l.key.lane === "feed" ? feedTop(index) : hookTop(index),
        w: NODE_W,
        h: NODE_H,
      });
    });
  }

  // Drive 줄: 스타트는 입력 받기 위, 열린 묶음에서 Hook과 함께인 Drive는 그 Hook 위, 나머지는 차례로 오른쪽
  if (drive !== undefined) {
    const wants: number[] = [];
    let cursor = xOf(xs, "input-received");
    drive.items.forEach((item, index) => {
      const partner = partnerX(item, profile, nodes);
      const want = partner ?? (index === 0 ? cursor : cursor + NODE_W + 76);
      wants.push(want);
      cursor = want;
    });
    const dx = spread(wants, NODE_W + 52);
    drive.items.forEach((item, index) => {
      nodes.push({
        id: itemId(item),
        item,
        stack: "drive",
        index,
        order: 0,
        x: (dx[index] ?? 0) - NODE_W / 2,
        y: driveTop,
        w: NODE_W,
        h: NODE_H,
      });
    });
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links: LinkGeo[] = [];
  const orders: OrderMark[] = [];
  const clampAt = new Map<string, { p: Point; kind: Clamp["kind"]; from: string[] }>();
  const addClamp = (p: Point, kind: Clamp["kind"], from: string): void => {
    const key = `${r(p.x)}:${r(p.y)}:${kind}`;
    const hit = clampAt.get(key);
    if (hit === undefined) clampAt.set(key, { p, kind, from: [from] });
    else hit.from.push(from);
  };

  // 붙음: 레일 → 꺾임 → 등뼈 → 노드
  for (const l of [...feeds, ...hooks]) {
    const sid = stackId(l.key);
    const cx = centerOf.get(sid) ?? 0;
    const spine = cx - NODE_W / 2 - SPINE_INSET;
    const up = l.key.lane === "feed";
    const a = anchorOf(l.key, xs);
    const elbow = up ? -ELBOW : ELBOW;
    l.items.forEach((item, index) => {
      const id = itemId(item);
      const n = byId.get(id);
      if (n === undefined) return;
      const mid = n.y + NODE_H / 2;
      links.push({
        id: `attach:${id}`,
        type: "attach",
        from: id,
        to: null,
        d: `M${r(a.x)} ${r(a.y)}V${r(elbow)}H${r(spine)}V${r(mid)}H${r(n.x)}`,
        kind: kindOfItem(item, catalog),
        draft: item.type === "plugin" && catalog.get(item.name)?.draft === true,
      });
      if (l.items.length > 1)
        orders.push({ x: spine + SPINE_INSET / 2, y: mid - 7, value: index + 1 });
    });
    addClamp(a, up ? "feed" : "hook", sid);
    if (!up && l.key.lane === "hook") ports.set(l.key.port, a);
  }

  // Drive 줄의 붙음: 스타트 Drive는 입력 받기로 내려온다. 접힌 묶음 안의 Hook은 레일 위쪽에서 그 자리로 내려온다
  if (drive !== undefined) {
    for (const item of drive.items) {
      const id = itemId(item);
      const n = byId.get(id);
      if (n === undefined) continue;
      const cx = n.x + NODE_W / 2;
      const bottom = n.y + NODE_H;
      const isStart =
        profile.startDrive !== null &&
        (item.type === "plugin"
          ? item.name === profile.startDrive
          : item.members.includes(profile.startDrive));
      if (isStart) {
        const sx = xOf(xs, "input-received");
        const mid = bottom + (feedTop(maxFeed - 1) - bottom) / 2;
        links.push({
          id: `start:${id}`,
          type: "start",
          from: id,
          to: null,
          d: `M${r(cx)} ${r(bottom)}V${r(mid)}H${r(sx)}V${r(-7)}`,
          kind: "drive",
          draft: false,
        });
        addClamp({ x: sx, y: 0 }, "start", id);
      }
      if (item.type !== "group") continue;
      item.members.forEach((m, k) => {
        const spec = catalog.get(m);
        if (spec?.kind !== "hook" || spec.port === undefined) return;
        const p = portPoint(spec.port, xs);
        const y = -ELBOW + 10 - k * 6;
        links.push({
          id: `attach:${id}:${m}`,
          type: "attach",
          from: id,
          to: null,
          d: `M${r(cx)} ${r(bottom)}V${r(y)}H${r(p.x)}V${r(-6)}`,
          kind: "hook",
          draft: spec.draft === true,
        });
        addClamp({ x: p.x, y: 0 }, "hook", id);
      });
    }
  }

  // 핸드오프: 노드와 노드를 잇는 호(위로 솟는다)
  const visibleId = (name: string): string | null => {
    if (byId.has(name)) return name;
    const g = groupOf(profile, name);
    return g !== undefined && byId.has(`group:${g.id}`) ? `group:${g.id}` : null;
  };
  for (const h of handoffsOf(profile, catalog)) {
    const fromId = visibleId(h.from);
    const toId = visibleId(h.to);
    if (fromId === null || toId === null || fromId === toId) continue;
    const a = byId.get(fromId);
    const b = byId.get(toId);
    if (a === undefined || b === undefined) continue;
    links.push({
      id: `handoff:${h.from}:${h.to}`,
      type: "handoff",
      from: fromId,
      to: toId,
      d: arc(a, b),
      kind: "drive",
      draft: false,
    });
  }

  // 열린 묶음의 틀
  const frames: FrameGeo[] = [];
  for (const g of profile.groups) {
    if (closed.has(g.id)) continue;
    const members = g.members.map((m) => byId.get(m)).filter((n) => n !== undefined);
    if (members.length === 0) continue;
    const x1 = Math.min(...members.map((n) => n.x)) - FRAME_PAD;
    const y1 = Math.min(...members.map((n) => n.y)) - FRAME_PAD - FRAME_TAB;
    const x2 = Math.max(...members.map((n) => n.x + n.w)) + FRAME_PAD;
    const y2 = Math.max(...members.map((n) => n.y + n.h)) + FRAME_PAD;
    frames.push({ group: g.id, members: g.members, x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
  }

  const endX = xOf(xs, "before-turn-end");
  const inX = xOf(xs, "input-received");
  const lowest = Math.max(HOOK_GAP, ...nodes.filter((n) => n.y > 0).map((n) => n.y + n.h));
  const backY = lowest + 54;
  const firstX = xOf(xs, "conversation-start");
  const allX = [firstX - 60, endX + 60, ...nodes.map((n) => n.x), ...nodes.map((n) => n.x + n.w)];
  const ys = [driveTop, backY + 20, ...nodes.map((n) => n.y), ...frames.map((f) => f.y)];
  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const minY = Math.min(...ys) - 70;
  const maxY = Math.max(...ys) + 16;

  return {
    xs,
    stations,
    ports,
    nodes,
    links,
    orders,
    clamps: [...clampAt.values()].map((c) => ({ x: c.p.x, y: c.p.y, kind: c.kind, from: c.from })),
    frames,
    rail: { x1: firstX - 44, x2: endX + 44 },
    back: {
      d: `M${r(endX)} 8V${r(backY)}H${r(inX)}V8`,
      y: backY,
      record: { x: (endX + inX) / 2 + STATION_GAP, y: backY },
    },
    bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
  };
}

/** 같은 묶음(열림)의 Hook 노드 가운데. Drive를 그 위에 세워 틀이 세로 한 줄로 묶이게 한다 */
function partnerX(item: Item, profile: ProfileModel, nodes: readonly NodeGeo[]): number | null {
  if (item.type !== "plugin") return null;
  const g = groupOf(profile, item.name);
  if (g === undefined) return null;
  for (const m of g.members) {
    if (m === item.name) continue;
    const n = nodes.find((x) => x.id === m);
    if (n !== undefined) return n.x + n.w / 2;
  }
  return null;
}

/** 핸드오프 호: 보내는 노드 오른쪽 위에서 받는 노드 왼쪽 위로, 위로 솟는다 */
function arc(a: Box, b: Box): string {
  const forward = b.x >= a.x;
  const sx = forward ? a.x + a.w : a.x;
  const tx = forward ? b.x : b.x + b.w;
  const sy = a.y + 16;
  const ty = b.y + 16;
  const lift = Math.min(90, 34 + Math.abs(tx - sx) * 0.12);
  const k = (tx - sx) * 0.35;
  return `M${r(sx)} ${r(sy)}C${r(sx + k)} ${r(sy - lift)} ${r(tx - k)} ${r(ty - lift)} ${r(tx)} ${r(ty)}`;
}

// ── 놓을 자리의 그림 ──────────────────────────────────────────────

/** 끄는 플러그인을 놓을 수 있는 자리의 모양과 맞히기 점. 지금 배치를 바꾸지 않고 그 위에 겹쳐 그린다 */
export function slotsFor(
  layout: ProfileLayout,
  profile: ProfileModel,
  catalog: Catalog,
  name: string,
): readonly SlotGeo[] {
  const spec = catalog.get(name);
  if (spec === undefined) return [];
  const key = stackKeyOf(spec);
  const sid = stackId(key);
  const line = layout.nodes
    .filter((n) => n.stack === sid && n.id !== name)
    .toSorted((a, b) => a.index - b.index);
  return targetsFor(profile, catalog, name).map((target) => slotOf(target, key, line, layout.xs));
}

function slotOf(target: Target, key: StackKey, line: readonly NodeGeo[], xs: RailXs): SlotGeo {
  const i = target.index;
  const before = line[i - 1];
  const at = line[i];
  if (key.lane === "drive") {
    const y = before?.y ?? at?.y ?? feedTop(0) - DRIVE_RISE;
    if (at === undefined) {
      const x =
        before === undefined ? xOf(xs, "input-received") - NODE_W / 2 : before.x + NODE_W + 52;
      const rail = before === undefined ? { x: xOf(xs, "input-received"), y: -7 } : null;
      return ghost(target, x, y, rail);
    }
    const x = before === undefined ? at.x - 14 : (before.x + before.w + at.x) / 2;
    return {
      target,
      shape: "bar-v",
      rail: null,
      x: x - 1,
      y,
      w: 2,
      h: NODE_H,
      anchor: { x, y: y + NODE_H / 2 },
    };
  }
  const feed = key.lane === "feed";
  const cx =
    at !== undefined
      ? at.x + NODE_W / 2
      : before !== undefined
        ? before.x + NODE_W / 2
        : wantOf(key, xs);
  const top = (k: number): number => (feed ? feedTop(k) : hookTop(k));
  if (at === undefined)
    return ghost(target, cx - NODE_W / 2, top(i), line.length === 0 ? anchorOf(key, xs) : null);
  const y = feed ? at.y + NODE_H + (PITCH - NODE_H) / 2 : at.y - (PITCH - NODE_H) / 2;
  return {
    target,
    shape: "bar-h",
    rail: null,
    x: cx - NODE_W / 2,
    y: y - 1,
    w: NODE_W,
    h: 2,
    anchor: { x: cx, y },
  };
}

function ghost(target: Target, x: number, y: number, rail: Point | null): SlotGeo {
  return {
    target,
    shape: "ghost",
    rail,
    x,
    y,
    w: NODE_W,
    h: NODE_H,
    anchor: { x: x + NODE_W / 2, y: y + NODE_H / 2 },
  };
}

/** 흐름 좌표의 점에서 가장 가까운 자리(반경 안). 없으면 null */
export function nearestSlot(slots: readonly SlotGeo[], p: Point, radius = 150): SlotGeo | null {
  let best: SlotGeo | null = null;
  let bestD = radius;
  for (const s of slots) {
    const d = Math.hypot(s.anchor.x - p.x, (s.anchor.y - p.y) * 1.4);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** 프로필 안에서 보이는 이름 순서(키보드 이동 순서): 레일 위 왼쪽부터, 그다음 아래 */
export function readingOrder(layout: ProfileLayout): readonly string[] {
  return layout.nodes
    .toSorted((a, b) => (a.y < 0 === b.y < 0 ? a.x - b.x || a.y - b.y : a.y - b.y))
    .map((n) => n.id);
}
