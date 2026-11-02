// 런타임 지도 시안 A 고정 데이터. wb-canvas/data.ts(매니페스트 F.extensions §3.1, 훅 표 §3.4, 주도 X.primitives §4.4,
// 그룹 상태 L3.group-sdk §3.8)와 wb-compose/fixtures.ts(L3.helm §3.x, §4.2 전이표)에서 옮겨 세계 좌표로 다시 놓았다.
// 세계 좌표: 줌 1 = px. 지도 세 단계(개요·층·상세)와 구성기 화면이 각자 세계 크기를 가진다.

export type Layer = "L3" | "plugin" | "L2" | "X" | "L1" | "L0" | "F";
export type Hue = "l3" | "pl" | "l2" | "x" | "base";
export const HUE_OF: Record<Layer, Hue> = {
  L3: "l3",
  plugin: "pl",
  L2: "l2",
  X: "x",
  L1: "base",
  L0: "base",
  F: "base",
};
export type Health = "ok" | "failing" | "auto_disabled" | "disabled";
export type Fold = "tap" | "first" | "chain" | "collect";

export interface Ext {
  id: string;
  label: string;
  layer: Layer;
  trust: "builtin" | "user" | "project";
  version: string;
  health: Health;
  failures?: number;
  points?: string[];
  usesPost?: boolean;
  usesDrive?: boolean;
  provides?: string[];
  consumes?: { cap: string; need: "requires" | "optional" }[];
  /** 매니페스트 composition 선언(부품 수). 없으면 "구성 정보 없음" 한 블록(사용자 결정 7). */
  parts?: number;
  /** 층 보기 좌표 */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 층 보기 세계 */
export const LW = { w: 900, h: 604 };
export const FLOORS = {
  L3: { y: 0, h: 132 },
  X: { y: 154, h: 168 },
  L2: { y: 344, h: 120 },
  base: { y: 486, h: 70 },
  F: { y: 574, h: 30 },
};
export const PLUGIN_PLATE = { x: 636, y: 26, w: 256, h: 98 };

export const EXTS: Ext[] = [
  {
    id: "helm",
    label: "Helm",
    layer: "L3",
    trust: "user",
    version: "0.1.0",
    health: "ok",
    failures: 1,
    parts: 7,
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
      { cap: "loop.spawn", need: "requires" },
      { cap: "web.search", need: "optional" },
      { cap: "knowledge.search", need: "optional" },
      { cap: "knowledge.skills", need: "optional" },
      { cap: "knowledge.memory", need: "optional" },
      { cap: "work.tasks", need: "optional" },
    ],
    x: 16,
    y: 36,
    w: 144,
    h: 80,
  },
  {
    id: "plan-first",
    label: "계획 먼저",
    layer: "L3",
    trust: "user",
    version: "0.3.0",
    health: "ok",
    points: ["input.agent.before", "boundary.step.after"],
    usesPost: true,
    usesDrive: true,
    consumes: [{ cap: "work.tasks", need: "requires" }],
    x: 170,
    y: 36,
    w: 144,
    h: 80,
  },
  {
    id: "learning",
    label: "학습",
    layer: "L3",
    trust: "builtin",
    version: "0.4.0",
    health: "ok",
    parts: 3,
    points: ["boundary.step.after", "boundary.settle.after"],
    usesPost: true,
    consumes: [{ cap: "knowledge.skills", need: "requires" }],
    x: 324,
    y: 36,
    w: 144,
    h: 80,
  },
  {
    id: "review",
    label: "리뷰",
    layer: "L3",
    trust: "user",
    version: "0.2.1",
    health: "auto_disabled",
    failures: 5,
    parts: 3,
    points: ["tool.call.before", "boundary.settle.after"],
    usesPost: true,
    usesDrive: true,
    consumes: [{ cap: "work.tasks", need: "optional" }],
    x: 478,
    y: 36,
    w: 144,
    h: 80,
  },
  {
    id: "acme-notes",
    label: "acme 노트",
    layer: "plugin",
    trust: "project",
    version: "0.0.9",
    health: "failing",
    failures: 2,
    points: ["tool.call.before"],
    x: 648,
    y: 36,
    w: 116,
    h: 80,
  },
  {
    id: "provider-oauth",
    label: "OAuth 모델",
    layer: "plugin",
    trust: "user",
    version: "0.2.0",
    health: "disabled",
    consumes: [{ cap: "models.oauth", need: "requires" }],
    x: 770,
    y: 36,
    w: 112,
    h: 80,
  },
  // L2 서비스(기능)
  {
    id: "web",
    label: "웹",
    layer: "L2",
    trust: "builtin",
    version: "0.4.0",
    health: "ok",
    provides: ["web.search", "web.fetch"],
    x: 16,
    y: 380,
    w: 164,
    h: 68,
  },
  {
    id: "web-exa",
    label: "Exa 검색",
    layer: "L2",
    trust: "user",
    version: "1.0.3",
    health: "ok",
    provides: ["web.search"],
    x: 190,
    y: 380,
    w: 164,
    h: 68,
  },
  {
    id: "knowledge",
    label: "지식",
    layer: "L2",
    trust: "builtin",
    version: "0.4.0",
    health: "ok",
    provides: ["knowledge.search", "knowledge.skills", "knowledge.memory"],
    x: 364,
    y: 380,
    w: 164,
    h: 68,
  },
  {
    id: "work",
    label: "작업",
    layer: "L2",
    trust: "builtin",
    version: "0.4.0",
    health: "ok",
    provides: ["work.tasks"],
    x: 538,
    y: 380,
    w: 164,
    h: 68,
  },
  {
    id: "dialog",
    label: "대화 도구",
    layer: "L2",
    trust: "builtin",
    version: "0.4.0",
    health: "ok",
    provides: ["dialog.ask"],
    x: 712,
    y: 380,
    w: 164,
    h: 68,
  },
];
export const extById = (id: string) => EXTS.find((e) => e.id === id);

