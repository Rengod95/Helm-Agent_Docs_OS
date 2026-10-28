import type {
  CallerId,
  PermissionMode,
  PolicyCeiling,
  PolicyDecision,
  PolicyEffect,
  PolicyInput,
  TieredRule,
} from "./tools.ts";

// L1.tools.spec §3.5, §4.5 ceiling 단계와 L1.agents.spec §4.3 1번. 권한 상한을 계산하는 순수 함수다.
// core-tools(정책 파이프라인)와 core-agents(광고 목록 계산)가 서로를 import하지 않고 쓰도록 F에 둔다(F 요청 9).
// 규칙 평가기(evaluatePolicy, ruleMatches, validateRules)는 core-tools가 구현한다. childDecision은 평가기를 인자로 받는다.

/** 규칙 평가기. core-tools의 evaluatePolicy가 이 모양이다. 순수 함수여야 한다 */
export type PolicyEvaluator = (input: PolicyInput, rules: readonly TieredRule[]) => PolicyDecision;

/** 자식 관점 입력. 자식 대화의 caller, 깊이, 자식 모드와 정의가 더한 규칙 */
export interface ChildPolicyView {
  readonly caller: CallerId;
  readonly depth: number;
  readonly mode: PermissionMode;
  /** 서브에이전트 정의가 더한 규칙(permissions.rules). 자식 관점 평가에만 더해진다 */
  readonly definitionRules?: readonly TieredRule[];
}

const STRICTNESS: Readonly<Record<PolicyEffect, number>> = { allow: 0, ask: 1, deny: 2 };

/** 두 결정 중 엄격한 쪽(deny > ask > allow). 같으면 앞의 것. 순수 함수 */
export function stricter(a: PolicyDecision, b: PolicyDecision): PolicyDecision {
  return STRICTNESS[b.effect] > STRICTNESS[a.effect] ? b : a;
}

/**
 * 도구 이름 glob 일치. `*`는 임의 문자열, `?`는 문자 하나이고 다른 문자는 그대로 비교한다. 순수 함수.
 * 도구 이름에는 구분자가 없으므로 `*`는 구분자를 따로 다루지 않는다.
 */
export function matchToolGlob(pattern: string, name: string): boolean {
  // 동적 계획법으로 비교한다. 정규식을 만들지 않으므로 패턴 안의 특수 문자를 이스케이프할 일이 없다
  const row: boolean[] = Array.from({ length: name.length + 1 }, (_, i) => i === 0);
  for (let k = 0; k < pattern.length; k += 1) {
    const symbol = pattern[k];
    if (symbol === "*") {
      for (let i = 1; i <= name.length; i += 1) row[i] = (row[i] ?? false) || (row[i - 1] ?? false);
    } else {
      for (let i = name.length; i >= 1; i -= 1) {
        const same = symbol === "?" || symbol === name[i - 1];
        row[i] = same && (row[i - 1] ?? false);
      }
      row[0] = false;
    }
  }
  return row[name.length] ?? false;
}

const NONINTERACTIVE_MESSAGE =
  "[xeon:noninteractive_ask_denied] This tool call needs approval, but nobody can answer in a non-interactive run.";

function agentNameOf(caller: CallerId): string | null {
  return caller.startsWith("subagent:") ? caller.slice("subagent:".length) : null;
}

/**
 * 자식 대화에서 도구 호출 하나의 정책 결정. 부모 관점 평가, 자식 관점 평가, 정의 제한을 stricter로 합친다. 순수 함수.
 *
 * - 부모 관점: `call`의 caller, depth, mode를 `parent`의 값으로 바꿔 `rules`로 평가한다.
 * - 자식 관점: 같은 호출을 `child`의 값으로 바꿔 `rules`에 `child.definitionRules`를 더해 평가한다.
 * - 정의 제한: `parent.allow`(정의 tools 제한 glob)가 있고 도구 이름이 어느 glob에도 맞지 않으면 deny다.
 *   빈 배열이면 모든 도구가 막힌다. 생략하면 제한이 없다. ruleId는 `agent.<이름>.tools`다.
 * - 호출자 거부: `parent.deny`(glob)에 도구 이름이 맞으면 deny다. ruleId는 `agent.<이름>.tools.deny`다. 정의 제한과 호출자 거부의 거부 문장 끝에는 `parent.denyHint`를 붙인다.
 * - 합친 결과가 ask이고 `call.interactive`가 거짓이면 deny(`reason: "noninteractive"`)다.
 *
 * 그래서 자식은 부모가 거부한 도구를 쓸 수 없고, 정의가 allow 규칙을 더해도 부모 결정보다 넓어지지 않는다.
 */
export function childDecision(
  evaluate: PolicyEvaluator,
  call: PolicyInput,
  parent: PolicyCeiling,
  child: ChildPolicyView,
  rules: readonly TieredRule[],
): PolicyDecision {
  const parentView = evaluate(
    { ...call, caller: parent.caller, depth: parent.depth, mode: parent.mode },
    rules,
  );
  const childRules =
    child.definitionRules === undefined ? rules : [...rules, ...child.definitionRules];
  const childView = evaluate(
    { ...call, caller: child.caller, depth: child.depth, mode: child.mode },
    childRules,
  );
  let merged = stricter(parentView, childView);
  const hint = parent.denyHint === undefined ? "" : ` ${parent.denyHint}`;
  const name = agentNameOf(child.caller);
  const ruleId = name === null ? "agent.tools" : `agent.${name}.tools`;
  if (parent.allow !== undefined && !parent.allow.some((glob) => matchToolGlob(glob, call.tool))) {
    merged = stricter(merged, {
      effect: "deny",
      reason: "rule",
      ruleId,
      tier: null,
      message: `[xeon:denied_by_policy] Tool call "${call.tool}" is not in the tool list of this subagent definition.${hint}`,
    });
  }
  if (parent.deny !== undefined && parent.deny.some((glob) => matchToolGlob(glob, call.tool))) {
    merged = stricter(merged, {
      effect: "deny",
      reason: "rule",
      ruleId: name === null ? "agent.tools.deny" : `agent.${name}.tools.deny`,
      tier: null,
      message: `[xeon:denied_by_policy] Tool call "${call.tool}" is denied for this subagent.${hint}`,
    });
  }
  if (merged.effect === "ask" && !call.interactive) {
    return {
      effect: "deny",
      reason: "noninteractive",
      ruleId: merged.ruleId,
      tier: merged.tier,
      message: NONINTERACTIVE_MESSAGE,
    };
  }
  return merged;
}
