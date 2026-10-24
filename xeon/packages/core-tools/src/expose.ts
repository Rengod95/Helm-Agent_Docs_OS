import { Bug } from "@xeon/contracts";
import {
  MAX_TOOLS_PER_REQUEST,
  toolOrderKey,
  toolsetFingerprint,
  type OrderedTool,
  type ToolRef,
} from "@xeon/contracts/capabilities";
import {
  TOOL_SEARCH_NAME,
  type AdvertisedToolset,
  type AdvertiseInput,
  type PolicyInput,
  type RemovedTool,
  type TieredRule,
} from "@xeon/contracts/services";
import { evaluatePolicy } from "./policy/engine.ts";
import type { ToolEntry } from "./types.ts";

// L1.tools.spec §4.1 노출: 결정적 순서, 전역 deny 제거, 지연 노출(deferred, auto 임계, 128 상한), `tool_search`와 활성화.
// 서브에이전트 입력(allow, keepParentList, ceiling)은 L1A.6(TL-13)에서 더한다.

export interface ExposeContext {
  readonly rules: readonly TieredRule[];
  readonly bypassAllowed: boolean;
  /** `l1.tools.exposure.deferThreshold`. 광고 후보(always + auto)가 이 수를 넘으면 auto 도구는 모두 지연 도구다 */
  readonly deferThreshold: number;
}

/** 광고 계획: 이번 요청에 싣는 도구와 지연 도구, 뺀 도구 */
export interface ExposurePlan {
  /** orderTools 순서. 활성화된 지연 도구와 `tool_search`를 포함한다 */
  readonly advertised: readonly ToolEntry[];
  /** 아직 활성화되지 않은 지연 도구. 순서 키 순 */
  readonly deferred: readonly ToolEntry[];
  readonly removed: readonly RemovedTool[];
}

/** 내장 `tool_search` 항목인가(순서 키 `core.tools`) */
function isToolSearch(entry: ToolEntry): boolean {
  return entry.ref.capability === "core.tools" && entry.name === TOOL_SEARCH_NAME;
}

function wireOf(entry: ToolEntry): OrderedTool {
  return {
    ...entry.ref,
    wire: { name: entry.name, description: entry.description, parameters: entry.parameters },
  };
}

/**
 * 인자·모드 조건이 없는 deny 규칙 때문에 어떤 호출도 허용되지 않는 도구인가.
 * 모드와 비대화형 규칙은 실행 시점에 적용하므로 여기서는 default 모드, 대화형으로 평가한다(§4.1 규칙 2·3)
 */
function globalDeny(
  entry: ToolEntry,
  input: AdvertiseInput,
  context: ExposeContext,
): RemovedTool | undefined {
  const policyInput: PolicyInput = {
    action: "tool.call",
    tool: entry.name,
    ...(entry.capability === undefined ? {} : { capability: entry.capability.id }),
    ...(entry.mcpServer === undefined ? {} : { mcpServer: entry.mcpServer }),
    classes: entry.classes,
    risk: entry.risk,
    args: null,
    caller: input.run.caller,
    depth: input.run.depth,
    mode: "default",
    interactive: true,
    bypassAllowed: context.bypassAllowed,
  };
  const decision = evaluatePolicy(policyInput, context.rules);
  if (decision.effect !== "deny" || decision.reason !== "rule" || decision.ruleId === null) {
    return undefined;
  }
  const rule = context.rules.find(
    (candidate) => candidate.id === decision.ruleId && candidate.tier === decision.tier,
  );
  if (rule === undefined) return undefined;
  if (rule.resource.args !== undefined || rule.resource.mode !== undefined) return undefined;
  return { ref: entry.ref, ruleId: rule.id, tier: rule.tier };
}

function refOrder(a: ToolEntry, b: ToolEntry): number {
  return toolOrderKey(a.ref, b.ref);
}

