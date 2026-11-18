// cvD 프로필 캔버스의 순수 모델: 프로필 바꾸기(놓기·빼기·순서)와 자리 계산(격자 배치).
// 격자는 8px 단위다. 줄기(코어 턴)는 TRUNK_X 한 줄로 위에서 아래로 흐르고, 블록은 줄기 위의 판, 경계는 줄기 위의 고리다.
// Hook은 블록의 앞(판 위 줄)·뒤(판 아래 줄)에서 줄기로부터 직각 가지로 나오고, Inject·도구는 판의 오른쪽 끝으로 들어간다.
// 같은 자리의 플러그인은 왼쪽에서 오른쪽으로 호출 순서다(가드 등급이 먼저, 그다음 프로필 순서).
// 묶음은 오른쪽 끝의 세로 칸 하나를 갖고, 멤버는 제 줄 높이에서 그 칸 안에 선다(접으면 칸이 가는 등뼈가 된다).
import {
  pluginById,
  type BlockId,
  type BoundaryId,
  type Kind,
  type PointKey,
  type ProfileEntry,
  type SampleGroup,
  type SamplePlugin,
} from "./sample.ts";

// ── 프로필 상태와 바꾸기 ─────────────────────────────────────────────

export interface CanvasProfile {
  readonly id: string;
  readonly startDrive: string | null;
  readonly entries: readonly ProfileEntry[];
  readonly groups: readonly SampleGroup[];
}

/** 플러그인을 그 자리의 호출 순서에서 몇째로 둘지. 가드는 늘 앞이다 */
function tierOf(id: string): number {
  return pluginById(id)?.guard === true ? 0 : 1;
}

/** 한 자리에 붙은 항목을 호출 순서로(가드 먼저, 그다음 프로필 순서) */
export function entriesAt(profile: CanvasProfile, point: PointKey): readonly ProfileEntry[] {
  const at = profile.entries.filter((e) => pluginById(e.plugin)?.points.includes(point) === true);
  return at
    .map((e, i) => ({ e, i }))
    .toSorted((a, b) => tierOf(a.e.plugin) - tierOf(b.e.plugin) || a.i - b.i)
    .map((x) => x.e);
}

export function hasPlugin(profile: CanvasProfile, id: string): boolean {
  return profile.entries.some((e) => e.plugin === id);
}

/**
 * 플러그인을 자리 `point`의 `index`째에 넣는다(그 자리의 다른 플러그인 순서는 그대로).
 * 이미 들어 있으면 그 자리 안에서 옮긴다. 스타트 Drive가 비어 있고 Drive를 줄기 머리에 놓으면 스타트 Drive가 된다.
 */
export function placePlugin(
  profile: CanvasProfile,
  id: string,
  point: PointKey,
  index: number,
  asStart: boolean,
): CanvasProfile {
  const plugin = pluginById(id);
  if (plugin === undefined || !plugin.points.includes(point)) return profile;
  const existing = profile.entries.find((e) => e.plugin === id);
  const entry: ProfileEntry = existing ?? { plugin: id, origin: "profile" };
  const rest = profile.entries.filter((e) => e.plugin !== id);
  const restProfile = { ...profile, entries: rest };
  const siblings = entriesAt(restProfile, point).filter((e) => tierOf(e.plugin) === tierOf(id));
  const clamped = Math.max(0, Math.min(index, siblings.length));
  const before = siblings[clamped];
  const last = siblings.at(-1);
  let at = rest.length;
  if (before !== undefined) at = rest.indexOf(before);
  else if (last !== undefined) at = rest.indexOf(last) + 1;
  const entries = [...rest.slice(0, at), entry, ...rest.slice(at)];
  const startDrive = asStart && plugin.kind === "drive" ? id : profile.startDrive;
  return { ...profile, entries, startDrive };
}

/** 빼기. 베이스에서 온 것은 이 프로필에서 뺄 수 없다(베이스에서 뺀다) */
export function removePlugin(profile: CanvasProfile, id: string): CanvasProfile {
  const entry = profile.entries.find((e) => e.plugin === id);
  if (entry === undefined || entry.origin === "base") return profile;
  return {
    ...profile,
    entries: profile.entries.filter((e) => e.plugin !== id),
    startDrive: profile.startDrive === id ? null : profile.startDrive,
    groups: profile.groups
      .map((g) => ({ ...g, members: g.members.filter((m) => m !== id) }))
      .filter((g) => g.members.length > 0),
  };
}

