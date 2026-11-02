// 캔버스 v3 고정 데이터. 문서(F.extensions §3.1·§3.4, X.operations §3.7, L0/L1 README, L3 helm·group-sdk)에 맞춘 가짜 값이다.
// 층 이름은 SPEC §1 용어 추천안(그룹 · 기능 · 에이전트 핵심 · 시스템 기반 · 확장 연결부 · 공통 규약)을 쓴다. 기계 이름은 그대로 둔다.

export type LayerId = "L3" | "L2" | "L1" | "L0" | "X" | "F";
export type Origin = "builtin" | "user" | "project";
export type Health = "ok" | "off" | "auto_off" | "failing";

export interface Layer {
  id: LayerId;
  name: string;
  /** 사용자에게 이 층이 해 주는 일(한 줄) */
  does: string;
  /** 이 층에 "더하는 것"이 무엇인지 */
  addNoun: string;
  /** 이 층 플러그인이 붙는 방식(정직한 표기) */
  how: string;
}

export const LAYERS: Layer[] = [
  {
    id: "L3",
    name: "그룹",
    does: "대화를 어떤 방식으로 풀지 정해요",
    addNoun: "그룹",
    how: "훅 · 입력 넣기 · 주도",
  },
  {
    id: "L2",
    name: "기능",
    does: "검색·지식·작업 같은 일을 해 줘요",
    addNoun: "기능",
    how: "기능 제공 · 도구 등록",
  },
  {
    id: "L1",
    name: "에이전트 핵심",
    does: "매 턴 모델을 부르고 도구를 돌려요",
    addNoun: "플러그인",
    how: "모델 등록 · 요청 훅 · 도구",
  },
  {
    id: "L0",
    name: "시스템 기반",
    does: "명령·저장·시크릿이 실제로 도는 곳이에요",
    addNoun: "어댑터",
    how: "구현 교체 · 시작할 때 적용",
  },
  {
    id: "X",
    name: "확장 연결부",
    does: "턴 흐름에 끼어들 훅을 열어 줘요",
    addNoun: "훅",
    how: "외부 훅 · 훅 하나에 참여",
  },
  {
    id: "F",
    name: "공통 규약",
    does: "모든 층이 같은 이름으로 말하게 해요",
    addNoun: "",
    how: "플러그인이 선언하면 생겨요",
  },
];
export const layerById = (id: LayerId) => LAYERS.find((l) => l.id === id)!;

export interface Plugin {
  id: string;
  name: string;
  layer: LayerId;
  origin: Origin;
  /** manifest layer "plugin"(층 패키지가 아닌 외부 확장) */
  external?: boolean;
  icon: string;
  health: Health;
  version?: string;
  points?: string[];
  usesPost?: boolean;
  usesDrive?: boolean;
  provides?: string[];
  requires?: string[];
  optional?: string[];
  /** 한 줄 설명 */
  blurb: string;
  failures?: number;
  /** 블록 수(composition 선언) */
  parts?: number;
  /** L0 어댑터가 바꾸는 서비스 */
  replaces?: string;
  /** [제안] 표지 */
  proposal?: boolean;
}

