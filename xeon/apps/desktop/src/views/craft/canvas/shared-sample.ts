// 시안 다섯이 함께 보는 표본(AGE-31). 각 시안의 `sample.ts`는 이 값을 자기 모델 모양으로 바꿀 뿐 값을 따로 두지 않는다.
// 바탕은 AGE-6 공통 브리프의 표본이다. 시안마다 달랐던 값은 다음으로 맞췄다:
//   commit-msg는 도구 실행 앞·대체, test-runner는 턴 종료 직전·막기(cvA·cvB가 기댄 기본값), verifier의 단계는 확인 → 판정,
//   빈 프로필은 베이스 둘만 든다(베이스는 모든 프로필에 든다), 프로필 순서는 베이스 다음 house-style … commit-msg.
// 노드 30개 장면("scale")은 같은 문법의 플러그인 스물을 더한 표본이다. 이름은 식별자라 옮기지 않는다.
import { t } from "@fresnel/client/i18n";

type SharedKind = "inject" | "hook" | "drive" | "tool";
/** Hook이 붙는 곳: 블록 앞·뒤, 또는 턴 종료 직전 경계 */
export type SharedPoint = "model.before" | "tools.before" | "tools.after" | "before-turn-end";
type SharedDecision = "block" | "replace" | "ask";
/** 위험 등급(낮은 것부터). 시안마다 자기 눈금으로 옮긴다 */
export type SharedRisk = "none" | "read" | "write" | "exec";
export type SharedStepId =
  | "diverge"
  | "explore"
  | "apply"
  | "check"
  | "judge"
  | "search"
  | "read"
  | "summarize";

interface SharedStep {
  readonly id: SharedStepId;
  /** 2 이상이면 같은 단계가 나란히 돈다 */
  readonly parallel: number;
  /** 나란한 갈래의 이름(있으면 갈래 수와 같다) */
  readonly lanes?: readonly ("code" | "docs" | "tests")[];
}

interface SharedTool {
  readonly name: string;
  /** 쓰기·실행 도구 */
  readonly writes: boolean;
}

export interface SharedPlugin {
  readonly name: string;
  readonly kind: SharedKind;
  /** Hook만 */
  readonly point?: SharedPoint;
  readonly decision?: SharedDecision;
  readonly guard?: boolean;
  /** 리뷰 대기 중인 드래프트 */
  readonly draft?: boolean;
  /** 코드가 도는가(지침·스킬만 넣는 Inject는 아니다) */
  readonly code: boolean;
  /** 지침 파일 */
  readonly instructions: readonly string[];
  readonly skills: readonly string[];
  readonly memory: readonly string[];
  /** 도구 플러그인의 MCP 서버와 그 도구 */
  readonly mcp?: { readonly server: string; readonly tools: readonly SharedTool[] };
  /** Drive만: 자기 루프 단계와 핸드오프 대상 */
  readonly steps?: readonly SharedStep[];
  readonly handoffTo?: readonly string[];
  readonly settings: readonly { readonly key: string; readonly value: string }[];
  readonly risk: SharedRisk;
  /** 최근 사용(분 전). null이면 쓰인 적 없음 */
  readonly lastUsedMin: number | null;
}

interface SharedGroup {
  readonly id: string;
  readonly members: readonly string[];
}

export type SharedProfileId = "dev" | "empty" | "scale";

export interface SharedProfile {
  readonly id: SharedProfileId;
  /** 모든 프로필에 드는 묶음(앞에 선다) */
  readonly base: readonly string[];
  /** 프로필이 고른 플러그인, 순서대로(베이스 제외) */
  readonly plugins: readonly string[];
  readonly startDrive: string | null;
  readonly groups: readonly SharedGroup[];
}

const GITHUB_TOOLS: readonly SharedTool[] = [
  { name: "issues.list", writes: false },
  { name: "issues.get", writes: false },
  { name: "issues.comment", writes: true },
  { name: "pr.list", writes: false },
  { name: "pr.get", writes: false },
  { name: "pr.diff", writes: false },
  { name: "pr.create", writes: true },
  { name: "pr.merge", writes: true },
  { name: "repo.search", writes: false },
  { name: "repo.read", writes: false },
  { name: "actions.list", writes: false },
  { name: "actions.rerun", writes: true },
];

const NONE = { instructions: [], skills: [], memory: [], settings: [] } as const;

