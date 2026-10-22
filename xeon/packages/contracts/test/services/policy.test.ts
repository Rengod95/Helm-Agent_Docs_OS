import { describe, expect, test } from "bun:test";
import {
  childDecision,
  matchToolGlob,
  stricter,
  type ChildPolicyView,
  type PolicyCeiling,
  type PolicyDecision,
  type PolicyEvaluator,
  type PolicyInput,
  type TieredRule,
} from "../../src/services/index.ts";

const ALLOW: PolicyDecision = { effect: "allow", reason: "mode", ruleId: null, tier: null };
const ASK: PolicyDecision = { effect: "ask", reason: "mode", ruleId: null, tier: null };
const DENY: PolicyDecision = {
  effect: "deny",
  reason: "rule",
  ruleId: "user.deny",
  tier: "user",
  message: "denied",
};

const CALL: PolicyInput = {
  action: "tool.call",
  tool: "bash",
  classes: [],
  risk: "exec",
  args: { command: "ls" },
  caller: "main",
  depth: 0,
  mode: "default",
  interactive: true,
  bypassAllowed: true,
};

const PARENT: PolicyCeiling = { caller: "main", depth: 0, mode: "default" };
const CHILD: ChildPolicyView = { caller: "subagent:review", depth: 1, mode: "default" };

/** 입력의 caller·mode·규칙 수에 따라 정해진 결정을 내는 대역. 호출 기록을 남긴다 */
function recordingEvaluator(
  table: (input: PolicyInput, rules: readonly TieredRule[]) => PolicyDecision,
): { readonly evaluate: PolicyEvaluator; readonly calls: PolicyInput[] } {
  const calls: PolicyInput[] = [];
  return {
    calls,
    evaluate(input, rules) {
      calls.push(input);
      return table(input, rules);
    },
  };
}

describe("stricter", () => {
  test("deny beats ask beats allow and ties keep the first", () => {
    expect(stricter(ALLOW, ASK)).toBe(ASK);
    expect(stricter(ASK, ALLOW)).toBe(ASK);
    expect(stricter(ASK, DENY)).toBe(DENY);
    expect(stricter(DENY, ALLOW)).toBe(DENY);
    const otherAsk: PolicyDecision = { ...ASK, reason: "rule", ruleId: "x", tier: "user" };
    expect(stricter(ASK, otherAsk)).toBe(ASK);
  });
});

describe("matchToolGlob", () => {
  test("star and question mark", () => {
    const cases: readonly [string, string, boolean][] = [
      ["*", "anything", true],
      ["*", "", true],
      ["bash", "bash", true],
      ["bash", "bash2", false],
      ["web_*", "web_search", true],
      ["web_*", "web_", true],
      ["web_*", "xweb_search", false],
      ["*_search", "web_search", true],
      ["*_search", "web_searcher", false],
      ["a?c", "abc", true],
      ["a?c", "ac", false],
      ["a?c", "abbc", false],
      ["mcp_*_read", "mcp_github_read", true],
      ["mcp_*_read", "mcp_github_write", false],
      ["a*b*c", "aXXbYYc", true],
      ["a*b*c", "aXXbYY", false],
      ["", "", true],
      ["", "a", false],
      ["a.c", "abc", false],
      ["a.c", "a.c", true],
    ];
    for (const [pattern, name, expected] of cases) {
      expect({ pattern, name, matched: matchToolGlob(pattern, name) }).toEqual({
        pattern,
        name,
        matched: expected,
      });
    }
  });
});

