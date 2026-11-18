// cvD 표본(트랙 브리프의 표본 그대로). 다섯 시안이 같은 프로필 "개발"을 그린다.
// 플러그인 이름과 스킬·도구 이름은 코드 이름이라 그대로 두고, 사람이 읽는 말은 message id로 적는다.
import type { MessageId } from "@fresnel/client/i18n";

/** 플러그인이 코어 턴에 붙는 방식. 도구는 Inject의 한 갈래지만 캔버스에서는 따로 읽힌다 */
export type Kind = "inject" | "hook" | "drive" | "tool";

/** 엔진 블록 여섯(`blocks.describe`)과 경계 셋. 값은 `@fresnel/contracts/blocks`의 BLOCK_MODEL과 같다 */
export type BlockId = "context" | "model" | "tools" | "ask" | "agents" | "record";
export type BoundaryId = "conversation-start" | "input-received" | "before-turn-end";

/**
 * 플러그인이 붙는 자리 하나.
 * `before:`/`after:`는 블록 앞·뒤의 Hook 자리, `boundary:`는 경계의 Hook 자리,
 * `feed:`는 블록에 들어가는 재료(Inject는 컨텍스트 조립, 도구는 도구 실행), `drive`는 턴을 쥐는 자리다.
 */
export type PointKey =
  | `before:${BlockId}`
  | `after:${BlockId}`
  | `boundary:${BoundaryId}`
  | "feed:context"
  | "feed:tools"
  | "drive";

/** Hook이 하는 결정 */
export type Decision = "block" | "replace" | "ask";

export type Risk = "low" | "medium" | "high";

/** 플러그인 내부의 구성 요소. 내부 화면이 이것을 노드로 그린다 */
export type Part =
  | {
      readonly kind: "instruction";
      readonly id: string;
      readonly title: MessageId;
      readonly lines: number;
    }
  | { readonly kind: "skill"; readonly id: string; readonly name: string }
  | { readonly kind: "memory"; readonly id: string; readonly scope: MessageId }
  | {
      readonly kind: "mcp";
      readonly id: string;
      readonly name: string;
      readonly tools: readonly SampleTool[];
    }
  | {
      readonly kind: "handler";
      readonly id: string;
      readonly point: PointKey;
      readonly decision: Decision;
      readonly guard: boolean;
      /** 결정 갈래. 첫째가 그냥 지나가는 길이다 */
      readonly outcomes: readonly MessageId[];
    }
  | {
      readonly kind: "stage";
      readonly id: string;
      readonly label: MessageId;
      readonly parallel: number;
    }
  | { readonly kind: "handoff"; readonly id: string; readonly to: string }
  | { readonly kind: "setting"; readonly id: string; readonly key: string; readonly value: string }
  | {
      readonly kind: "permission";
      readonly id: string;
      readonly risk: Risk;
      readonly scope: MessageId;
    };

interface SampleTool {
  readonly name: string;
  /** 쓰기·실행이면 참(위험 표식) */
  readonly writes: boolean;
}

export interface SamplePlugin {
  readonly id: string;
  readonly kind: Kind;
  /** 플러그인이 선언한 자리. 끌어 놓을 때 이 자리만 열린다 */
  readonly points: readonly PointKey[];
  readonly decision?: Decision;
  /** Hook의 가드 등급(같은 자리에서 프로필 순서보다 먼저 돈다) */
  readonly guard?: boolean;
  /** 리뷰 대기 중인 드래프트 */
  readonly draft?: boolean;
  /** Drive가 핸드오프하는 상대 */
  readonly handoff?: readonly string[];
  /** 노드를 펼치면 보이는 한 줄 */
  readonly recent: MessageId;
  readonly parts: readonly Part[];
}

export interface SampleGroup {
  readonly id: string;
  readonly name: MessageId;
  readonly members: readonly string[];
}

export interface ProfileEntry {
  readonly plugin: string;
  /** 베이스에서 왔으면 base. 베이스는 모든 프로필에 든다 */
  readonly origin: "profile" | "base";
}

export interface SampleProfile {
  readonly id: string;
  readonly name: MessageId;
  readonly startDrive: string | null;
  /** 순서가 있다. 같은 자리에 여럿이면 이 순서가 호출 순서다(가드 등급이 먼저) */
  readonly entries: readonly ProfileEntry[];
  readonly groups: readonly SampleGroup[];
}

