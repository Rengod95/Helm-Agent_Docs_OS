// cv6 모델: 표본 프로필을 "무엇이 루프의 어디에 붙나, 어떤 묶음에 들었나, 플러그인끼리 어떤 관계인가"로 바꾼다. 순수 함수만 둔다.
// 엔진의 사실: 프로필은 순서 있는 이름 목록(`Profile.plugins`)과 스타트 Drive이고, 붙는 자리는 플러그인 매니페스트가 정한다(사용자가 고르지 않는다).
// 베이스(`CommonSet`)는 모든 프로필 앞에 선다. 묶음은 패키지 하나라 프로필에는 이름 하나로 들고 구성원은 함께 들고 난다.
import {
  ALL_SHARED_PLUGINS,
  SHARED_PROFILES,
  type SharedPlugin,
  type SharedPoint,
  type SharedProfileId,
} from "../shared-sample.ts";
import { metaOf, type PluginMeta } from "../shared-meta.ts";
import { ATTACH_PLUGINS, ATTACH_PURPOSE, attachNames } from "./sample-ext.ts";

export type Kind = "inject" | "hook" | "drive" | "tool";
export type BlockId = "context" | "model" | "tools" | "ask" | "agents" | "record";
export type BoundaryId = "conversation-start" | "input-received" | "before-turn-end";

/** 플러그인이 붙는 곳. `feed:`는 블록에 들어가는 재료, `before:`/`after:`는 블록 앞뒤 Hook 자리, `drive`는 턴을 쥐는 자리 */
export type Anchor =
  | `before:${BlockId}`
  | `after:${BlockId}`
  | "feed:context"
  | "feed:tools"
  | `boundary:${BoundaryId}`
  | "drive";

/** 캔버스의 층: Drive 줄(맨 위), 재료 줄(레일 위), Hook 줄(레일 아래) */
export type Lane = "drive" | "feed" | "hook";

export const BLOCKS: readonly BlockId[] = ["context", "model", "tools", "ask", "agents", "record"];

export interface Plugin {
  readonly name: string;
  readonly kind: Kind;
  readonly anchor: Anchor;
  readonly shared: SharedPlugin;
  readonly meta: PluginMeta;
}

const POINT_ANCHOR: Readonly<Record<SharedPoint, Anchor>> = {
  "model.before": "before:model",
  "tools.before": "before:tools",
  "tools.after": "after:tools",
  "before-turn-end": "boundary:before-turn-end",
};

function anchorOf(p: SharedPlugin): Anchor {
  if (p.kind === "inject") return "feed:context";
  if (p.kind === "tool") return "feed:tools";
  if (p.kind === "drive") return "drive";
  return p.point === undefined ? "before:model" : POINT_ANCHOR[p.point];
}

export function laneOf(anchor: Anchor): Lane {
  if (anchor === "drive") return "drive";
  if (anchor.startsWith("feed:")) return "feed";
  return "hook";
}

const CATALOG: ReadonlyMap<string, Plugin> = new Map([
  ...ALL_SHARED_PLUGINS.map((p): [string, Plugin] => [
    p.name,
    { name: p.name, kind: p.kind, anchor: anchorOf(p), shared: p, meta: metaOf(p.name, p.kind) },
  ]),
  // "한 자리에 여럿" 장면의 표본 Hook(목적 한 문장만 같이 쓴다)
  ...ATTACH_PLUGINS.map((p): [string, Plugin] => [
    p.name,
    {
      name: p.name,
      kind: p.kind,
      anchor: anchorOf(p),
      shared: p,
      meta: { ...metaOf(p.name, p.kind), purpose: ATTACH_PURPOSE, hooks: ["guard.tool.before"] },
    },
  ]),
]);

export function pluginOf(name: string): Plugin | undefined {
  return CATALOG.get(name);
}

/** 설치된 플러그인 전부(표본 13). 30개 장면의 스물은 그 장면에서만 보인다 */
export const INSTALLED: readonly Plugin[] = ALL_SHARED_PLUGINS.slice(0, 13).flatMap((p) => {
  const hit = CATALOG.get(p.name);
  return hit === undefined ? [] : [hit];
});

