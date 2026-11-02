// P-21 구성기 진입 상태 기계(목업 전용). spec §6.28, §6.29, 결정 C-6(구성 하나), C-7(선언 없으면 블록 하나), C-8(사람 확인은 drive 원시, 주도 반납).
// 상태 = 대본의 앞 n개 동작을 바로 적용한 모습(a01과 같은 방식). 시나리오는 같은 대본을 이어서 돈다.
export type GroupId = "helm" | "review" | "audit-trail" | "lens-review" | "new";
export type View = "group" | "flow" | "code";
export type Ext = "on" | "off" | "turning" | "no-engine";
export type Handoff = "none" | "opening" | "open" | "created";
export type Gate = "absent" | "idle" | "waiting" | "answered";
export type Trial = "none" | "running" | "waiting" | "after" | "done";

export interface Model {
  group: GroupId;
  view: View;
  name: string;
  start: string | null;
  ext: Ext;
  handoff: Handoff;
  gate: Gate;
  trial: Trial;
  selected: string | null;
  note: string | null;
}

export type Action =
  | { t: "newGroup" }
  | { t: "pickGroup"; group: Exclude<GroupId, "new"> }
  | { t: "name"; value: string }
  | { t: "start"; id: string }
  | { t: "begin" }
  | { t: "view"; view: View }
  | { t: "select"; id: string }
  | { t: "enable" }
  | { t: "enabled" }
  | { t: "make" }
  | { t: "opened" }
  | { t: "created" }
  | { t: "runTrial" }
  | { t: "reachGate" }
  | { t: "answer" }
  | { t: "applied" }
  | { t: "note"; text: string | null };

/** spec §6.29. */
const NAME_RE = /^[a-z][a-z0-9-]{1,31}$/;
const RESERVED = ["helm", "learning", "review", "authoring", "core", "system"];

export function nameError(name: string): string | null {
  if (name === "") return null;
  if (!NAME_RE.test(name)) return "소문자로 시작하고 소문자, 숫자, 하이픈만 써서 2~32자로 지어요";
  if (RESERVED.includes(name)) return `${name}은 예약된 이름이라 쓸 수 없어요`;
  return null;
}

/** 플러그인 빌더는 대상 폴더 안에만 쓴다. 사용자 확장 위치에는 사람 확인 뒤 연결만 한다(authoring §4). */
export const targetFolder = (name: string) => `~/code/${name}`;

export const initial: Model = {
  group: "helm",
  view: "group",
  name: "",
  start: null,
  ext: "on",
  handoff: "none",
  gate: "absent",
  trial: "none",
  selected: "drive",
  note: null,
};

export function reduce(s: Model, a: Action): Model {
  switch (a.t) {
    case "newGroup":
      return { ...initial, group: "new", ext: s.ext, selected: null };
    case "pickGroup":
      return {
        ...initial,
        group: a.group,
        ext: s.ext,
        selected: a.group === "helm" ? "drive" : null,
      };
    case "name":
      return { ...s, name: a.value };
    case "start":
      return { ...s, start: a.id };
    case "begin":
      return {
        ...s,
        group: "lens-review",
        name: s.name === "" ? "lens-review" : s.name,
        selected: "drive",
      };
    case "view":
      return { ...s, view: a.view, selected: a.view === "flow" ? null : s.selected };
    case "select":
      return { ...s, selected: a.id };
    case "enable":
      return { ...s, ext: "turning" };
    case "enabled":
      return { ...s, ext: "on" };
    case "make":
      return { ...s, handoff: "opening" };
    case "opened":
      return { ...s, handoff: "open" };
    case "created":
      return { ...s, handoff: "created" };
    case "runTrial":
      return { ...s, trial: "running", selected: null };
    case "reachGate":
      return { ...s, trial: "waiting", gate: "waiting" };
    case "answer":
      return { ...s, trial: "after", gate: "answered" };
    case "applied":
      return { ...s, trial: "done" };
    case "note":
      return { ...s, note: a.text };
  }
}

interface Script {
  init?: Partial<Model>;
  acts: Action[];
}

const START: Action[] = [
  { t: "newGroup" },
  { t: "name", value: "lens-review" },
  { t: "start", id: "helm" },
  { t: "begin" },
];

