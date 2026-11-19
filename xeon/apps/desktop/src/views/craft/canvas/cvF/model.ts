// cvF 모델: 공통 표본을 cvF 모양(붙는 자리 하나, 카드 값)으로 바꾸고, 프로필 편집(넣기·빼기·순서)과 플러그인끼리의 관계를 계산한다.
// 화면 상태만 바꾼다(실제 프로필에 저장하지 않는다). 엔진에 있는 관계만 낸다:
//   핸드오프(Drive의 `handoff`), 의존(플러그인 선언 `requires`를 같은 프로필의 다른 플러그인이 `provides`),
//   대체(플러그인 선언 `replaces`가 내장 도구를 바꿔 놓음), 포함(매니페스트 `group.members`: 묶음이 플러그인을 가진다).
import { assertNever } from "@fresnel/contracts";
import {
  ALL_SHARED_PLUGINS,
  SHARED_PLUGINS,
  SHARED_PROFILES,
  type SharedPlugin,
  type SharedProfile,
  type SharedProfileId,
} from "../shared-sample.ts";
import { extOf, type PluginExt } from "./sample-ext.ts";

export type Kind = SharedPlugin["kind"];

/** 플러그인이 붙는 자리. feed는 블록에 재료를 넣고, Hook 자리는 블록 앞·뒤와 턴 종료 직전, drive는 턴을 쥔다 */
export type SpotKey =
  | "feed:context"
  | "feed:tools"
  | "before:model"
  | "before:tools"
  | "after:tools"
  | "boundary:before-turn-end"
  | "drive";

export const HOOK_SPOTS: readonly SpotKey[] = [
  "before:model",
  "before:tools",
  "after:tools",
  "boundary:before-turn-end",
];
export const FEED_SPOTS: readonly SpotKey[] = ["feed:context", "feed:tools"];

export interface Plugin extends SharedPlugin {
  readonly spot: SpotKey;
  readonly ext: PluginExt;
}

function spotOf(p: SharedPlugin): SpotKey {
  switch (p.kind) {
    case "inject":
      return "feed:context";
    case "tool":
      return "feed:tools";
    case "drive":
      return "drive";
    case "hook":
      switch (p.point) {
        case "model.before":
          return "before:model";
        case "tools.after":
          return "after:tools";
        case "before-turn-end":
          return "boundary:before-turn-end";
        case "tools.before":
        case undefined:
          return "before:tools";
        default:
          return assertNever(p.point, "cvF spotOf point");
      }
    default:
      return assertNever(p.kind, "cvF spotOf kind");
  }
}

export type Catalog = ReadonlyMap<string, Plugin>;

export const CATALOG: Catalog = new Map(
  ALL_SHARED_PLUGINS.map((p) => [p.name, { ...p, spot: spotOf(p), ext: extOf(p.name) }]),
);

/** 목록에 보이는 설치된 플러그인: "개발" 장면은 표본의 열셋, 30개 장면은 서른셋 */
export function installedOf(profile: Profile): readonly Plugin[] {
  const names = new Set(
    (profile.id === "scale" ? ALL_SHARED_PLUGINS : SHARED_PLUGINS).map((p) => p.name),
  );
  return [...CATALOG.values()].filter((p) => names.has(p.name));
}

export interface Group {
  readonly id: string;
  /** 매니페스트 `group.members`의 순서. 묶음 안의 순서다 */
  readonly members: readonly string[];
}

export interface Profile {
  readonly id: SharedProfileId;
  /** 베이스(모든 프로필에 든다). 프로필에서 뺄 수 없다 */
  readonly base: readonly string[];
  /** 프로필이 고른 플러그인, 순서대로 */
  readonly plugins: readonly string[];
  readonly startDrive: string | null;
  /** 설치된 묶음(프로필에 들었는지는 구성원이 들었는지로 본다) */
  readonly groups: readonly Group[];
}

function profileOf(shared: SharedProfile): Profile {
  return {
    id: shared.id,
    base: shared.base,
    plugins: shared.plugins,
    startDrive: shared.startDrive,
    groups: SHARED_PROFILES.dev.groups.map((g) => ({ id: g.id, members: g.members })),
  };
}

export const PROFILES: Readonly<Record<SharedProfileId, Profile>> = {
  dev: profileOf(SHARED_PROFILES.dev),
  empty: profileOf(SHARED_PROFILES.empty),
  scale: profileOf(SHARED_PROFILES.scale),
};

/** 프로필에 든 이름 전부, 순서대로(베이스가 앞) */
export function namesOf(profile: Profile): readonly string[] {
  return [...profile.base, ...profile.plugins];
}

export function inProfile(profile: Profile, name: string): boolean {
  return profile.base.includes(name) || profile.plugins.includes(name);
}

