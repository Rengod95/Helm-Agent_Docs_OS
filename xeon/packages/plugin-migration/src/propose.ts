// 제안 엔진(migration.md §6.3 3단계, §7.2). 훑기 결과를 규칙으로 옮겨 플러그인 초안, 항목별 보고 줄, 질문, 프로필 제안을 만든다.
// 순수하고 결정적이다. 시각, 난수, 환경 변수, 입출력을 쓰지 않는다. 같은 입력이면 같은 결과를 낸다.
// 항목 하나는 보고 줄 하나를 정확히 낸다(수용 기준 1). 규칙표에 없는 항목은 `no_rule`이다.
import { assertNever, Bug, parse } from "@fresnel/contracts";
import { McpServerDefSchema, McpServerIdSchema } from "@fresnel/contracts/capabilities";
import { looksLikeSecretValue } from "./secrets.ts";
import {
  claudeNameFor,
  findRule,
  NO_RULE,
  NO_RULE_ALTERNATIVE,
  toolNameFor,
  type Rule,
  type RuleReason,
  type Ruleset,
} from "./rules.ts";
import {
  HOOK_ADAPTER,
  hookPluginJs,
  type HookEntryData,
  type HookScriptDecl,
} from "./adapters/hook-plugin.ts";
import {
  agentNameFrom,
  codePointLength,
  extensionNameFrom,
  fileStem,
  headCodePoints,
  isSafeRelativePath,
  isSafeSegment,
  suffixedName,
  truncateAtSentence,
} from "./slug.ts";
import type { PlannedPluginWithMigration, PluginMigrationSource } from "./emit.ts";
import type {
  Choices,
  HarnessId,
  IrAgent,
  IrCommand,
  IrHook,
  IrHookScript,
  IrInstruction,
  IrKind,
  IrMcp,
  IrSkill,
  ItemScope,
  MigrationProposal,
  McpDefDraft,
  MigrationScan,
  PluginRuntimeDecl,
  Question,
  ReportLine,
  ReportStatus,
  SourceItem,
  UserConfigDraft,
} from "./types.ts";

// ── 상수 ─────────────────────────────────────────────────────────────────

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_NAME_MAX = 64;
const SKILL_DESCRIPTION_MAX = 1024;
const AGENT_DESCRIPTION_MAX = 1000;
const PURPOSE_MAX = 200;
const SECRET_NAME_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const USER_CONFIG_KEY_MAX = 64;

const HARNESS_NAME: Readonly<Record<HarnessId, string>> = {
  "claude-code": "Claude Code",
  "agent-skills": "Agent Skills",
  "agents-md": "AGENTS.md",
};

const NOUN: Readonly<Record<IrKind, string>> = {
  instruction: "지침",
  skill: "스킬",
  command: "명령",
  agent: "서브에이전트",
  mcp: "MCP 서버",
  field: "설정",
  blocked: "항목",
  hook: "Hook",
};

/** 원본 기본 시간 제한(초). 핸들러에 `timeout`이 없을 때 쓴다(migration.md §4.3.5) */
const DEFAULT_HOOK_TIMEOUT_SECONDS = 600;
/** 시간 제한은 지점 예산에서 이만큼을 뺀다(엔진이 핸들러를 끊기 전에 스크립트를 끊는다) */
const HOOK_TIMEOUT_MARGIN_SECONDS = 1;
const SCRIPT_NAME_MAX = 32;
/** Hook 항목의 자리: 등록 코드가 든 파일 */
const HOOK_CODE_PATH = "plugin.js";
const HOOK_DATA_PATH = "hooks.data.json";

const PROJECT_SCOPE_TEXT =
  "프로젝트 범위에서 온 항목이다. 사용자 플러그인 폴더에 두고 프로젝트 이름의 프로필을 제안한다. 프로필 배치는 사용자가 확인한다.";
const USER_INSTRUCTION_SCOPE_TEXT = "프로필 단위로 적용된다. 프로필 배치는 사용자가 고른다.";

// ── 내부 자료형 ───────────────────────────────────────────────────────────

type Difference = ReportLine["differences"][number];
type ScopeGroup = "user" | "project";

/** 파일 하나. `numbered`는 지침 조각이라 플러그인 안의 순서 번호를 받는다(§6.4) */
type UnitFile =
  | { readonly kind: "fixed"; readonly path: string; readonly bytes: Uint8Array }
  | { readonly kind: "numbered"; readonly stem: string; readonly bytes: Uint8Array };

/** Hook 항목 하나가 플러그인에 주는 것. 스크립트 복사본과 `g.on` 등록 한 줄이다 */
interface HookUnit {
  readonly event: string;
  /** `g.on`으로 거는 지점(규칙표가 정한다) */
  readonly position: string;
  /** 그 지점이 낼 수 있는 결정 종류의 상한 */
  readonly decides: readonly string[];
  /** 매처 원문. 모든 도구에 맞으면 null */
  readonly matcher: string | null;
  readonly keyPath: string | undefined;
  /** 원본 설정 파일의 표시 경로 */
  readonly sourcePath: string;
  /** 엔진에 거는 실제 시간 제한(초). 원본 제한과 `지점 예산 − 1초` 가운데 작은 값이다 */
  readonly timeoutSeconds: number;
  /** 원본 시간 제한(초). 없으면 600이다 */
  readonly originalSeconds: number;
  readonly script: IrHookScript;
}

/** 항목 하나가 플러그인 하나의 일부로 들어가는 단위. 같은 `groupKey`의 단위는 같은 플러그인이 된다 */
interface Unit {
  readonly groupKey: string;
  readonly harness: HarnessId;
  readonly scope: ItemScope;
  readonly rootLabel: string;
  readonly baseName: string;
  readonly purpose: string;
  readonly files: readonly UnitFile[];
  readonly userConfig: readonly UserConfigDraft[];
  /** Hook 항목이면 있다. 같은 설정 파일의 Hook은 한 플러그인이 된다 */
  readonly hook?: HookUnit;
}

/** 항목 하나의 판정. `unit`이 있으면 플러그인으로 간다 */
interface Plan {
  readonly status: ReportStatus;
  readonly differences: readonly Difference[];
  readonly reason: RuleReason | undefined;
  readonly alternative: string | undefined;
  readonly unit: Unit | undefined;
  readonly questions: readonly Question[];
}

interface Entry {
  readonly item: SourceItem;
  readonly plan: Plan;
}

interface Placement {
  readonly plugin: string;
  readonly path: string;
}

interface Member {
  readonly entry: Entry;
  readonly unit: Unit;
}

