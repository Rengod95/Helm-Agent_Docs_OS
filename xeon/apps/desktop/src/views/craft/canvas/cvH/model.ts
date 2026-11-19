// cvH "선로"의 순수 모델: 프로필 바꾸기(넣기·빼기·순서·묶음)와 배치(본선·정거장·지선·묶음 역·관계 선)를 계산한다.
// 본선(코어 루프)은 y=0의 가로선이다. 정거장(블록·경계)과 Hook 자리(건널목)가 그 위에 왼쪽부터 선다.
// 플러그인은 본선에서 갈라져 나온 지선의 끝에 달린다. 종류마다 갈라지는 방식이 다르다:
//   Inject는 위에서 내려와 컨텍스트 조립 앞에서 본선에 합류하고, 도구는 도구 실행 뒤에서 위로 갈라지는 측선 끝(차막이)에 서고,
//   Hook은 자기 자리에서 본선을 가로지르는 건널목이고, Drive는 입력 받기에서 아래로 내려가는 자기 순환선이다.
// 묶음(플러그인 그룹)은 본선 아래 묶음 역(틀)에 구성원을 담고, 구성원마다 자기 자리로 지선을 올린다. 접으면 역 하나가 된다.
// 이 파일은 React와 화면을 모른다. 좌표는 React Flow의 흐름 좌표(px, 확대 1)다.
import type { SharedPlugin, SharedPoint, SharedProfile } from "../shared-sample.ts";
import { ALL_SHARED_PLUGINS } from "../shared-sample.ts";
import { extOf, type PartId } from "./sample-ext.ts";

export type Kind = SharedPlugin["kind"];

type StationId =
  | "conversation-start"
  | "input-received"
  | "context"
  | "model"
  | "tools"
  | "ask"
  | "agents"
  | "record"
  | "before-turn-end";

const BLOCKS: readonly StationId[] = ["context", "model", "tools", "ask", "agents", "record"];

/** 본선 위 자리 하나: 정거장 또는 Hook 건널목 */
export type SlotId = StationId | Exclude<SharedPoint, "before-turn-end">;

/** 왼쪽부터의 자리 순서(엔진의 블록 순서와 경계, Hook 자리) */
export const SLOTS: readonly SlotId[] = [
  "conversation-start",
  "input-received",
  "context",
  "model.before",
  "model",
  "tools.before",
  "tools",
  "tools.after",
  "ask",
  "agents",
  "record",
  "before-turn-end",
];

export function isBlock(id: SlotId): boolean {
  return BLOCKS.some((b) => b === id);
}

// ── 플러그인 ─────────────────────────────────────────────────────────

const BY_NAME: ReadonlyMap<string, SharedPlugin> = new Map(
  ALL_SHARED_PLUGINS.map((p) => [p.name, p]),
);

export function pluginOf(name: string): SharedPlugin | undefined {
  return BY_NAME.get(name);
}

export const ALL_PLUGINS: readonly SharedPlugin[] = ALL_SHARED_PLUGINS;

/** 플러그인이 붙는 본선 자리. Hook은 자기 자리, Inject는 컨텍스트 조립, 도구는 도구 실행, Drive는 입력 받기 */
export function slotOf(p: SharedPlugin): SlotId {
  if (p.kind === "inject") return "context";
  if (p.kind === "tool") return "tools";
  if (p.kind === "drive") return "input-received";
  return p.point ?? "tools.before";
}

/** 지선이 본선 위로 가나(Inject·도구), 아래로 가나(Hook·Drive) */
export function sideOf(kind: Kind): "above" | "below" {
  return kind === "inject" || kind === "tool" ? "above" : "below";
}

// ── 프로필 ───────────────────────────────────────────────────────────

export interface CanvasProfile {
  readonly id: string;
  readonly base: readonly string[];
  readonly plugins: readonly string[];
  readonly startDrive: string | null;
  readonly groups: SharedProfile["groups"];
}

export function fromShared(p: SharedProfile): CanvasProfile {
  return {
    id: p.id,
    base: p.base,
    plugins: p.plugins,
    startDrive: p.startDrive,
    groups: p.groups,
  };
}

/** 설치된 플러그인 그룹(표본의 묶음 전부). 프로필 "개발"의 묶음과 같다 */
export function installedGroups(profiles: readonly CanvasProfile[]): CanvasProfile["groups"] {
  const seen = new Map<string, CanvasProfile["groups"][number]>();
  for (const p of profiles) for (const g of p.groups) if (!seen.has(g.id)) seen.set(g.id, g);
  return [...seen.values()];
}

/** 프로필에 든 순서(베이스 먼저, 같은 이름은 처음 것) */
export function entriesOf(p: CanvasProfile): readonly string[] {
  const out: string[] = [];
  for (const n of [...p.base, ...p.plugins]) if (!out.includes(n)) out.push(n);
  return out;
}