/** 설치된 플러그인 열셋(프로필 "개발"의 열과 프로필 밖의 셋) */
export const SHARED_PLUGINS: readonly SharedPlugin[] = [
  {
    ...NONE,
    name: "house-style",
    kind: "inject",
    code: false,
    instructions: ["house-style.md"],
    risk: "none",
    lastUsedMin: 4,
  },
  {
    ...NONE,
    name: "repo-skills",
    kind: "inject",
    code: false,
    skills: ["api-style", "migrations", "release", "test-writing", "debugging", "code-review"],
    risk: "none",
    lastUsedMin: 38,
  },
  {
    ...NONE,
    name: "memory",
    kind: "inject",
    code: true,
    memory: ["MEMORY.md"],
    settings: [{ key: "scope", value: "project" }],
    risk: "write",
    lastUsedMin: 4,
  },
  {
    ...NONE,
    name: "secret-guard",
    kind: "hook",
    point: "tools.before",
    decision: "block",
    guard: true,
    code: true,
    settings: [{ key: "patterns", value: "14" }],
    risk: "read",
    lastUsedMin: 12,
  },
  {
    ...NONE,
    name: "lint-on-edit",
    kind: "hook",
    point: "tools.after",
    decision: "replace",
    code: true,
    settings: [{ key: "linter", value: "oxlint" }],
    risk: "exec",
    lastUsedMin: 26,
  },
  {
    ...NONE,
    name: "cost-cap",
    kind: "hook",
    point: "model.before",
    decision: "ask",
    code: true,
    settings: [{ key: "limit", value: "$5" }],
    risk: "read",
    lastUsedMin: 190,
  },
  {
    ...NONE,
    name: "helm",
    kind: "drive",
    code: true,
    instructions: ["helm.md"],
    steps: [
      { id: "diverge", parallel: 1 },
      { id: "explore", parallel: 3, lanes: ["code", "docs", "tests"] },
      { id: "apply", parallel: 1 },
    ],
    handoffTo: ["verifier"],
    settings: [
      { key: "explorers", value: "3" },
      { key: "maxRounds", value: "4" },
    ],
    risk: "exec",
    lastUsedMin: 4,
  },
  {
    ...NONE,
    name: "verifier",
    kind: "drive",
    code: true,
    instructions: ["verify.md"],
    steps: [
      { id: "check", parallel: 1 },
      { id: "judge", parallel: 1 },
    ],
    settings: [{ key: "retries", value: "2" }],
    risk: "exec",
    lastUsedMin: 9,
  },
  {
    ...NONE,
    name: "github-mcp",
    kind: "tool",
    code: true,
    mcp: { server: "github", tools: GITHUB_TOOLS },
    settings: [{ key: "transport", value: "stdio" }],
    risk: "write",
    lastUsedMin: 51,
  },
  {
    ...NONE,
    name: "commit-msg",
    kind: "hook",
    point: "tools.before",
    decision: "replace",
    draft: true,
    code: true,
    settings: [{ key: "style", value: "conventional" }],
    risk: "read",
    lastUsedMin: null,
  },
  {
    ...NONE,
    name: "web-research",
    kind: "drive",
    code: true,
    instructions: ["research.md"],
    steps: [
      { id: "search", parallel: 1 },
      { id: "read", parallel: 4 },
      { id: "summarize", parallel: 1 },
    ],
    settings: [{ key: "sources.max", value: "8" }],
    risk: "read",
    lastUsedMin: 2880,
  },
  {
    ...NONE,
    name: "changelog",
    kind: "inject",
    code: false,
    instructions: ["CHANGELOG.md"],
    risk: "none",
    lastUsedMin: null,
  },
  {
    ...NONE,
    name: "test-runner",
    kind: "hook",
    point: "before-turn-end",
    decision: "block",
    code: true,
    settings: [{ key: "command", value: "bun test" }],
    risk: "exec",
    lastUsedMin: null,
  },
];

/** 노드 30개 장면의 플러그인 하나(구성 요소는 비우고 이름·종류·자리만 둔다) */
function scaleOne(
  name: string,
  kind: SharedKind,
  risk: SharedRisk,
  lastUsedMin: number,
  rest: Partial<
    Pick<
      SharedPlugin,
      "point" | "decision" | "instructions" | "skills" | "mcp" | "steps" | "handoffTo"
    >
  >,
): SharedPlugin {
  return {
    name,
    kind,
    code: kind !== "inject",
    instructions: [],
    skills: [],
    memory: [],
    settings: [],
    risk,
    lastUsedMin,
    ...rest,
  };
}

