// cvC 시안(고요한 카드)의 표본. 다섯 시안이 같은 것을 그린다(AGE-6 브리프의 표본 그대로).
// 프로필 "개발"과 빈 프로필 하나, 프로필 밖의 설치된 플러그인 셋, 베이스 둘, 묶음 "품질", 드래프트 `commit-msg`.
// Hook의 자리는 엔진 훅 이름으로 적고 화면이 `BLOCK_MODEL`(contracts)에서 블록과 앞·뒤를 찾는다. 문구는 두지 않는다(화면이 id로 글 키를 찾는다).
import { t } from "@fresnel/client/i18n";

/** 플러그인이 루프에 붙는 방식 셋과 도구 제공 */
export type PluginKind = "inject" | "hook" | "drive" | "tool";

/** Hook이 하는 결정 */
export type Decision = "block" | "replace" | "ask";

/** Inject·도구가 넣는 것 */
export type GiveKind = "instructions" | "skill" | "memory" | "mcp" | "tool";

export interface Give {
  readonly what: GiveKind;
  readonly count: number;
}

/** 내부 구성 요소의 위험 등급 */
export type Risk = "none" | "low" | "mid" | "high";

/** Drive의 단계 하나. `parallel`이 있으면 그 수만큼 나란히 돈다 */
export type StepId =
  | "diverge"
  | "explore"
  | "apply"
  | "check"
  | "judge"
  | "search"
  | "read"
  | "summarize"
  | "code"
  | "docs"
  | "tests";

export interface DriveStep {
  readonly id: StepId;
  readonly parallel?: readonly StepId[];
}

/** 설정 값 하나(키와 보이는 값) */
interface InsideSetting {
  readonly key: string;
  readonly value: string;
}

/** 플러그인 내부의 구성(내부 화면이 그린다) */
interface Inside {
  /** 컨텍스트에 넣는 것의 이름들(지침 파일, 스킬, 메모리) */
  readonly instructions?: readonly string[];
  readonly skills?: readonly string[];
  readonly memory?: readonly string[];
  /** 쓰는 도구 이름 */
  readonly tools?: readonly string[];
  /** MCP 서버와 그 도구 */
  readonly mcp?: { readonly server: string; readonly tools: readonly string[] };
  /** Drive의 자기 루프 */
  readonly steps?: readonly DriveStep[];
  readonly settings?: readonly InsideSetting[];
  readonly risk: Risk;
  /** 권한 항목(파일 쓰기, 셸 등). 키는 글 키의 끝 */
  readonly permissions: readonly PermissionKey[];
}

export type PermissionKey = "read" | "write" | "shell" | "network" | "none";

export interface SamplePlugin {
  readonly name: string;
  readonly kind: PluginKind;
  /** Hook: 엔진 훅 이름. 자리는 `BLOCK_MODEL`에서 찾는다 */
  readonly hook?: string;
  readonly decision?: Decision;
  /** 가드 등급(같은 자리에서 먼저 돈다) */
  readonly guard?: boolean;
  readonly gives?: readonly Give[];
  /** Drive: 핸드오프하는 대상 */
  readonly handoffTo?: readonly string[];
  /** 최근 사용(분 전). 없으면 쓰인 적 없음 */
  readonly lastUsedMin?: number;
  readonly inside: Inside;
}

export interface SampleGroup {
  readonly id: string;
  readonly name: string;
  readonly members: readonly string[];
}

export interface SampleProfile {
  readonly id: string;
  readonly title: string;
  /** 순서가 있다. 베이스는 여기 없고 `BASE`에서 온다 */
  readonly plugins: readonly string[];
  readonly startDrive: string | null;
  /** 승인 전(리뷰 대기)인 플러그인 */
  readonly drafts: readonly string[];
  readonly groups: readonly SampleGroup[];
}

