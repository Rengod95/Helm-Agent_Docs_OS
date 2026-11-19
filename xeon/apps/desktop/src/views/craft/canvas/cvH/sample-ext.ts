// cvH "선로"가 공통 표본(`../shared-sample.ts`)에 덧붙이는 값. 공통 표본은 고치지 않고 여기에서 플러그인 이름으로 잇는다.
// 필드 이름은 계약을 따른다: 카드(`PluginCard`의 purpose·review·origin·enforcement·runs·health·cost·usedBy), 매니페스트
// (`version`, `PluginDecl.requires·provides·replaces`, `GroupDecl.members`), Hook 이름과 fold(`HOOKS`), MCP 실행 명령(`CardMcpLaunch`).
// 값은 표본이다(엔진 없이 돈다). 표본에 없던 값을 더한 것은 이 파일뿐이다.
import type { MessageId } from "@fresnel/client/i18n";
import {
  HOOKS,
  type CapabilityProvision,
  type CapabilityRequirement,
  type CardMcpLaunch,
  type CardReviewState,
  type CostFigures,
  type Fold,
  type HookName,
  type PluginEnforcement,
  type PluginHealthState,
  type PluginOriginKind,
} from "@fresnel/contracts/extensions";
import { ALL_SHARED_PLUGINS, type SharedPlugin } from "../shared-sample.ts";

/** 블록의 바꿀 수 있는 부품 id(`BLOCK_MODEL`의 `parts`, `how: "replaces"`인 것) */
export type PartId = "tool:read" | "tool:write" | "tool:edit" | "tool:grep" | "tool:bash";

export interface CardExt {
  /** 카드 `purpose`(목적 한 문장) */
  readonly purpose: MessageId;
  /** 매니페스트 `version` */
  readonly version: string;
  readonly review: CardReviewState;
  /** 카드 `review.currentHash`(`sha256:<hex>`). 드래프트는 `draft:<draftId>:<해시 앞 8자>` 버전 정체를 쓴다 */
  readonly currentHash: string | null;
  readonly approvedAt: string | null;
  readonly origin: {
    readonly kind: PluginOriginKind;
    readonly createdIn?: { readonly threadId: string };
  };
  readonly enforcement: PluginEnforcement;
  /** 카드 `runs.isolated`. 코드가 없으면 null */
  readonly isolated: boolean | null;
  readonly health: PluginHealthState;
  readonly cost: CostFigures;
  /** 매니페스트 `PluginDecl.requires`·`provides` */
  readonly requires: readonly CapabilityRequirement[];
  readonly provides: readonly CapabilityProvision[];
  /** 매니페스트 `PluginDecl.replaces`: 같은 이름으로 바꿔 놓는 내장 도구(블록 부품) */
  readonly replaces: readonly PartId[];
  /** Hook만: 거는 Hook 이름. fold는 `HOOKS`에서 읽는다 */
  readonly hook?: HookName;
  /** 도구만: 승인하면 실행될 명령(stdio) */
  readonly launch?: CardMcpLaunch;
}

/** 플러그인 그룹(매니페스트 `group`). 확장 하나가 플러그인 여럿을 담고 `members`를 한 번에 켜고 끈다 */
export interface GroupExt {
  readonly id: string;
  /** 그룹을 담은 확장 이름(소유자) */
  readonly extension: string;
  readonly version: string;
  readonly purpose: MessageId;
  readonly currentHash: string;
  readonly origin: PluginOriginKind;
}

const UNKNOWN_COST: CostFigures = {
  always: null,
  drive: null,
  onDemand: null,
  toolCount: null,
  basis: "unknown",
};

function cost(always: number, onDemand: number, toolCount: number): CostFigures {
  return { always, drive: null, onDemand, toolCount, basis: "declared" };
}

const NO_LINKS = { requires: [], provides: [], replaces: [] } as const;

const BASE_EXT = {
  ...NO_LINKS,
  review: "approved",
  enforcement: "advisory",
  health: "ok",
} as const;

