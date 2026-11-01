// 작업대 2차(W6–W9) 고정 데이터. 스펙 §14.5의 값을 그대로 옮기고(tests, metrics, promotion, profiles, templates),
// 그 표에 없는데 화면에 필요한 것만 덧붙였다. 덧붙인 것은 `// [덧붙임]`으로 표시하고 NOTES에 적는다.

export type Layer = "L0" | "L1" | "L2" | "L3" | "plugin" | "X";

/** §14.5 extensions에서 이 화면들이 쓰는 열만. */
export interface Ext {
  name: string;
  layer: Layer;
  kind: "group" | "plugin" | "core" | "hook";
  trust: "builtin" | "user" | "project";
  version: string;
  status: "enabled" | "disabled" | "auto_disabled";
  usesDrive?: boolean;
}
export const extensions: Ext[] = [
  {
    name: "helm",
    layer: "L3",
    kind: "group",
    trust: "user",
    version: "0.1.0",
    status: "enabled",
    usesDrive: true,
  },
  {
    name: "learning",
    layer: "L3",
    kind: "group",
    trust: "builtin",
    version: "0.4.0",
    status: "enabled",
  },
  {
    name: "review",
    layer: "L3",
    kind: "group",
    trust: "user",
    version: "0.2.1",
    status: "auto_disabled",
    usesDrive: true,
  },
  {
    name: "work",
    layer: "L2",
    kind: "plugin",
    trust: "builtin",
    version: "0.4.0",
    status: "enabled",
    usesDrive: true,
  },
  {
    name: "web-exa",
    layer: "L2",
    kind: "plugin",
    trust: "user",
    version: "1.0.3",
    status: "enabled",
  },
  {
    name: "acme-notes",
    layer: "plugin",
    kind: "plugin",
    trust: "project",
    version: "0.0.9",
    status: "enabled",
  },
  {
    name: "provider-oauth",
    layer: "plugin",
    kind: "plugin",
    trust: "user",
    version: "0.1.0",
    status: "disabled",
  },
  {
    name: "pre-commit-lint",
    layer: "X",
    kind: "hook",
    trust: "user",
    version: "-",
    status: "enabled",
  },
];
export const extByName = (n: string) => extensions.find((e) => e.name === n);

