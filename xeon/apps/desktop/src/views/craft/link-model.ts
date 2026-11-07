// 링크 보기의 순수 값: 초점 플러그인, 주도 보유자, 상대 행 묶기, 보일 사실 거르기. 화면과 React를 모른다.
import {
  isOn,
  keepsContrib,
  REL_ORDER,
  type CanvasPlugin,
  type CanvasSnapshot,
  type Contrib,
  type Relation,
  type RelationContext,
  type RelKind,
  type Sel,
} from "@fresnel/client/workbench/canvas";
import { activeLocale } from "@fresnel/client/i18n";

/** 주도 보유자: 주도를 선언하고 켜져 있는 첫 플러그인(목록 순서). 없으면 undefined */
function driveHolderOf(snapshot: CanvasSnapshot): CanvasPlugin | undefined {
  return snapshot.plugins.find((p) => p.drives === true && isOn(p));
}

/** 주도 보유자의 id. 없으면 null */
export function driveHolder(snapshot: CanvasSnapshot): string | null {
  return driveHolderOf(snapshot)?.id ?? null;
}

/**
 * 관계를 읽을 때 쓰는 주도 값. 보유자는 스냅샷이 준다. 턴 사용량은 스냅샷에 없어 [0, 0]이고,
 * 그 한도 사실은 `visibleFacts`가 숨긴다(엔진이 턴 사용량을 줄 때 바꾼다).
 */
export function driveContext(snapshot: CanvasSnapshot): RelationContext["drive"] {
  return { holder: driveHolder(snapshot), turns: [0, 0] };
}

/** 관계 계산에 넘길 전체 문맥: 훅 줄 순서(화면과 같은 값)와 주도 값 */
export function relationContext(
  snapshot: CanvasSnapshot,
  order: RelationContext["order"],
): RelationContext {
  return { order, drive: driveContext(snapshot) };
}

/**
 * 고른 것에서 초점 플러그인을 고른다. 플러그인은 그것, 그룹은 대표(id가 그룹 id인 플러그인, 없으면 첫 구성원),
 * 나머지(에이전트·층·훅·내장)는 주도 보유자, 그것도 없으면 첫 플러그인이다.
 */
export function focusOf(sel: Sel, snapshot: CanvasSnapshot): CanvasPlugin | undefined {
  const byId = (id: string): CanvasPlugin | undefined => snapshot.plugins.find((p) => p.id === id);
  if (sel.k === "plugin") {
    const p = byId(sel.id);
    if (p !== undefined) return p;
  } else if (sel.k === "group") {
    const group = snapshot.groups.find((g) => g.id === sel.id);
    if (group !== undefined) {
      const root = byId(group.id);
      if (root !== undefined) return root;
      for (const id of group.members) {
        const member = byId(id);
        if (member !== undefined) return member;
      }
    }
  }
  return driveHolderOf(snapshot) ?? snapshot.plugins[0];
}

/**
 * 구성 요소 거르기에 맞는 상대와의 관계만 남긴다. 맞지 않는 상대는 줄도 실도 그리지 않는다(숨긴다).
 * 초점 플러그인은 관계의 출발점이라 거르지 않는다.
 */
export function visibleRels(rels: readonly Relation[], contrib: readonly Contrib[]): Relation[] {
  return rels.filter((rel) => keepsContrib(rel.other, contrib));
}

/** 상대 한 줄: 상대 플러그인과 그 상대와의 관계들(목록 순서) */
export interface LinkRow {
  readonly other: CanvasPlugin;
  readonly list: readonly Relation[];
}

/** 상대마다 한 줄. 관계 수가 많은 순, 같으면 이름순(현재 로케일 정렬) */
export function rowsOf(rels: readonly Relation[]): LinkRow[] {
  const by = new Map<string, { other: CanvasPlugin; list: Relation[] }>();
  for (const rel of rels) {
    const row = by.get(rel.other.id);
    if (row === undefined) by.set(rel.other.id, { other: rel.other, list: [rel] });
    else row.list.push(rel);
  }
  return [...by.values()].toSorted(
    (a, b) =>
      b.list.length - a.list.length || a.other.name.localeCompare(b.other.name, activeLocale()),
  );
}

/** 관계가 있는 종류만, REL_ORDER 순서대로 */
export function kindsOf(rels: readonly Relation[]): RelKind[] {
  return REL_ORDER.filter((k) => rels.some((r) => r.kind === k));
}

/**
 * 카드에 보일 사실. 막대의 최대치가 0인 것(아직 모르는 한도)은 숨긴다: 0/0을 보이면 거짓이다.
 */
export function visibleFacts(rel: Relation): Relation["facts"] {
  return rel.facts.filter((f) => f.meter === null || f.meter.max > 0);
}
