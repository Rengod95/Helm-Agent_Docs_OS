// cvE "궤도" 시안의 순수 모델. 루프는 닫힌 고리이고, 플러그인은 붙는 방식에 따라 고리의 안(Inject)·위의 지점(Hook)·
// 도구 소켓(도구)·고리 밖의 자기 고리(Drive)에 놓인다. 화면은 이 파일의 값만 그린다(문구는 message id로 찾는다).
// 자리(slot)는 플러그인이 선언한 것이라 사용자가 바꾸지 않는다. 사용자가 바꾸는 것은 프로필의 순서와 넣기·빼기다.
import { assertNever } from "@fresnel/contracts";

/** 붙는 방식. 도구는 Inject의 한 갈래지만 도구 실행 블록에 꽂히는 소켓으로 따로 그린다 */
export type Kind = "inject" | "hook" | "drive" | "tool";

/** 코어 루프의 블록 여섯(`BLOCK_MODEL.blocks`의 id와 같은 순서) */
export const STATIONS = ["context", "model", "tools", "ask", "agents", "record"] as const;
export type StationId = (typeof STATIONS)[number];

/** Hook이 붙는 지점. 블록의 앞·뒤와 루프 경계(입력 받기·턴 종료 직전) */
const HOOK_POINTS = [
  "input",
  "model.before",
  "tools.before",
  "tools.after",
  "ask.before",
  "agents.before",
  "turnEnd",
] as const;
export type HookPoint = (typeof HOOK_POINTS)[number];

/** 플러그인이 놓이는 자리. inside = 컨텍스트 조립(고리 안), socket = 도구 실행의 소켓, drive = 고리 밖 Drive 줄 */
export type Slot = HookPoint | "inside" | "socket" | "drive";

export type Decision = "block" | "replace" | "ask";

/** 플러그인 안의 구성 요소 종류 */
export type PartKind =
  | "instruction"
  | "skill"
  | "tool"
  | "mcp"
  | "memory"
  | "handler"
  | "setting"
  | "permission";

export interface Part {
  readonly kind: PartKind;
  /** 이름(message id 꼬리. 화면이 `sample.part.<key>`로 찾는다). 식별자 이름이면 `raw`에 둔다 */
  readonly key?: string;
  readonly raw?: string;
  /** 개수(스킬 6, 도구 12) */
  readonly count?: number;
  /** 권한의 위험 등급 0~3 */
  readonly risk?: number;
  /** 핸들러가 붙는 지점과 결정 */
  readonly point?: HookPoint;
  readonly decision?: Decision;
}

/** Drive의 자기 루프 단계. parallel이 2 이상이면 같은 단계가 나란히 돈다 */
export interface Stage {
  readonly key: string;
  readonly parallel?: number;
}

export interface PluginDef {
  readonly id: string;
  readonly kind: Kind;
  /** Hook만: 붙는 지점, 결정, 가드 등급 */
  readonly point?: HookPoint;
  readonly decision?: Decision;
  readonly guard?: boolean;
  /** Inject·도구: 무엇을 넣나(지침 1, 스킬 6, 메모리, 도구 12) */
  readonly gives?: { readonly what: PartKind; readonly count: number };
  /** Drive만: 자기 루프와 핸드오프 대상 */
  readonly stages?: readonly Stage[];
  readonly handoff?: readonly string[];
  /** 승인 전(리뷰 대기) */
  readonly draft?: boolean;
  /** 실제 프로필에서 읽었지만 붙는 방식을 모른다(얇은 연결) */
  readonly unread?: boolean;
  /** 최근 사용(분 전). 없으면 줄을 그리지 않는다 */
  readonly usedMin?: number;
  readonly parts: readonly Part[];
}

interface Entry {
  readonly id: string;
  /** 베이스에서 왔다(모든 프로필에 든다. 이 화면에서 뺄 수 없다) */
  readonly base: boolean;
}

export interface Group {
  readonly id: string;
  /** 이름(message id 꼬리) */
  readonly key: string;
  readonly members: readonly string[];
}

export interface ProfileModel {
  readonly id: string;
  /** 표본이면 message id 꼬리, 실제 프로필이면 제목 그대로 */
  readonly title: string;
  readonly sample: boolean;
  /** 순서가 있다. 같은 자리에서는 가드 다음 이 순서로 돈다 */
  readonly entries: readonly Entry[];
  readonly startDrive: string | null;
  readonly groups: readonly Group[];
}

export type Defs = Readonly<Record<string, PluginDef>>;

/** 플러그인이 놓이는 자리 */
export function slotOf(def: PluginDef): Slot {
  switch (def.kind) {
    case "inject":
      return "inside";
    case "tool":
      return "socket";
    case "drive":
      return "drive";
    case "hook":
      return def.point ?? "turnEnd";
    default:
      return assertNever(def.kind, "cvE slotOf kind");
  }
}

/** 같은 자리의 순서: 가드 등급이 먼저, 그다음 프로필 순서 */
export function stackAt(profile: ProfileModel, defs: Defs, slot: Slot): readonly string[] {
  const here: { readonly id: string; readonly guard: boolean; readonly index: number }[] = [];
  profile.entries.forEach((entry, index) => {
    const def = defs[entry.id];
    if (def !== undefined && slotOf(def) === slot) {
      here.push({ id: entry.id, guard: def.guard === true, index });
    }
  });
  here.sort((a, b) => (a.guard === b.guard ? a.index - b.index : a.guard ? -1 : 1));
  return here.map((h) => h.id);
}

