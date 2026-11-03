// 크래프트 v5 고정 데이터. 지도, 순서(훅 줄), 카드가 모두 이 한 곳을 읽는다.
// 값은 F.extensions.spec의 매니페스트 모양(plugins[], group, components)과 훅 표를 따른 가짜 값이다.
import { T, josa } from "../_shell/terms";

// ── 훅 ────────────────────────────────────────────────────────────
export type Fold = "tap" | "first" | "chain" | "collect";
/** 화면 라벨(용어집 §3 fold): 관찰·차단·수정·합치기. 훅 선언이 정하는 규칙(F.extensions §4.1)과 같은 뜻이다. */
export const FOLD_LABEL: Record<Fold, string> = {
  tap: "관찰",
  first: "차단",
  chain: "수정",
  collect: "합치기",
};
/** 한 줄 툴팁: 이 줄의 핸들러가 결과에 하는 일 */
export const FOLD_TIP: Record<Fold, string> = {
  tap: "보기만 하고 바꾸지 않아요",
  first: "처음 막은 결정이 이겨요",
  chain: "고친 값이 다음 핸들러로 넘어가요",
  collect: "각자 낸 조각을 하나로 합쳐요",
};
export type Failure = "closed" | "open" | "skip";
export type PhaseId = "start" | "think" | "act" | "wrap";

export interface Phase {
  id: PhaseId;
  label: string;
}
export const PHASES: Phase[] = [
  { id: "start", label: "시작" },
  { id: "think", label: "생각" },
  { id: "act", label: "행동" },
  { id: "wrap", label: "마무리" },
];

export interface HookDef {
  id: string;
  /** 일이 어느 순간인가(한국어 먼저) */
  label: string;
  fold: Fold;
  phase: PhaseId;
  failure: Failure;
  /** 내장이 이 순간을 맡고 있으면 그 이름(대체할 수 있다) */
  builtin?: string;
}

/** 순서 화면에 늘 보이는 순간 13개. 위에서 아래가 에이전트 루프가 실제로 도는 순서다(컨텍스트 조립 앞에서 압축을 검사한다: L1.loop §4.2). */
export const HOOKS: HookDef[] = [
  {
    id: "thread.start",
    label: `${T.thread}를 열 때`,
    fold: "tap",
    phase: "start",
    failure: "open",
  },
  {
    id: "input.user.before",
    label: "내 말이 들어올 때",
    fold: "chain",
    phase: "start",
    failure: "skip",
  },
  {
    id: "input.agent.before",
    label: "일을 시작하기 전",
    fold: "collect",
    phase: "start",
    failure: "open",
  },
  {
    id: "thread.compact.before",
    label: "대화 압축",
    fold: "first",
    phase: "think",
    failure: "open",
    builtin: "내장 압축",
  },
  {
    id: "request.provider.before",
    label: "모델에 보내기 직전",
    fold: "chain",
    phase: "think",
    failure: "skip",
  },
  {
    id: "guard.model.before",
    label: "모델에 보내도 되는지",
    fold: "first",
    phase: "think",
    failure: "closed",
  },
  {
    id: "request.model.after",
    label: "모델이 답한 뒤",
    fold: "tap",
    phase: "think",
    failure: "open",
  },
  {
    id: "tool.call.before",
    label: "도구를 쓰기 전",
    fold: "first",
    phase: "act",
    failure: "closed",
  },
  { id: "tool.result", label: "도구 결과를 받을 때", fold: "chain", phase: "act", failure: "skip" },
  {
    id: "tool.execution.after",
    label: "도구가 끝난 뒤",
    fold: "tap",
    phase: "act",
    failure: "open",
  },
  {
    id: "boundary.step.after",
    label: `${josa(T.step, "이", "가")} 끝날 때`,
    fold: "chain",
    phase: "wrap",
    failure: "skip",
  },
  {
    id: "boundary.settle.after",
    label: `${T.turn}이 끝난 뒤`,
    fold: "tap",
    phase: "wrap",
    failure: "open",
  },
  {
    id: "thread.shutdown",
    label: `${T.thread}를 닫을 때`,
    fold: "tap",
    phase: "wrap",
    failure: "open",
  },
];
/**
 * 코어 루프의 내장 단계. 훅 줄 사이에 같은 흐름의 한 줄로 끼어든다(after = 이 훅 줄 바로 뒤).
 * 플러그인은 앞뒤 훅 줄에서 감쌀 수 있다. 통째로 바꾸는 것은 대체할 수 있는 단계(압축)뿐이고, 나머지는 엔진 작업이 필요하다.
 */