const M = "desktop.craft.canvas.cvD.sample";

export const SAMPLE_PLUGINS: readonly SamplePlugin[] = [
  {
    id: "helm",
    kind: "drive",
    points: ["drive"],
    handoff: ["verifier"],
    recent: `${M}.recent.helm`,
    parts: [
      { kind: "stage", id: "diverge", label: `${M}.stage.diverge`, parallel: 1 },
      { kind: "stage", id: "explore", label: `${M}.stage.explore`, parallel: 3 },
      { kind: "stage", id: "apply", label: `${M}.stage.apply`, parallel: 1 },
      { kind: "handoff", id: "to-verifier", to: "verifier" },
      { kind: "instruction", id: "stage-rules", title: `${M}.doc.stageRules`, lines: 64 },
      { kind: "setting", id: "explorers", key: "explorers", value: "3" },
      { kind: "setting", id: "rounds", key: "maxRounds", value: "4" },
      { kind: "permission", id: "perm", risk: "medium", scope: `${M}.perm.writeFiles` },
    ],
  },
  {
    id: "verifier",
    kind: "drive",
    points: ["drive"],
    recent: `${M}.recent.verifier`,
    parts: [
      { kind: "stage", id: "check", label: `${M}.stage.check`, parallel: 1 },
      { kind: "stage", id: "judge", label: `${M}.stage.judge`, parallel: 1 },
      { kind: "setting", id: "strict", key: "strict", value: "true" },
      { kind: "permission", id: "perm", risk: "low", scope: `${M}.perm.readOnly` },
    ],
  },
  {
    id: "house-style",
    kind: "inject",
    points: ["feed:context"],
    recent: `${M}.recent.always`,
    parts: [
      { kind: "instruction", id: "style", title: `${M}.doc.houseStyle`, lines: 42 },
      { kind: "permission", id: "perm", risk: "low", scope: `${M}.perm.none` },
    ],
  },
  {
    id: "repo-skills",
    kind: "inject",
    points: ["feed:context"],
    recent: `${M}.recent.repoSkills`,
    parts: [
      { kind: "skill", id: "write-tests", name: "write-tests" },
      { kind: "skill", id: "migrate-db", name: "migrate-db" },
      { kind: "skill", id: "review-pr", name: "review-pr" },
      { kind: "skill", id: "release-notes", name: "release-notes" },
      { kind: "skill", id: "bisect", name: "bisect" },
      { kind: "skill", id: "profile-perf", name: "profile-perf" },
      { kind: "permission", id: "perm", risk: "low", scope: `${M}.perm.none` },
    ],
  },
  {
    id: "memory",
    kind: "inject",
    points: ["feed:context"],
    recent: `${M}.recent.always`,
    parts: [
      { kind: "memory", id: "user", scope: `${M}.memory.user` },
      { kind: "memory", id: "project", scope: `${M}.memory.project` },
      { kind: "setting", id: "limit", key: "userLimitChars", value: "4000" },
      { kind: "permission", id: "perm", risk: "low", scope: `${M}.perm.memory` },
    ],
  },
  {
    id: "secret-guard",
    kind: "hook",
    points: ["before:tools"],
    decision: "block",
    guard: true,
    recent: `${M}.recent.secretGuard`,
    parts: [
      {
        kind: "handler",
        id: "scan",
        point: "before:tools",
        decision: "block",
        guard: true,
        outcomes: [`${M}.outcome.pass`, `${M}.outcome.block`],
      },
      { kind: "setting", id: "patterns", key: "patterns", value: "14" },
      { kind: "permission", id: "perm", risk: "low", scope: `${M}.perm.readOnly` },
    ],
  },
  {
    id: "lint-on-edit",
    kind: "hook",
    points: ["after:tools"],
    decision: "replace",
    recent: `${M}.recent.lintOnEdit`,
    parts: [
      {
        kind: "handler",
        id: "lint",
        point: "after:tools",
        decision: "replace",
        guard: false,
        outcomes: [`${M}.outcome.pass`, `${M}.outcome.replace`],
      },
      { kind: "setting", id: "linter", key: "linter", value: "oxlint" },
      { kind: "permission", id: "perm", risk: "medium", scope: `${M}.perm.writeFiles` },
    ],
  },
  {
    id: "cost-cap",
    kind: "hook",
    points: ["before:model"],
    decision: "ask",
    recent: `${M}.recent.costCap`,
    parts: [
      {
        kind: "handler",
        id: "cap",
        point: "before:model",
        decision: "ask",
        guard: false,
        outcomes: [`${M}.outcome.pass`, `${M}.outcome.ask`],
      },
      { kind: "setting", id: "limit", key: "turnLimitUsd", value: "2.00" },
      { kind: "permission", id: "perm", risk: "low", scope: `${M}.perm.none` },
    ],
  },
  {
    id: "github-mcp",
    kind: "tool",
    points: ["feed:tools"],
    recent: `${M}.recent.github`,
    parts: [
      {
        kind: "mcp",
        id: "server",
        name: "github",
        tools: [
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
        ],
      },
      { kind: "setting", id: "transport", key: "transport", value: "stdio" },
      { kind: "permission", id: "perm", risk: "high", scope: `${M}.perm.network` },
    ],
  },
  {
    id: "commit-msg",
    kind: "hook",
    points: ["before:tools"],
    decision: "block",
    draft: true,
    recent: `${M}.recent.never`,
    parts: [
      {
        kind: "handler",
        id: "check",
        point: "before:tools",
        decision: "block",
        guard: false,
        outcomes: [`${M}.outcome.pass`, `${M}.outcome.block`],
      },
      { kind: "setting", id: "style", key: "style", value: "conventional" },
      { kind: "permission", id: "perm", risk: "low", scope: `${M}.perm.readOnly` },
    ],
  },
  {
    id: "web-research",
    kind: "drive",
    points: ["drive"],
    recent: `${M}.recent.never`,
    parts: [
      { kind: "stage", id: "search", label: `${M}.stage.search`, parallel: 1 },
      { kind: "stage", id: "read", label: `${M}.stage.read`, parallel: 4 },
      { kind: "stage", id: "summarize", label: `${M}.stage.summarize`, parallel: 1 },
      { kind: "permission", id: "perm", risk: "medium", scope: `${M}.perm.network` },
    ],
  },
  {
    id: "changelog",
    kind: "inject",
    points: ["feed:context"],
    recent: `${M}.recent.never`,
    parts: [
      { kind: "instruction", id: "format", title: `${M}.doc.changelog`, lines: 18 },
      { kind: "permission", id: "perm", risk: "low", scope: `${M}.perm.none` },
    ],
  },
  {
    id: "test-runner",
    kind: "hook",
    points: ["boundary:before-turn-end"],
    decision: "ask",
    recent: `${M}.recent.never`,
    parts: [
      {
        kind: "handler",
        id: "run",
        point: "boundary:before-turn-end",
        decision: "ask",
        guard: false,
        outcomes: [`${M}.outcome.pass`, `${M}.outcome.ask`],
      },
      { kind: "setting", id: "command", key: "command", value: "bun test" },
      { kind: "permission", id: "perm", risk: "medium", scope: `${M}.perm.runCommands` },
    ],
  },
];

