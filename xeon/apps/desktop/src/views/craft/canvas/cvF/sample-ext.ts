// cvF가 공통 표본(`../shared-sample.ts`)에 덧붙이는 값. 이름은 계약의 것을 따른다:
// 카드(`PluginCard`의 purpose·origin·review·enforcement·runs·cost·health), 매니페스트(`version`, 플러그인 선언의 requires·provides·replaces),
// 카드의 Hook 칸(`CardHook`의 name·fold·powers). 공통 표본에 없는 값만 여기에 두고, 화면에 보이는 사람의 말은 message id다.
// 해시와 날짜는 표본 값이다(실제 리뷰 기록이 아니다).
import type { MessageId } from "@fresnel/client/i18n";
import type { Fold, HookPower, PluginCard } from "@fresnel/contracts/extensions";

/** 카드의 Hook 칸 한 줄(`CardHook`에서 위치를 뺀 것. 위치는 공통 표본의 자리가 이미 말한다) */
interface SampleCardHook {
  readonly name: string;
  readonly fold: Fold;
  readonly powers: readonly HookPower[];
}

export interface PluginExt {
  /** 카드의 `purpose`(목적 한 문장) */
  readonly purpose: MessageId;
  /** 매니페스트 `version` */
  readonly version: string;
  readonly origin: PluginCard["origin"];
  readonly review: PluginCard["review"];
  readonly enforcement: PluginCard["enforcement"];
  readonly isolated: boolean | null;
  readonly cost: PluginCard["cost"];
  readonly health: PluginCard["health"]["state"];
  /** 플러그인 선언 `requires`·`provides`의 capability id */
  readonly requires: readonly string[];
  readonly provides: readonly string[];
  /** 플러그인 선언 `replaces`: 같은 이름으로 바꿔 놓는 내장 도구 */
  readonly replaces: readonly string[];
  readonly hooks: readonly SampleCardHook[];
}

const APPROVED = (hash: string, approvedAt: string): PluginCard["review"] => ({
  state: "approved",
  currentHash: `sha256:${hash}`,
  pendingItemId: null,
  approvedAt,
});

const COST = (
  always: number | null,
  onDemand: number | null,
  toolCount: number | null,
  drive: number | null = null,
): PluginCard["cost"] => ({ always, drive, onDemand, toolCount, basis: "declared" });

interface ExtSeed {
  readonly purpose: MessageId;
  readonly version: string;
  readonly origin?: PluginCard["origin"]["kind"];
  readonly createdIn?: string;
  readonly review?: PluginCard["review"];
  readonly enforcement?: PluginCard["enforcement"];
  readonly isolated?: boolean | null;
  readonly cost?: PluginCard["cost"];
  readonly health?: PluginCard["health"]["state"];
  readonly requires?: readonly string[];
  readonly provides?: readonly string[];
  readonly replaces?: readonly string[];
  readonly hooks?: readonly SampleCardHook[];
}

function ext(seed: ExtSeed): PluginExt {
  return {
    purpose: seed.purpose,
    version: seed.version,
    origin:
      seed.createdIn === undefined
        ? { kind: seed.origin ?? "user" }
        : { kind: seed.origin ?? "user", createdIn: { threadId: seed.createdIn } },
    review: seed.review ?? APPROVED("5c1e09d2a4b7f3e8", "2026-11-12T09:20:00Z"),
    enforcement: seed.enforcement ?? "advisory",
    isolated: seed.isolated ?? null,
    cost: seed.cost ?? COST(null, null, null),
    health: seed.health ?? "ok",
    requires: seed.requires ?? [],
    provides: seed.provides ?? [],
    replaces: seed.replaces ?? [],
    hooks: seed.hooks ?? [],
  };
}

