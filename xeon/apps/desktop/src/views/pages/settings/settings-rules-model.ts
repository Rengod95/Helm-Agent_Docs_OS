import { err, ok, parse, type Result } from "@fresnel/contracts";
import {
  PolicyRuleSchema,
  type PolicyEffect,
  type PolicyResource,
  type PolicyRule,
} from "@fresnel/contracts/services";

// 권한 규칙 판정 표(L4.desktop-ux §6.13, DP-109)의 순수 모델. 값은 `l1.tools.rules`이고 원소는 계약의 `PolicyRuleSchema`로 읽는다.
// 결과 우선은 deny > ask > allow다(L1.tools 정책 평가). 그래서 허용과 거부가 겹치면 거부가 이긴다는 것을 행에 표시한다.
// 겹침은 도구, 기능, MCP 서버 글롭과 종류·위험·모드 목록으로 본다. 인자 조건과 깊이는 따지지 않으니 겹친다고 넓게 본다.

/** 규칙 이름과 도구 이름의 글자 수 한도(계약 `PolicyRuleSchema`와 같다) */
const ID_MAX = 128;
const TOOL_MAX = 128;

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

export function withoutRule(rules: readonly PolicyRule[], index: number): readonly PolicyRule[] {
  return rules.toSpliced(index, 1);
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
    callersOverlap(a.caller, b.caller) &&
    commandPrefixesOverlap(left, right)
  );
}

/**
 * 두 규칙의 명령 접두(`bash(git status)`, `bash(rm -rf)`)가 같은 명령을 맞출 수 있는가. 한쪽 접두가 다른 쪽으로 시작하지 않으면
 * 맞출 명령이 없다. 판정 표 모양이 아닌 인자 조건은 따지지 않는다(겹친다고 본다)
 */
function commandPrefixesOverlap(left: PolicyRule, right: PolicyRule): boolean {
  const a = commandPrefixOf(left);
  const b = commandPrefixOf(right);
  if (a === null || b === null) return true;
  return a.startsWith(b) || b.startsWith(a);
}

