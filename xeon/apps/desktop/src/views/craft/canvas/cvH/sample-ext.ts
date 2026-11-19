// cvH "선로"가 보는 플러그인 메타. 값은 시안 F·G·H가 함께 보는 `../shared-meta.ts`에서 읽고, 여기서는 cvH가 받는 모양으로 바꾸기만 한다.
// 모양은 계약의 이름을 따른다: 카드(`PluginCard`의 purpose·review·origin·enforcement·runs·health·cost), 매니페스트
// (`version`, `PluginDecl.requires·provides·replaces`, `GroupDecl.members`), Hook 이름과 fold(`HOOKS`), MCP 실행 명령(`CardMcpLaunch`).
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
import { bundleMetaOf, metaOf, pluginNeeds, type PluginMeta } from "../shared-meta.ts";
import { ALL_SHARED_PLUGINS, SHARED_PROFILES, type SharedPlugin } from "../shared-sample.ts";

/** 블록의 바꿀 수 있는 부품 id(`BLOCK_MODEL`의 `parts`, `how: "replaces"`인 것) */
export type PartId = "tool:read" | "tool:write" | "tool:edit" | "tool:grep" | "tool:bash";

const PARTS: Readonly<Record<string, PartId>> = {
  read: "tool:read",
  write: "tool:write",
  edit: "tool:edit",
  grep: "tool:grep",
  bash: "tool:bash",
};

export interface CardExt {
  /** 카드 `purpose`(목적 한 문장) */
  readonly purpose: MessageId;
  /** 매니페스트 `version` */
  readonly version: string;
  readonly review: CardReviewState;
  /** 카드 `review.currentHash`(`sha256:<hex>`). 드래프트는 `draft:<draftId>:<해시>` 버전 정체를 쓴다 */
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

/** 카드의 리뷰 칸: 승인본 위에 새 판이 리뷰를 기다리면 "대기"다 */
function reviewOf(meta: PluginMeta): CardReviewState {
  return meta.review.state === "approved" && meta.pending !== null ? "pending" : meta.review.state;
}

function hashOf(meta: PluginMeta): string | null {
  if (meta.review.state === "draft" && meta.pending !== null)
    return `draft:${meta.pending.draftId}:${meta.pending.contentHash}`;
  return meta.review.currentHash === null ? null : `sha256:${meta.review.currentHash}`;
}

function convert(p: SharedPlugin): CardExt {
  const meta = metaOf(p.name, p.kind);
  const c = meta.cost;
  const declared =
    c.always !== null || c.drive !== null || c.onDemand !== null || c.toolCount !== null;
  const hook = p.kind === "hook" ? meta.hooks[0] : undefined;
  return {
    purpose: meta.purpose,
    version: meta.version,
    review: reviewOf(meta),
    currentHash: hashOf(meta),
    approvedAt: meta.review.approvedAt,
    origin:
      meta.createdIn === null
        ? { kind: meta.origin }
        : { kind: meta.origin, createdIn: { threadId: meta.createdIn } },
    enforcement: meta.enforcement,
    isolated: meta.isolated,
    health: meta.health,
    cost: { ...c, basis: declared ? "declared" : "unknown" },
    requires: pluginNeeds(meta),
    provides: meta.provides,
    replaces: meta.replaces.flatMap((name) => {
      const part = PARTS[name];
      return part === undefined ? [] : [part];
    }),
    ...(hook === undefined ? {} : { hook }),
    ...(meta.launch === null ? {} : { launch: meta.launch }),
  };
}

const EXT: ReadonlyMap<string, CardExt> = new Map(
  ALL_SHARED_PLUGINS.map((p) => [p.name, convert(p)]),
);

/** 플러그인의 덧붙임. 표본에 없는 이름은 없다(공통 표본에서 만든다) */
export function extOf(name: string): CardExt | undefined {
  return EXT.get(name);
}

/** Hook의 fold(`HOOKS[name].fold`) */
export function foldOf(hook: HookName): Fold {
  return HOOKS[hook].fold;
}

/** 공통 표본의 묶음을 담은 플러그인 그룹. 그룹을 담은 확장은 그 구성원의 패키지다 */
export const GROUP_EXT: Readonly<Record<string, GroupExt>> = Object.fromEntries(
  SHARED_PROFILES.dev.groups.map((g) => {
    const meta = bundleMetaOf(g.id);
    const first = ALL_SHARED_PLUGINS.find((p) => p.name === g.members[0]);
    const extension = first === undefined ? g.id : metaOf(first.name, first.kind).pkg;
    const ext: GroupExt = {
      id: g.id,
      extension,
      version: meta.version,
      purpose: meta.purpose,
      currentHash: `sha256:${meta.hash}`,
      origin: meta.origin,
    };
    return [g.id, ext];
  }),
);

/** 드래프트를 만든 대화와 그 대화에서 쓴 빌더 도구(`authoring_submit`). 생성 관계의 출발점이다 */
export const DRAFT_SOURCE: { readonly tool: string } = { tool: "authoring_submit" };
