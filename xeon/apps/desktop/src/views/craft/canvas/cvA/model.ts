// cvA(HUD) 프로필 캔버스의 순수 모델: 턴의 자리(블록·경계)와 Hook이 붙는 곳, 플러그인이 놓이는 줄(스택), 프로필 편집.
// 배치(좌표)는 layout.ts가 한다. 이 파일은 "무엇이 어디에 몇 번째로 붙는가"만 정한다. 화면 문구는 두지 않는다.
// 블록·경계 id는 엔진의 블록 모델(`blocks.describe`, `@fresnel/contracts/blocks`의 BLOCK_MODEL)과 같다(시험이 대조한다).
import type { BlockDescription, BoundaryDescription } from "@fresnel/contracts/blocks";

export type Kind = "inject" | "hook" | "drive" | "tool";
export const KINDS: readonly Kind[] = ["inject", "hook", "drive", "tool"];

/** Hook이 하는 결정 셋: 막기, 대체, 묻기 */
export type Decision = "block" | "replace" | "ask";
export const DECISIONS: readonly Decision[] = ["block", "replace", "ask"];

/** 레일에 서는 블록 다섯. 여섯째 `record`는 레일이 아니라 돌아오는 길 위에 선다(구독만 있다) */
export type RailBlock = Exclude<BlockDescription["id"], "record">;
export type BoundaryId = BoundaryDescription["id"];
export type StationId = RailBlock | BoundaryId;
export type Side = "before" | "after";

/** Hook이 붙는 곳: 블록의 앞·뒤, 또는 경계 자체 */
export type Port = `${RailBlock}.${Side}` | BoundaryId;

/** 턴의 레일. 왼쪽에서 오른쪽으로 한 턴이 지난다 */
export const RAIL: readonly StationId[] = [
  "conversation-start",
  "input-received",
  "context",
  "model",
  "tools",
  "ask",
  "agents",
  "before-turn-end",
];
export const RAIL_BLOCKS: readonly RailBlock[] = ["context", "model", "tools", "ask", "agents"];
export const BOUNDARIES: readonly BoundaryId[] = [
  "conversation-start",
  "input-received",
  "before-turn-end",
];

export function isBoundary(id: StationId): id is BoundaryId {
  return id === "conversation-start" || id === "input-received" || id === "before-turn-end";
}

/** Hook이 붙을 수 있는 곳 전부(레일 순서) */
const PORTS: readonly Port[] = RAIL.flatMap((id): Port[] =>
  isBoundary(id) ? [id] : [`${id}.before`, `${id}.after`],
);

/** 붙는 곳의 레일 자리와 쪽. 경계는 쪽이 없다 */
export function stationOfPort(port: Port): {
  readonly station: StationId;
  readonly side: Side | null;
} {
  for (const id of RAIL_BLOCKS) {
    if (port === `${id}.before`) return { station: id, side: "before" };
    if (port === `${id}.after`) return { station: id, side: "after" };
  }
  for (const id of BOUNDARIES) if (port === id) return { station: id, side: null };
  return { station: "context", side: "before" };
}

// ── 플러그인 ─────────────────────────────────────────────────────

export type Unit = "instruction" | "skill" | "memory" | "tool" | "server";
export type Risk = "read" | "write" | "exec";
export const RISKS: readonly Risk[] = ["read", "write", "exec"];
export type StepKind =
  | "diverge"
  | "explore"
  | "apply"
  | "check"
  | "judge"
  | "report"
  | "search"
  | "read"
  | "summarize";
export type GrantId =
  | "fileRead"
  | "fileWrite"
  | "childThread"
  | "commandRun"
  | "memoryWrite"
  | "network"
  | "repoWrite";

/** 플러그인 안의 재료 하나(지침 파일, 스킬, 도구, MCP 서버, 메모리) */
export interface Part {
  readonly id: string;
  readonly unit: Unit;
  /** 파일·도구 이름(식별자라 번역하지 않는다) */
  readonly label: string;
}

/** Drive의 단계 하나. lanes가 2 이상이면 같은 단계가 나란히 돈다 */
export interface Step {
  readonly id: string;
  readonly step: StepKind;
  readonly lanes: number;
}

export interface Grant {
  readonly id: GrantId;
  readonly risk: Risk;
}

export interface Setting {
  readonly key: string;
  readonly value: string;
}

/** 플러그인 내부: 무엇으로 지어졌나 */
interface Inside {
  /** 코드가 도는가(Hook 핸들러, Drive, MCP 서버) */
  readonly code: boolean;
  readonly parts: readonly Part[];
  readonly steps?: readonly Step[];
  /** 이 Drive가 핸드오프하는 대상 */
  readonly handoff?: readonly string[];
  /** 다른 Drive의 핸드오프를 받는다 */
  readonly receives?: boolean;
  readonly handler?: { readonly port: Port; readonly decision: Decision };
  readonly settings: readonly Setting[];
  readonly grants: readonly Grant[];
}

export interface Holding {
  readonly unit: Unit;
  readonly count: number;
}

