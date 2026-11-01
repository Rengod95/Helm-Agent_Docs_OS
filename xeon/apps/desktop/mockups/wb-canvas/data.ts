// 런타임 캔버스 고정 데이터. 공용 작업대 데이터(_shell/workbench-fixtures, 스펙 §14.5)를 캔버스 좌표로 옮기고,
// 매니페스트(F.extensions §3.1), 지점 표(§3.4), 임대(X.primitives §4.4), 그룹 상태(L3.group-kit §3.8)에 맞춰 덧붙였다.
// 덧붙인 값은 `// [덧붙임]`. §14.5와 다르게 둔 곳은 SPEC.md "고정 데이터 정정"에 적었다.

export type BandId = "L3" | "L2" | "L1" | "L0" | "X" | "F";

export interface Band {
  id: BandId;
  title: string;
  y: number;
  h: number;
}

/** 세계 좌표(줌 1 = px). 위가 L3, 아래가 F: 위층이 아래층에 기대어 쌓인다. */
export const WORLD = { w: 1130, h: 640 };
export const BANDS: Band[] = [
  { id: "L3", title: "의도 그룹", y: 0, h: 146 },
  { id: "L2", title: "능력", y: 154, h: 112 },
  { id: "L1", title: "코어", y: 274, h: 64 },
  { id: "L0", title: "플랫폼", y: 346, h: 50 },
  { id: "X", title: "확장 호스트", y: 404, h: 178 },
  { id: "F", title: "계약", y: 590, h: 50 },
];
/** L2 띠 안 외부 plugin 칸(매니페스트 layer "plugin")의 시작 x. */
export const PLUGIN_LANE_X = 800;

export type NodeKind = "group" | "plugin" | "core" | "platform" | "host" | "contract" | "hook";
export type Health = "ok" | "failing" | "auto_disabled" | "disabled" | "waiting_cap";
export type Trust = "builtin" | "user" | "project";

export interface Cap {
  id: string;
  /** requires(없으면 켜지지 않음) 또는 optional(없으면 저하 동작). */
  need: "requires" | "optional";
}

export interface CNode {
  id: string;
  band: BandId;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  kind: NodeKind;
  trust?: Trust;
  version?: string;
  health: Health;
  failures?: number;
  /** 매니페스트 points(on을 거는 지점). */
  points?: string[];
  usesPost?: boolean;
  usesDrive?: boolean;
  provides?: string[];
  consumes?: Cap[];
  /** 면제 tier(core, guard): 끌 수 없다. */
  exempt?: boolean;
  /** 보조 글(층 노드 아닌 X·F 노드). */
  sub?: string;
}

