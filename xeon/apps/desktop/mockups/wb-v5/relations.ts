// 링크(Link) 보기의 관계: 고른 플러그인이 다른 플러그인과 어떤 실로 이어지는지 뽑는다. 화면과 무관한 순수 함수다.
// 종류는 다섯뿐이다: 같은 시점(같은 훅 줄), 기능(제공·사용), 그룹(같은 묶음), 주도(둘 다 주도를 선언), 기록(남김·읽음).
import {
  FOLD_LABEL,
  LEAD,
  OTHER_HOOKS,
  groupById,
  hookDef,
  type Failure,
  type Plugin,
} from "./data";

export type RelKind = "hook" | "cap" | "group" | "drive" | "record";

/** 종류 순서: 고른 것의 점과 실의 색이 이 순서로 나온다. */
export const REL_ORDER: readonly RelKind[] = ["hook", "cap", "group", "drive", "record"];

/** 종류 이름(카드 제목, 점의 이름) */
export const REL_LABEL: Record<RelKind, string> = {
  hook: "같은 시점",
  cap: "기능",
  group: "그룹",
  drive: "주도",
  record: "기록",
};

/** 방향 이름. 훅은 상대가 먼저 불리나 나중에 불리나, 기능은 고른 것이 주나 쓰나, 기록은 남기나 읽나. */
export const DIR_LABEL = {
  before: "먼저 실행",
  after: "나중 실행",
  provide: "제공",
  use: "사용",
  write: "남김",
  read: "읽음",
} as const;

/** 기능을 쓰는 쪽의 요구: 없으면 안 되나, 없어도 되나 */
export const NEED_LABEL = { required: "필수", optional: "선택" } as const;

/** 주도: 고른 것이 쥐었나, 다른 쪽과 겨루나 */
export const DRIVE_LABEL = { holds: "보유", contend: "경합" } as const;

/** 상태 이름: 켜짐·꺼짐은 전역 스위치, 실패는 연속 실패 표식 */
export const STATE_LABEL = { on: "켜짐", off: "꺼짐", fail: "실패" } as const;

/** 실패 처리(HookDef.failure)를 한 단어로 */
export const FAIL_LABEL: Record<Failure, string> = {
  closed: "닫힘",
  open: "열림",
  skip: "건너뜀",
};

/** 카드의 줄 이름 */
export const FACT_LABEL = {
  hook: "훅",
  order: "순서",
  dir: "방향",
  rule: "규칙",
  failure: "실패 처리",
  cap: "기능",
  need: "요구",
  providers: "제공자 수",
  peer: "상대 상태",
  group: "그룹",
  version: "버전",
  members: "구성원 켜짐",
  drive: "주도",
  limit: "한도",
  recordKind: "기록 종류",
  prefix: "접두",
} as const;

export interface RelMeter {
  value: number;
  max: number;
}

/** 카드의 한 줄: 이름과 값. 값이 경계가 있는 수면 meter가 붙는다. */
export interface RelFact {
  label: string;
  value: string;
  /** 값을 mono 글꼴로 */
  mono: boolean;
  /** 값 아래의 작은 글(훅 id 등). 없으면 "" */
  note: string;
  meter: RelMeter | null;
}

export interface Relation {
  kind: RelKind;
  /** 상대 플러그인 */
  other: Plugin;
  /** 맞닿은 수: 훅 줄 수, 기능 연결 수, 기록 종류 수. 실 가닥 수와 "+n"에 쓴다. */
  count: number;
  facts: RelFact[];
}

interface FactOpt {
  mono?: boolean;
  note?: string;
  meter?: RelMeter;
}

const fact = (label: string, value: string, o: FactOpt = {}): RelFact => ({
  label,
  value,
  mono: o.mono ?? false,
  note: o.note ?? "",
  meter: o.meter ?? null,
});

/** 기록 종류가 읽기 패턴에 맞나. 끝이 ".*"이면 앞부분으로 시작하는지 본다(스펙 §3.6). */
export const matchesRecord = (pattern: string, kind: string): boolean =>
  pattern.endsWith(".*") ? kind.startsWith(pattern.slice(0, -1)) : pattern === kind;

type Need = keyof typeof NEED_LABEL;

/** 플러그인이 이 기능을 요구하나(필수), 선택으로 쓰나(선택), 아무것도 아닌가(null) */
const needOf = (p: Plugin, cap: string): Need | null => {
  if ((p.requires ?? []).includes(cap)) return "required";
  if ((p.optional ?? []).includes(cap)) return "optional";
  return null;
};

/** 같은 훅 줄: 둘 다 그 훅을 선언하고 둘 다 줄에 있다. 여럿이면 첫 훅을 보이고 개수를 센다. */
function hookRel(focus: Plugin, other: Plugin, order: Record<string, string[]>): Relation | null {
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
  const def = hookDef(first);
  const fold = def?.fold ?? OTHER_HOOKS.find((o) => o.id === first)?.fold;
  const facts: RelFact[] = [
    fact(FACT_LABEL.hook, def?.label ?? first, { note: first }),
    fact(FACT_LABEL.dir, at < here ? DIR_LABEL.before : DIR_LABEL.after),
  ];
  if (fold !== undefined) facts.push(fact(FACT_LABEL.rule, FOLD_LABEL[fold]));
  facts.push(
    fact(FACT_LABEL.order, `${at + 1}/${lane.length}`, {
      meter: { value: at + 1, max: lane.length },
    }),
  );
  if (def !== undefined) facts.push(fact(FACT_LABEL.failure, FAIL_LABEL[def.failure]));
  return { kind: "hook", other, count: shared.length, facts };
}