export interface CoreStep {
  id: string;
  label: string;
  /** 이 훅 줄 바로 뒤에 놓는다 */
  after: string;
  /** 앞에서 감싸는 훅, 뒤에서 감싸는 훅 */
  wrap: readonly [string, string];
  /** 툴팁 한 줄 */
  tip: string;
}
export const CORE_STEPS: readonly CoreStep[] = [
  {
    id: "core.context.assemble",
    label: "컨텍스트 조립",
    after: "thread.compact.before",
    wrap: ["input.agent.before", "request.provider.before"],
    tip: "앞뒤 줄에서 감쌀 수 있어요",
  },
  {
    id: "core.model.call",
    label: "모델 호출",
    after: "guard.model.before",
    wrap: ["request.provider.before", "request.model.after"],
    tip: "앞뒤 줄에서 감쌀 수 있어요",
  },
  {
    id: "core.tools.run",
    label: "도구 실행",
    after: "tool.call.before",
    wrap: ["tool.call.before", "tool.result"],
    tip: "앞뒤 줄에서 감쌀 수 있어요",
  },
];
export const hookDef = (id: string): HookDef | undefined => HOOKS.find((h) => h.id === id);

/** 나머지 훅 33개(HOOKS 46개 중). 펼치면 이름만 보인다. */
export const OTHER_HOOKS: readonly { id: string; fold: Fold }[] = [
  ["input.bash.before", "first"],
  ["request.context.before", "chain"],
  ["request.system.before", "chain"],
  ["request.cache.before", "chain"],
  ["request.headers.before", "chain"],
  ["request.provider.after", "tap"],
  ["request.stream", "tap"],
  ["request.thinking.after", "tap"],
  ["tool.execution.before", "tap"],
  ["tool.execution.update", "tap"],
  ["boundary.turn.before", "tap"],
  ["boundary.step.before", "tap"],
  ["boundary.message.before", "tap"],
  ["boundary.message.update", "tap"],
  ["boundary.message.after", "chain"],
  ["boundary.settle.before", "chain"],
  ["boundary.turn.after", "tap"],
  ["thread.trust.before", "first"],
  ["thread.resources", "collect"],
  ["thread.mcp.after", "tap"],
  ["thread.info.after", "tap"],
  ["thread.switch.before", "first"],
  ["thread.fork.before", "first"],
  ["thread.compact.after", "tap"],
  ["thread.compact.failed", "tap"],
  ["thread.tree.before", "first"],
  ["thread.tree.after", "tap"],
  ["thread.prompt.before", "tap"],
  ["thread.prompt.after", "tap"],
  ["guard.tool.before", "first"],
  ["guard.output.before", "first"],
  ["lifecycle.agent.settled", "tap"],
  ["lifecycle.lease.rejected", "tap"],
].map(([id, fold]) => ({
  id: id ?? "",
  fold: fold === "first" || fold === "chain" || fold === "collect" ? fold : "tap",
}));

// ── 플러그인 ──────────────────────────────────────────────────────
/** 매니페스트 plugins[].layer: 외부 플러그인은 "plugin"이다. */
export type LayerKey = "L1" | "L2" | "L3" | "plugin";
export const LAYER_NAME: Record<LayerKey, string> = {
  L1: T.layerL1,
  L2: T.capability,
  L3: T.layerL3,
  plugin: "외부",
};
export const LAYER_CODE: Record<LayerKey, string> = {
  L1: "L1",
  L2: "L2",
  L3: "L3",
  plugin: "외부",
};
export type Origin = "builtin" | "user" | "project";
export const ORIGIN_LABEL: Record<Origin, string> = {
  builtin: T.trustBuiltin,
  user: T.trustUser,
  project: "프로젝트 제공",
};

