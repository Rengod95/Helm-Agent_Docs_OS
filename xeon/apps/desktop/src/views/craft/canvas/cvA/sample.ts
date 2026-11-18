// cvA(HUD) 시안의 표본. 다섯 시안이 같은 것을 그린다(트랙 브리프의 표본 그대로).
// 프로필 "개발"과 설치된 플러그인 열넷. 플러그인 이름과 스킬·도구 이름은 식별자라 번역하지 않는다. 사람이 읽는 말은 words.ts가 키로 찾는다.
import type { PluginSpec, ProfileModel } from "./model.ts";

/** 설치된 플러그인 전부(왼쪽 목록에 놓이는 순서) */
export const SAMPLE_PLUGINS: readonly PluginSpec[] = [
  {
    name: "house-style",
    kind: "inject",
    holds: [{ unit: "instruction", count: 1 }],
    lastUsedMin: 2,
    inside: {
      code: false,
      parts: [{ id: "house-style.md", unit: "instruction", label: "house-style.md" }],
      settings: [],
      grants: [],
    },
  },
  {
    name: "repo-skills",
    kind: "inject",
    holds: [{ unit: "skill", count: 6 }],
    lastUsedMin: 38,
    inside: {
      code: false,
      parts: [
        { id: "api-style", unit: "skill", label: "api-style" },
        { id: "migrations", unit: "skill", label: "migrations" },
        { id: "release", unit: "skill", label: "release" },
        { id: "test-writing", unit: "skill", label: "test-writing" },
        { id: "debugging", unit: "skill", label: "debugging" },
        { id: "code-review", unit: "skill", label: "code-review" },
      ],
      settings: [{ key: "skills.load", value: "onDemand" }],
      grants: [],
    },
  },
  {
    name: "memory",
    kind: "inject",
    holds: [{ unit: "memory", count: 1 }],
    lastUsedMin: 2,
    inside: {
      code: true,
      parts: [{ id: "memory.md", unit: "memory", label: "MEMORY.md" }],
      settings: [{ key: "memory.maxLines", value: "200" }],
      grants: [{ id: "memoryWrite", risk: "write" }],
    },
  },
  {
    name: "secret-guard",
    kind: "hook",
    port: "tools.before",
    decision: "block",
    guard: true,
    holds: [],
    lastUsedMin: 2,
    inside: {
      code: true,
      parts: [],
      handler: { port: "tools.before", decision: "block" },
      settings: [{ key: "patterns", value: "24" }],
      grants: [{ id: "fileRead", risk: "read" }],
    },
  },
  {
    name: "lint-on-edit",
    kind: "hook",
    port: "tools.after",
    decision: "replace",
    holds: [],
    lastUsedMin: 9,
    inside: {
      code: true,
      parts: [],
      handler: { port: "tools.after", decision: "replace" },
      settings: [{ key: "linter", value: "oxlint" }],
      grants: [
        { id: "fileRead", risk: "read" },
        { id: "commandRun", risk: "exec" },
      ],
    },
  },
  {
    name: "cost-cap",
    kind: "hook",
    port: "model.before",
    decision: "ask",
    holds: [],
    lastUsedMin: 160,
    inside: {
      code: true,
      parts: [],
      handler: { port: "model.before", decision: "ask" },
      settings: [{ key: "limit", value: "$2" }],
      grants: [],
    },
  },
  {
    name: "helm",
    kind: "drive",
    handoffTo: ["verifier"],
    holds: [],
    lastUsedMin: 2,
    inside: {
      code: true,
      parts: [{ id: "helm.md", unit: "instruction", label: "helm.md" }],
      steps: [
        { id: "diverge", step: "diverge", lanes: 1 },
        { id: "explore", step: "explore", lanes: 3 },
        { id: "apply", step: "apply", lanes: 1 },
      ],
      handoff: ["verifier"],
      settings: [
        { key: "explore.count", value: "3" },
        { key: "apply.confirm", value: "ask" },
      ],
      grants: [
        { id: "fileRead", risk: "read" },
        { id: "fileWrite", risk: "write" },
        { id: "childThread", risk: "write" },
      ],
    },
  },
  {
    name: "verifier",
    kind: "drive",
    holds: [],
    lastUsedMin: 41,
    inside: {
      code: true,
      parts: [{ id: "verifier.md", unit: "instruction", label: "verifier.md" }],
      steps: [
        { id: "check", step: "check", lanes: 1 },
        { id: "report", step: "report", lanes: 1 },
      ],
      receives: true,
      settings: [{ key: "retry", value: "1" }],
      grants: [
        { id: "fileRead", risk: "read" },
        { id: "commandRun", risk: "exec" },
      ],
    },
  },
  {
    name: "github-mcp",
    kind: "tool",
    holds: [
      { unit: "server", count: 1 },
      { unit: "tool", count: 12 },
    ],
    lastUsedMin: 75,
    inside: {
      code: true,
      parts: [
        { id: "github", unit: "server", label: "github" },
        { id: "create_pr", unit: "tool", label: "create_pr" },
        { id: "list_prs", unit: "tool", label: "list_prs" },
        { id: "get_pr", unit: "tool", label: "get_pr" },
        { id: "merge_pr", unit: "tool", label: "merge_pr" },
        { id: "list_issues", unit: "tool", label: "list_issues" },
        { id: "get_issue", unit: "tool", label: "get_issue" },
        { id: "create_issue", unit: "tool", label: "create_issue" },
        { id: "comment", unit: "tool", label: "comment" },
        { id: "search_code", unit: "tool", label: "search_code" },
        { id: "get_file", unit: "tool", label: "get_file" },
        { id: "list_runs", unit: "tool", label: "list_runs" },
        { id: "get_run_log", unit: "tool", label: "get_run_log" },
      ],
      settings: [{ key: "server.command", value: "github-mcp-server" }],
      grants: [
        { id: "network", risk: "read" },
        { id: "repoWrite", risk: "write" },
      ],
    },
  },
  {
    name: "commit-msg",
    kind: "hook",
    port: "tools.before",
    decision: "replace",
    draft: true,
    holds: [],
    lastUsedMin: null,
    inside: {
      code: true,
      parts: [],
      handler: { port: "tools.before", decision: "replace" },
      settings: [{ key: "style", value: "conventional" }],
      grants: [{ id: "fileRead", risk: "read" }],
    },
  },
  {
    name: "web-research",
    kind: "drive",
    holds: [],
    lastUsedMin: 4320,
    inside: {
      code: true,
      parts: [],
      steps: [
        { id: "search", step: "search", lanes: 1 },
        { id: "read", step: "read", lanes: 4 },
        { id: "summarize", step: "summarize", lanes: 1 },
      ],
      settings: [{ key: "sources.max", value: "8" }],
      grants: [{ id: "network", risk: "read" }],
    },
  },
  {
    name: "changelog",
    kind: "inject",
    holds: [{ unit: "instruction", count: 1 }],
    lastUsedMin: null,
    inside: {
      code: false,
      parts: [{ id: "changelog.md", unit: "instruction", label: "changelog.md" }],
      settings: [],
      grants: [],
    },
  },
  {
    name: "test-runner",
    kind: "hook",
    port: "before-turn-end",
    decision: "block",
    holds: [],
    lastUsedMin: 1440,
    inside: {
      code: true,
      parts: [],
      handler: { port: "before-turn-end", decision: "block" },
      settings: [{ key: "command", value: "bun test" }],
      grants: [{ id: "commandRun", risk: "exec" }],
    },
  },
];

/** 프로필 "개발". 베이스(모든 프로필에 드는 묶음)는 memory와 secret-guard다 */
export const SAMPLE_PROFILE: ProfileModel = {
  id: "sample/dev",
  base: ["memory", "secret-guard"],
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
  groups: [{ id: "quality", name: "quality", members: ["lint-on-edit", "verifier"] }],
};

/** 빈 프로필(베이스만 든다). 빈 상태를 보이려고 둔다 */
export const EMPTY_PROFILE: ProfileModel = {
  id: "sample/empty",
  base: [],
  plugins: [],
  startDrive: null,
  groups: [],
};