interface Group {
  readonly key: string;
  readonly harness: HarnessId;
  readonly scopeGroup: ScopeGroup;
  readonly rootLabel: string;
  readonly baseName: string;
  readonly purpose: string;
  readonly members: Member[];
}

interface Built {
  readonly name: string;
  readonly group: Group;
  readonly tree: Map<string, Uint8Array>;
  readonly placements: readonly { readonly entry: Entry; readonly placement: Placement }[];
}

interface Context {
  readonly rulesets: ReadonlyMap<HarnessId, Ruleset>;
  readonly choices: Choices;
  /** 그룹 키 → 이미 차지한 파일 경로(서브에이전트와 명령의 같은 이름을 잡는다) */
  readonly takenFiles: Map<string, Set<string>>;
}

// ── 작은 도우미 ───────────────────────────────────────────────────────────

function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function presentOf<T>(values: readonly (T | undefined)[]): T[] {
  const out: T[] = [];
  for (const value of values) {
    if (value !== undefined) out.push(value);
  }
  return out;
}

function scopeGroupOf(scope: ItemScope): ScopeGroup {
  return scope === "project" || scope === "local" ? "project" : "user";
}

function scopeWordOf(group: ScopeGroup): string {
  return group === "project" ? "프로젝트" : "사용자";
}

function scopeDifferenceOf(item: SourceItem): Difference | undefined {
  if (scopeGroupOf(item.scope) !== "project") return undefined;
  return { kind: "scope_change", text: PROJECT_SCOPE_TEXT };
}

function statusOf(differences: readonly Difference[]): ReportStatus {
  return differences.some((difference) => difference.kind !== "scope_change") ? "differs" : "exact";
}

function placed(unit: Unit, differences: readonly Difference[]): Plan {
  return {
    status: statusOf(differences),
    differences,
    reason: undefined,
    alternative: undefined,
    unit,
    questions: [],
  };
}

function unported(reason: RuleReason, alternative: string | undefined): Plan {
  return {
    status: "not_ported",
    differences: [],
    reason,
    alternative,
    unit: undefined,
    questions: [],
  };
}

/** 규칙 하나를 판정으로 옮긴다. 규칙이 없으면 `no_rule`이다 */
function fromRule(rule: Rule | undefined): Plan {
  if (rule === undefined) return unported(NO_RULE, NO_RULE_ALTERNATIVE);
  const reason = rule.reason ?? (rule.status === "not_ported" ? NO_RULE : undefined);
  return {
    status: rule.status,
    differences: rule.difference === undefined ? [] : [rule.difference],
    reason,
    alternative: rule.alternative,
    unit: undefined,
    questions: [],
  };
}

/** 정책 코드(`description_missing`, `question_open` 등)의 규칙 */
function policy(rs: Ruleset, kind: IrKind, code: string): Plan {
  return fromRule(findRule(rs, { kind, code }));
}

function questionOpen(rs: Ruleset, kind: IrKind, questions: readonly Question[]): Plan {
  return { ...policy(rs, kind, "question_open"), questions };
}

function questionOf(
  id: string,
  itemId: string,
  text: string,
  options: readonly string[],
): Question {
  return { id, itemId, text, options };
}

/**
 * 사용자의 답을 읽는다. 선택지에 있거나 `extra`가 참이면 답으로 받는다. 아니면 열린 질문이다.
 * 선택지 밖의 값은 조용히 고르지 않는다.
 */
function answerOf(
  choices: Choices,
  question: Question,
  extra?: (value: string) => boolean,
): string | undefined {
  if (!Object.hasOwn(choices.answers, question.id)) return undefined;
  const value = choices.answers[question.id];
  if (value === undefined) return undefined;
  const accepted = question.options.includes(value) || (extra?.(value) ?? false);
  return accepted ? value : undefined;
}

function isExtensionName(value: string): boolean {
  return extensionNameFrom(value) === value;
}

/** 파일 이름을 쓰는 단위에서 같은 경로가 이미 있으면 참이다(같은 플러그인 안의 이름 충돌) */
function claimFile(ctx: Context, groupKey: string, path: string): boolean {
  const taken = ctx.takenFiles.get(groupKey) ?? new Set<string>();
  ctx.takenFiles.set(groupKey, taken);
  if (taken.has(path)) return false;
  taken.add(path);
  return true;
}

function groupKeyOf(item: SourceItem, kind: string): string {
  const group = scopeGroupOf(item.scope);
  return [item.harness, kind, group, group === "project" ? item.rootLabel : ""].join("|");
}

/** `claude-code-user-commands` 같은 기본 이름. 확장 이름 규칙에 맞게 줄인다 */
function pluginBaseOf(harness: HarnessId, group: ScopeGroup, kind: string): string {
  return extensionNameFrom(`${harness}-${group}-${kind}`) ?? "migrated-plugin";
}

function purposeOfDescription(text: string): string {
  const line = text
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry !== "");
  return headCodePoints(line ?? text.trim(), PURPOSE_MAX);
}

function baseNameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function ownerNameOf(item: SourceItem): string {
  const segments = item.path.split("/").filter((segment) => segment !== "");
  const last = segments.at(-1) ?? item.path;
  if (last === "SKILL.md") return segments.at(-2) ?? last;
  return last.replace(/\.[^.]*$/, "");
}

function uniqueName(base: string, used: Set<string>, existing: readonly string[]): string {
  let candidate = base;
  let n = 2;
  while (used.has(candidate) || existing.includes(candidate)) {
    candidate = suffixedName(base, n);
    n += 1;
  }
  used.add(candidate);
  return candidate;
}

