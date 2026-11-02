// 크래프트 공용 고정 데이터. 스펙 §14.5를 값 그대로 옮기고 타입만 덧붙였다(두 크래프트 시안이 같이 쓴다).
// 셸 부품(크래프트 오른쪽 "기록"·"대화" 탭, 상태 표시줄 runtime 칸)도 여기서 읽는다.

export type Layer = "L0" | "L1" | "L2" | "L3" | "plugin" | "X";
export type ExtKind = "group" | "plugin" | "core" | "hook";
export type Trust = "builtin" | "user" | "project";
export type ExtStatus = "enabled" | "disabled" | "auto_disabled";
export type DriveRole = "holder" | "waiting" | "rejected" | "none";

export interface Extension {
  name: string;
  layer: Layer;
  kind: ExtKind;
  trust: Trust;
  tier: "builtin" | "user" | "project" | "core";
  version: string;
  status: ExtStatus;
  drive: DriveRole;
  failures: number;
  /** 면제 tier(guard, core): 끌 수 없다. */
  exempt?: boolean;
}

export const extensions: Extension[] = [
  {
    name: "helm",
    layer: "L3",
    kind: "group",
    trust: "user",
    tier: "user",
    version: "0.1.0",
    status: "enabled",
    drive: "holder",
    failures: 0,
  },
  {
    name: "learning",
    layer: "L3",
    kind: "group",
    trust: "builtin",
    tier: "builtin",
    version: "0.4.0",
    status: "enabled",
    drive: "none",
    failures: 0,
  },
  {
    name: "review",
    layer: "L3",
    kind: "group",
    trust: "user",
    tier: "user",
    version: "0.2.1",
    status: "auto_disabled",
    drive: "waiting",
    failures: 5,
  },
  {
    name: "work",
    layer: "L2",
    kind: "plugin",
    trust: "builtin",
    tier: "builtin",
    version: "0.4.0",
    status: "enabled",
    drive: "none",
    failures: 0,
  },
  {
    name: "web-exa",
    layer: "L2",
    kind: "plugin",
    trust: "user",
    tier: "user",
    version: "1.0.3",
    status: "enabled",
    drive: "none",
    failures: 0,
  },
  {
    name: "acme-notes",
    layer: "plugin",
    kind: "plugin",
    trust: "project",
    tier: "project",
    version: "0.0.9",
    status: "enabled",
    drive: "none",
    failures: 2,
  },
  {
    name: "core-loop",
    layer: "L1",
    kind: "core",
    trust: "builtin",
    tier: "core",
    version: "0.4.0",
    status: "enabled",
    drive: "none",
    failures: 0,
    exempt: true,
  },
  {
    name: "provider-oauth",
    layer: "plugin",
    kind: "plugin",
    trust: "user",
    tier: "user",
    version: "0.1.0",
    status: "disabled",
    drive: "none",
    failures: 0,
  },
  {
    name: "pre-commit-lint",
    layer: "X",
    kind: "hook",
    trust: "user",
    tier: "user",
    version: "-",
    status: "enabled",
    drive: "none",
    failures: 0,
  },
];

export const LAYERS: Layer[] = ["L0", "L1", "L2", "L3", "plugin", "X"];

export const layerMap: Record<Layer, string[]> = {
  L0: ["sqlite", "exec", "sandbox", "secrets"],
  L1: ["loop", "tools", "models", "agents", "context"],
  L2: ["web", "knowledge", "work", "dialog", "web-exa"],
  L3: ["helm", "learning", "review"],
  plugin: ["acme-notes", "provider-oauth"],
  X: ["pre-commit-lint"],
};