export type PieceKind = "skill" | "command" | "tool" | "mcp" | "agent" | "view";
/** 플러그인이 넣어 주는 것의 종류(훅과 기능은 따로 있다) */
export const PIECE_LABEL: Record<PieceKind, string> = {
  skill: "스킬",
  command: "명령",
  tool: "도구",
  mcp: "MCP 서버",
  agent: T.childAgent,
  view: T.pluginView,
};
export const PIECE_ORDER: readonly PieceKind[] = [
  "skill",
  "command",
  "tool",
  "mcp",
  "agent",
  "view",
];
export interface Piece {
  kind: PieceKind;
  name: string;
}

export interface Health {
  /** 연속 실패 횟수 */
  fails: number;
  /** 어느 훅에서 */
  hook: string;
  text: string;
  at: string;
  /** 끝난 방식 */
  autoOff?: boolean;
  /** 자동 꺼짐 기준(연속) */
  limit: number;
}

export interface Plugin {
  /** Registration id: 루트는 확장 이름, 그 밖은 "<확장>/<id>" */
  id: string;
  name: string;
  /** 한 줄로 하는 일(명사구) */
  role: string;
  layer: LayerKey;
  /** 그룹 id(= 확장 이름). 없으면 혼자 설치된 플러그인 */
  group?: string;
  origin: Origin;
  version?: string;
  hooks: string[];
  provides: string[];
  optional?: string[];
  /** 꼭 있어야 하는 기능(매니페스트 requires, 스펙 §3.1). 없는 기능은 기능 대기다. */
  requires?: string[];
  pieces: Piece[];
  drives?: boolean;
  /** 남기는 기록 종류(recordKinds, 스펙 §3.6): grp.<그룹>.<주제>.<일> 또는 x.<확장>.<주제>.<일> */
  records?: string[];
  /** 읽는 기록 종류(readsRecordKinds). 끝이 ".*"이면 앞부분으로 시작하는 것 전부다. */
  reads?: string[];
  /** 켜져 있나(전역 하나. 대화마다 끄는 일은 대화 화면의 몫이다) */
  on: boolean;
  health?: Health;
}

export interface Group {
  id: string;
  name: string;
  version: string;
  origin: Origin;
  role: string;
  members: string[];
  /** 그룹이 쥔 공용 설정 */
  config?: string;
}

export const GROUPS: Group[] = [
  {
    id: "helm",
    name: "Helm",
    version: "0.4.0",
    origin: "builtin",
    role: "렌즈로 하는 탐구",
    members: ["helm", "helm/explore", "helm/panel"],
    config: "maxLenses: 3",
  },
  {
    id: "learning",
    name: "학습",
    version: "0.4.0",
    origin: "builtin",
    role: "끝난 일에서 배운 것 남기기",
    members: ["learning", "learning/ledger"],
  },
  {
    id: "review",
    name: "리뷰",
    version: "0.2.1",
    origin: "user",
    role: "끝날 때마다 하는 변경 검토",
    members: ["review", "review/lens"],
    config: "maxFailures: 5",
  },
];
export const groupById = (id: string): Group | undefined => GROUPS.find((g) => g.id === id);

const piece = (kind: PieceKind, name: string): Piece => ({ kind, name });