export const NODES: CNode[] = [
  // ── L3 의도 그룹(group-kit 레일 위에 놓인 블록)
  {
    id: "helm",
    band: "L3",
    x: 96,
    y: 22,
    w: 150,
    h: 58,
    label: "Helm",
    kind: "group",
    trust: "user",
    version: "0.1.0",
    health: "ok",
    failures: 1,
    points: [
      "input.agent.before",
      "tool.call.before",
      "tool.execution.after",
      "boundary.settle.after",
      "session.start",
      "lifecycle.lease.rejected",
    ],
    usesPost: true,
    usesDrive: true,
    consumes: [
      { id: "web.search", need: "optional" },
      { id: "web.fetch", need: "optional" },
      { id: "knowledge.search", need: "optional" },
      { id: "knowledge.skills", need: "optional" },
      { id: "knowledge.memory", need: "optional" },
      { id: "work.tasks", need: "optional" },
    ],
  },
  // [덧붙임] 둘째 drive 그룹. §14.5의 대기열(review 대기, work 거부)은 모델과 맞지 않아(SPEC "고정 데이터 정정") 이 그룹이 대기한다.
  {
    id: "plan-first",
    band: "L3",
    x: 258,
    y: 22,
    w: 150,
    h: 58,
    label: "계획 먼저",
    kind: "group",
    trust: "user",
    version: "0.3.0",
    health: "ok",
    points: ["input.agent.before", "boundary.step.after"],
    usesPost: true,
    usesDrive: true,
    consumes: [{ id: "work.tasks", need: "requires" }],
  },
  {
    id: "learning",
    band: "L3",
    x: 420,
    y: 22,
    w: 150,
    h: 58,
    label: "학습",
    kind: "group",
    trust: "builtin",
    version: "0.4.0",
    health: "ok",
    points: ["boundary.step.after", "boundary.settle.after"],
    usesPost: true,
    usesDrive: false,
    consumes: [
      { id: "knowledge.skills", need: "requires" },
      { id: "xeon.agents", need: "requires" },
    ],
  },
  {
    id: "review",
    band: "L3",
    x: 582,
    y: 22,
    w: 150,
    h: 58,
    label: "리뷰",
    kind: "group",
    trust: "user",
    version: "0.2.1",
    health: "auto_disabled",
    failures: 5,
    points: ["tool.call.before", "boundary.settle.after"],
    usesPost: true,
    usesDrive: true,
    consumes: [{ id: "work.tasks", need: "optional" }],
  },
  // ── L2 능력 provider
  {
    id: "web",
    band: "L2",
    x: 96,
    y: 190,
    w: 128,
    h: 48,
    label: "웹",
    kind: "plugin",
    trust: "builtin",
    version: "0.4.0",
    health: "ok",
    provides: ["web.search", "web.fetch"],
  },
  {
    id: "web-exa",
    band: "L2",
    x: 236,
    y: 190,
    w: 128,
    h: 48,
    label: "Exa 검색",
    kind: "plugin",
    trust: "user",
    version: "1.0.3",
    health: "ok",
    sub: "web.search provider",
  },
  {
    id: "knowledge",
    band: "L2",
    x: 376,
    y: 190,
    w: 128,
    h: 48,
    label: "지식",
    kind: "plugin",
    trust: "builtin",
    version: "0.4.0",
    health: "ok",
    provides: ["knowledge.skills", "knowledge.memory"],
  },
  {
    id: "work",
    band: "L2",
    x: 516,
    y: 190,
    w: 128,
    h: 48,
    label: "작업",
    kind: "plugin",
    trust: "builtin",
    version: "0.4.0",
    health: "ok",
    provides: ["work.tasks"],
  },
  {
    id: "dialog",
    band: "L2",
    x: 656,
    y: 190,
    w: 128,
    h: 48,
    label: "대화 도구",
    kind: "plugin",
    trust: "builtin",
    version: "0.4.0",
    health: "ok",
    provides: ["dialog.ask", "dialog.aside"],
  },
  {
    id: "acme-notes",
    band: "L2",
    x: 820,
    y: 190,
    w: 128,
    h: 48,
    label: "acme 노트",
    kind: "plugin",
    trust: "project",
    version: "0.0.9",
    health: "failing",
    failures: 2,
    points: ["tool.call.before"],
  },
  {
    id: "provider-oauth",
    band: "L2",
    x: 960,
    y: 190,
    w: 128,
    h: 48,
    label: "OAuth 모델",
    kind: "plugin",
    trust: "user",
    version: "0.1.0",
    health: "disabled",
    consumes: [{ id: "models.oauth", need: "requires" }],
  },
  // ── L1 코어
  {
    id: "loop",
    band: "L1",
    x: 96,
    y: 292,
    w: 112,
    h: 34,
    label: "loop",
    kind: "core",
    health: "ok",
    exempt: true,
    sub: "지점 발화",
  },
  {
    id: "tools",
    band: "L1",
    x: 220,
    y: 292,
    w: 112,
    h: 34,
    label: "tools",
    kind: "core",
    health: "ok",
    exempt: true,
  },
  {
    id: "models",
    band: "L1",
    x: 344,
    y: 292,
    w: 112,
    h: 34,
    label: "models",
    kind: "core",
    health: "ok",
    exempt: true,
  },
  {
    id: "agents",
    band: "L1",
    x: 468,
    y: 292,
    w: 112,
    h: 34,
    label: "agents",
    kind: "core",
    health: "ok",
    exempt: true,
    provides: ["xeon.agents"],
  },
  {
    id: "context",
    band: "L1",
    x: 592,
    y: 292,
    w: 112,
    h: 34,
    label: "context",
    kind: "core",
    health: "ok",
    exempt: true,
  },
  // ── L0 플랫폼
  {
    id: "sqlite",
    band: "L0",
    x: 96,
    y: 358,
    w: 96,
    h: 28,
    label: "sqlite",
    kind: "platform",
    health: "ok",
  },
  {
    id: "exec",
    band: "L0",
    x: 204,
    y: 358,
    w: 96,
    h: 28,
    label: "exec",
    kind: "platform",
    health: "ok",
  },
  {
    id: "sandbox",
    band: "L0",
    x: 312,
    y: 358,
    w: 96,
    h: 28,
    label: "sandbox",
    kind: "platform",
    health: "ok",
  },
  {
    id: "secrets",
    band: "L0",
    x: 420,
    y: 358,
    w: 96,
    h: 28,
    label: "secrets",
    kind: "platform",
    health: "ok",
  },
  // ── X 확장 호스트(지점 레일은 따로 그린다: POINT_RAIL)
  {
    id: "x-post",
    band: "X",
    x: 96,
    y: 496,
    w: 170,
    h: 64,
    label: "post 큐",
    kind: "host",
    health: "ok",
    sub: "steer · followUp · next",
  },
  {
    id: "x-lease",
    band: "X",
    x: 280,
    y: 496,
    w: 260,
    h: 64,
    label: "drive 임대",
    kind: "host",
    health: "ok",
    sub: "대화마다 하나",
  },
  {
    id: "x-scope",
    band: "X",
    x: 554,
    y: 496,
    w: 170,
    h: 64,
    label: "scope",
    kind: "host",
    health: "ok",
    sub: "켜기·끄기는 단계 경계에",
  },
  {
    id: "x-ops",
    band: "X",
    x: 738,
    y: 496,
    w: 170,
    h: 64,
    label: "운영",
    kind: "host",
    health: "ok",
    sub: "예산 · 자동 끄기 5번 · 안전 모드",
  },
  {
    id: "pre-commit-lint",
    band: "X",
    x: 922,
    y: 496,
    w: 150,
    h: 64,
    label: "pre-commit-lint",
    kind: "hook",
    trust: "user",
    health: "ok",
    sub: "X 훅",
  },
  // ── F 계약(읽기 전용)
  {
    id: "f-manifest",
    band: "F",
    x: 96,
    y: 601,
    w: 116,
    h: 28,
    label: "매니페스트",
    kind: "contract",
    health: "ok",
  },
  {
    id: "f-points",
    band: "F",
    x: 222,
    y: 601,
    w: 116,
    h: 28,
    label: "지점 표 46",
    kind: "contract",
    health: "ok",
  },
  {
    id: "f-ops",
    band: "F",
    x: 348,
    y: 601,
    w: 116,
    h: 28,
    label: "4연산",
    kind: "contract",
    health: "ok",
  },
  {
    id: "f-records",
    band: "F",
    x: 474,
    y: 601,
    w: 116,
    h: 28,
    label: "그룹 레코드",
    kind: "contract",
    health: "ok",
  },
  {
    id: "f-caps",
    band: "F",
    x: 600,
    y: 601,
    w: 116,
    h: 28,
    label: "능력 계약",
    kind: "contract",
    health: "ok",
  },
  {
    id: "f-wire",
    band: "F",
    x: 726,
    y: 601,
    w: 116,
    h: 28,
    label: "wire·설정",
    kind: "contract",
    health: "ok",
  },
];

