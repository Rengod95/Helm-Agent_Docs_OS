// 크래프트 v4 고정 데이터. 층 × 단계 표, 루프 그림, 범위 막대, 단위 선택이 모두 이 한 곳을 읽는다(같은 데이터의 두 보기).
// 층·주도·훅 같은 도메인 말은 용어 표(_shell/terms)를 거친다. 값은 _shell/workbench-fixtures와 wb-v3 고정 데이터에서 가져온 가짜 값이다.
import { T } from "../_shell/terms";
import { lease, profiles } from "../_shell/workbench-fixtures";

// ── 층 ────────────────────────────────────────────────────────────
export type LayerId = "L4" | "L3" | "L2" | "L1" | "L0" | "X" | "F";
export interface Layer {
  id: LayerId;
  name: string;
  /** 표에서 이 층 행을 묶는 이름. 바뀌는 곳에 십자 표식. */
  band: "app" | "core" | "base";
  /** 층에 더하는 것의 명사("플러그인 더하기") */
  noun: string;
  /** 이 층이 해 주는 일(한 줄) */
  does: string;
}
/** 위에서 아래: 앱 → … → 계약. 표와 루프 그림의 층 쌓기 순서. */
export const LAYERS: Layer[] = [
  { id: "L4", name: T.layerL4, band: "app", noun: T.plugin, does: "화면과 사람 확인을 맡아요" },
  { id: "L3", name: T.layerL3, band: "app", noun: T.group, does: "대화를 어떤 방식으로 풀지 정해요" },
  { id: "L2", name: T.layerL2, band: "core", noun: T.capability, does: "검색·지식·작업 같은 일을 해 줘요" },
  { id: "L1", name: T.layerL1, band: "core", noun: T.plugin, does: "매 턴 모델을 부르고 도구를 돌려요" },
  { id: "L0", name: T.layerL0, band: "core", noun: "어댑터", does: "명령·저장·시크릿이 실제로 도는 곳이에요" },
  { id: "X", name: T.layerX, band: "base", noun: T.hook, does: "턴 흐름에 끼어들 훅을 열어 줘요" },
  { id: "F", name: T.layerF, band: "base", noun: "", does: "모든 층이 같은 이름으로 말하게 해요" },
];
export const layerOf = (id: LayerId): Layer => {
  const l = LAYERS.find((x) => x.id === id);
  if (l === undefined) throw new Error(`층 없음: ${id}`);
  return l;
};

// ── 수명 단계(턴 흐름) ────────────────────────────────────────────
export type StageId = "thread" | "input" | "request" | "guard" | "tool" | "boundary" | "lifecycle";
export interface Stage {
  id: StageId;
  label: string;
  when: string;
}
export const STAGES: Stage[] = [
  { id: "thread", label: "대화", when: "대화를 열고 닫을 때" },
  { id: "input", label: "입력", when: "사용자 말이 들어올 때" },
  { id: "request", label: "모델 요청", when: "모델에 보내기 직전·직후" },
  { id: "guard", label: "안전 검사", when: "보내기·실행 직전 마지막 확인" },
  { id: "tool", label: "도구", when: "도구를 부르고 결과를 받을 때" },
  { id: "boundary", label: T.step, when: "단계와 턴이 끝날 때" },
  { id: "lifecycle", label: "수명", when: "보조 에이전트·주도 사건" },
];
export const stageOf = (id: StageId): Stage => {
  const s = STAGES.find((x) => x.id === id);
  if (s === undefined) throw new Error(`단계 없음: ${id}`);
  return s;
};
const STAGE_IDS: readonly StageId[] = STAGES.map((s) => s.id);
export const stageOfPoint = (point: string): StageId =>
  STAGE_IDS.find((id) => point.startsWith(`${id}.`)) ?? "thread";

/** 어느 층의 어느 단계에 새 것을 더할 수 있나. 비어 있어도 여기 없는 칸에는 더하기가 없다(F는 더할 수 없음). */
export const ALLOWED: Record<LayerId, readonly StageId[]> = {
  L4: ["thread", "input", "boundary"],
  L3: ["thread", "input", "request", "guard", "tool", "boundary", "lifecycle"],
  L2: ["input", "request", "tool", "boundary"],
  L1: ["request", "guard", "tool", "boundary"],
  L0: ["thread", "guard", "tool"],
  X: ["input", "request", "guard", "tool", "boundary", "lifecycle"],
  F: [],
};