export const PLUGINS: Plugin[] = [
  {
    id: "helm",
    name: "Helm",
    role: "탐구를 이끄는 오케스트레이터",
    layer: "L3",
    group: "helm",
    origin: "builtin",
    version: "0.4.0",
    drives: true,
    on: true,
    provides: [],
    optional: ["web.search", "knowledge.search", "work.tasks"],
    hooks: [
      "thread.start",
      "input.agent.before",
      "tool.call.before",
      "tool.execution.after",
      "boundary.settle.after",
      "lifecycle.lease.rejected",
    ],
    reads: ["grp.learning.memory.*"],
    pieces: [piece("command", "/explore")],
    health: {
      fails: 1,
      hook: "boundary.settle.after",
      text: "한도 1.2초를 넘겼어요",
      at: "14:01",
      limit: 5,
    },
  },
  {
    id: "helm/explore",
    name: "탐구 기능",
    role: "렌즈로 찾아오는 기능",
    layer: "L2",
    group: "helm",
    origin: "builtin",
    version: "0.4.0",
    on: true,
    hooks: [],
    provides: ["helm.inquiry"],
    pieces: [
      piece("tool", "lens_search"),
      piece("agent", "explorer"),
      piece("skill", "explore-method"),
    ],
  },
  {
    id: "helm/panel",
    name: "Helm 화면",
    role: "탐구 상황을 보여 주는 옆 패널",
    layer: "L3",
    group: "helm",
    origin: "builtin",
    version: "0.4.0",
    on: true,
    hooks: [],
    provides: [],
    pieces: [piece("view", "Helm 탐구")],
  },
  {
    id: "learning",
    name: "학습",
    role: "끝난 일을 정리하는 오케스트레이터",
    layer: "L3",
    group: "learning",
    origin: "builtin",
    version: "0.4.0",
    on: true,
    hooks: ["boundary.settle.after", "thread.shutdown"],
    requires: ["knowledge.memory"],
    provides: [],
    pieces: [piece("skill", "write-lesson"), piece("command", "/learn")],
  },
  {
    id: "learning/ledger",
    name: "기억 원장",
    role: "배운 것을 적는 기능",
    layer: "L2",
    group: "learning",
    origin: "builtin",
    version: "0.4.0",
    on: true,
    hooks: [],
    provides: ["knowledge.memory"],
    records: ["grp.learning.memory.written"],
    pieces: [piece("tool", "memory_write")],
  },
  {
    id: "review",
    name: "리뷰",
    role: "변경을 검토하는 오케스트레이터",
    layer: "L3",
    group: "review",
    origin: "user",
    version: "0.2.1",
    on: true,
    hooks: ["boundary.settle.after"],
    provides: [],
    requires: ["knowledge.search"],
    pieces: [piece("command", "/review")],
    health: {
      fails: 5,
      hook: "boundary.settle.after",
      text: "연속 5번 실패해 자동 꺼짐",
      at: "13:40",
      limit: 5,
      autoOff: true,
    },
  },
  {
    id: "review/lens",
    name: "리뷰 렌즈",
    role: "리뷰 관점을 맡는 보조 에이전트",
    layer: "L3",
    group: "review",
    origin: "user",
    version: "0.2.1",
    on: true,
    hooks: ["input.agent.before"],
    provides: [],
    pieces: [piece("agent", "reviewer")],
  },
  {
    id: "web",
    name: "웹",
    role: "검색과 페이지 읽기",
    layer: "L2",
    origin: "builtin",
    version: "0.4.0",
    on: true,
    hooks: [],
    provides: ["web.search", "web.fetch"],
    pieces: [piece("tool", "web_search"), piece("tool", "web_fetch")],
  },
  {
    id: "exa",
    name: "Exa 검색",
    role: "Exa로 하는 웹 검색",
    layer: "plugin",
    origin: "user",
    version: "1.0.3",
    on: false,
    hooks: [],
    provides: ["web.search"],
    pieces: [piece("tool", "exa_search")],
  },
  {
    id: "knowledge",
    name: "지식",
    role: "기억과 스킬 찾기",
    layer: "L2",
    origin: "builtin",
    version: "0.4.0",
    on: true,
    hooks: [],
    provides: ["knowledge.search", "knowledge.skills"],
    reads: ["x.acme-notes.note.*"],
    pieces: [piece("tool", "skill_load"), piece("tool", "knowledge_search")],
  },
  {
    id: "work",
    name: "작업",
    role: "할 일 기록과 이어 가기",
    layer: "L2",
    origin: "builtin",
    version: "0.4.0",
    on: true,
    hooks: [],
    provides: ["work.tasks"],
    pieces: [piece("tool", "task_create"), piece("command", "/todo")],
  },
  {
    id: "cost-router",
    name: "비용 라우터",
    role: "쉬운 요청은 싼 모델로",
    layer: "L1",
    origin: "user",
    version: "0.1.0",
    on: true,
    hooks: ["request.provider.before", "request.model.after"],
    provides: [],
    pieces: [],
  },
  {
    id: "compact-keep",
    name: "요약 직접",
    role: "직접 하는 대화 요약",
    layer: "L1",
    origin: "user",
    version: "0.1.0",
    on: false,
    hooks: ["thread.compact.before"],
    provides: [],
    pieces: [piece("skill", "keep-decisions")],
  },
  {
    id: "secret-scan",
    name: "시크릿 검사",
    role: "도구 입력에 섞인 키 검사",
    layer: "plugin",
    origin: "user",
    version: "0.2.0",
    on: true,
    hooks: ["tool.call.before"],
    provides: [],
    pieces: [],
  },
  {
    id: "lint-on-edit",
    name: "편집 뒤 린트",
    role: "파일을 고친 뒤 린트",
    layer: "plugin",
    origin: "user",
    version: "0.1.2",
    on: true,
    hooks: ["tool.execution.after"],
    provides: [],
    pieces: [piece("command", "/lint")],
  },
  {
    id: "notify-done",
    name: "끝나면 알림",
    role: `${T.turn}이 끝나면 알림`,
    layer: "plugin",
    origin: "user",
    version: "0.1.0",
    on: true,
    hooks: ["boundary.settle.after"],
    provides: [],
    pieces: [],
  },
  {
    id: "acme-notes",
    name: "acme 노트",
    role: "사내 노트를 검색 결과에 섞기",
    layer: "plugin",
    origin: "project",
    version: "0.0.9",
    on: true,
    hooks: ["tool.result"],
    provides: ["notes.search"],
    records: ["x.acme-notes.note.indexed"],
    pieces: [piece("mcp", "acme-wiki"), piece("skill", "acme-style")],
    health: {
      fails: 2,
      hook: "tool.result",
      text: "notes.search 응답 시간 초과",
      at: "14:03",
      limit: 5,
    },
  },
  {
    id: "pr-kit",
    name: "PR 도구",
    role: "PR 읽기와 변경 기록 거들기",
    layer: "plugin",
    origin: "user",
    version: "0.3.0",
    on: true,
    hooks: ["input.user.before"],
    provides: [],
    pieces: [
      piece("skill", "pr-review"),
      piece("skill", "release-notes"),
      piece("command", "/pr"),
      piece("command", "/changelog"),
      piece("mcp", "github"),
    ],
  },
];
export const pluginById = (id: string): Plugin | undefined => PLUGINS.find((p) => p.id === id);

