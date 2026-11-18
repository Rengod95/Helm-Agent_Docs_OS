// cvC 프로필 캔버스의 순수 모델: 프로필 하나를 "루프의 어느 지점에 무엇이 어떤 순서로 붙나"로 옮기고, 그림의 자리(px)를 정한다.
// 지점 순서와 Hook의 자리는 엔진 상수 `BLOCK_MODEL`(contracts)에서 읽는다: 훅 이름이 어느 블록의 before·after나 어느 경계에 있는지.
// Inject는 그 종류를 받는 블록의 몸통(`in`)에 들어간다(BLOCK_MODEL의 `inject`). Drive는 지점에 붙지 않고 루프를 쥔다(위쪽 Drive 줄).
// 같은 자리의 순서: 베이스가 먼저, Hook은 가드 등급이 먼저, 그다음 프로필의 플러그인 순서. 그 앞으로는 놓을 수 없다.
import { BLOCK_MODEL } from "@fresnel/contracts/blocks";
import {
  BASE,
  pluginOf,
  type GiveKind,
  type PluginKind,
  type SampleGroup,
  type SampleProfile,
} from "./sample.ts";

/** 그림에 올리는 지점. 기록 블록은 이벤트만 있어 붙을 자리가 없으므로 올리지 않는다 */
export type PointId =
  | "conversation-start"
  | "input-received"
  | "context"
  | "model"
  | "tools"
  | "ask"
  | "agents"
  | "before-turn-end";

/** 턴 바깥(한 번)과 턴 안(반복)의 지점 순서 */
export const POINTS: readonly PointId[] = [
  "conversation-start",
  "input-received",
  "context",
  "model",
  "tools",
  "ask",
  "agents",
  "before-turn-end",
];

const BOUNDARIES: ReadonlySet<PointId> = new Set<PointId>([
  "conversation-start",
  "input-received",
  "before-turn-end",
]);

export function isBoundary(point: PointId): boolean {
  return BOUNDARIES.has(point);
}

/** 지점 안의 칸: 블록 앞(before), 몸통(in), 뒤(after), 경계(at) */
export type Side = "before" | "in" | "after" | "at";

/** 플러그인이 놓이는 곳. Drive는 줄(lane) */
export type Place =
  | { readonly lane: "point"; readonly point: PointId; readonly side: Side }
  | { readonly lane: "drive" };

/** 표본의 주는 것 → BLOCK_MODEL의 주입 종류 */
const GIVE_INJECT: Readonly<Record<GiveKind, string>> = {
  instructions: "instructions",
  skill: "skill",
  memory: "instructions",
  mcp: "mcp-server",
  tool: "tool",
};

function pointOfBlock(id: string): PointId | null {
  return POINTS.find((p) => p === id) ?? null;
}

/** 훅 이름의 자리. BLOCK_MODEL의 블록 앞·뒤, 경계 순으로 찾는다 */
function placeOfHook(hook: string): Place | null {
  for (const block of BLOCK_MODEL.blocks) {
    const point = pointOfBlock(block.id);
    if (point === null) continue;
    if (block.hooks.before.some((h) => h === hook)) return { lane: "point", point, side: "before" };
    if (block.hooks.after.some((h) => h === hook)) return { lane: "point", point, side: "after" };
  }
  for (const boundary of BLOCK_MODEL.boundaries) {
    const point = pointOfBlock(boundary.id);
    if (point !== null && boundary.hooks.some((h) => h === hook)) {
      return { lane: "point", point, side: "at" };
    }
  }
  return null;
}

/** 주는 것을 받는 첫 블록(몸통) */
function placeOfGive(give: GiveKind): Place | null {
  const kind = GIVE_INJECT[give];
  for (const block of BLOCK_MODEL.blocks) {
    const point = pointOfBlock(block.id);
    if (point !== null && block.inject.some((k) => k === kind)) {
      return { lane: "point", point, side: "in" };
    }
  }
  return null;
}

