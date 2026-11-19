// cvF가 보는 플러그인 메타. 값은 시안 F·G·H가 함께 보는 `../shared-meta.ts`에서 읽고, 여기서는 cvF가 받는 모양으로 바꾸기만 한다.
// 모양은 계약의 이름을 따른다: 카드(`PluginCard`의 purpose·origin·review·enforcement·runs·cost·health), 매니페스트(`version`,
// 플러그인 선언의 requires·provides·replaces), 카드의 Hook 칸(`CardHook`의 name·fold·powers).
import type { MessageId } from "@fresnel/client/i18n";
import {
  HOOK_POSITIONS,
  HOOKS,
  type Fold,
  type HookPower,
  type PluginCard,
} from "@fresnel/contracts/extensions";
import { bundleMetaOf, metaOf, pluginNeeds, type PluginMeta } from "../shared-meta.ts";
import { ALL_SHARED_PLUGINS } from "../shared-sample.ts";

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

/** 카드의 리뷰 칸: 승인본 위에 새 판이 리뷰를 기다리면 "대기"다 */
function review(meta: PluginMeta): PluginCard["review"] {
  const state =
    meta.review.state === "approved" && meta.pending !== null ? "pending" : meta.review.state;
  return {
    state,
    currentHash: meta.review.currentHash === null ? null : `sha256:${meta.review.currentHash}`,
    pendingItemId: meta.pending?.submittedItemId ?? null,
    approvedAt: meta.review.approvedAt,
  };
}

function convert(meta: PluginMeta): PluginExt {
  const c = meta.cost;
  const declared =
    c.always !== null || c.drive !== null || c.onDemand !== null || c.toolCount !== null;
  return {
    purpose: meta.purpose,
    version: meta.version,
    origin:
      meta.createdIn === null
        ? { kind: meta.origin }
        : { kind: meta.origin, createdIn: { threadId: meta.createdIn } },
    review: review(meta),
    enforcement: meta.enforcement,
    isolated: meta.isolated,
    cost: { ...c, basis: declared ? "declared" : "unknown" },
    health: meta.health,
    requires: pluginNeeds(meta).map((r) => r.id),
    provides: meta.provides.map((p) => p.id),
    replaces: meta.replaces,
    hooks: meta.hooks.map((name) => ({
      name,
      fold: HOOKS[name].fold,
      powers: HOOK_POSITIONS[name].powers,
    })),
  };
}

const EXT: ReadonlyMap<string, PluginExt> = new Map(
  ALL_SHARED_PLUGINS.map((p) => [p.name, convert(metaOf(p.name, p.kind))]),
);

const UNKNOWN: PluginExt = convert(metaOf("", "inject"));

export function extOf(name: string): PluginExt {
  return EXT.get(name) ?? UNKNOWN;
}

/** 묶음(매니페스트 `group`, 플러그인 여럿을 한 번에 켜고 끈다)에 덧붙이는 값 */
export interface GroupExt {
  readonly purpose: MessageId;
  readonly version: string;
}

export function groupExtOf(id: string): GroupExt {
  const meta = bundleMetaOf(id);
  return { purpose: meta.purpose, version: meta.version };
}