/** 줄마다 핸들러 순서(시작 값). 꺼진 플러그인도 줄에 남는다. */
export const INITIAL_ORDER: Record<string, string[]> = {
  "thread.start": ["helm"],
  "input.user.before": ["pr-kit"],
  "input.agent.before": ["helm", "review/lens"],
  "request.provider.before": ["cost-router"],
  "guard.model.before": [],
  "request.model.after": ["cost-router"],
  "tool.call.before": ["secret-scan", "helm"],
  "tool.result": ["acme-notes"],
  "tool.execution.after": ["lint-on-edit", "helm"],
  "boundary.step.after": [],
  "boundary.settle.after": ["helm", "learning", "review", "notify-done"],
  "thread.compact.before": ["compact-keep"],
  "thread.shutdown": ["learning"],
};

// ── 기능 줄(제공자 바꾸기) ────────────────────────────────────────
export interface CapRow {
  id: string;
  label: string;
  /** 내장 제공자(플러그인 id) */
  builtin: string;
}
export const CAPS: CapRow[] = [
  { id: "web.search", label: "웹 검색", builtin: "web" },
  { id: "knowledge.search", label: "지식 찾기", builtin: "knowledge" },
  { id: "work.tasks", label: "작업 기록", builtin: "work" },
  { id: "notes.search", label: "사내 노트 찾기", builtin: "acme-notes" },
];
export const providersOf = (cap: string): Plugin[] =>
  PLUGINS.filter((p) => p.provides.includes(cap));

// ── 지도 자리 ─────────────────────────────────────────────────────
/** 둘레 각도(위가 0, 시계 방향). 같은 그룹은 붙은 부채꼴에 놓는다. */
export const ANGLE: Record<string, number> = {
  helm: 38,
  "helm/explore": 55,
  "helm/panel": 76,
  "cost-router": 100,
  "pr-kit": 101,
  learning: 118,
  "learning/ledger": 150,
  "compact-keep": 185,
  review: 205,
  "review/lens": 232,
  exa: 250,
  "secret-scan": 268,
  web: 250,
  "lint-on-edit": 288,
  "acme-notes": 308,
  knowledge: 290,
  work: 322,
  "notify-done": 328,
};
export const RING: Record<LayerKey, number> = { L1: 0, L2: 1, L3: 2, plugin: 3 };

