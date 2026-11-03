// 지도와 층 패널이 같이 쓰는 순수 판단: 고른 것이 밝히는 점, 거르기, 찾기, 층 안의 카드 순서. 화면과 무관하다.
import { assertNever } from "@fresnel/contracts";
import {
  isOn,
  keepsContrib,
  matchesKind,
  type CanvasGroup,
  type CanvasPlugin,
  type CanvasSnapshot,
  type Contrib,
  type KindFilter,
  type LayerKey,
  type Sel,
} from "@fresnel/client/workbench/canvas";

export interface Lit {
  /** 고른 플러그인(밝은 점 하나). 그룹·층·훅을 고르면 없다 */
  readonly primary: string | null;
  /** 밝힐 플러그인 id들 */
  readonly ids: ReadonlySet<string>;
  /** 고른 것이 있으면 true: 밝지 않은 것은 흐리게 */
  readonly active: boolean;
}

/** 고른 것이 밝히는 플러그인. 그룹 구성원을 고르면 그룹 전체, 훅 줄을 고르면 그 줄의 핸들러가 든 플러그인이다 */
export function litOf(
  sel: Sel,
  snapshot: CanvasSnapshot,
  order: Readonly<Record<string, readonly string[]>>,
): Lit {
  const ids = new Set<string>();
  let primary: string | null = null;
  switch (sel.k) {
    case "plugin": {
      primary = sel.id;
      const p = snapshot.plugins.find((x) => x.id === sel.id);
      const members = groupMembers(snapshot, p?.group);
      if (members.length > 0) for (const id of members) ids.add(id);
      else ids.add(sel.id);
      break;
    }
    case "group":
      for (const id of groupOf(snapshot, sel.id)?.members ?? []) ids.add(id);
      break;
    case "layer":
      for (const p of snapshot.plugins) if (p.layer === sel.id) ids.add(p.id);
      break;
    case "hook":
      for (const id of order[sel.id] ?? []) ids.add(id);
      break;
    case "agent":
    case "builtin":
      break;
    default:
      return assertNever(sel, "litOf");
  }
  const active = sel.k !== "agent" && sel.k !== "builtin";
  return { primary, ids, active };
}

function groupOf(snapshot: CanvasSnapshot, id: string): CanvasGroup | undefined {
  return snapshot.groups.find((g) => g.id === id);
}

/** 플러그인이 든 그룹의 구성원 id들. 그룹이 없으면 빈 목록이다 */
function groupMembers(snapshot: CanvasSnapshot, gid: string | undefined): readonly string[] {
  if (gid === undefined) return [];
  return groupOf(snapshot, gid)?.members ?? [];
}

/**
 * 종류와 구성 요소 거르기. 구성 요소는 고른 것 중 하나라도 있으면 맞는다(빈 목록이면 전부).
 * 지도가 구성 요소 거르기로 숨기는 것도 이 규칙을 따른다(`keepsContrib`).
 */
export function passesFilter(
  p: CanvasPlugin,
  kind: KindFilter,
  contrib: readonly Contrib[],
): boolean {
  return matchesKind(p, kind) && keepsContrib(p, contrib);
}

/**
 * 지도에 그릴 점. 구성 요소 거르기는 맞지 않는 점을 그리지 않는다(숨긴다). 종류와 찾기는 흐리게 둔다(`isDimmed`).
 * 위치는 스냅샷으로 정해져 있어 숨겨도 다른 점이 자리를 옮기지 않는다.
 */
export function shownOnMap(snapshot: CanvasSnapshot, contrib: readonly Contrib[]): CanvasPlugin[] {
  return snapshot.plugins.filter((p) => keepsContrib(p, contrib));
}

/** 그룹 호와 이름표를 그릴지: 구성원 가운데 지도에 남는 것이 하나라도 있어야 한다 */
export function groupShown(
  snapshot: CanvasSnapshot,
  gid: string,
  contrib: readonly Contrib[],
): boolean {
  return (
    groupOf(snapshot, gid)?.members.some((id) => {
      const p = snapshot.plugins.find((x) => x.id === id);
      return p !== undefined && keepsContrib(p, contrib);
    }) === true
  );
}

/** 찾기 글과 맞나. 이름, 한 줄 설명, 훅 id, 기능, 구성 요소 이름을 본다. 빈 글은 전부 맞는다 */
export function matchesQuery(p: CanvasPlugin, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  const has = (s: string | undefined): boolean =>
    s !== undefined && s.toLowerCase().includes(needle);
  return (
    has(p.name) ||
    has(p.role) ||
    p.hooks.some((h) => has(h)) ||
    p.provides.some((c) => has(c)) ||
    p.pieces.some((x) => has(x.name))
  );
}

/** 점 하나가 흐려지나: 고른 것 밖이거나, 거르기에 빠지거나, 찾기에 맞지 않을 때 */
export function isDimmed(
  p: CanvasPlugin,
  lit: Lit,
  kind: KindFilter,
  contrib: readonly Contrib[],
  query: string,
): boolean {
  return (
    (lit.active && !lit.ids.has(p.id)) || !passesFilter(p, kind, contrib) || !matchesQuery(p, query)
  );
}

/** 층 패널에 보일 플러그인, 스냅샷 순서 그대로. 구성 요소 거르기에 맞지 않는 것은 뺀다 */
export function layerPlugins(
  snapshot: CanvasSnapshot,
  layer: LayerKey,
  contrib: readonly Contrib[],
): CanvasPlugin[] {
  return snapshot.plugins.filter((p) => p.layer === layer && keepsContrib(p, contrib));
}

/**
 * 층 패널의 카드 순서. 저장된 순서가 있으면 따르고, 빠진 것은 스냅샷 순서로 뒤에 붙인다.
 * [미결: 사용자 확인] 이 순서가 불러오는 순서(load order)인지 화면만의 순서인지 정해지지 않았다.
 * 그래서 호출하는 쪽은 이 값을 컴포넌트 상태에만 두고 저장하지 않는다.
 */
export function applyLayerOrder(saved: readonly string[], ids: readonly string[]): string[] {
  const live = new Set(ids);
  const kept = saved.filter((id, i) => live.has(id) && saved.indexOf(id) === i);
  const keptSet = new Set(kept);
  return [...kept, ...ids.filter((id) => !keptSet.has(id))];
}

/** 그룹이 켜진 구성원 수와 전체. 스위치와 "n/m 켜짐" 표시에 쓴다 */
export function groupOnCount(
  snapshot: CanvasSnapshot,
  gid: string,
): { readonly on: number; readonly total: number } {
  const members = groupOf(snapshot, gid)?.members ?? [];
  const plugins = members.flatMap((id) => {
    const p = snapshot.plugins.find((x) => x.id === id);
    return p === undefined ? [] : [p];
  });
  return { on: plugins.filter((p) => isOn(p)).length, total: plugins.length };
}