function twoDigits(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// ── 스킬 ─────────────────────────────────────────────────────────────────

function planSkill(item: SourceItem, ir: IrSkill, rs: Ruleset, ctx: Context): Plan {
  const description = ir.description;
  if (description === undefined || description.trim() === "") {
    return policy(rs, "skill", "description_missing");
  }
  if (ir.name === undefined) return policy(rs, "skill", "name_missing");
  const name = ir.name;

  const nameOk =
    name === ir.dirName && SKILL_NAME_PATTERN.test(name) && codePointLength(name) <= SKILL_NAME_MAX;
  const baseFromDir = extensionNameFrom(ir.dirName);
  const nameQuestion = nameOk
    ? undefined
    : questionOf(
        `skill-name:${item.itemId}`,
        item.itemId,
        `스킬 ${ir.dirName}의 머리말 name(\`${name}\`)이 폴더 이름과 다르거나 규칙에 맞지 않다. 슬러그로 옮길지(slug) 건너뛸지 고른다.`,
        ["slug", "skip"],
      );
  const descriptionQuestion =
    codePointLength(description) > SKILL_DESCRIPTION_MAX
      ? questionOf(
          `skill-description:${item.itemId}`,
          item.itemId,
          `스킬 ${ir.dirName}의 설명이 1024자를 넘는다. 그대로 옮길지(keep) 건너뛸지 고른다.`,
          ["keep", "skip"],
        )
      : undefined;
  const pluginQuestion =
    baseFromDir === undefined
      ? questionOf(
          `plugin-name:${item.itemId}`,
          item.itemId,
          `스킬 폴더 ${ir.dirName}을 플러그인 이름 규칙(영문 소문자로 시작, 소문자·숫자·하이픈, 2~32자)에 맞출 수 없다. 플러그인 이름을 직접 입력하거나 건너뛴다.`,
          ["skip"],
        )
      : undefined;

  const nameAnswer = nameQuestion === undefined ? undefined : answerOf(ctx.choices, nameQuestion);
  const descriptionAnswer =
    descriptionQuestion === undefined ? undefined : answerOf(ctx.choices, descriptionQuestion);
  const pluginAnswer =
    pluginQuestion === undefined
      ? undefined
      : answerOf(ctx.choices, pluginQuestion, isExtensionName);

  if ([nameAnswer, descriptionAnswer, pluginAnswer].includes("skip")) {
    return policy(rs, "skill", "user_skipped");
  }
  const open = presentOf([
    nameQuestion !== undefined && nameAnswer === undefined ? nameQuestion : undefined,
    descriptionQuestion !== undefined && descriptionAnswer === undefined
      ? descriptionQuestion
      : undefined,
    pluginQuestion !== undefined && pluginAnswer === undefined ? pluginQuestion : undefined,
  ]);
  if (open.length > 0) return questionOpen(rs, "skill", open);

  const base = baseFromDir ?? pluginAnswer;
  if (base === undefined) {
    throw new Bug("skill plugin name must be resolved before the skill is planned");
  }
  if (!isSafeSegment(ir.dirName) || ir.files.some((file) => !isSafeRelativePath(file.path))) {
    return policy(rs, "skill", "unsafe_path");
  }

  const slugRenamed: Difference | undefined =
    nameAnswer === "slug"
      ? {
          kind: "renamed",
          text: `머리말 name(\`${name}\`)이 폴더 이름과 달라 플러그인 이름만 슬러그(\`${base}\`)로 정했다. 스킬 폴더와 파일은 원본 그대로 옮긴다.`,
        }
      : undefined;
  const folderRenamed: Difference | undefined =
    base === ir.dirName
      ? undefined
      : {
          kind: "renamed",
          text: `플러그인 이름을 \`${base}\`로 정했다(폴더 이름은 \`${ir.dirName}\`).`,
        };
  const differences = presentOf<Difference>([
    slugRenamed ?? folderRenamed,
    descriptionAnswer === "keep"
      ? {
          kind: "user_choice",
          text: "설명이 1024자를 넘는 채로 옮겨진다(사용자가 그대로 옮기기를 골랐다).",
        }
      : undefined,
    scopeDifferenceOf(item),
  ]);

  const unit: Unit = {
    groupKey: `${item.harness}|skill|${item.itemId}`,
    harness: item.harness,
    scope: item.scope,
    rootLabel: item.rootLabel,
    baseName: base,
    purpose: purposeOfDescription(description),
    files: ir.files.map((file): UnitFile => ({
      kind: "fixed",
      path: `skills/${ir.dirName}/${file.path}`,
      bytes: file.bytes,
    })),
    userConfig: [],
  };
  return placed(unit, differences);
}

// ── 지침 ─────────────────────────────────────────────────────────────────

function instructionScopeDifference(item: SourceItem): Difference {
  if (scopeGroupOf(item.scope) === "project")
    return { kind: "scope_change", text: PROJECT_SCOPE_TEXT };
  return { kind: "scope_change", text: USER_INSTRUCTION_SCOPE_TEXT };
}

/** 원본 파일 이름이나 가져온 파일 이름에서 조각의 이름을 정한다. 조각이 하나면 항목 이름을 쓴다 */
function stemOfPart(source: string, fallback: string): string {
  const base = baseNameOf(source).replace(/\.[^.]*$/, "");
  return base === "" ? fallback : base;
}

function planInstruction(item: SourceItem, ir: IrInstruction, rs: Ruleset): Plan {
  if (ir.role === "agents_md")
    return fromRule(findRule(rs, { kind: "instruction", code: "agents_md" }));
  if (ir.role === "project_file") {
    if (ir.onlyAgentsMdImport) {
      return fromRule(findRule(rs, { kind: "instruction", code: "agents_md_import_only" }));
    }
    return fromRule(findRule(rs, { kind: "blocked", code: "project_instruction_file" }));
  }
  if (ir.activation === "globs") {
    return fromRule(findRule(rs, { kind: "blocked", code: "conditional_rule" }));
  }

  // 가져오기를 풀었으면 조각마다 파일 하나다. 연결하면 원문과 같다(수용 기준 11). 조각이 없으면 원문 한 덩어리다
  const pieces = ir.parts.length > 0 ? ir.parts : [{ source: item.path, text: ir.text }];
  const single = pieces.length === 1;
  const files: UnitFile[] = pieces.map((piece): UnitFile => ({
    kind: "numbered",
    stem: single ? ir.name : stemOfPart(piece.source, ir.name),
    bytes: encodeText(piece.text),
  }));
  const group = scopeGroupOf(item.scope);
  const unit: Unit = {
    groupKey: groupKeyOf(item, "instructions"),
    harness: item.harness,
    scope: item.scope,
    rootLabel: item.rootLabel,
    baseName: pluginBaseOf(item.harness, group, "instructions"),
    purpose: `${HARNESS_NAME[item.harness]} ${scopeWordOf(group)} 지침(가져옴)`,
    files,
    userConfig: [],
  };
  return placed(unit, [instructionScopeDifference(item)]);
}

// ── 명령 ─────────────────────────────────────────────────────────────────

function planCommand(item: SourceItem, ir: IrCommand, rs: Ruleset, ctx: Context): Plan {
  if (ir.hasSubstitutions) return policy(rs, "command", "command_args_unspecified");
  const name = fileStem(ir.name);
  const path = `commands/${name}.md`;
  const groupKey = groupKeyOf(item, "commands");
  if (!claimFile(ctx, groupKey, path)) return policy(rs, "command", "name_conflict");

  const renamed = ir.relPath.includes("/") || name !== ir.name;
  const differences = presentOf<Difference>([
    renamed
      ? { kind: "renamed", text: `원래 이름 \`${ir.relPath}\`을 \`${name}\`으로 평탄화했다.` }
      : undefined,
    scopeDifferenceOf(item),
  ]);
  const group = scopeGroupOf(item.scope);
  const unit: Unit = {
    groupKey,
    harness: item.harness,
    scope: item.scope,
    rootLabel: item.rootLabel,
    baseName: pluginBaseOf(item.harness, group, "commands"),
    purpose: `${HARNESS_NAME[item.harness]} ${scopeWordOf(group)} 명령(가져옴)`,
    files: [{ kind: "fixed", path, bytes: encodeText(ir.text) }],
    userConfig: [],
  };
  return placed(unit, differences);
}

// ── 서브에이전트 ─────────────────────────────────────────────────────────

/** 원본 도구 이름을 Fresnel 이름으로 번역한다. 못 맞춘 이름은 빼고 차이로 적는다. 중복은 하나로 합친다 */
function translateTools(
  names: readonly string[],
  rs: Ruleset,
): { readonly tools: string[]; readonly differences: Difference[] } {
  const tools: string[] = [];
  const differences: Difference[] = [];
  for (const name of names) {
    const paren = name.indexOf("(");
    const base = (paren === -1 ? name : name.slice(0, paren)).trim();
    const mapped = toolNameFor(rs, base);
    if (mapped === undefined) {
      differences.push({ kind: "semantic_loss", text: `\`${name}\`은 대응하는 도구가 없어 뺐다.` });
      continue;
    }
    if (paren !== -1) {
      differences.push({ kind: "semantic_loss", text: `\`${name}\`의 인자 제한은 옮기지 않았다.` });
    }
    if (!tools.includes(mapped)) tools.push(mapped);
  }
  return { tools, differences };
}

/** 권한 모드 번역: default와 acceptEdits는 그대로, bypassPermissions는 bypass로 옮긴다. 나머지는 옮기지 않는다 */
function permissionModeOf(mode: string | undefined): {
  readonly value: string | undefined;
  readonly difference: Difference | undefined;
} {
  if (mode === undefined) return { value: undefined, difference: undefined };
  if (mode === "default" || mode === "acceptEdits") return { value: mode, difference: undefined };
  if (mode === "bypassPermissions") {
    return {
      value: "bypass",
      difference: {
        kind: "approval_flow",
        text: "부모 대화의 모드가 bypass일 때만 효력이 있다.",
      },
    };
  }
  return {
    value: undefined,
    difference: { kind: "semantic_loss", text: `권한 모드 \`${mode}\`은 옮기지 않았다.` },
  };
}

function planAgent(item: SourceItem, ir: IrAgent, rs: Ruleset, ctx: Context): Plan {
  const rawName = ir.name ?? ir.fileName;
  const name = agentNameFrom(rawName);
  if (name === undefined) return policy(rs, "agent", "agent_name_invalid");
  const description = ir.description;
  if (description === undefined || description.trim() === "") {
    return policy(rs, "agent", "description_missing");
  }
  if (ir.prompt.trim() === "") return policy(rs, "agent", "prompt_missing");

  const descriptionQuestion =
    codePointLength(description) > AGENT_DESCRIPTION_MAX
      ? questionOf(
          `agent-description:${item.itemId}`,
          item.itemId,
          `서브에이전트 ${name}의 설명이 1000자를 넘는다. 문장 경계에서 자를지(truncate) 건너뛸지 고른다.`,
          ["truncate", "skip"],
        )
      : undefined;
  const modelQuestion =
    ir.model === undefined
      ? undefined
      : questionOf(
          `agent-model:${item.itemId}`,
          item.itemId,
          `서브에이전트 ${name}의 모델 \`${ir.model}\`을 옮길지 고른다. 기본은 생략이다. 별칭이 이 공급자의 어느 모델을 가리키는지 알 수 없다.`,
          ir.model === "omit" ? ["omit"] : ["omit", ir.model],
        );

  const descriptionAnswer =
    descriptionQuestion === undefined ? undefined : answerOf(ctx.choices, descriptionQuestion);
  if (descriptionAnswer === "skip") return policy(rs, "agent", "user_skipped");
  const modelAnswer =
    modelQuestion === undefined ? undefined : answerOf(ctx.choices, modelQuestion);

  if (descriptionQuestion !== undefined && descriptionAnswer === undefined) {
    return questionOpen(rs, "agent", [descriptionQuestion]);
  }
  // 모델 질문은 답이 없어도 초안을 만든다(생략으로 간주한다)
  const pendingModel =
    modelQuestion !== undefined && modelAnswer === undefined ? [modelQuestion] : [];

  const truncate = descriptionQuestion !== undefined && descriptionAnswer === "truncate";
  const finalDescription = truncate
    ? truncateAtSentence(description, AGENT_DESCRIPTION_MAX)
    : description;

  const translated = ir.tools === undefined ? undefined : translateTools(ir.tools, rs);

  let model: string | undefined;
  const modelDifferences: Difference[] = [];
  if (ir.model !== undefined) {
    if (modelAnswer === ir.model && ir.model !== "omit") {
      model = ir.model;
      modelDifferences.push({
        kind: "user_choice",
        text: `모델 \`${ir.model}\`은 사용자가 고른 값이라 그대로 옮겼다. 이 공급자에 같은 모델이 있는지는 확인하지 못했다.`,
      });
    } else {
      modelDifferences.push({
        kind: "user_choice",
        text:
          modelAnswer === "omit"
            ? "모델 지정은 옮기지 않았다(사용자가 생략을 골랐다)."
            : "모델 지정은 옮기지 않았다. 직접 고르려면 질문에 답한다.",
      });
    }
  }

  const mode = permissionModeOf(ir.permissionMode);
  const differences = presentOf<Difference>([
    name === rawName
      ? undefined
      : { kind: "renamed", text: `서브에이전트 이름 \`${rawName}\`을 \`${name}\`로 바꿨다.` },
    truncate
      ? { kind: "user_choice", text: "설명을 문장 경계에서 1000자 이내로 잘랐다." }
      : undefined,
    ...(translated?.differences ?? []),
    ...modelDifferences,
    mode.difference,
    ir.disallowedTools !== undefined && ir.disallowedTools.length > 0
      ? {
          kind: "semantic_loss",
          text: "금지 도구 목록은 옮기지 않았다(변환 시점의 도구 목록이 필요하다).",
        }
      : undefined,
    scopeDifferenceOf(item),
  ]);

  const frontmatter: string[] = [
    `name: ${JSON.stringify(name)}`,
    `description: ${JSON.stringify(finalDescription)}`,
  ];
  if (translated !== undefined) frontmatter.push(`tools: ${JSON.stringify(translated.tools)}`);
  if (model !== undefined) frontmatter.push(`model: ${JSON.stringify(model)}`);
  if (mode.value !== undefined) frontmatter.push("permissions:", `  mode: ${mode.value}`);
  const text = `---\n${frontmatter.join("\n")}\n---\n${ir.prompt}`;

  const path = `agents/${name}.md`;
  const groupKey = groupKeyOf(item, "agents");
  if (!claimFile(ctx, groupKey, path)) return policy(rs, "agent", "name_conflict");

  const group = scopeGroupOf(item.scope);
  const unit: Unit = {
    groupKey,
    harness: item.harness,
    scope: item.scope,
    rootLabel: item.rootLabel,
    baseName: pluginBaseOf(item.harness, group, "agents"),
    purpose: `${HARNESS_NAME[item.harness]} ${scopeWordOf(group)} 서브에이전트(가져옴)`,
    files: [{ kind: "fixed", path, bytes: encodeText(text) }],
    userConfig: [],
  };
  return { ...placed(unit, differences), questions: pendingModel };
}

// ── MCP 서버 ─────────────────────────────────────────────────────────────

function allStringsOf(def: McpDefDraft): string[] {
  const transport = def.transport;
  if (transport.type === "stdio") {
    return [
      transport.command,
      ...(transport.args ?? []),
      ...(transport.cwd === undefined ? [] : [transport.cwd]),
      ...Object.values(transport.env ?? {}),
    ];
  }
  return [transport.url, ...Object.values(transport.headers ?? {})];
}

/** 서버 정의 하나를 `mcp.json`의 항목으로 바꾼다(M5c가 정하기 전의 [제안] 모양, Claude식 평평한 형식) */
function mcpEntryOf(def: McpDefDraft): Record<string, unknown> {
  const transport = def.transport;
  const timeouts = def.timeouts === undefined ? {} : { timeouts: def.timeouts };
  if (transport.type === "stdio") {
    return {
      type: "stdio",
      command: transport.command,
      ...(transport.args === undefined ? {} : { args: transport.args }),
      ...(transport.cwd === undefined ? {} : { cwd: transport.cwd }),
      ...(transport.env === undefined ? {} : { env: transport.env }),
      ...timeouts,
    };
  }
  return {
    type: transport.type,
    url: transport.url,
    ...(transport.headers === undefined ? {} : { headers: transport.headers }),
    ...(transport.oauth === undefined ? {} : { oauth: transport.oauth }),
    ...timeouts,
  };
}

/** 시크릿 이름의 변수 이름을 사용자 설정 키로 바꾼다(`^[a-zA-Z][a-zA-Z0-9_]{0,63}$`) */
function configKeyOf(varName: string): string {
  const cleaned = varName.replace(/[^A-Za-z0-9_]/g, "_").slice(0, USER_CONFIG_KEY_MAX);
  const base = cleaned === "" ? "value" : cleaned;
  return /^[A-Za-z]/.test(base) ? base : `k_${base}`.slice(0, USER_CONFIG_KEY_MAX);
}

function planMcp(item: SourceItem, ir: IrMcp, rs: Ruleset): Plan {
  if (ir.transport === "ws") return policy(rs, "mcp", "mcp_ws_unsupported");
  const id = ir.id;
  if (id === undefined || !parse(McpServerIdSchema, id).ok) {
    return policy(rs, "mcp", "invalid_server_name");
  }
  const base = extensionNameFrom(`mcp-${id}`);
  if (base === undefined) return policy(rs, "mcp", "invalid_server_name");
  const def = ir.def;
  if (def === undefined) return policy(rs, "mcp", "invalid_definition");

  // 값 자체가 시크릿 모양이면 어떤 경로로도 싣지 않는다(수용 기준 7의 안전망)
  if (allStringsOf(def).some((value) => looksLikeSecretValue(value))) {
    return policy(rs, "mcp", "literal_secret_in_source");
  }
  if (ir.secretRefs.some((ref) => !SECRET_NAME_PATTERN.test(ref.secretName))) {
    return policy(rs, "mcp", "invalid_definition");
  }
  const serverDef =
    def.timeouts === undefined
      ? { transport: def.transport }
      : { transport: def.transport, timeouts: def.timeouts };
  if (!parse(McpServerDefSchema, serverDef).ok) return policy(rs, "mcp", "invalid_definition");

  const seenSecrets = new Set<string>();
  const userConfig: UserConfigDraft[] = [];
  for (const ref of ir.secretRefs) {
    if (seenSecrets.has(ref.secretName)) continue;
    seenSecrets.add(ref.secretName);
    userConfig.push({
      key: configKeyOf(ref.varName),
      title: ref.varName,
      sensitive: true,
      required: true,
      secretName: ref.secretName,
    });
  }

  const literal = ir.secretRefs.some((ref) => ref.origin === "literal");
  const secretNames = [...new Set(ir.secretRefs.map((ref) => ref.varName))].join(", ");
  const differences = presentOf<Difference>([
    id === ir.serverName
      ? undefined
      : { kind: "renamed", text: `서버 이름 \`${ir.serverName}\`이 \`${id}\`로 바뀌었다.` },
    ir.secretRefs.length > 0
      ? {
          kind: "user_choice",
          text: `시크릿 값은 옮기지 않았다. 사용자가 시크릿 저장소에 직접 넣어야 한다(${secretNames}).`,
        }
      : undefined,
    ir.projectBound
      ? { kind: "scope_change", text: "프로젝트 폴더에 묶인다. 서버가 프로젝트 경로를 쓴다." }
      : scopeDifferenceOf(item),
    allStringsOf(def).some((value) => value.includes("${"))
      ? {
          kind: "semantic_loss",
          text: "환경 변수 참조가 확장되지 않은 채 남았다. Fresnel은 변수를 확장하지 않는다.",
        }
      : undefined,
  ]);
  const alternative = literal
    ? findRule(rs, { kind: "mcp", code: "literal_secret_in_source" })?.alternative
    : undefined;

  const content = `${JSON.stringify({ mcpServers: { [id]: mcpEntryOf(def) } }, null, 2)}\n`;
  const unit: Unit = {
    groupKey: `mcp|${item.itemId}`,
    harness: item.harness,
    scope: item.scope,
    rootLabel: item.rootLabel,
    baseName: base,
    purpose: `\`${ir.serverName}\` MCP 서버(${HARNESS_NAME[item.harness]}에서 가져옴)`,
    files: [{ kind: "fixed", path: "mcp.json", bytes: encodeText(content) }],
    userConfig,
  };
  return { ...placed(unit, differences), alternative };
}

// ── 항목 하나의 판정 ───────────────────────────────────────────────────────

// ── Hook(설정의 hooks, migration.md §4.3.5) ────────────────────────────────

/** 스크립트 파일 이름 바탕. 소문자 영숫자와 하이픈, 영문자로 시작, 32자 이하. 못 맞추면 `script` */
function scriptSlugOf(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .slice(0, SCRIPT_NAME_MAX)
    .replace(/-+$/, "");
  return slug === "" ? "script" : slug;
}

/** 파일 이름을 바탕과 확장자로 나눈다. 확장자는 소문자로 바꾼다 */
function stemOf(fileName: string): { readonly stem: string; readonly extension: string } {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return { stem: fileName, extension: "" };
  return { stem: fileName.slice(0, dot), extension: fileName.slice(dot).toLowerCase() };
}

/** `scripts/` 안의 파일 이름. 이미 쓴 이름이면 `-2`, `-3`을 붙인다 */
function uniqueFileOf(stem: string, extension: string, used: Set<string>): string {
  let name = `${stem}${extension}`;
  let n = 2;
  while (used.has(name)) {
    name = `${stem}-${n}${extension}`;
    n += 1;
  }
  used.add(name);
  return name;
}

function hookDifferencesOf(
  item: SourceItem,
  rule: Rule,
  rs: Ruleset,
  originalSeconds: number,
  limitSeconds: number,
  script: IrHookScript,
): Difference[] {
  const out: Difference[] = [];
  if (rule.difference !== undefined) out.push(rule.difference);
  if (originalSeconds > limitSeconds) {
    out.push({
      kind: "time_limit",
      text: `시간 제한이 달라진다: 원본 ${originalSeconds}초, 여기서는 최대 ${limitSeconds}초`,
    });
  }
  out.push(...(rs.hookNotes ?? []));
  const text = new TextDecoder().decode(script.bytes);
  for (const input of rs.scriptInputs ?? []) {
    if (text.includes(input.needle)) out.push({ kind: "semantic_loss", text: input.text });
  }
  const scope = scopeDifferenceOf(item);
  if (scope !== undefined) out.push(scope);
  return out;
}

/**
 * Hook 항목 하나의 판정. 규칙이 `not_ported`이면 이유를 그대로 낸다. 옮기면 같은 설정 파일의 Hook들과 한 플러그인이 된다.
 * 시간 제한은 원본과 `지점 예산 − 1초` 가운데 작은 값이다(엔진이 핸들러를 끊기 전에 스크립트가 끊긴다).
 */
function planHook(item: SourceItem, ir: IrHook, rs: Ruleset): Plan {
  const rule = findRule(rs, { kind: "hook", container: ir.event, key: ir.handler, code: ir.code });
  if (rule === undefined || rule.status === "not_ported") return fromRule(rule);
  const hookRule = rule.hook;
  if (hookRule === undefined || ir.script === undefined) {
    return unported(NO_RULE, NO_RULE_ALTERNATIVE);
  }
  const originalSeconds = ir.timeoutSeconds ?? DEFAULT_HOOK_TIMEOUT_SECONDS;
  const limitSeconds = hookRule.budgetSeconds - HOOK_TIMEOUT_MARGIN_SECONDS;
  const group = scopeGroupOf(item.scope);
  const hook: HookUnit = {
    event: ir.event,
    position: hookRule.position,
    decides: hookRule.decides,
    matcher: hookRule.matcher && ir.matcher !== undefined && ir.matcher !== "*" ? ir.matcher : null,
    keyPath: item.keyPath,
    sourcePath: item.path,
    timeoutSeconds: Math.min(originalSeconds, limitSeconds),
    originalSeconds,
    script: ir.script,
  };
  const unit: Unit = {
    groupKey: `${item.harness}|hook|${item.path}`,
    harness: item.harness,
    scope: item.scope,
    rootLabel: item.rootLabel,
    baseName: pluginBaseOf(item.harness, group, item.scope === "local" ? "local-hooks" : "hooks"),
    purpose: `${HARNESS_NAME[item.harness]} ${scopeWordOf(group)} 훅(가져옴)`,
    files: [],
    userConfig: [],
    hook,
  };
  return placed(unit, hookDifferencesOf(item, rule, rs, originalSeconds, limitSeconds, ir.script));
}

function planItem(item: SourceItem, ctx: Context): Plan {
  const rs = ctx.rulesets.get(item.harness);
  if (rs === undefined) return unported(NO_RULE, NO_RULE_ALTERNATIVE);
  const ir = item.ir;
  switch (ir.kind) {
    case "skill":
      return planSkill(item, ir, rs, ctx);
    case "instruction":
      return planInstruction(item, ir, rs);
    case "command":
      return planCommand(item, ir, rs, ctx);
    case "agent":
      return planAgent(item, ir, rs, ctx);
    case "mcp":
      return planMcp(item, ir, rs);
    case "field":
      return fromRule(
        findRule(rs, { kind: "field", container: ir.container, key: ir.key, value: ir.summary }),
      );
    case "blocked":
      return fromRule(findRule(rs, { kind: "blocked", code: ir.code }));
    case "hook":
      return planHook(item, ir, rs);
    default:
      return assertNever(ir, "planItem");
  }
}

// ── 머리말 항목의 주인 찾기(보고 줄을 플러그인의 기록에 싣는다) ───────────────

/** 머리말 컨테이너가 속한 항목 종류. 여기에 없는 컨테이너는 주인이 없다 */
const OWNER_KIND_OF_CONTAINER: ReadonlyMap<string, IrKind> = new Map<string, IrKind>([
  ["skill", "skill"],
  ["skill-body", "skill"],
  ["command", "command"],
  ["agent", "agent"],
  ["mcp", "mcp"],
]);

function ownerKindOf(container: string): IrKind | undefined {
  return OWNER_KIND_OF_CONTAINER.get(container);
}

function ownerKeyOf(kind: IrKind, item: SourceItem): string {
  return [kind, item.harness, item.scope, item.rootLabel].join("|");
}

/** 주인 항목의 키 경로 아래에 필드가 있으면 주인이다. 키 경로가 없으면 같은 파일 경로로 본다 */
function ownsField(owner: SourceItem, field: SourceItem): boolean {
  if (owner.keyPath !== undefined && field.keyPath !== undefined) {
    return field.keyPath.startsWith(`${owner.keyPath}.`);
  }
  return owner.path === field.path;
}

function ownersOf(entries: readonly Entry[]): Map<Entry, Entry> {
  const candidates = new Map<string, Entry[]>();
  for (const entry of entries) {
    const kind = entry.item.ir.kind;
    if (kind === "skill" || kind === "command" || kind === "agent" || kind === "mcp") {
      const key = ownerKeyOf(kind, entry.item);
      const list = candidates.get(key) ?? [];
      list.push(entry);
      candidates.set(key, list);
    }
  }
  const owners = new Map<Entry, Entry>();
  for (const entry of entries) {
    const ir = entry.item.ir;
    if (ir.kind !== "field") continue;
    const kind = ownerKindOf(ir.container);
    if (kind === undefined) continue;
    const owner = (candidates.get(ownerKeyOf(kind, entry.item)) ?? []).find((candidate) =>
      ownsField(candidate.item, entry.item),
    );
    if (owner !== undefined) owners.set(entry, owner);
  }
  return owners;
}

// ── 보고 줄 ──────────────────────────────────────────────────────────────

function fieldLabel(item: SourceItem, container: string, key: string): string {
  if (container === "mcp") {
    const server = item.keyPath?.split(".")[1] ?? ownerNameOf(item);
    return `MCP 서버 ${server}의 ${key}`;
  }
  const owner = ownerNameOf(item);
  if (container === "skill") return `스킬 ${owner}의 머리말 ${key}`;
  if (container === "skill-body") return `스킬 ${owner}의 본문 ${key}`;
  if (container === "command") return `명령 ${owner}의 머리말 ${key}`;
  if (container === "agent") return `서브에이전트 ${owner}의 머리말 ${key}`;
  return `${container} ${owner}의 ${key}`;
}

/** 사람이 읽는 이름. 예: "스킬 deploy", "스킬 deploy의 머리말 allowed-tools" */
function labelOf(item: SourceItem): string {
  const ir = item.ir;
  switch (ir.kind) {
    case "skill":
      return `스킬 ${ir.dirName}`;
    case "instruction":
      return `지침 ${baseNameOf(item.path)}`;
    case "command":
      return `명령 ${ir.name}`;
    case "agent":
      return `서브에이전트 ${ir.name ?? ir.fileName}`;
    case "mcp":
      return `MCP 서버 ${ir.serverName}`;
    case "field":
      return fieldLabel(item, ir.container, ir.key);
    case "blocked":
      if (ir.of === "hook") return `Hook ${item.keyPath ?? baseNameOf(item.path)}`;
      return `${NOUN[ir.of]} ${baseNameOf(item.path)}`;
    case "hook":
      return ir.matcher === undefined ? `Hook ${ir.event}` : `Hook ${ir.event}:${ir.matcher}`;
    default:
      return assertNever(ir, "labelOf");
  }
}

function reportLineOf(entry: Entry, placement: Placement | undefined): ReportLine {
  const { item, plan } = entry;
  return {
    itemId: item.itemId,
    harness: item.harness,
    kind: item.kind,
    label: labelOf(item),
    source: {
      scope: item.scope,
      path: item.path,
      ...(item.keyPath === undefined ? {} : { key: item.keyPath }),
    },
    status: plan.status,
    differences: plan.differences,
    ...(plan.reason === undefined ? {} : { reason: plan.reason }),
    ...(plan.alternative === undefined ? {} : { alternative: plan.alternative }),
    ...(placement === undefined
      ? {}
      : { output: { plugin: placement.plugin, path: placement.path } }),
  };
}

// ── 묶기와 이름 ───────────────────────────────────────────────────────────

function groupsOf(entries: readonly Entry[]): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const entry of entries) {
    const unit = entry.plan.unit;
    if (unit === undefined) continue;
    const existing = groups.get(unit.groupKey);
    if (existing !== undefined) {
      existing.members.push({ entry, unit });
      continue;
    }
    groups.set(unit.groupKey, {
      key: unit.groupKey,
      harness: unit.harness,
      scopeGroup: scopeGroupOf(unit.scope),
      rootLabel: unit.rootLabel,
      baseName: unit.baseName,
      purpose: unit.purpose,
      members: [{ entry, unit }],
    });
  }
  return groups;
}