export function hasPlugin(p: CanvasProfile, name: string): boolean {
  return entriesOf(p).includes(name);
}

export function isBase(p: CanvasProfile, name: string): boolean {
  return p.base.includes(name);
}

export function groupOfMember(
  groups: CanvasProfile["groups"],
  name: string,
): CanvasProfile["groups"][number] | undefined {
  return groups.find((g) => g.members.includes(name));
}

/** 넣기. 묶음의 구성원이면 묶음째로 든다(그룹은 `members`를 한 번에 켜고 끈다) */
export function addPlugin(
  p: CanvasProfile,
  name: string,
  installed: CanvasProfile["groups"],
): CanvasProfile {
  if (hasPlugin(p, name) || pluginOf(name) === undefined) return p;
  const group = groupOfMember(installed, name);
  if (group !== undefined) return addGroup(p, group);
  return { ...p, plugins: [...p.plugins, name] };
}

export function addGroup(p: CanvasProfile, g: CanvasProfile["groups"][number]): CanvasProfile {
  if (p.groups.some((x) => x.id === g.id)) return p;
  const plugins = [...p.plugins];
  for (const m of g.members) if (!hasPlugin(p, m)) plugins.push(m);
  return { ...p, plugins, groups: [...p.groups, g] };
}

export type RemoveRefusal = "base" | "member";

/** 빼기. 베이스와 묶음 구성원은 따로 뺄 수 없다(이유를 돌려준다) */
export function removePlugin(
  p: CanvasProfile,
  name: string,
):
  | { readonly ok: true; readonly profile: CanvasProfile }
  | { readonly ok: false; readonly why: RemoveRefusal } {
  if (isBase(p, name)) return { ok: false, why: "base" };
  if (groupOfMember(p.groups, name) !== undefined) return { ok: false, why: "member" };
  return {
    ok: true,
    profile: {
      ...p,
      plugins: p.plugins.filter((n) => n !== name),
      startDrive: p.startDrive === name ? null : p.startDrive,
    },
  };
}

export function removeGroup(p: CanvasProfile, id: string): CanvasProfile {
  const g = p.groups.find((x) => x.id === id);
  if (g === undefined) return p;
  return {
    ...p,
    plugins: p.plugins.filter((n) => !g.members.includes(n) || p.base.includes(n)),
    groups: p.groups.filter((x) => x.id !== id),
    startDrive: p.startDrive !== null && g.members.includes(p.startDrive) ? null : p.startDrive,
  };
}

/** 같은 지선(같은 자리, 묶음 밖)에 선 이름들, 프로필 순서대로 */
function dockMates(p: CanvasProfile, name: string): readonly string[] {
  const me = pluginOf(name);
  if (me === undefined) return [];
  return entriesOf(p).filter((n) => {
    const q = pluginOf(n);
    return q !== undefined && slotOf(q) === slotOf(me) && groupOfMember(p.groups, n) === undefined;
  });
}

/** 같은 지선 안에서 한 칸 앞(-1)이나 뒤(+1)로. 베이스는 움직이지 않고 베이스 앞으로 가지 않는다 */
export function movePlugin(p: CanvasProfile, name: string, dir: -1 | 1): CanvasProfile {
  if (isBase(p, name) || groupOfMember(p.groups, name) !== undefined) return p;
  const mates = dockMates(p, name).filter((n) => !isBase(p, n));
  const i = mates.indexOf(name);
  const other = mates[i + dir];
  if (i < 0 || other === undefined) return p;
  const plugins = [...p.plugins];
  const a = plugins.indexOf(name);
  const b = plugins.indexOf(other);
  plugins[a] = other;
  plugins[b] = name;
  return { ...p, plugins };
}

export function canMove(p: CanvasProfile, name: string, dir: -1 | 1): boolean {
  return movePlugin(p, name, dir) !== p;
}

export function setStartDrive(p: CanvasProfile, name: string): CanvasProfile {
  const q = pluginOf(name);
  if (q?.kind !== "drive" || !hasPlugin(p, name)) return p;
  return { ...p, startDrive: name };
}

// ── 확대 단계 ────────────────────────────────────────────────────────

/** 멀리(이름표), 가운데(머리와 하는 일 한 줄), 가까이(구성 요소와 상태까지) */
export type Tier = "far" | "mid" | "near";

const TIER_MID = 0.5;
const TIER_NEAR = 0.78;

export function tierOf(zoom: number): Tier {
  if (zoom < TIER_MID) return "far";
  if (zoom < TIER_NEAR) return "mid";
  return "near";
}

// ── 배치 ────────────────────────────────────────────────────────────