export interface PluginSpec {
  readonly name: string;
  readonly kind: Kind;
  readonly holds: readonly Holding[];
  /** Hook이 붙는 곳(플러그인이 선언한다. 사용자는 순서만 정한다) */
  readonly port?: Port;
  readonly decision?: Decision;
  /** 가드 등급: 같은 곳에서 늘 먼저 돈다 */
  readonly guard?: boolean;
  /** 리뷰 대기 중인 드래프트 */
  readonly draft?: boolean;
  readonly handoffTo?: readonly string[];
  /** 마지막으로 쓴 때(분 전). 쓴 적 없으면 null */
  readonly lastUsedMin: number | null;
  readonly inside: Inside;
}

export type Catalog = ReadonlyMap<string, PluginSpec>;

export function catalogOf(specs: readonly PluginSpec[]): Catalog {
  return new Map(specs.map((s) => [s.name, s]));
}

// ── 프로필 ───────────────────────────────────────────────────────

/** 플러그인 여럿을 묶은 것(이름은 표본 키) */
export interface Group {
  readonly id: string;
  readonly name: string;
  readonly members: readonly string[];
}

export interface ProfileModel {
  readonly id: string;
  /** 베이스에서 온 것(모든 프로필에 든다). 여기서 빼지 않는다 */
  readonly base: readonly string[];
  /** 프로필이 직접 고른 것. 순서가 호출 순서다 */
  readonly plugins: readonly string[];
  readonly startDrive: string | null;
  readonly groups: readonly Group[];
}

/** 베이스 다음에 프로필 순서. 같은 곳에서는 가드가 먼저다(`stackOrder`) */
export function effectiveOrder(profile: ProfileModel): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [...profile.base, ...profile.plugins]) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export function isBase(profile: ProfileModel, name: string): boolean {
  return profile.base.includes(name);
}

export function inProfile(profile: ProfileModel, name: string): boolean {
  return profile.base.includes(name) || profile.plugins.includes(name);
}

// ── 스택: 같은 곳에 붙는 플러그인 줄 ───────────────────────────

/**
 * 플러그인이 놓이는 줄. feed는 레일 위(Inject는 컨텍스트 조립, 도구는 도구 실행으로 들어간다), hook은 레일 아래 그 자리,
 * drive는 맨 위 Drive 줄이다.
 */
export type StackKey =
  | { readonly lane: "feed"; readonly station: "context" | "tools" }
  | { readonly lane: "hook"; readonly port: Port }
  | { readonly lane: "drive" };

export function stackKeyOf(spec: PluginSpec): StackKey {
  if (spec.kind === "inject") return { lane: "feed", station: "context" };
  if (spec.kind === "tool") return { lane: "feed", station: "tools" };
  if (spec.kind === "drive") return { lane: "drive" };
  return { lane: "hook", port: spec.port ?? "tools.before" };
}

export function stackId(key: StackKey): string {
  if (key.lane === "feed") return `feed:${key.station}`;
  if (key.lane === "hook") return `hook:${key.port}`;
  return "drive";
}

/** 줄 하나의 순서: 가드가 먼저, 그다음 프로필 순서. Drive 줄은 스타트 Drive가 맨 앞이다 */
export function stackOrder(
  profile: ProfileModel,
  catalog: Catalog,
  key: StackKey,
): readonly string[] {
  const id = stackId(key);
  const members = effectiveOrder(profile).filter((name) => {
    const spec = catalog.get(name);
    return spec !== undefined && stackId(stackKeyOf(spec)) === id;
  });
  if (key.lane === "drive") {
    const start = profile.startDrive;
    if (start === null || !members.includes(start)) return members;
    return [start, ...members.filter((n) => n !== start)];
  }
  const guards = members.filter((n) => catalog.get(n)?.guard === true);
  return [...guards, ...members.filter((n) => catalog.get(n)?.guard !== true)];
}

/** 프로필에 쓰인 줄 전부(빈 줄은 빼고, feed·hook은 레일 순서, Drive는 끝) */
export function stacksOf(
  profile: ProfileModel,
  catalog: Catalog,
): readonly { readonly key: StackKey; readonly members: readonly string[] }[] {
  const keys: StackKey[] = [
    { lane: "feed", station: "context" },
    { lane: "feed", station: "tools" },
    ...PORTS.map((port): StackKey => ({ lane: "hook", port })),
    { lane: "drive" },
  ];
  return keys
    .map((key) => ({ key, members: stackOrder(profile, catalog, key) }))
    .filter((s) => s.members.length > 0);
}

// ── 놓을 자리 ────────────────────────────────────────────────────

/** 놓을 자리 하나: 줄과 그 줄 안의 위치. start는 Drive 줄의 맨 앞(스타트 Drive) */
export interface Target {
  readonly key: StackKey;
  readonly index: number;
}

/**
 * 플러그인 하나를 놓을 수 있는 자리. 줄은 플러그인 종류가 정하고(Hook은 선언한 곳), 위치는 줄 안 어디든 되지만
 * 가드가 아닌 Hook은 가드 앞에 설 수 없다. 이미 프로필에 있으면 지금 자리를 뺀 줄에서 센다.
 */