/** 베이스 묶음: 모든 프로필에 든다(`profile.common.get`) */
export const SAMPLE_BASE: readonly string[] = ["memory", "secret-guard"];

export const SAMPLE_PROFILES: readonly SampleProfile[] = [
  {
    id: "dev",
    name: `${M}.profile.dev`,
    startDrive: "helm",
    entries: [
      { plugin: "memory", origin: "base" },
      { plugin: "secret-guard", origin: "base" },
      { plugin: "helm", origin: "profile" },
      { plugin: "verifier", origin: "profile" },
      { plugin: "house-style", origin: "profile" },
      { plugin: "repo-skills", origin: "profile" },
      { plugin: "cost-cap", origin: "profile" },
      { plugin: "commit-msg", origin: "profile" },
      { plugin: "github-mcp", origin: "profile" },
      { plugin: "lint-on-edit", origin: "profile" },
    ],
    groups: [{ id: "quality", name: `${M}.group.quality`, members: ["lint-on-edit", "verifier"] }],
  },
  {
    id: "blank",
    name: `${M}.profile.blank`,
    startDrive: null,
    entries: [
      { plugin: "memory", origin: "base" },
      { plugin: "secret-guard", origin: "base" },
    ],
    groups: [],
  },
];

export function pluginById(id: string): SamplePlugin | undefined {
  return SAMPLE_PLUGINS.find((p) => p.id === id);
}