/** 설치된 플러그인 전부(프로필 안팎) */
export const CATALOG: readonly SamplePlugin[] = [
  {
    name: "house-style",
    kind: "inject",
    gives: [{ what: "instructions", count: 1 }],
    lastUsedMin: 4,
    inside: { instructions: ["STYLE.md"], risk: "none", permissions: ["none"] },
  },
  {
    name: "repo-skills",
    kind: "inject",
    gives: [{ what: "skill", count: 6 }],
    lastUsedMin: 18,
    inside: {
      skills: ["build", "test", "release", "migrate", "review", "deploy-check"],
      risk: "none",
      permissions: ["none"],
    },
  },
  {
    name: "memory",
    kind: "inject",
    gives: [{ what: "memory", count: 1 }],
    lastUsedMin: 4,
    inside: {
      memory: ["project.md"],
      settings: [{ key: "scope", value: "project" }],
      risk: "low",
      permissions: ["read", "write"],
    },
  },
  {
    name: "secret-guard",
    kind: "hook",
    hook: "guard.tool.before",
    decision: "block",
    guard: true,
    lastUsedMin: 9,
    inside: {
      settings: [
        { key: "patterns", value: "12" },
        { key: "mask", value: "on" },
      ],
      risk: "low",
      permissions: ["read"],
    },
  },
  {
    name: "lint-on-edit",
    kind: "hook",
    hook: "tool.result",
    decision: "replace",
    lastUsedMin: 9,
    inside: {
      tools: ["oxlint"],
      settings: [{ key: "fix", value: "safe" }],
      risk: "mid",
      permissions: ["read", "shell"],
    },
  },
  {
    name: "cost-cap",
    kind: "hook",
    hook: "request.provider.before",
    decision: "ask",
    lastUsedMin: 52,
    inside: {
      settings: [
        { key: "limit", value: "$5 / day" },
        { key: "warnAt", value: "80%" },
      ],
      risk: "none",
      permissions: ["none"],
    },
  },
  {
    name: "helm",
    kind: "drive",
    handoffTo: ["verifier"],
    lastUsedMin: 4,
    inside: {
      instructions: ["helm.md"],
      skills: ["plan", "explore"],
      tools: ["read", "edit", "bash"],
      steps: [
        { id: "diverge" },
        { id: "explore", parallel: ["code", "docs", "tests"] },
        { id: "apply" },
      ],
      settings: [
        { key: "explorers", value: "3" },
        { key: "maxRounds", value: "4" },
      ],
      risk: "high",
      permissions: ["read", "write", "shell"],
    },
  },
  {
    name: "verifier",
    kind: "drive",
    lastUsedMin: 31,
    inside: {
      instructions: ["verify.md"],
      tools: ["read", "bash"],
      steps: [{ id: "check" }, { id: "judge" }],
      settings: [{ key: "retries", value: "2" }],
      risk: "mid",
      permissions: ["read", "shell"],
    },
  },
  {
    name: "github-mcp",
    kind: "tool",
    gives: [
      { what: "mcp", count: 1 },
      { what: "tool", count: 12 },
    ],
    lastUsedMin: 26,
    inside: {
      mcp: {
        server: "github",
        tools: [
          "issues.list",
          "issues.get",
          "issues.create",
          "pulls.list",
          "pulls.get",
          "pulls.create",
          "pulls.review",
          "repos.get",
          "repos.search",
          "files.get",
          "commits.list",
          "actions.runs",
        ],
      },
      risk: "mid",
      permissions: ["network", "write"],
    },
  },
  {
    name: "commit-msg",
    kind: "hook",
    hook: "tool.call.before",
    decision: "ask",
    inside: {
      settings: [{ key: "style", value: "conventional" }],
      risk: "low",
      permissions: ["read"],
    },
  },
  {
    name: "web-research",
    kind: "drive",
    inside: {
      instructions: ["research.md"],
      tools: ["web.search", "web.fetch"],
      steps: [{ id: "search" }, { id: "read" }, { id: "summarize" }],
      risk: "mid",
      permissions: ["network"],
    },
  },
  {
    name: "changelog",
    kind: "inject",
    gives: [{ what: "instructions", count: 1 }],
    inside: { instructions: ["CHANGELOG.md"], risk: "none", permissions: ["none"] },
  },
  {
    name: "test-runner",
    kind: "hook",
    hook: "boundary.settle.before",
    decision: "ask",
    inside: {
      tools: ["bun test"],
      settings: [{ key: "scope", value: "changed" }],
      risk: "mid",
      permissions: ["read", "shell"],
    },
  },
];

/** 모든 프로필에 드는 묶음 */
export const BASE: readonly string[] = ["memory", "secret-guard"];

/** 표본 프로필: "개발"과 빈 프로필. 이름은 화면 언어를 따르므로 부를 때 만든다 */
export function sampleProfiles(): readonly SampleProfile[] {
  const quality: SampleGroup = {
    id: "quality",
    name: t("desktop.craft.canvas.cvC.sample.quality"),
    members: ["lint-on-edit", "verifier"],
  };
  return [
    {
      id: "dev",
      title: t("desktop.craft.canvas.cvC.sample.dev"),
      plugins: [
        "helm",
        "verifier",
        "house-style",
        "repo-skills",
        "cost-cap",
        "commit-msg",
        "github-mcp",
        "lint-on-edit",
      ],
      startDrive: "helm",
      drafts: ["commit-msg"],
      groups: [quality],
    },
    {
      id: "blank",
      title: t("desktop.craft.canvas.cvC.sample.blank"),
      plugins: [],
      startDrive: null,
      drafts: [],
      groups: [],
    },
  ];
}

export function pluginOf(name: string): SamplePlugin | undefined {
  return CATALOG.find((p) => p.name === name);
}
