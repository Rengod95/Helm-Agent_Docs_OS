// 링크(Link) 보기의 관계: 고른 플러그인이 다른 플러그인과 어떤 실로 이어지는지 뽑는다. 화면과 무관한 순수 함수다.
// 종류는 다섯: 같은 시점(같은 훅 줄), 기능(제공·사용), 그룹(같은 묶음), 주도(둘 다 주도를 선언), 기록(남김·읽음).
// 문구는 없다. 이름표는 번역 키(labelKey, msg의 keys)로, 값은 엔진 데이터(data)로 준다. 화면이 키를 옮긴다.
import { hookDef, hookFold } from "./hooks.ts";
import { isOn } from "./select.ts";
import type { CanvasPlugin, CanvasSnapshot } from "./types.ts";

export type RelKind = "hook" | "cap" | "group" | "drive" | "record";

/** 점과 실의 색 순서: 고른 것의 점이 이 순서로 나온다 */
export const REL_ORDER: readonly RelKind[] = ["hook", "cap", "group", "drive", "record"];

/** 값: 번역 키들(화면이 " · "로 잇는다) 또는 엔진 데이터(id, 버전, 숫자) */
type RelValue =
  | { readonly k: "msg"; readonly keys: readonly string[] }
  | { readonly k: "data"; readonly text: string };

interface RelMeter {
  readonly value: number;
  readonly max: number;
}

/** 카드의 한 줄: 이름 키와 값. 값이 경계가 있는 수면 meter가 붙는다 */
interface RelFact {
  readonly labelKey: string;
  readonly value: RelValue;
  /** 값을 고정폭 글꼴로 */
  readonly mono: boolean;
  /** 값 아래의 작은 글(엔진 데이터). 없으면 "" */
  readonly note: string;
  readonly meter: RelMeter | null;
}

export interface Relation {
  readonly kind: RelKind;
  readonly other: CanvasPlugin;
  /** 맞닿은 수: 훅 줄 수, 기능 연결 수, 기록 종류 수. 실 가닥 수에 쓴다 */
  readonly count: number;
  readonly facts: readonly RelFact[];
}

/** 관계를 읽는 데 필요한 바깥 상태. 훅 줄 순서와 주도 보유자·턴 사용량이다 */
export interface RelationContext {
  /** 훅 줄 순서(hooksInOrder의 결과): 훅 id → 불리는 순서의 플러그인 id들 */
  readonly order: Readonly<Record<string, readonly string[]>>;
  /** 주도 보유자(없으면 null)와 턴 사용량 [쓴 수, 한도] */
  readonly drive: { readonly holder: string | null; readonly turns: readonly [number, number] };
}

interface FactOpt {
  readonly mono?: boolean;
  readonly note?: string;
  readonly meter?: RelMeter;
}

const msg = (...keys: string[]): RelValue => ({ k: "msg", keys });
const data = (text: string): RelValue => ({ k: "data", text });

const fact = (labelKey: string, value: RelValue, o: FactOpt = {}): RelFact => ({
  labelKey,
  value,
  mono: o.mono ?? false,
  note: o.note ?? "",
  meter: o.meter ?? null,
});

/** 기록 종류가 읽기 패턴에 맞나. 끝이 ".*"이면 앞부분으로 시작하는지 본다(스펙 §3.6) */
export const matchesRecord = (pattern: string, kind: string): boolean =>
  pattern.endsWith(".*") ? kind.startsWith(pattern.slice(0, -1)) : pattern === kind;

type Need = "required" | "optional";

/** 플러그인이 이 기능을 요구하나(필수), 선택으로 쓰나(선택), 아무것도 아닌가(null) */
const needOf = (p: CanvasPlugin, cap: string): Need | null => {
  if ((p.requires ?? []).includes(cap)) return "required";
  if ((p.optional ?? []).includes(cap)) return "optional";
  return null;
};

/** 같은 훅 줄: 둘 다 그 훅을 선언하고 둘 다 줄에 있다. 여럿이면 첫 훅을 보이고 개수를 센다 */
function hookRel(
  focus: CanvasPlugin,
  other: CanvasPlugin,
  order: RelationContext["order"],
): Relation | null {
  const shared = focus.hooks.filter((h) => {
    if (!other.hooks.includes(h)) return false;
    const lane = order[h] ?? [];
    return lane.includes(focus.id) && lane.includes(other.id);
  });
  const first = shared[0];
  if (first === undefined) return null;
  const lane = order[first] ?? [];
  const at = lane.indexOf(other.id);
  const here = lane.indexOf(focus.id);
  const fold = hookFold(first);
  const def = hookDef(first);
  const facts: RelFact[] = [
    fact("rel.fact.hook", data(first), { mono: true }),
    fact("rel.fact.dir", msg(at < here ? "rel.dir.before" : "rel.dir.after")),
  ];
  if (fold !== undefined) facts.push(fact("rel.fact.rule", msg(`rel.fold.${fold}`)));
  facts.push(
    fact("rel.fact.order", data(`${at + 1}/${lane.length}`), {
      meter: { value: at + 1, max: lane.length },
    }),
  );
  if (def !== undefined) facts.push(fact("rel.fact.failure", msg(`rel.fail.${def.failure}`)));
  return { kind: "hook", other, count: shared.length, facts };
}