// ── 플러그인 ──────────────────────────────────────────────────────
export type Origin = "builtin" | "user" | "project";
export type Health = "ok" | "auto_off" | "failing";
export type Fold = "tap" | "first" | "chain" | "collect";
export const FOLD_LABEL: Record<Fold, string> = {
  tap: "보기",
  first: "막기",
  chain: "고치기",
  collect: "모으기",
};
export interface HookDef {
  point: string;
  fold: Fold;
  budget?: number;
  p95?: number;
  fails?: number;
}
export interface Plugin {
  id: string;
  name: string;
  layer: LayerId;
  /** 그룹(L3)이면 group, 층 내장이면 core, 그 밖은 plugin. 계약 항목은 contract. */
  kind: "group" | "plugin" | "core" | "contract";
  origin: Origin;
  /** 훅은 없지만 그 단계에서 일하는 곳(기능을 주는 단계 등). 훅 단계는 stagesOf가 합친다. */
  acts: StageId[];
  hooks: HookDef[];
  blurb: string;
  health: Health;
  failures?: number;
  /** 끌 수 없음(면제 tier, 내장 코어). */
  locked?: boolean;
  version?: string;
  provides?: string[];
  requires?: string[];
}

const h = (point: string, fold: Fold, extra: Partial<HookDef> = {}): HookDef => ({
  point,
  fold,
  ...extra,
});