export const CARD_W = 240;
export const CARD_H = 156;
const GUTTER = 26;
const COL_GAP = 20;
const ROW_GAP = 16;
/** 지선 칸이 본선에서 떨어진 거리 */
const DOCK_OFF = 92;
/** 한 열에 서는 카드 수 */
/** 칸 하나의 줄 수: 기본 3, 가장 큰 칸이 크면 5까지 깊어진다(30개에서도 가로로 끝없이 늘지 않게) */
const DOCK_ROWS = 3;
const DOCK_ROWS_MAX = 5;

export function dockRows(largest: number): number {
  return Math.min(DOCK_ROWS_MAX, Math.max(DOCK_ROWS, Math.ceil(largest / 2)));
}
const COL_W = GUTTER + CARD_W + COL_GAP;
/** 블록 정거장(알약) 폭의 반 */
export const PILL_HALF = 68;
/** 아무것도 닿지 않는 블록 정거장(작은 알약) 폭의 반 */
export const QUIET_HALF = 48;
const GROUP_PAD = 18;
const GROUP_HEAD = 46;
export const INTERCHANGE_W = 248;
export const INTERCHANGE_H = 96;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface StationPlace {
  readonly id: SlotId;
  readonly x: number;
  /** 이 자리에 닿는 플러그인이 있다(묶음 구성원 포함) */
  readonly used: boolean;
}

interface CardPlace {
  readonly name: string;
  readonly rect: Rect;
  /** 같은 지선 안의 순서(1부터) */
  readonly order: number;
  /** 들어 있는 묶음(펼친 묶음 틀 안이면 그 id) */
  readonly group: string | null;
}

interface GroupPlace {
  readonly id: string;
  readonly rect: Rect;
  readonly folded: boolean;
  readonly members: readonly string[];
}

/** 선 한 줄. `role`이 그리기 모양을 정한다(색은 `kind`) */
export interface RailPath {
  readonly key: string;
  readonly d: string;
  readonly role: "trunk" | "return" | "feeder" | "stub" | "start-feeder" | "buffer" | "junction";
  readonly kind: Kind | null;
  /** 이 선의 주인 플러그인(또는 `group:<id>`). 고르면 밝힌다 */
  readonly owner: string | null;
}

export type RelationKind = "handoff" | "depends" | "replaces" | "creates" | "owns";

export interface Relation {
  readonly key: string;
  readonly kind: RelationKind;
  readonly from: string;
  /** 플러그인 이름, 블록 부품(`part:tool:edit`), 묶음(`group:<id>`) 또는 null(엔진이 찾지 못한 기능) */
  readonly to: string | null;
  /** 의존: 기능 id. 대체: 부품 id. 생성: 대화 id */
  readonly via: string | null;
  /** 의존인데 목록 안에 그 기능을 내는 플러그인이 없다(`requirement_unmet` 경고) */
  readonly unmet: boolean;
}

export interface RelationPath extends Relation {
  readonly d: string;
  /** 이름표 자리 */
  readonly label: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number; readonly angle: number };
}

interface SeedPlace {
  readonly key: string;
  readonly draft: string;
  readonly threadId: string;
  readonly rect: Rect;
}

export interface PartPlace {
  readonly part: PartId;
  readonly x: number;
  readonly y: number;
  readonly by: readonly string[];
}

export interface Layout {
  readonly stations: readonly StationPlace[];
  readonly cards: readonly CardPlace[];
  readonly groups: readonly GroupPlace[];
  readonly rails: readonly RailPath[];
  readonly relations: readonly RelationPath[];
  readonly seeds: readonly SeedPlace[];
  readonly parts: readonly PartPlace[];
  /** 선을 다 담는 상자(배경 판의 크기) */
  readonly bounds: Rect;
  /** 다음 턴 이름표 자리(되돌이 선 아래) */
  readonly returnLabel: { readonly x: number; readonly y: number };
}

interface Dock {
  readonly slot: SlotId;
  readonly side: "above" | "below";
  readonly names: readonly string[];
}

function dockWidth(n: number, depth: number): number {
  if (n === 0) return 0;
  return Math.ceil(n / depth) * COL_W - COL_GAP;
}

function dockDepth(n: number, depth: number): number {
  const rows = Math.min(n, depth);
  return rows === 0 ? 0 : DOCK_OFF + 18 + rows * CARD_H + (rows - 1) * ROW_GAP;
}

/** 지선이 본선에 닿는 x(정거장 가운데에서 비켜 선다) */
function attachX(slot: SlotId, x: number): number {
  if (slot === "context") return x - PILL_HALF - 46;
  if (slot === "tools") return x + PILL_HALF + 46;
  return x;
}

/** 정거장 사이의 가장 작은 거리(알약끼리, 건널목, 경계) */
function stationHalf(s: SlotId, used: boolean): number {
  if (!isBlock(s)) return 18;
  return used ? PILL_HALF : QUIET_HALF;
}