interface HookBuild {
  readonly runtime: PluginRuntimeDecl;
  /** 플러그인 폴더 기준 경로와 바이트. 스크립트 복사본과 생성 코드, 데이터다 */
  readonly files: readonly { readonly path: string; readonly bytes: Uint8Array }[];
}

/**
 * 같은 설정 파일의 Hook들을 플러그인 하나의 실행 선언과 파일로 바꾼다. 스크립트는 파일 하나를 한 번만 복사하고, 선언은
 * Hook마다 하나다(시간 제한이 Hook마다 다르다). 결과는 입력 순서를 따르므로 같은 입력이면 같은 바이트다.
 */
function hookBuildOf(built: Built, rs: Ruleset | undefined): HookBuild | undefined {
  const declNames = new Set<string>();
  const fileNames = new Set<string>();
  const scriptFiles = new Map<string, string>();
  const files: { readonly path: string; readonly bytes: Uint8Array }[] = [];
  const decls: HookScriptDecl[] = [];
  const entries: HookEntryData[] = [];
  const records: Record<string, unknown>[] = [];
  const positions = new Map<string, Set<string>>();
  for (const member of built.group.members) {
    const hook = member.unit.hook;
    if (hook === undefined) continue;
    const { script } = hook;
    const { stem, extension } = stemOf(script.fileName);
    let file = scriptFiles.get(script.path);
    if (file === undefined) {
      file = uniqueFileOf(scriptSlugOf(stem), extension, fileNames);
      scriptFiles.set(script.path, file);
      files.push({ path: `scripts/${file}`, bytes: script.bytes });
    }
    const name = uniqueName(scriptSlugOf(stem), declNames, []);
    const path = `scripts/${file}`;
    decls.push({
      name,
      runner: script.runner,
      file: path,
      args: script.args,
      timeoutMs: Math.round(hook.timeoutSeconds * 1000),
    });
    entries.push({ event: hook.event, matcher: hook.matcher, script: name });
    records.push({
      event: hook.event,
      position: hook.position,
      matcher: hook.matcher,
      handler: "command",
      script: name,
      scriptFile: path,
      timeoutSeconds: hook.timeoutSeconds,
      originalTimeoutSeconds: hook.originalSeconds,
      source: {
        path: hook.sourcePath,
        ...(hook.keyPath === undefined ? {} : { keyPath: hook.keyPath }),
      },
    });
    const allowed = positions.get(hook.position) ?? new Set<string>();
    for (const decide of hook.decides) allowed.add(decide);
    positions.set(hook.position, allowed);
  }
  if (entries.length === 0) return undefined;

  const hookPositions = [...positions.keys()].toSorted(byText);
  const toolNames: Record<string, string> = {};
  if (rs !== undefined) {
    for (const fresnel of new Set(Object.values(rs.toolNames))) {
      const claude = claudeNameFor(rs, fresnel);
      if (claude !== undefined) toolNames[fresnel] = claude;
    }
  }
  const code = hookPluginJs({
    plugin: built.name,
    positions: hookPositions,
    entries,
    toolNames,
  });
  const data = `${JSON.stringify(
    {
      schemaVersion: 1,
      adapter: HOOK_ADAPTER,
      rulesVersion: rs?.rulesVersion ?? "",
      plugin: built.name,
      hooks: records,
    },
    null,
    2,
  )}\n`;
  return {
    runtime: {
      entry: `./${HOOK_CODE_PATH}`,
      scripts: decls,
      hooks: hookPositions,
      hookDecides: hookPositions
        .filter((position) => (positions.get(position)?.size ?? 0) > 0)
        .map((position) => ({
          hook: position,
          decides: [...(positions.get(position) ?? [])].toSorted(byText),
        })),
    },
    files: [
      ...files,
      { path: HOOK_CODE_PATH, bytes: encodeText(code) },
      { path: HOOK_DATA_PATH, bytes: encodeText(data) },
    ],
  };
}