export function targetsFor(
  profile: ProfileModel,
  catalog: Catalog,
  name: string,
): readonly Target[] {
  const spec = catalog.get(name);
  if (spec === undefined) return [];
  const key = stackKeyOf(spec);
  const others = stackOrder(profile, catalog, key).filter((n) => n !== name);
  const guards =
    key.lane === "hook" && spec.guard !== true
      ? others.filter((n) => catalog.get(n)?.guard === true).length
      : 0;
  const out: Target[] = [];
  for (let index = guards; index <= others.length; index += 1) out.push({ key, index });
  return out;
}

// ── 편집 ─────────────────────────────────────────────────────────

/**
 * 플러그인을 자리에 놓는다(목록에서 끌어오기와 캔버스 안 순서 바꾸기가 같은 길이다). 베이스 플러그인은 프로필 목록에 들지 않고
 * 순서만 바뀌지 않는다. 줄 안 위치는 프로필 순서로 옮긴다: 그 위치의 다음 플러그인 바로 앞, 없으면 줄 마지막 플러그인 바로 뒤.
 * Drive 줄의 0번은 스타트 Drive다.
 */
export function place(
  profile: ProfileModel,
  catalog: Catalog,
  name: string,
  target: Target,
): ProfileModel {
  const spec = catalog.get(name);
  if (spec === undefined || stackId(stackKeyOf(spec)) !== stackId(target.key)) return profile;
  const startDrive =
    target.key.lane === "drive" && target.index === 0
      ? name
      : profile.startDrive === name
        ? null
        : profile.startDrive;
  if (isBase(profile, name)) return { ...profile, startDrive };
  const line = stackOrder(profile, catalog, target.key).filter((n) => n !== name);
  const rest = profile.plugins.filter((n) => n !== name);
  const next = line[target.index];
  const prev = line[target.index - 1];
  const at =
    next !== undefined && rest.includes(next)
      ? rest.indexOf(next)
      : prev !== undefined && rest.includes(prev)
        ? rest.indexOf(prev) + 1
        : next !== undefined
          ? 0
          : rest.length;
  const plugins = [...rest.slice(0, at), name, ...rest.slice(at)];
  return { ...profile, plugins, startDrive: fixStart(plugins, profile.base, startDrive) };
}

function fixStart(
  plugins: readonly string[],
  base: readonly string[],
  start: string | null,
): string | null {
  if (start === null) return null;
  return plugins.includes(start) || base.includes(start) ? start : null;
}

/** 프로필에서 뺀다. 베이스에서 온 것은 빼지 않는다. 묶음에서도 빠지고, 둘보다 적게 남은 묶음은 풀린다 */
export function removeFrom(profile: ProfileModel, name: string): ProfileModel {
  if (isBase(profile, name) || !profile.plugins.includes(name)) return profile;
  const groups = profile.groups
    .map((g) => ({ ...g, members: g.members.filter((m) => m !== name) }))
    .filter((g) => g.members.length >= 2);
  return {
    ...profile,
    plugins: profile.plugins.filter((n) => n !== name),
    startDrive: profile.startDrive === name ? null : profile.startDrive,
    groups,
  };
}

/** 줄 안에서 한 칸 앞(-1)이나 뒤(+1)로. 가드 앞으로는 가지 않는다 */
export function nudge(
  profile: ProfileModel,
  catalog: Catalog,
  name: string,
  delta: -1 | 1,
): ProfileModel {
  const spec = catalog.get(name);
  if (spec === undefined || !inProfile(profile, name)) return profile;
  const key = stackKeyOf(spec);
  const line = stackOrder(profile, catalog, key);
  const index = line.indexOf(name) + delta;
  const allowed = targetsFor(profile, catalog, name);
  if (!allowed.some((t) => t.index === index)) return profile;
  return place(profile, catalog, name, { key, index });
}

/** 줄 안 몇 번째인가(1부터). 프로필에 없으면 0 */
export function orderInStack(profile: ProfileModel, catalog: Catalog, name: string): number {
  const spec = catalog.get(name);
  if (spec === undefined) return 0;
  return stackOrder(profile, catalog, stackKeyOf(spec)).indexOf(name) + 1;
}

/** 이름이 든 묶음 */
export function groupOf(profile: ProfileModel, name: string): Group | undefined {
  return profile.groups.find((g) => g.members.includes(name));
}

/** 프로필 안의 핸드오프(보내는 쪽과 받는 쪽이 둘 다 있을 때만) */
export function handoffsOf(
  profile: ProfileModel,
  catalog: Catalog,
): readonly { readonly from: string; readonly to: string }[] {
  const names = effectiveOrder(profile);
  const out: { from: string; to: string }[] = [];
  for (const from of names) {
    for (const to of catalog.get(from)?.handoffTo ?? []) {
      if (names.includes(to)) out.push({ from, to });
    }
  }
  return out;
}