export const nodeById = (id: string) => NODES.find((n) => n.id === id);

/** L3 띠 아래쪽 group-kit 레일. 그룹 블록이 그 위에 쌓인다(group-kit은 확장이 아니라 라이브러리라 노드가 아니다). */
export const GROUP_KIT = { x: 96, y: 98, w: 798, h: 28 };
/** 그룹 블록을 하나 더 쌓을 빈 칸(만들기 P-22로). */
export const ADD_SLOT = { x: 744, y: 22, w: 150, h: 58 };

// ── 지점 레일(X): 지점 종류 일곱, 쓰이는 지점만 이름을 보이고 나머지는 수로 접는다(F.extensions §3.4 집계).
export type Fold = "tap" | "first" | "chain" | "collect";
export interface RailSeg {
  kind: string;
  count: number;
  x: number;
  w: number;
}
export const POINT_RAIL = { x: 96, y: 420, h: 60 };
export const RAIL_SEGS: RailSeg[] = [
  { kind: "input", count: 3, x: 96, w: 120 },
  { kind: "request", count: 9, x: 216, w: 70 },
  { kind: "guard", count: 3, x: 286, w: 60 },
  { kind: "tool", count: 5, x: 346, w: 230 },
  { kind: "boundary", count: 9, x: 576, w: 260 },
  { kind: "session", count: 15, x: 836, w: 100 },
  { kind: "lifecycle", count: 2, x: 936, w: 170 },
];
export interface PointPort {
  name: string;
  fold: Fold;
  failure: "open" | "closed" | "skip";
  x: number;
}
export const POINT_PORTS: PointPort[] = [
  { name: "input.agent.before", fold: "collect", failure: "open", x: 106 },
  { name: "tool.call.before", fold: "first", failure: "closed", x: 356 },
  { name: "tool.execution.after", fold: "tap", failure: "open", x: 458 },
  { name: "boundary.step.after", fold: "chain", failure: "skip", x: 596 },
  { name: "boundary.settle.after", fold: "tap", failure: "open", x: 712 },
  { name: "session.start", fold: "tap", failure: "open", x: 846 },
  { name: "lifecycle.lease.rejected", fold: "tap", failure: "open", x: 946 },
];
/** 재생에서만 잠깐 켜지는 지점(아무 핸들러도 걸지 않은 지점은 레일 수 안에 접혀 있다). */
export const QUIET_PORTS: { name: string; x: number }[] = [
  { name: "input.user.before", x: 206 },
  { name: "request.provider.before", x: 250 },
  { name: "guard.model.before", x: 316 },
  { name: "boundary.step.before", x: 584 },
];
export const portByName = (n: string) =>
  POINT_PORTS.find((p) => p.name === n) ?? QUIET_PORTS.find((p) => p.name === n);