/** 같은 자리, 같은 등급 안에서 한 칸 앞(-1)이나 뒤(+1)로 */
export function shiftPlugin(profile: CanvasProfile, id: string, delta: -1 | 1): CanvasProfile {
  const plugin = pluginById(id);
  const point = plugin?.points[0];
  if (point === undefined || !hasPlugin(profile, id)) return profile;
  const siblings = entriesAt(profile, point).filter((e) => tierOf(e.plugin) === tierOf(id));
  const from = siblings.findIndex((e) => e.plugin === id);
  const to = from + delta;
  if (to < 0 || to >= siblings.length) return profile;
  return placePlugin(profile, id, point, to, false);
}

// ── 격자 ─────────────────────────────────────────────────────────

export const TRUNK_X = 160;
export const LOOP_X = 24;
export const PLATE_W = 136;
export const PLATE_H = 28;
export const CHIP_X0 = 256;
export const CHIP_W = 144;
const CHIP_H = 26;
export const COL_STEP = 160;
export const DRIVE_W = 168;
export const DRIVE_H = 32;
const TOP = 24;
const ROW_H = {
  header: 40,
  drive: 72,
  boundary: 32,
  hook: 36,
  station: 44,
  turn: 32,
  record: 44,
} as const;
const GROUP_PAD = 8;
const GROUP_SPINE = 24;
const GROUP_HEADER_W = 112;

type RowKind = keyof typeof ROW_H;

export interface Row {
  readonly key: string;
  readonly kind: RowKind;
  /** 줄 가운데 y */
  readonly y: number;
  readonly h: number;
  /** 이 줄에 플러그인이 붙는 자리(블록 판 줄은 feed 자리) */
  readonly point: PointKey | null;
  readonly block: BlockId | null;
  readonly boundary: BoundaryId | null;
  /** 끌어 놓는 동안만 드러난 빈 줄 */
  readonly ghost: boolean;
}

export interface Chip {
  readonly plugin: string;
  readonly kind: Kind;
  readonly point: PointKey;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** 그 자리의 호출 순서(0부터) */
  readonly order: number;
  readonly origin: "profile" | "base";
  readonly draft: boolean;
  readonly guard: boolean;
  readonly group: string | null;
  /** 접힌 묶음 안이라 노드로 그리지 않는다 */
  readonly hidden: boolean;
  readonly start: boolean;
}

export interface GroupBox {
  readonly id: string;
  readonly x: number;
  readonly top: number;
  readonly bottom: number;
  readonly w: number;
  readonly open: boolean;
  readonly members: readonly string[];
}

type Marker = "diamond" | "chevron" | "square" | "none";

/** 붙음 선(직각, 가는 무채색). 마지막 점이 표식 자리다 */
export interface Wire {
  readonly key: string;
  readonly kind: "branch" | "feed" | "chain";
  readonly points: readonly (readonly [number, number])[];
  readonly marker: Marker;
  readonly ghost: boolean;
}

/** 핸드오프 고리(Drive ↔ Drive) */
export interface Handoff {
  readonly key: string;
  readonly from: string;
  readonly to: string;
  readonly ax: number;
  readonly bx: number;
  readonly y: number;
}

