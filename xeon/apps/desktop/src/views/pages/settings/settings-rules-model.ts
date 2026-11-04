import { err, ok, parse, type Result } from "@fresnel/contracts";
import {
  PolicyRuleSchema,
  type PolicyEffect,
  type PolicyResource,
  type PolicyRule,
} from "@fresnel/contracts/services";

// 권한 규칙 편집기(L4.desktop-ux §6.13)의 순수 모델. 값은 `l1.tools.rules`이고 원소는 계약의 `PolicyRuleSchema`로 읽는다.
// 결과 우선은 deny > ask > allow다(L1.tools 정책 평가). 그래서 허용과 거부가 겹치면 거부가 이긴다는 것을 행에 표시한다.
// 겹침은 도구, 기능, MCP 서버 글롭과 종류·위험·모드 목록으로 본다. 인자 조건과 깊이는 따지지 않으니 겹친다고 넓게 본다.

/** 규칙 이름과 도구 이름의 글자 수 한도(계약 `PolicyRuleSchema`와 같다) */
const ID_MAX = 128;
const TOOL_MAX = 128;

/** 우선순위를 적지 않은 규칙은 이 값으로 본다(L1.tools §2, 기본 500) */
export const PRIORITY_DEFAULT = 500;

/** 동작 열의 순서. 허용, 질문, 거부 */
export const RULE_EFFECTS: readonly PolicyEffect[] = ["allow", "ask", "deny"];

function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** 값을 규칙 목록으로 읽는다. 원소 하나라도 계약에 맞지 않으면 `null`이다 */
export function ruleListOf(value: unknown): readonly PolicyRule[] | null {
  if (!isList(value)) return null;
  const rules: PolicyRule[] = [];
  for (const item of value) {
    const parsed = parse(PolicyRuleSchema, item);
    if (!parsed.ok) return null;
    rules.push(parsed.value);
  }
  return rules;
}

/** 도구 칸의 글. 도구 글롭이 없으면(모든 도구) 빈 글이다 */
export function toolTextOf(rule: PolicyRule): string {
  return rule.resource.tool ?? "";
}

/** 우선순위 칸의 값. 적지 않았으면 기본값이다 */
export function priorityOf(rule: PolicyRule): number {
  return rule.priority ?? PRIORITY_DEFAULT;
}

// ── 고치기(모두 새 목록을 돌려준다) ───────────────────────────────────────

function replaceAt(
  rules: readonly PolicyRule[],
  index: number,
  change: (rule: PolicyRule) => PolicyRule,
): readonly PolicyRule[] {
  return rules.map((rule, at) => (at === index ? change(rule) : rule));
}

export function withEffect(
  rules: readonly PolicyRule[],
  index: number,
  effect: PolicyEffect,
): readonly PolicyRule[] {
  return replaceAt(rules, index, (rule) => ({ ...rule, effect }));
}

export function withPriority(
  rules: readonly PolicyRule[],
  index: number,
  priority: number,
): readonly PolicyRule[] {
  return replaceAt(rules, index, (rule) => ({ ...rule, priority }));
}

export function withId(
  rules: readonly PolicyRule[],
  index: number,
  id: string,
): readonly PolicyRule[] {
  return replaceAt(rules, index, (rule) => ({ ...rule, id }));
}

/** 도구 글롭을 바꾼다(앞뒤 공백은 뺀다). 빈 글이면 도구 칸을 지워 모든 도구가 되게 한다 */
export function withTool(
  rules: readonly PolicyRule[],
  index: number,
  tool: string,
): readonly PolicyRule[] {
  const trimmed = tool.trim();
  return replaceAt(rules, index, (rule) => ({
    ...rule,
    resource: resourceWithTool(rule.resource, trimmed),
  }));
}

function resourceWithTool(resource: PolicyResource, tool: string): PolicyResource {
  const { tool: _previous, ...rest } = resource;
  return tool === "" ? rest : { ...rest, tool };
}

export function withoutRule(rules: readonly PolicyRule[], index: number): readonly PolicyRule[] {
  return rules.toSpliced(index, 1);
}

// ── 검사와 새 규칙 ───────────────────────────────────────────────────────

export type IdIssue = "empty" | "long" | "duplicate";

/** 규칙 이름 검사. `skip`은 고치는 행의 번호다(자기 이름과는 겹쳐도 된다). 새 규칙이면 `null`이다 */
export function checkId(
  text: string,
  rules: readonly PolicyRule[],
  skip: number | null,
): Result<string, IdIssue> {
  const id = text.trim();
  if (id === "") return err("empty");
  if (id.length > ID_MAX) return err("long");
  if (rules.some((rule, at) => at !== skip && rule.id === id)) return err("duplicate");
  return ok(id);
}

export type ToolIssue = "toolLong";

export function checkTool(text: string): Result<string, ToolIssue> {
  const tool = text.trim();
  return tool.length > TOOL_MAX ? err("toolLong") : ok(tool);
}

export interface RuleDraft {
  readonly id: string;
  readonly tool: string;
  readonly effect: PolicyEffect;
}