// ── 맥락(§4.9.3 대화 맥락 칸을 넷으로 넓힘: SPEC "맥락 분리")
export type CtxKind = "all" | "thread" | "profile" | "trial";
export interface CtxOption {
  value: string;
  kind: CtxKind;
  label: string;
}
export const CONTEXTS: CtxOption[] = [
  { value: "all", kind: "all", label: "전체" },
  { value: "t1", kind: "thread", label: "캐시 무효화 조사" },
  { value: "t2", kind: "thread", label: "테스트 정리" },
  { value: "p:explore", kind: "profile", label: "탐구 중심" },
  { value: "p:quiet", kind: "profile", label: "조용히" },
  { value: "p:review-trial", kind: "profile", label: "review 시험" },
  { value: "x:lens5", kind: "trial", label: "helm 렌즈 5개" },
];
export const ctxOf = (v: string) => CONTEXTS.find((c) => c.value === v) ?? CONTEXTS[0]!;

/** 맥락에서 본 노드 상태. 없으면 캔버스 기본 상태. */
export interface CtxNodeState {
  on: boolean;
  /** 이 맥락에서 바뀐 것(프로필·시험이 켜거나 끔): + 켬, − 끔, ~ 설정 덮어씀. */
  mark?: "+" | "−" | "~";
  /** drive 역할(GroupStatus.drive). */
  drive?: "holder" | "waiting" | "none";
  pending?: "enable" | "disable";
}

export interface ContextView {
  /** 맥락 이름 아래 한 줄. */
  line: string;
  live: boolean;
  nodes: Record<string, CtxNodeState>;
  lease: {
    holder: string | null;
    epoch?: number;
    turns?: [number, number];
    spawns?: [number, number];
    tokens?: [number, number];
    queue: { id: string; note: string }[];
  } | null;
  /** 이 맥락에서 덮어쓴 설정. */
  overrides: { key: string; value: string; from: string }[];
}

const ALL_ON: Record<string, CtxNodeState> = Object.fromEntries(
  NODES.map((n) => [
    n.id,
    { on: n.health !== "disabled" && n.health !== "auto_disabled" } satisfies CtxNodeState,
  ]),
);