/** 플러그인 이름의 자리. 표본에 없거나 자리를 모르면 null */
export function placeOf(name: string): Place | null {
  const plugin = pluginOf(name);
  if (plugin === undefined) return null;
  if (plugin.kind === "drive") return { lane: "drive" };
  if (plugin.kind === "hook") return plugin.hook === undefined ? null : placeOfHook(plugin.hook);
  // 도구는 실행 블록이 받는 것(mcp·tool)을, Inject는 첫 주는 것을 본다
  const gives = plugin.gives ?? [];
  const first = plugin.kind === "tool" ? gives.find((g) => g.what !== "instructions") : gives[0];
  return first === undefined ? null : placeOfGive(first.what);
}

export function samePlace(a: Place, b: Place): boolean {
  if (a.lane === "drive" || b.lane === "drive") return a.lane === b.lane;
  return a.point === b.point && a.side === b.side;
}

/** 프로필의 플러그인 하나가 어디서 왔나 */
type Source = "base" | "profile" | "draft";

export interface Member {
  readonly name: string;
  readonly kind: PluginKind;
  readonly source: Source;
  /** 이 자리에서 앞을 내줄 수 없는 것(베이스, 가드) */
  readonly fixed: boolean;
}

/** 칸 안의 한 장: 플러그인이거나 접힌 묶음 */
export type Card =
  | ({ readonly type: "plugin" } & Member)
  | { readonly type: "group"; readonly group: SampleGroup; readonly kinds: readonly PluginKind[] };

export function cardKey(card: Card): string {
  return card.type === "plugin" ? card.name : `group:${card.group.id}`;
}

/** 프로필에 실제로 드는 이름 순서: 베이스가 먼저, 그다음 프로필 순서 */
export function effectiveNames(profile: SampleProfile): readonly string[] {
  const out = [...BASE];
  for (const name of profile.plugins) if (!out.includes(name)) out.push(name);
  return out;
}

function memberOf(profile: SampleProfile, name: string): Member | null {
  const plugin = pluginOf(name);
  if (plugin === undefined) return null;
  const base = BASE.includes(name);
  const source: Source = base ? "base" : profile.drafts.includes(name) ? "draft" : "profile";
  return { name, kind: plugin.kind, source, fixed: base || plugin.guard === true };
}

/** 한 자리의 플러그인을 실행 순서로: 고정(베이스·가드)이 먼저, 그 안과 밖은 실제 순서. Drive 줄은 스타트 Drive가 먼저 */
export function membersAt(profile: SampleProfile, place: Place): readonly Member[] {
  const all: Member[] = [];
  for (const name of effectiveNames(profile)) {
    const at = placeOf(name);
    const member = memberOf(profile, name);
    if (at !== null && member !== null && samePlace(at, place)) all.push(member);
  }
  const fixed = all.filter((m) => m.fixed);
  const rest = all.filter((m) => !m.fixed);
  const ordered = [...fixed, ...rest];
  if (place.lane !== "drive" || profile.startDrive === null) return ordered;
  const start = ordered.find((m) => m.name === profile.startDrive);
  return start === undefined ? ordered : [start, ...ordered.filter((m) => m !== start)];
}

/** 접힌 묶음을 적용한 칸. 묶음은 첫 구성원의 자리(지점 먼저, 그다음 Drive 줄)에 한 장으로 서고 나머지 구성원은 숨는다 */
export function cardsAt(
  profile: SampleProfile,
  place: Place,
  collapsed: ReadonlySet<string>,
): readonly Card[] {
  const out: Card[] = [];
  for (const m of membersAt(profile, place)) {
    const group = profile.groups.find((g) => collapsed.has(g.id) && g.members.includes(m.name));
    if (group === undefined) {
      out.push({ type: "plugin", ...m });
      continue;
    }
    if (anchorOfGroup(profile, group) === m.name) {
      const kinds = group.members.flatMap((n) => {
        const p = pluginOf(n);
        return p === undefined ? [] : [p.kind];
      });
      out.push({ type: "group", group, kinds });
    }
  }
  return out;
}