export function isBase(profile: Profile, name: string): boolean {
  return profile.base.includes(name);
}

function groupOf(profile: Profile, name: string): Group | null {
  return profile.groups.find((g) => g.members.includes(name)) ?? null;
}

/** 묶음이 프로필에 들었다: 구성원이 모두 들었다(묶음은 한 번에 켜고 끈다) */
export function groupIn(profile: Profile, group: Group): boolean {
  return group.members.every((m) => inProfile(profile, m));
}

/** 누가 넣었나 */
export type Source =
  | { readonly kind: "base" }
  | { readonly kind: "group"; readonly group: string }
  | { readonly kind: "profile" };

export function sourceOf(profile: Profile, name: string): Source {
  if (isBase(profile, name)) return { kind: "base" };
  const g = groupOf(profile, name);
  if (g !== null && groupIn(profile, g)) return { kind: "group", group: g.id };
  return { kind: "profile" };
}

/**
 * 한 자리의 호출 순서. 가드 Hook이 먼저, 그다음 프로필 순서(베이스가 앞).
 * Drive 자리는 스타트 Drive가 먼저다.
 */
export function spotOrder(profile: Profile, catalog: Catalog, spot: SpotKey): readonly string[] {
  const names = namesOf(profile).filter((n) => catalog.get(n)?.spot === spot);
  const guard = (n: string): number => (catalog.get(n)?.guard === true ? 0 : 1);
  const start = (n: string): number => (n === profile.startDrive ? 0 : 1);
  return names.toSorted((a, b) => start(a) - start(b) || guard(a) - guard(b));
}

export type Edit =
  | { readonly ok: true; readonly profile: Profile }
  | {
      readonly ok: false;
      readonly reason: "base" | "inGroup" | "absent" | "present" | "edge" | "guard";
    };

/** 플러그인 하나를 넣는다(그 플러그인이 선언한 자리의 끝으로). 묶음 구성원은 묶음째로만 넣는다 */
export function addPlugin(profile: Profile, name: string): Edit {
  if (inProfile(profile, name)) return { ok: false, reason: "present" };
  const g = groupOf(profile, name);
  if (g !== null) return addGroup(profile, g.id);
  return { ok: true, profile: { ...profile, plugins: [...profile.plugins, name] } };
}

/** 플러그인 하나를 뺀다. 베이스와 묶음 구성원은 거절한다(묶음은 묶음째로 뺀다) */
export function removePlugin(profile: Profile, name: string): Edit {
  if (isBase(profile, name)) return { ok: false, reason: "base" };
  if (!profile.plugins.includes(name)) return { ok: false, reason: "absent" };
  const g = groupOf(profile, name);
  if (g !== null && groupIn(profile, g)) return { ok: false, reason: "inGroup" };
  return {
    ok: true,
    profile: {
      ...profile,
      plugins: profile.plugins.filter((n) => n !== name),
      startDrive: profile.startDrive === name ? null : profile.startDrive,
    },
  };
}

export function addGroup(profile: Profile, id: string): Edit {
  const g = profile.groups.find((x) => x.id === id);
  if (g === undefined) return { ok: false, reason: "absent" };
  if (groupIn(profile, g)) return { ok: false, reason: "present" };
  const missing = g.members.filter((m) => !inProfile(profile, m));
  return { ok: true, profile: { ...profile, plugins: [...profile.plugins, ...missing] } };
}

export function removeGroup(profile: Profile, id: string): Edit {
  const g = profile.groups.find((x) => x.id === id);
  if (g === undefined || !groupIn(profile, g)) return { ok: false, reason: "absent" };
  if (g.members.some((m) => isBase(profile, m))) return { ok: false, reason: "base" };
  return {
    ok: true,
    profile: {
      ...profile,
      plugins: profile.plugins.filter((n) => !g.members.includes(n)),
      startDrive:
        profile.startDrive !== null && g.members.includes(profile.startDrive)
          ? null
          : profile.startDrive,
    },
  };
}

/**
 * 같은 자리 안에서 한 칸 앞(-1)이나 뒤(+1)로. 베이스·가드·스타트 Drive는 자리가 정해져 있어 옮기지 않고,
 * 바꿀 상대도 프로필이 고른 것이어야 한다. 프로필 목록에서 두 이름의 자리를 맞바꾼다.
 */