// ── W6 시험 실행 ───────────────────────────────────────────────
export type TestKind = "trial" | "replay" | "bench" | "diff";
export type TestResult = "running" | "passed" | "failed" | "budget_pending" | "clean" | "env_error";
export interface TestRun {
  id: string;
  kind: TestKind;
  target: string;
  result: TestResult;
  at: string;
  took: string;
  commits?: number;
  failedAt?: number;
  firstDiffSeq?: number;
  firstDiffKind?: string;
  effects?: string;
  protectedLines?: number;
  /** [덧붙임] 시험 대화의 진행률(턴/최대)과 프로필 */
  progress?: number;
  profile?: string;
}
/** §14.5 tests 다섯 줄 그대로(id만 덧붙임). */
export const tests: TestRun[] = [
  {
    id: "t5",
    kind: "trial",
    target: "helm",
    result: "running",
    at: "지금",
    took: "1:12",
    progress: 40,
    profile: "탐구 중심",
  },
  {
    id: "t4",
    kind: "replay",
    target: "helm",
    result: "passed",
    commits: 41,
    at: "3분 전",
    took: "18s",
  },
  {
    id: "t3",
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
  { id: "t2", kind: "bench", target: "server", result: "budget_pending", at: "어제", took: "2m" },
  {
    id: "t1",
    kind: "diff",
    target: "main..HEAD",
    result: "clean",
    protectedLines: 0,
    at: "어제",
    took: "1s",
  },
];

/** [덧붙임] replay 절단 결과(`ReplayDriveReport.cuts`). replayDrive는 커밋 지점 41개를 모두 다시 돌린다(첫 실패에서 멈추지 않음).
 *  17·18번 절단의 digest가 기준과 달랐다. */
export const replayCuts = Array.from({ length: 41 }, (_, i) => ({
  n: i + 1,
  equal: i + 1 !== 17 && i + 1 !== 18,
}));

/** [덧붙임] 처음 다른 위치의 두 이벤트(원본 기록 / 재개 뒤). C-20 대용으로 CodeDiff에 줄 단위로 둔다. */
export const firstDiff = {
  seq: 212,
  kind: "grp.review.state.committed",
  lines: [
    { kind: "context" as const, text: '"kind": "grp.review.state.committed",' },
    { kind: "context" as const, text: '"turn": 9, "step": 3,' },
    { kind: "remove" as const, text: '"digest": "b41e…9c02",' },
    { kind: "add" as const, text: '"digest": "77fa…01d3",' },
    { kind: "context" as const, text: '"state": { "queue": [' },
    { kind: "context" as const, text: '  { "id": "rv-12", "status": "open" },' },
    { kind: "add" as const, text: '  { "id": "rv-12", "status": "open" },' },
    { kind: "context" as const, text: "] }" },
  ],
};

/** [덧붙임] 효과 수(`EffectCounts`: turn·spawn·delegate·post). 기준 실행 값과 17번 절단 재실행이 새로 낸 값(0이어야 함).
 *  스펙 고정 데이터의 "work.task.create 2/1"은 EffectCounts 항목이 아니라서 여기서는 post로 옮겼다(NOTES). */
export const effectCounts = [
  { kind: "turn", baseline: 6, cut: 0 },
  { kind: "spawn", baseline: 0, cut: 0 },
  { kind: "delegate", baseline: 1, cut: 0 },
  { kind: "post", baseline: 1, cut: 1 },
];

/** [덧붙임] bench 결과. 예산은 모두 "사용자 결정 대기"(§6.26, W-30). */
export const benchRows = [
  { metric: "확장 디스패치 p95", value: "0.42ms", budget: null },
  { metric: "임대 교대 p95", value: "3.1ms", budget: null },
  { metric: "이벤트 기록 처리량", value: "18.2k/s", budget: null },
  { metric: "첫 토큰까지", value: "건너뜀", budget: null, note: "--first-token 없음" },
];

// ── W7 측정과 평가 ─────────────────────────────────────────────
/** §14.5 metrics 세 줄. 기간 7일 값. */
export const metrics = [
  {
    name: "helm",
    tokens: 1200000,
    costUsd: 3.1,
    leaseMin: 41,
    failures: 1,
    denies: 12,
    trend: [3, 5, 4, 8, 6, 9, 7],
  },
  {
    name: "learning",
    tokens: 300000,
    costUsd: 0.4,
    leaseMin: 0,
    failures: 0,
    denies: 0,
    trend: [1, 1, 2, 1, 2, 1, 1],
  },
  {
    name: "review",
    tokens: 80000,
    costUsd: 0.2,
    leaseMin: 6,
    failures: 7,
    denies: 3,
    trend: [2, 3, 1, 0, 0, 0, 0],
  },
];
/** [덧붙임] 기간 1일·30일과 맥락 한 대화일 때 값(목업에서 바뀌는 모습만 보이려고 비율로 줄인 값). */
export const metricsScale: Record<string, number> = { "1d": 0.18, "7d": 1, "30d": 3.6 };

/** [덧붙임] 핸들러 시간과 예산. §6.27 와이어프레임 두 줄 + review 한 줄(50% 넘음 → 경고, SC-20 3단계). */
export const handlerTimes = [
  { ext: "acme-notes", point: "tool.call.before", p95Ms: 8100, budgetMs: 30000 },
  { ext: "review", point: "boundary.settle.after", p95Ms: 3400, budgetMs: 5000 },
  { ext: "helm", point: "boundary.settle.after", p95Ms: 1200, budgetMs: 5000 },
  { ext: "helm", point: "input.agent.before", p95Ms: 40, budgetMs: 10000 },
];

/** §14.5 promotion */
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

/** [덧붙임] 코어 변경 검사: 보호 경로 네 묶음과 줄 수. */
export const diffCheck = {
  range: "main..HEAD",
  at: "어제 18:20",
  groups: [
    { path: "packages/contracts", lines: 0 },
    { path: "packages/ext-host", lines: 0 },
    { path: "packages/platform-*", lines: 0 },
    { path: "packages/core-*", lines: 0 },
  ],
  changedOutside: 14,
};

// ── W8 구성 ────────────────────────────────────────────────────
export interface Profile {
  id: string;
  title: string;
  enable: string[];
  settings: { key: string; value: string | number | boolean }[];
  driveGroup: string | null;
}
/** §14.5 profiles 그대로. */
export const profiles: Profile[] = [
  {
    id: "explore",
    title: "탐구 중심",
    enable: ["helm", "learning", "web-exa"],
    settings: [{ key: "ext.helm.maxLenses", value: 4 }],
    driveGroup: "helm",
  },
  { id: "quiet", title: "조용히", enable: ["learning"], settings: [], driveGroup: null },
  {
    id: "review-trial",
    title: "review 시험",
    enable: ["review", "web-exa"],
    settings: [],
    driveGroup: "review",
  },
];
/** [덧붙임] 설정 덮어쓰기에 고를 수 있는 키(확장 설정 스키마에서 온다고 가정). */
export const settingKeys = [
  {
    key: "ext.helm.maxLenses",
    label: "렌즈 최대 수",
    ext: "helm",
    type: "number" as const,
    def: 3,
  },
  {
    key: "ext.helm.driveLimits.turns",
    label: "임대 턴 상한",
    ext: "helm",
    type: "number" as const,
    def: 4,
  },
  {
    key: "l3.learning.reviewTrials",
    label: "시험 대화도 학습",
    ext: "learning",
    type: "boolean" as const,
    def: false,
  },
];

/** [덧붙임] 그룹 구성 탭: 슬롯 템플릿 조각(`L3.slots.spec`)과 필요한 능력. */
export const slotPieces = [
  {
    id: "trigger.signal",
    slot: "트리거",
    label: "신호로 시작",
    hint: "stuck·repeat 신호",
    requires: [] as string[],
  },
  {
    id: "trigger.command",
    slot: "트리거",
    label: "명령으로 시작",
    hint: "/<그룹> 명령",
    requires: [],
  },
  {
    id: "fanout.lenses",
    slot: "펼치기",
    label: "자식 렌즈 병렬",
    hint: "spawn n개",
    requires: ["agents"],
  },
  {
    id: "fanout.single",
    slot: "펼치기",
    label: "자식 하나",
    hint: "delegate 1개",
    requires: ["agents"],
  },
  {
    id: "converge.vote",
    slot: "모으기",
    label: "신뢰도 투표",
    hint: "발견을 합쳐 정렬",
    requires: [],
  },
  {
    id: "apply.task",
    slot: "적용",
    label: "작업으로 남기기",
    hint: "work.task.create",
    requires: ["work"],
  },
  { id: "apply.post", slot: "적용", label: "대화에 post", hint: "입력 큐에 넣기", requires: [] },
];

// ── W9 만들기 ──────────────────────────────────────────────────
/** §14.5 templates. disabled 둘은 "준비 중". hint 원문은 유지하고 준비 중은 배지로 따로 보인다(NOTES). */
export const templates = [
  {
    id: "drive",
    label: "의도 그룹 · drive",
    hint: "턴을 구동하는 그룹",
    files: 10,
    flag: "--drive",
  },
  {
    id: "policy",
    label: "의도 그룹 · 정책",
    hint: "first 지점으로 막는 그룹",
    files: 8,
    flag: "--policy",
  },
  { id: "observe", label: "의도 그룹 · 관찰", hint: "기록만 남기는 그룹", files: 9, flag: "" },
  {
    id: "provider",
    label: "플러그인 · L2 능력",
    hint: "provider 하나를 더하는 플러그인",
    disabled: true,
  },
  { id: "hook", label: "X 훅", hint: "셸 명령 훅", disabled: true },
] as const;

/** drive 템플릿이 만드는 파일 10개. `packages/group-kit/templates/index.json`의 drive 목록 그대로(경로의 common/·drive/ 접두는 뗌). */
export const driveFiles = [
  { path: ".fresnel-plugin/plugin.json", note: "매니페스트" },
  { path: "src/index.ts", note: "defineGroup, drive 함수" },
  { path: "src/state.ts", note: "상태 스키마" },
  { path: "src/settings.ts", note: "defineSettings" },
  { path: "test/unit.test.ts", note: "" },
  { path: "test/replay.test.ts", note: "replayDrive 재생 시험" },
  { path: "test/manifest.test.ts", note: "" },
  { path: "package.json", note: "" },
  { path: "tsconfig.json", note: "" },
  { path: "README.md", note: "" },
];

/** `apps/cli/src/group/rules.ts` RESERVED_GROUP_NAMES 그대로(23개. 스펙 SC-16은 24개라고 적음). */
export const reservedNames = [
  "core",
  "cap",
  "xh",
  "sys",
  "p",
  "ext",
  "x",
  "grp",
  "xeon",
  "workspace",
  "mcp",
  "web",
  "knowledge",
  "work",
  "dialog",
  "artifacts",
  "schedule",
  "auto",
  "all",
  "none",
  "group",
  "groups",
  "kit",
];
/** 설치된 확장 이름(엔진이 확인하는 충돌, 목업은 고정 목록). */
export const installedNames = [
  "helm",
  "learning",
  "review",
  "web-exa",
  "acme-notes",
  "provider-oauth",
  "pre-commit-lint",
];
export const NAME_RULE = /^[a-z][a-z0-9-]{1,31}$/;