export const PLUGINS: Plugin[] = [
  // L4
  { id: "app", name: "데스크톱 앱", layer: "L4", kind: "core", origin: "builtin", acts: ["thread", "input", "boundary"], hooks: [], blurb: "대화 화면과 입력창", health: "ok", locked: true },
  { id: "approval", name: "승인 카드", layer: "L4", kind: "core", origin: "builtin", acts: ["guard", "tool"], hooks: [], blurb: `${T.humanGate}을 받는 카드`, health: "ok", locked: true },
  { id: "helm-ui", name: "Helm 화면", layer: "L4", kind: "plugin", origin: "builtin", acts: ["boundary", "lifecycle"], hooks: [], blurb: "탐구 상황을 옆 패널에 그려요", health: "ok", version: "0.4.0" },
  // L3
  {
    id: "helm", name: "Helm", layer: "L3", kind: "group", origin: "builtin", acts: [],
    hooks: [
      h("input.agent.before", "collect", { budget: 50, p95: 4 }),
      h("tool.call.before", "first", { budget: 20, p95: 1 }),
      h("tool.execution.after", "tap", { budget: 50, p95: 2 }),
      h("boundary.settle.after", "tap", { budget: 100, p95: 9, fails: 1 }),
      h("thread.start", "tap", { budget: 200, p95: 12 }),
      h("lifecycle.lease.rejected", "tap", { budget: 50, p95: 1 }),
    ],
    blurb: "막히면 렌즈 셋을 동시에 띄워 탐구해요", health: "ok", version: "0.4.0",
    requires: [], provides: ["helm.inquiry"],
  },
  {
    id: "plan-first", name: "계획 먼저", layer: "L3", kind: "group", origin: "builtin", acts: [],
    hooks: [h("input.user.before", "chain", { budget: 50, p95: 3 }), h("boundary.step.after", "chain", { budget: 100, p95: 6 })],
    blurb: "답하기 전에 계획부터 세워요", health: "ok", version: "0.2.0",
  },
  {
    id: "learning", name: "학습", layer: "L3", kind: "group", origin: "builtin", acts: [],
    hooks: [h("boundary.settle.after", "tap", { budget: 100, p95: 22 }), h("thread.shutdown", "tap", { budget: 200, p95: 40 })],
    blurb: "끝난 일에서 배운 것을 남겨요", health: "ok", version: "0.4.0",
  },
  {
    id: "review", name: "리뷰", layer: "L3", kind: "group", origin: "user", acts: [],
    hooks: [h("boundary.settle.after", "tap", { budget: 100, p95: 140, fails: 5 })],
    blurb: "변경을 끝날 때마다 검토해요", health: "auto_off", failures: 5, version: "0.2.1",
  },
  {
    id: "lens-review", name: "렌즈 리뷰", layer: "L3", kind: "plugin", origin: "user", acts: [],
    hooks: [h("input.agent.before", "collect"), h("tool.call.before", "first")],
    blurb: "Helm 렌즈에 리뷰 관점을 더해요", health: "ok", version: "0.1.0",
  },
  // L2
  { id: "web", name: "웹", layer: "L2", kind: "plugin", origin: "builtin", acts: ["tool"], hooks: [], blurb: "검색하고 페이지를 읽어요", health: "ok", version: "0.4.0", provides: ["web.search", "web.fetch"] },
  { id: "web-exa", name: "Exa 검색", layer: "L2", kind: "plugin", origin: "user", acts: ["tool"], hooks: [], blurb: "웹 검색을 Exa로 바꿔요", health: "ok", version: "1.0.3", provides: ["web.search"] },
  { id: "knowledge", name: "지식", layer: "L2", kind: "plugin", origin: "builtin", acts: ["input", "tool"], hooks: [], blurb: "기억과 스킬을 찾아 줘요", health: "ok", version: "0.4.0", provides: ["knowledge.search", "knowledge.skills"] },
  { id: "work", name: "작업", layer: "L2", kind: "plugin", origin: "builtin", acts: ["tool", "boundary"], hooks: [], blurb: "할 일을 기록하고 이어 줘요", health: "ok", version: "0.4.0", provides: ["work.tasks"] },
  { id: "dialog", name: "대화 도구", layer: "L2", kind: "plugin", origin: "builtin", acts: ["tool"], hooks: [], blurb: "사람에게 되묻는 도구", health: "ok", version: "0.4.0" },
  {
    id: "acme-notes", name: "acme 노트", layer: "L2", kind: "plugin", origin: "project", acts: ["tool"],
    hooks: [h("tool.result", "chain", { budget: 50, p95: 31, fails: 2 })],
    blurb: "사내 노트를 검색 결과에 섞어요", health: "failing", failures: 2, version: "0.0.9", provides: ["notes.search"],
  },
  // L1
  { id: "loop", name: "턴 실행", layer: "L1", kind: "core", origin: "builtin", acts: ["input", "request", "tool", "boundary"], hooks: [], blurb: "한 턴을 단계로 돌려요", health: "ok", locked: true },
  { id: "models", name: "모델", layer: "L1", kind: "core", origin: "builtin", acts: ["request"], hooks: [], blurb: "모델을 고르고 부르고", health: "ok", locked: true },
  { id: "tools", name: "도구·권한", layer: "L1", kind: "core", origin: "builtin", acts: ["guard", "tool"], hooks: [], blurb: "도구를 등록하고 권한을 물어요", health: "ok", locked: true },
  { id: "context", name: "컨텍스트", layer: "L1", kind: "core", origin: "builtin", acts: ["request"], hooks: [], blurb: "모델에 보낼 맥락을 꾸려요", health: "ok", locked: true },
  { id: "session", name: "기록·복구", layer: "L1", kind: "core", origin: "builtin", acts: ["thread", "boundary"], hooks: [], blurb: "턴을 기록하고 이어 받아요", health: "ok", locked: true },
  { id: "agents", name: T.childAgent, layer: "L1", kind: "core", origin: "builtin", acts: ["tool", "lifecycle"], hooks: [], blurb: "자식 에이전트를 띄우고 모아요", health: "ok", locked: true },
  {
    id: "cost-router", name: "비용 라우터", layer: "L1", kind: "plugin", origin: "user", acts: [],
    hooks: [h("request.provider.before", "chain", { budget: 20, p95: 2 }), h("request.model.after", "tap", { budget: 50, p95: 1 })],
    blurb: "쉬운 요청은 싼 모델로 보내요", health: "ok", version: "0.1.0",
  },
  // L0
  { id: "exec", name: "실행 위치", layer: "L0", kind: "core", origin: "builtin", acts: ["tool"], hooks: [], blurb: "명령이 도는 곳", health: "ok", locked: true },
  { id: "sandbox", name: "격리", layer: "L0", kind: "core", origin: "builtin", acts: ["guard", "tool"], hooks: [], blurb: "명령을 가둬서 돌려요", health: "ok", locked: true },
  { id: "secrets", name: "시크릿", layer: "L0", kind: "core", origin: "builtin", acts: ["guard"], hooks: [], blurb: "키를 값 없이 다뤄요", health: "ok", locked: true },
  { id: "store", name: "저장", layer: "L0", kind: "core", origin: "builtin", acts: ["thread", "boundary"], hooks: [], blurb: "기록을 디스크에 남겨요", health: "ok", locked: true },
  { id: "os", name: "기기", layer: "L0", kind: "core", origin: "builtin", acts: ["thread"], hooks: [], blurb: "알림·파일 같은 기기 연결", health: "ok", locked: true },
  { id: "exec-buildbox", name: "build-box 원격", layer: "L0", kind: "plugin", origin: "user", acts: ["tool"], hooks: [], blurb: "명령을 원격 build-box에서 돌려요", health: "ok", version: "0.1.0" },
  // X
  { id: "x-on", name: T.hook, layer: "X", kind: "core", origin: "builtin", acts: ["request", "guard", "tool"], hooks: [], blurb: "훅에서 끼어들기", health: "ok", locked: true },
  { id: "x-post", name: T.opPost, layer: "X", kind: "core", origin: "builtin", acts: ["input"], hooks: [], blurb: "입력 대기열에 보내기", health: "ok", locked: true },
  { id: "x-drive", name: T.drive, layer: "X", kind: "core", origin: "builtin", acts: ["boundary", "lifecycle"], hooks: [], blurb: "대화마다 하나만 쥐는 주도", health: "ok", locked: true },
  { id: "x-scope", name: "켜고 끄기", layer: "X", kind: "core", origin: "builtin", acts: ["thread"], hooks: [], blurb: `${T.atBoundary}`, health: "ok", locked: true },
  { id: "secret-scan", name: "시크릿 검사", layer: "X", kind: "plugin", origin: "user", acts: [], hooks: [h("tool.call.before", "first", { budget: 30000, p95: 38 })], blurb: "도구 입력에 키가 섞였는지 봐요", health: "ok" },
  { id: "notify-done", name: "끝나면 알림", layer: "X", kind: "plugin", origin: "user", acts: [], hooks: [h("boundary.settle.after", "tap", { budget: 30000, p95: 210 })], blurb: "턴이 끝나면 알림을 보내요", health: "ok" },
  // F
  { id: "c-thread", name: "대화 형식", layer: "F", kind: "contract", origin: "builtin", acts: ["thread", "input"], hooks: [], blurb: "", health: "ok", locked: true },
  { id: "c-model", name: "모델 요청 형식", layer: "F", kind: "contract", origin: "builtin", acts: ["request"], hooks: [], blurb: "", health: "ok", locked: true },
  { id: "c-hooks", name: "훅 표", layer: "F", kind: "contract", origin: "builtin", acts: ["guard", "tool"], hooks: [], blurb: "", health: "ok", locked: true },
  { id: "c-records", name: "기록 종류", layer: "F", kind: "contract", origin: "builtin", acts: ["boundary", "lifecycle"], hooks: [], blurb: "", health: "ok", locked: true },
];