const SCALE_HOOKS: readonly (readonly [string, SharedPoint, SharedDecision])[] = [
  ["pii-mask", "tools.before", "block"],
  ["license-check", "tools.before", "ask"],
  ["format-on-save", "tools.after", "replace"],
  ["bundle-cap", "tools.after", "block"],
  ["budget-alert", "model.before", "ask"],
  ["deploy-gate", "before-turn-end", "ask"],
];

const SCALE_DRIVES: readonly (readonly [string, readonly string[]])[] = [
  ["triage", ["planner"]],
  ["planner", ["refactorer"]],
  ["refactorer", []],
  ["doc-writer", []],
];

const MCP_TOOLS: readonly SharedTool[] = [
  { name: "list", writes: false },
  { name: "get", writes: false },
  { name: "create", writes: true },
];

/** 노드 30개 장면에만 드는 플러그인 스물(같은 문법: Inject 여섯, Hook 여섯, Drive 넷, 도구 넷) */
const SCALE_PLUGINS: readonly SharedPlugin[] = [
  ...["api-docs", "db-schema", "runbooks", "design-notes", "onboarding", "ts-style"].map(
    (name, i) =>
      scaleOne(
        name,
        "inject",
        "none",
        30 + i * 45,
        i % 2 === 0 ? { instructions: [`${name}.md`] } : { skills: [`${name}-a`, `${name}-b`] },
      ),
  ),
  ...SCALE_HOOKS.map(([name, point, decision], i) =>
    scaleOne(name, "hook", "read", 15 + i * 60, { point, decision }),
  ),
  ...SCALE_DRIVES.map(([name, handoffTo], i) =>
    scaleOne(name, "drive", "write", 20 + i * 90, {
      instructions: [`${name}.md`],
      steps: [
        { id: "search", parallel: 1 },
        { id: "apply", parallel: 1 },
      ],
      handoffTo,
    }),
  ),
  ...["jira-mcp", "slack-mcp", "sentry-mcp", "figma-mcp"].map((name, i) =>
    scaleOne(name, "tool", "write", 60 + i * 120, {
      mcp: { server: name.replace("-mcp", ""), tools: MCP_TOOLS },
    }),
  ),
];

const BASE = ["memory", "secret-guard"] as const;
const QUALITY: SharedGroup = { id: "quality", members: ["lint-on-edit", "verifier"] };

export const SHARED_PROFILES: Readonly<Record<SharedProfileId, SharedProfile>> = {
  dev: {
    id: "dev",
    base: BASE,
    plugins: [
      "house-style",
      "repo-skills",
      "lint-on-edit",
      "cost-cap",
      "helm",
      "verifier",
      "github-mcp",
      "commit-msg",
    ],
    startDrive: "helm",
    groups: [QUALITY],
  },
  empty: { id: "empty", base: BASE, plugins: [], startDrive: null, groups: [] },
  scale: {
    id: "scale",
    base: BASE,
    plugins: [
      "house-style",
      "repo-skills",
      "lint-on-edit",
      "cost-cap",
      "helm",
      "verifier",
      "github-mcp",
      "commit-msg",
      ...SCALE_PLUGINS.map((p) => p.name),
    ],
    startDrive: "helm",
    groups: [QUALITY],
  },
};

/** 표본 장면을 고르는 저장 키(찍기 도구가 미리 정한다). 시안마다 처음 여는 프로필이 이것을 따른다 */
const SCENE_KEY = "fresnel.craft.canvasScene";

/** 처음 여는 표본 프로필. 저장된 값이 없으면 "개발"이다 */
export function initialScene(): SharedProfileId {
  // 시험(bun)에는 저장소가 없다
  if (typeof localStorage === "undefined") return "dev";
  const value = localStorage.getItem(SCENE_KEY);
  return value === "empty" || value === "scale" ? value : "dev";
}

export const ALL_SHARED_PLUGINS: readonly SharedPlugin[] = [...SHARED_PLUGINS, ...SCALE_PLUGINS];

/** 최근 사용 한 줄(분 → "n분 전" 등). 쓴 적 없으면 "아직 없음" */
export function agoText(min: number | null): string {
  if (min === null) return t("desktop.craft.canvas.sample.ago.never");
  if (min < 60) return t("desktop.craft.canvas.sample.ago.min", { min });
  if (min < 60 * 24)
    return t("desktop.craft.canvas.sample.ago.hour", { hour: Math.round(min / 60) });
  return t("desktop.craft.canvas.sample.ago.day", { day: Math.round(min / (60 * 24)) });
}
