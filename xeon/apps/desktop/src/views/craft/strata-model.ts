// 순서 화면과 링크 화면이 함께 읽는 순수 값. 화면 문구와 React를 모른다.
import {
  keepsContrib,
  matchesKind,
  type CanvasPlugin,
  type CanvasSnapshot,
  type Contrib,
  type KindFilter,
  type Sel,
} from "@fresnel/client/workbench/canvas";
import { assertNever } from "@fresnel/contracts";

/** 훅 줄마다 불리는 순서(플러그인 id들) */
export type LaneMap = Readonly<Record<string, readonly string[]>>;

/** 고른 것이 밝히는 것: 플러그인들과 훅들 */
export interface Lit {
  readonly plugins: ReadonlySet<string>;
  readonly hooks: ReadonlySet<string>;
}

/**
 * 적용 중인 순서 위에 저장만 되고 아직 적용되지 않은 순서(pending)를 덮는다.
 * 사용자가 끌어 놓은 순서를 다음 단계 경계 전에도 줄에 보이게 하려고 쓴다.
 */
export function overridesOf(
  applied: LaneMap,
  states: Readonly<
    Record<string, { readonly saved: readonly string[]; readonly pending: boolean }>
  >,
): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = { ...applied };
  for (const [hook, state] of Object.entries(states)) {
    if (state.pending) out[hook] = state.saved;
  }
  return out;
}

/** 고른 것이 밝히는 플러그인과 훅. 그룹의 구성원을 고르면 그룹 전체가 밝는다(mock litOf와 같다) */
export function litFor(sel: Sel, snapshot: CanvasSnapshot, lanes: LaneMap): Lit {
  const plugins = new Set<string>();
  const hooks = new Set<string>();
  const byId = (id: string): CanvasPlugin | undefined => snapshot.plugins.find((p) => p.id === id);
  const take = (p: CanvasPlugin | undefined): void => {
    if (p === undefined) return;
    plugins.add(p.id);
    for (const h of p.hooks) hooks.add(h);
  };
  switch (sel.k) {
    case "agent":
      break;
    case "plugin": {
      const p = byId(sel.id);
      const gid = p?.group;
      const group = gid === undefined ? undefined : snapshot.groups.find((g) => g.id === gid);
      if (group === undefined) take(p);
      else for (const id of group.members) take(byId(id));
      break;
    }
    case "group": {
      const group = snapshot.groups.find((g) => g.id === sel.id);
      for (const id of group?.members ?? []) take(byId(id));
      break;
    }
    case "layer":
      for (const p of snapshot.plugins) if (p.layer === sel.id) take(p);
      break;
    case "hook":
      hooks.add(sel.id);
      for (const id of lanes[sel.id] ?? []) plugins.add(id);
      break;
    case "builtin":
      if (sel.slot.startsWith("hook:")) hooks.add(sel.slot.slice("hook:".length));
      break;
    default:
      return assertNever(sel, "litFor");
  }
  return { plugins, hooks };
}

/** 종류와 구성 요소 거르기에 맞나. 종류에 맞지 않는 것은 흐리게 두고, 구성 요소에 맞지 않는 것은 줄에서 숨긴다(`visibleLane`) */
export function matchesFilter(
  p: CanvasPlugin,
  kind: KindFilter,
  contrib: readonly Contrib[],
): boolean {
  return matchesKind(p, kind) && keepsContrib(p, contrib);
}

/**
 * 줄에 보일 핸들러 id들, 순서 그대로. 구성 요소 거르기에 맞지 않는 핸들러는 뺀다.
 * 저장할 순서는 가려진 것까지 든 전체 줄이어야 하므로 화면은 전체 줄을 `mergeVisibleLane`으로 되돌려 쓴다.
 */
export function visibleLane(
  lane: readonly string[],
  snapshot: CanvasSnapshot,
  contrib: readonly Contrib[],
): string[] {
  return lane.filter((id) => shownInLane(id, snapshot, contrib));
}

/**
 * 보이는 핸들러의 새 순서를 전체 줄에 되돌린다. 가려진 핸들러는 제자리에 두고, 보이는 자리만 새 순서로 채운다.
 * `nextVisible`은 `visibleLane(lane, ...)`을 바꾼 목록이어야 한다.
 */
export function mergeVisibleLane(
  lane: readonly string[],
  snapshot: CanvasSnapshot,
  contrib: readonly Contrib[],
  nextVisible: readonly string[],
): string[] {
  let k = 0;
  return lane.map((id) => (shownInLane(id, snapshot, contrib) ? (nextVisible[k++] ?? id) : id));
}

function shownInLane(id: string, snapshot: CanvasSnapshot, contrib: readonly Contrib[]): boolean {
  const p = snapshot.plugins.find((x) => x.id === id);
  return p !== undefined && keepsContrib(p, contrib);
}

/** 두 순서가 같은가(길이와 자리마다 id) */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