export const PLUGINS: Plugin[] = [
  // L3 작업 방식
  {
    id: "helm",
    name: "Helm",
    layer: "L3",
    origin: "builtin",
    icon: "compass",
    health: "ok",
    version: "0.4.0",
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
    requires: [],
    optional: [
      "web.search",
      "web.fetch",
      "knowledge.search",
      "knowledge.skills",
      "knowledge.memory",
      "work.tasks",
    ],
    blurb: "막히면 렌즈 셋을 동시에 띄워 탐구해요",
    parts: 7,
  },
  {
    id: "plan-first",
    name: "계획 먼저",
    layer: "L3",
    origin: "builtin",
    icon: "list",
    health: "ok",
    version: "0.4.0",
    points: ["input.user.before", "boundary.step.after"],
    usesDrive: true,
    blurb: "큰 작업은 계획부터 세워요",
  },
  {
    id: "learning",
    name: "학습",
    layer: "L3",
    origin: "builtin",
    icon: "sparkles",
    health: "ok",
    version: "0.4.0",
    points: ["boundary.settle.after", "session.shutdown"],
    blurb: "대화가 끝나면 쓸 만한 기술을 제안해요",
    parts: 3,
  },
  {
    id: "review",
    name: "리뷰",
    layer: "L3",
    origin: "builtin",
    icon: "eye",
    health: "auto_off",
    version: "0.4.0",
    points: ["boundary.settle.after"],
    blurb: "끝난 작업을 다시 읽어요",
    failures: 5,
  },
  {
    id: "lens-review",
    name: "렌즈 리뷰",
    layer: "L3",
    origin: "user",
    icon: "scan",
    health: "off",
    version: "0.1.0",
    points: ["input.agent.before", "tool.call.before"],
    usesDrive: true,
    blurb: "Helm을 복제해 리뷰 렌즈만 남겼어요",
    parts: 5,
  },
  // L2 기능
  {
    id: "web",
    name: "웹",
    layer: "L2",
    origin: "builtin",
    icon: "globe",
    health: "ok",
    version: "0.4.0",
    provides: ["web.search", "web.fetch"],
    blurb: "검색하고 페이지를 읽어요",
  },
  {
    id: "web-exa",
    name: "Exa 검색",
    layer: "L2",
    origin: "user",
    icon: "search",
    health: "ok",
    version: "1.0.3",
    provides: ["web.search"],
    blurb: "web.search를 Exa로 바꿔 줘요",
  },
  {
    id: "knowledge",
    name: "지식",
    layer: "L2",
    origin: "builtin",
    icon: "bulb",
    health: "ok",
    version: "0.4.0",
    provides: ["knowledge.skills", "knowledge.memory"],
    blurb: "기술과 기억을 꺼내 줘요",
  },
  {
    id: "work",
    name: "작업",
    layer: "L2",
    origin: "builtin",
    icon: "checks",
    health: "ok",
    version: "0.4.0",
    provides: ["work.tasks"],
    blurb: "할 일을 만들고 추적해요",
  },
  {
    id: "dialog",
    name: "대화 도구",
    layer: "L2",
    origin: "builtin",
    icon: "chat",
    health: "ok",
    version: "0.4.0",
    provides: ["dialog.ask"],
    blurb: "사용자에게 되물어요",
  },
  {
    id: "acme-notes",
    name: "acme 노트",
    layer: "L2",
    origin: "project",
    external: true,
    icon: "file",
    health: "failing",
    version: "0.2.1",
    points: ["tool.result"],
    provides: ["notes.search"],
    blurb: "팀 노트를 찾아 줘요",
    failures: 2,
  },
  // L1 엔진
  {
    id: "tasks",
    name: "실행 관리",
    layer: "L1",
    origin: "builtin",
    icon: "rows",
    health: "ok",
    blurb: "취소·동시 상한·입력 큐",
  },
  {
    id: "loop",
    name: "턴 실행",
    layer: "L1",
    origin: "builtin",
    icon: "play",
    health: "ok",
    blurb: "단계 커밋·체크포인트·예산",
  },
  {
    id: "models",
    name: "모델",
    layer: "L1",
    origin: "builtin",
    icon: "spark",
    health: "ok",
    blurb: "provider·역할 라우팅·캐시",
  },
  {
    id: "tools",
    name: "도구·권한",
    layer: "L1",
    origin: "builtin",
    icon: "shield",
    health: "ok",
    blurb: "실행 파이프라인·승인",
  },
  {
    id: "context",
    name: "컨텍스트",
    layer: "L1",
    origin: "builtin",
    icon: "layers",
    health: "ok",
    blurb: "조립·컴팩션·캐시 표식",
  },
  {
    id: "session",
    name: "기록·복구",
    layer: "L1",
    origin: "builtin",
    icon: "history",
    health: "ok",
    blurb: "원자 커밋·재개·분기",
  },
  {
    id: "agents",
    name: "보조 에이전트",
    layer: "L1",
    origin: "builtin",
    icon: "branch",
    health: "ok",
    blurb: "서브에이전트·권한 상한",
  },
  {
    id: "cost-router",
    name: "비용 라우터",
    layer: "L1",
    origin: "user",
    icon: "route",
    health: "ok",
    version: "0.3.0",
    points: ["request.provider.before", "request.model.after"],
    blurb: "요청마다 모델을 골라 비용을 줄여요",
    parts: 5,
    proposal: true,
  },
  // L0 실행 환경
  {
    id: "exec",
    name: "실행 위치",
    layer: "L0",
    origin: "builtin",
    icon: "terminal",
    health: "ok",
    blurb: "로컬 셸",
  },
  {
    id: "sandbox",
    name: "격리",
    layer: "L0",
    origin: "builtin",
    icon: "box",
    health: "ok",
    blurb: "bubblewrap",
  },
  {
    id: "secrets",
    name: "시크릿",
    layer: "L0",
    origin: "builtin",
    icon: "key",
    health: "ok",
    blurb: "SOPS + age",
  },
  {
    id: "process",
    name: "프로세스",
    layer: "L0",
    origin: "builtin",
    icon: "cpu",
    health: "ok",
    blurb: "앱 안 엔진·자식 수명",
  },
  {
    id: "store",
    name: "저장",
    layer: "L0",
    origin: "builtin",
    icon: "db",
    health: "ok",
    blurb: "SQLite 하나",
  },
  {
    id: "os",
    name: "기기",
    layer: "L0",
    origin: "builtin",
    icon: "laptop",
    health: "ok",
    blurb: "경로·시각·알림",
  },
  {
    id: "exec-buildbox",
    name: "build-box 원격",
    layer: "L0",
    origin: "user",
    icon: "monitor",
    health: "ok",
    version: "0.1.0",
    replaces: "exec",
    blurb: "셸을 build-box에서 돌려요",
    proposal: true,
  },
  // X 확장 연결부: 내장은 네 연산(아래 OPS), 사용자 것은 외부 훅
  {
    id: "hook:secret-scan",
    name: "시크릿 검사",
    layer: "X",
    origin: "user",
    icon: "shieldcheck",
    health: "ok",
    points: ["tool.call.before"],
    blurb: "명령에 시크릿 값이 보이면 막아요(exit 2)",
  },
  {
    id: "hook:notify-done",
    name: "끝나면 알림",
    layer: "X",
    origin: "user",
    icon: "bell",
    health: "ok",
    points: ["boundary.settle.after"],
    blurb: "턴이 끝나면 휴대폰에 알려요",
  },
];
export const pluginById = (id: string) => PLUGINS.find((p) => p.id === id)!;
export const pluginsOf = (l: LayerId) => PLUGINS.filter((p) => p.layer === l);

