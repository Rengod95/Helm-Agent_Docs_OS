import { canonicalJson } from "@fresnel/contracts";
import type { JsonValue } from "@fresnel/contracts/conversation";
import {
  POLICY_TIER_ORDER,
  type PolicyDecision,
  type PolicyEffect,
  type PolicyInput,
  type PolicyRule,
  type PolicyTier,
  type TieredRule,
} from "@fresnel/contracts/services";
import { globMatches, isJsonObject, tryRegExp } from "../util.ts";
import { isRepositorySource } from "./tiers.ts";
import { DEFAULT_RULE_PRIORITY } from "./rules.ts";
import { modeDefault } from "./modes.ts";

// L1.tools.spec §4.5 평가기. 순수 함수다: 시각, 난수, 파일, 설정을 읽지 않고 입력을 바꾸지 않는다.

/** RFC 6901 포인터로 값을 찾는다. 없으면 undefined */
function resolvePointer(root: JsonValue, pointer: string): JsonValue | undefined {
  if (pointer === "") return root;
  if (!pointer.startsWith("/")) return undefined;
  let current: JsonValue | undefined = root;
  for (const raw of pointer.slice(1).split("/")) {
    const token = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (isJsonObject(current)) {
      current = Object.hasOwn(current, token) ? current[token] : undefined;
    } else if (Array.isArray(current)) {
      const items: readonly JsonValue[] = current;
      const index = /^(?:0|[1-9]\d*)$/.test(token) ? Number(token) : -1;
      current = items[index];
    } else {
      return undefined;
    }
  }
  return current;
}

function argsMatch(rule: PolicyRule, args: PolicyInput["args"]): boolean {
  const conditions = rule.resource.args;
  if (conditions === undefined || conditions.length === 0) return true;
  // 노출 판정(args: null)에서는 인자 조건이 있는 규칙이 일치하지 않는다
  if (args === null) return false;
  return conditions.every((condition) => {
    const regex = tryRegExp(condition.pattern);
    if (regex === undefined) return false;
    const value = resolvePointer(args, condition.pointer);
    if (value === undefined) return false;
    const text = typeof value === "string" ? value : canonicalJson(value);
    return regex.test(text);
  });
}

function callerMatches(
  want: NonNullable<PolicyRule["resource"]["caller"]>,
  caller: string,
): boolean {
  if (want === "main") return caller === "main";
  if (want === "subagent") return caller.startsWith("subagent:");
  return caller === want;
}

/** 규칙 하나가 입력에 일치하는가. 잘못된 정규식은 일치하지 않는 것으로 본다(적재 때 validateRules가 걸러낸다) */
export function ruleMatches(rule: PolicyRule, input: PolicyInput): boolean {
  const resource = rule.resource;
  if (resource.tool !== undefined && !globMatches(resource.tool, input.tool)) return false;
  if (resource.capability !== undefined) {
    if (input.capability === undefined || !globMatches(resource.capability, input.capability)) {
      return false;
    }
  }
  if (resource.mcpServer !== undefined) {
    if (input.mcpServer === undefined || !globMatches(resource.mcpServer, input.mcpServer)) {
      return false;
    }
  }
  if (resource.classes !== undefined && resource.classes.length > 0) {
    if (!resource.classes.some((tag) => input.classes.includes(tag))) return false;
  }
  if (resource.risk !== undefined && resource.risk.length > 0) {
    if (!resource.risk.includes(input.risk)) return false;
  }
  if (resource.caller !== undefined && !callerMatches(resource.caller, input.caller)) return false;
  if (resource.minDepth !== undefined && input.depth < resource.minDepth) return false;
  if (resource.mode !== undefined && resource.mode.length > 0) {
    if (!resource.mode.includes(input.mode)) return false;
  }
  return argsMatch(rule, input.args);
}

function tierRank(tier: PolicyTier): number {
  return POLICY_TIER_ORDER.indexOf(tier);
}

function priorityOf(rule: PolicyRule): number {
  return rule.priority ?? DEFAULT_RULE_PRIORITY;
}

/** 티어가 높고, 같은 티어에서는 priority가 큰 규칙이 앞이다 */
function strongest(rules: readonly TieredRule[]): readonly TieredRule[] {
  let topTier = -1;
  for (const rule of rules) topTier = Math.max(topTier, tierRank(rule.tier));
  const inTier = rules.filter((rule) => tierRank(rule.tier) === topTier);
  let topPriority = -1;
  for (const rule of inTier) topPriority = Math.max(topPriority, priorityOf(rule));
  return inTier.filter((rule) => priorityOf(rule) === topPriority);
}

const NONINTERACTIVE_MESSAGE =
  "[fresnel:noninteractive_ask_denied] This tool call needs approval, but nobody can answer in a non-interactive run.";

function denyByRule(rule: TieredRule, tool: string): PolicyDecision {
  return {
    effect: "deny",
    reason: "rule",
    ruleId: rule.id,
    tier: rule.tier,
    message: `[fresnel:denied_by_policy] Tool call "${tool}" is denied by policy rule ${rule.id}.`,
  };
}