function commandPrefixOf(rule: PolicyRule): string | null {
  const text = patternTextOf(rule);
  const match = text === null ? null : /^bash\((.*)\)$/.exec(text);
  return match === null ? null : (match[1] ?? null);
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

// ── 도구·패턴 한 줄(판정 표, DP-109) ──────────────────────────────────────
//
// 판정 표의 대상 칸은 Claude Code처럼 `read`, `mcp__github__*`, `bash(git status)`로 쓴다. `이름(접두)`는 bash만 받고
// 명령 인자 조건 `{ pointer: "/command", pattern: "^<접두>( |$)" }` 하나로 저장한다(L1.tools 규칙 예시와 같은 모양).
// `*`는 모든 도구(도구 글롭 없음)다. 이 모양으로 읽을 수 없는 규칙(서버·종류·위험·모드 조건, 인자 여러 개)은 `null`이고
// 화면은 대상을 고치지 못하게 요약만 보인다. 규칙 이름(`id`)은 화면에 없다: 새 규칙은 `<판정>-<도구>`로 만들고 겹치면 `-2`부터 붙인다.

/** 명령 접두를 받는 도구 */
const COMMAND_TOOL = "bash";
const COMMAND_POINTER = "/command";
/** 메모(`description`) 글자 수 한도(계약과 같다) */
const MEMO_MAX = 500;

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;

function escapeRegex(text: string): string {
  return text.replace(REGEX_SPECIAL, "\\$&");
}

/** `^<접두>( |$)`에서 접두를 되찾는다. 이스케이프된 글자 말고 정규식 문법이 섞였으면 `null` */
function prefixOfPattern(pattern: string): string | null {
  const match = /^\^((?:\\.|[^\\.*+?^${}()|[\]])*)\( \|\$\)$/.exec(pattern);
  if (match === null) return null;
  return (match[1] ?? "").replace(/\\(.)/g, "$1");
}

/** 규칙 한 줄의 도구·패턴 글. 판정 표가 다룰 수 없는 규칙이면 `null` */
export function patternTextOf(rule: PolicyRule): string | null {
  const { tool, args, ...rest } = rule.resource;
  if (Object.keys(rest).length > 0) return null;
  if (args === undefined || args.length === 0) return tool ?? "*";
  const only = args[0];
  if (args.length !== 1 || only === undefined || tool !== COMMAND_TOOL) return null;
  if (only.pointer !== COMMAND_POINTER) return null;
  const prefix = prefixOfPattern(only.pattern);
  return prefix === null ? null : `${COMMAND_TOOL}(${prefix})`;
}

/** 다룰 수 없는 규칙의 요약 글: 도구 글롭(없으면 `*`) */
export function ruleSummaryOf(rule: PolicyRule): string {
  return rule.resource.tool ?? rule.resource.mcpServer ?? rule.resource.capability ?? "*";
}

export type PatternIssue = "patternEmpty" | "patternLong" | "patternCommandOnly" | "patternForm";

/** 대상 칸 글을 규칙의 resource로 바꾼다 */
export function resourceOfPattern(text: string): Result<PolicyResource, PatternIssue> {
  const trimmed = text.trim();
  if (trimmed === "") return err("patternEmpty");
  if (trimmed === "*") return ok({});
  const call = /^([^()\s]+)\((.*)\)$/.exec(trimmed);
  if (call === null) {
    if (/[()\s]/.test(trimmed)) return err("patternForm");
    return trimmed.length > TOOL_MAX ? err("patternLong") : ok({ tool: trimmed });
  }
  const tool = call[1] ?? "";
  const prefix = (call[2] ?? "").trim();
  if (tool !== COMMAND_TOOL) return err("patternCommandOnly");
  if (prefix === "") return ok({ tool });
  if (prefix.length > 512) return err("patternLong");
  return ok({
    tool,
    args: [{ pointer: COMMAND_POINTER, pattern: `^${escapeRegex(prefix)}( |$)` }],
  });
}

/** 새 규칙 이름: `<판정>-<도구 글자만>`, 이미 있으면 `-2`, `-3`… */
export function ruleIdFor(
  effect: PolicyEffect,
  resource: PolicyResource,
  rules: readonly PolicyRule[],
): string {
  const tool = (resource.tool ?? "all").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  const base = `${effect}-${tool === "" ? "tool" : tool}`.slice(0, ID_MAX - 4);
  const taken = new Set(rules.map((rule) => rule.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const id = `${base}-${String(n)}`;
    if (!taken.has(id)) return id;
  }
}

export type AddIssue = PatternIssue | "patternDuplicate" | "memoLong";

/** 판정 표의 추가 줄로 새 규칙을 만든다. 같은 대상·같은 판정 규칙이 있으면 실패다 */
export function ruleOfPattern(
  input: { readonly pattern: string; readonly effect: PolicyEffect; readonly memo: string },
  rules: readonly PolicyRule[],
): Result<PolicyRule, AddIssue> {
  const resource = resourceOfPattern(input.pattern);
  if (!resource.ok) return err(resource.error);
  const memo = input.memo.trim();
  if (memo.length > MEMO_MAX) return err("memoLong");
  const probe: PolicyRule = {
    id: "",
    action: "tool.call",
    resource: resource.value,
    effect: input.effect,
  };
  const text = patternTextOf(probe);
  if (rules.some((rule) => rule.effect === input.effect && patternTextOf(rule) === text)) {
    return err("patternDuplicate");
  }
  return ok({
    ...probe,
    id: ruleIdFor(input.effect, resource.value, rules),
    ...(memo === "" ? {} : { description: memo }),
  });
}

/** 메모를 바꾼다. 빈 글이면 메모를 지운다 */
export function withMemo(
  rules: readonly PolicyRule[],
  index: number,
  memo: string,
): readonly PolicyRule[] {
  const text = memo.trim().slice(0, MEMO_MAX);
  return replaceAt(rules, index, (rule) => ({
    id: rule.id,
    action: rule.action,
    resource: rule.resource,
    effect: rule.effect,
    ...(rule.priority === undefined ? {} : { priority: rule.priority }),
    ...(text === "" ? {} : { description: text }),
  }));
}