export function pluginById(id: string): Plugin {
  const p = PLUGINS.find((x) => x.id === id);
  if (p === undefined) throw new Error(`플러그인 없음: ${id}`);
  return p;
}
/** 그 플러그인이 일하는 단계: 훅이 걸린 단계 + 훅 없이 일하는 단계. */
export function stagesOf(p: Plugin): StageId[] {
  return STAGES.map((s) => s.id).filter(
    (s) => p.acts.includes(s) || p.hooks.some((k) => stageOfPoint(k.point) === s),
  );
}
export const pluginsAt = (layer: LayerId, stage: StageId): Plugin[] =>
  PLUGINS.filter((p) => p.layer === layer && stagesOf(p).includes(stage));
export const pluginsIn = (layer: LayerId): Plugin[] => PLUGINS.filter((p) => p.layer === layer);

// ── 플러그인 그룹 ─────────────────────────────────────────────────
/** 그룹 = 그룹 자신 + 그 그룹이 가져다 쓰거나 확장하는 플러그인. 그룹을 고르면 이 모두의 칸이 밝아진다. */
export const GROUP_MEMBERS: Record<string, string[]> = {
  helm: ["lens-review", "helm-ui", "web", "web-exa", "knowledge", "work", "agents", "secret-scan"],
  "plan-first": [],
  learning: ["knowledge", "work", "notify-done"],
  review: ["work", "lens-review"],
};
export const GROUPS: Plugin[] = PLUGINS.filter((p) => p.kind === "group");
export const isGroup = (id: string): boolean => id in GROUP_MEMBERS;
/** 플러그인이 속한 첫 그룹(이동 경로용). 없으면 undefined. */
export function ownerOf(pluginId: string): Plugin | undefined {
  const g = GROUPS.find((x) => GROUP_MEMBERS[x.id]?.includes(pluginId) === true);
  return g;
}

