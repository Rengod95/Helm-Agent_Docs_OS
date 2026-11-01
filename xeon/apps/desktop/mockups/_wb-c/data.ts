// 묶음 C(작업대 시험·버전·설정) 공용 고정 데이터. 목업 전용이고 값은 spec §6.24~§6.26, §14.5, 결정 4·6·9를 따른다.
// 확장 id는 _shell EXT의 표시 이름과 짝이다(결정 13). 기계 값(seq, 지점, 해시)은 mono로 그린다(DP-39).

import { extJ, josa, T } from "../_shell";

// ── P-19 시험 실행 ─────────────────────────────────────────────

export type RunKind = "trial" | "replay" | "bench" | "diff";
export type RunResult =
  | "running"
  | "pausing"
  | "paused"
  | "done"
  | "stopped"
  | "passed"
  | "failed"
  | "budget_pending"
  | "clean"
  | "env_error";

export interface Run {
  id: string;
  kind: RunKind;
  /** 확장 id 또는 bench 묶음·diff 범위 */
  target: string;
  result: RunResult;
  at: string;
  took: string;
  /** 시험 대화: 대화 id, 프로필 id, 단계 */
  thread?: string;
  title?: string;
  profile?: string;
  steps?: [number, number];
  commits?: number;
  diffCuts?: number[];
  protectedFiles?: number;
}

export const runs: Run[] = [
  {
    id: "r1",
    kind: "trial",
    target: "helm",
    result: "paused",
    at: "14:21",
    took: "3:10",
    thread: "t8",
    title: "렌즈 5개로 넓히기",
    profile: "explore",
    steps: [2, 6],
  },
  {
    id: "r2",
    kind: "trial",
    target: "helm",
    result: "done",
    at: "13:02",
    took: "4:40",
    thread: "t10",
    title: "렌즈 3개와 비교",
    profile: "explore",
    steps: [6, 6],
  },
  {
    id: "r3",
    kind: "trial",
    target: "review",
    result: "stopped",
    at: "어제",
    took: "1:55",
    thread: "t9",
    title: "리뷰 다시 켜기 확인",
    profile: "review-trial",
    steps: [3, 6],
  },
  {
    id: "r4",
    kind: "replay",
    target: "helm",
    result: "passed",
    commits: 41,
    at: "3분 전",
    took: "18s",
  },
  {
    id: "r5",
    kind: "replay",
    target: "review",
    result: "failed",
    commits: 41,
    diffCuts: [17, 18],
    at: "어제",
    took: "9s",
  },
  { id: "r6", kind: "bench", target: "server", result: "budget_pending", at: "어제", took: "2m" },
  {
    id: "r7",
    kind: "diff",
    target: "main..HEAD",
    result: "clean",
    protectedFiles: 0,
    at: "어제",
    took: "1s",
  },
];

/** ReplayDriveReport(결정 9: 그대로 + JSON 복사). review replay 실패 예. */
export const replayReport = {
  ok: false,
  group: "review",
  commits: 41,
  cuts: Array.from({ length: 41 }, (_, i) => ({
    n: i + 1,
    equal: !(i + 1 === 17 || i + 1 === 18),
  })),
  failure: null as string | null,
  firstDiff: { cut: 17, seq: 212, kind: "grp.review.state.committed" },
  baseline: { turn: 6, spawn: 0, delegate: 1, post: 1 },
  cut17: { turn: 0, spawn: 0, delegate: 0, post: 1 },
  diffLines: [
    { kind: "context" as const, text: '"kind": "grp.review.state.committed",' },
    { kind: "remove" as const, text: '"queue": ["#41", "#42"], "cursor": 2' },
    { kind: "add" as const, text: '"queue": ["#41", "#42", "#42"], "cursor": 3' },
    { kind: "context" as const, text: '"by": "grp:review"' },
  ],
};

export function replayJson(): string {
  const r = replayReport;
  return JSON.stringify(
    {
      ok: r.ok,
      commits: r.commits,
      cuts: r.cuts.filter((c) => !c.equal).map((c) => ({ index: c.n, equal: false })),
      firstDiff: { cut: r.firstDiff.cut, seq: r.firstDiff.seq, kind: r.firstDiff.kind },
      baselineEffects: r.baseline,
      cutEffects: { "17": r.cut17 },
    },
    null,
    2,
  );
}