/** 프로필 항목 하나: 플러그인 하나, 또는 묶음 하나(이름 하나로 들고 구성원은 매니페스트 순서) */
type Entry =
  | { readonly type: "plugin"; readonly name: string }
  | { readonly type: "bundle"; readonly id: string; readonly members: readonly string[] };

export interface CanvasProfile {
  readonly id: string;
  readonly base: readonly string[];
  readonly entries: readonly Entry[];
  readonly startDrive: string | null;
}

/** 표본 프로필 하나를 캔버스 프로필로. 묶음의 구성원은 첫 구성원 자리에 묶음 하나로 선다 */
export function profileFromSample(id: SharedProfileId): CanvasProfile {
  const p = SHARED_PROFILES[id];
  const entries: Entry[] = [];
  const seen = new Set<string>();
  for (const name of p.plugins) {
    const group = p.groups.find((g) => g.members.includes(name));
    if (group === undefined) {
      entries.push({ type: "plugin", name });
      continue;
    }
    if (seen.has(group.id)) continue;
    seen.add(group.id);
    entries.push({ type: "bundle", id: group.id, members: group.members });
  }
  return { id, base: p.base, entries, startDrive: p.startDrive };
}

/** 캔버스가 고를 수 있는 표본 장면: 공통 셋과 "한 자리에 여럿" */
export type SceneId = SharedProfileId | "attach";

/** "한 자리에 여럿": 베이스는 secret-guard 하나, 프로필은 스타트 helm과 도구 실행 앞 Hook n-1개 */
export function attachProfile(n: number): CanvasProfile {
  return {
    id: "attach",
    base: ["secret-guard"],
    entries: [
      { type: "plugin", name: "helm" },
      ...attachNames(n).map((name): Entry => ({ type: "plugin", name })),
    ],
    startDrive: "helm",
  };
}

/** 묶음 표(표본에서 아는 묶음). 목록에서 구성원 하나를 넣으면 묶음째 든다 */
function bundleOfPlugin(name: string): { id: string; members: readonly string[] } | null {
  for (const id of ["dev", "scale"] as const) {
    const g = SHARED_PROFILES[id].groups.find((x) => x.members.includes(name));
    if (g !== undefined) return { id: g.id, members: g.members };
  }
  return null;
}

/** 넣은 곳: 베이스, 프로필, 묶음 */
type Source =
  | { readonly type: "base" }
  | { readonly type: "profile" }
  | { readonly type: "bundle"; readonly id: string };

export interface Placed {
  readonly plugin: Plugin;
  readonly source: Source;
  /** 같은 자리에서의 호출 순서(1부터). 효과 순서(베이스 → 프로필 순서, 묶음은 구성원 순서)에서 센다 */
  readonly order: number;
  /** 같은 자리에 붙은 수 */
  readonly siblings: number;
  readonly start: boolean;
}

/** 실제로 실리는 이름 순서: 베이스가 먼저, 그다음 프로필 순서(묶음은 그 자리에서 구성원 순서) */
function effectiveNames(profile: CanvasProfile): readonly string[] {
  const out: string[] = [...profile.base];
  for (const e of profile.entries) {
    if (e.type === "plugin") out.push(e.name);
    else out.push(...e.members);
  }
  return out;
}

export function placedOf(profile: CanvasProfile): readonly Placed[] {
  const names = effectiveNames(profile);
  const sourceOf = (name: string): Source => {
    if (profile.base.includes(name)) return { type: "base" };
    for (const e of profile.entries) {
      if (e.type === "bundle" && e.members.includes(name)) return { type: "bundle", id: e.id };
    }
    return { type: "profile" };
  };
  const plugins = names.flatMap((n) => {
    const p = pluginOf(n);
    return p === undefined ? [] : [p];
  });
  const counts = new Map<Anchor, number>();
  for (const p of plugins) counts.set(p.anchor, (counts.get(p.anchor) ?? 0) + 1);
  const seen = new Map<Anchor, number>();
  return plugins.map((p) => {
    const order = (seen.get(p.anchor) ?? 0) + 1;
    seen.set(p.anchor, order);
    return {
      plugin: p,
      source: sourceOf(p.name),
      order,
      siblings: counts.get(p.anchor) ?? 1,
      start: profile.startDrive === p.name,
    };
  });
}

