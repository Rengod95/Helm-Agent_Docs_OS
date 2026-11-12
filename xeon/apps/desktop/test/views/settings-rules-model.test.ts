import { describe, expect, test } from "bun:test";
import type { PolicyResource, PolicyRule } from "@fresnel/contracts/services";
import {
  conflictsOf,
  globsOverlap,
  partnersOf,
  patternTextOf,
  resourceOfPattern,
  ruleIdFor,
  rulesOverlap,
  ruleListOf,
  ruleOfPattern,
  ruleSummaryOf,
  withEffect,
  withMemo,
  withoutRule,
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

describe("bash command prefixes", () => {
  const git = rule("a", "allow", {
    tool: "bash",
    args: [{ pointer: "/command", pattern: "^git status( |$)" }],
  });
  const rm = rule("b", "deny", {
    tool: "bash",
    args: [{ pointer: "/command", pattern: "^rm -rf( |$)" }],
  });

  test("two different prefixes do not overlap, a plain bash rule overlaps both", () => {
    expect(rulesOverlap(git, rm)).toBe(false);
    expect(rulesOverlap(git, rule("c", "deny", { tool: "bash" }))).toBe(true);
    expect(conflictsOf([git, rm])).toEqual([]);
  });

  test("a prefix that starts another prefix overlaps", () => {
    const gitAll = rule("d", "deny", {
      tool: "bash",
      args: [{ pointer: "/command", pattern: "^git( |$)" }],
    });
    expect(rulesOverlap(git, gitAll)).toBe(true);
  });
});

describe("pattern text", () => {
  test("a tool glob, all tools and a bash prefix read back as typed", () => {
    expect(patternTextOf(rule("a", "allow"))).toBe("*");
    expect(patternTextOf(rule("b", "allow", { tool: "mcp__github__*" }))).toBe("mcp__github__*");
    expect(
      patternTextOf(
        rule("c", "allow", {
          tool: "bash",
          args: [{ pointer: "/command", pattern: "^git status( |$)" }],
        }),
      ),
    ).toBe("bash(git status)");
  });

  test("an escaped prefix is unescaped", () => {
    expect(
      patternTextOf(
        rule("a", "deny", {
          tool: "bash",
          args: [{ pointer: "/command", pattern: "^rm \\-rf \\.\\*( |$)" }],
        }),
      ),
    ).toBe("bash(rm -rf .*)");
  });

  test("rules with other conditions are not a pattern and show a summary", () => {
    const server = rule("a", "ask", { mcpServer: "docs" });
    expect(patternTextOf(server)).toBeNull();
    expect(ruleSummaryOf(server)).toBe("docs");
    const regex = rule("b", "deny", {
      tool: "bash",
      args: [{ pointer: "/command", pattern: "^(git|hg) push" }],
    });
    expect(patternTextOf(regex)).toBeNull();
    expect(ruleSummaryOf(regex)).toBe("bash");
  });

  test("typed text becomes a resource, and the resource reads back as the same text", () => {
    expect(resourceOfPattern(" * ")).toEqual({ ok: true, value: {} });
    expect(resourceOfPattern("read")).toEqual({ ok: true, value: { tool: "read" } });
    expect(resourceOfPattern("bash()")).toEqual({ ok: true, value: { tool: "bash" } });
    const typed = "bash(npm run *.ts)";
    const made = resourceOfPattern(typed);
    expect(made).toEqual({
      ok: true,
      value: {
        tool: "bash",
        args: [{ pointer: "/command", pattern: "^npm run \\*\\.ts( |$)" }],
      },
    });
    if (made.ok) expect(patternTextOf(rule("x", "allow", made.value))).toBe(typed);
  });

  test("bad text is refused with a reason", () => {
    expect(resourceOfPattern("  ")).toEqual({ ok: false, error: "patternEmpty" });
    expect(resourceOfPattern("read(x)")).toEqual({ ok: false, error: "patternCommandOnly" });
    expect(resourceOfPattern("git status")).toEqual({ ok: false, error: "patternForm" });
    expect(resourceOfPattern("t".repeat(129))).toEqual({ ok: false, error: "patternLong" });
  });
});

describe("new rules from the add row", () => {
  const rules = [
    rule("allow-read", "allow", { tool: "read" }),
    rule("deny-bash", "deny", { tool: "bash" }),
  ];

  test("the id is effect and tool, numbered when taken", () => {
    expect(ruleIdFor("ask", { tool: "bash" }, rules)).toBe("ask-bash");
    expect(ruleIdFor("allow", { tool: "read" }, rules)).toBe("allow-read-2");
    expect(ruleIdFor("deny", {}, rules)).toBe("deny-all");
    expect(ruleIdFor("allow", { tool: "mcp__gh__*" }, rules)).toBe("allow-mcp__gh__");
  });

  test("a new rule carries the memo, an empty memo adds no description", () => {
    expect(ruleOfPattern({ pattern: "web_fetch", effect: "ask", memo: " 외부 " }, rules)).toEqual({
      ok: true,
      value: {
        id: "ask-web_fetch",
        action: "tool.call",
        resource: { tool: "web_fetch" },
        effect: "ask",
        description: "외부",
      },
    });
    expect(ruleOfPattern({ pattern: "*", effect: "deny", memo: "" }, rules)).toEqual({
      ok: true,
      value: { id: "deny-all", action: "tool.call", resource: {}, effect: "deny" },
    });
  });

  test("the same pattern with the same verdict is a duplicate, another verdict is not", () => {
    expect(ruleOfPattern({ pattern: "read", effect: "allow", memo: "" }, rules)).toEqual({
      ok: false,
      error: "patternDuplicate",
    });
    expect(ruleOfPattern({ pattern: "read", effect: "deny", memo: "" }, rules).ok).toBe(true);
    expect(ruleOfPattern({ pattern: "x", effect: "deny", memo: "m".repeat(501) }, rules)).toEqual({
      ok: false,
      error: "memoLong",
    });
  });
});

describe("row edits", () => {
  test("the edits return a new list and touch only their row", () => {
    const bash = rule("a", "allow", { tool: "bash" });
    const ask = rule("b", "ask");
    const rules = [bash, ask];
    expect(withEffect(rules, 1, "deny")).toEqual([bash, rule("b", "deny")]);
    expect(withoutRule(rules, 0)).toEqual([ask]);
    expect(rules).toEqual([bash, ask]);
  });

  test("a memo is set trimmed, cleared when empty, and the priority stays", () => {
    const rules: readonly PolicyRule[] = [{ ...rule("a", "allow"), priority: 20 }];
    const set = withMemo(rules, 0, "  이유  ");
    expect(set).toEqual([{ ...rule("a", "allow"), priority: 20, description: "이유" }]);
    const cleared = withMemo(set, 0, " ");
    expect(cleared).toEqual([{ ...rule("a", "allow"), priority: 20 }]);
    expect(Object.hasOwn(cleared[0] ?? {}, "description")).toBe(false);
  });
});