function minGap(a: SlotId, aUsed: boolean, b: SlotId, bUsed: boolean): number {
  // Inject 합류점(컨텍스트 왼쪽)과 도구 측선의 갈림(도구 실행 오른쪽)이 이웃 정거장에 겹치지 않게 띄운다
  const merge = (b === "context" && bUsed) || (a === "tools" && aUsed) ? 40 : 0;
  return stationHalf(a, aUsed) + stationHalf(b, bUsed) + 28 + merge;
}

const r2 = (v: number): number => Math.round(v * 10) / 10;

/** 모서리를 둥글린 직각 경로(점 목록). 꺾이는 곳마다 반지름 r */
export function orthoPath(
  points: readonly { readonly x: number; readonly y: number }[],
  r = 12,
): string {
  const first = points[0];
  if (first === undefined) return "";
  let d = `M${String(r2(first.x))} ${String(r2(first.y))}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p === undefined) continue;
    const prev = points[i - 1] ?? p;
    const next = points[i + 1];
    if (next === undefined) {
      d += ` L${String(r2(p.x))} ${String(r2(p.y))}`;
      continue;
    }
    const inLen = Math.hypot(p.x - prev.x, p.y - prev.y);
    const outLen = Math.hypot(next.x - p.x, next.y - p.y);
    const k = Math.min(r, inLen / 2, outLen / 2);
    if (k <= 0.5) {
      d += ` L${String(r2(p.x))} ${String(r2(p.y))}`;
      continue;
    }
    const ax = p.x - ((p.x - prev.x) / inLen) * k;
    const ay = p.y - ((p.y - prev.y) / inLen) * k;
    const bx = p.x + ((next.x - p.x) / outLen) * k;
    const by = p.y + ((next.y - p.y) / outLen) * k;
    d += ` L${String(r2(ax))} ${String(r2(ay))} Q${String(r2(p.x))} ${String(r2(p.y))} ${String(r2(bx))} ${String(r2(by))}`;
  }
  return d;
}

/**
 * 갈림 모양(본선에 닿는 짧은 곡선). `side`는 지선이 오는 쪽이다.
 * Inject 합류: 위(또는 아래)에서 내려와 오른쪽으로 휘며 본선에 들어간다.
 * 도구 측선: 본선에서 오른쪽으로 비스듬히 갈라져 나간다(전철기).
 * Hook 건널목: 본선을 곧게 가로질러 반대편으로 조금 넘어간다.
 * Drive 순환: 본선에서 내려가며 작은 고리를 한 번 돈다.
 */
function junction(kind: Kind, ax: number, side: "above" | "below", reach: number): string {
  const s = side === "above" ? -1 : 1;
  const y = (v: number): number => r2(v * s);
  if (kind === "inject")
    return `M${String(ax)} ${String(y(reach))} L${String(ax)} ${String(y(40))} C${String(ax)} ${String(y(14))} ${String(ax + 16)} 0 ${String(ax + 44)} 0`;
  if (kind === "tool")
    return `M${String(ax - 52)} 0 C${String(ax - 24)} 0 ${String(ax)} ${String(y(14))} ${String(ax)} ${String(y(40))} L${String(ax)} ${String(y(reach))}`;
  if (kind === "hook") return `M${String(ax)} ${String(y(-26))} L${String(ax)} ${String(y(reach))}`;
  // Drive: 본선에서 내려와 반지름 11의 고리를 돌고 다시 내려간다
  return `M${String(ax)} 0 L${String(ax)} ${String(y(22))} A11 11 0 1 1 ${String(ax + 0.1)} ${String(y(22))} L${String(ax)} ${String(y(reach))}`;
}

export interface LayoutInput {
  readonly profile: CanvasProfile;
  readonly folded: ReadonlySet<string>;
}

export function layoutProfile(input: LayoutInput): Layout {
  const { profile, folded } = input;
  const entries = entriesOf(profile).filter((n) => pluginOf(n) !== undefined);
  const grouped = new Set(profile.groups.flatMap((g) => g.members));

  // 1. 지선 칸: 묶음 밖의 플러그인을 자리마다 모은다
  const raw = SLOTS.map((slot) => {
    const names = entries.filter((n) => {
      const p = pluginOf(n);
      return p !== undefined && !grouped.has(n) && slotOf(p) === slot;
    });
    const first = names[0];
    const kind = first === undefined ? null : (pluginOf(first)?.kind ?? null);
    return { slot, kind, names };
  });

  const depth = dockRows(Math.max(0, ...raw.map((d) => d.names.length)));

  // 2. 정거장 x: 위·아래 칸이 서로 겹치지 않게 두 커서로 민다.
  //    Hook은 건널목이라 본선의 어느 쪽에도 설 수 있다: 더 일찍(왼쪽에) 놓이는 쪽을 고른다(같으면 아래)
  const stations: StationPlace[] = [];
  const docks: Dock[] = [];
  let x = 0;
  let above = Number.NEGATIVE_INFINITY;
  let below = Number.NEGATIVE_INFINITY;
  let prev: { slot: SlotId; used: boolean } | null = null;
  const usedSlots = new Set(
    entries.flatMap((n) => {
      const p = pluginOf(n);
      return p === undefined ? [] : [slotOf(p)];
    }),
  );
  for (const d of raw) {
    const used = usedSlots.has(d.slot);
    const base = prev === null ? 0 : x + minGap(prev.slot, prev.used, d.slot, used);
    const w = dockWidth(d.names.length, depth);
    // 칸 왼쪽 = 닿는 x - GUTTER/2. 닿는 x와 정거장 x의 차이를 되돌려 정거장 x를 구한다
    const need = (cursor: number): number =>
      w === 0 ? base : Math.max(base, cursor + 36 + GUTTER / 2 - attachX(d.slot, 0));
    let side: "above" | "below" = d.kind === null ? "below" : sideOf(d.kind);
    if (d.kind === "hook" && need(above) < need(below)) side = "above";
    x = need(side === "above" ? above : below);
    stations.push({ id: d.slot, x, used });
    docks.push({ slot: d.slot, side, names: d.names });
    if (w > 0) {
      const left = attachX(d.slot, x) - GUTTER / 2;
      if (side === "above") above = left + w;
      else below = left + w;
    }
    prev = { slot: d.slot, used };
  }
  const xOf = (slot: SlotId): number => stations.find((s) => s.id === slot)?.x ?? 0;

  // 3. 카드와 지선
  const cards: CardPlace[] = [];
  const rails: RailPath[] = [];
  for (const dock of docks) {
    if (dock.names.length === 0) continue;
    const ax = attachX(dock.slot, xOf(dock.slot));
    const s = dock.side === "above" ? -1 : 1;
    const cols = Math.ceil(dock.names.length / depth);
    const rows = Math.min(dock.names.length, depth);
    const lastMid = DOCK_OFF + 18 + (rows - 1) * (CARD_H + ROW_GAP) + CARD_H / 2;
    const first = pluginOf(dock.names[0] ?? "");
    const kind = first?.kind ?? "inject";
    // 갈림과 첫 열의 줄기
    rails.push({
      key: `junction:${dock.slot}`,
      d: junction(kind, ax, dock.side, DOCK_OFF),
      role: "junction",
      kind,
      owner: null,
    });
    // 칸 머리의 나눔 선(열이 둘 이상이면)
    if (cols > 1) {
      rails.push({
        key: `spread:${dock.slot}`,
        d: orthoPath([
          { x: ax, y: s * DOCK_OFF },
          { x: ax + (cols - 1) * COL_W, y: s * DOCK_OFF },
        ]),
        role: "feeder",
        kind,
        owner: null,
      });
    }
    for (let c = 0; c < cols; c++) {
      const gx = ax + c * COL_W;
      const inCol = Math.min(depth, dock.names.length - c * depth);
      const mid = DOCK_OFF + 18 + (inCol - 1) * (CARD_H + ROW_GAP) + CARD_H / 2;
      rails.push({
        key: `col:${dock.slot}:${String(c)}`,
        d: orthoPath([
          { x: gx, y: s * DOCK_OFF },
          { x: gx, y: s * Math.min(mid, lastMid) },
        ]),
        role: "feeder",
        kind,
        owner: null,
      });
    }
    dock.names.forEach((name, i) => {
      const c = Math.floor(i / depth);
      const r = i % depth;
      const gx = ax + c * COL_W;
      const top = DOCK_OFF + 18 + r * (CARD_H + ROW_GAP);
      const y = dock.side === "above" ? -(top + CARD_H) : top;
      const rect = { x: gx + GUTTER / 2, y, w: CARD_W, h: CARD_H };
      cards.push({ name, rect, order: i + 1, group: null });
      const my = y + CARD_H / 2;
      rails.push({
        key: `stub:${name}`,
        d: `M${String(gx)} ${String(my)} L${String(rect.x)} ${String(my)}`,
        role: profile.startDrive === name ? "start-feeder" : "stub",
        kind,
        owner: name,
      });
      if (kind === "tool") {
        // 측선의 끝: 차막이
        rails.push({
          key: `buffer:${name}`,
          d: `M${String(rect.x - 4)} ${String(my - 9)} L${String(rect.x - 4)} ${String(my + 9)}`,
          role: "buffer",
          kind,
          owner: name,
        });
      }
    });
  }

  // 4. 묶음 역: 아래 칸들과 같은 높이에서 그 오른쪽에 선다(아래로 쌓으면 화면이 길어진다). 구성원 지선은 통로를 지나 자기 자리로 오른다
  const belowDepth = Math.max(
    0,
    ...docks.filter((d) => d.side === "below").map((d) => dockDepth(d.names.length, depth)),
  );
  const groupTop = DOCK_OFF + 18;
  const groups: GroupPlace[] = [];
  const rejoinX = xOf("input-received") - 54;
  let groupCursor = Math.max(rejoinX + 28, below + 56);
  profile.groups.forEach((g, gi) => {
    const members = g.members.filter((m) => entries.includes(m));
    const isFolded = folded.has(g.id);
    const w = isFolded
      ? INTERCHANGE_W
      : GROUP_PAD * 2 + members.length * CARD_W + Math.max(0, members.length - 1) * 18;
    const h = isFolded ? INTERCHANGE_H : GROUP_HEAD + CARD_H + GROUP_PAD;
    const gx = groupCursor;
    const rect = { x: gx, y: groupTop, w, h };
    groups.push({ id: g.id, rect, folded: isFolded, members });
    groupCursor = gx + w + 48;
    members.forEach((m, i) => {
      const p = pluginOf(m);
      if (p === undefined) return;
      const slot = slotOf(p);
      // 아래쪽 지선 칸의 줄기(닿는 x)와 겹치지 않게 왼쪽으로 비켜 오른다
      const ax = attachX(slot, xOf(slot)) - 12 - gi * 10;
      const cardRect = {
        x: gx + GROUP_PAD + i * (CARD_W + 18),
        y: groupTop + GROUP_HEAD,
        w: CARD_W,
        h: CARD_H,
      };
      if (!isFolded) cards.push({ name: m, rect: cardRect, order: i + 1, group: g.id });
      const doorX = isFolded
        ? gx + ((i + 1) * INTERCHANGE_W) / (members.length + 1)
        : cardRect.x + CARD_W / 2;
      const corridor = 62 + gi * 6 + i * 8;
      const pts = [
        { x: doorX, y: groupTop },
        { x: doorX, y: corridor },
        { x: ax, y: corridor },
      ];
      rails.push({
        key: `member:${g.id}:${m}`,
        d: orthoPath(pts, 14),
        role: profile.startDrive === m ? "start-feeder" : "feeder",
        kind: p.kind,
        owner: m,
      });
      rails.push({
        key: `member-junction:${g.id}:${m}`,
        d: memberJunction(p.kind, ax, corridor),
        role: "junction",
        kind: p.kind,
        owner: m,
      });
    });
  });

  // 5. 본선과 되돌이: 대화 시작은 고리 밖의 출발점, 다음 턴은 입력 받기 앞에서 다시 합류한다
  const firstX = xOf("conversation-start");
  const endX = xOf("before-turn-end");
  const rightEdge = Math.max(
    endX + 40,
    ...cards.map((c) => c.rect.x + c.rect.w + 40),
    ...groups.map((g) => g.rect.x + g.rect.w + 40),
  );
  const bottom =
    Math.max(
      belowDepth,
      ...groups.map((g) => g.rect.y + g.rect.h),
      ...cards.filter((c) => c.rect.y > 0).map((c) => c.rect.y + c.rect.h),
    ) + 58;
  rails.unshift(
    {
      key: "trunk",
      d: `M${String(firstX)} 0 L${String(rightEdge)} 0`,
      role: "trunk",
      kind: null,
      owner: null,
    },
    {
      key: "return",
      d: `${orthoPath(
        [
          { x: rightEdge - 1, y: 0 },
          { x: rightEdge + 36, y: 0 },
          { x: rightEdge + 36, y: bottom },
          { x: rejoinX - 36, y: bottom },
          { x: rejoinX - 36, y: 40 },
        ],
        36,
      )} C${String(rejoinX - 36)} 12 ${String(rejoinX - 20)} 0 ${String(rejoinX + 6)} 0`,
      role: "return",
      kind: null,
      owner: null,
    },
  );

  // 6. 관계와 블록 부품, 드래프트의 출처
  const rects = new Map(cards.map((c) => [c.name, c.rect]));
  for (const g of groups) rects.set(`group:${g.id}`, g.rect);
  const parts = partsOf(entries, xOf("tools"));
  const seeds = seedsOf(entries, rects, bottom);
  const relations = relationPaths(relationsOf(profile), rects, parts, seeds, groups);

  const xs = [firstX - 40, rejoinX - 60, rightEdge + 60, ...seeds.map((s) => s.rect.x - 20)];
  const top = Math.min(
    -60,
    ...cards.map((c) => c.rect.y - 30),
    ...parts.map((p) => p.y - 30),
    ...seeds.map((s) => s.rect.y - 24),
  );
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  return {
    stations,
    cards,
    groups,
    rails,
    relations,
    seeds,
    parts,
    bounds: {
      x: left,
      y: top,
      w: right - left,
      h: Math.max(bottom + 60, ...seeds.map((s) => s.rect.y + s.rect.h + 30)) - top,
    },
    returnLabel: { x: (rejoinX + rightEdge) / 2, y: bottom },
  };
}

/** 묶음 구성원의 지선이 통로에서 본선으로 올라가는 끝. 종류마다 갈림 모양이 같다(아래에서 온다) */
function memberJunction(kind: Kind, ax: number, corridor: number): string {
  if (kind === "inject")
    return `M${String(ax)} ${String(corridor)} L${String(ax)} 40 C${String(ax)} 14 ${String(ax + 16)} 0 ${String(ax + 44)} 0`;
  if (kind === "tool")
    return `M${String(ax)} ${String(corridor)} L${String(ax)} 40 C${String(ax)} 14 ${String(ax - 24)} 0 ${String(ax - 52)} 0`;
  if (kind === "hook") return `M${String(ax)} ${String(corridor)} L${String(ax)} -26`;
  return `M${String(ax)} ${String(corridor)} L${String(ax)} 33 A11 11 0 1 0 ${String(ax - 0.1)} 33 L${String(ax)} 0`;
}

/** 대체된 블록 부품: 도구 실행 정거장 위의 작은 표 */
function partsOf(entries: readonly string[], toolsX: number): PartPlace[] {
  const by = new Map<PartId, string[]>();
  for (const n of entries) {
    for (const part of extOf(n)?.replaces ?? []) {
      const list = by.get(part) ?? [];
      list.push(n);
      by.set(part, list);
    }
  }
  return [...by.entries()].map(([part, names], i) => ({
    part,
    x: toolsX - 40 + i * 64,
    y: -46,
    by: names,
  }));
}

/** 드래프트마다 그것을 만든 대화(출처). 드래프트 카드 바로 바깥(위 칸이면 맨 위, 아래 칸이면 되돌이 아래)에 선다 */
function seedsOf(
  entries: readonly string[],
  rects: ReadonlyMap<string, Rect>,
  bottom: number,
): SeedPlace[] {
  const out: SeedPlace[] = [];
  const top = Math.min(0, ...[...rects.values()].map((r) => r.y));
  for (const n of entries) {
    const thread = extOf(n)?.origin.createdIn?.threadId;
    const card = rects.get(n);
    if (thread === undefined || card === undefined) continue;
    const above = card.y < 0;
    const sameRow = out.filter(
      (s) => s.rect.y < 0 === above && Math.abs(s.rect.x - card.x) < 200,
    ).length;
    out.push({
      key: `seed:${n}`,
      draft: n,
      threadId: thread,
      rect: { x: card.x + 22 + sameRow * 210, y: above ? top - 86 : bottom + 30, w: 196, h: 52 },
    });
  }
  return out;
}

/** 프로필 안에서 엔진에 있는 관계: 소유(묶음), 핸드오프, 의존(기능), 대체(블록 부품), 생성(드래프트의 출처 대화) */
export function relationsOf(profile: CanvasProfile): readonly Relation[] {
  const entries = entriesOf(profile).filter((n) => pluginOf(n) !== undefined);
  const out: Relation[] = [];
  for (const g of profile.groups) {
    for (const m of g.members) {
      if (entries.includes(m))
        out.push({
          key: `owns:${g.id}:${m}`,
          kind: "owns",
          from: `group:${g.id}`,
          to: m,
          via: null,
          unmet: false,
        });
    }
  }
  for (const n of entries) {
    const p = pluginOf(n);
    const ext = extOf(n);
    if (p === undefined) continue;
    for (const to of p.handoffTo ?? []) {
      if (entries.includes(to))
        out.push({
          key: `handoff:${n}:${to}`,
          kind: "handoff",
          from: n,
          to,
          via: null,
          unmet: false,
        });
    }
    for (const req of ext?.requires ?? []) {
      const provider = entries.find((m) => (extOf(m)?.provides ?? []).some((c) => c.id === req.id));
      out.push({
        key: `depends:${n}:${req.id}`,
        kind: "depends",
        from: n,
        to: provider ?? null,
        via: req.id,
        unmet: provider === undefined,
      });
    }
    for (const part of ext?.replaces ?? []) {
      out.push({
        key: `replaces:${n}:${part}`,
        kind: "replaces",
        from: n,
        to: `part:${part}`,
        via: part,
        unmet: false,
      });
    }
    const thread = ext?.origin.createdIn?.threadId;
    if (thread !== undefined) {
      out.push({
        key: `creates:${n}`,
        kind: "creates",
        from: `seed:${n}`,
        to: n,
        via: thread,
        unmet: false,
      });
    }
  }
  return out;
}

function centreOf(r: Rect): { readonly x: number; readonly y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** 상자 가장자리에서 다른 점을 향하는 점 */
function edgeToward(
  r: Rect,
  to: { readonly x: number; readonly y: number },
): { x: number; y: number } {
  const c = centreOf(r);
  const dx = to.x - c.x;
  const dy = to.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const sx = dx === 0 ? Number.POSITIVE_INFINITY : r.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Number.POSITIVE_INFINITY : r.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

/** 관계 선은 본선·지선(직각)과 달리 부드러운 곡선이다 */
function curve(
  a: { x: number; y: number },
  b: { x: number; y: number },
  bend: number,
): {
  readonly d: string;
  readonly mid: { readonly x: number; readonly y: number };
  readonly angle: number;
} {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const cx = mx + nx * bend;
  const cy = my + ny * bend;
  const angle = (Math.atan2(b.y - cy, b.x - cx) * 180) / Math.PI;
  return {
    d: `M${String(r2(a.x))} ${String(r2(a.y))} Q${String(r2(cx))} ${String(r2(cy))} ${String(r2(b.x))} ${String(r2(b.y))}`,
    mid: { x: r2((a.x + 2 * cx + b.x) / 4), y: r2((a.y + 2 * cy + b.y) / 4) },
    angle: r2(angle),
  };
}

/** 두 카드의 밑변 가운데를 카드 아래로 휘어 잇는다. 끝은 위를 향한다 */
function underCurve(
  from: Rect,
  to: Rect,
): {
  readonly d: string;
  readonly mid: { x: number; y: number };
  readonly end: { x: number; y: number; angle: number };
} {
  const a = { x: from.x + from.w / 2, y: from.y + from.h };
  const b = { x: to.x + to.w / 2, y: to.y + to.h };
  const c = Math.max(a.y, b.y) + 34;
  return {
    d: `M${String(r2(a.x))} ${String(r2(a.y))} C${String(r2(a.x))} ${String(r2(c))} ${String(r2(b.x))} ${String(r2(c))} ${String(r2(b.x))} ${String(r2(b.y))}`,
    mid: { x: r2((a.x + b.x) / 2), y: r2((a.y + 6 * c + b.y) / 8) },
    end: { x: r2(b.x), y: r2(b.y), angle: -90 },
  };
}

function relationPaths(
  relations: readonly Relation[],
  rects: ReadonlyMap<string, Rect>,
  parts: readonly PartPlace[],
  seeds: readonly SeedPlace[],
  groups: readonly GroupPlace[],
): RelationPath[] {
  const seedRect = new Map(seeds.map((s) => [s.key, s.rect]));
  const out: RelationPath[] = [];
  for (const rel of relations) {
    if (rel.kind === "owns") continue; // 소유는 묶음 틀(담음)이 그린다
    const fromRect = rects.get(rel.from) ?? seedRect.get(rel.from);
    if (fromRect === undefined) continue;
    let toPoint: { x: number; y: number } | null = null;
    if (rel.to !== null && rel.to.startsWith("part:")) {
      const part = parts.find((p) => `part:${p.part}` === rel.to);
      if (part !== undefined) toPoint = { x: part.x, y: part.y + 12 };
    } else if (rel.to !== null) {
      const r = rects.get(rel.to) ?? foldedRect(groups, rel.to, rects);
      if (r !== undefined) toPoint = edgeToward(r, centreOf(fromRect));
    } else {
      // 찾지 못한 기능: 카드 오른쪽 위로 짧게 나간 빈 소켓
      toPoint = { x: fromRect.x + fromRect.w + 54, y: fromRect.y - 24 };
    }
    if (toPoint === null) continue;
    const toRect =
      rel.to === null ? undefined : (rects.get(rel.to) ?? foldedRect(groups, rel.to, rects));
    if (rel.kind === "handoff" && toRect !== undefined && fromRect.y > 0 && toRect.y > 0) {
      // 핸드오프는 본선 아래 칸끼리 오간다: 카드 밑을 지나 다음 Drive의 밑으로 들어간다(카드를 가로지르지 않는다)
      const c = underCurve(fromRect, toRect);
      out.push({ ...rel, d: c.d, label: c.mid, end: c.end });
      continue;
    }
    const a = edgeToward(fromRect, toPoint);
    const bend = rel.kind === "handoff" ? -46 : rel.kind === "creates" ? 30 : 24;
    const c = curve(a, toPoint, bend);
    out.push({ ...rel, d: c.d, label: c.mid, end: { x: toPoint.x, y: toPoint.y, angle: c.angle } });
  }
  return out;
}

/** 접힌 묶음의 구성원은 묶음 역으로 잇는다 */
function foldedRect(
  groups: readonly GroupPlace[],
  name: string,
  rects: ReadonlyMap<string, Rect>,
): Rect | undefined {
  const g = groups.find((x) => x.folded && x.members.includes(name));
  return g === undefined ? undefined : rects.get(`group:${g.id}`);
}

/** 패널에서 고른 이름이 캔버스의 어느 상자인가(접힌 묶음의 구성원은 묶음 역) */
export function focusRect(layout: Layout, name: string): Rect | undefined {
  const card = layout.cards.find((c) => c.name === name);
  if (card !== undefined) return card.rect;
  if (name.startsWith("group:")) return layout.groups.find((g) => `group:${g.id}` === name)?.rect;
  return layout.groups.find((g) => g.members.includes(name))?.rect;
}