/**
 * 광고 계획을 세운다. 순수 함수이고 입력 순서와 무관하게 같은 결과를 낸다.
 *
 * 1. 전역 deny 도구를 뺀다. 2. `always`는 항상 싣는다. `deferred`는 지연이다. `auto`는 광고 후보(always + auto)가
 * 임계를 넘으면 모두 지연이고, 아니면 싣는다. 3. 지연 도구가 하나라도 있으면 `tool_search`를 싣는다(자리 하나).
 * 4. 상한 128을 넘는 auto 도구는 순서 뒤쪽부터 지연이 된다. always와 `tool_search`만으로 넘으면 `tools.too_many`다.
 * 5. `activated`에 든 지연 도구는 상한이 남는 만큼 싣는다.
 */
export function planExposure(
  entries: readonly ToolEntry[],
  input: AdvertiseInput,
  context: ExposeContext,
): ExposurePlan {
  const ordered = [...entries].toSorted(refOrder);
  const search = ordered.find(isToolSearch);
  const removed: RemovedTool[] = [];
  const visible: ToolEntry[] = [];
  for (const entry of ordered) {
    if (isToolSearch(entry)) continue;
    const denied = globalDeny(entry, input, context);
    if (denied === undefined) visible.push(entry);
    else removed.push(denied);
  }
  const always = visible.filter((entry) => entry.exposure === "always");
  const autos = visible.filter((entry) => entry.exposure === "auto");
  const explicit = visible.filter((entry) => entry.exposure === "deferred");
  const overThreshold = always.length + autos.length > context.deferThreshold;
  const autosOffered = overThreshold ? [] : autos;
  const thresholdDeferred = overThreshold ? autos : [];

  // 지연 도구가 있으면 tool_search가 자리를 하나 쓴다. 상한을 넘겨 지연이 생기는 경우도 마찬가지다
  const fitsWithoutSearch = always.length + autosOffered.length <= MAX_TOOLS_PER_REQUEST;
  const anyDeferral = explicit.length > 0 || thresholdDeferred.length > 0 || !fitsWithoutSearch;
  const reserved = anyDeferral && search !== undefined ? 1 : 0;
  const room = MAX_TOOLS_PER_REQUEST - always.length - reserved;
  if (room < 0) {
    throw new Bug(
      `tools.too_many: ${always.length} always-exposed tools${reserved === 1 ? " and tool_search" : ""} exceed the limit of ${MAX_TOOLS_PER_REQUEST}`,
    );
  }
  const advertisedAutos = autosOffered.slice(0, room);
  const overflow = autosOffered.slice(room);

  const deferredAll = [...explicit, ...thresholdDeferred, ...overflow].toSorted(refOrder);
  const advertised: ToolEntry[] = [...always, ...advertisedAutos];
  const stillDeferred: ToolEntry[] = [];
  let left = room - advertisedAutos.length;
  for (const entry of deferredAll) {
    if (input.activated.has(entry.name) && left > 0) {
      advertised.push(entry);
      left -= 1;
    } else {
      stillDeferred.push(entry);
    }
  }
  if (search !== undefined && anyDeferral) advertised.push(search);
  return { advertised: advertised.toSorted(refOrder), deferred: stillDeferred, removed };
}

export async function advertiseTools(
  entries: readonly ToolEntry[],
  input: AdvertiseInput,
  context: ExposeContext,
): Promise<AdvertisedToolset> {
  if (
    input.allow !== undefined ||
    input.keepParentList !== undefined ||
    input.run.ceiling !== undefined
  ) {
    // 서브에이전트 광고(allow, keepParentList, ceiling)는 L1A.6(L1.tools.plan TL-13)이다. 조용히 넓히지 않는다
    throw new Bug("tools.advertise_child_unsupported: child toolsets arrive in M2 (TL-13)");
  }
  const plan = planExposure(entries, input, context);
  const tools = plan.advertised.map(wireOf);
  const deferred: ToolRef[] = plan.deferred.map((entry) => entry.ref);
  return {
    tools,
    deferred,
    removed: plan.removed,
    fingerprint: await toolsetFingerprint(tools),
  };
}