export const SCRIPTS: Record<string, Script> = {
  "new-group-make": {
    acts: [...START, { t: "view", view: "code" }, { t: "make" }, { t: "opened" }, { t: "created" }],
  },
  "name-check": { acts: [{ t: "newGroup" }, { t: "name", value: "helm" }] },
  "authoring-off-enable": {
    init: { ext: "off", group: "lens-review", name: "lens-review", start: "helm" },
    acts: [{ t: "enable" }, { t: "enabled" }, { t: "make" }, { t: "opened" }],
  },
  "code-off": {
    init: { ext: "off", group: "lens-review", name: "lens-review", start: "helm", view: "code" },
    acts: [],
  },
  "code-no-engine": {
    init: {
      ext: "no-engine",
      group: "lens-review",
      name: "lens-review",
      start: "helm",
      view: "code",
    },
    acts: [],
  },
  "no-composition": { acts: [{ t: "pickGroup", group: "audit-trail" }] },
  "no-phases": {
    acts: [
      { t: "pickGroup", group: "review" },
      { t: "view", view: "flow" },
    ],
  },
  "gate-trial": {
    init: {
      group: "lens-review",
      name: "lens-review",
      start: "helm",
      view: "flow",
      gate: "idle",
      selected: "gate",
    },
    acts: [{ t: "runTrial" }, { t: "reachGate" }, { t: "answer" }, { t: "applied" }],
  },
};

export const STATES = [
  { id: "new-group", label: "새 그룹(구성 안)" },
  { id: "new-group-name-error", label: "새 그룹: 예약된 이름" },
  { id: "new-group-authoring", label: "새 그룹: 플러그인 빌더로 만들기" },
  { id: "new-group-authoring-off", label: "새 그룹: 플러그인 빌더 꺼짐" },
  { id: "new-group-started", label: "제작 대화로 넘김" },
  { id: "new-group-created", label: "만든 뒤 다음 동작" },
  { id: "code-forward", label: "코드 보기에서 만들기(제안)" },
  { id: "code-forward-off", label: "코드 보기: 플러그인 빌더 꺼짐(제안)" },
  { id: "code-forward-no-engine", label: "코드 보기: 엔진 없음(제안)" },
  { id: "no-composition", label: "구성 정보 없음" },
  { id: "no-phases", label: "단계 선언이 없어요" },
  { id: "gate-node", label: "사람 확인 노드" },
  { id: "gate-node-trial", label: "사람 확인 노드: 테스트가 기다림" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

export const AT: Record<StateId, { script: string; n: number }> = {
  "new-group": { script: "new-group-make", n: 1 },
  "new-group-name-error": { script: "name-check", n: 2 },
  "new-group-authoring": { script: "new-group-make", n: 4 },
  "new-group-authoring-off": { script: "authoring-off-enable", n: 0 },
  "new-group-started": { script: "new-group-make", n: 7 },
  "new-group-created": { script: "new-group-make", n: 8 },
  "code-forward": { script: "new-group-make", n: 5 },
  "code-forward-off": { script: "code-off", n: 0 },
  "code-forward-no-engine": { script: "code-no-engine", n: 0 },
  "no-composition": { script: "no-composition", n: 1 },
  "no-phases": { script: "no-phases", n: 2 },
  "gate-node": { script: "gate-trial", n: 0 },
  "gate-node-trial": { script: "gate-trial", n: 2 },
};

export const SCENARIOS = [
  { id: "new-group-make", label: "새 그룹 → 코드 보기 → 제작 대화 → 다음 동작" },
  { id: "authoring-off-enable", label: "플러그인 빌더 꺼짐 → 켜기 → 만들기" },
  { id: "gate-trial", label: "사람 확인 노드 → 테스트 → 답하기" },
];

export function modelAt(script: string, n: number): Model {
  const sc = SCRIPTS[script];
  if (sc === undefined) return initial;
  let m: Model = { ...initial, ...sc.init };
  for (const a of sc.acts.slice(0, n)) m = reduce(m, a);
  return m;
}

/** 저절로 오는 다음 동작: 스피너 자리만 시간으로 넘어간다. */
export function nextAuto(s: Model): { after: number; action: Action } | null {
  if (s.ext === "turning") return { after: 900, action: { t: "enabled" } };
  if (s.handoff === "opening") return { after: 1000, action: { t: "opened" } };
  if (s.handoff === "open") return { after: 2600, action: { t: "created" } };
  if (s.trial === "running") return { after: 1400, action: { t: "reachGate" } };
  if (s.trial === "after") return { after: 1400, action: { t: "applied" } };
  return null;
}