/** 시험 대화 상세의 단계 사이 기록(W-48, W-50 trial.phase). */
export interface Boundary {
  n: number;
  at: string;
  seq: number;
  turn: number;
  text: string;
  /** 이 경계에서 멈췄는가 */
  stop?: boolean;
}
export const boundaries: Boundary[] = [
  {
    n: 1,
    at: "14:18:02",
    seq: 1204,
    turn: 1,
    text: `${extJ("helm", "이", "가")} ${josa(T.lead, "을", "를")} 받음 · ${T.inquiry} 시작`,
  },
  { n: 2, at: "14:19:40", seq: 1231, turn: 2, text: `${T.lens} 5개 띄움 · spawn 5/8`, stop: true },
];

/** 턴 다시 보기 눈금(X-15 계측 링 버퍼, trace.turn W-43). 눈금 하나 = 지점 하나의 발화. */
export interface Tick {
  seq: number;
  point: string;
  fold: "collect" | "first" | "tap";
  handlers: { ext: string; ms: string; budget: string; result: "ok" | "deny" | "threw" }[];
  boundary?: boolean;
  failed?: boolean;
}
export const ticks: Tick[] = [
  {
    seq: 1205,
    point: "input.agent.before",
    fold: "collect",
    handlers: [{ ext: "helm", ms: "12ms", budget: "10s", result: "ok" }],
  },
  {
    seq: 1208,
    point: "tool.call.before",
    fold: "first",
    handlers: [
      { ext: "helm", ms: "3ms", budget: "30s", result: "ok" },
      { ext: "acme-notes", ms: "8.1s", budget: "30s", result: "threw" },
    ],
    failed: true,
  },
  {
    seq: 1212,
    point: "tool.execution.after",
    fold: "tap",
    handlers: [{ ext: "helm", ms: "1ms", budget: "5s", result: "ok" }],
  },
  {
    seq: 1219,
    point: "tool.call.before",
    fold: "first",
    handlers: [{ ext: "helm", ms: "2ms", budget: "30s", result: "ok" }],
  },
  {
    seq: 1224,
    point: "tool.execution.after",
    fold: "tap",
    handlers: [
      { ext: "helm", ms: "1ms", budget: "5s", result: "ok" },
      { ext: "learning", ms: "4ms", budget: "5s", result: "ok" },
    ],
  },
  {
    seq: 1231,
    point: "boundary.settle.after",
    fold: "tap",
    handlers: [{ ext: "helm", ms: "20ms", budget: "5s", result: "ok" }],
    boundary: true,
  },
];

// ── P-17 버전 탭(§6.24.1) ──────────────────────────────────────

export type VersionSource = "bundle" | "link" | "authoring";
export interface VersionEntry {
  version: string;
  at: string;
  source: VersionSource;
  hash: string;
  schema: number;
  current?: boolean;
}
/** 전체 단계: 로더가 이력을 보관(X-8) + ext.versions·ext.rollback(W-31). 확장마다 5개까지. */
export const helmHistory: VersionEntry[] = [
  {
    version: "0.1.0",
    at: "오늘 09:12",
    source: "authoring",
    hash: "9f3c1a…e04b",
    schema: 3,
    current: true,
  },
  { version: "0.0.9", at: "10월 28일", source: "authoring", hash: "41d0aa…7c12", schema: 2 },
  { version: "0.0.8", at: "10월 21일", source: "link", hash: "c7b2e9…11fa", schema: 2 },
  { version: "0.0.6", at: "10월 14일", source: "link", hash: "08ae55…d3c0", schema: 1 },
];
export const SOURCE_LABEL: Record<VersionSource, string> = {
  bundle: "앱 번들",
  link: "사용자 연결",
  authoring: "제작 묶음 파일",
};

// ── P-17 설정 탭: 값 출처 ──────────────────────────────────────