export const VIEWS: Record<string, ContextView> = {
  all: {
    line: "설치된 확장 전부 · 대화마다 임대는 따로예요",
    live: false,
    nodes: ALL_ON,
    lease: null,
    overrides: [],
  },
  t1: {
    line: "턴 7 · 실시간",
    live: true,
    nodes: {
      ...ALL_ON,
      helm: { on: true, drive: "holder" },
      "plan-first": { on: true, drive: "waiting" },
      learning: { on: true, drive: "none" },
      review: { on: false },
      dialog: { on: false, pending: "enable" },
    },
    lease: {
      holder: "helm",
      epoch: 3,
      turns: [1, 4],
      spawns: [3, 8],
      tokens: [120000, 400000],
      queue: [{ id: "plan-first", note: "상한 반납 뒤 대기 · 0/8" }],
    },
    overrides: [{ key: "x.primitives.activeDriveGroup", value: "helm", from: "이 대화(session)" }],
  },
  t2: {
    line: "유휴 · 마지막 턴 3",
    live: false,
    nodes: {
      ...ALL_ON,
      helm: { on: false },
      "plan-first": { on: true, drive: "holder" },
      review: { on: false },
    },
    lease: {
      holder: "plan-first",
      epoch: 1,
      turns: [2, 4],
      spawns: [0, 8],
      tokens: [31000, 400000],
      queue: [],
    },
    overrides: [],
  },
  "p:explore": {
    line: "프로필 · 켜기 3 · drive helm · 설정 1",
    live: false,
    nodes: {
      ...ALL_ON,
      helm: { on: true, mark: "~", drive: "holder" },
      learning: { on: true, mark: "+" },
      "web-exa": { on: true, mark: "+" },
      review: { on: false },
    },
    lease: { holder: "helm", queue: [{ id: "plan-first", note: "후보 · 대기" }] },
    overrides: [{ key: "ext.helm.maxLenses", value: "4", from: "프로필 탐구 중심" }],
  },
  "p:quiet": {
    line: "프로필 · 켜기 1 · 끄기 2 · drive 없음",
    live: false,
    nodes: {
      ...ALL_ON,
      helm: { on: false, mark: "−" },
      "plan-first": { on: false, mark: "−" },
      learning: { on: true, mark: "+" },
      review: { on: false },
    },
    lease: { holder: null, queue: [] },
    overrides: [],
  },
  "p:review-trial": {
    line: "프로필 · 켜기 2 · drive review",
    live: false,
    nodes: {
      ...ALL_ON,
      helm: { on: true, drive: "waiting" },
      review: { on: true, mark: "+", drive: "holder" },
      "web-exa": { on: true, mark: "+" },
    },
    lease: {
      holder: "review",
      queue: [
        { id: "helm", note: "후보 · 대기" },
        { id: "plan-first", note: "후보 · 대기" },
      ],
    },
    overrides: [
      { key: "x.primitives.activeDriveGroup", value: "review", from: "프로필 review 시험" },
    ],
  },
  "x:lens5": {
    line: "시험 대화 · 실행 중 1:12 · 원래 대화와 떨어져 있어요",
    live: true,
    nodes: {
      ...ALL_ON,
      helm: { on: true, mark: "~", drive: "holder" },
      "plan-first": { on: false, mark: "−" },
      review: { on: false },
      "acme-notes": { on: false, mark: "−" },
    },
    lease: {
      holder: "helm",
      epoch: 1,
      turns: [2, 4],
      spawns: [5, 8],
      tokens: [210000, 400000],
      queue: [],
    },
    overrides: [
      { key: "ext.helm.maxLenses", value: "5", from: "시험" },
      { key: "ext.plan-first.enabled", value: "false", from: "시험" },
    ],
  },
};

// ── 엣지: 능력(provides → consumes), 연산(on → 지점, post → 큐, drive → 임대), 등록(provider → 도메인), 위임
export type EdgeKind = "cap" | "cap-missing" | "on" | "post" | "drive" | "register" | "fire";
export interface Edge {
  id: string;
  kind: EdgeKind;
  from: string;
  to: string;
  /** 시작·끝 좌표(세계). 노드에서 계산한다. */
  a: [number, number];
  b: [number, number];
  label?: string;
  optional?: boolean;
  /** on 엣지의 지점. */
  point?: string;
}

function capPortX(n: CNode, i: number) {
  return n.x + 14 + i * 12;
}
function opPortX(n: CNode, op: "on" | "post" | "drive") {
  return n.x + n.w - (op === "on" ? 52 : op === "post" ? 34 : 16);
}

const provider = (cap: string) => NODES.find((n) => n.provides?.includes(cap));

