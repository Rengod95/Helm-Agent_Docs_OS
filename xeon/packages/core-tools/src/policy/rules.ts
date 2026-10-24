import type { PolicyIssue, PolicyRule } from "@xeon/contracts/services";
import { tryRegExp } from "../util.ts";

// L1.tools.spec §4.5 내장 기본 규칙(M1)과 규칙 정적 검사.
export const DEFAULT_RULE_PRIORITY = 500;

/** M1 내장 규칙: read·ls는 allow, bash는 ask. 나머지는 모드 기본값을 따른다 */
export function builtinRules(): readonly PolicyRule[] {
  return [
    {
      id: "default.read-allow",
      action: "tool.call",
      resource: { risk: ["read"] },
      effect: "allow",
      description: "Tools declared read-only are allowed.",
    },
    {
      id: "default.ls-allow",
      action: "tool.call",
      resource: { tool: "ls" },
      effect: "allow",
      description: "Directory listing is allowed.",
    },
    {
      id: "default.read-tool-allow",
      action: "tool.call",
      resource: { tool: "read" },
      effect: "allow",
      description: "File reading is allowed.",
    },
    {
      id: "default.bash-ask",
      action: "tool.call",
      resource: { tool: "bash" },
      effect: "ask",
      description: "Shell commands need approval.",
    },
  ];
}

const POINTER_PATTERN = /^(?:|\/(?:[^~]|~[01])*)$/;

function checkGlob(label: string, glob: string | undefined, ruleId: string): PolicyIssue[] {
  if (glob === undefined) return [];
  if (glob.length === 0) {
    return [{ ruleId, code: "glob_invalid", message: `${label} glob must not be empty` }];
  }
  return [];
}

/** 규칙 정적 검사. 문제가 있는 규칙은 호출자가 적재하지 않는다. 평가 중에는 예외를 던지지 않는다 */
export function validateRules(rules: readonly PolicyRule[]): readonly PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.id)) {
      issues.push({
        ruleId: rule.id,
        code: "rule_id_duplicate",
        message: `rule id "${rule.id}" is used more than once`,
      });
    }
    seen.add(rule.id);
    if (
      rule.priority !== undefined &&
      (!Number.isInteger(rule.priority) || rule.priority < 0 || rule.priority > 999)
    ) {
      issues.push({
        ruleId: rule.id,
        code: "priority_range",
        message: "priority must be an integer from 0 to 999",
      });
    }
    issues.push(
      ...checkGlob("tool", rule.resource.tool, rule.id),
      ...checkGlob("capability", rule.resource.capability, rule.id),
      ...checkGlob("mcpServer", rule.resource.mcpServer, rule.id),
    );
    for (const condition of rule.resource.args ?? []) {
      if (!POINTER_PATTERN.test(condition.pointer)) {
        issues.push({
          ruleId: rule.id,
          code: "pointer_invalid",
          message: `"${condition.pointer}" is not an RFC 6901 JSON Pointer`,
        });
      }
      if (tryRegExp(condition.pattern) === undefined) {
        // 잘못된 정규식은 적재하지 않고 진단으로 남긴다(L1.tools.spec §5 사례 4)
        issues.push({
          ruleId: rule.id,
          code: "pattern_invalid",
          message: `"${condition.pattern}" is not a valid regular expression`,
        });
      }
    }
  }
  return issues;
}

/** 이슈가 있는 규칙을 뺀 나머지. 중복 id는 처음 것만 남기고 뒤의 것을 뺀다 */
export function loadableRules(
  rules: readonly PolicyRule[],
  issues: readonly PolicyIssue[],
): readonly PolicyRule[] {
  const bad = new Set(
    issues.filter((issue) => issue.code !== "rule_id_duplicate").map((issue) => issue.ruleId),
  );
  const seen = new Set<string>();
  const kept: PolicyRule[] = [];
  for (const rule of rules) {
    const repeated = seen.has(rule.id);
    seen.add(rule.id);
    if (repeated || bad.has(rule.id)) continue;
    kept.push(rule);
  }
  return kept;
}