export type SourceScope = "default" | "user" | "project" | "profile" | "trial" | "managed";
export interface SettingSourceRow {
  key: string;
  label: string;
  kind: "number" | "select" | "switch";
  value: string;
  /** 이긴 범위 */
  wins: SourceScope;
  /** 가려진 값(이긴 범위보다 넓은 범위) */
  shadowed?: { scope: SourceScope; value: string }[];
  options?: string[];
}
export const helmSettings: SettingSourceRow[] = [
  {
    key: "ext.helm.maxLenses",
    label: "렌즈 최대 수",
    kind: "number",
    value: "4",
    wins: "user",
    shadowed: [{ scope: "default", value: "3" }],
  },
  {
    key: "ext.helm.signal.mode",
    label: "신호가 오면",
    kind: "select",
    value: "제안만",
    wins: "project",
    shadowed: [
      { scope: "user", value: "바로 시작" },
      { scope: "default", value: "제안만" },
    ],
    options: ["제안만", "바로 시작", "무시"],
  },
  {
    key: "ext.helm.lensModel",
    label: "렌즈 모델",
    kind: "select",
    value: "sonnet-5-5",
    wins: "default",
    options: ["sonnet-5-5", "haiku-5"],
  },
];

// ── P-17 화면 탭(ADR-0021 §3.2, §3.6) ─────────────────────────

export interface ViewRow {
  slot: "page" | "well" | "card" | "status" | "command" | "settings";
  id: string;
  mode: "declarative" | "frame";
  state: "ok" | "view_disabled" | "frame_blocked" | "invalid";
  failures: number;
  diag?: { code: string; text: string };
}
export const helmViews: ViewRow[] = [
  { slot: "page", id: "helm/inquiry", mode: "declarative", state: "ok", failures: 0 },
  { slot: "well", id: "helm/panel", mode: "declarative", state: "ok", failures: 0 },
  {
    slot: "card",
    id: "helm/suggested",
    mode: "declarative",
    state: "view_disabled",
    failures: 5,
    diag: { code: "render_threw", text: "findings[3].confidence가 없어요 · 5번 연속" },
  },
  {
    slot: "card",
    id: "helm/finished",
    mode: "frame",
    state: "invalid",
    failures: 0,
    diag: { code: "view_mode_not_allowed", text: "card 기여는 frame 방식을 쓸 수 없어요" },
  },
  { slot: "status", id: "helm/phase", mode: "declarative", state: "ok", failures: 1 },
  { slot: "settings", id: "helm/settings-summary", mode: "declarative", state: "ok", failures: 0 },
];

// ── P-17 기록 탭: 진단 위치 ────────────────────────────────────

export interface LogRow {
  at: string;
  kind: string;
  text: string;
  tone?: "danger" | "warning";
  /** 로더·핸들러 진단 위치 */
  loc?: string;
}
export const acmeLog: LogRow[] = [
  {
    at: "14:03:12",
    kind: "scope.handler_failed",
    text: "tool.call.before · TypeError: notes is undefined",
    tone: "warning",
    loc: "src/handlers/before-call.ts:42",
  },
  {
    at: "14:03:02",
    kind: "scope.handler_failed",
    text: "tool.call.before · 시간 초과 8.1s / 30s",
    tone: "warning",
    loc: "src/handlers/before-call.ts:42",
  },
  {
    at: "13:58:40",
    kind: "loader.diagnostic",
    text: "manifest.points[2] 알 수 없는 지점 tool.result.after",
    tone: "danger",
    loc: "fresnel.extension.json:18",
  },
  { at: "13:58:40", kind: "x.reload", text: "다시 읽음 · 0.0.9 · 지점 3" },
];
export const ACME_DIR = "~/code/xeon/.fresnel/extensions/acme-notes";

// ── X 훅(hooks.list, W-36) ─────────────────────────────────────

export interface HookRow {
  id: string;
  event: string;
  command: string;
  scope: "user" | "project";
  p50: string;
  last: string;
  failures: number;
  enabled: boolean;
}
export const hooks: HookRow[] = [
  {
    id: "pre-commit-lint",
    event: "tool.call.before",
    command: "bunx oxlint --quiet",
    scope: "user",
    p50: "240ms",
    last: "2분 전",
    failures: 0,
    enabled: true,
  },
  {
    id: "audit-log",
    event: "session.end",
    command: "~/bin/audit-append.sh",
    scope: "project",
    p50: "35ms",
    last: "어제",
    failures: 3,
    enabled: true,
  },
];