function inProfile(profile: ProfileModel, id: string): boolean {
  return profile.entries.some((e) => e.id === id);
}

/**
 * 자리의 `index`번째로 넣는다. 그 자리의 지금 `index`번째 앞에 끼우고, 없으면 그 자리 마지막 뒤, 자리가 비면 맨 끝이다.
 * 가드는 늘 먼저 돌아서 가드가 아닌 것을 가드 앞에 끼워도 화면의 순서는 가드가 먼저다(`stackAt`).
 */
export function insertAt(
  profile: ProfileModel,
  defs: Defs,
  id: string,
  index: number,
): ProfileModel {
  const def = defs[id];
  if (def === undefined) return profile;
  const without = profile.entries.filter((e) => e.id !== id);
  const kept = profile.entries.find((e) => e.id === id);
  const entry: Entry = kept ?? { id, base: false };
  const rest: ProfileModel = { ...profile, entries: without };
  const stack = stackAt(rest, defs, slotOf(def));
  const before = stack[index];
  const after = stack[stack.length - 1];
  const at =
    before !== undefined
      ? without.findIndex((e) => e.id === before)
      : after !== undefined
        ? without.findIndex((e) => e.id === after) + 1
        : without.length;
  const entries = [...without.slice(0, at), entry, ...without.slice(at)];
  const startDrive = profile.startDrive ?? (def.kind === "drive" ? id : null);
  return { ...profile, entries, startDrive };
}

export type MoveResult =
  | { readonly kind: "moved"; readonly profile: ProfileModel }
  | { readonly kind: "guard" }
  | { readonly kind: "edge" };

/** 자리 안에서 한 칸 앞(-1)이나 뒤(+1)로. 가드와 가드 아닌 것 사이는 넘지 않는다 */
export function move(profile: ProfileModel, defs: Defs, id: string, delta: -1 | 1): MoveResult {
  const def = defs[id];
  if (def === undefined) return { kind: "edge" };
  const stack = stackAt(profile, defs, slotOf(def));
  const at = stack.indexOf(id);
  const other = stack[at + delta];
  if (at < 0 || other === undefined) return { kind: "edge" };
  if ((defs[other]?.guard === true) !== (def.guard === true)) return { kind: "guard" };
  const entries = [...profile.entries];
  const i = entries.findIndex((e) => e.id === id);
  const j = entries.findIndex((e) => e.id === other);
  const a = entries[i];
  const b = entries[j];
  if (a === undefined || b === undefined) return { kind: "edge" };
  entries[i] = b;
  entries[j] = a;
  return { kind: "moved", profile: { ...profile, entries } };
}

export type RemoveResult =
  | { readonly kind: "removed"; readonly profile: ProfileModel }
  | { readonly kind: "base" };

/** 프로필에서 뺀다. 베이스에서 온 것은 빼지 않는다. 스타트 Drive를 빼면 남은 첫 Drive가 받는다 */
export function remove(profile: ProfileModel, defs: Defs, id: string): RemoveResult {
  const entry = profile.entries.find((e) => e.id === id);
  if (entry === undefined) return { kind: "removed", profile };
  if (entry.base) return { kind: "base" };
  const entries = profile.entries.filter((e) => e.id !== id);
  const nextDrive = entries.find((e) => defs[e.id]?.kind === "drive")?.id ?? null;
  const startDrive = profile.startDrive === id ? nextDrive : profile.startDrive;
  const groups = profile.groups
    .map((g) => ({ ...g, members: g.members.filter((m) => m !== id) }))
    .filter((g) => g.members.length > 0);
  return { kind: "removed", profile: { ...profile, entries, startDrive, groups } };
}

export function setStart(profile: ProfileModel, defs: Defs, id: string): ProfileModel {
  if (defs[id]?.kind !== "drive" || !inProfile(profile, id)) return profile;
  return { ...profile, startDrive: id };
}

export function groupOf(profile: ProfileModel, id: string): Group | undefined {
  return profile.groups.find((g) => g.members.includes(id));
}

/** 핸드오프 줄: Drive가 선언한 대상 가운데 프로필에 있는 것만 */
export function handoffs(
  profile: ProfileModel,
  defs: Defs,
): readonly { readonly from: string; readonly to: string }[] {
  const out: { readonly from: string; readonly to: string }[] = [];
  for (const entry of profile.entries) {
    for (const to of defs[entry.id]?.handoff ?? []) {
      if (inProfile(profile, to)) out.push({ from: entry.id, to });
    }
  }
  return out;
}

/** 키보드 이동 순서: 루프를 도는 순서(Drive → 고리 안 → 지점들 → 소켓) */
export function readingOrder(profile: ProfileModel, defs: Defs): readonly string[] {
  const slots: readonly Slot[] = [
    "drive",
    "input",
    "inside",
    "model.before",
    "tools.before",
    "socket",
    "tools.after",
    "ask.before",
    "agents.before",
    "turnEnd",
  ];
  const drives = stackAt(profile, defs, "drive");
  const start = profile.startDrive;
  const orderedDrives =
    start !== null && drives.includes(start)
      ? [start, ...drives.filter((d) => d !== start)]
      : drives;
  return slots.flatMap((slot) => (slot === "drive" ? orderedDrives : stackAt(profile, defs, slot)));
}
