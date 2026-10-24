import { expect, test } from "bun:test";
import type { PolicyInput, PolicyRule, TieredRule } from "@xeon/contracts/services";
import { evaluatePolicy, ruleMatches, stricter } from "../src/policy/engine.ts";
import { deriveRisk, modeDefault } from "../src/policy/modes.ts";
import { builtinRules, loadableRules, validateRules } from "../src/policy/rules.ts";
import { collectRules } from "../src/policy/tiers.ts";
import { layer } from "./support/harness.ts";

function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    action: "tool.call",
    tool: "bash",
    classes: [],
    risk: "exec",
    args: { command: "git status" },
    caller: "main",
    depth: 0,
    mode: "default",
    interactive: true,
    bypassAllowed: true,
    ...overrides,
  };
}

function rule(
  id: string,
  effect: PolicyRule["effect"],
  tier: TieredRule["tier"],
  resource: PolicyRule["resource"] = { tool: "bash" },
  priority?: number,
): TieredRule {
  return {
    id,
    action: "tool.call",
    resource,
    effect,
    tier,
    source: `test:${tier}`,
    ...(priority === undefined ? {} : { priority }),
  };
}

test("policy_higher_tier_deny_wins: managed deny beats user allow, user allow beats default ask", () => {
  const denied = evaluatePolicy(input(), [
    rule("m.deny", "deny", "managed"),
    rule("u.allow", "allow", "user"),
  ]);
  expect(denied).toMatchObject({
    effect: "deny",
    ruleId: "m.deny",
    tier: "managed",
    reason: "rule",
  });
  const allowed = evaluatePolicy(input(), [
    rule("d.ask", "ask", "default"),
    rule("u.allow", "allow", "user"),
  ]);
  expect(allowed).toMatchObject({ effect: "allow", ruleId: "u.allow", tier: "user" });
});

test("policy_deny_in_lower_tier_still_denies: no allow overturns a deny", () => {
  const decision = evaluatePolicy(input(), [
    rule("d.deny", "deny", "default"),
    rule("m.allow", "allow", "managed"),
  ]);
  expect(decision.effect).toBe("deny");
  expect(decision.ruleId).toBe("d.deny");
});

test("policy_same_tier_priority: higher priority wins, equal priority asks", () => {
  const first = evaluatePolicy(input(), [
    rule("a", "allow", "user", { tool: "bash" }, 600),
    rule("b", "ask", "user", { tool: "bash" }, 500),
  ]);
  expect(first.effect).toBe("allow");
  const second = evaluatePolicy(input(), [
    rule("a", "allow", "user", { tool: "bash" }, 500),
    rule("b", "ask", "user", { tool: "bash" }, 500),
  ]);
  expect(second.effect).toBe("ask");
  expect(second.ruleId).toBe("b");
});

test("policy_noninteractive_ask_becomes_deny", () => {
  const decision = evaluatePolicy(input({ interactive: false }), [rule("a", "ask", "default")]);
  expect(decision).toMatchObject({ effect: "deny", reason: "noninteractive" });
  expect(decision.message).toContain("noninteractive_ask_denied");
  const fromMode = evaluatePolicy(input({ interactive: false }), []);
  expect(fromMode).toMatchObject({ effect: "deny", reason: "noninteractive" });
});

test("policy_evaluator_pure: same frozen input gives the same decision", () => {
  const frozen = Object.freeze({ ...input(), args: Object.freeze({ command: "ls" }) });
  const rules = Object.freeze([Object.freeze(rule("a", "allow", "user"))]);
  const first = evaluatePolicy(frozen, rules);
  const second = evaluatePolicy(frozen, rules);
  expect(second).toEqual(first);
});

test("policy_invalid_regex_skipped: a bad pattern is reported and the other rules still apply", () => {
  const bad: PolicyRule = {
    id: "bad",
    action: "tool.call",
    resource: { tool: "bash", args: [{ pointer: "/command", pattern: "([" }] },
    effect: "deny",
  };
  const good: PolicyRule = {
    id: "good",
    action: "tool.call",
    resource: { tool: "bash" },
    effect: "allow",
  };
  const issues = validateRules([bad, good]);
  expect(issues).toHaveLength(1);
  expect(issues[0]).toMatchObject({ ruleId: "bad", code: "pattern_invalid" });
  const loaded = loadableRules([bad, good], issues);
  expect(loaded.map((entry) => entry.id)).toEqual(["good"]);
  // 적재되지 않았더라도 평가기는 예외 없이 일치하지 않는 것으로 본다
  expect(ruleMatches(bad, input())).toBe(false);
});

