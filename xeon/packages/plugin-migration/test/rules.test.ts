// 규칙 데이터 시험: 스키마 검증(알 수 없는 필드 거부), 번들 규칙의 불변 조건, 규칙 고르기.
import { expect, test } from "bun:test";
import {
  bundledRulesets,
  findRule,
  parseRuleset,
  toolNameFor,
  type Ruleset,
} from "../src/rules.ts";

function bundledOrFail(): readonly Ruleset[] {
  const bundled = bundledRulesets();
  if (!bundled.ok) throw new Error(`bundled rules are invalid: ${bundled.error.source}`);
  return bundled.value;
}

const BUNDLED_RULESETS = bundledOrFail();

test("the bundled rule files load through the schema", () => {
  const bundled = bundledRulesets();
  expect(bundled.ok).toBe(true);
});

function validRuleset(): Record<string, unknown> {
  return {
    harness: "claude-code",
    rulesVersion: "2026-11-17",
    docs: ["https://code.claude.com/docs/en/skills"],
    toolNames: { Bash: "bash" },
    rules: [
      {
        match: { kind: "field", container: "skill", key: "allowed-tools" },
        status: "not_ported",
        reason: { code: "skill_preapproval_unsupported", text: "스킬별 도구 미리 승인이 없다." },
        difference: { kind: "approval_flow", text: "승인 카드가 더 뜰 수 있다." },
        alternative: "권한 모드를 올린다.",
      },
    ],
  };
}

function rulesetNamed(harness: string): Ruleset {
  const found = BUNDLED_RULESETS.find((ruleset) => ruleset.harness === harness);
  if (found === undefined) throw new Error(`no bundled ruleset for ${harness}`);
  return found;
}

test("a well-formed ruleset passes the schema", () => {
  const checked = parseRuleset(validRuleset());
  expect(checked.ok).toBe(true);
});

test("an unknown field at the ruleset, rule, or match level is rejected", () => {
  const topLevel = { ...validRuleset(), extra: true };
  expect(parseRuleset(topLevel).ok).toBe(false);

  const ruleLevel = {
    ...validRuleset(),
    rules: [
      { match: { kind: "field", container: "skill", key: "x" }, status: "exact", surprise: 1 },
    ],
  };
  expect(parseRuleset(ruleLevel).ok).toBe(false);

  const matchLevel = {
    ...validRuleset(),
    rules: [{ match: { kind: "field", unknownKey: "x" }, status: "exact" }],
  };
  expect(parseRuleset(matchLevel).ok).toBe(false);
});

test("an unknown status, a bad difference kind, or a missing rulesVersion is rejected", () => {
  const badStatus = { ...validRuleset(), rules: [{ match: { code: "x" }, status: "maybe" }] };
  expect(parseRuleset(badStatus).ok).toBe(false);

  const badDifference = {
    ...validRuleset(),
    rules: [{ match: { code: "x" }, status: "differs", difference: { kind: "fun", text: "x" } }],
  };
  expect(parseRuleset(badDifference).ok).toBe(false);

  const withoutVersion = validRuleset();
  delete withoutVersion["rulesVersion"];
  expect(parseRuleset(withoutVersion).ok).toBe(false);
});

test("the bundled rulesets are the three harnesses, all at the same reading date", () => {
  expect(BUNDLED_RULESETS.map((ruleset) => ruleset.harness)).toEqual([
    "claude-code",
    "agent-skills",
    "agents-md",
  ]);
  for (const ruleset of BUNDLED_RULESETS) {
    expect(ruleset.rulesVersion).toBe("2026-11-17");
    expect(ruleset.docs.length).toBeGreaterThan(0);
  }
});

test("every not_ported rule in the bundled data says why", () => {
  for (const ruleset of BUNDLED_RULESETS) {
    for (const rule of ruleset.rules) {
      if (rule.status === "not_ported") {
        expect(rule.reason).toBeDefined();
      }
    }
  }
});

test("a permission mode picks its rule by value, with the bypass difference and the plan refusal", () => {
  const claude = rulesetNamed("claude-code");
  const query = { kind: "field" as const, container: "agent", key: "permissionMode" };
  expect(findRule(claude, { ...query, value: "acceptEdits" })?.status).toBe("exact");
  const bypass = findRule(claude, { ...query, value: "bypassPermissions" });
  expect(bypass?.status).toBe("differs");
  expect(bypass?.difference?.kind).toBe("approval_flow");
  const plan = findRule(claude, { ...query, value: "plan" });
  expect(plan?.status).toBe("not_ported");
  expect(plan?.reason?.code).toBe("agent_permission_mode_unsupported");
});

test("an unknown field key finds no rule, and a known one finds its reason", () => {
  const claude = rulesetNamed("claude-code");
  expect(
    findRule(claude, { kind: "field", container: "skill", key: "not-a-real-key" }),
  ).toBeUndefined();
  const known = findRule(claude, { kind: "field", container: "skill", key: "allowed-tools" });
  expect(known?.reason?.code).toBe("skill_preapproval_unsupported");
});

test("policy codes match without a kind, and the blocked project instruction rule names AGENTS.md", () => {
  const claude = rulesetNamed("claude-code");
  expect(findRule(claude, { kind: "skill", code: "question_open" })?.reason?.code).toBe(
    "question_open",
  );
  const project = findRule(claude, { kind: "blocked", code: "project_instruction_file" });
  expect(project?.reason?.code).toBe("not_read_by_fresnel");
  expect(project?.alternative).toContain("AGENTS.md");
});

test("tool names translate only from the table's own keys", () => {
  const claude = rulesetNamed("claude-code");
  expect(toolNameFor(claude, "Bash")).toBe("bash");
  expect(toolNameFor(claude, "MultiEdit")).toBe("edit");
  expect(toolNameFor(claude, "Glob")).toBeUndefined();
  expect(toolNameFor(claude, "constructor")).toBeUndefined();
  expect(toolNameFor(claude, "__proto__")).toBeUndefined();
});