/** 기능: 고른 것이 주는 기능을 상대가 쓰거나, 상대가 주는 기능을 고른 것이 쓴다. */
function capRel(
  focus: Plugin,
  other: Plugin,
  plugins: readonly Plugin[],
  isOn: (id: string) => boolean,
): Relation | null {
  const give = focus.provides.filter((c) => needOf(other, c) !== null);
  const take = other.provides.filter((c) => needOf(focus, c) !== null);
  const first = give[0] ?? take[0];
  if (first === undefined) return null;
  // 요구 여부는 기능을 쓰는 쪽이 정한다
  const consumer = give.includes(first) ? other : focus;
  const need = needOf(consumer, first) ?? "optional";
  const dirs = [
    ...(give.length > 0 ? [DIR_LABEL.provide] : []),
    ...(take.length > 0 ? [DIR_LABEL.use] : []),
  ];
  const providers = plugins.filter((p) => p.provides.includes(first)).length;
  return {
    kind: "cap",
    other,
    count: give.length + take.length,
    facts: [
      fact(FACT_LABEL.cap, first, { mono: true }),
      fact(FACT_LABEL.dir, dirs.join(" · ")),
      fact(FACT_LABEL.need, NEED_LABEL[need]),
      fact(FACT_LABEL.providers, String(providers)),
      fact(FACT_LABEL.peer, isOn(other.id) ? STATE_LABEL.on : STATE_LABEL.off),
    ],
  };
}

/** 그룹: 같은 group. 그룹은 한 번에 켜고 끈다(스펙 §4.5). */
function groupRel(focus: Plugin, other: Plugin, isOn: (id: string) => boolean): Relation | null {
  if (focus.group === undefined || other.group !== focus.group) return null;
  const g = groupById(focus.group);
  const members = g?.members ?? [];
  const on = members.filter((id) => isOn(id)).length;
  const facts: RelFact[] = [fact(FACT_LABEL.group, g?.name ?? focus.group)];
  if (g !== undefined) facts.push(fact(FACT_LABEL.version, g.version, { mono: true }));
  facts.push(
    fact(FACT_LABEL.members, `${on}/${members.length}`, {
      meter: { value: on, max: members.length },
    }),
  );
  return { kind: "group", other, count: 1, facts };
}

/** 주도: 둘 다 drives를 선언하면 경합이다(스펙 §4.6, drive_conflict). 아직 짝이 되는 데이터는 없다. */
function driveRel(focus: Plugin, other: Plugin): Relation | null {
  if (focus.drives !== true || other.drives !== true) return null;
  const holds = LEAD.holder === focus.id;
  const [used, limit] = LEAD.turns;
  return {
    kind: "drive",
    other,
    count: 1,
    facts: [
      fact(FACT_LABEL.drive, holds ? DRIVE_LABEL.holds : DRIVE_LABEL.contend),
      fact(FACT_LABEL.limit, `${used}/${limit}`, { meter: { value: used, max: limit } }),
    ],
  };
}

/** 기록: 고른 것이 남긴 종류를 상대가 읽거나, 상대가 남긴 종류를 고른 것이 읽는다. */
function recordRel(focus: Plugin, other: Plugin): Relation | null {
  const wrote = (focus.records ?? []).filter((k) =>
    (other.reads ?? []).some((p) => matchesRecord(p, k)),
  );
  const read = (other.records ?? []).filter((k) =>
    (focus.reads ?? []).some((p) => matchesRecord(p, k)),
  );
  const first = wrote[0] ?? read[0];
  if (first === undefined) return null;
  const dirs = [
    ...(wrote.length > 0 ? [DIR_LABEL.write] : []),
    ...(read.length > 0 ? [DIR_LABEL.read] : []),
  ];
  return {
    kind: "record",
    other,
    count: wrote.length + read.length,
    facts: [
      fact(FACT_LABEL.recordKind, first, { mono: true }),
      fact(FACT_LABEL.dir, dirs.join(" · ")),
      fact(FACT_LABEL.prefix, first.split(".")[0] ?? ""),
    ],
  };
}

/**
 * 고른 플러그인과 다른 플러그인 사이의 관계 전부. 상대마다 종류별로 하나씩 나온다.
 * order는 훅 줄 순서(store의 order), isOn은 켜짐 스위치(store의 isOn)다.
 */
export function relationsOf(
  focus: Plugin,
  plugins: readonly Plugin[],
  order: Record<string, string[]>,
  isOn: (id: string) => boolean,
): Relation[] {
  const out: Relation[] = [];
  for (const other of plugins) {
    if (other.id === focus.id) continue;
    const found = [
      hookRel(focus, other, order),
      capRel(focus, other, plugins, isOn),
      groupRel(focus, other, isOn),
      driveRel(focus, other),
      recordRel(focus, other),
    ];
    for (const rel of found) if (rel !== null) out.push(rel);
  }
  return out;
}