export interface PointRow {
  point: string;
  fold: "collect" | "first" | "tap";
  budgetMs: number;
  p50: number | null;
  p95: number | null;
  failures: number;
}
export const helmPoints: PointRow[] = [
  { point: "input.agent.before", fold: "collect", budgetMs: 10000, p50: 12, p95: 40, failures: 0 },
  { point: "tool.call.before", fold: "first", budgetMs: 30000, p50: 3, p95: 9, failures: 0 },
  { point: "tool.execution.after", fold: "tap", budgetMs: 5000, p50: 1, p95: 4, failures: 0 },
  { point: "boundary.settle.after", fold: "tap", budgetMs: 5000, p50: 20, p95: 1200, failures: 1 },
  { point: "thread.start", fold: "tap", budgetMs: 5000, p50: 8, p95: 8, failures: 0 },
  {
    point: "lifecycle.lease.rejected",
    fold: "tap",
    budgetMs: 5000,
    p50: null,
    p95: null,
    failures: 0,
  },
];

export interface LeaseState {
  holder: string | null;
  turns: [number, number];
  spawns: [number, number];
  tokens: [number, number];
  queue: { group: string; state: "waiting" | "rejected" }[];
}
export const lease: LeaseState = {
  holder: "helm",
  turns: [1, 4],
  spawns: [3, 8],
  tokens: [120000, 400000],
  queue: [
    { group: "review", state: "waiting" },
    { group: "work", state: "rejected" },
  ],
};

export interface SwitchEntry {
  at: string;
  turn: number;
  text: string;
  reason: "request" | "handler_failed" | "auto_disable" | "release" | "toggle";
}
export const switches: SwitchEntry[] = [
  { at: "14:02", turn: 7, text: "helm이 주도를 받았어요", reason: "request" },
  {
    at: "14:03",
    turn: 7,
    text: "acme-notes 실패 2번 (tool.call.before)",
    reason: "handler_failed",
  },
  { at: "13:40", turn: 5, text: "review가 자동으로 꺼졌어요 (연속 5번)", reason: "auto_disable" },
];

export interface LensTool {
  name: string;
  detail: string;
  status: "done" | "running" | "failed";
}
export interface Lens {
  id: string;
  title: string;
  status: "running" | "done" | "failed";
  findings?: number;
  tools: LensTool[];
}
export interface Finding {
  confidence: "high" | "med" | "low";
  claim: string;
  sources: string[];
  task: string | null;
}
export const helmInquiry = {
  topic: "캐시 무효화",
  signal: { kind: "stuck", text: "같은 오류 3번" },
  phase: "explore" as "diverge" | "explore" | "converge" | "apply",
  lenses: [
    {
      id: "failure-cases",
      title: "실패 사례",
      status: "running",
      tools: [{ name: "web_search", detail: "ttl cache boundary bug", status: "done" }],
    },
    {
      id: "first-principles",
      title: "기본 원리",
      status: "done",
      findings: 2,
      tools: [{ name: "read", detail: "src/cache.ts", status: "done" }],
    },
    { id: "other-domain", title: "다른 분야 유사", status: "failed", tools: [] },
  ] satisfies Lens[] as Lens[],
  findings: [
    { confidence: "high", claim: "만료 비교 단위가 섞임", sources: ["web", "session"], task: null },
    { confidence: "med", claim: "TTL 경계 시각 버그", sources: ["web"], task: "#12" },
  ] satisfies Finding[] as Finding[],
  past: [
    { topic: "캐시 무효화", result: "applied", at: "어제 14:10", findings: 4 },
    { topic: "빌드 실패", result: "limit", at: "월 09:12", findings: 1 },
  ],
};

export const metrics = [
  { name: "helm", tokens: 1200000, costUsd: 3.1, leaseMin: 41, failures: 1, denies: 12 },
  { name: "learning", tokens: 300000, costUsd: 0.4, leaseMin: 0, failures: 0, denies: 0 },
  { name: "review", tokens: 80000, costUsd: 0.2, leaseMin: 6, failures: 7, denies: 3 },
];

export const promotion = {
  throughSeq: 9120,
  threads: 14,
  candidates: [
    {
      tool: "lens_search",
      owner: "helm",
      consumers: [{ scope: "review", calls: 3 }],
      userCalls: 0,
      candidate: true,
    },
  ],
};