test("validateRules reports duplicate ids, priority range and pointers", () => {
  const rules: PolicyRule[] = [
    { id: "x", action: "tool.call", resource: {}, effect: "allow", priority: 1000 },
    {
      id: "x",
      action: "tool.call",
      resource: { args: [{ pointer: "command", pattern: "a" }] },
      effect: "deny",
    },
    { id: "y", action: "tool.call", resource: { tool: "" }, effect: "deny" },
  ];
  const codes = validateRules(rules).map((issue) => issue.code);
  expect(codes).toContain("rule_id_duplicate");
  expect(codes).toContain("priority_range");
  expect(codes).toContain("pointer_invalid");
  expect(codes).toContain("glob_invalid");
  // 중복 id는 처음 것만 남긴다. 범위 밖 priority 규칙은 빠진다
  expect(loadableRules(rules, validateRules(rules)).map((entry) => entry.id)).toEqual([]);
});

test("args conditions match JSON pointer values by regular expression", () => {
  const allowGit: PolicyRule = {
    id: "u.git-status",
    action: "tool.call",
    resource: { tool: "bash", args: [{ pointer: "/command", pattern: "^git status" }] },
    effect: "allow",
  };
  expect(ruleMatches(allowGit, input({ args: { command: "git status --short" } }))).toBe(true);
  expect(ruleMatches(allowGit, input({ args: { command: "rm -rf /" } }))).toBe(false);
  expect(ruleMatches(allowGit, input({ args: { other: 1 } }))).toBe(false);
  // 노출 판정(args null)에서는 인자 조건이 있는 규칙이 일치하지 않는다
  expect(ruleMatches(allowGit, input({ args: null }))).toBe(false);
});

test("non-string argument values are compared as sorted JSON", () => {
  const rule1: PolicyRule = {
    id: "r",
    action: "tool.call",
    resource: { args: [{ pointer: "/opts", pattern: '^\\{"a":1,"b":2\\}$' }] },
    effect: "allow",
  };
  expect(ruleMatches(rule1, input({ args: { opts: { b: 2, a: 1 } } }))).toBe(true);
});

test("resource fields: tool glob, risk, caller, minDepth, mode, mcpServer, capability, classes", () => {
  const base = { id: "r", action: "tool.call", effect: "allow" } as const;
  expect(ruleMatches({ ...base, resource: { tool: "b*h" } }, input())).toBe(true);
  expect(ruleMatches({ ...base, resource: { tool: "b??h" } }, input())).toBe(true);
  expect(ruleMatches({ ...base, resource: { tool: "rea*" } }, input())).toBe(false);
  expect(ruleMatches({ ...base, resource: { risk: ["read"] } }, input())).toBe(false);
  expect(ruleMatches({ ...base, resource: { risk: ["exec"] } }, input())).toBe(true);
  expect(ruleMatches({ ...base, resource: { caller: "main" } }, input())).toBe(true);
  expect(ruleMatches({ ...base, resource: { caller: "subagent" } }, input())).toBe(false);
  expect(
    ruleMatches(
      { ...base, resource: { caller: "subagent:rev" } },
      input({ caller: "subagent:rev" }),
    ),
  ).toBe(true);
  expect(ruleMatches({ ...base, resource: { minDepth: 1 } }, input({ depth: 0 }))).toBe(false);
  expect(ruleMatches({ ...base, resource: { minDepth: 1 } }, input({ depth: 2 }))).toBe(true);
  expect(ruleMatches({ ...base, resource: { mode: ["plan"] } }, input())).toBe(false);
  expect(
    ruleMatches({ ...base, resource: { mcpServer: "gi*" } }, input({ mcpServer: "github" })),
  ).toBe(true);
  expect(ruleMatches({ ...base, resource: { mcpServer: "gi*" } }, input())).toBe(false);
  expect(
    ruleMatches(
      { ...base, resource: { capability: "workspace.*" } },
      input({ capability: "workspace.shell" }),
    ),
  ).toBe(true);
  expect(
    ruleMatches(
      { ...base, resource: { classes: ["spawn"] } },
      input({ classes: ["spawn", "external_send"] }),
    ),
  ).toBe(true);
});

test("plan mode denies write and exec but allows read; reads still pass", () => {
  expect(evaluatePolicy(input({ mode: "plan", risk: "exec" }), []).effect).toBe("deny");
  expect(evaluatePolicy(input({ mode: "plan", risk: "write" }), []).effect).toBe("deny");
  expect(evaluatePolicy(input({ mode: "plan", risk: "read", tool: "read" }), []).effect).toBe(
    "allow",
  );
});