/** 칸의 차례(묶음 자리 고르기용) */
const SIDES: readonly Side[] = ["at", "before", "in", "after"];

/** 지점 순서의 자리 값(묶음이 설 자리를 고를 때) */
function rankOf(n: string): number {
  const at = placeOf(n);
  if (at === null) return Number.MAX_SAFE_INTEGER;
  if (at.lane === "drive") return POINTS.length * 10;
  return POINTS.indexOf(at.point) * 10 + SIDES.indexOf(at.side);
}

/** 묶음이 접혔을 때 설 자리의 구성원: 지점 순서에서 먼저 나오는 것 */
export function anchorOfGroup(profile: SampleProfile, group: SampleGroup): string | null {
  const names = effectiveNames(profile).filter((n) => group.members.includes(n));
  const sorted = names.toSorted((a, b) => rankOf(a) - rankOf(b));
  return sorted[0] ?? null;
}

/** 지점의 칸 차례. 블록은 앞 → 몸통 → 뒤, 경계는 하나 */
function sidesOf(point: PointId): readonly Side[] {
  return isBoundary(point) ? ["at"] : ["before", "in", "after"];
}

// ── 바꾸기(프로필 순서) ─────────────────────────────────────────────

/** 자리 안에서 처음 놓을 수 있는 칸(고정된 것 뒤) */
export function minIndexAt(profile: SampleProfile, place: Place): number {
  return membersAt(profile, place).filter((m) => m.fixed).length;
}

/** 프로필에서 뺀다. 베이스는 프로필에서 뺄 수 없다 */
export function removePlugin(profile: SampleProfile, name: string): SampleProfile {
  if (!profile.plugins.includes(name)) return profile;
  return {
    ...profile,
    plugins: profile.plugins.filter((n) => n !== name),
    startDrive: profile.startDrive === name ? null : profile.startDrive,
    drafts: profile.drafts.filter((n) => n !== name),
  };
}

/**
 * 자리 `place`의 `index`번째 칸(실행 순서, 고정 포함)에 놓는다. 이미 프로필에 있으면 옮긴다.
 * 프로필 목록에서는 그 칸 뒤에 오는 같은 자리의 첫 플러그인 앞에 끼운다. 없으면 같은 자리의 마지막 뒤, 그것도 없으면 끝.
 * Drive 줄의 첫 칸에 놓으면 스타트 Drive가 된다.
 */
export function placePlugin(
  profile: SampleProfile,
  name: string,
  place: Place,
  index: number,
): SampleProfile {
  const at = placeOf(name);
  if (at === null || !samePlace(at, place) || BASE.includes(name)) return profile;
  const without = removePlugin(profile, name);
  const keepDraft = profile.drafts.includes(name);
  const members = membersAt(without, place);
  const clamped = Math.max(minIndexAt(without, place), Math.min(index, members.length));
  const after = members.slice(clamped).find((m) => without.plugins.includes(m.name));
  const list = [...without.plugins];
  if (after !== undefined) {
    list.splice(list.indexOf(after.name), 0, name);
  } else {
    const before = members.slice(0, clamped).filter((m) => without.plugins.includes(m.name));
    const last = before.at(-1);
    if (last === undefined) list.push(name);
    else list.splice(list.indexOf(last.name) + 1, 0, name);
  }
  const startDrive =
    place.lane === "drive" && clamped === 0
      ? name
      : profile.startDrive === name
        ? (members[0]?.name ?? null)
        : without.startDrive;
  return {
    ...without,
    plugins: list,
    startDrive: place.lane === "drive" ? startDrive : without.startDrive,
    drafts: keepDraft ? [...without.drafts, name] : without.drafts,
  };
}

