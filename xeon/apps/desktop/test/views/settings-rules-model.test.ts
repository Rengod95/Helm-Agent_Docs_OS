import { describe, expect, test } from "bun:test";
import type { PolicyResource, PolicyRule } from "@fresnel/contracts/services";
import {
  checkId,
  checkTool,
  conflictsOf,
  globsOverlap,
  partnersOf,
  priorityOf,
  rulesOverlap,
  ruleListOf,
  ruleOfDraft,
  toolTextOf,
  withEffect,
  withId,
  withoutRule,
  withPriority,
  withTool,
} from "../../src/views/pages/settings/settings-rules-model.ts";

// 권한 규칙 모델(L4.desktop-ux §6.13). 겹침은 글롭과 목록 칸으로 보고, 값은 `toEqual`과 `toBe`로 비교한다.

function rule(id: string, effect: PolicyRule["effect"], resource: PolicyResource = {}): PolicyRule {
  return { id, action: "tool.call", resource, effect };
}

describe("globsOverlap", () => {
  test("equal names overlap and different names do not", () => {
    expect(globsOverlap("bash", "bash")).toBe(true);
    expect(globsOverlap("bash", "read")).toBe(false);
  });

  test("a star matches any run of characters, including none", () => {
    expect(globsOverlap("*", "bash")).toBe(true);
    expect(globsOverlap("mcp__*", "mcp__x__y")).toBe(true);
    expect(globsOverlap("mcp__*", "bash")).toBe(false);
    expect(globsOverlap("*", "")).toBe(true);
    expect(globsOverlap("", "*")).toBe(true);
    expect(globsOverlap("", "a")).toBe(false);
  });

  test("a question mark matches one character", () => {
    expect(globsOverlap("bas?", "bash")).toBe(true);
    expect(globsOverlap("ba?", "bash")).toBe(false);
  });

  test("two patterns with wildcards overlap when some name fits both", () => {
    expect(globsOverlap("a*b", "ac")).toBe(false);
    expect(globsOverlap("a?c", "a*c")).toBe(true);
    expect(globsOverlap("*a*", "xyz")).toBe(false);
    expect(globsOverlap("file.*", "*.ts")).toBe(true);
  });
});

describe("rulesOverlap", () => {
  test("the same tool overlaps, another tool does not", () => {
    expect(
      rulesOverlap(rule("a", "allow", { tool: "bash" }), rule("b", "deny", { tool: "bash" })),
    ).toBe(true);
    expect(
      rulesOverlap(rule("a", "allow", { tool: "read" }), rule("b", "deny", { tool: "bash" })),
    ).toBe(false);
  });

  test("a rule without a tool applies to every tool", () => {
    expect(rulesOverlap(rule("a", "allow"), rule("b", "deny", { tool: "bash" }))).toBe(true);
  });

  test("disjoint classes do not overlap, and a missing list does", () => {
    const spawn = rule("a", "allow", { classes: ["spawn"] });
    const send = rule("b", "deny", { classes: ["external_send"] });
    expect(rulesOverlap(spawn, send)).toBe(false);
    expect(rulesOverlap(spawn, rule("c", "deny", { classes: ["spawn", "external_send"] }))).toBe(
      true,
    );
    expect(rulesOverlap(spawn, rule("d", "deny"))).toBe(true);
  });

  test("the caller family overlaps with its members only", () => {
    const main = rule("a", "allow", { caller: "main" });
    expect(rulesOverlap(main, rule("b", "deny", { caller: "subagent" }))).toBe(false);
    expect(
      rulesOverlap(
        rule("c", "allow", { caller: "subagent" }),
        rule("d", "deny", { caller: "subagent:worker" }),
      ),
    ).toBe(true);
    expect(
      rulesOverlap(
        rule("e", "allow", { caller: "subagent:a" }),
        rule("f", "deny", { caller: "subagent:b" }),
      ),
    ).toBe(false);
  });

  test("capability and server globs are checked too", () => {
    expect(
      rulesOverlap(
        rule("a", "allow", { capability: "fs.*" }),
        rule("b", "deny", { capability: "net.*" }),
      ),
    ).toBe(false);
    expect(
      rulesOverlap(
        rule("c", "allow", { mcpServer: "docs" }),
        rule("d", "deny", { mcpServer: "doc*" }),
      ),
    ).toBe(true);
  });
});