/** 새 규칙 칸의 시작값. 동작은 질문이다(가장 안전한 쪽) */
export const EMPTY_RULE_DRAFT: RuleDraft = { id: "", tool: "", effect: "ask" };

/** 새 규칙을 만든다. 이름이 비었거나 겹치거나 길면, 도구가 길면 실패 값을 돌려준다 */
export function ruleOfDraft(
  draft: RuleDraft,
  rules: readonly PolicyRule[],
): Result<PolicyRule, IdIssue | ToolIssue> {
  const id = checkId(draft.id, rules, null);
  if (!id.ok) return err(id.error);
  const tool = checkTool(draft.tool);
  if (!tool.ok) return err(tool.error);
  const rule: PolicyRule = {
    id: id.value,
    action: "tool.call",
    resource: tool.value === "" ? {} : { tool: tool.value },
    effect: draft.effect,
  };
  return ok(rule);
}

// ── 겹침과 충돌 ──────────────────────────────────────────────────────────

/**
 * 두 글롭이 같은 이름을 맞출 수 있는가. `*`는 글자 여럿(없어도 된다), `?`는 글자 하나다.
 * 두 패턴의 자리 쌍 (i, j)을 상태로 두고 너비 우선으로 훑는다. 끝 상태에 닿으면 겹친다.
 */
export function globsOverlap(left: string, right: string): boolean {
  const width = right.length + 1;
  const seen = new Set<number>();
  const stack: [number, number][] = [[0, 0]];
  for (let state = stack.pop(); state !== undefined; state = stack.pop()) {
    const [i, j] = state;
    const key = i * width + j;
    if (seen.has(key)) continue;
    seen.add(key);
    if (i === left.length && j === right.length) return true;
    const a = left.charAt(i);
    const b = right.charAt(j);
    // 별표는 빈 글을 맞출 수 있다
    if (a === "*") stack.push([i + 1, j]);
    if (b === "*") stack.push([i, j + 1]);
    // 별표가 한 글자를 먹는다. 그 글자는 맞은 쪽의 글자 칸이 맞춘다
    if (a === "*" && b !== "" && b !== "*") stack.push([i, j + 1]);
    if (b === "*" && a !== "" && a !== "*") stack.push([i + 1, j]);
    // 두 글자 칸이 같은 글자를 맞춘다
    if (a !== "" && b !== "" && a !== "*" && b !== "*" && (a === "?" || b === "?" || a === b)) {
      stack.push([i + 1, j + 1]);
    }
  }
  return false;
}

function optionalGlobsOverlap(left: string | undefined, right: string | undefined): boolean {
  return left === undefined || right === undefined || globsOverlap(left, right);
}

function optionalListsOverlap<T>(
  left: readonly T[] | undefined,
  right: readonly T[] | undefined,
): boolean {
  return left === undefined || right === undefined || left.some((item) => right.includes(item));
}

/** 호출자 칸. `subagent`는 모든 하위 에이전트를 가리키므로 `subagent:<이름>`과 겹친다 */
function callersOverlap(left: PolicyResource["caller"], right: PolicyResource["caller"]): boolean {
  if (left === undefined || right === undefined || left === right) return true;
  return (
    (left === "subagent" && right.startsWith("subagent:")) ||
    (right === "subagent" && left.startsWith("subagent:"))
  );
}

/** 두 규칙이 같은 호출을 맞출 수 있는가 */
export function rulesOverlap(left: PolicyRule, right: PolicyRule): boolean {
  const a = left.resource;
  const b = right.resource;
  return (
    globsOverlap(a.tool ?? "*", b.tool ?? "*") &&
    optionalGlobsOverlap(a.capability, b.capability) &&
    optionalGlobsOverlap(a.mcpServer, b.mcpServer) &&
    optionalListsOverlap(a.classes, b.classes) &&
    optionalListsOverlap(a.risk, b.risk) &&
    optionalListsOverlap(a.mode, b.mode) &&
    callersOverlap(a.caller, b.caller)
  );
}

/** 허용 규칙(`allow`) 하나와 거부 규칙(`deny`) 하나가 겹치는 쌍. 번호는 목록의 행 번호다 */
export interface RuleConflict {
  readonly allow: number;
  readonly deny: number;
}

/** 허용과 거부가 겹치는 모든 쌍. 허용 행 번호, 거부 행 번호 순서다 */
export function conflictsOf(rules: readonly PolicyRule[]): readonly RuleConflict[] {
  return rules.flatMap((allowRule, allow) =>
    allowRule.effect !== "allow"
      ? []
      : rules.flatMap((denyRule, deny) =>
          denyRule.effect === "deny" && rulesOverlap(allowRule, denyRule) ? [{ allow, deny }] : [],
        ),
  );
}

/** 행 하나가 충돌하는 상대 행 번호들. 허용 행이면 거부 행을, 거부 행이면 허용 행을 준다 */
export function partnersOf(conflicts: readonly RuleConflict[], index: number): readonly number[] {
  return conflicts.flatMap((conflict) => {
    if (conflict.allow === index) return [conflict.deny];
    if (conflict.deny === index) return [conflict.allow];
    return [];
  });
}