/** 같은 자리 안에서 한 칸 앞(-1)이나 뒤(+1)로 */
export function nudgePlugin(profile: SampleProfile, name: string, delta: -1 | 1): SampleProfile {
  const at = placeOf(name);
  if (at === null) return profile;
  const members = membersAt(profile, at);
  const index = members.findIndex((m) => m.name === name);
  if (index < 0) return profile;
  const target = index + delta;
  if (target < minIndexAt(profile, at) || target >= members.length) return profile;
  // 자기를 뺀 목록에서의 칸 번호가 곧 target이다(앞뒤 어느 쪽이든)
  return placePlugin(profile, name, at, target);
}

/** 프로필 밖의 설치된 플러그인(왼쪽 목록에서 끌어올 것) */
export function outsideNames(
  profile: SampleProfile,
  catalog: readonly string[],
): readonly string[] {
  const inside = effectiveNames(profile);
  return catalog.filter((n) => !inside.includes(n));
}

// ── 그림의 자리(px, 세계 좌표) ───────────────────────────────────────

export const GEO = {
  header: 44,
  pad: 12,
  cardH: 52,
  gap: 8,
  slotIdle: 14,
  stationW: 220,
  stationEmptyW: 136,
  spineGap: 36,
  rowGap: 60,
  driveW: 208,
  driveH: 60,
  driveGap: 84,
  driveY: -164,
  frameTop: -30,
  railX: 22,
  cardX: 34,
} as const;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface CardBox {
  readonly card: Card;
  readonly place: Place;
  /** 자리 안의 실행 순서(0부터, 고정 포함) */
  readonly index: number;
  readonly rect: Rect;
}

export interface SlotBox {
  readonly place: Place;
  readonly index: number;
  readonly rect: Rect;
  readonly hot: boolean;
}

export interface StationBox {
  readonly point: PointId;
  readonly rect: Rect;
  /** 블록의 몸통(Inject가 들어가는 우물). 경계는 없다 */
  readonly body: Rect | null;
  readonly count: number;
  /** 끄는 것이 여기 놓일 수 있다 */
  readonly open: boolean;
}

export interface Layout {
  readonly stations: readonly StationBox[];
  readonly cards: readonly CardBox[];
  readonly slots: readonly SlotBox[];
  /** 턴을 두르는 틀(대화 시작은 바깥) */
  readonly frame: Rect;
  readonly bounds: Rect;
}

/** 끄는 중인 것과 지금 위에 있는 칸 */
export interface DragFocus {
  readonly place: Place;
  /** 위에 있는 칸 번호. 없으면 -1 */
  readonly hot: number;
}

function slotRect(x: number, y: number, w: number, hot: boolean, h: number): Rect {
  return { x, y, w, h: hot ? h : GEO.slotIdle };
}

/** 칸 하나를 쌓는다. 끄는 중이면 놓을 수 있는 틈(slot)을 칸 사이에 둔다 */
function stackSide(
  profile: SampleProfile,
  place: Place,
  collapsed: ReadonlySet<string>,
  drag: DragFocus | null,
  x: number,
  top: number,
  w: number,
  cards: CardBox[],
  slots: SlotBox[],
): number {
  const list = cardsAt(profile, place, collapsed);
  const open = drag !== null && samePlace(drag.place, place);
  const min = open ? minIndexAt(profile, place) : 0;
  let y = top;
  for (let i = 0; i <= list.length; i += 1) {
    if (open && i >= min) {
      const hot = drag.hot === i;
      const rect = slotRect(x, y, w, hot, GEO.cardH);
      slots.push({ place, index: i, rect, hot });
      y += rect.h + GEO.gap;
    }
    const card = list[i];
    if (card !== undefined) {
      cards.push({ card, place, index: i, rect: { x, y, w, h: GEO.cardH } });
      y += GEO.cardH + GEO.gap;
    }
  }
  return y;
}

/** 턴의 지점은 경주로처럼 두 줄로 돈다: 위 줄은 왼쪽에서 오른쪽, 아래 줄은 오른쪽에서 왼쪽. 같은 열은 위아래가 맞는다 */
const TOP_ROW: readonly PointId[] = ["input-received", "context", "model", "tools"];
const BOTTOM_ROW: readonly (PointId | null)[] = [null, "before-turn-end", "agents", "ask"];