describe("childDecision", () => {
  test("evaluates the call from the parent view and the child view with the same rules", () => {
    const { evaluate, calls } = recordingEvaluator(() => ALLOW);
    const rules: readonly TieredRule[] = [];
    const decision = childDecision(evaluate, CALL, PARENT, CHILD, rules);
    expect(decision).toBe(ALLOW);
    expect(calls.map((c) => [c.caller, c.depth, c.mode])).toEqual([
      ["main", 0, "default"],
      ["subagent:review", 1, "default"],
    ]);
    // 호출 자체의 나머지 필드는 그대로다
    for (const call of calls)
      expect({ ...call, caller: "main", depth: 0, mode: "default" }).toEqual(CALL);
  });

  test("the child never gets a wider decision than the parent", () => {
    const parentDenies = recordingEvaluator((input) => (input.caller === "main" ? DENY : ALLOW));
    expect(childDecision(parentDenies.evaluate, CALL, PARENT, CHILD, [])).toBe(DENY);
    const childAsks = recordingEvaluator((input) => (input.caller === "main" ? ALLOW : ASK));
    expect(childDecision(childAsks.evaluate, CALL, PARENT, CHILD, [])).toBe(ASK);
    const parentPlan = recordingEvaluator((input) => (input.mode === "plan" ? DENY : ALLOW));
    const planParent: PolicyCeiling = { caller: "main", depth: 0, mode: "plan" };
    expect(childDecision(parentPlan.evaluate, CALL, planParent, CHILD, [])).toBe(DENY);
  });

  test("definition rules reach only the child-view evaluation", () => {
    const extra: TieredRule = {
      id: "agent.review.allow",
      action: "tool.call",
      resource: { tool: "bash" },
      effect: "allow",
      tier: "default",
      source: "agent:review",
    };
    const seen: (readonly TieredRule[])[] = [];
    const { evaluate } = recordingEvaluator((_input, rules) => {
      seen.push(rules);
      return ALLOW;
    });
    childDecision(evaluate, CALL, PARENT, { ...CHILD, definitionRules: [extra] }, []);
    expect(seen).toEqual([[], [extra]]);
  });

  test("the definition tool limit denies tools outside the globs", () => {
    const { evaluate } = recordingEvaluator(() => ALLOW);
    const limited: PolicyCeiling = { ...PARENT, allow: ["read", "grep", "web_*"] };
    const denied = childDecision(evaluate, CALL, limited, CHILD, []);
    expect(denied.effect).toBe("deny");
    expect(denied.ruleId).toBe("agent.review.tools");
    expect(denied.message).toContain('"bash"');
    const web = childDecision(evaluate, { ...CALL, tool: "web_search" }, limited, CHILD, []);
    expect(web).toBe(ALLOW);
  });

  test("an empty allow list blocks everything and a missing one blocks nothing", () => {
    const { evaluate } = recordingEvaluator(() => ALLOW);
    expect(childDecision(evaluate, CALL, { ...PARENT, allow: [] }, CHILD, []).effect).toBe("deny");
    expect(childDecision(evaluate, CALL, PARENT, CHILD, []).effect).toBe("allow");
  });

  test("a limit deny keeps the stricter existing deny rule id", () => {
    const { evaluate } = recordingEvaluator(() => DENY);
    const limited: PolicyCeiling = { ...PARENT, allow: ["read"] };
    expect(childDecision(evaluate, CALL, limited, CHILD, []).ruleId).toBe("user.deny");
  });

  test("a caller without an agent name uses a generic limit id", () => {
    const { evaluate } = recordingEvaluator(() => ALLOW);
    const decision = childDecision(
      evaluate,
      CALL,
      { ...PARENT, allow: [] },
      { ...CHILD, caller: "main" },
      [],
    );
    expect(decision.ruleId).toBe("agent.tools");
  });

  test("an ask becomes a non-interactive deny when nobody can answer", () => {
    const { evaluate } = recordingEvaluator(() => ASK);
    const decision = childDecision(evaluate, { ...CALL, interactive: false }, PARENT, CHILD, []);
    expect(decision.effect).toBe("deny");
    expect(decision.reason).toBe("noninteractive");
    expect(decision.message).toContain("xeon:noninteractive_ask_denied");
    expect(childDecision(evaluate, CALL, PARENT, CHILD, []).effect).toBe("ask");
  });

  test("does not change its inputs and is deterministic", () => {
    const { evaluate } = recordingEvaluator((input) => (input.depth === 0 ? ALLOW : ASK));
    const before = JSON.stringify([CALL, PARENT, CHILD]);
    const first = childDecision(evaluate, CALL, PARENT, CHILD, []);
    const second = childDecision(evaluate, CALL, PARENT, CHILD, []);
    expect(first).toEqual(second);
    expect(JSON.stringify([CALL, PARENT, CHILD])).toBe(before);
  });
});
