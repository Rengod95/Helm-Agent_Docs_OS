// cvB(유리·크리스탈) 프로필 캔버스의 순수 모델. 화면 글과 그림은 두지 않는다(문구는 id로 message key를 찾는다).
// 프로필은 순서가 있는 플러그인 목록(`entries`)이다. 플러그인마다 붙는 자리(`Anchor`) 하나를 선언하고, 같은 자리 안의 순서는
// 가드 등급이 먼저, 그다음 목록 순서다(제품 모델: Hook 순서). 바꾸기(넣기·빼기·순서)는 새 값을 돌려주는 함수다.
import { assertNever } from "@fresnel/contracts";
import type { MessageId } from "@fresnel/client/i18n";

/** 플러그인이 루프에 붙는 방식 셋과 도구(MCP) */
export type Kind = "inject" | "hook" | "drive" | "tool";
export const KINDS: readonly Kind[] = ["inject", "hook", "drive", "tool"];

/** 코어 블록 여섯(`BLOCK_MODEL`의 id와 같다) */
const BLOCKS = ["context", "model", "tools", "ask", "agents", "record"] as const;
export type Block = (typeof BLOCKS)[number];

/** 흐름 경계 셋(`BOUNDARY_SPECS`의 id와 같다) */
const BOUNDARIES = ["conversation-start", "input-received", "before-turn-end"] as const;
export type Boundary = (typeof BOUNDARIES)[number];

/** 블록에 붙는 쪽. before·after는 Hook이 도는 앞·뒤, feed는 블록에 재료를 넣는 자리(Inject는 컨텍스트, 도구는 도구 실행) */
export type Side = "before" | "after" | "feed";

/** 플러그인이 붙는 자리. drive는 턴을 쥐는 자리(캔버스 가운데) */
export type Anchor =
  | { readonly at: "block"; readonly block: Block; readonly side: Side }
  | { readonly at: "boundary"; readonly boundary: Boundary }
  | { readonly at: "drive" };

export function anchorKey(anchor: Anchor): string {
  switch (anchor.at) {
    case "block":
      return `${anchor.block}:${anchor.side}`;
    case "boundary":
      return `boundary:${anchor.boundary}`;
    case "drive":
      return "drive";
    default:
      return assertNever(anchor, "cvB.anchorKey");
  }
}

/** Hook의 결정 */
export type Verb = "block" | "replace" | "ask";

/** 노드의 둘째 줄(무엇이 들었나·무엇을 하나) */
type Meta =
  | { readonly k: "rules"; readonly n: number }
  | { readonly k: "skills"; readonly n: number }
  | { readonly k: "memory" }
  | { readonly k: "verb" }
  | { readonly k: "tools"; readonly n: number }
  | { readonly k: "steps"; readonly n: number }
  | { readonly k: "receives" };

/** 위험 등급(권한 구성 요소) */
export type Risk = "none" | "read" | "write" | "exec";

/** 플러그인 내부의 구성 요소 하나 */
export type Part =
  | { readonly kind: "rule"; readonly id: string; readonly file: string }
  | { readonly kind: "skill"; readonly id: string; readonly name: string }
  | { readonly kind: "memory"; readonly id: string; readonly entries: number }
  | {
      readonly kind: "mcp";
      readonly id: string;
      readonly server: string;
      readonly command: string;
      readonly tools: readonly string[];
    }
  | {
      readonly kind: "handler";
      readonly id: string;
      readonly anchor: Anchor;
      readonly verb: Verb;
      readonly guard: boolean;
      readonly when: MessageId;
    }
  | {
      readonly kind: "step";
      readonly id: string;
      readonly title: MessageId;
      /** 병렬로 여럿이 돈다면 그 수 */
      readonly parallel?: number;
    }
  | { readonly kind: "handoff"; readonly id: string; readonly to: string; readonly back: boolean }
  | { readonly kind: "setting"; readonly id: string; readonly key: string; readonly value: string }
  | {
      readonly kind: "permission";
      readonly id: string;
      readonly risk: Risk;
      readonly scopes: readonly MessageId[];
    };

export type PartKind = Part["kind"];

/** 최근 사용(분 단위 경과, 턴 수). 테스트 기록은 섞지 않는다 */
export interface Recent {
  readonly minutesAgo: number;
  readonly turns: number;
}

/** 설치된 플러그인 하나(표본 카탈로그) */
export interface CvbPlugin {
  readonly id: string;
  readonly kind: Kind;
  readonly anchor: Anchor;
  readonly meta: Meta;
  readonly verb?: Verb;
  /** 가드 등급(같은 자리에서 늘 먼저) */
  readonly guard?: boolean;
  /** 드래프트(리뷰 대기) */
  readonly draft?: boolean;
  /** 코드가 도는가(Hook·Drive·MCP). 없으면 지침·스킬만 든 플러그인이다 */
  readonly runsCode: boolean;
  readonly recent: Recent | null;
  readonly parts: readonly Part[];
}

export type Catalog = ReadonlyMap<string, CvbPlugin>;

export function catalogOf(plugins: readonly CvbPlugin[]): Catalog {
  return new Map(plugins.map((p) => [p.id, p]));
}

/** 프로필 안의 한 줄. base면 베이스에서 온 것(이 프로필에서 뺄 수 없다) */
interface Entry {
  readonly plugin: string;
  readonly base: boolean;
}

/** 이름: 표본은 메시지 id(화면 언어를 따른다), 실제 프로필은 저장된 글 그대로 */
export type Title = { readonly id: MessageId } | { readonly text: string };