/** 그 지점에 들어 있는 장 수 */
function countAt(profile: SampleProfile, point: PointId, collapsed: ReadonlySet<string>): number {
  return sidesOf(point).reduce(
    (n, side) => n + cardsAt(profile, { lane: "point", point, side }, collapsed).length,
    0,
  );
}

function isOpenPoint(drag: DragFocus | null, point: PointId): boolean {
  return drag !== null && drag.place.lane === "point" && drag.place.point === point;
}

function widthOf(
  profile: SampleProfile,
  point: PointId,
  collapsed: ReadonlySet<string>,
  drag: DragFocus | null,
): number {
  return countAt(profile, point, collapsed) > 0 || isOpenPoint(drag, point)
    ? GEO.stationW
    : GEO.stationEmptyW;
}

interface Sink {
  readonly cards: CardBox[];
  readonly slots: SlotBox[];
}

/** 지점 하나를 (x, y0)에 세운다. 칸을 위에서 아래로 쌓는다: 앞 → 몸통 → 뒤 */
function buildStation(
  profile: SampleProfile,
  point: PointId,
  collapsed: ReadonlySet<string>,
  drag: DragFocus | null,
  x: number,
  y0: number,
  sink: Sink,
): StationBox {
  const count = countAt(profile, point, collapsed);
  const open = isOpenPoint(drag, point);
  const w = widthOf(profile, point, collapsed, drag);
  const innerW = w - GEO.cardX - GEO.pad;
  let y = y0 + GEO.header + 10;
  let body: Rect | null = null;
  for (const side of sidesOf(point)) {
    const place: Place = { lane: "point", point, side };
    const cx = x + GEO.cardX;
    if (side === "in") {
      const top = y;
      const end = stackSide(
        profile,
        place,
        collapsed,
        drag,
        cx,
        y + 8,
        innerW,
        sink.cards,
        sink.slots,
      );
      const h = Math.max(end - top, 18);
      body = { x: cx - 8, y: top, w: innerW + 16, h };
      y = top + h + 10;
    } else {
      y = stackSide(profile, place, collapsed, drag, cx, y, innerW, sink.cards, sink.slots);
    }
  }
  // 비어 있는 지점은 머리말만 남는다(블록은 모서리 있는 판, 경계는 알약)
  const bare = count === 0 && !open;
  const h = bare ? GEO.header : y - y0 + 2;
  return { point, rect: { x, y: y0, w, h }, body: bare ? null : body, count, open };
}