/** 공통 표본 열셋의 덧붙임 */
const NAMED: Readonly<Record<string, CardExt>> = {
  "house-style": {
    ...BASE_EXT,
    purpose: "desktop.craft.canvas.cvH.purpose.houseStyle",
    version: "1.2.0",
    currentHash: "sha256:7c1e9a40d2",
    approvedAt: "2026-11-12T09:40:00Z",
    origin: { kind: "user" },
    isolated: null,
    cost: cost(1840, 0, 0),
  },
  "repo-skills": {
    ...BASE_EXT,
    purpose: "desktop.craft.canvas.cvH.purpose.repoSkills",
    version: "0.6.1",
    currentHash: "sha256:a91f03be55",
    approvedAt: "2026-11-15T14:02:00Z",
    origin: { kind: "project" },
    isolated: null,
    cost: cost(0, 6200, 0),
  },
  memory: {
    ...BASE_EXT,
    purpose: "desktop.craft.canvas.cvH.purpose.memory",
    version: "2.0.3",
    currentHash: "sha256:30d4c8e1f7",
    approvedAt: "2026-11-02T11:20:00Z",
    origin: { kind: "bundled" },
    isolated: true,
    cost: cost(920, 0, 2),
  },
  "secret-guard": {
    ...BASE_EXT,
    purpose: "desktop.craft.canvas.cvH.purpose.secretGuard",
    version: "1.4.2",
    currentHash: "sha256:e2b7719c0a",
    approvedAt: "2026-11-02T11:20:00Z",
    origin: { kind: "bundled" },
    enforcement: "enforced",
    isolated: true,
    cost: cost(0, 0, 0),
    hook: "guard.tool.before",
  },
  "lint-on-edit": {
    ...BASE_EXT,
    purpose: "desktop.craft.canvas.cvH.purpose.lintOnEdit",
    version: "0.3.0",
    currentHash: "sha256:5f02aa9d31",
    approvedAt: "2026-11-16T08:15:00Z",
    origin: { kind: "user" },
    isolated: true,
    cost: cost(240, 0, 1),
    hook: "tool.result",
    replaces: ["tool:edit"],
  },
  "cost-cap": {
    ...BASE_EXT,
    purpose: "desktop.craft.canvas.cvH.purpose.costCap",
    version: "1.0.0",
    currentHash: "sha256:0b6d2f8e94",
    approvedAt: "2026-11-10T17:31:00Z",
    origin: { kind: "user" },
    enforcement: "enforced",
    isolated: true,
    cost: cost(0, 0, 0),
    hook: "guard.model.before",
  },
  helm: {
    ...BASE_EXT,
    purpose: "desktop.craft.canvas.cvH.purpose.helm",
    version: "3.1.0",
    currentHash: "sha256:d4410c7b2e",
    approvedAt: "2026-11-02T11:20:00Z",
    origin: { kind: "bundled" },
    isolated: true,
    cost: { always: 0, drive: null, onDemand: 0, toolCount: 0, basis: "unknown" },
  },
  verifier: {
    ...BASE_EXT,
    purpose: "desktop.craft.canvas.cvH.purpose.verifier",
    version: "0.9.2",
    currentHash: "sha256:66c1e0d9a3",
    approvedAt: "2026-11-16T08:15:00Z",
    origin: { kind: "user" },
    isolated: true,
    cost: UNKNOWN_COST,
    requires: [{ id: "test.run", range: "^1.0.0" }],
  },
  "github-mcp": {
    ...BASE_EXT,
    purpose: "desktop.craft.canvas.cvH.purpose.githubMcp",
    version: "1.8.0",
    currentHash: "sha256:9ae3b51c08",
    approvedAt: "2026-11-08T13:47:00Z",
    origin: { kind: "user" },
    isolated: true,
    cost: cost(3100, 0, 12),
    provides: [{ id: "github.api", version: "1.8.0" }],
    launch: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      envNames: ["GITHUB_TOKEN"],
      cwd: null,
    },
  },
  "commit-msg": {
    ...BASE_EXT,
    purpose: "desktop.craft.canvas.cvH.purpose.commitMsg",
    version: "0.1.0",
    review: "draft",
    currentHash: "draft:drf_8k2q:4be09f1a",
    approvedAt: null,
    origin: { kind: "user", createdIn: { threadId: "thr_test_41c" } },
    isolated: true,
    cost: cost(160, 0, 0),
    hook: "tool.call.before",
    requires: [{ id: "github.api", range: "^1.4.0" }],
  },
  "web-research": {
    ...BASE_EXT,
    purpose: "desktop.craft.canvas.cvH.purpose.webResearch",
    version: "0.4.0",
    currentHash: "sha256:1d7f62c0b8",
    approvedAt: "2026-11-11T10:05:00Z",
    origin: { kind: "user" },
    isolated: true,
    cost: UNKNOWN_COST,
  },
  changelog: {
    ...BASE_EXT,
    purpose: "desktop.craft.canvas.cvH.purpose.changelog",
    version: "1.0.1",
    review: "pending",
    currentHash: "sha256:c5a0e3d417",
    approvedAt: "2026-11-01T09:00:00Z",
    origin: { kind: "project" },
    isolated: null,
    cost: cost(2600, 0, 0),
  },
  "test-runner": {
    ...BASE_EXT,
    purpose: "desktop.craft.canvas.cvH.purpose.testRunner",
    version: "0.5.0",
    currentHash: "sha256:4e88b0a6c1",
    approvedAt: "2026-11-14T16:40:00Z",
    origin: { kind: "user" },
    isolated: true,
    cost: cost(0, 0, 0),
    hook: "boundary.settle.before",
    provides: [{ id: "test.run", version: "1.2.0" }],
  },
};

