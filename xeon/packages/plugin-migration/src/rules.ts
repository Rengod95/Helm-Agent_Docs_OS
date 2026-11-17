// 매핑 규칙 데이터(migration.md §7.3). 하네스 하나당 `rules/<하네스>.json` 하나다.
// 규칙은 경계 값이라 typebox 스키마로 검증한다. 알 수 없는 필드가 든 규칙은 거부한다.
// 규칙표에 없는 항목은 `findRule`이 `undefined`를 돌려주고, 호출자가 `no_rule`로 보고한다.
import { Type } from "typebox";
import { err, ok, parse, type ParseError, type Result, type SchemaProof } from "@fresnel/contracts";
import type { DifferenceKind, HarnessId, IrKind, ReportStatus } from "./types.ts";
import agentSkillsData from "./rules/agent-skills.json" with { type: "json" };
import agentsMdData from "./rules/agents-md.json" with { type: "json" };
import claudeCodeData from "./rules/claude-code.json" with { type: "json" };

export interface RuleReason {
  readonly code: string;
  readonly text: string;
}

export interface RuleDifference {
  readonly kind: DifferenceKind;
  readonly text: string;
}

/**
 * 항목을 고르는 조건. 적은 필드만 맞으면 된다. `values`는 `IrField.summary`가 목록 가운데 하나일 때만 맞는다.
 * 정책 코드(`question_open`, `description_missing` 등)는 `kind` 없이 `code`만 적는다.
 */
export interface RuleMatch {
  readonly kind?: IrKind;
  readonly container?: string;
  readonly key?: string;
  readonly code?: string;
  readonly values?: readonly string[];
}

export interface Rule {
  readonly match: RuleMatch;
  readonly status: ReportStatus;
  readonly reason?: RuleReason;
  readonly difference?: RuleDifference;
  readonly alternative?: string;
}

export interface Ruleset {
  readonly harness: HarnessId;
  readonly rulesVersion: string;
  readonly docs: readonly string[];
  /** 원본 도구 이름 → Fresnel 도구 이름. 규칙표에 없는 이름은 번역되지 않는다 */
  readonly toolNames: Readonly<Record<string, string>>;
  /** 처음 맞는 규칙이 이긴다. 값이 있는 규칙을 앞에 둔다 */
  readonly rules: readonly Rule[];
}

/** 규칙을 고를 때 쓰는 항목의 속성 */
export interface RuleQuery {
  readonly kind: IrKind;
  readonly container?: string | undefined;
  readonly key?: string | undefined;
  readonly code?: string | undefined;
  readonly value?: string | undefined;
}

/** 규칙표에 없는 항목의 이유(§7.3). 이유 문장은 여기에 한국어로 둔다 */
export const NO_RULE: RuleReason = {
  code: "no_rule",
  text: "이 항목을 옮기는 규칙이 없어 옮기지 않았다(알 수 없는 항목).",
};

export const NO_RULE_ALTERNATIVE: string =
  "규칙이 추가되면 다시 가져온다. 그때까지는 이 항목을 직접 옮긴다.";

const IrKindSchema = Type.Union([
  Type.Literal("instruction"),
  Type.Literal("skill"),
  Type.Literal("command"),
  Type.Literal("agent"),
  Type.Literal("mcp"),
  Type.Literal("field"),
  Type.Literal("blocked"),
]);

const ReportStatusSchema = Type.Union([
  Type.Literal("exact"),
  Type.Literal("differs"),
  Type.Literal("not_ported"),
  Type.Literal("not_needed"),
]);

const DifferenceKindSchema = Type.Union([
  Type.Literal("semantic_loss"),
  Type.Literal("scope_change"),
  Type.Literal("time_limit"),
  Type.Literal("cost"),
  Type.Literal("enforcement_change"),
  Type.Literal("approval_flow"),
  Type.Literal("renamed"),
  Type.Literal("user_choice"),
]);

const RuleMatchSchema = Type.Object(
  {
    kind: Type.Optional(IrKindSchema),
    container: Type.Optional(Type.String({ minLength: 1 })),
    key: Type.Optional(Type.String({ minLength: 1 })),
    code: Type.Optional(Type.String({ minLength: 1 })),
    values: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  },
  { additionalProperties: false },
);

const RuleSchema = Type.Object(
  {
    match: RuleMatchSchema,
    status: ReportStatusSchema,
    reason: Type.Optional(
      Type.Object(
        { code: Type.String({ minLength: 1 }), text: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
    ),
    difference: Type.Optional(
      Type.Object(
        { kind: DifferenceKindSchema, text: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
    ),
    alternative: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

const rulesetShape = Type.Object(
  {
    harness: Type.Union([
      Type.Literal("claude-code"),
      Type.Literal("agents-md"),
      Type.Literal("agent-skills"),
    ]),
    rulesVersion: Type.String({ minLength: 1 }),
    docs: Type.Array(Type.String({ minLength: 1 })),
    toolNames: Type.Record(Type.String(), Type.String({ minLength: 1 })),
    rules: Type.Array(RuleSchema),
  },
  { additionalProperties: false },
);

const RulesetSchema = Type.Unsafe<Ruleset>(
  rulesetShape satisfies SchemaProof<Ruleset, typeof rulesetShape>,
);

/** 규칙 데이터 하나를 검증한다. 알 수 없는 필드가 있으면 실패한다 */
export function parseRuleset(input: unknown): Result<Ruleset, ParseError> {
  return parse(RulesetSchema, input);
}

export interface BundledRulesError {
  readonly kind: "rules_invalid";
  /** 어느 규칙 파일인가 */
  readonly source: string;
  readonly cause: ParseError;
}

const BUNDLED_SOURCES: readonly { readonly source: string; readonly data: unknown }[] = [
  { source: "claude-code.json", data: claudeCodeData },
  { source: "agent-skills.json", data: agentSkillsData },
  { source: "agents-md.json", data: agentsMdData },
];

/** 패키지에 들어 있는 규칙을 스키마로 검증해 읽는다. 파일이 스키마에 맞지 않으면 실패 값을 돌려준다 */
export function bundledRulesets(): Result<readonly Ruleset[], BundledRulesError> {
  const rulesets: Ruleset[] = [];
  for (const { source, data } of BUNDLED_SOURCES) {
    const checked = parseRuleset(data);
    if (!checked.ok) return err({ kind: "rules_invalid", source, cause: checked.error });
    rulesets.push(checked.value);
  }
  return ok(rulesets);
}

function matchesRule(match: RuleMatch, query: RuleQuery): boolean {
  if (match.kind !== undefined && match.kind !== query.kind) return false;
  if (match.container !== undefined && match.container !== query.container) return false;
  if (match.key !== undefined && match.key !== query.key) return false;
  if (match.code !== undefined && match.code !== query.code) return false;
  if (match.values !== undefined) {
    if (query.value === undefined || !match.values.includes(query.value)) return false;
  }
  return true;
}

/** 항목에 맞는 첫 규칙. 없으면 `undefined`(호출자가 `no_rule`로 본다) */
export function findRule(ruleset: Ruleset, query: RuleQuery): Rule | undefined {
  return ruleset.rules.find((rule) => matchesRule(rule.match, query));
}

/** 원본 도구 이름의 Fresnel 이름. 표에 없으면 undefined. 객체의 상속 속성은 찾지 않는다 */
export function toolNameFor(ruleset: Ruleset, claudeName: string): string | undefined {
  return Object.hasOwn(ruleset.toolNames, claudeName) ? ruleset.toolNames[claudeName] : undefined;
}