/** 캔버스 전체의 자리. 끄는 중이 아니면 `drag`는 null */
export function layoutOf(
  profile: SampleProfile,
  collapsed: ReadonlySet<string>,
  drag: DragFocus | null,
): Layout {
  const sink: Sink = { cards: [], slots: [] };
  const stations: StationBox[] = [];
  // 열 너비: 위·아래 지점 중 넓은 쪽
  const colW = TOP_ROW.map((top, i) => {
    const bottom = BOTTOM_ROW[i] ?? null;
    const a = widthOf(profile, top, collapsed, drag);
    return bottom === null ? a : Math.max(a, widthOf(profile, bottom, collapsed, drag));
  });
  const startW = widthOf(profile, "conversation-start", collapsed, drag);
  const col0 = 0;
  const colX: number[] = [];
  let cx = col0;
  for (const w of colW) {
    colX.push(cx);
    cx += w + GEO.spineGap;
  }
  const right = cx - GEO.spineGap;
  // 대화 시작은 턴 바깥(한 번): 입력 받기 위, Drive 줄의 왼쪽 끝. 스타트 Drive가 여기서 첫 메시지를 받는다
  const startY = GEO.driveY + (GEO.driveH - GEO.header) / 2;
  stations.push(buildStation(profile, "conversation-start", collapsed, drag, col0, startY, sink));
  TOP_ROW.forEach((point, i) => {
    stations.push(buildStation(profile, point, collapsed, drag, colX[i] ?? 0, 0, sink));
  });
  const topDeep = stations.reduce<number>((m, s) => Math.max(m, s.rect.y + s.rect.h), GEO.header);
  const bottomY = topDeep + GEO.rowGap;
  // 아래 줄은 흐름 차례(오른쪽부터)로 넣는다: 묻기 → 서브에이전트 → 턴 종료 직전
  for (let i = BOTTOM_ROW.length - 1; i >= 0; i -= 1) {
    const point = BOTTOM_ROW[i] ?? null;
    if (point !== null) {
      stations.push(buildStation(profile, point, collapsed, drag, colX[i] ?? 0, bottomY, sink));
    }
  }
  const deepest = stations.reduce<number>((m, s) => Math.max(m, s.rect.y + s.rect.h), bottomY);
  const frame: Rect = {
    x: col0 - 22,
    y: GEO.frameTop,
    w: right - col0 + 44,
    h: deepest - GEO.frameTop + 30,
  };
  // Drive 줄: 턴 틀 위. 스타트 Drive가 왼쪽 첫 자리
  const drivePlace: Place = { lane: "drive" };
  const driveCards = cardsAt(profile, drivePlace, collapsed);
  const dragDrive = drag !== null && drag.place.lane === "drive";
  const min = dragDrive ? minIndexAt(profile, drivePlace) : 0;
  let dx = col0 + startW + 56;
  for (let i = 0; i <= driveCards.length; i += 1) {
    if (dragDrive && i >= min) {
      const hot = drag.hot === i;
      const w = hot ? GEO.driveW : GEO.slotIdle;
      sink.slots.push({
        place: drivePlace,
        index: i,
        rect: { x: dx, y: GEO.driveY, w, h: GEO.driveH },
        hot,
      });
      dx += w + 16;
    }
    const card = driveCards[i];
    if (card !== undefined) {
      sink.cards.push({
        card,
        place: drivePlace,
        index: i,
        rect: { x: dx, y: GEO.driveY, w: GEO.driveW, h: GEO.driveH },
      });
      dx += GEO.driveW + GEO.driveGap;
    }
  }
  const top = GEO.driveY - 36;
  const bounds: Rect = {
    x: -24,
    y: top,
    w: Math.max(frame.x + frame.w, dx) + 48,
    h: frame.y + frame.h - top + 24,
  };
  return { stations, cards: sink.cards, slots: sink.slots, frame, bounds };
}

/** 핸드오프 한 줄. 끝이 접힌 묶음 안이면 그 묶음 장으로 간다 */
export interface Handoff {
  readonly from: string;
  readonly to: string;
}

export function handoffsOf(layout: Layout): readonly Handoff[] {
  const out: Handoff[] = [];
  const keyOf = (name: string): string | null => {
    for (const box of layout.cards) {
      if (box.card.type === "plugin" && box.card.name === name) return name;
      if (box.card.type === "group" && box.card.group.members.includes(name)) {
        return cardKey(box.card);
      }
    }
    return null;
  };
  for (const box of layout.cards) {
    if (box.card.type !== "plugin") continue;
    const plugin = pluginOf(box.card.name);
    for (const target of plugin?.handoffTo ?? []) {
      const to = keyOf(target);
      if (to !== null && to !== box.card.name) out.push({ from: box.card.name, to });
    }
  }
  return out;
}

/** 이 장과 이어진 장들(선택했을 때 밝게 둘 것) */
export function relatedKeys(layout: Layout, key: string): ReadonlySet<string> {
  const out = new Set<string>([key]);
  for (const h of handoffsOf(layout)) {
    if (h.from === key) out.add(h.to);
    if (h.to === key) out.add(h.from);
  }
  return out;
}

/** 묶음의 이름표를 달 플러그인(펼쳤을 때) */
export function groupOfMember(profile: SampleProfile, name: string): SampleGroup | null {
  return profile.groups.find((g) => g.members.includes(name)) ?? null;
}