// ── 단위 ─────────────────────────────────────────────────────────
export type Unit =
  | { kind: "loop" }
  | { kind: "group"; id: string }
  | { kind: "plugin"; id: string };
export const UNIT_KINDS = [
  { id: "loop", label: "전체 루프" },
  { id: "group", label: T.group },
  { id: "plugin", label: T.plugin },
] as const;

/** 단위가 밝히는 플러그인 id 모음. 전체 루프는 비어 있다(전부 보통). */
export function litSet(u: Unit): ReadonlySet<string> {
  if (u.kind === "loop") return new Set();
  if (u.kind === "plugin") return new Set([u.id]);
  return new Set([u.id, ...(GROUP_MEMBERS[u.id] ?? [])]);
}
export function unitName(u: Unit): string {
  return u.kind === "loop" ? "전체 루프" : pluginById(u.id).name;
}
/** 이동 경로: 전체 루프 › (그룹) › (플러그인). 그룹 밖 플러그인은 층 이름이 가운데 온다. */
export function unitPath(u: Unit): { label: string; unit: Unit }[] {
  const root = { label: "전체 루프", unit: { kind: "loop" } satisfies Unit };
  if (u.kind === "loop") return [root];
  if (u.kind === "group") return [root, { label: unitName(u), unit: u }];
  const p = pluginById(u.id);
  const g = ownerOf(u.id);
  const mid =
    p.kind === "group"
      ? []
      : g !== undefined
        ? [{ label: g.name, unit: { kind: "group", id: g.id } satisfies Unit }]
        : [];
  return [root, ...mid, { label: p.name, unit: u }];
}
/** 단위 안에서 손볼 수 있는 하위 선택(훅 이름 등)의 소유 플러그인 */
export function ownerPlugin(u: Unit): Plugin | null {
  return u.kind === "loop" ? null : pluginById(u.id);
}

// ── 범위(전역 → 프로필 → 프로젝트 → 대화) ──────────────────────
export type ScopeId = "global" | "profile" | "project" | "thread";
export interface Scope {
  id: ScopeId;
  label: string;
  /** 이 범위의 지금 값(어느 프로필·프로젝트·대화인지) */
  value: string;
  /** 쓰면 어디에 남나 */
  target: string;
  /** 문장에 쓰는 이름: "<범위>에 저장" */
  writes: string;
}
const profile = profiles[0];
export const SCOPES: Scope[] = [
  { id: "global", label: "전역", value: "모든 대화", target: "~/.fresnel/settings.json", writes: "모든 대화에" },
  { id: "profile", label: T.profile, value: profile?.title ?? "탐구 중심", target: "프로필 설정", writes: "이 프로필을 쓰는 대화에" },
  { id: "project", label: "프로젝트", value: "fresnel", target: ".fresnel/settings.json", writes: "이 프로젝트의 대화에" },
  { id: "thread", label: T.thread, value: "캐시 무효화 조사", target: "이 대화(session)", writes: "이 대화에" },
];
export const SCOPE_ORDER: readonly ScopeId[] = SCOPES.map((s) => s.id);
export const scopeOf = (id: ScopeId): Scope => {
  const s = SCOPES.find((x) => x.id === id);
  if (s === undefined) throw new Error(`범위 없음: ${id}`);
  return s;
};

export type Tri = "on" | "off";
export type Overrides = Record<ScopeId, Record<string, Tri>>;
/** 시작 값: 각 범위에서 직접 바꾼 켜짐·꺼짐만 적는다. 적히지 않은 것은 위에서 물려받는다. */
export const INITIAL_OVERRIDES: Overrides = {
  global: { "secret-scan": "on" },
  profile: { "web-exa": "on", "plan-first": "off", review: "off", "notify-done": "on" },
  project: { "acme-notes": "on", "cost-router": "on" },
  thread: { "lens-review": "on", dialog: "off" },
};
/** 아무도 적지 않았을 때의 켜짐: 내장은 켜짐, 설치한 것은 꺼짐. 면제는 늘 켜짐. */
const defaultOn = (p: Plugin): boolean => p.locked === true || p.origin === "builtin";