/** 기능: 고른 것이 주는 기능을 상대가 쓰거나, 상대가 주는 기능을 고른 것이 쓴다 */
function capRel(
  focus: CanvasPlugin,
  other: CanvasPlugin,
  snapshot: CanvasSnapshot,
): Relation | null {
  const give = focus.provides.filter((c) => needOf(other, c) !== null);
  const take = other.provides.filter((c) => needOf(focus, c) !== null);
  const first = give[0] ?? take[0];
  if (first === undefined) return null;
  // 요구 여부는 기능을 쓰는 쪽이 정한다
  const consumer = give.includes(first) ? other : focus;
  const need = needOf(consumer, first) ?? "optional";
  const dirKeys = [
    ...(give.length > 0 ? ["rel.dir.provide"] : []),
    ...(take.length > 0 ? ["rel.dir.use"] : []),
  ];
  const providers = snapshot.plugins.filter((p) => p.provides.includes(first)).length;
  return {
    kind: "cap",
    other,
    count: give.length + take.length,
    facts: [
      fact("rel.fact.cap", data(first), { mono: true }),
      fact("rel.fact.dir", msg(...dirKeys)),
      fact("rel.fact.need", msg(`rel.need.${need}`)),
      fact("rel.fact.providers", data(String(providers))),
      fact("rel.fact.peer", msg(isOn(other) ? "rel.state.on" : "rel.state.off")),
    ],
  };
}

/** 그룹: 같은 group. 그룹은 한 번에 켜고 끈다(스펙 §4.5) */
function groupRel(
  focus: CanvasPlugin,
  other: CanvasPlugin,
  snapshot: CanvasSnapshot,
  byId: ReadonlyMap<string, CanvasPlugin>,
): Relation | null {
  const gid = focus.group;
  if (gid === undefined || other.group !== gid) return null;
  const g = snapshot.groups.find((x) => x.id === gid);
  const members = g?.members ?? [];
  const on = members.filter((id) => {
    const p = byId.get(id);
    return p !== undefined && isOn(p);
  }).length;
  const facts: RelFact[] = [fact("rel.fact.group", data(g?.name ?? gid))];
  if (g !== undefined) facts.push(fact("rel.fact.version", data(g.version), { mono: true }));
  facts.push(
    fact("rel.fact.members", data(`${on}/${members.length}`), {
      meter: { value: on, max: members.length },
    }),
  );
  return { kind: "group", other, count: 1, facts };
}

/** 주도: 둘 다 drives를 선언하면 경합이다(스펙 §4.6, drive_conflict) */
function driveRel(
  focus: CanvasPlugin,
  other: CanvasPlugin,
  drive: RelationContext["drive"],
): Relation | null {
  if (focus.drives !== true || other.drives !== true) return null;
  const holds = drive.holder === focus.id;
  const [used, limit] = drive.turns;
  return {
    kind: "drive",
    other,
    count: 1,
    facts: [
      fact("rel.fact.drive", msg(holds ? "rel.drive.holds" : "rel.drive.contend")),
      fact("rel.fact.limit", data(`${used}/${limit}`), { meter: { value: used, max: limit } }),
    ],
  };
}

/** 기록: 고른 것이 남긴 종류를 상대가 읽거나, 상대가 남긴 종류를 고른 것이 읽는다 */
function recordRel(focus: CanvasPlugin, other: CanvasPlugin): Relation | null {
  const wrote = (focus.records ?? []).filter((k) =>
    (other.reads ?? []).some((p) => matchesRecord(p, k)),
  );
  const read = (other.records ?? []).filter((k) =>
    (focus.reads ?? []).some((p) => matchesRecord(p, k)),
  );
  const first = wrote[0] ?? read[0];
  if (first === undefined) return null;
  const dirKeys = [
    ...(wrote.length > 0 ? ["rel.dir.write"] : []),
    ...(read.length > 0 ? ["rel.dir.read"] : []),
  ];
  return {
    kind: "record",
    other,
    count: wrote.length + read.length,
    facts: [
      fact("rel.fact.recordKind", data(first), { mono: true }),
      fact("rel.fact.dir", msg(...dirKeys)),
      fact("rel.fact.prefix", data(first.split(".")[0] ?? "")),
    ],
  };
}

/**
 * 고른 플러그인과 다른 플러그인 사이의 관계 전부. 상대마다 종류별로 하나씩, 목록 순서대로 나온다.
 */
export function relationsOf(
  focus: CanvasPlugin,
  snapshot: CanvasSnapshot,
  ctx: RelationContext,
): Relation[] {
  const byId = new Map<string, CanvasPlugin>(
    snapshot.plugins.map((p): [string, CanvasPlugin] => [p.id, p]),
  );
  const out: Relation[] = [];
  for (const other of snapshot.plugins) {
    if (other.id === focus.id) continue;
    const found = [
      hookRel(focus, other, ctx.order),
      capRel(focus, other, snapshot),
      groupRel(focus, other, snapshot, byId),
      driveRel(focus, other, ctx.drive),
      recordRel(focus, other),
    ];
    for (const rel of found) {
      if (rel !== null) out.push(rel);
    }
  }
  return out;
}
