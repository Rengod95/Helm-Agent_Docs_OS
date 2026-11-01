// 방향 B "정교한 노드 편집기" 고정 데이터. 좌표는 세계 px(줌 1). 흐름은 왼쪽 → 오른쪽:
// 능력 공급(L1·L2) → 의도 그룹(L3)·외부 plugin → X 확장 지점(에이전트 루프의 소켓)·post 큐·drive 임대.
// 모델 근거: F.extensions §2·§3.4(지점·fold), X.primitives §4.4(임대), L3.group-kit·slots(부품), L3.helm §3(단계 머신).

export type PortType = "cap" | "on" | "post" | "drive";
export type Health = "ok" | "warn" | "danger" | "off";

export const PORT_NAME: Record<PortType, string> = {
  cap: "능력",
  on: "on",
  post: "post",
  drive: "drive",
};

// ── 세계 격자
export const COL = {
  A: { x: 0, w: 180, title: "능력 공급", tag: "L1·L2" },
  B: { x: 256, w: 210, title: "의도 그룹", tag: "L3" },
  C: { x: 550, w: 184, title: "확장 지점", tag: "X" },
} as const;
export const WORLD = { w: 734, h: 600 };
export const LANE_TOP = 40;

export interface Cap {
  id: string;
  need: "requires" | "optional";
}

export interface Ext {
  id: string;
  label: string;
  col: "A" | "B";
  y: number;
  h: number;
  layer: "L1·L0" | "L2" | "L3" | "plugin";
  kind: "core" | "plugin" | "group";
  trust: "builtin" | "user" | "project";
  version: string;
  health: Health;
  failures?: number;
  provides?: string[];
  consumes?: Cap[];
  points?: string[];
  usesPost?: boolean;
  usesDrive?: boolean;
  /** 매니페스트 composition으로 선언한 부품 수. 없으면 "구성 정보 없음"(결정 7). */
  parts?: number | null;
  /** 다른 블록 아래에 붙은 제공자(web-exa → web). */
  dockTo?: string;
  icon:
    | "core"
    | "globe"
    | "search"
    | "book"
    | "check"
    | "chat"
    | "helm"
    | "plan"
    | "learn"
    | "review"
    | "note"
    | "key";
  /** 7일 토큰(천 단위) 스파크라인. */
  spark?: number[];
}

