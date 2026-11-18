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

/**
 * Hook 이벤트 하나를 옮기는 자리(migration.md §4.3.5). `position`은 `g.on`으로 거는 지점, `decides`는 그 지점이 허용하는
 * 결정 종류의 상한, `budgetSeconds`는 엔진이 그 지점에 주는 예산이다(ext-host `DEFAULT_BUDGETS_MS`의 같은 등급 값).
 */
interface RuleHook {
  readonly position: string;
  readonly decides: readonly string[];
  readonly budgetSeconds: number;
  /** 이 이벤트가 매처를 받는가. 받지 않으면 매처 원문은 무시된다(원본과 같다) */
  readonly matcher: boolean;
}

export interface Rule {
  readonly match: RuleMatch;
  readonly status: ReportStatus;
  readonly reason?: RuleReason;
  readonly difference?: RuleDifference;
  readonly alternative?: string;
  /** 옮기는 Hook 이벤트에만 있다. 있으면 이 규칙의 항목은 플러그인 실행 선언이 된다 */
  readonly hook?: RuleHook;
}

/** 스크립트 본문이 입력이나 환경에서 읽는 이름(예: `transcript_path`). 본문에 나오면 차이로 적는다 */
interface ScriptInputNote {
  readonly needle: string;
  readonly text: string;
}

export interface Ruleset {
  readonly harness: HarnessId;
  readonly rulesVersion: string;
  readonly docs: readonly string[];
  /** 원본 도구 이름 → Fresnel 도구 이름. 규칙표에 없는 이름은 번역되지 않는다 */
  readonly toolNames: Readonly<Record<string, string>>;
  /** 처음 맞는 규칙이 이긴다. 값이 있는 규칙을 앞에 둔다 */
  readonly rules: readonly Rule[];
  /** 옮긴 Hook마다 붙는 차이(입력 필드가 없다 등) */
  readonly hookNotes?: readonly RuleDifference[];
  /** 스크립트 본문에서 찾을 이름과 그 차이 */
  readonly scriptInputs?: readonly ScriptInputNote[];
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
  Type.Literal("hook"),
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

const RuleHookSchema = Type.Object(
  {
    position: Type.String({ minLength: 1, maxLength: 48 }),
    decides: Type.Array(Type.String({ minLength: 1, maxLength: 16 }), { maxItems: 3 }),
    budgetSeconds: Type.Integer({ minimum: 1, maximum: 600 }),
    matcher: Type.Boolean(),
  },
  { additionalProperties: false },
);

const RuleSchema = Type.Object(
  {
    match: RuleMatchSchema,
    status: ReportStatusSchema,
    hook: Type.Optional(RuleHookSchema),
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
    hookNotes: Type.Optional(
      Type.Array(
        Type.Object(
          { kind: DifferenceKindSchema, text: Type.String({ minLength: 1 }) },
          { additionalProperties: false },
        ),
      ),
    ),
    scriptInputs: Type.Optional(
      Type.Array(
        Type.Object(
          {
            needle: Type.String({ minLength: 1, maxLength: 64 }),
            text: Type.String({ minLength: 1 }),
          },
          { additionalProperties: false },
        ),
      ),
    ),
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

/**
 * Fresnel 도구 이름의 원본 이름(Hook 입력 변환). 같은 이름이 여럿이면 표에서 먼저 적힌 것이다. 표에 없으면 undefined다.
 * 표의 순서가 정본 이름을 고른다(예: `edit`는 `Edit`가 먼저다).
 */
export function claudeNameFor(ruleset: Ruleset, fresnelName: string): string | undefined {
  for (const [claudeName, mapped] of Object.entries(ruleset.toolNames)) {
    if (mapped === fresnelName) return claudeName;
  }
  return undefined;
}