// ── 선택 ──────────────────────────────────────────────────────────
export type Sel =
  | { k: "agent" }
  | { k: "layer"; id: LayerKey }
  | { k: "plugin"; id: string }
  | { k: "group"; id: string }
  | { k: "hook"; id: string }
  | { k: "builtin"; slot: string };
export const sameSel = (a: Sel, b: Sel): boolean => {
  if (a.k !== b.k) return false;
  if (a.k === "plugin" && b.k === "plugin") return a.id === b.id;
  if (a.k === "layer" && b.k === "layer") return a.id === b.id;
  if (a.k === "group" && b.k === "group") return a.id === b.id;
  if (a.k === "hook" && b.k === "hook") return a.id === b.id;
  if (a.k === "builtin" && b.k === "builtin") return a.slot === b.slot;
  return true;
};
export const hookSlot = (hook: string): string => `hook:${hook}`;
export const capSlot = (cap: string): string => `cap:${cap}`;

// ── 엔진 ──────────────────────────────────────────────────────────
export const LEAD = {
  holder: "helm",
  turns: [1, 4] as const,
  spawns: [3, 8] as const,
  tokens: [120000, 400000] as const,
  queue: [
    { who: "review", state: "기다림" },
    { who: "learning", state: "거절" },
  ],
};

// ── 만들기 템플릿 ─────────────────────────────────────────────────
export interface BuildTemplate {
  id: string;
  label: string;
  hint: string;
  /** 이 fold의 훅에 걸 때 먼저 권한다 */
  fold?: Fold;
}
export const BUILD_TEMPLATES: BuildTemplate[] = [
  { id: "guard", label: "차단", hint: "조건이 맞으면 멈춰요", fold: "first" },
  { id: "watch", label: "관찰", hint: "기록하고 알려요", fold: "tap" },
  { id: "shape", label: "수정", hint: "값을 바꿔서 넘겨요", fold: "chain" },
  { id: "gather", label: "합치기", hint: "덧붙일 내용을 내요", fold: "collect" },
  { id: "skill", label: "스킬", hint: "SKILL.md로 에이전트가 배워요" },
  { id: "command", label: "명령", hint: "/이름으로 불러요" },
  { id: "mcp", label: "MCP 서버", hint: "바깥 도구를 연결해요" },
];

/** "대화에서 만들기"가 고를 수 있는 지난 대화(셸 시안의 대화 목록과 같은 이름) */
export interface PastThread {
  id: string;
  title: string;
  when: string;
  /** 에이전트 대화에 채워지는 요약 */
  gist: string;
}
export const PAST_THREADS: readonly PastThread[] = [
  {
    id: "t1",
    title: "캐시 무효화 조사",
    when: "방금",
    gist: "캐시가 안 지워져 같은 답이 나오던 일을 찾았고, 도구를 쓰기 전에 키를 확인하는 단계가 빠져 있었어요",
  },
  {
    id: "t3",
    title: "빌드 실패 분석",
    when: "어제",
    gist: "린트 오류가 편집 직후에는 안 보이다가 빌드에서 터졌어요. 파일을 고친 뒤 바로 린트를 돌리면 막을 수 있어요",
  },
  {
    id: "t2",
    title: "테스트 정리",
    when: "어제",
    gist: "느린 테스트를 따로 모으고, 끝날 때마다 결과를 알려 주길 원했어요",
  },
  {
    id: "t5",
    title: "주간 회고",
    when: "3일 전",
    gist: "한 주가 끝나면 한 일을 요약해서 노트에 남기는 일을 반복했어요",
  },
];