export const BASE_CHIPS: { id: string; label: string; layer: "L1" | "L0" }[] = [
  { id: "loop", label: "loop", layer: "L1" },
  { id: "tools", label: "tools", layer: "L1" },
  { id: "models", label: "models", layer: "L1" },
  { id: "agents", label: "agents", layer: "L1" },
  { id: "context", label: "context", layer: "L1" },
  { id: "sqlite", label: "sqlite", layer: "L0" },
  { id: "exec", label: "exec", layer: "L0" },
  { id: "sandbox", label: "sandbox", layer: "L0" },
  { id: "secrets", label: "secrets", layer: "L0" },
];

// ── 루프와 소켓(훅). 훅 46개 = 7종. 핸들러가 걸린 훅만 소켓을 그리고, 나머지는 종류 칸 안 수로 접는다.
export interface Kind {
  kind: string;
  count: number;
  x0: number;
  x1: number;
}
export const LOOP = { x: 16, y: 196, w: 868, h: 108, r: 54 };
export const KINDS: Kind[] = [
  { kind: "input", count: 3, x0: 64, x1: 124 },
  { kind: "request", count: 9, x0: 124, x1: 190 },
  { kind: "guard", count: 3, x0: 190, x1: 240 },
  { kind: "tool", count: 5, x0: 240, x1: 380 },
  { kind: "boundary", count: 9, x0: 380, x1: 520 },
  { kind: "session", count: 15, x0: 520, x1: 572 },
  { kind: "lifecycle", count: 2, x0: 572, x1: 630 },
];
export interface Socket {
  point: string;
  short: string;
  kind: string;
  fold: Fold;
  failure: "open" | "closed" | "skip";
  x: number;
}
export const SOCKETS: Socket[] = [
  {
    point: "input.agent.before",
    short: "agent.before",
    kind: "input",
    fold: "collect",
    failure: "open",
    x: 94,
  },
  {
    point: "tool.call.before",
    short: "call.before",
    kind: "tool",
    fold: "first",
    failure: "closed",
    x: 272,
  },
  {
    point: "tool.execution.after",
    short: "execution.after",
    kind: "tool",
    fold: "tap",
    failure: "open",
    x: 342,
  },
  {
    point: "boundary.step.after",
    short: "step.after",
    kind: "boundary",
    fold: "chain",
    failure: "skip",
    x: 414,
  },
  {
    point: "boundary.settle.after",
    short: "settle.after",
    kind: "boundary",
    fold: "tap",
    failure: "open",
    x: 484,
  },
  { point: "session.start", short: "start", kind: "session", fold: "tap", failure: "open", x: 546 },
  {
    point: "lifecycle.lease.rejected",
    short: "lease.rejected",
    kind: "lifecycle",
    fold: "tap",
    failure: "open",
    x: 601,
  },
];
export const socketOf = (p: string) => SOCKETS.find((s) => s.point === p);
/** 루프 위 역(station): post 큐와 주도 자리. */
export const STATIONS = {
  post: { x: 680, w: 56 },
  drive: { x: 778, w: 92 },
};