export const EXTS: Ext[] = [
  {
    id: "core",
    label: "코어",
    col: "A",
    y: 40,
    h: 60,
    layer: "L1·L0",
    kind: "core",
    trust: "builtin",
    version: "0.4.0",
    health: "ok",
    provides: ["fresnel.agents", "fresnel.tools"],
    parts: 9,
    icon: "core",
  },
  {
    id: "web",
    label: "웹",
    col: "A",
    y: 112,
    h: 60,
    layer: "L2",
    kind: "plugin",
    trust: "builtin",
    version: "0.4.0",
    health: "ok",
    provides: ["web.search", "web.fetch"],
    icon: "globe",
  },
  {
    id: "web-exa",
    label: "Exa 검색",
    col: "A",
    y: 172,
    h: 34,
    layer: "L2",
    kind: "plugin",
    trust: "user",
    version: "1.0.3",
    health: "ok",
    dockTo: "web",
    icon: "search",
  },
  {
    id: "knowledge",
    label: "지식",
    col: "A",
    y: 220,
    h: 60,
    layer: "L2",
    kind: "plugin",
    trust: "builtin",
    version: "0.4.0",
    health: "ok",
    provides: ["knowledge.skills", "knowledge.memory"],
    icon: "book",
  },
  {
    id: "work",
    label: "작업",
    col: "A",
    y: 292,
    h: 60,
    layer: "L2",
    kind: "plugin",
    trust: "builtin",
    version: "0.4.0",
    health: "ok",
    provides: ["work.tasks"],
    icon: "check",
  },
  {
    id: "dialog",
    label: "대화 도구",
    col: "A",
    y: 364,
    h: 60,
    layer: "L2",
    kind: "plugin",
    trust: "builtin",
    version: "0.4.0",
    health: "ok",
    provides: ["dialog.ask", "dialog.aside"],
    icon: "chat",
  },
  {
    id: "helm",
    label: "Helm",
    col: "B",
    y: 40,
    h: 84,
    layer: "L3",
    kind: "group",
    trust: "user",
    version: "0.1.0",
    health: "ok",
    failures: 1,
    points: [
      "session.start",
      "input.agent.before",
      "tool.call.before",
      "tool.execution.after",
      "boundary.settle.after",
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
    parts: 7,
    icon: "helm",
    spark: [40, 90, 60, 180, 220, 160, 240],
  },
  {
    id: "plan-first",
    label: "계획 먼저",
    col: "B",
    y: 136,
    h: 84,
    layer: "L3",
    kind: "group",
    trust: "user",
    version: "0.3.0",
    health: "ok",
    points: ["input.agent.before", "boundary.step.after"],
    usesPost: true,
    usesDrive: true,
    consumes: [{ id: "work.tasks", need: "requires" }],
    parts: null,
    icon: "plan",
    spark: [20, 30, 30, 50, 40, 20, 30],
  },
  {
    id: "learning",
    label: "학습",
    col: "B",
    y: 232,
    h: 84,
    layer: "L3",
    kind: "group",
    trust: "builtin",
    version: "0.4.0",
    health: "ok",
    points: ["boundary.step.after", "boundary.settle.after"],
    usesPost: true,
    usesDrive: false,
    consumes: [
      { id: "knowledge.skills", need: "requires" },
      { id: "fresnel.agents", need: "requires" },
    ],
    parts: 5,
    icon: "learn",
    spark: [30, 40, 50, 40, 60, 40, 40],
  },
  {
    id: "review",
    label: "리뷰",
    col: "B",
    y: 328,
    h: 84,
    layer: "L3",
    kind: "group",
    trust: "user",
    version: "0.2.1",
    health: "danger",
    failures: 5,
    points: ["tool.call.before", "boundary.settle.after"],
    usesPost: true,
    usesDrive: true,
    consumes: [{ id: "work.tasks", need: "optional" }],
    parts: 6,
    icon: "review",
    spark: [10, 20, 15, 25, 10, 0, 0],
  },
  {
    id: "acme-notes",
    label: "acme 노트",
    col: "B",
    y: 452,
    h: 60,
    layer: "plugin",
    kind: "plugin",
    trust: "project",
    version: "0.0.9",
    health: "warn",
    failures: 2,
    points: ["tool.call.before"],
    icon: "note",
  },
  {
    id: "provider-oauth",
    label: "OAuth 모델",
    col: "B",
    y: 524,
    h: 60,
    layer: "plugin",
    kind: "plugin",
    trust: "user",
    version: "0.1.0",
    health: "off",
    consumes: [{ id: "models.oauth", need: "requires" }],
    icon: "key",
  },
];
export const extById = (id: string) => EXTS.find((e) => e.id === id)!;

// ── X 확장 지점(에이전트 루프 순서). 46개 중 핸들러가 걸린 일곱만 소켓으로, 나머지는 "비어 있음" 한 줄.
export type Fold = "collect" | "first" | "chain" | "tap";
export interface Socket {
  point: string;
  family: string;
  short: string;
  fold: Fold;
  y: number;
  budgetMs: number;
}
export const FAMILIES = [
  { id: "session", label: "session", y: 40 },
  { id: "input", label: "input", y: 92 },
  { id: "tool", label: "tool", y: 144 },
  { id: "boundary", label: "boundary", y: 228 },
  { id: "lifecycle", label: "lifecycle", y: 312 },
];
export const SOCKETS: Socket[] = [
  { point: "session.start", family: "session", short: "start", fold: "tap", y: 58, budgetMs: 5000 },
  {
    point: "input.agent.before",
    family: "input",
    short: "agent.before",
    fold: "collect",
    y: 110,
    budgetMs: 10000,
  },
  {
    point: "tool.call.before",
    family: "tool",
    short: "call.before",
    fold: "first",
    y: 162,
    budgetMs: 30000,
  },
  {
    point: "tool.execution.after",
    family: "tool",
    short: "execution.after",
    fold: "tap",
    y: 194,
    budgetMs: 5000,
  },
  {
    point: "boundary.step.after",
    family: "boundary",
    short: "step.after",
    fold: "chain",
    y: 246,
    budgetMs: 5000,
  },
  {
    point: "boundary.settle.after",
    family: "boundary",
    short: "settle.after",
    fold: "tap",
    y: 278,
    budgetMs: 5000,
  },
  {
    point: "lifecycle.lease.rejected",
    family: "lifecycle",
    short: "lease.rejected",
    fold: "tap",
    y: 330,
    budgetMs: 5000,
  },
];
export const SOCKET_H = 28;
export const POST_Q = { y: 412, h: 58 };
export const LEASE = { y: 480, h: 116 };

// ── 블록의 포트 자리(세계 좌표). 포트 알약은 가장자리에 걸쳐 놓이고 선은 알약 바깥 끝에 닿는다.
export const PILL_W = 54;
export function blockBox(e: Ext) {
  const c = COL[e.col];
  return { x: c.x, y: e.y, w: c.w, h: e.h };
}
export function portDy(e: Ext, t: PortType): number {
  if (e.kind === "group" || e.kind === "plugin") {
    if (t === "cap") return e.col === "A" ? 40 : 46;
    const outs: PortType[] = (["on", "post", "drive"] as PortType[]).filter((p) =>
      p === "on" ? (e.points?.length ?? 0) > 0 : p === "post" ? e.usesPost : e.usesDrive,
    );
    const i = outs.indexOf(t);
    const n = outs.length;
    if (e.h <= 60) return 40 + (i - (n - 1) / 2) * 18;
    return 36 + i * 18;
  }
  return 40;
}
/** 블록 오른쪽 출력 알약의 바깥 끝. */
export function outAnchor(e: Ext, t: PortType) {
  const b = blockBox(e);
  return { x: b.x + b.w + PILL_W / 2, y: b.y + portDy(e, t) };
}
/** 블록 왼쪽 입력 알약의 바깥 끝. */
export function inAnchor(e: Ext) {
  const b = blockBox(e);
  return { x: b.x - PILL_W / 2, y: b.y + portDy(e, "cap") };
}
export function socketAnchor(point: string) {
  const s = SOCKETS.find((x) => x.point === point)!;
  return { x: COL.C.x, y: s.y + SOCKET_H / 2 };
}
export const postAnchor = { x: COL.C.x, y: POST_Q.y + 29 };
export const leaseAnchor = { x: COL.C.x, y: LEASE.y + 30 };

export function providerOf(cap: string): Ext | undefined {
  return EXTS.find((e) => e.provides?.includes(cap));
}

// ── 맥락(왼쪽 패널 맥락 칸, 결정 3)
export const CONTEXTS = [
  { value: "all", kind: "all", label: "전체" },
  { value: "t1", kind: "thread", label: "캐시 무효화 조사" },
  { value: "t2", kind: "thread", label: "빌드 실패 원인" },
  { value: "p-explore", kind: "profile", label: "탐구 중심" },
  { value: "p-quiet", kind: "profile", label: "조용히" },
  { value: "x-helm5", kind: "trial", label: "helm 시험 1" },
] as const;

/** 대화 "캐시 무효화 조사"(턴 7)에서 켜진 확장. 나머지는 프레임 밖. */
export const THREAD_MEMBERS = new Set([
  "core",
  "web",
  "knowledge",
  "work",
  "helm",
  "plan-first",
  "learning",
  "acme-notes",
]);
export const THREAD_PENDING = new Set(["dialog"]); // 다음 단계 경계에 켜짐

export const lease = {
  holder: "helm",
  epoch: 3,
  turns: [1, 4] as const,
  spawns: [3, 8] as const,
  tokens: [120, 400] as const,
  queue: [{ id: "plan-first", state: "대기" }],
};

// ── 프로필 차이(지금 대화 ↔ 프로필 "탐구 중심")
export type DiffMark = "same" | "add" | "remove" | "override";
export const PROFILE_DIFF: {
  id: string;
  lane: string;
  now: "on" | "off" | "auto_off" | "pending";
  next: "on" | "off" | "auto_off";
  mark: DiffMark;
  note?: string;
}[] = [
  {
    id: "helm",
    lane: "L3",
    now: "on",
    next: "on",
    mark: "override",
    note: "ext.helm.maxLenses 3 → 4",
  },
  { id: "plan-first", lane: "L3", now: "on", next: "on", mark: "same" },
  { id: "learning", lane: "L3", now: "on", next: "on", mark: "same" },
  {
    id: "review",
    lane: "L3",
    now: "auto_off",
    next: "off",
    mark: "remove",
    note: "disable에 있음",
  },
  { id: "acme-notes", lane: "plugin", now: "on", next: "on", mark: "same" },
  { id: "provider-oauth", lane: "plugin", now: "off", next: "off", mark: "same" },
  { id: "web-exa", lane: "L2", now: "off", next: "on", mark: "add", note: "enable에 있음" },
  { id: "dialog", lane: "L2", now: "pending", next: "on", mark: "same" },
  { id: "knowledge", lane: "L2", now: "on", next: "on", mark: "same" },
];

// ── 층 × 지점 열지도(p95 ms, 실패, 호출 수/일)
export const HEAT_ROWS: { lane: string; id: string }[] = [
  { lane: "L3", id: "helm" },
  { lane: "L3", id: "plan-first" },
  { lane: "L3", id: "learning" },
  { lane: "L3", id: "review" },
  { lane: "plugin", id: "acme-notes" },
];
export const HEAT: Record<
  string,
  Record<string, { p95: number | null; fail: number; calls: number }>
> = {
  helm: {
    "session.start": { p95: 8, fail: 0, calls: 3 },
    "input.agent.before": { p95: 40, fail: 0, calls: 41 },
    "tool.call.before": { p95: 9, fail: 0, calls: 212 },
    "tool.execution.after": { p95: 4, fail: 0, calls: 209 },
    "boundary.settle.after": { p95: 1200, fail: 1, calls: 38 },
    "lifecycle.lease.rejected": { p95: null, fail: 0, calls: 0 },
  },
  "plan-first": {
    "input.agent.before": { p95: 22, fail: 0, calls: 41 },
    "boundary.step.after": { p95: 140, fail: 0, calls: 96 },
  },
  learning: {
    "boundary.step.after": { p95: 60, fail: 0, calls: 96 },
    "boundary.settle.after": { p95: 310, fail: 0, calls: 38 },
  },
  review: {
    "tool.call.before": { p95: 15, fail: 0, calls: 80 },
    "boundary.settle.after": { p95: 5000, fail: 5, calls: 14 },
  },
  "acme-notes": { "tool.call.before": { p95: 8100, fail: 2, calls: 64 } },
};

export const METRICS = [
  {
    id: "helm",
    tokens: 1200,
    cost: 3.1,
    leaseMin: 41,
    failures: 1,
    denies: 12,
    spark: [40, 90, 60, 180, 220, 160, 240],
    p95: [30, 32, 40, 38, 60, 1200, 40],
  },
  {
    id: "plan-first",
    tokens: 210,
    cost: 0.5,
    leaseMin: 18,
    failures: 0,
    denies: 0,
    spark: [20, 30, 30, 50, 40, 20, 30],
    p95: [120, 130, 140, 135, 150, 140, 140],
  },
  {
    id: "learning",
    tokens: 300,
    cost: 0.4,
    leaseMin: 0,
    failures: 0,
    denies: 0,
    spark: [30, 40, 50, 40, 60, 40, 40],
    p95: [280, 300, 310, 290, 320, 300, 310],
  },
  {
    id: "review",
    tokens: 80,
    cost: 0.2,
    leaseMin: 6,
    failures: 7,
    denies: 3,
    spark: [10, 20, 15, 25, 10, 0, 0],
    p95: [900, 1400, 2600, 5000, 5000, 0, 0],
  },
  {
    id: "acme-notes",
    tokens: 0,
    cost: 0,
    leaseMin: 0,
    failures: 2,
    denies: 2,
    spark: [0, 0, 0, 0, 0, 0, 0],
    p95: [40, 60, 300, 900, 8100, 8100, 8100],
  },
];

// ── Helm 부품(composition, 결정 7). 그룹을 열면 하위 캔버스에 이것만 그린다.
export type Role = "signal" | "lens" | "drive" | "guard" | "knowledge" | "record" | "restore";
export interface Part {
  id: string;
  role: Role;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  op: PortType | "record";
  points?: { point: string; fold: Fold }[];
  line: string;
  ins?: { id: string; type: PortType; label: string; state?: "off" }[];
  outs?: { id: string; type: PortType | "record"; label: string }[];
}
export const ROLE_LABEL: Record<Role, string> = {
  signal: "signal",
  lens: "lens",
  drive: "drive",
  guard: "guard",
  knowledge: "knowledge",
  record: "record",
  restore: "restore",
};