function byText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** 그룹마다 플러그인 이름을 정하고(충돌은 접미사), 파일 트리를 만든다. 지침 조각은 항목 순서대로 번호를 받는다 */
function buildPlugins(groups: Iterable<Group>, existing: readonly string[]): Built[] {
  const used = new Set<string>();
  const built: Built[] = [];
  for (const group of groups) {
    const name = uniqueName(group.baseName, used, existing);
    const tree = new Map<string, Uint8Array>();
    const placements: { readonly entry: Entry; readonly placement: Placement }[] = [];
    let numbered = 0;
    for (const member of group.members) {
      if (member.unit.hook !== undefined) {
        placements.push({ entry: member.entry, placement: { plugin: name, path: HOOK_CODE_PATH } });
        continue;
      }
      const paths: string[] = [];
      for (const file of member.unit.files) {
        let path: string;
        if (file.kind === "fixed") {
          path = file.path;
        } else {
          numbered += 1;
          path = `instructions/${twoDigits(numbered)}-${fileStem(file.stem)}.md`;
        }
        tree.set(path, file.bytes);
        paths.push(path);
      }
      const first = paths[0];
      if (first !== undefined) {
        placements.push({ entry: member.entry, placement: { plugin: name, path: first } });
      }
    }
    built.push({ name, group, tree, placements });
  }
  return built;
}