// ── 맥락(왼쪽 패널 맥락 칸 하나가 모든 크래프트 화면을 정한다, 사용자 결정 3)
export type CtxKind = "all" | "thread" | "profile" | "trial";
export const CONTEXTS: { value: string; kind: CtxKind; label: string }[] = [
  { value: "all", kind: "all", label: "전체" },
  { value: "t1", kind: "thread", label: "캐시 무효화 조사" },
  { value: "t2", kind: "thread", label: "테스트 정리" },
  { value: "p:explore", kind: "profile", label: "탐구 중심" },
  { value: "p:quiet", kind: "profile", label: "조용히" },
  { value: "x:lens5", kind: "trial", label: "helm 렌즈 5개" },
];
export const ctxOf = (v: string) => CONTEXTS.find((c) => c.value === v) ?? CONTEXTS[0]!;

/** 대화 "캐시 무효화 조사"에서 켜진 것(맥락 테두리 안). */
export const T1_ON = [
  "helm",
  "plan-first",
  "learning",
  "acme-notes",
  "web",
  "web-exa",
  "knowledge",
  "work",
];
export const T1_LEASE = {
  holder: "helm",
  epoch: 3,
  turns: [1, 4] as [number, number],
  spawns: [3, 8] as [number, number],
  tokens: [120, 400] as [number, number],
  waiting: "plan-first",
  pending: { id: "dialog", text: "다음 단계 경계에 켜져요" },
};
/** 프로필 "탐구 중심"을 이 대화에 적용하면 바뀌는 것. */
export const DIFF_EXPLORE: Record<string, { mark: "+" | "−" | "~"; note: string }> = {
  dialog: { mark: "+", note: "프로필이 켜요" },
  "plan-first": { mark: "−", note: "프로필이 꺼요" },
  helm: { mark: "~", note: "maxLenses 3 → 4" },
};

// ── 검사기·행렬
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
  "plan-first": [
    { point: "input.agent.before", fold: "collect", budgetMs: 10000, p95: 14, failures: 0 },
    { point: "boundary.step.after", fold: "chain", budgetMs: 5000, p95: 9, failures: 0 },
  ],
  learning: [
    { point: "boundary.step.after", fold: "chain", budgetMs: 5000, p95: 31, failures: 0 },
    { point: "boundary.settle.after", fold: "tap", budgetMs: 5000, p95: 44, failures: 0 },
  ],
  review: [
    { point: "tool.call.before", fold: "first", budgetMs: 30000, p95: 210, failures: 0 },
    { point: "boundary.settle.after", fold: "tap", budgetMs: 5000, p95: 5000, failures: 5 },
  ],
  "acme-notes": [
    { point: "tool.call.before", fold: "first", budgetMs: 30000, p95: 8100, failures: 2 },
  ],
  "pre-commit-lint": [
    { point: "tool.call.before", fold: "first", budgetMs: 30000, p95: 640, failures: 0 },
  ],
};
export const FAILURES: Record<string, { at: string; point: string; text: string }[]> = {
  review: [
    { at: "13:40:22", point: "boundary.settle.after", text: "timeout 5s · 연속 5번째 → 자동 꺼짐" },
    { at: "13:31:05", point: "boundary.settle.after", text: "timeout 5s" },
  ],
  "acme-notes": [
    { at: "14:03:12", point: "tool.call.before", text: "threw TypeError · 거부로 처리" },
    { at: "14:03:02", point: "tool.call.before", text: "threw TypeError · 거부로 처리" },
  ],
  helm: [{ at: "어제 16:20", point: "boundary.settle.after", text: "timeout 5s · 최근 50번 중 1" }],
};
export const BINDINGS: Record<
  string,
  { title: string; key: string; value: string; from: string }[]
