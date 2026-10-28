import { describe, expect, test } from "bun:test";
import {
  childDecision,
  type PolicyDecision,
  type PolicyInput,
  type TieredRule,
} from "@xeon/contracts/services";
import {
  AGENTS_RULE_SOURCE,
  ceilingOf,
  childMode,
  definitionRules,
  intersectGlobs,
  subagentRules,
} from "../src/index.ts";
import { EXPLORER, openHarness } from "./support/harness.ts";

const ALLOW: PolicyDecision = { effect: "allow", reason: "mode", ruleId: null, tier: null };

/** 도구 이름 glob과 호출 주체만 보는 최소 평가기. 첫 일치 규칙이 이긴다 */
function evaluate(input: PolicyInput, rules: readonly TieredRule[]): PolicyDecision {
  for (const rule of rules) {
    const tool = rule.resource.tool;
    if (tool !== undefined && tool !== input.tool) continue;
    const caller = rule.resource.caller;
    if (caller === "main" && input.caller !== "main") continue;
    if (caller !== undefined && caller !== "main") {
      const wanted =
        caller === "subagent" ? input.caller.startsWith("subagent:") : input.caller === caller;
      if (!wanted) continue;
    }
    if (
      rule.resource.classes !== undefined &&
      !rule.resource.classes.some((c) => input.classes.includes(c))
    ) {
      continue;
    }
    if (rule.resource.minDepth !== undefined && input.depth < rule.resource.minDepth) continue;
    return { effect: rule.effect, reason: "rule", ruleId: rule.id, tier: rule.tier };
  }
  return ALLOW;
}

function call(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    action: "tool.call",
    tool: "bash",
    classes: [],
    risk: "exec",
    args: null,
    caller: "subagent:explorer",
    depth: 1,
    mode: "default",
    interactive: true,
    bypassAllowed: true,
    ...overrides,
  };
}

describe("child mode and ceiling", () => {
  // spec plan child_mode_never_looser_than_parent
  test("child_mode_never_looser_than_parent", () => {
    expect(childMode("plan", "acceptEdits")).toBe("plan");
    expect(childMode("acceptEdits", "plan")).toBe("plan");
    expect(childMode("default", undefined)).toBe("default");
    expect(childMode("default", "bypass")).toBe("default");
    expect(childMode("bypass", "default")).toBe("default");
  });

  test("glob intersection never widens: nested, overlapping and unlimited lists", () => {
    expect(intersectGlobs(undefined, undefined)).toBeUndefined();
    expect(intersectGlobs(["read", "grep"], undefined)).toEqual(["read", "grep"]);
    expect(intersectGlobs(undefined, ["read*"])).toEqual(["read*"]);
    expect(intersectGlobs(["*"], ["read*", "ls"])).toEqual(["read*", "ls"]);
    expect(intersectGlobs(["read", "grep"], ["read"])).toEqual(["read"]);
    expect(intersectGlobs(["read"], ["write"])).toEqual([]);
    expect(intersectGlobs(["rea*"], ["*d"])).toEqual([]);
  });

  test("ceilingOf keeps the parent's view and the definition limit", () => {
    expect(
      ceilingOf({
        parent: { caller: "main", depth: 0, mode: "plan" },
        definitionTools: ["read*", "grep"],
        requestAllow: ["read*"],
      }),
    ).toEqual({ caller: "main", depth: 0, mode: "plan", allow: ["read*"] });
    expect(
      ceilingOf({
        parent: { caller: "main", depth: 0, mode: "default" },
        definitionTools: undefined,
        requestAllow: undefined,
      }),
    ).toEqual({ caller: "main", depth: 0, mode: "default" });
  });

  test("ceilingOf carries the caller deny globs and the deny hint for run-time rejection", () => {
    expect(
      ceilingOf({
        parent: { caller: "main", depth: 0, mode: "default" },
        definitionTools: undefined,
        requestAllow: ["learning_propose"],
        requestDeny: ["bash"],
        denyHint: "review only",
      }),
    ).toEqual({
      caller: "main",
      depth: 0,
      mode: "default",
      allow: ["learning_propose"],
      deny: ["bash"],
      denyHint: "review only",
    });
    expect(
      ceilingOf({
        parent: { caller: "main", depth: 0, mode: "default" },
        definitionTools: undefined,
        requestAllow: undefined,
        requestDeny: [],
      }),
    ).toEqual({ caller: "main", depth: 0, mode: "default" });
  });
});