/** X 내장: 네 연산과 두 자리. 플러그인이 아니라 확장 연결부 자체의 블록다. */
export const OPS = [
  { id: "on", label: "훅", gloss: "훅에서 끼어들기" },
  { id: "post", label: "입력 넣기", gloss: "입력 대기열에 보내기" },
  { id: "drive", label: "주도", gloss: "한 번에 한 그룹만" },
  { id: "scope", label: "켜고 끄기", gloss: "단계가 끝나면 적용" },
] as const;

/** F 내장 규약 다섯과, 플러그인이 접두로 선언해 생긴 것. */
export const CONTRACTS = [
  { id: "conversation", label: "대화" },
  { id: "records", label: "기록" },
  { id: "capabilities", label: "기능" },
  { id: "extensions", label: "확장" },
  { id: "wire-settings", label: "연결·설정" },
];
export const DECLARED = [
  { id: "notes.search", kind: "기능", by: "acme-notes" },
  { id: "x.cost-router.*", kind: "기록 종류", by: "cost-router" },
  { id: "ext.cost-router.*", kind: "설정 키", by: "cost-router" },
];

// ── 턴 흐름(확장 연결부의 훅 일곱 종류) ─────────────────────────────
export type StageId = "session" | "input" | "request" | "guard" | "tool" | "boundary" | "lifecycle";
export interface Stage {
  id: StageId;
  label: string;
  /** 훅 수(F.extensions §3.4 집계) */
  total: number;
  when: string;
}
export const STAGES: Stage[] = [
  { id: "session", label: "대화", total: 15, when: "대화를 열고 닫을 때" },
  { id: "input", label: "입력", total: 3, when: "사용자 말이 들어올 때" },
  { id: "request", label: "모델 요청", total: 9, when: "모델에 보내기 직전·직후" },
  { id: "guard", label: "안전 검사", total: 3, when: "보내기·실행 직전 마지막 확인" },
  { id: "tool", label: "도구", total: 5, when: "도구를 부르고 결과를 받을 때" },
  { id: "boundary", label: "단계", total: 9, when: "단계와 턴이 끝날 때" },
  { id: "lifecycle", label: "수명", total: 2, when: "보조 에이전트·주도 사건" },
];
export const stageOf = (point: string): StageId => point.split(".")[0] as StageId;