describe("conflictsOf and partnersOf", () => {
  const rules: readonly PolicyRule[] = [
    rule("allow-bash", "allow", { tool: "bash" }),
    rule("deny-bash", "deny", { tool: "bash" }),
    rule("ask-bash", "ask", { tool: "bash" }),
    rule("allow-read", "allow", { tool: "read" }),
    rule("deny-all", "deny"),
  ];

  test("an allow and a deny that overlap are listed by row, ask rules never conflict", () => {
    expect(conflictsOf(rules)).toEqual([
      { allow: 0, deny: 1 },
      { allow: 0, deny: 4 },
      { allow: 3, deny: 4 },
    ]);
  });

  test("a row lists its partners from the other side", () => {
    const conflicts = conflictsOf(rules);
    expect(partnersOf(conflicts, 0)).toEqual([1, 4]);
    expect(partnersOf(conflicts, 4)).toEqual([0, 3]);
    expect(partnersOf(conflicts, 2)).toEqual([]);
  });

  test("two allow rules or two deny rules never conflict", () => {
    expect(conflictsOf([rule("a", "allow"), rule("b", "allow")])).toEqual([]);
    expect(conflictsOf([rule("a", "deny"), rule("b", "deny")])).toEqual([]);
  });
});

describe("ruleListOf", () => {
  test("a list of valid rules reads back unchanged", () => {
    const value: PolicyRule[] = [rule("r1", "allow", { tool: "bash" })];
    expect(ruleListOf(value)).toEqual(value);
    expect(ruleListOf([])).toEqual([]);
  });

  test("one bad rule, or a value that is not a list, reads as unreadable", () => {
    expect(
      ruleListOf([{ id: "r1", action: "tool.call", resource: {}, effect: "maybe" }]),
    ).toBeNull();
    expect(ruleListOf({ id: "r1" })).toBeNull();
    expect(ruleListOf("bash")).toBeNull();
  });
});

describe("rule values", () => {
  test("the tool text is empty for all tools and the priority defaults to 500", () => {
    expect(toolTextOf(rule("a", "allow"))).toBe("");
    expect(toolTextOf(rule("b", "allow", { tool: "bash" }))).toBe("bash");
    expect(priorityOf(rule("a", "allow"))).toBe(500);
    expect(priorityOf({ ...rule("b", "allow"), priority: 20 })).toBe(20);
  });

  test("the edits return a new list and touch only their row", () => {
    const rules = [rule("a", "allow", { tool: "bash" }), rule("b", "ask")];
    const bash = rule("a", "allow", { tool: "bash" });
    const ask = rule("b", "ask");
    expect(withEffect(rules, 1, "deny")).toEqual([bash, rule("b", "deny")]);
    expect(withPriority(rules, 0, 10)).toEqual([{ ...bash, priority: 10 }, ask]);
    expect(withId(rules, 1, "c")).toEqual([bash, rule("c", "ask")]);
    expect(withoutRule(rules, 0)).toEqual([ask]);
    expect(rules).toEqual([bash, ask]);
  });

  test("an empty tool text removes the tool and a tool text is trimmed", () => {
    const rules = [rule("a", "allow", { tool: "bash", caller: "main" })];
    const cleared = withTool(rules, 0, "  ");
    expect(cleared).toEqual([rule("a", "allow", { caller: "main" })]);
    expect(Object.hasOwn(cleared[0]?.resource ?? {}, "tool")).toBe(false);
    expect(withTool(rules, 0, " read ")).toEqual([
      rule("a", "allow", { tool: "read", caller: "main" }),
    ]);
  });
});

describe("checks for a rule name and a tool", () => {
  const rules = [rule("a", "allow"), rule("b", "deny")];

  test("a name is trimmed, must not be empty, must be new unless it is the row itself", () => {
    expect(checkId(" c ", rules, null)).toEqual({ ok: true, value: "c" });
    expect(checkId("  ", rules, null)).toEqual({ ok: false, error: "empty" });
    expect(checkId("b", rules, null)).toEqual({ ok: false, error: "duplicate" });
    expect(checkId("b", rules, 1)).toEqual({ ok: true, value: "b" });
    expect(checkId("x".repeat(129), rules, null)).toEqual({ ok: false, error: "long" });
  });

  test("a tool name longer than 128 characters is refused", () => {
    expect(checkTool(" bash ")).toEqual({ ok: true, value: "bash" });
    expect(checkTool("t".repeat(129))).toEqual({ ok: false, error: "toolLong" });
  });

  test("a new rule needs a name, and an empty tool means all tools", () => {
    expect(ruleOfDraft({ id: "", tool: "", effect: "ask" }, rules)).toEqual({
      ok: false,
      error: "empty",
    });
    expect(ruleOfDraft({ id: "a", tool: "", effect: "ask" }, rules)).toEqual({
      ok: false,
      error: "duplicate",
    });
    expect(ruleOfDraft({ id: "c", tool: "bash", effect: "deny" }, rules)).toEqual({
      ok: true,
      value: { id: "c", action: "tool.call", resource: { tool: "bash" }, effect: "deny" },
    });
    expect(ruleOfDraft({ id: "d", tool: "", effect: "allow" }, rules)).toEqual({
      ok: true,
      value: { id: "d", action: "tool.call", resource: {}, effect: "allow" },
    });
  });
});