test("bypass allows everything except deny rules; a managed ban demotes it to default", () => {
  expect(evaluatePolicy(input({ mode: "bypass" }), [])).toMatchObject({
    effect: "allow",
    reason: "mode",
  });
  expect(evaluatePolicy(input({ mode: "bypass" }), [rule("d", "deny", "default")]).effect).toBe(
    "deny",
  );
  const banned = evaluatePolicy(input({ mode: "bypass", bypassAllowed: false }), []);
  expect(banned).toMatchObject({ effect: "ask", reason: "bypass_forbidden" });
});

test("builtin rules: read and ls are allowed, bash asks, others follow the mode", () => {
  const rules: TieredRule[] = [];
  for (const entry of builtinRules()) {
    rules.push({ ...entry, tier: "default", source: "core:tools" });
  }
  expect(evaluatePolicy(input({ tool: "read", risk: "read" }), rules)).toMatchObject({
    effect: "allow",
    reason: "rule",
  });
  expect(evaluatePolicy(input({ tool: "ls", risk: "exec" }), rules).effect).toBe("allow");
  expect(evaluatePolicy(input({ tool: "bash" }), rules)).toMatchObject({
    effect: "ask",
    ruleId: "default.bash-ask",
  });
  expect(evaluatePolicy(input({ tool: "write", risk: "write" }), rules)).toMatchObject({
    effect: "ask",
    reason: "mode",
  });
});

test("undeclared_risk_is_exec: no declaration and no readOnly hint means exec", () => {
  expect(deriveRisk(undefined, undefined)).toBe("exec");
  expect(deriveRisk(undefined, { readOnly: false })).toBe("exec");
  expect(deriveRisk(undefined, { readOnly: true })).toBe("read");
  expect(deriveRisk("write", { readOnly: true })).toBe("write");
});

test("mode defaults follow the table", () => {
  expect(modeDefault("default", "read")).toBe("allow");
  expect(modeDefault("default", "write")).toBe("ask");
  expect(modeDefault("acceptEdits", "write")).toBe("allow");
  expect(modeDefault("acceptEdits", "exec")).toBe("ask");
  expect(modeDefault("plan", "exec")).toBe("deny");
  expect(modeDefault("bypass", "exec")).toBe("allow");
});

test("stricter prefers deny over ask over allow and keeps the first on a tie", () => {
  const allow = { effect: "allow", reason: "rule", ruleId: "a", tier: "user" } as const;
  const ask = { effect: "ask", reason: "rule", ruleId: "b", tier: "user" } as const;
  const deny = { effect: "deny", reason: "rule", ruleId: "c", tier: "user" } as const;
  expect(stricter(allow, ask)).toBe(ask);
  expect(stricter(deny, ask)).toBe(deny);
  expect(stricter(ask, deny)).toBe(deny);
  expect(stricter(allow, { ...allow, ruleId: "z" })).toBe(allow);
});

test("collectRules tags settings layers as user or managed and drops invalid rules", () => {
  const collected = collectRules([
    layer(
      "managed",
      {
        "l1.tools.rules": [
          { id: "m.deny", action: "tool.call", resource: { tool: "rm*" }, effect: "deny" },
        ],
      },
      "/etc/xeon/managed.json",
    ),
    layer("user", {
      "l1.tools.rules": [
        {
          id: "u.git",
          action: "tool.call",
          resource: { tool: "bash", args: [{ pointer: "/command", pattern: "^git status" }] },
          effect: "allow",
        },
        { id: "broken", action: "other", resource: {}, effect: "allow" },
        {
          id: "badre",
          action: "tool.call",
          resource: { args: [{ pointer: "/c", pattern: "(" }] },
          effect: "deny",
        },
      ],
    }),
    layer("session", { "l1.tools.rules": "not an array" }),
  ]);
  const ids = collected.rules.map((entry) => `${entry.tier}:${entry.id}`);
  expect(ids).toContain("default:default.bash-ask");
  expect(ids).toContain("managed:m.deny");
  expect(ids).toContain("user:u.git");
  expect(ids).not.toContain("user:broken");
  expect(ids).not.toContain("user:badre");
  expect(collected.issues.map((issue) => issue.code).toSorted()).toEqual([
    "pattern_invalid",
    "schema_invalid",
    "schema_invalid",
  ]);
  const managed = collected.rules.find((entry) => entry.id === "m.deny");
  expect(managed?.source).toBe("settings:managed:/etc/xeon/managed.json");
});