export function inProfile(profile: CanvasProfile, name: string): boolean {
  return effectiveNames(profile).includes(name);
}

/** 베이스에 든 플러그인은 이 프로필에서 뺄 수 없다 */
export function isBaseOf(profile: CanvasProfile, name: string): boolean {
  return profile.base.includes(name);
}

// ── 관계 ───────────────────────────────────────────────────────────

/**
 * 플러그인끼리의 관계. 엔진에 있는 것만 둔다:
 * 핸드오프(Drive의 `handoff` 명령), 의존(`requires`·`optional` 기능을 프로필 안의 다른 플러그인이 `provides`),
 * 기록 읽기(`readsRecordKinds`가 다른 플러그인의 `recordKinds`에 맞음), 생성(빌더가 테스트 챗에서 만든 드래프트, `origin.createdIn`),
 * 대체(`replaces`: 내장 도구를 같은 이름으로 바꿈. 상대는 플러그인이 아니라 레일의 도구 실행 블록이다).
 * 소유(패키지가 플러그인을 담음)는 선이 아니라 묶음 받침판이 보인다.
 */
export type RelationKind = "handoff" | "depends" | "reads" | "creates" | "replaces";

export interface Relation {
  readonly kind: RelationKind;
  readonly from: string;
  /** 상대 플러그인 이름. `creates`의 출발은 `BUILDER`, `replaces`의 도착은 `tool:<이름>` */
  readonly to: string;
  /** 선에 붙는 말(기능 id, 기록 종류, 도구 이름) */
  readonly label: string;
}

/** 프로필 밖에 있는 만든 쪽: 빌더(테스트 챗의 스타트 Drive) */
export const BUILDER = "@builder";

/** `x.foo.*`, `grp.helm.discovery.*` 같은 읽기 패턴이 기록 종류에 맞나 */
function recordMatches(pattern: string, kind: string): boolean {
  if (pattern.endsWith(".*")) return kind.startsWith(pattern.slice(0, -1));
  return pattern === kind;
}

export function relationsOf(profile: CanvasProfile): readonly Relation[] {
  const names = effectiveNames(profile);
  const plugins = names.flatMap((n) => {
    const p = pluginOf(n);
    return p === undefined ? [] : [p];
  });
  const out: Relation[] = [];
  for (const p of plugins) {
    for (const to of p.shared.handoffTo ?? []) {
      if (names.includes(to)) out.push({ kind: "handoff", from: p.name, to, label: "" });
    }
    for (const need of [...p.meta.requires, ...p.meta.optional]) {
      const giver = plugins.find(
        (q) => q.name !== p.name && q.meta.provides.some((g) => g.id === need.id),
      );
      if (giver !== undefined)
        out.push({ kind: "depends", from: p.name, to: giver.name, label: need.id });
    }
    for (const pattern of p.meta.readsRecordKinds) {
      const owner = plugins.find(
        (q) => q.name !== p.name && q.meta.recordKinds.some((k) => recordMatches(pattern, k)),
      );
      if (owner !== undefined)
        out.push({ kind: "reads", from: p.name, to: owner.name, label: pattern });
    }
    if (p.meta.createdByBuilder)
      out.push({ kind: "creates", from: BUILDER, to: p.name, label: "" });
    for (const tool of p.meta.replaces) {
      out.push({ kind: "replaces", from: p.name, to: `tool:${tool}`, label: tool });
    }
  }
  return out;
}

/** 기능 하나를 누가 주나: 프로필 안의 플러그인, 엔진(코어 기능), 아무도(채워지지 않음 → `requirement_unmet`) */
export type Provider =
  | { readonly type: "plugin"; readonly name: string }
  | { readonly type: "engine" }
  | { readonly type: "none" };

/** 코어 기능 묶음(`packages/cap-*`)이 주는 기능의 이름 앞부분 */
const ENGINE_CAPS = [
  "agents.",
  "artifacts.",
  "dialog.",
  "knowledge.",
  "mcp.",
  "models.",
  "schedule.",
  "web.",
  "work.",
  "workspace.",
];

