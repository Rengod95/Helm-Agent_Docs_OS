import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  AGENT_NAME_PATTERN,
  AGENT_REPORT_TYPE,
  AgentDefinitionSchema,
  PERMISSION_MODE_STRICTNESS,
  POLICY_TIER_ORDER,
  PolicyRuleSchema,
  TOOL_RISK_ORDER,
  TOOL_SEARCH_NAME,
} from "../../src/services/index.ts";

describe("tool and policy constants", () => {
  test("orders", () => {
    expect(TOOL_RISK_ORDER).toEqual(["read", "write", "exec"]);
    expect(POLICY_TIER_ORDER).toEqual(["default", "extension", "user", "managed"]);
    // 엄격한 쪽이 앞이다
    expect(PERMISSION_MODE_STRICTNESS).toEqual(["plan", "default", "acceptEdits", "bypass"]);
    expect(TOOL_SEARCH_NAME).toBe("tool_search");
  });
});

describe("PolicyRuleSchema", () => {
  const rule = {
    id: "user.allow-git-status",
    action: "tool.call",
    resource: {
      tool: "bash",
      risk: ["exec"],
      args: [{ pointer: "/command", pattern: "^git status$" }],
      caller: "subagent:review",
      minDepth: 1,
      mode: ["default"],
    },
    effect: "allow",
    priority: 700,
  };

  test("accepts a full rule", () => {
    expect(parse(PolicyRuleSchema, rule).ok).toBe(true);
    expect(parse(PolicyRuleSchema, { ...rule, resource: {} }).ok).toBe(true);
  });

  test("rejects out-of-range or unknown values", () => {
    expect(parse(PolicyRuleSchema, { ...rule, priority: 1000 }).ok).toBe(false);
    expect(parse(PolicyRuleSchema, { ...rule, effect: "maybe" }).ok).toBe(false);
    expect(parse(PolicyRuleSchema, { ...rule, action: "shell.command" }).ok).toBe(false);
    expect(parse(PolicyRuleSchema, { ...rule, resource: { caller: "robot" } }).ok).toBe(false);
    expect(
      parse(PolicyRuleSchema, {
        ...rule,
        resource: { args: [{ pointer: "command", pattern: "x" }] },
      }).ok,
    ).toBe(false);
    expect(parse(PolicyRuleSchema, { ...rule, extra: true }).ok).toBe(false);
  });
});

describe("AgentDefinitionSchema", () => {
  const definition = {
    name: "reviewer",
    description: "Reviews diffs",
    prompt: "You review code.",
    tools: ["read", "grep"],
    model: "review",
    permissions: { mode: "plan" },
  };

  test("accepts a definition front matter", () => {
    expect(parse(AgentDefinitionSchema, definition).ok).toBe(true);
    expect(new RegExp(AGENT_NAME_PATTERN).test("reviewer")).toBe(true);
  });

  test("rejects bad names and unknown keys; the source comes from the file location", () => {
    expect(parse(AgentDefinitionSchema, { ...definition, name: "Reviewer" }).ok).toBe(false);
    expect(parse(AgentDefinitionSchema, { ...definition, name: "a" }).ok).toBe(false);
    expect(parse(AgentDefinitionSchema, { ...definition, source: { kind: "builtin" } }).ok).toBe(
      false,
    );
  });

  test("the report type is fixed", () => {
    expect(AGENT_REPORT_TYPE).toBe("agent.report");
  });
});