function buildEdges(): Edge[] {
  const out: Edge[] = [];
  for (const n of NODES) {
    const bottom = n.y + n.h;
    (n.consumes ?? []).forEach((c, i) => {
      const p = provider(c.id);
      const x = capPortX(n, i);
      if (p === undefined) {
        out.push({
          id: `${n.id}:${c.id}`,
          kind: "cap-missing",
          from: n.id,
          to: c.id,
          a: [x, bottom],
          b: [x, bottom + 26],
          label: c.id,
          optional: c.need === "optional",
        });
        return;
      }
      const j = p.provides?.indexOf(c.id) ?? 0;
      out.push({
        id: `${n.id}:${c.id}`,
        kind: "cap",
        from: p.id,
        to: n.id,
        a: [p.x + 20 + j * 40, p.y],
        b: [x, bottom],
        label: c.id,
        optional: c.need === "optional",
      });
    });
    for (const pt of n.points ?? []) {
      const port = POINT_PORTS.find((q) => q.name === pt);
      if (port === undefined) continue;
      out.push({
        id: `${n.id}>${pt}`,
        kind: "on",
        from: n.id,
        to: "rail",
        a: [opPortX(n, "on"), bottom],
        b: [port.x, POINT_RAIL.y],
        point: pt,
      });
    }
    const post = nodeById("x-post")!;
    const lease = nodeById("x-lease")!;
    if (n.usesPost === true)
      out.push({
        id: `${n.id}>post`,
        kind: "post",
        from: n.id,
        to: "x-post",
        a: [opPortX(n, "post"), bottom],
        b: [post.x + 30 + out.filter((e) => e.kind === "post").length * 34, post.y],
      });
    if (n.usesDrive === true)
      out.push({
        id: `${n.id}>drive`,
        kind: "drive",
        from: n.id,
        to: "x-lease",
        a: [opPortX(n, "drive"), bottom],
        b: [lease.x + 40 + out.filter((e) => e.kind === "drive").length * 44, lease.y],
      });
  }
  const exa = nodeById("web-exa")!;
  const web = nodeById("web")!;
  out.push({
    id: "web-exa>web",
    kind: "register",
    from: "web-exa",
    to: "web",
    a: [exa.x, exa.y + exa.h / 2],
    b: [web.x + web.w, web.y + web.h / 2],
    label: "provider 등록",
  });
  const loop = nodeById("loop")!;
  out.push({
    id: "loop>rail",
    kind: "fire",
    from: "loop",
    to: "rail",
    a: [loop.x + 40, loop.y + loop.h],
    b: [loop.x + 40, POINT_RAIL.y],
    label: "발화",
  });
  return out;
}
export const EDGES: Edge[] = buildEdges();

/** 노드 하나에 닿는 엣지. */
export const edgesOf = (id: string) => EDGES.filter((e) => e.from === id || e.to === id);

// ── 재생(턴 7, 대화 "캐시 무효화 조사"). 이벤트는 지점 하나가 발화한 때, handlers는 그때 돈 확장 핸들러.
export interface Handler {
  ext: string;
  ms: number;
  budgetMs: number;
  result: "ok" | "patch" | "allow" | "threw-deny" | "record";
  note?: string;
}
export interface ReplayEvent {
  seq: number;
  at: string;
  point: string;
  step: number;
  handlers: Handler[];
  /** 단계 경계(켜기·끄기, 임대 교대가 적용되는 곳). */
  boundary?: { text: string; switchTo?: string };
}
export const REPLAY: ReplayEvent[] = [
  { seq: 201, at: "14:02:38", point: "input.user.before", step: 0, handlers: [] },
  {
    seq: 202,
    at: "14:02:38",
    point: "input.agent.before",
    step: 0,
    handlers: [
      { ext: "helm", ms: 12, budgetMs: 10000, result: "patch", note: "관점 주입" },
      { ext: "plan-first", ms: 9, budgetMs: 10000, result: "patch", note: "계획 지시" },
    ],
  },
  { seq: 203, at: "14:02:39", point: "boundary.step.before", step: 1, handlers: [] },
  { seq: 204, at: "14:02:39", point: "request.provider.before", step: 1, handlers: [] },
  { seq: 205, at: "14:02:40", point: "guard.model.before", step: 1, handlers: [] },
  {
    seq: 207,
    at: "14:02:40",
    point: "tool.call.before",
    step: 1,
    handlers: [{ ext: "helm", ms: 3, budgetMs: 30000, result: "allow", note: "read src/cache.ts" }],
  },
  {
    seq: 208,
    at: "14:02:40",
    point: "tool.execution.after",
    step: 1,
    handlers: [
      { ext: "helm", ms: 1, budgetMs: 5000, result: "ok", note: "신호 stuck · 같은 오류 3번" },
    ],
  },
  {
    seq: 209,
    at: "14:02:41",
    point: "boundary.step.after",
    step: 1,
    handlers: [
      { ext: "learning", ms: 22, budgetMs: 5000, result: "record", note: "skill.proposed 초안" },
      { ext: "plan-first", ms: 4, budgetMs: 5000, result: "patch" },
    ],
    boundary: { text: "단계 경계 · helm 임대 받음 (차수 3)", switchTo: "helm" },
  },
  { seq: 211, at: "14:02:41", point: "boundary.step.before", step: 2, handlers: [] },
  {
    seq: 214,
    at: "14:03:02",
    point: "tool.call.before",
    step: 2,
    handlers: [
      { ext: "helm", ms: 3, budgetMs: 30000, result: "allow", note: "bash bun test cache" },
      {
        ext: "acme-notes",
        ms: 8100,
        budgetMs: 30000,
        result: "threw-deny",
        note: "예외 → 거부(closed)",
      },
    ],
  },
  {
    seq: 219,
    at: "14:03:12",
    point: "tool.call.before",
    step: 3,
    handlers: [
      { ext: "helm", ms: 2, budgetMs: 30000, result: "allow" },
      { ext: "acme-notes", ms: 7900, budgetMs: 30000, result: "threw-deny", note: "예외 2번째" },
    ],
  },
  {
    seq: 224,
    at: "14:03:20",
    point: "boundary.step.after",
    step: 3,
    handlers: [{ ext: "learning", ms: 18, budgetMs: 5000, result: "record" }],
  },
  {
    seq: 230,
    at: "14:03:40",
    point: "boundary.settle.after",
    step: 3,
    handlers: [
      { ext: "helm", ms: 1200, budgetMs: 5000, result: "ok", note: "신호 판정" },
      { ext: "learning", ms: 30, budgetMs: 5000, result: "ok" },
    ],
  },
];

