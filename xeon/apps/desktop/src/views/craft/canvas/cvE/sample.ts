// 다섯 시안이 함께 그리는 표본(AGE-6 브리프 그대로). 프로필 "개발"과 설치된 플러그인 열둘.
// 이름은 식별자라 옮기지 않는다. 사람이 읽는 말은 message id 꼬리(`desktop.craft.canvas.cvE.sample.*`)로 둔다.
import type { Defs, ProfileModel } from "./model.ts";

export const SAMPLE_DEFS: Defs = {
  "house-style": {
    id: "house-style",
    kind: "inject",
    gives: { what: "instruction", count: 1 },
    usedMin: 1,
    parts: [
      { kind: "instruction", key: "houseRules" },
      { kind: "permission", risk: 0 },
    ],
  },
  "repo-skills": {
    id: "repo-skills",
    kind: "inject",
    gives: { what: "skill", count: 6 },
    usedMin: 12,
    parts: [
      { kind: "skill", key: "skillTests" },
      { kind: "skill", key: "skillRelease" },
      { kind: "skill", key: "skillMigrate" },
      { kind: "skill", key: "skillReview" },
      { kind: "skill", key: "skillBench" },
      { kind: "skill", key: "skillDocs" },
      { kind: "permission", risk: 0 },
    ],
  },
  memory: {
    id: "memory",
    kind: "inject",
    gives: { what: "memory", count: 1 },
    usedMin: 3,
    parts: [
      { kind: "memory", key: "memoryStore" },
      { kind: "tool", key: "memoryTools", count: 2 },
      { kind: "setting", key: "memoryScope" },
      { kind: "permission", risk: 1 },
    ],
  },
  "secret-guard": {
    id: "secret-guard",
    kind: "hook",
    point: "tools.before",
    decision: "block",
    guard: true,
    usedMin: 2,
    parts: [
      { kind: "handler", key: "scanCall", point: "tools.before", decision: "block" },
      { kind: "setting", key: "patterns", count: 14 },
      { kind: "permission", risk: 3 },
    ],
  },
  "lint-on-edit": {
    id: "lint-on-edit",
    kind: "hook",
    point: "tools.after",
    decision: "replace",
    usedMin: 6,
    parts: [
      { kind: "handler", key: "fixResult", point: "tools.after", decision: "replace" },
      { kind: "setting", key: "linter" },
      { kind: "permission", risk: 2 },
    ],
  },
  "cost-cap": {
    id: "cost-cap",
    kind: "hook",
    point: "model.before",
    decision: "ask",
    usedMin: 40,
    parts: [
      { kind: "handler", key: "askOverCap", point: "model.before", decision: "ask" },
      { kind: "setting", key: "cap" },
      { kind: "permission", risk: 1 },
    ],
  },
  helm: {
    id: "helm",
    kind: "drive",
    stages: [{ key: "diverge" }, { key: "explore", parallel: 3 }, { key: "apply" }],
    handoff: ["verifier"],
    usedMin: 2,
    parts: [
      { kind: "instruction", key: "stageGuide" },
      { kind: "tool", key: "planTool", count: 1 },
      { kind: "setting", key: "explorers" },
      { kind: "permission", risk: 2 },
    ],
  },
  verifier: {
    id: "verifier",
    kind: "drive",
    stages: [{ key: "check" }, { key: "judge" }],
    usedMin: 9,
    parts: [
      { kind: "instruction", key: "verifyGuide" },
      { kind: "setting", key: "rounds" },
      { kind: "permission", risk: 1 },
    ],
  },
  "github-mcp": {
    id: "github-mcp",
    kind: "tool",
    gives: { what: "tool", count: 12 },
    usedMin: 5,
    parts: [
      { kind: "mcp", raw: "github", count: 1 },
      { kind: "tool", key: "githubTools", count: 12 },
      { kind: "setting", key: "token" },
      { kind: "permission", risk: 2 },
    ],
  },
  "commit-msg": {
    id: "commit-msg",
    kind: "hook",
    point: "tools.before",
    decision: "block",
    draft: true,
    parts: [
      { kind: "handler", key: "checkMessage", point: "tools.before", decision: "block" },
      { kind: "setting", key: "convention" },
      { kind: "permission", risk: 1 },
    ],
  },
  "web-research": {
    id: "web-research",
    kind: "drive",
    stages: [{ key: "search" }, { key: "read", parallel: 2 }, { key: "summarize" }],
    parts: [
      { kind: "instruction", key: "researchGuide" },
      { kind: "permission", risk: 1 },
    ],
  },
  changelog: {
    id: "changelog",
    kind: "inject",
    gives: { what: "instruction", count: 1 },
    parts: [
      { kind: "instruction", key: "changelogRules" },
      { kind: "permission", risk: 0 },
    ],
  },
  "test-runner": {
    id: "test-runner",
    kind: "hook",
    point: "tools.after",
    decision: "replace",
    parts: [
      { kind: "handler", key: "runTests", point: "tools.after", decision: "replace" },
      { kind: "permission", risk: 2 },
    ],
  },
};

/** 왼쪽 목록의 순서(설치된 플러그인 전부) */
export const SAMPLE_INSTALLED: readonly string[] = [
  "helm",
  "verifier",
  "web-research",
  "house-style",
  "repo-skills",
  "memory",
  "changelog",
  "secret-guard",
  "lint-on-edit",
  "cost-cap",
  "test-runner",
  "commit-msg",
  "github-mcp",
];

export const SAMPLE_PROFILE: ProfileModel = {
  id: "dev",
  title: "dev",
  sample: true,
  entries: [
    { id: "helm", base: false },
    { id: "verifier", base: false },
    { id: "house-style", base: false },
    { id: "repo-skills", base: false },
    { id: "memory", base: true },
    { id: "secret-guard", base: true },
    { id: "lint-on-edit", base: false },
    { id: "cost-cap", base: false },
    { id: "github-mcp", base: false },
    { id: "commit-msg", base: false },
  ],
  startDrive: "helm",
  groups: [{ id: "quality", key: "quality", members: ["lint-on-edit", "verifier"] }],
};

/** 빈 프로필(스크린샷과 시작 상태) */
export const EMPTY_PROFILE: ProfileModel = {
  id: "empty",
  title: "empty",
  sample: true,
  entries: [],
  startDrive: null,
  groups: [],
};