export interface Hook {
  plugin: string;
  point: string;
  fold: "tap" | "first" | "chain" | "collect";
  p95?: number;
  budget?: number;
  fails?: number;
}
export const HOOKS: Hook[] = [
  { plugin: "helm", point: "input.agent.before", fold: "collect", p95: 4, budget: 50 },
  { plugin: "helm", point: "tool.call.before", fold: "first", p95: 1, budget: 20 },
  { plugin: "helm", point: "tool.execution.after", fold: "tap", p95: 2, budget: 50 },
  { plugin: "helm", point: "boundary.settle.after", fold: "tap", p95: 9, budget: 100 },
  { plugin: "helm", point: "session.start", fold: "tap", p95: 12, budget: 200 },
  { plugin: "helm", point: "lifecycle.lease.rejected", fold: "tap", p95: 1, budget: 50 },
  { plugin: "plan-first", point: "input.user.before", fold: "chain", p95: 3, budget: 50 },
  { plugin: "plan-first", point: "boundary.step.after", fold: "chain", p95: 6, budget: 100 },
  { plugin: "learning", point: "boundary.settle.after", fold: "tap", p95: 22, budget: 100 },
  { plugin: "learning", point: "session.shutdown", fold: "tap", p95: 40, budget: 200 },
  {
    plugin: "review",
    point: "boundary.settle.after",
    fold: "tap",
    p95: 140,
    budget: 100,
    fails: 5,
  },
  { plugin: "lens-review", point: "input.agent.before", fold: "collect" },
  { plugin: "lens-review", point: "tool.call.before", fold: "first" },
  { plugin: "acme-notes", point: "tool.result", fold: "chain", p95: 31, budget: 50, fails: 2 },
  { plugin: "cost-router", point: "request.provider.before", fold: "chain", p95: 2, budget: 20 },
  { plugin: "cost-router", point: "request.model.after", fold: "tap", p95: 1, budget: 50 },
  { plugin: "hook:secret-scan", point: "tool.call.before", fold: "first", p95: 38, budget: 30000 },
  {
    plugin: "hook:notify-done",
    point: "boundary.settle.after",
    fold: "tap",
    p95: 210,
    budget: 30000,
  },
];
export const hooksAt = (s: StageId) => HOOKS.filter((h) => stageOf(h.point) === s);

// ── 보기 기준(맥락)과 프로필(프로필) ─────────────────────────────
export type ViewKind = "all" | "thread" | "trial" | "preset";
export const VIEWS: { value: string; kind: ViewKind; label: string; meta: string }[] = [
  { value: "all", kind: "all", label: "설치 전체", meta: "이 기기에 깔린 것" },
  { value: "t1", kind: "thread", label: "캐시 무효화 조사", meta: "실시간 · 턴 7" },
  { value: "t2", kind: "thread", label: "릴리스 노트 초안", meta: "쉬는 중" },
  { value: "x-helm5", kind: "trial", label: "helm 렌즈 5개", meta: "테스트 · 멈춤" },
  { value: "p-explore", kind: "preset", label: "탐구 중심", meta: "저장된 스위치 묶음" },
  { value: "p-quiet", kind: "preset", label: "조용히", meta: "저장된 스위치 묶음" },
];
export const viewOf = (v: string) => VIEWS.find((x) => x.value === v) ?? VIEWS[0]!;

/** 대화 "캐시 무효화 조사"에서 켜진 것 */
export const THREAD_ON = new Set([
  "helm",
  "plan-first",
  "learning",
  "web",
  "web-exa",
  "knowledge",
  "work",
  "acme-notes",
  "tasks",
  "loop",
  "models",
  "tools",
  "context",
  "session",
  "agents",
  "exec",
  "sandbox",
  "secrets",
  "process",
  "store",
  "os",
  "hook:secret-scan",
]);
export const THREAD_PENDING = new Set(["dialog"]);

export type DiffMark = "add" | "remove" | "override";
/** 프로필 "탐구 중심"을 대화에 적용하면 */
export const PRESET_DIFF: Record<string, { mark: DiffMark; note: string }> = {
  "plan-first": { mark: "remove", note: "꺼져요" },
  dialog: { mark: "add", note: "켜져요" },
  "cost-router": { mark: "add", note: "켜져요" },
  "hook:notify-done": { mark: "add", note: "켜져요" },
  helm: { mark: "override", note: "maxLenses 3 → 4" },
};