export interface TestRun {
  kind: "trial" | "replay" | "bench" | "diff";
  target: string;
  result: "running" | "passed" | "failed" | "budget_pending" | "clean";
  at: string;
  took: string;
  commits?: number;
  failedAt?: number;
  firstDiffSeq?: number;
  firstDiffKind?: string;
  effects?: string;
  protectedLines?: number;
}
export const tests: TestRun[] = [
  { kind: "trial", target: "helm", result: "running", at: "지금", took: "1:12" },
  { kind: "replay", target: "helm", result: "passed", commits: 41, at: "3분 전", took: "18s" },
  {
    kind: "replay",
    target: "review",
    result: "failed",
    commits: 41,
    failedAt: 17,
    firstDiffSeq: 212,
    firstDiffKind: "grp.review.state.committed",
    effects: "work.task.create 2/1",
    at: "어제",
    took: "9s",
  },
  { kind: "bench", target: "server", result: "budget_pending", at: "어제", took: "2m" },
  {
    kind: "diff",
    target: "main..HEAD",
    result: "clean",
    protectedLines: 0,
    at: "어제",
    took: "1s",
  },
];

export const profiles = [
  {
    id: "explore",
    title: "탐구 중심",
    enable: ["helm", "learning", "web-exa"],
    settings: [{ key: "ext.helm.maxLenses", value: 4 }],
    driveGroup: "helm" as string | null,
  },
  {
    id: "quiet",
    title: "조용히",
    enable: ["learning"],
    settings: [] as { key: string; value: number }[],
    driveGroup: null as string | null,
  },
  {
    id: "review-trial",
    title: "review 테스트",
    enable: ["review", "web-exa"],
    settings: [] as { key: string; value: number }[],
    driveGroup: "review" as string | null,
  },
];

export const templates = [
  { id: "drive", label: "플러그인 그룹 · drive", hint: "턴을 구동하는 그룹", files: 10 },
  { id: "policy", label: "플러그인 그룹 · 정책", hint: "first 훅으로 막는 그룹", files: 8 },
  { id: "observe", label: "플러그인 그룹 · 관찰", hint: "기록만 남기는 그룹", files: 9 },
  { id: "provider", label: "플러그인 · L2 기능", hint: "준비 중", disabled: true },
  { id: "hook", label: "X 훅", hint: "준비 중", disabled: true },
];

/** 크래프트 오른쪽 "기록" 탭: 맥락 대화의 런타임 이벤트(§4.9.4). 시안이 덧붙인 값이다(§14.5에 없음). */
export interface RuntimeEvent {
  at: string;
  kind: string;
  source: string;
  text: string;
  tone?: "danger" | "warning";
}
export const runtimeEvents: RuntimeEvent[] = [
  {
    at: "14:03:12",
    kind: "scope.handler_failed",
    source: "ext:acme-notes",
    text: "tool.call.before · threw · 2번째",
    tone: "warning",
  },
  {
    at: "14:03:02",
    kind: "scope.handler_failed",
    source: "ext:acme-notes",
    text: "tool.call.before · threw",
    tone: "warning",
  },
  {
    at: "14:02:41",
    kind: "lease.acquired",
    source: "grp:helm",
    text: "턴 7 · 상한 턴 4 · spawn 8",
  },
  { at: "14:02:40", kind: "lease.rejected", source: "grp:work", text: "helm이 보유 중" },
  { at: "13:58:09", kind: "lease.released", source: "core", text: "턴 6 끝" },
  {
    at: "13:40:22",
    kind: "scope.changed",
    source: "grp:review",
    text: "자동 꺼짐 · 연속 5번",
    tone: "danger",
  },
];

/** 크래프트 오른쪽 "대화" 탭: 맥락 대화의 트랜스크립트 끝 부분(읽기 전용). */
export const threadTail: { who: "user" | "agent" | "runtime"; text: string }[] = [
  { who: "user", text: "무효화 테스트가 계속 실패해. 원인 찾아줘" },
  { who: "agent", text: "먼저 실패하는 테스트를 돌려 볼게요." },
  { who: "runtime", text: "helm이 주도를 받았어요 · 턴 7" },
  { who: "agent", text: "Helm 탐구를 시작했어요. 렌즈 3개로 원인을 넓게 볼게요." },
];