/** 플러그인 여럿을 묶는 묶음(접힘·펼침은 화면 상태라 여기 두지 않는다) */
export interface Group {
  readonly id: string;
  readonly title: Title;
  readonly members: readonly string[];
}

export interface ProfileState {
  readonly id: string;
  readonly title: Title;
  readonly entries: readonly Entry[];
  readonly startDrive: string | null;
  readonly groups: readonly Group[];
}

export function hasPlugin(state: ProfileState, plugin: string): boolean {
  return state.entries.some((e) => e.plugin === plugin);
}

export function groupOf(state: ProfileState, plugin: string): Group | null {
  return state.groups.find((g) => g.members.includes(plugin)) ?? null;
}

/** 한 자리에 걸린 플러그인 id, 부르는 순서대로(가드 먼저, 그다음 프로필 순서) */
export function orderAt(state: ProfileState, catalog: Catalog, key: string): readonly string[] {
  const here: { readonly id: string; readonly guard: boolean; readonly index: number }[] = [];
  state.entries.forEach((entry, index) => {
    const plugin = catalog.get(entry.plugin);
    if (plugin === undefined || anchorKey(plugin.anchor) !== key) return;
    here.push({ id: plugin.id, guard: plugin.guard === true, index });
  });
  return here
    .toSorted((a, b) => (a.guard === b.guard ? a.index - b.index : a.guard ? -1 : 1))
    .map((h) => h.id);
}

type Refusal = "absent" | "base" | "tier" | "edge" | "present" | "unknown";

export type Change =
  | { readonly ok: true; readonly state: ProfileState }
  | { readonly ok: false; readonly reason: Refusal };

/** 놓을 수 있는 자리. 플러그인이 선언한 자리 하나다(이미 들었으면 없다) */
export function dropTarget(state: ProfileState, catalog: Catalog, plugin: string): string | null {
  const found = catalog.get(plugin);
  if (found === undefined || hasPlugin(state, plugin)) return null;
  return anchorKey(found.anchor);
}

/** 플러그인을 프로필 끝에 넣는다(자리는 플러그인이 정한다) */
export function addPlugin(state: ProfileState, catalog: Catalog, plugin: string): Change {
  if (!catalog.has(plugin)) return { ok: false, reason: "unknown" };
  if (hasPlugin(state, plugin)) return { ok: false, reason: "present" };
  return { ok: true, state: { ...state, entries: [...state.entries, { plugin, base: false }] } };
}

/** 플러그인을 뺀다. 베이스에서 온 것은 뺄 수 없다. 묶음과 스타트 Drive에서도 함께 빠진다 */
export function removePlugin(state: ProfileState, plugin: string): Change {
  const entry = state.entries.find((e) => e.plugin === plugin);
  if (entry === undefined) return { ok: false, reason: "absent" };
  if (entry.base) return { ok: false, reason: "base" };
  const groups = state.groups
    .map((g) => ({ ...g, members: g.members.filter((m) => m !== plugin) }))
    .filter((g) => g.members.length > 0);
  return {
    ok: true,
    state: {
      ...state,
      entries: state.entries.filter((e) => e.plugin !== plugin),
      groups,
      startDrive: state.startDrive === plugin ? null : state.startDrive,
    },
  };
}

/** 같은 자리 안에서 한 칸 앞(-1)이나 뒤(1)로 옮긴다. 가드 등급의 경계는 넘지 않는다 */
export function movePlugin(
  state: ProfileState,
  catalog: Catalog,
  plugin: string,
  dir: -1 | 1,
): Change {
  const found = catalog.get(plugin);
  if (found === undefined || !hasPlugin(state, plugin)) return { ok: false, reason: "absent" };
  const order = orderAt(state, catalog, anchorKey(found.anchor));
  const at = order.indexOf(plugin);
  const other = order[at + dir];
  if (other === undefined) return { ok: false, reason: "edge" };
  if ((catalog.get(other)?.guard === true) !== (found.guard === true)) {
    return { ok: false, reason: "tier" };
  }
  const a = state.entries.findIndex((e) => e.plugin === plugin);
  const b = state.entries.findIndex((e) => e.plugin === other);
  const entries = state.entries.map((e, i) => {
    if (i === a) return state.entries[b] ?? e;
    if (i === b) return state.entries[a] ?? e;
    return e;
  });
  return { ok: true, state: { ...state, entries } };
}

/** 같은 자리에서 몇째로 부르나(1부터). 자리에 혼자면 null */
export function rankAt(state: ProfileState, catalog: Catalog, plugin: string): number | null {
  const found = catalog.get(plugin);
  if (found === undefined) return null;
  const order = orderAt(state, catalog, anchorKey(found.anchor));
  if (order.length < 2) return null;
  const at = order.indexOf(plugin);
  return at < 0 ? null : at + 1;
}

/** 핸드오프 한 줄(플러그인 ↔ 플러그인) */
export interface Handoff {
  readonly from: string;
  readonly to: string;
  /** 받은 쪽이 끝나면 돌려준다 */
  readonly back: boolean;
}

/** 프로필 안에서 둘 다 든 핸드오프만 */
export function handoffsOf(state: ProfileState, catalog: Catalog): readonly Handoff[] {
  const out: Handoff[] = [];
  for (const entry of state.entries) {
    const plugin = catalog.get(entry.plugin);
    if (plugin === undefined) continue;
    for (const part of plugin.parts) {
      if (part.kind === "handoff" && hasPlugin(state, part.to)) {
        out.push({ from: plugin.id, to: part.to, back: part.back });
      }
    }
  }
  return out;
}