const EXT: Readonly<Record<string, PluginExt>> = {
  "house-style": ext({
    purpose: "desktop.craft.canvas.cvF.purpose.houseStyle",
    version: "1.2.0",
    review: APPROVED("3f9a1c7e20b4d815", "2026-11-03T08:12:00Z"),
    cost: COST(820, 0, 0),
  }),
  "repo-skills": ext({
    purpose: "desktop.craft.canvas.cvF.purpose.repoSkills",
    version: "0.9.3",
    origin: "project",
    review: APPROVED("a07d44e19c3b2f60", "2026-11-10T14:40:00Z"),
    cost: COST(140, 5200, 0),
  }),
  memory: ext({
    purpose: "desktop.craft.canvas.cvF.purpose.memory",
    version: "2.0.1",
    origin: "bundled",
    review: APPROVED("e2b8f5013ac96d47", "2026-10-28T11:05:00Z"),
    isolated: true,
    cost: COST(600, 0, 2),
    provides: ["knowledge.memory"],
  }),
  "secret-guard": ext({
    purpose: "desktop.craft.canvas.cvF.purpose.secretGuard",
    version: "1.4.0",
    origin: "bundled",
    review: APPROVED("7d3c90e15fa2b864", "2026-10-28T11:05:00Z"),
    enforcement: "enforced",
    isolated: true,
    cost: COST(0, 0, 0),
    hooks: [{ name: "tool.call.before", fold: "first", powers: ["decide"] }],
  }),
  "lint-on-edit": ext({
    purpose: "desktop.craft.canvas.cvF.purpose.lintOnEdit",
    version: "0.4.2",
    review: APPROVED("91f0b6c2d8e3a175", "2026-11-14T16:30:00Z"),
    enforcement: "enforced",
    isolated: true,
    cost: COST(0, 0, 0),
    hooks: [{ name: "tool.result", fold: "chain", powers: ["modify"] }],
  }),
  "cost-cap": ext({
    purpose: "desktop.craft.canvas.cvF.purpose.costCap",
    version: "1.0.0",
    review: APPROVED("c4e7a2091db5f386", "2026-11-06T10:00:00Z"),
    isolated: true,
    cost: COST(0, 0, 0),
    hooks: [{ name: "request.provider.before", fold: "chain", powers: ["modify"] }],
  }),
  helm: ext({
    purpose: "desktop.craft.canvas.cvF.purpose.helm",
    version: "3.1.0",
    origin: "bundled",
    review: APPROVED("0b6e3fd49a21c758", "2026-11-11T09:00:00Z"),
    isolated: true,
    cost: COST(1300, 0, 0, 3400),
    requires: ["knowledge.memory"],
  }),
  verifier: ext({
    purpose: "desktop.craft.canvas.cvF.purpose.verifier",
    version: "1.1.0",
    review: APPROVED("6a2d81fe0c47b593", "2026-11-14T16:30:00Z"),
    isolated: true,
    cost: COST(900, 0, 0, 1800),
    requires: ["agents.judge"],
  }),
  "github-mcp": ext({
    purpose: "desktop.craft.canvas.cvF.purpose.githubMcp",
    version: "1.8.0",
    review: APPROVED("f18c5e20b97a3d46", "2026-11-09T13:15:00Z"),
    isolated: true,
    cost: COST(0, 2600, 12),
  }),
  "commit-msg": ext({
    purpose: "desktop.craft.canvas.cvF.purpose.commitMsg",
    version: "0.1.0",
    createdIn: "thr_8q2n4w",
    review: {
      state: "pending",
      currentHash: null,
      pendingItemId: "rvw_7k2m9x",
      approvedAt: null,
    },
    isolated: true,
    cost: COST(0, 0, 0),
    health: "idle",
    hooks: [{ name: "tool.call.before", fold: "first", powers: ["decide"] }],
  }),
  "web-research": ext({
    purpose: "desktop.craft.canvas.cvF.purpose.webResearch",
    version: "0.6.0",
    review: APPROVED("2e95d1a8f04c7b36", "2026-11-01T19:45:00Z"),
    isolated: true,
    cost: COST(700, 0, 1, 2900),
    requires: ["web.search"],
    replaces: ["web_fetch"],
  }),
  changelog: ext({
    purpose: "desktop.craft.canvas.cvF.purpose.changelog",
    version: "1.0.0",
    origin: "project",
    cost: COST(1900, 0, 0),
    health: "idle",
  }),
  "test-runner": ext({
    purpose: "desktop.craft.canvas.cvF.purpose.testRunner",
    version: "0.3.1",
    enforcement: "enforced",
    isolated: true,
    cost: COST(0, 0, 0),
    health: "idle",
    hooks: [{ name: "boundary.settle.before", fold: "chain", powers: ["modify"] }],
  }),
  // 노드 30개 장면의 스물
  "api-docs": ext({
    purpose: "desktop.craft.canvas.cvF.purpose.apiDocs",
    version: "1.0.0",
    cost: COST(1200, 0, 0),
  }),
  "db-schema": ext({
    purpose: "desktop.craft.canvas.cvF.purpose.dbSchema",
    version: "0.2.0",
    cost: COST(90, 2100, 0),
  }),
  runbooks: ext({
    purpose: "desktop.craft.canvas.cvF.purpose.runbooks",
    version: "1.3.0",
    cost: COST(640, 0, 0),
  }),
  "design-notes": ext({
    purpose: "desktop.craft.canvas.cvF.purpose.designNotes",
    version: "0.5.0",
    cost: COST(80, 1800, 0),
  }),
  onboarding: ext({
    purpose: "desktop.craft.canvas.cvF.purpose.onboarding",
    version: "1.0.2",
    cost: COST(510, 0, 0),
  }),
  "ts-style": ext({
    purpose: "desktop.craft.canvas.cvF.purpose.tsStyle",
    version: "2.1.0",
    cost: COST(70, 900, 0),
  }),
  "pii-mask": ext({
    purpose: "desktop.craft.canvas.cvF.purpose.piiMask",
    version: "1.0.0",
    enforcement: "enforced",
    hooks: [{ name: "tool.call.before", fold: "first", powers: ["decide"] }],
  }),
  "license-check": ext({
    purpose: "desktop.craft.canvas.cvF.purpose.licenseCheck",
    version: "0.7.0",
    hooks: [{ name: "tool.call.before", fold: "first", powers: ["decide"] }],
  }),
  "format-on-save": ext({
    purpose: "desktop.craft.canvas.cvF.purpose.formatOnSave",
    version: "1.1.0",
    hooks: [{ name: "tool.result", fold: "chain", powers: ["modify"] }],
  }),
  "bundle-cap": ext({
    purpose: "desktop.craft.canvas.cvF.purpose.bundleCap",
    version: "0.2.0",
    enforcement: "enforced",
    hooks: [{ name: "tool.result", fold: "chain", powers: ["modify"] }],
  }),
  "budget-alert": ext({
    purpose: "desktop.craft.canvas.cvF.purpose.budgetAlert",
    version: "1.0.0",
    hooks: [{ name: "request.provider.before", fold: "chain", powers: ["modify"] }],
  }),
  "deploy-gate": ext({
    purpose: "desktop.craft.canvas.cvF.purpose.deployGate",
    version: "0.9.0",
    hooks: [{ name: "boundary.settle.before", fold: "chain", powers: ["modify"] }],
  }),
  triage: ext({
    purpose: "desktop.craft.canvas.cvF.purpose.triage",
    version: "0.4.0",
    cost: COST(400, 0, 0, 1500),
  }),
  planner: ext({
    purpose: "desktop.craft.canvas.cvF.purpose.planner",
    version: "0.8.0",
    cost: COST(500, 0, 0, 2200),
  }),
  refactorer: ext({
    purpose: "desktop.craft.canvas.cvF.purpose.refactorer",
    version: "0.3.0",
    cost: COST(600, 0, 0, 2600),
  }),
  "doc-writer": ext({
    purpose: "desktop.craft.canvas.cvF.purpose.docWriter",
    version: "1.2.0",
    cost: COST(450, 0, 0, 1900),
  }),
  "jira-mcp": ext({
    purpose: "desktop.craft.canvas.cvF.purpose.jiraMcp",
    version: "1.0.0",
    cost: COST(0, 700, 3),
  }),
  "slack-mcp": ext({
    purpose: "desktop.craft.canvas.cvF.purpose.slackMcp",
    version: "2.0.0",
    cost: COST(0, 700, 3),
  }),
  "sentry-mcp": ext({
    purpose: "desktop.craft.canvas.cvF.purpose.sentryMcp",
    version: "0.6.0",
    cost: COST(0, 700, 3),
  }),
  "figma-mcp": ext({
    purpose: "desktop.craft.canvas.cvF.purpose.figmaMcp",
    version: "0.2.1",
    cost: COST(0, 700, 3),
  }),
};

const UNKNOWN: PluginExt = ext({
  purpose: "desktop.craft.canvas.cvF.purpose.unknown",
  version: "0.0.0",
});

export function extOf(name: string): PluginExt {
  return EXT[name] ?? UNKNOWN;
}

/** 묶음(매니페스트 `group`, 플러그인 여럿을 한 번에 켜고 끈다)에 덧붙이는 값 */
export interface GroupExt {
  readonly purpose: MessageId;
  readonly version: string;
}

const GROUP_EXT: Readonly<Record<string, GroupExt>> = {
  quality: { purpose: "desktop.craft.canvas.cvF.purpose.quality", version: "0.4.2" },
};

export function groupExtOf(id: string): GroupExt {
  return GROUP_EXT[id] ?? { purpose: "desktop.craft.canvas.cvF.purpose.unknown", version: "0.0.0" };
}
