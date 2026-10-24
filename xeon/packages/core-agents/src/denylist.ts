// 자식 도구 차단 목록과 정의 규칙(L1.agents.spec §4.3, AG-4). 규칙은 default 티어 deny로 `core:agents` 출처에 등록한다.
import type { AgentDefinition, PolicyRule } from "@xeon/contracts/services";

/** `ToolService.registerRules`의 출처 이름 */
export const AGENTS_RULE_SOURCE = "core:agents" as const;

/**
 * 차단 규칙 4종. `no-spawn`은 깊이 한도에 이른 자식만 막는다(minDepth = maxDepth).
 * deny는 티어와 무관하게 확정이라 사용자 규칙으로 풀 수 없다. 깊이 한도는 설정으로 바꾼다
 */
export function subagentRules(maxDepth: number): readonly PolicyRule[] {
  const disabled: readonly PolicyRule[] =
    maxDepth > 0
      ? []
      : [
          {
            id: "subagent.disabled",
            action: "tool.call",
            resource: { classes: ["spawn"] },
            effect: "deny",
            description: "l1.agents.maxDepth is 0: subagents are not used.",
          },
        ];
  return [
    ...disabled,
    {
      id: "subagent.no-spawn",
      action: "tool.call",
      resource: { classes: ["spawn"], caller: "subagent", minDepth: maxDepth },
      effect: "deny",
      description: "A subagent at the depth limit cannot create subagents.",
    },
    {
      id: "subagent.no-user-interaction",
      action: "tool.call",
      resource: { classes: ["user_interaction"], caller: "subagent" },
      effect: "deny",
      description: "Subagents cannot ask the user questions or request plan approval.",
    },
    {
      id: "subagent.no-shared-write",
      action: "tool.call",
      resource: { classes: ["shared_state_write"], caller: "subagent" },
      effect: "deny",
      description: "Subagents cannot write shared state such as memory or skills.",
    },
    {
      id: "subagent.no-external-send",
      action: "tool.call",
      resource: { classes: ["external_send"], caller: "subagent" },
      effect: "deny",
      description: "Subagents cannot send messages or notifications to the outside.",
    },
  ];
}

/**
 * 정의가 더하는 규칙(`permissions.rules`). 호출 주체를 그 정의의 자식으로 좁히고 id에 정의 이름을 붙인다.
 * 평가는 부모 관점에서도 같은 규칙 묶음으로 하지만 caller 조건 때문에 다른 호출 주체에는 일치하지 않는다.
 * [미결] 명세는 이 규칙을 extension 티어로 평가한다고 적었으나 core-tools에 확장 티어로 등록하는 길이 없어
 * default 티어로 등록한다: allow는 부모 결정을 넓히지 못하고(stricter 합성), ask·deny는 같은 효과다
 */
export function definitionRules(definition: AgentDefinition): readonly PolicyRule[] {
  return (definition.permissions?.rules ?? []).map((rule) =>
    Object.assign({}, rule, {
      id: `agent.${definition.name}.${rule.id}`,
      resource: Object.assign({}, rule.resource, {
        caller: `subagent:${definition.name}` as const,
      }),
    }),
  );
}