export interface Effective {
  on: boolean;
  /** 이 값을 정한 범위. 아무도 안 정했으면 default. */
  from: ScopeId | "default";
  /** 보는 범위에서 직접 정했나(덮어씀 표식) */
  here: boolean;
}
/** 범위 `at`에서 본 켜짐: 전역부터 at까지 마지막으로 적힌 값. */
export function effective(p: Plugin, at: ScopeId, ov: Overrides): Effective {
  if (p.locked === true) return { on: true, from: "default", here: false };
  let from: Effective["from"] = "default";
  let on = defaultOn(p);
  const upto = SCOPE_ORDER.indexOf(at);
  SCOPE_ORDER.forEach((s, i) => {
    if (i > upto) return;
    const v = ov[s][p.id];
    if (v !== undefined) {
      on = v === "on";
      from = s;
    }
  });
  return { on, from, here: ov[at][p.id] !== undefined };
}

export interface Setting {
  key: string;
  label: string;
  def: string;
  values: Partial<Record<ScopeId, string>>;
}
export const SETTINGS: Record<string, Setting[]> = {
  helm: [
    { key: "ext.helm.maxLenses", label: "렌즈 최대 수", def: "3", values: { profile: "4" } },
    { key: "ext.helm.leaseTurns", label: `${T.leadLimit}(턴)`, def: "4", values: { thread: "6" } },
    { key: "ext.helm.autoPropose", label: "탐구 자동 제안", def: "켜짐", values: { thread: "꺼짐" } },
  ],
  "cost-router": [
    { key: "ext.cost-router.cheapBelow", label: "싼 모델로 보낼 길이", def: "800자", values: { project: "1200자" } },
  ],
  review: [{ key: "ext.review.maxFailures", label: "자동 꺼짐 기준", def: "연속 5번", values: {} }],
};
export function settingValue(s: Setting, at: ScopeId): { value: string; from: ScopeId | "default"; here: boolean } {
  let value = s.def;
  let from: ScopeId | "default" = "default";
  const upto = SCOPE_ORDER.indexOf(at);
  SCOPE_ORDER.forEach((id, i) => {
    if (i > upto) return;
    const v = s.values[id];
    if (v !== undefined) {
      value = v;
      from = id;
    }
  });
  return { value, from, here: s.values[at] !== undefined };
}

// ── 훅 목록(루프 그림·흐름 탭) ────────────────────────────────────
export interface HookRef {
  plugin: Plugin;
  hook: HookDef;
  stage: StageId;
}
export const ALL_HOOKS: HookRef[] = PLUGINS.flatMap((p) =>
  p.hooks.map((hook) => ({ plugin: p, hook, stage: stageOfPoint(hook.point) })),
);
export const hooksAtStage = (s: StageId): HookRef[] => ALL_HOOKS.filter((x) => x.stage === s);

// ── 선택 ─────────────────────────────────────────────────────────
export type Selection =
  | { kind: "cell"; layer: LayerId; stage: StageId }
  | { kind: "stage"; stage: StageId }
  | { kind: "layer"; layer: LayerId }
  | { kind: "hook"; plugin: string; point: string };

export const sameSelection = (a: Selection | null, b: Selection | null): boolean => {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "cell" && b.kind === "cell") return a.layer === b.layer && a.stage === b.stage;
  if (a.kind === "stage" && b.kind === "stage") return a.stage === b.stage;
  if (a.kind === "layer" && b.kind === "layer") return a.layer === b.layer;
  if (a.kind === "hook" && b.kind === "hook") return a.plugin === b.plugin && a.point === b.point;
  return false;
};

// ── 엔진 상태(아래 서랍) ──────────────────────────────────────────
export const LEASE = lease;
export interface Failure {
  plugin: string;
  point: string;
  text: string;
  at: string;
}
export const FAILURES: Failure[] = [
  { plugin: "acme-notes", point: "tool.result", text: "연속 2번 실패", at: "14:03" },
  { plugin: "review", point: "boundary.settle.after", text: "연속 5번 실패해 자동 꺼짐", at: "13:40" },
  { plugin: "helm", point: "boundary.settle.after", text: "한도 1.2초 넘김 1번", at: "14:01" },
];

/** 빌더 맥락과 템플릿(빌더 패널이 읽는다) */
export interface BuilderContext {
  scopeId: ScopeId;
  scopeLabel: string;
  scopeValue: string;
  writeTarget: string;
  unitPath: string[];
  layer: LayerId | null;
  stage: StageId | null;
}