export function providerOf(profile: CanvasProfile, capability: string): Provider {
  for (const n of effectiveNames(profile)) {
    const p = pluginOf(n);
    if (p !== undefined && p.meta.provides.some((g) => g.id === capability))
      return { type: "plugin", name: n };
  }
  if (ENGINE_CAPS.some((prefix) => capability.startsWith(prefix))) return { type: "engine" };
  return { type: "none" };
}

// ── 바꾸기(저장하지 않는다) ─────────────────────────────────────────

/** 넣기. 묶음의 구성원이면 묶음째 든다. 이미 있으면 그대로 */
export function addPlugin(profile: CanvasProfile, name: string): CanvasProfile {
  if (inProfile(profile, name)) return profile;
  const bundle = bundleOfPlugin(name);
  const entry: Entry =
    bundle === null
      ? { type: "plugin", name }
      : { type: "bundle", id: bundle.id, members: bundle.members };
  const p = pluginOf(name);
  const startDrive =
    profile.startDrive === null && p?.kind === "drive" && bundle === null
      ? name
      : profile.startDrive;
  return { ...profile, entries: [...profile.entries, entry], startDrive };
}

export type RemoveResult =
  | { readonly ok: true; readonly profile: CanvasProfile; readonly removed: readonly string[] }
  | { readonly ok: false; readonly reason: "base" | "absent" };

/** 빼기. 베이스는 프로필에서 뺄 수 없다. 묶음 구성원이면 묶음째 빠진다 */
export function removePlugin(profile: CanvasProfile, name: string): RemoveResult {
  if (profile.base.includes(name)) return { ok: false, reason: "base" };
  const idx = profile.entries.findIndex(
    (e) =>
      (e.type === "plugin" && e.name === name) || (e.type === "bundle" && e.members.includes(name)),
  );
  const entry = profile.entries[idx];
  if (entry === undefined) return { ok: false, reason: "absent" };
  const removed = entry.type === "plugin" ? [entry.name] : entry.members;
  const entries = profile.entries.filter((_, i) => i !== idx);
  const startDrive =
    profile.startDrive !== null && removed.includes(profile.startDrive) ? null : profile.startDrive;
  return { ok: true, profile: { ...profile, entries, startDrive }, removed };
}

export function removeBundle(profile: CanvasProfile, id: string): CanvasProfile {
  const entry = profile.entries.find((e) => e.type === "bundle" && e.id === id);
  if (entry === undefined || entry.type !== "bundle") return profile;
  const startDrive =
    profile.startDrive !== null && entry.members.includes(profile.startDrive)
      ? null
      : profile.startDrive;
  return { ...profile, entries: profile.entries.filter((e) => e !== entry), startDrive };
}

/**
 * 같은 자리 안에서 순서 바꾸기(프로필 순서가 호출 순서다). 같은 자리에 붙은 이웃 항목과 자리를 맞바꾼다.
 * 베이스와 묶음 구성원은 움직이지 않는다(베이스는 늘 앞, 묶음 안은 매니페스트 순서)
 */
export function nudge(profile: CanvasProfile, name: string, delta: -1 | 1): CanvasProfile {
  const p = pluginOf(name);
  if (p === undefined) return profile;
  const idx = profile.entries.findIndex((e) => e.type === "plugin" && e.name === name);
  if (idx < 0) return profile;
  const sameAnchor = (e: Entry): boolean =>
    e.type === "plugin" && pluginOf(e.name)?.anchor === p.anchor;
  let j = idx + delta;
  while (j >= 0 && j < profile.entries.length) {
    const e = profile.entries[j];
    if (e !== undefined && sameAnchor(e)) break;
    j += delta;
  }
  const other = profile.entries[j];
  const self = profile.entries[idx];
  if (other === undefined || self === undefined) return profile;
  const entries = [...profile.entries];
  entries[idx] = other;
  entries[j] = self;
  return { ...profile, entries };
}

/** 같은 자리에서 앞·뒤로 갈 수 있나(화면의 단추를 끄는 데 쓴다) */
export function canNudge(profile: CanvasProfile, name: string, delta: -1 | 1): boolean {
  return nudge(profile, name, delta) !== profile;
}

export function setStartDrive(profile: CanvasProfile, name: string): CanvasProfile {
  const p = pluginOf(name);
  if (p?.kind !== "drive" || !inProfile(profile, name)) return profile;
  return { ...profile, startDrive: name };
}