describe("deny list and definition rules", () => {
  test("the four subagent rules are default-tier denies; maxDepth feeds no-spawn", () => {
    const rules = subagentRules(2);
    expect(rules.map((rule) => rule.id)).toEqual([
      "subagent.no-spawn",
      "subagent.no-user-interaction",
      "subagent.no-shared-write",
      "subagent.no-external-send",
    ]);
    expect(
      rules.every((rule) => rule.effect === "deny" && rule.resource.caller === "subagent"),
    ).toBe(true);
    expect(rules[0]?.resource).toMatchObject({ classes: ["spawn"], minDepth: 2 });
    // maxDepth 0이면 주 대화도 spawn을 쓰지 않는다
    expect(subagentRules(0)[0]).toMatchObject({ id: "subagent.disabled", effect: "deny" });
  });

  // spec plan child_denylist_blocks_recursive_spawn / user_interaction
  test("child_denylist_blocks_recursive_spawn and user_interaction through childDecision", () => {
    const tiered: readonly TieredRule[] = subagentRules(1).map((rule) =>
      Object.assign({}, rule, { tier: "default" as const, source: AGENTS_RULE_SOURCE }),
    );
    const parent = { caller: "main", depth: 0, mode: "default" } as const;
    const child = { caller: "subagent:explorer", depth: 1, mode: "default" } as const;
    const spawn = childDecision(
      evaluate,
      call({ tool: "agent", classes: ["spawn"] }),
      parent,
      child,
      tiered,
    );
    expect(spawn).toMatchObject({ effect: "deny", ruleId: "subagent.no-spawn" });
    const ask = childDecision(
      evaluate,
      call({ tool: "ask_user", classes: ["user_interaction"] }),
      parent,
      child,
      tiered,
    );
    expect(ask).toMatchObject({ effect: "deny", ruleId: "subagent.no-user-interaction" });
    // 일반 도구는 막지 않는다
    expect(
      childDecision(evaluate, call({ tool: "read", risk: "read" }), parent, child, tiered).effect,
    ).toBe("allow");
  });

  // spec plan child_cannot_use_tool_denied_to_parent
  test("child_cannot_use_tool_denied_to_parent: a definition allow rule does not widen the parent's deny", () => {
    const parentDeny: TieredRule = {
      id: "user.no-bash",
      action: "tool.call",
      resource: { tool: "bash", caller: "main" },
      effect: "deny",
      tier: "user",
      source: "settings:user",
    };
    const definition = {
      ...EXPLORER,
      permissions: {
        rules: [
          {
            id: "allow-bash",
            action: "tool.call" as const,
            resource: { tool: "bash" },
            effect: "allow" as const,
          },
        ],
      },
    };
    const definitionTiered: readonly TieredRule[] = definitionRules(definition).map((rule) =>
      Object.assign({}, rule, { tier: "default" as const, source: AGENTS_RULE_SOURCE }),
    );
    expect(definitionTiered[0]).toMatchObject({
      id: "agent.explorer.allow-bash",
      resource: { tool: "bash", caller: "subagent:explorer" },
    });
    const parent = { caller: "main", depth: 0, mode: "default" } as const;
    const child = {
      caller: "subagent:explorer",
      depth: 1,
      mode: "default",
      definitionRules: definitionTiered,
    } as const;
    // 평가기는 첫 일치 규칙이 이기므로 부모 deny를 앞에 둔다. 부모 관점은 caller main인 호출에 부모 규칙을 적용한다
    const decision = childDecision(evaluate, call({ caller: "main", depth: 0 }), parent, child, [
      parentDeny,
    ]);
    expect(decision.effect).toBe("deny");
  });
});

describe("rule registration", () => {
  test("syncRules registers one core:agents rule set and follows definitions and maxDepth", () => {
    const h = openHarness({ maxDepth: 1 });
    const initial = h.tools.rules.get(AGENTS_RULE_SOURCE) ?? [];
    expect(initial.map((rule) => rule.id)).toEqual([
      "subagent.no-spawn",
      "subagent.no-user-interaction",
      "subagent.no-shared-write",
      "subagent.no-external-send",
    ]);
    const dispose = h.service.define({
      name: "reviewer",
      description: "Reviews.",
      prompt: "Review.",
      permissions: {
        rules: [{ id: "no-grep", action: "tool.call", resource: { tool: "grep" }, effect: "deny" }],
      },
      source: { kind: "user", path: "/u/reviewer.md" },
    });
    expect((h.tools.rules.get(AGENTS_RULE_SOURCE) ?? []).map((rule) => rule.id)).toContain(
      "agent.reviewer.no-grep",
    );
    dispose();
    expect((h.tools.rules.get(AGENTS_RULE_SOURCE) ?? []).map((rule) => rule.id)).not.toContain(
      "agent.reviewer.no-grep",
    );
    h.service.dispose();
    expect(h.tools.rules.has(AGENTS_RULE_SOURCE)).toBe(false);
  });
});