const SCALE_PURPOSE: Readonly<Record<SharedPlugin["kind"], MessageId>> = {
  inject: "desktop.craft.canvas.cvH.purpose.scaleInject",
  hook: "desktop.craft.canvas.cvH.purpose.scaleHook",
  drive: "desktop.craft.canvas.cvH.purpose.scaleDrive",
  tool: "desktop.craft.canvas.cvH.purpose.scaleTool",
};

/** Hook 자리마다 표본 Hook 이름(노드 30개 장면) */
const SCALE_HOOK: Readonly<Record<NonNullable<SharedPlugin["point"]>, HookName>> = {
  "model.before": "guard.model.before",
  "tools.before": "tool.call.before",
  "tools.after": "tool.result",
  "before-turn-end": "boundary.settle.before",
};

/** 노드 30개 장면의 스물: 이름에서 같은 문법으로 만든다 */
function scaleExt(p: SharedPlugin, i: number): CardExt {
  const hex = (0x3a1f00 + i * 0x1b3d).toString(16).padStart(6, "0");
  return {
    ...BASE_EXT,
    purpose: SCALE_PURPOSE[p.kind],
    version: `0.${String(1 + (i % 5))}.0`,
    currentHash: `sha256:${hex}e0${String(i % 10)}`,
    approvedAt: "2026-11-13T12:00:00Z",
    origin: { kind: i % 3 === 0 ? "project" : "user" },
    isolated: p.kind === "inject" ? null : true,
    cost: p.kind === "inject" ? cost(400 + i * 37, 0, 0) : UNKNOWN_COST,
    ...(p.kind === "hook" && p.point !== undefined ? { hook: SCALE_HOOK[p.point] } : {}),
  };
}

const EXT: ReadonlyMap<string, CardExt> = new Map(
  ALL_SHARED_PLUGINS.map((p, i) => [p.name, NAMED[p.name] ?? scaleExt(p, i)]),
);

/** 플러그인의 덧붙임. 표본에 없는 이름은 없다(공통 표본에서 만든다) */
export function extOf(name: string): CardExt | undefined {
  return EXT.get(name);
}

/** Hook의 fold(`HOOKS[name].fold`) */
export function foldOf(hook: HookName): Fold {
  return HOOKS[hook].fold;
}

/** 공통 표본의 묶음 "quality"를 담은 플러그인 그룹 */
export const GROUP_EXT: Readonly<Record<string, GroupExt>> = {
  quality: {
    id: "quality",
    extension: "quality-kit",
    version: "1.1.0",
    purpose: "desktop.craft.canvas.cvH.purpose.qualityGroup",
    currentHash: "sha256:b07e4d19c2",
    origin: "user",
  },
};

/** 드래프트를 만든 대화와 그 대화에서 쓴 빌더 도구(`authoring_submit`). 생성 관계의 출발점이다 */
export const DRAFT_SOURCE: { readonly tool: string } = { tool: "authoring_submit" };
