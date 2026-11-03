// 순서 화면과 링크 화면이 함께 읽는 순수 값. 화면 문구와 React를 모른다.
import {
  hasContrib,
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

/** 구성 요소와 종류 필터에 맞나. 맞지 않는 것은 화면에서 흐리게 둔다 */
export function matchesFilter(
  p: CanvasPlugin,
  kind: KindFilter,
  contrib: readonly Contrib[],
): boolean {
  return matchesKind(p, kind) && (contrib.length === 0 || contrib.some((c) => hasContrib(p, c)));
}

/** 두 순서가 같은가(길이와 자리마다 id) */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