// ── 검사기(확장 상세의 well 판). helm·review·acme-notes만 다 채우고, 나머지는 공통 칸만.
export interface PointStat {
  point: string;
  fold: Fold;
  budgetMs: number;
  p95: number | null;
  failures: number;
}
export const POINT_STATS: Record<string, PointStat[]> = {
  helm: [
    { point: "input.agent.before", fold: "collect", budgetMs: 10000, p95: 40, failures: 0 },
    { point: "tool.call.before", fold: "first", budgetMs: 30000, p95: 9, failures: 0 },
    { point: "tool.execution.after", fold: "tap", budgetMs: 5000, p95: 4, failures: 0 },
    { point: "boundary.settle.after", fold: "tap", budgetMs: 5000, p95: 1200, failures: 1 },
    { point: "session.start", fold: "tap", budgetMs: 5000, p95: 8, failures: 0 },
    { point: "lifecycle.lease.rejected", fold: "tap", budgetMs: 5000, p95: null, failures: 0 },
  ],
  review: [
    { point: "tool.call.before", fold: "first", budgetMs: 30000, p95: 210, failures: 0 },
    { point: "boundary.settle.after", fold: "tap", budgetMs: 5000, p95: 5000, failures: 5 },
  ],
  "acme-notes": [
    { point: "tool.call.before", fold: "first", budgetMs: 30000, p95: 8100, failures: 2 },
  ],
  learning: [
    { point: "boundary.step.after", fold: "chain", budgetMs: 5000, p95: 31, failures: 0 },
    { point: "boundary.settle.after", fold: "tap", budgetMs: 5000, p95: 44, failures: 0 },
  ],
  "plan-first": [
    { point: "input.agent.before", fold: "collect", budgetMs: 10000, p95: 14, failures: 0 },
    { point: "boundary.step.after", fold: "chain", budgetMs: 5000, p95: 9, failures: 0 },
  ],
};

export const FAILURES: Record<string, { at: string; point: string; text: string }[]> = {
  review: [
    { at: "13:40:22", point: "boundary.settle.after", text: "timeout 5s · 연속 5번째 → 자동 꺼짐" },
    { at: "13:31:05", point: "boundary.settle.after", text: "timeout 5s" },
    { at: "13:22:47", point: "boundary.settle.after", text: "timeout 5s" },
  ],
  "acme-notes": [
    { at: "14:03:12", point: "tool.call.before", text: "threw TypeError · 거부로 처리" },
    { at: "14:03:02", point: "tool.call.before", text: "threw TypeError · 거부로 처리" },
  ],
  helm: [{ at: "어제 16:20", point: "boundary.settle.after", text: "timeout 5s · 최근 50번 중 1" }],
};