export function move(profile: Profile, catalog: Catalog, name: string, dir: -1 | 1): Edit {
  const spec = catalog.get(name);
  if (spec === undefined || !inProfile(profile, name)) return { ok: false, reason: "absent" };
  if (isBase(profile, name)) return { ok: false, reason: "base" };
  if (spec.guard === true || profile.startDrive === name) return { ok: false, reason: "guard" };
  const order = spotOrder(profile, catalog, spec.spot);
  const other = order[order.indexOf(name) + dir];
  if (
    other === undefined ||
    isBase(profile, other) ||
    catalog.get(other)?.guard === true ||
    other === profile.startDrive
  )
    return { ok: false, reason: "edge" };
  const plugins = profile.plugins.map((n) => (n === name ? other : n === other ? name : n));
  return { ok: true, profile: { ...profile, plugins } };
}

/** 묶음 안의 순서를 바꾼다(매니페스트 `group.members`의 순서) */
export function moveInGroup(profile: Profile, id: string, name: string, dir: -1 | 1): Edit {
  const g = profile.groups.find((x) => x.id === id);
  if (g === undefined) return { ok: false, reason: "absent" };
  const i = g.members.indexOf(name);
  const j = i + dir;
  const other = g.members[j];
  if (i < 0 || other === undefined) return { ok: false, reason: "edge" };
  const members = g.members.map((m, k) => (k === i ? other : k === j ? name : m));
  return {
    ok: true,
    profile: {
      ...profile,
      groups: profile.groups.map((x) => (x.id === id ? { ...x, members } : x)),
    },
  };
}

// ── 관계 ──────────────────────────────────────────────────────────

export type Relation =
  | { readonly kind: "handoff"; readonly from: string; readonly to: string }
  | {
      readonly kind: "depends";
      readonly from: string;
      readonly to: string;
      /** capability id */
      readonly capability: string;
    }
  | { readonly kind: "replaces"; readonly from: string; readonly tool: string };

/** 프로필 안에서 그릴 관계. 상대가 프로필에 없으면 그리지 않는다(상세 판에는 남는다) */
export function relationsOf(profile: Profile, catalog: Catalog): readonly Relation[] {
  const names = namesOf(profile);
  const inside = new Set(names);
  const out: Relation[] = [];
  for (const name of names) {
    const p = catalog.get(name);
    if (p === undefined) continue;
    for (const to of p.handoffTo ?? []) {
      if (inside.has(to)) out.push({ kind: "handoff", from: name, to });
    }
    for (const capability of p.ext.requires) {
      const provider = names.find(
        (n) => n !== name && catalog.get(n)?.ext.provides.includes(capability) === true,
      );
      if (provider !== undefined)
        out.push({ kind: "depends", from: name, to: provider, capability });
    }
    for (const tool of p.ext.replaces) out.push({ kind: "replaces", from: name, tool });
  }
  return out;
}

/** 한 플러그인의 관계 전부(프로필 밖의 상대 포함). 상세 판이 쓴다 */
export interface RelationRow {
  readonly kind: "handoffTo" | "handoffFrom" | "requires" | "providesTo" | "replaces" | "member";
  /** 상대 플러그인·묶음·도구 이름 */
  readonly other: string;
  /** requires의 capability id, 또는 null */
  readonly via: string | null;
  /** 상대가 이 프로필에 있는가(도구·묶음은 늘 참) */
  readonly present: boolean;
  /** requires인데 같은 프로필의 플러그인이 내지 않으면 엔진(내장)이 낸다 */
  readonly engine: boolean;
}

export function relationRows(profile: Profile, catalog: Catalog, name: string): RelationRow[] {
  const p = catalog.get(name);
  if (p === undefined) return [];
  const names = namesOf(profile);
  const rows: RelationRow[] = [];
  for (const to of p.handoffTo ?? [])
    rows.push({
      kind: "handoffTo",
      other: to,
      via: null,
      present: names.includes(to),
      engine: false,
    });
  for (const [other, q] of catalog) {
    if (q.handoffTo?.includes(name) === true)
      rows.push({
        kind: "handoffFrom",
        other,
        via: null,
        present: names.includes(other),
        engine: false,
      });
  }
  for (const capability of p.ext.requires) {
    const provider = [...catalog.values()].find((q) => q.ext.provides.includes(capability));
    rows.push({
      kind: "requires",
      other: provider?.name ?? capability,
      via: capability,
      present: provider === undefined || names.includes(provider.name),
      engine: provider === undefined,
    });
  }
  for (const capability of p.ext.provides) {
    for (const q of catalog.values()) {
      if (q.ext.requires.includes(capability))
        rows.push({
          kind: "providesTo",
          other: q.name,
          via: capability,
          present: names.includes(q.name),
          engine: false,
        });
    }
  }
  for (const tool of p.ext.replaces)
    rows.push({ kind: "replaces", other: tool, via: null, present: true, engine: false });
  const g = groupOf(profile, name);
  if (g !== null)
    rows.push({ kind: "member", other: g.id, via: null, present: true, engine: false });
  return rows;
}
