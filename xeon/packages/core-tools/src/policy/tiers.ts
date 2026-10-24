import { parse } from "@xeon/contracts";
import {
  PolicyRuleSchema,
  type PolicyIssue,
  type PolicyRule,
  type TieredRule,
} from "@xeon/contracts/services";
import type { ScopeStack } from "@xeon/contracts/settings";
import { layerValue, TOOLS_SETTING_KEYS } from "../settings.ts";
import { builtinRules, loadableRules, validateRules } from "./rules.ts";

// L1.tools.spec §4.5 티어와 규칙 출처. M1은 default(내장)와 user·managed(설정)만 있다.
// extension 티어(확장 규칙)와 registerRules는 M2·2차다.

const BUILTIN_RULE_SOURCE = "core:tools";

interface RuleSourceIssue {
  /** 규칙이 나온 출처. 예: "settings:user" */
  readonly source: string;
  readonly ruleId: string | null;
  readonly code: PolicyIssue["code"] | "schema_invalid";
  readonly message: string;
}

export interface CollectedRules {
  readonly rules: readonly TieredRule[];
  readonly issues: readonly RuleSourceIssue[];
}

function tag(
  rules: readonly PolicyRule[],
  tier: TieredRule["tier"],
  source: string,
): readonly TieredRule[] {
  return rules.map((rule) => ({ ...rule, tier, source }));
}

/**
 * 내장 규칙과 설정 `l1.tools.rules`를 모은다. 설정 값은 키 하나의 값을 통째로 바꾸는 규칙(F.wire-settings.spec §4.7)이
 * 아니라 범위마다 따로 읽는다(L1.tools.spec §4.5 "설정 범위별 규칙 수집"). managed 범위는 managed 티어, 그 밖은 user 티어다.
 * 스키마를 어기거나 validateRules에 걸린 규칙은 적재하지 않고 issues로 돌려준다.
 */
export function collectRules(layers: ScopeStack): CollectedRules {
  const issues: RuleSourceIssue[] = [];
  const collected: TieredRule[] = [...tag(builtinRules(), "default", BUILTIN_RULE_SOURCE)];

  for (const layer of layers) {
    const raw = layerValue(layer, TOOLS_SETTING_KEYS.rules);
    if (raw === undefined) continue;
    const source = `settings:${layer.scope}${layer.path === undefined ? "" : `:${layer.path}`}`;
    if (!Array.isArray(raw)) {
      issues.push({
        source,
        ruleId: null,
        code: "schema_invalid",
        message: `${TOOLS_SETTING_KEYS.rules} must be an array`,
      });
      continue;
    }
    const items: readonly unknown[] = raw;
    const parsed: PolicyRule[] = [];
    for (const item of items) {
      const result = parse(PolicyRuleSchema, item);
      if (result.ok) {
        parsed.push(result.value);
      } else {
        const first = result.error.issues[0];
        issues.push({
          source,
          ruleId: null,
          code: "schema_invalid",
          message: `rule rejected by schema${first === undefined ? "" : `: ${first.path} ${first.message}`}`,
        });
      }
    }
    const ruleIssues = validateRules(parsed);
    for (const issue of ruleIssues) issues.push({ source, ...issue });
    const tier = layer.scope === "managed" ? "managed" : "user";
    collected.push(...tag(loadableRules(parsed, ruleIssues), tier, source));
  }
  return { rules: collected, issues };
}