// ── 포커스 관계(Helm) ─────────────────────────────
export interface Relation {
  layer: LayerId;
  /** 렌즈 줄 글 */
  label: string;
  /** mono 기계 이름 */
  id?: string;
  /** 캔버스 쪽 대상(타일 id 또는 "stage:<id>" 또는 "contract:<id>") */
  target: string;
  /** 관계 방향: uses(가져다 씀) | hooks(끼어듦) | implements(지킴) | consumedBy(쓰는 쪽) */
  kind: "uses" | "hooks" | "implements" | "consumedBy";
  missing?: boolean;
}
export const HELM_RELATIONS: Relation[] = [
  {
    layer: "L3",
    label: "학습이 발견 기록을 읽어요",
    id: "grp.helm.*",
    target: "learning",
    kind: "consumedBy",
  },
  {
    layer: "L2",
    label: "웹 검색 · Exa 검색이 줘요",
    id: "web.search",
    target: "web-exa",
    kind: "uses",
  },
  { layer: "L2", label: "페이지 읽기", id: "web.fetch", target: "web", kind: "uses" },
  { layer: "L2", label: "기술·기억", id: "knowledge.*", target: "knowledge", kind: "uses" },
  { layer: "L2", label: "할 일", id: "work.tasks", target: "work", kind: "uses" },
  {
    layer: "L1",
    label: "렌즈를 보조 에이전트로",
    id: "loop.spawn",
    target: "agents",
    kind: "uses",
  },
  { layer: "L1", label: "주도로 턴 잇기", id: "loop.turn", target: "loop", kind: "uses" },
  { layer: "L1", label: "렌즈 모델 역할", id: "models.role", target: "models", kind: "uses" },
  { layer: "L0", label: "상태·발견 저장", id: "ScopedStore", target: "store", kind: "uses" },
  {
    layer: "X",
    label: "입력 · 렌즈 지시",
    id: "input.agent.before",
    target: "stage:input",
    kind: "hooks",
  },
  {
    layer: "X",
    label: "도구 · 쓰기 막기",
    id: "tool.call.before +1",
    target: "stage:tool",
    kind: "hooks",
  },
  {
    layer: "X",
    label: "단계 · 막힘 감지",
    id: "boundary.settle.after",
    target: "stage:boundary",
    kind: "hooks",
  },
  {
    layer: "X",
    label: "대화 · 상태 복원",
    id: "session.start",
    target: "stage:session",
    kind: "hooks",
  },
  {
    layer: "X",
    label: "수명 · 주도 거절",
    id: "lifecycle.lease.rejected",
    target: "stage:lifecycle",
    kind: "hooks",
  },
  {
    layer: "F",
    label: "그룹 정보 파일",
    id: "kind: group",
    target: "contract:extensions",
    kind: "implements",
  },
  {
    layer: "F",
    label: "그룹 기록 두 종류",
    id: "GroupRecord",
    target: "contract:records",
    kind: "implements",
  },
  {
    layer: "F",
    label: "설정 키",
    id: "ext.helm.*",
    target: "contract:wire-settings",
    kind: "implements",
  },
];

/** 사용자 L1 플러그인(비용 라우터)의 관계: 아래층만 쓰고, 같은 층 "모델"이 내놓은 route/auto를 받아 써요. */
export const ROUTER_RELATIONS: Relation[] = [
  {
    layer: "L3",
    label: "Helm 렌즈가 route/auto로 불려요",
    id: "models.role",
    target: "helm",
    kind: "consumedBy",
  },
  {
    layer: "L1",
    label: "provider 등록 · 역할 표",
    id: "models 서비스",
    target: "models",
    kind: "uses",
  },
  { layer: "L0", label: "비용 통계 저장", id: "ScopedStore", target: "store", kind: "uses" },
  {
    layer: "X",
    label: "모델 요청 · 모델 바꾸기",
    id: "request.provider.before",
    target: "stage:request",
    kind: "hooks",
  },
  {
    layer: "F",
    label: "기록 종류 선언",
    id: "x.cost-router.*",
    target: "contract:records",
    kind: "implements",
  },
  {
    layer: "F",
    label: "설정 키 선언",
    id: "ext.cost-router.*",
    target: "contract:wire-settings",
    kind: "implements",
  },
];

/** 포커스 관계: 정해 둔 둘 말고는 훅 표에서 끌어낸다(X 단계 + F 확장 규약). */
export function relationsOf(id: string): Relation[] {
  if (id === "helm") return HELM_RELATIONS;
  if (id === "cost-router") return ROUTER_RELATIONS;
  const hooks = HOOKS.filter((h) => h.plugin === id);
  const stages = [...new Set(hooks.map((h) => stageOf(h.point)))];
  return [
    ...stages.map((st): Relation => {
      const pts = hooks.filter((h) => stageOf(h.point) === st);
      const first = pts[0]?.point ?? st;
      return {
        layer: "X",
        label: STAGES.find((x) => x.id === st)?.label ?? st,
        id: pts.length > 1 ? `${first} +${pts.length - 1}` : first,
        target: `stage:${st}`,
        kind: "hooks",
      };
    }),
    {
      layer: "F",
      label: "확장 정보 파일",
      id: "plugin.json",
      target: "contract:extensions",
      kind: "implements",
    },
  ];
}
