import { Bug } from "@xeon/contracts";
import {
  MAX_TOOLS_PER_REQUEST,
  toolOrderKey,
  toolsetFingerprint,
  type OrderedTool,
  type ToolRef,
} from "@xeon/contracts/capabilities";
import type {
  AdvertisedToolset,
  AdvertiseInput,
  PolicyInput,
  RemovedTool,
  TieredRule,
} from "@xeon/contracts/services";
import { evaluatePolicy } from "./policy/engine.ts";
import type { ToolEntry } from "./types.ts";

// L1.tools.spec §4.1 노출. M1 범위: 결정적 순서, 전역 deny 제거, 지연 분리(always·auto 광고, deferred 제외), 128 상한.
// tool_search와 auto 도구의 임계 지연은 M2(TL-10)다. 서브에이전트 입력(allow, keepParentList, ceiling)은 M2(TL-13)다.

export interface ExposeContext {
  readonly rules: readonly TieredRule[];
  readonly bypassAllowed: boolean;
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
    // 서브에이전트 광고(allow, keepParentList, ceiling)는 M2(L1.tools.plan TL-13)다. 조용히 넓히지 않는다
    throw new Bug("tools.advertise_child_unsupported: child toolsets arrive in M2 (TL-13)");
  }
  const ordered = [...entries].toSorted(refOrder);
  const removed: RemovedTool[] = [];
  const visible: ToolEntry[] = [];
  for (const entry of ordered) {
    const denied = globalDeny(entry, input, context);
    if (denied === undefined) visible.push(entry);
    else removed.push(denied);
  }
  const always = visible.filter((entry) => entry.exposure === "always");
  if (always.length > MAX_TOOLS_PER_REQUEST) {
    throw new Bug(
      `tools.too_many: ${always.length} always-exposed tools exceed the limit of ${MAX_TOOLS_PER_REQUEST}`,
    );
  }
  // always 도구는 모두 싣고, 남는 자리를 auto 도구가 순서대로 채운다. 넘치는 auto와 deferred는 지연 도구다
  let room = MAX_TOOLS_PER_REQUEST - always.length;
  const advertised: ToolEntry[] = [];
  const deferred: ToolRef[] = [];
  for (const entry of visible) {
    if (entry.exposure === "always") {
      advertised.push(entry);
    } else if (entry.exposure === "auto" && room > 0) {
      advertised.push(entry);
      room -= 1;
    } else {
      deferred.push(entry.ref);
    }
  }
  const tools = advertised.map(wireOf);
  return {
    tools,
    deferred,
    removed,
    fingerprint: await toolsetFingerprint(tools),
  };
}