> = {
  helm: [
    { title: "자동 시작", key: "ext.helm.autoStart", value: "suggest", from: "기본값" },
    { title: "렌즈 수", key: "ext.helm.maxLenses", value: "3", from: "기본값" },
    { title: "쓰기 막기", key: "ext.helm.writeGuard", value: "켬", from: "기본값" },
    { title: "drive 그룹", key: "x.primitives.activeDriveGroup", value: "helm", from: "이 대화" },
  ],
};

/** 행렬 열: 훅(종류별). quiet = 이 맥락에서 아무도 걸지 않은 훅(접힌 열). */
export const MATRIX_COLS: {
  kind: string;
  points: { point: string; short: string; fold: Fold; failure: string }[];
  quiet: number;
}[] = [
  {
    kind: "input",
    points: [
      { point: "input.agent.before", short: "agent.before", fold: "collect", failure: "open" },
    ],
    quiet: 2,
  },
  { kind: "request", points: [], quiet: 9 },
  { kind: "guard", points: [], quiet: 3 },
  {
    kind: "tool",
    points: [
      { point: "tool.call.before", short: "call.before", fold: "first", failure: "closed" },
      { point: "tool.execution.after", short: "execution.after", fold: "tap", failure: "open" },
    ],
    quiet: 3,
  },
  {
    kind: "boundary",
    points: [
      { point: "boundary.step.after", short: "step.after", fold: "chain", failure: "skip" },
      { point: "boundary.settle.after", short: "settle.after", fold: "tap", failure: "open" },
    ],
    quiet: 7,
  },
  {
    kind: "session",
    points: [{ point: "session.start", short: "start", fold: "tap", failure: "open" }],
    quiet: 14,
  },
  {
    kind: "lifecycle",
    points: [
      { point: "lifecycle.lease.rejected", short: "lease.rejected", fold: "tap", failure: "open" },
    ],
    quiet: 1,
  },
];
export const MATRIX_ROWS: { id: string; label: string; layer: Layer; note?: string }[] = [
  { id: "helm", label: "Helm", layer: "L3" },
  { id: "plan-first", label: "계획 먼저", layer: "L3" },
  { id: "learning", label: "학습", layer: "L3" },
  { id: "review", label: "리뷰", layer: "L3", note: "자동 꺼짐" },
  { id: "acme-notes", label: "acme 노트", layer: "plugin" },
  { id: "pre-commit-lint", label: "pre-commit-lint", layer: "X", note: "외부 훅" },
];

// ── 그룹 구성(부품 목록). 매니페스트 composition 선언에서 읽는다. plan-first는 선언이 없다(결정 7).
export type Op = "on" | "drive" | "post" | "record";
export interface Part {
  id: string;
  title: string;
  op: Op;
  slot: string;
  line: string;
  points?: string[];
  caps?: { cap: string; need: "requires" | "optional"; provider: string }[];
  out?: string[];
}
export const HELM_PARTS: Part[] = [
  {
    id: "signal",
    title: "신호 감지",
    op: "on",
    slot: "트리거",
    line: "같은 오류 3번 · 같은 호출 3번 · 빈 검색 2번",
    points: ["tool.execution.after", "boundary.settle.after"],
    out: ["grp.helm.signal.detected", "제안 post"],
  },
  {
    id: "lens",
    title: "렌즈 주입",
    op: "on",
    slot: "펼치기",
    line: "6개 중 신호 순서로 3개",
    points: ["input.agent.before"],
  },
  {
    id: "guard",
    title: "쓰기 거부",
    op: "on",
    slot: "가드",
    line: "diverge·explore에서 write·exec 막기",
    points: ["tool.call.before"],
  },
  {
    id: "restore",
    title: "상태 복원",
    op: "on",
    slot: "복원",
    line: "대화 시작에 HelmState 읽기",
    points: ["session.start"],
  },
  {
    id: "drive",
    title: "단계 머신",
    op: "drive",
    slot: "drive",
    line: "diverge → explore → converge → apply",
    points: ["lifecycle.lease.rejected"],
    caps: [{ cap: "loop.spawn", need: "requires", provider: "agents" }],
  },
  {
    id: "consume",
    title: "지식 소비",
    op: "drive",
    slot: "모으기",
    line: "converge에서 읽기만 · 출처별 저하",
    caps: [
      { cap: "web.search", need: "optional", provider: "web-exa" },
      { cap: "knowledge.*", need: "optional", provider: "knowledge" },
    ],
  },
  {
    id: "record",
    title: "발견 기록",
    op: "record",
    slot: "적용",
    line: "apply 끝에 발견 1건씩 · findingId 멱등",
    caps: [{ cap: "work.tasks", need: "optional", provider: "work" }],
    out: ["grp.helm.discovery.recorded", "grp.helm.inquiry.finished"],
  },
];
export const GROUP_PARTS: Record<string, { title: string; op: Op; failed?: boolean }[] | null> = {
  helm: HELM_PARTS.map((p) => ({ title: p.title, op: p.op })),
  "plan-first": null,
  learning: [
    { title: "경계 관찰", op: "on" },
    { title: "정착 관찰", op: "on" },
    { title: "제안 기록", op: "record" },
  ],
  review: [
    { title: "변경 감지", op: "on" },
    { title: "검토", op: "drive", failed: true },
    { title: "의견 post", op: "post" },
  ],
};