/** 한 명령에 둘 이상의 명령이나 부수 효과를 싣는 셸 문법: ; & | < > 명령 치환 백틱 개행 */
const SHELL_COMPOUND = /[;&|<>`\n\r]|\$\(/;

function usesCommandPointer(rule: PolicyRule): boolean {
  return rule.resource.args?.some((condition) => condition.pointer === "/command") === true;
}

/**
 * `/command` 정규식으로 허용하는 bash 규칙은 접두 일치(`^git status`)라 `git status && rm x`도 통과한다.
 * 셸 문법으로 명령을 이은 호출은 이 allow를 ask로 낮춘다(L1.tools.spec §4.5). deny와 ask 규칙은 그대로다.
 */
function demoteCompound(rule: TieredRule, input: PolicyInput): TieredRule {
  if (rule.effect !== "allow" || input.tool !== "bash" || !usesCommandPointer(rule)) return rule;
  const command = input.args?.["command"];
  if (typeof command !== "string" || !SHELL_COMPOUND.test(command)) return rule;
  return { ...rule, effect: "ask" };
}

/** 7단계. ask인데 사람이 답할 수 없으면 deny다 */
function finish(decision: PolicyDecision, input: PolicyInput): PolicyDecision {
  if (decision.effect === "ask" && !input.interactive) {
    return {
      effect: "deny",
      reason: "noninteractive",
      ruleId: decision.ruleId,
      tier: decision.tier,
      message: NONINTERACTIVE_MESSAGE,
    };
  }
  return decision;
}

/**
 * 평가 순서(L1.tools.spec §4.5):
 * 1 일치 규칙 M, 2 deny가 있으면 가장 높은 티어·priority의 deny, 3 plan 모드의 write·exec는 deny,
 * 4 bypass(금지면 default로 보고 계속), 5 M에서 가장 높은 티어·priority(ask가 있으면 ask), 6 모드 기본값,
 * 7 비대화형이면 ask를 deny로.
 * bypass가 금지되어 default로 내려온 호출이 6단계(모드 기본값)로 정해지면 reason은 "bypass_forbidden"이다.
 */
export function evaluatePolicy(input: PolicyInput, rules: readonly TieredRule[]): PolicyDecision {
  const matched = rules
    .filter((rule) => ruleMatches(rule, input))
    .map((rule) => demoteCompound(rule, input));

  const denies = matched.filter((rule) => rule.effect === "deny");
  const [firstDeny] = strongest(denies);
  if (firstDeny !== undefined) return finish(denyByRule(firstDeny, input.tool), input);

  let mode = input.mode;
  let bypassDemoted = false;
  if (mode === "bypass") {
    if (input.bypassAllowed) {
      return { effect: "allow", reason: "mode", ruleId: null, tier: null };
    }
    mode = "default";
    bypassDemoted = true;
  }

  if (mode === "plan" && input.risk !== "read") {
    return finish(
      {
        effect: "deny",
        reason: "mode",
        ruleId: null,
        tier: null,
        message: `[fresnel:denied_by_mode] Tool "${input.tool}" changes state and is not allowed in plan mode.`,
      },
      input,
    );
  }

  if (matched.length > 0) {
    const top = strongest(matched);
    const effect: PolicyEffect = top.some((rule) => rule.effect === "ask") ? "ask" : "allow";
    const source = top.find((rule) => rule.effect === effect);
    return finish(
      {
        effect,
        reason: "rule",
        ruleId: source?.id ?? null,
        tier: source?.tier ?? null,
      },
      input,
    );
  }

  const effect = modeDefault(mode, input.risk);
  const reason = bypassDemoted ? "bypass_forbidden" : "mode";
  const decision: PolicyDecision =
    effect === "deny"
      ? {
          effect,
          reason,
          ruleId: null,
          tier: null,
          message: `[fresnel:denied_by_mode] Tool "${input.tool}" is not allowed in ${mode} mode.`,
        }
      : { effect, reason, ruleId: null, tier: null };
  return finish(decision, input);
}

/**
 * 내장 도구를 대체한 항목의 allow 판정을 ask로 낮춘다(L1.tools.spec §4.13). 내장 기본 규칙(`default` 티어)의 allow(`read`·`ls`의 기본 허용 포함)와
 * 위험 등급이 낮아서 생기는 모드 기본 허용은 내장 파일 도구를 위한 것이라 같은 이름의 다른 코드에 넘기지 않는다.
 * 사용자·managed 규칙의 allow와 사용자가 고른 bypass는 그대로다. 사람이 답할 수 없으면 ask는 deny가 된다
 */
export function demoteReplacementAllow(
  decision: PolicyDecision,
  input: PolicyInput,
): PolicyDecision {
  if (decision.effect !== "allow") return decision;
  const fromDefault =
    decision.reason === "rule"
      ? decision.tier === "default"
      : decision.reason === "mode" && input.mode !== "bypass";
  if (!fromDefault) return decision;
  return finish({ ...decision, effect: "ask" }, input);
}

/**
 * 저장소(project·local)가 적은 allow 규칙을 뺀 목록. 저장소의 allow는 `user` 티어로 들어오지만 사용자가 쓴 것이 아니라서
 * 대체 항목을 승인 없이 켜지 못한다. 사용자·managed의 allow와 저장소의 deny·ask는 그대로 남는다(L1.tools.spec §4.13)
 */
function withoutRepositoryAllow(rules: readonly TieredRule[]): readonly TieredRule[] {
  return rules.filter((rule) => rule.effect !== "allow" || !isRepositorySource(rule.source));
}

/**
 * 내장 도구를 대체한 항목의 정책 판정(L1.tools.spec §4.13). 저장소의 allow를 빼고 평가한 뒤 기본 허용 배제(`demoteReplacementAllow`)를 건다.
 * 대체가 아닌 항목은 `evaluatePolicy`를 그대로 쓴다
 */
export function evaluateReplacement(
  input: PolicyInput,
  rules: readonly TieredRule[],
): PolicyDecision {
  return demoteReplacementAllow(evaluatePolicy(input, withoutRepositoryAllow(rules)), input);
}
