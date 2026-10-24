import { diffToolsets, toolOrderKey, type OrderedTool } from "@xeon/contracts/capabilities";
import type { SystemMessage } from "@xeon/contracts/conversation";
import type {
  CachePolicy,
  ContextWarning,
  PendingSystemItem,
  ToolChangeDecision,
} from "@xeon/contracts/services";

// L1.context.spec §4.3, plan C-2. 접두가 광고한 도구 목록과 이번 단계 도구 집합을 비교해 접두 뒤 변경 메시지를 낼지,
// 미룰지 정한다. 재광고(readvertise)는 첫 요청과 컴팩션에서 접두를 새로 만들 때뿐이라 여기서는 다루지 않는다.

export interface ToolsetChange {
  readonly decision: ToolChangeDecision | null;
  /** append일 때 이번 단계에 새로 기록할 system item */
  readonly pending: PendingSystemItem | null;
  /** append일 때 이번 조립에서 접두 뒤에 이어 붙일 메시지 */
  readonly message: SystemMessage | null;
  readonly warnings: readonly ContextWarning[];
}

const NO_CHANGE: ToolsetChange = { decision: null, pending: null, message: null, warnings: [] };

/**
 * 직전 광고 목록(접두의 toolsAdded에 뒤따른 도구 변경 item을 적용한 결과)을 OrderedTool로 되살린다.
 * 광고에는 능력 ID가 없으므로 이번 집합에 같은 이름이 있으면 그 능력 ID를 빌려 정렬 키를 맞춘다
 */
function advertisedTools(
  advertised: SystemMessage["toolsAdded"],
  next: readonly OrderedTool[],
): readonly OrderedTool[] {
  const capabilityOf = new Map(next.map((tool) => [tool.name, tool.capability]));
  const tools: OrderedTool[] = (advertised ?? []).map((wire) => ({
    capability: capabilityOf.get(wire.name) ?? "",
    name: wire.name,
    wire: { name: wire.name, description: wire.description, parameters: wire.parameters },
  }));
  return tools.toSorted(toolOrderKey);
}

export function decideToolChange(input: {
  readonly advertised: SystemMessage["toolsAdded"];
  readonly next: readonly OrderedTool[];
  readonly policy: CachePolicy;
  readonly timestamp: number;
}): ToolsetChange {
  const diff = diffToolsets(advertisedTools(input.advertised, input.next), input.next);
  if (diff.added.length === 0 && diff.removed.length === 0) return NO_CHANGE;
  if (input.policy.midConversationToolChanges) {
    const message: SystemMessage = {
      role: "system",
      content: "",
      toolsAdded: [...diff.added],
      toolsRemoved: [...diff.removed],
      timestamp: input.timestamp,
    };
    return {
      decision: { action: "append", added: diff.added.length, removed: diff.removed.length },
      pending: { purpose: "tool_change", message },
      message,
      warnings: [],
    };
  }
  return {
    decision: { action: "defer", firstChangedIndex: diff.firstChangedIndex ?? 0 },
    pending: null,
    message: null,
    warnings: [
      {
        code: "tools_deferred",
        added: diff.added.map((tool) => tool.name),
        removed: diff.removed.map((tool) => tool.name),
      },
    ],
  };
}