/** 끌어 놓을 수 있는 자리 하나 */
export interface Slot {
  readonly key: string;
  readonly point: PointKey;
  readonly index: number;
  readonly asStart: boolean;
  /** 놓으면 노드가 설 자리(미리 보기) */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Layout {
  readonly width: number;
  readonly height: number;
  readonly rows: readonly Row[];
  readonly chips: readonly Chip[];
  readonly groups: readonly GroupBox[];
  readonly wires: readonly Wire[];
  readonly handoffs: readonly Handoff[];
  readonly slots: readonly Slot[];
  readonly trunkTop: number;
  readonly trunkBottom: number;
  /** 다음 턴으로 돌아가는 길이 줄기로 들어오는 y */
  readonly loopEntry: number;
  readonly recordY: number;
  /** 스타트 Drive가 비어 있을 때 줄기 머리의 빈 자리 */
  readonly emptyStart: boolean;
}

export interface LayoutOptions {
  readonly blocks: readonly BlockId[];
  readonly boundaries: readonly BoundaryId[];
  /** 접은 묶음 id */
  readonly folded: ReadonlySet<string>;
  /** 끌고 있는 플러그인(놓을 자리를 연다) */
  readonly dragging: string | null;
}

function groupOf(profile: CanvasProfile, id: string): string | null {
  return profile.groups.find((g) => g.members.includes(id))?.id ?? null;
}

/** 블록 판 줄에 들어오는 재료 자리 */
function feedOf(block: BlockId): PointKey | null {
  if (block === "context") return "feed:context";
  if (block === "tools") return "feed:tools";
  return null;
}

interface RowPlan {
  readonly kind: RowKind;
  readonly key: string;
  readonly point: PointKey | null;
  readonly block: BlockId | null;
  readonly boundary: BoundaryId | null;
}

function planRows(profile: CanvasProfile, o: LayoutOptions): RowPlan[] {
  const reveal = new Set<PointKey>(
    o.dragging === null ? [] : (pluginById(o.dragging)?.points ?? []),
  );
  const used = (p: PointKey): boolean => entriesAt(profile, p).length > 0 || reveal.has(p);
  const plan: RowPlan[] = [];
  const none = { point: null, block: null, boundary: null };
  if (profile.groups.length > 0) plan.push({ kind: "header", key: "header", ...none });
  plan.push({ kind: "drive", key: "drive", ...none, point: "drive" });
  const boundary = (b: BoundaryId): void => {
    if (o.boundaries.includes(b))
      plan.push({
        kind: "boundary",
        key: `boundary:${b}`,
        point: `boundary:${b}`,
        block: null,
        boundary: b,
      });
  };
  boundary("conversation-start");
  boundary("input-received");
  for (const block of o.blocks) {
    if (block === "record") continue;
    const before: PointKey = `before:${block}`;
    const after: PointKey = `after:${block}`;
    if (used(before))
      plan.push({ kind: "hook", key: before, point: before, block, boundary: null });
    plan.push({
      kind: "station",
      key: `station:${block}`,
      point: feedOf(block),
      block,
      boundary: null,
    });
    if (used(after)) plan.push({ kind: "hook", key: after, point: after, block, boundary: null });
  }
  boundary("before-turn-end");
  plan.push({ kind: "turn", key: "turn", ...none });
  if (o.blocks.includes("record"))
    plan.push({
      kind: "record",
      key: "station:record",
      point: null,
      block: "record",
      boundary: null,
    });
  return plan;
}

/** 끌어 놓는 동안만 열린 빈 자리 줄(가지를 점선으로 미리 그린다) */
function isGhost(profile: CanvasProfile, p: RowPlan, reveal: ReadonlySet<PointKey>): boolean {
  if (p.point === null || (p.kind !== "hook" && p.kind !== "boundary")) return false;
  if (entriesAt(profile, p.point).length > 0) return false;
  return p.kind === "hook" || reveal.has(p.point);
}

/** 프로필을 격자에 놓는다 */
export function layoutProfile(profile: CanvasProfile, o: LayoutOptions): Layout {
  const plan = planRows(profile, o);
  const reveal = new Set<PointKey>(
    o.dragging === null ? [] : (pluginById(o.dragging)?.points ?? []),
  );
  const rows: Row[] = [];
  let y = TOP;
  for (const p of plan) {
    const h = ROW_H[p.kind];
    rows.push({ ...p, y: y + h / 2, h, ghost: isGhost(profile, p, reveal) });
    y += h;
  }
  const rowOf = (point: PointKey): Row | undefined => rows.find((r) => r.point === point);

  // 묶음이 아닌 노드의 칸 수(묶음 칸은 그 오른쪽)
  let maxCols = 2;
  for (const r of rows) {
    if (r.point === null || r.point === "drive") continue;
    // 끄는 동안 끝 자리 하나가 더 생기는 줄은 그 줄만 한 칸 늘린다(묶음 칸이 뛰지 않게)
    const free = entriesAt(profile, r.point).filter(
      (e) => groupOf(profile, e.plugin) === null && e.plugin !== o.dragging,
    );
    maxCols = Math.max(maxCols, free.length + (reveal.has(r.point) ? 1 : 0));
  }
  const driveFree = profile.entries.filter(
    (e) =>
      pluginById(e.plugin)?.kind === "drive" &&
      e.plugin !== profile.startDrive &&
      groupOf(profile, e.plugin) === null,
  );
  maxCols = Math.max(maxCols, driveFree.length + 1);
  const groupX0 = CHIP_X0 + maxCols * COL_STEP;

  const chips: Chip[] = [];
  const wires: Wire[] = [];
  const groupCols = new Map<string, number>();
  profile.groups.forEach((g, i) => {
    const prev = profile.groups.slice(0, i);
    const offset = prev.reduce(
      (sum, pg) => sum + (o.folded.has(pg.id) ? GROUP_HEADER_W : CHIP_W + GROUP_PAD * 2) + 24,
      0,
    );
    groupCols.set(g.id, groupX0 + offset);
  });
  const memberX = (gid: string): number => {
    const gx = groupCols.get(gid) ?? groupX0;
    return o.folded.has(gid) ? gx + GROUP_SPINE / 2 : gx + GROUP_PAD;
  };

  const makeChip = (
    plugin: SamplePlugin,
    entry: ProfileEntry,
    point: PointKey,
    x: number,
    cy: number,
    order: number,
    start: boolean,
  ): Chip => {
    const group = groupOf(profile, plugin.id);
    const hidden = group !== null && o.folded.has(group);
    const w = start ? DRIVE_W : CHIP_W;
    const h = start ? DRIVE_H : CHIP_H;
    return {
      plugin: plugin.id,
      kind: plugin.kind,
      point,
      x,
      y: cy - h / 2,
      w,
      h,
      order,
      origin: entry.origin,
      draft: plugin.draft === true,
      guard: plugin.guard === true,
      group,
      hidden,
      start,
    };
  };

  // Drive 줄: 스타트 Drive는 줄기 머리, 나머지는 칸이나 묶음 칸
  const driveRow = rowOf("drive");
  const startEntry = profile.entries.find((e) => e.plugin === profile.startDrive);
  const startPlugin = startEntry === undefined ? undefined : pluginById(startEntry.plugin);
  if (driveRow !== undefined) {
    if (startEntry !== undefined && startPlugin !== undefined)
      chips.push(
        makeChip(startPlugin, startEntry, "drive", TRUNK_X - DRIVE_W / 2, driveRow.y, 0, true),
      );
    let col = 0;
    for (const e of profile.entries) {
      const p = pluginById(e.plugin);
      if (p?.kind !== "drive" || e.plugin === profile.startDrive) continue;
      const g = groupOf(profile, e.plugin);
      const x = g === null ? CHIP_X0 + col * COL_STEP : memberX(g);
      if (g === null) col += 1;
      chips.push(makeChip(p, e, "drive", x, driveRow.y, col, false));
    }
  }

  // 자리 줄: 앞·뒤·경계(가지), 판 줄(재료)
  for (const r of rows) {
    if (r.point === null || r.point === "drive") continue;
    const at = entriesAt(profile, r.point);
    let col = 0;
    const rowChips: Chip[] = [];
    at.forEach((e, order) => {
      const p = pluginById(e.plugin);
      if (p === undefined || r.point === null) return;
      const g = groupOf(profile, e.plugin);
      const x = g === null ? CHIP_X0 + col * COL_STEP : memberX(g);
      if (g === null) col += 1;
      const chip = makeChip(p, e, r.point, x, r.y, order, false);
      rowChips.push(chip);
      chips.push(chip);
    });
    const first = rowChips[0];
    if (first === undefined) continue;
    const isFeed = r.kind === "station";
    const startX = isFeed ? TRUNK_X + PLATE_W / 2 : TRUNK_X;
    const marker: Marker = isFeed ? (r.point === "feed:tools" ? "square" : "chevron") : "diamond";
    wires.push({
      key: `w:${r.key}`,
      kind: isFeed ? "feed" : "branch",
      points: [
        [first.x, r.y],
        [startX, r.y],
      ],
      marker,
      ghost: false,
    });
    rowChips.slice(1).forEach((c, i) => {
      const prev = rowChips[i];
      if (prev === undefined) return;
      wires.push({
        key: `c:${r.key}:${c.plugin}`,
        kind: "chain",
        points: [
          [prev.hidden ? prev.x : prev.x + prev.w, r.y],
          [c.x, r.y],
        ],
        marker: "none",
        ghost: false,
      });
    });
  }

  // 묶음 칸
  const groups: GroupBox[] = profile.groups.map((g) => {
    const members = chips.filter((c) => c.group === g.id);
    const open = !o.folded.has(g.id);
    const header = rows.find((r) => r.kind === "header");
    const top = (header?.y ?? TOP) - 14;
    const bottom = Math.max(top + 40, ...members.map((m) => m.y + m.h + 10));
    return {
      id: g.id,
      x: groupCols.get(g.id) ?? groupX0,
      top,
      bottom,
      w: open ? CHIP_W + GROUP_PAD * 2 : GROUP_SPINE,
      open,
      members: g.members,
    };
  });

  // 핸드오프 고리
  const handoffs: Handoff[] = [];
  for (const c of chips) {
    const targets = pluginById(c.plugin)?.handoff ?? [];
    for (const target of targets) {
      const to = chips.find((d) => d.plugin === target);
      if (to === undefined) continue;
      handoffs.push({
        key: `h:${c.plugin}:${target}`,
        from: c.plugin,
        to: target,
        ax: c.x + c.w,
        bx: to.hidden ? to.x : to.x,
        y: c.y + c.h / 2,
      });
    }
  }

  const slots = o.dragging === null ? [] : slotsFor(profile, o.dragging, rows, chips);
  const stationRows = rows.filter((r) => r.kind === "station" || r.kind === "boundary");
  const firstStation = stationRows[0];
  const lastBoundary = rows.find((r) => r.boundary === "before-turn-end") ?? stationRows.at(-1);
  const input = rows.find((r) => r.boundary === "input-received") ?? firstStation;
  const recordRow = rows.find((r) => r.kind === "record");
  const rightMost = Math.max(
    groupX0,
    ...chips.map((c) => c.x + c.w),
    ...groups.map((g) => g.x + Math.max(g.w, GROUP_HEADER_W)),
    ...slots.map((s) => s.x + s.w),
  );
  return {
    width: rightMost + 16,
    height: y + 32,
    rows,
    chips,
    groups,
    wires,
    handoffs,
    slots,
    trunkTop: driveRow === undefined ? TOP : driveRow.y,
    trunkBottom: (lastBoundary?.y ?? y) + 14,
    loopEntry: (input?.y ?? TOP) - 14,
    recordY: recordRow?.y ?? y,
    emptyStart: startEntry === undefined,
  };
}

/** 끌고 있는 플러그인을 놓을 수 있는 자리들. 선언한 자리만 열린다 */
function slotsFor(
  profile: CanvasProfile,
  id: string,
  rows: readonly Row[],
  chips: readonly Chip[],
): Slot[] {
  const plugin = pluginById(id);
  if (plugin === undefined) return [];
  const slots: Slot[] = [];
  for (const point of plugin.points) {
    const row = rows.find((r) => r.point === point);
    if (row === undefined) continue;
    if (point === "drive") {
      if (profile.startDrive === null) {
        slots.push({
          key: "slot:start",
          point,
          index: 0,
          asStart: true,
          x: TRUNK_X - DRIVE_W / 2,
          y: row.y - DRIVE_H / 2,
          w: DRIVE_W,
          h: DRIVE_H,
        });
        continue;
      }
      const free = chips.filter((c) => c.point === "drive" && !c.start && c.group === null);
      const at = free.filter((c) => c.plugin !== id).length;
      slots.push({
        key: "slot:drive",
        point,
        index: at,
        asStart: false,
        x: CHIP_X0 + at * COL_STEP,
        y: row.y - CHIP_H / 2,
        w: CHIP_W,
        h: CHIP_H,
      });
      continue;
    }
    const tier = tierOf(id);
    const siblings = entriesAt(profile, point).filter(
      (e) => e.plugin !== id && tierOf(e.plugin) === tier,
    );
    const lead = entriesAt(profile, point).filter(
      (e) => e.plugin !== id && tierOf(e.plugin) < tier && groupOf(profile, e.plugin) === null,
    ).length;
    // 사이에 넣는 자리는 노드 사이의 가는 막대, 끝 자리는 노드 크기의 빈 틀이다
    for (let i = 0; i <= siblings.length; i += 1) {
      const col = lead + i;
      const end = i === siblings.length;
      slots.push({
        key: `slot:${point}:${i}`,
        point,
        index: i,
        asStart: false,
        x: end ? CHIP_X0 + col * COL_STEP : CHIP_X0 + col * COL_STEP - 15,
        y: row.y - CHIP_H / 2,
        w: end ? CHIP_W : 6,
        h: CHIP_H,
      });
    }
  }
  return slots;
}

/** 포인터에서 가장 가까운 놓을 자리(같은 줄 높이 안). 없으면 null */
export function nearestSlot(slots: readonly Slot[], x: number, y: number): Slot | null {
  let best: Slot | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const s of slots) {
    const cy = s.y + s.h / 2;
    if (Math.abs(y - cy) > 22) continue;
    const cx = s.x + s.w / 2;
    const d = Math.abs(x - cx);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}