// ── 제안 ─────────────────────────────────────────────────────────────────

/**
 * 훑기 결과를 제안으로 바꾼다. 항목마다 보고 줄이 정확히 하나 나온다. 열린 질문이 있는 항목은 초안을 만들지 않는다.
 * 같은 입력과 같은 답이면 같은 결과다(시각, 난수, 환경을 쓰지 않는다).
 * 플러그인은 이식 기록(`migration`)을 함께 싣는다. 제출 포트가 그것을 `migration.json`으로 쓰므로 반환 타입에 드러낸다.
 */
export function propose(
  scan: MigrationScan,
  rulesets: readonly Ruleset[],
  choices: Choices,
): Omit<MigrationProposal, "plugins"> & {
  readonly plugins: readonly PlannedPluginWithMigration[];
} {
  const byHarness = new Map<HarnessId, Ruleset>(
    rulesets.map((ruleset): [HarnessId, Ruleset] => [ruleset.harness, ruleset]),
  );
  const ctx: Context = { rulesets: byHarness, choices, takenFiles: new Map() };

  const entries: Entry[] = scan.items.map((item) => ({ item, plan: planItem(item, ctx) }));
  const owners = ownersOf(entries);
  const groups = groupsOf(entries);
  const built = buildPlugins(groups.values(), choices.existingPlugins ?? []);

  const placements = new Map<Entry, Placement>();
  for (const plugin of built) {
    for (const { entry, placement } of plugin.placements) placements.set(entry, placement);
  }

  const rows = entries.map((entry) => ({
    entry,
    line: reportLineOf(entry, placements.get(entry)),
  }));
  const rulesVersions: Record<string, string> = Object.fromEntries(
    rulesets.map((ruleset): [string, string] => [ruleset.harness, ruleset.rulesVersion]),
  );

  // 주인이 플러그인을 가진 머리말 항목은 그 플러그인의 기록에 함께 든다
  const ownedByGroup = new Map<string, Entry[]>();
  for (const [field, owner] of owners) {
    const key = owner.plan.unit?.groupKey;
    if (key === undefined) continue;
    const list = ownedByGroup.get(key) ?? [];
    list.push(field);
    ownedByGroup.set(key, list);
  }

  const plugins: PlannedPluginWithMigration[] = built.map((plugin) => {
    const { group } = plugin;
    const hookBuild = hookBuildOf(plugin, byHarness.get(group.harness));
    if (hookBuild !== undefined) {
      for (const file of hookBuild.files) plugin.tree.set(file.path, file.bytes);
    }
    const members = new Set<Entry>([
      ...group.members.map((member) => member.entry),
      ...(ownedByGroup.get(group.key) ?? []),
    ]);
    const memberRows = rows.filter((row) => members.has(row.entry));
    const sources = new Map<string, PluginMigrationSource>();
    for (const row of memberRows) {
      const source = { path: row.entry.item.path, sha256: row.entry.item.sha256 };
      sources.set(`${source.path}|${source.sha256}`, source);
    }
    return {
      name: plugin.name,
      purpose: group.purpose,
      derivedFrom: [...new Set(group.members.map((member) => member.entry.item.itemId))],
      tree: plugin.tree,
      pendingBuilder: [],
      userConfig: group.members.flatMap((member) => member.unit.userConfig),
      ...(hookBuild === undefined ? {} : { runtime: hookBuild.runtime }),
      migration: {
        rulesVersions,
        sources: [...sources.values()],
        report: memberRows.map((row) => row.line),
      },
    };
  });

  // 프로젝트 범위 항목이 든 플러그인은 프로젝트 이름으로 묶어 프로필을 제안한다(결정: 2026-11-18)
  const profileNames = new Map<string, string[]>();
  for (const plugin of built) {
    if (plugin.group.scopeGroup !== "project") continue;
    const root = plugin.group.rootLabel;
    const names = profileNames.get(root) ?? [];
    names.push(plugin.name);
    profileNames.set(root, names);
  }
  const profileProposals = [...profileNames].map(([profileName, names]) => ({
    profileName,
    plugins: names,
    reason: `프로젝트 ${profileName}의 항목을 모은 새 프로필 제안. 프로필은 사용자가 확인하기 전에는 만들지 않는다`,
  }));

  return {
    rulesVersions,
    scanned: scan.scanned,
    plugins,
    profileProposals,
    questions: entries.flatMap((entry) => entry.plan.questions),
    report: rows.map((row) => row.line),
  };
}