// ── 흐름: Helm 단계 머신(L3.helm §4.2)
export const LENSES = [
  {
    id: "failure-modes",
    title: "실패 사례",
    status: "running" as const,
    tool: "web_search ttl cache boundary bug",
  },
  {
    id: "first-principles",
    title: "기본 원리",
    status: "done" as const,
    tool: "발견 2",
    findings: 2,
  },
  {
    id: "analogy",
    title: "다른 분야 유사",
    status: "failed" as const,
    tool: "web_fetch 시간 초과",
  },
];
export const TRIAL_LOG = [
  { at: "14:02:01", label: "주도 받음", note: "턴 4 · spawn 8", done: true },
  { at: "14:02:01", label: "commit diverge", note: "렌즈 3 고름", done: true },
  { at: "14:02:19", label: "모델 턴", note: "턴 1/4", done: true },
  { at: "14:02:20", label: "commit explore", note: "렌즈 시작", done: true },
  { at: "14:02:31", label: "쓰기 거부", note: "bash · main", done: true, guard: true },
  { at: "14:02:44", label: "spawn 3/8", note: "explorer × 3", done: true },
  { at: "지금", label: "explored 대기", note: "1 끝 · 1 실패 · 1 도는 중", done: false },
];

// ── 프로필 쌓기(탐구 중심)
export type Pick = "on" | "off" | "keep";
export const PROFILE_FLOORS: {
  layer: string;
  title: string;
  hue: Hue;
  items: { id: string; label: string; now: string; pick: Pick; note?: string; locked?: boolean }[];
}[] = [
  {
    layer: "L3",
    title: "플러그인 그룹",
    hue: "l3",
    items: [
      { id: "helm", label: "Helm", now: "켜짐", pick: "on", note: "maxLenses 4" },
      { id: "plan-first", label: "계획 먼저", now: "켜짐", pick: "off" },
      { id: "learning", label: "학습", now: "켜짐", pick: "keep" },
      { id: "review", label: "리뷰", now: "자동 꺼짐", pick: "keep" },
    ],
  },
  {
    layer: "plugin",
    title: "외부 plugin",
    hue: "pl",
    items: [
      { id: "acme-notes", label: "acme 노트", now: "켜짐", pick: "off" },
      { id: "provider-oauth", label: "OAuth 모델", now: "꺼짐", pick: "keep" },
    ],
  },
  {
    layer: "L2",
    title: "서비스",
    hue: "l2",
    items: [
      { id: "web-exa", label: "Exa 검색", now: "켜짐", pick: "keep" },
      { id: "knowledge", label: "지식", now: "켜짐", pick: "keep" },
      { id: "dialog", label: "대화 도구", now: "꺼짐", pick: "on" },
    ],
  },
  {
    layer: "L1",
    title: "코어",
    hue: "base",
    items: [{ id: "core", label: "core-loop", now: "켜짐", pick: "keep", locked: true }],
  },
];