/** 매니페스트 조각(카드의 코드 블록). 값은 모양만 맞춘 가짜다. */
export function manifestText(
  sel: { group: Group } | { plugin: Plugin },
  isOn: (id: string) => boolean,
): string {
  const plugins =
    "group" in sel
      ? sel.group.members.map(pluginById).filter((p): p is Plugin => p !== undefined)
      : [sel.plugin];
  const root = "group" in sel ? sel.group.id : (sel.plugin.id.split("/")[0] ?? sel.plugin.id);
  const version = "group" in sel ? sel.group.version : (sel.plugin.version ?? "0.1.0");
  const lines: string[] = [];
  lines.push("export default defineManifest({");
  lines.push("  schemaVersion: 2,");
  lines.push(`  name: "${root}",`);
  lines.push(`  version: "${version}",`);
  if ("group" in sel) lines.push("  group: {},");
  lines.push("  plugins: [");
  for (const p of plugins) {
    const fields: string[] = [];
    if (p.id.includes("/")) fields.push(`id: "${p.id.split("/")[1] ?? ""}"`);
    fields.push(`layer: "${p.layer === "plugin" ? "plugin" : p.layer}"`);
    if (p.drives === true) fields.push("drives: true");
    if (p.hooks.length > 0) fields.push(`hooks: [${p.hooks.map((h) => `"${h}"`).join(", ")}]`);
    if (p.provides.length > 0)
      fields.push(
        `provides: [${p.provides.map((c) => `{ id: "${c}", version: "1.0.0" }`).join(", ")}]`,
      );
    const req = p.requires ?? [];
    if (req.length > 0) fields.push(`requires: [${req.map((c) => `"${c}"`).join(", ")}]`);
    const rec = p.records ?? [];
    if (rec.length > 0) fields.push(`recordKinds: [${rec.map((k) => `"${k}"`).join(", ")}]`);
    const rd = p.reads ?? [];
    if (rd.length > 0) fields.push(`readsRecordKinds: [${rd.map((k) => `"${k}"`).join(", ")}]`);
    if (isOn(p.id)) fields.push("defaultEnabled: true");
    lines.push(`    { ${fields.join(", ")} },`);
  }
  lines.push("  ],");
  const all = plugins.flatMap((p) => p.pieces);
  const named = (k: PieceKind): string =>
    all
      .filter((x) => x.kind === k)
      .map((x) => `"${x.name}"`)
      .join(", ");
  const comps: string[] = [];
  if (all.some((x) => x.kind === "skill")) comps.push(`skills: [${named("skill")}]`);
  if (all.some((x) => x.kind === "command")) comps.push(`commands: [${named("command")}]`);
  if (all.some((x) => x.kind === "agent")) comps.push(`agents: [${named("agent")}]`);
  if (all.some((x) => x.kind === "mcp")) comps.push(`mcpServers: "./mcp.json"`);
  if (comps.length > 0) lines.push(`  components: { ${comps.join(", ")} },`);
  lines.push("})");
  return lines.join("\n");
}

// ── 보기 거르기 ───────────────────────────────────────────────────
/** 어떤 플러그인인가: 그룹에 속한 것, 혼자 설치된 것, 바깥(외부) 층 */
export type KindFilter = "all" | "group" | "single" | "external";
export const KIND_ORDER: readonly KindFilter[] = ["all", "group", "single", "external"];
export const KIND_LABEL: Record<KindFilter, string> = {
  all: "전체",
  group: T.group,
  single: `단일 ${T.plugin}`,
  external: "외부",
};
/** 무엇을 넣어 주나(훅은 따로 센다) */
export type Contrib = "hook" | PieceKind;
export const CONTRIB_ORDER: readonly Contrib[] = [
  "hook",
  "skill",
  "command",
  "tool",
  "mcp",
  "agent",
  "view",
];
export const CONTRIB_LABEL: Record<Contrib, string> = {
  hook: T.hook,
  skill: "스킬",
  command: "명령",
  tool: "도구",
  mcp: "MCP",
  agent: T.childAgent,
  view: "UI",
};
export const kindOf = (p: Plugin): Exclude<KindFilter, "all"> =>
  p.group !== undefined ? "group" : p.layer === "plugin" ? "external" : "single";
export const matchesKind = (p: Plugin, k: KindFilter): boolean =>
  k === "all" ||
  (k === "group"
    ? p.group !== undefined
    : k === "single"
      ? p.group === undefined
      : p.layer === "plugin");
export const hasContrib = (p: Plugin, c: Contrib): boolean =>
  c === "hook" ? p.hooks.length > 0 : p.pieces.some((x) => x.kind === c);