/** group-kit 슬롯(L3.slots §3.3 템플릿, wb2 구성 탭과 같은 이름). */
export const SLOTS: Record<string, { slot: string; piece: string }[]> = {
  helm: [
    { slot: "트리거", piece: "신호로 시작 · stuck" },
    { slot: "펼치기", piece: "자식 렌즈 병렬 · spawn" },
    { slot: "모으기", piece: "신뢰도 투표" },
    { slot: "적용", piece: "작업으로 남기기" },
  ],
  "plan-first": [
    { slot: "트리거", piece: "명령으로 시작 · /plan" },
    { slot: "펼치기", piece: "자식 하나 · delegate" },
    { slot: "적용", piece: "대화에 post" },
  ],
  review: [
    { slot: "트리거", piece: "신호로 시작 · 변경 감지" },
    { slot: "적용", piece: "대화에 post" },
  ],
  learning: [{ slot: "적용", piece: "레코드 공개 · skill.proposed" }],
};

export interface Binding {
  title: string;
  key: string;
  value: string;
  context: string[];
}
export const BINDINGS: Record<string, Binding[]> = {
  helm: [
    { title: "켜짐", key: "ext.helm.enabled", value: "true", context: ["session", "· 이 대화"] },
    {
      title: "렌즈 수",
      key: "ext.helm.maxLenses",
      value: "4",
      context: ["user", "· 프로필 탐구 중심"],
    },
    {
      title: "drive 상한",
      key: "ext.helm.driveLimits",
      value: "4 / 8 / 400k",
      context: ["기본값"],
    },
    {
      title: "drive 그룹",
      key: "x.primitives.activeDriveGroup",
      value: "helm",
      context: ["session", "· 이 대화"],
    },
  ],
  review: [
    {
      title: "켜짐",
      key: "ext.review.enabled",
      value: "true",
      context: ["user", "· 자동 꺼짐이 덮음"],
    },
    { title: "settle 예산", key: "x.operations.budget.tap", value: "5s", context: ["기본값"] },
  ],
  "acme-notes": [
    {
      title: "켜짐",
      key: "ext.acme-notes.enabled",
      value: "true",
      context: ["project", "· 신뢰함"],
    },
    { title: "노트 폴더", key: "ext.acme-notes.dir", value: "docs/notes", context: ["project"] },
  ],
};

// ── 밀집 상태(설치 확장 50여 개). 이름은 그럴듯한 사용자·프로젝트 확장. [덧붙임]
const denseNames = {
  L3: [
    "helm",
    "plan-first",
    "learning",
    "review",
    "triage",
    "refactor-coach",
    "spec-check",
    "pair",
    "doc-sync",
    "bisect",
    "release-notes",
    "focus",
    "tutor",
    "audit",
    "perf-watch",
    "migrate",
    "test-first",
    "i18n-check",
    "deps-bot",
    "sec-review",
    "onboard",
    "retro",
    "api-guard",
    "dark-launch",
  ],
  L2: [
    "web",
    "web-exa",
    "knowledge",
    "work",
    "dialog",
    "mcp",
    "schedule",
    "artifacts",
    "workspace",
    "web-brave",
    "kb-notion",
    "work-linear",
    "acme-notes",
    "provider-oauth",
    "jira-sync",
    "slack-out",
    "figma-read",
    "gh-issues",
    "pdf-read",
    "calc",
    "sentry-read",
    "pg-query",
    "s3-files",
    "gcal",
    "gmail-out",
    "drive-read",
    "confluence",
    "zendesk",
    "stripe-read",
    "vercel",
    "k8s-read",
    "datadog",
    "npm-audit",
    "openapi",
    "sheet-read",
    "maps",
  ],
  L1: ["loop", "tools", "models", "agents", "context", "persistence"],
  L0: ["sqlite", "exec", "sandbox", "secrets", "fs-watch"],
};
export interface DenseNode {
  id: string;
  band: BandId;
  x: number;
  y: number;
  health: Health;
}
export const DENSE_WORLD = { w: 1960, h: 640 };
export const DENSE: DenseNode[] = (Object.keys(denseNames) as (keyof typeof denseNames)[]).flatMap(
  (band) =>
    denseNames[band].map((id, i) => {
      const b = BANDS.find((x) => x.id === band)!;
      const perRow = band === "L2" ? 18 : 24;
      const step = band === "L3" ? 76 : 100;
      const row = Math.floor(i / perRow);
      return {
        id,
        band,
        x: 96 + (i % perRow) * step,
        y: b.y + 14 + row * 40,
        health:
          id === "review" || id === "deps-bot"
            ? "auto_disabled"
            : id === "acme-notes" || id === "jira-sync" || id === "datadog"
              ? "failing"
              : id === "provider-oauth" || id === "figma-read" || id === "retro"
                ? "disabled"
                : "ok",
      } satisfies DenseNode;
    }),
);
