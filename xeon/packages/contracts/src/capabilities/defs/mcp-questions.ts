import { assertNever, err, ok, parse, parseJson, type Result } from "../../base/index.ts";
import {
  JsonObjectSchema,
  JsonValueSchema,
  type JsonObject,
  type JsonValue,
} from "../../conversation/index.ts";
import { Type } from "typebox";
import type { McpQuestion } from "./mcp.ts";

// L2.mcp.spec §4.6, L1.tools.spec §8.3 F 요청 12 (결정 D5 (a)). 서버 주도 요청(`McpQuestion`)을 승인 프로토콜의 kind `question`
// 본문(`QuestionBody`)으로 옮기고, 사용자 답(`QuestionAnswer`)을 입력 요청 키별 `inputResponses`로 되돌리는 순수 함수다.
// L1.tools(core-tools)가 `input_required`(approvalId 없음) 변형을 질문 승인으로 올릴 때 쓰고, cap-mcp와 그룹 코드도 같은 규칙을 쓴다.
// capabilities는 services보다 낮아 `QuestionBody`·`QuestionAnswer`를 import할 수 없으므로 같은 모양을 아래에 적는다
// (구조가 같아 services 타입으로 그대로 대입된다. contracts/test/capabilities/mcp-questions.test.ts가 지킨다).
//
// 질문 본문은 1~4개다(QuestionBody). 폼 필드가 네 개 이하면 필드마다 질문 하나, 넘으면 폼마다 JSON 한 칸이다.

const JsonArraySchema = Type.Array(JsonValueSchema);

function asJsonArray(value: unknown): readonly JsonValue[] | undefined {
  const parsed = parse(JsonArraySchema, value);
  return parsed.ok ? parsed.value : undefined;
}

function asJsonObject(value: unknown): JsonObject | undefined {
  const parsed = parse(JsonObjectSchema, value);
  return parsed.ok ? parsed.value : undefined;
}

/** services `QuestionAnswer`와 같은 모양: 질문 id → `{ selected, text? }` */
export type McpQuestionAnswer = Readonly<
  Record<string, { readonly selected: readonly string[]; readonly text?: string }>
>;

/** services `QuestionBody`와 같은 모양 */
export interface McpQuestionBody {
  readonly questions: readonly {
    readonly id: string;
    readonly text: string;
    readonly options: readonly { readonly id: string; readonly label: string }[];
    readonly multiSelect: boolean;
    readonly allowFreeText: boolean;
  }[];
}

// ── 응답 만들기 (L2.mcp.spec §4.6 3번) ─────────────────────────────────────
// 사용자 응답을 입력 요청 키별 `inputResponses`로 바꾼다. 폼 값은 `requestedSchema`로 검증한 뒤 넣는다.
// elicitation 스키마는 평평한 원시 값 객체(문자열, 숫자, 불리언, 열거형, 다중 선택)라 그 부분집합만 검사한다.

export type McpKeyedAnswer =
  | { readonly key: string; readonly action: "accept"; readonly content?: JsonObject }
  | { readonly key: string; readonly action: "decline" | "cancel" };

export type McpResponseError =
  | { readonly kind: "missing_answer"; readonly key: string }
  | { readonly kind: "unknown_key"; readonly key: string }
  | { readonly kind: "invalid_content"; readonly key: string; readonly issues: readonly string[] };

function enumValues(property: JsonObject): readonly JsonValue[] | undefined {
  const direct = asJsonArray(property["enum"]);
  if (direct !== undefined) return direct;
  const titled = asJsonArray(property["oneOf"]);
  if (titled !== undefined) {
    const values: JsonValue[] = [];
    for (const entry of titled) {
      const item = asJsonObject(entry);
      if (item !== undefined && item["const"] !== undefined) values.push(item["const"]);
    }
    return values;
  }
  return undefined;
}

function checkValue(name: string, property: JsonObject, value: JsonValue): string[] {
  const issues: string[] = [];
  const type = property["type"];
  const options = enumValues(property);
  if (type === "string") {
    if (typeof value !== "string") return [`${name} must be a string`];
    const min = property["minLength"];
    const max = property["maxLength"];
    if (typeof min === "number" && value.length < min)
      issues.push(`${name} is shorter than ${min}`);
    if (typeof max === "number" && value.length > max) issues.push(`${name} is longer than ${max}`);
    if (options !== undefined && !options.includes(value))
      issues.push(`${name} is not an allowed option`);
  } else if (type === "number" || type === "integer") {
    if (typeof value !== "number") return [`${name} must be a number`];
    if (type === "integer" && !Number.isInteger(value)) issues.push(`${name} must be an integer`);
    const min = property["minimum"];
    const max = property["maximum"];
    if (typeof min === "number" && value < min) issues.push(`${name} is below ${min}`);
    if (typeof max === "number" && value > max) issues.push(`${name} is above ${max}`);
  } else if (type === "boolean") {
    if (typeof value !== "boolean") return [`${name} must be a boolean`];
  } else if (type === "array") {
    const list = asJsonArray(value);
    if (list === undefined) return [`${name} must be an array`];
    const items = asJsonObject(property["items"]);
    const allowed = items === undefined ? undefined : (enumValues(items) ?? undefined);
    if (allowed !== undefined) {
      for (const entry of list)
        if (!allowed.includes(entry)) issues.push(`${name} has a value that is not an option`);
    }
  }
  return issues;
}

/** 폼 값이 스키마에 맞는지 본다. 맞지 않는 곳을 문장으로 돌려준다(비어 있으면 통과) */
export function checkMcpFormContent(schema: JsonValue, content: JsonObject): readonly string[] {
  const root = asJsonObject(schema);
  if (root === undefined) return [];
  const properties = asJsonObject(root["properties"]) ?? {};
  const issues: string[] = [];
  const required = asJsonArray(root["required"]);
  if (required !== undefined) {
    for (const name of required) {
      if (typeof name === "string" && content[name] === undefined)
        issues.push(`${name} is required`);
    }
  }
  for (const [name, value] of Object.entries(content)) {
    const property = asJsonObject(properties[name]);
    if (property === undefined) {
      issues.push(`${name} is not a field of the form`);
      continue;
    }
    issues.push(...checkValue(name, property, value));
  }
  return issues;
}

/**
 * 질문마다 응답 하나를 맞춰 `inputResponses`를 만든다. sampling 질문은 응답을 보내지 않는다(승인돼도 거부, 미결 6):
 * 키를 빼면 서버가 같은 요청을 다시 낼 수 있다. 질문에 없는 키나 빠진 응답은 오류다.
 */
export function buildMcpInputResponses(
  questions: readonly McpQuestion[],
  answers: readonly McpKeyedAnswer[],
): Result<JsonObject, McpResponseError> {
  const known = new Set(questions.map((question) => question.key));
  for (const answer of answers)
    if (!known.has(answer.key)) return err({ kind: "unknown_key", key: answer.key });
  const responses: Record<string, JsonValue> = {};
  for (const question of questions) {
    if (question.kind === "sampling") continue;
    const answer = answers.find((candidate) => candidate.key === question.key);
    if (answer === undefined) return err({ kind: "missing_answer", key: question.key });
    if (answer.action !== "accept") {
      responses[question.key] = { action: answer.action };
      continue;
    }
    if (question.kind === "elicitation_url") {
      responses[question.key] = { action: "accept" };
      continue;
    }
    const content = answer.content ?? {};
    const issues = checkMcpFormContent(question.requestedSchema, content);
    if (issues.length > 0) return err({ kind: "invalid_content", key: question.key, issues });
    responses[question.key] = { action: "accept", content };
  }
  return ok(responses);
}

// ── 질문 옮기기와 답 되돌리기 ───────────────────────────────────────────────

const MAX_ITEMS = 4;
const MAX_ID = 32;

type OptionSpec = { id: string; label: string };
type ItemSpec = {
  id: string;
  text: string;
  options: OptionSpec[];
  multiSelect: boolean;
  allowFreeText: boolean;
};

/** 질문 항목 하나가 어느 입력 요청의 어느 값인지 */
type ItemTarget =
  | {
      readonly kind: "field";
      readonly key: string;
      readonly field: string;
      readonly type: FieldType;
      readonly values: readonly JsonValue[];
    }
  | { readonly kind: "whole_form"; readonly key: string }
  | { readonly kind: "confirm"; readonly key: string };

type FieldType = "string" | "number" | "integer" | "boolean" | "array";

export interface PlannedMcpQuestions {
  readonly body: McpQuestionBody;
  /** 승인 요청 `subject`로 보내는 같은 내용의 JSON */
  readonly subject: JsonObject;
  /** 질문 id → 대상 */
  readonly targets: ReadonlyMap<string, ItemTarget>;
  readonly questions: readonly McpQuestion[];
}

export type McpPlanError = { readonly kind: "too_many_questions"; readonly count: number };

function labelOf(value: JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function enumOptions(property: JsonObject): { options: OptionSpec[]; values: JsonValue[] } {
  const values: JsonValue[] = [];
  const options: OptionSpec[] = [];
  const direct = asJsonArray(property["enum"]);
  const titled = asJsonArray(property["oneOf"]);
  const push = (value: JsonValue, label: string): void => {
    const id =
      typeof value === "string" && value.length >= 1 && value.length <= MAX_ID
        ? value
        : `o${values.length}`;
    values.push(value);
    options.push({ id, label: label.slice(0, 80) });
  };
  if (direct !== undefined) for (const value of direct) push(value, labelOf(value));
  else if (titled !== undefined) {
    for (const entry of titled) {
      const item = asJsonObject(entry);
      const value = item?.["const"];
      if (item === undefined || value === undefined) continue;
      push(value, typeof item["title"] === "string" ? item["title"] : labelOf(value));
    }
  }
  return { options, values };
}

function fieldType(property: JsonObject): FieldType {
  const type = property["type"];
  if (type === "number" || type === "integer" || type === "boolean" || type === "array")
    return type;
  return "string";
}

function fieldItem(
  id: string,
  message: string,
  name: string,
  property: JsonObject,
): { item: ItemSpec; type: FieldType; values: JsonValue[] } {
  const type = fieldType(property);
  const title = typeof property["title"] === "string" ? property["title"] : name;
  const text = `${message}\n${title}`.trim();
  if (type === "boolean") {
    return {
      type,
      values: [true, false],
      item: {
        id,
        text,
        options: [
          { id: "yes", label: "Yes" },
          { id: "no", label: "No" },
        ],
        multiSelect: false,
        allowFreeText: false,
      },
    };
  }
  const source = type === "array" ? (asJsonObject(property["items"]) ?? {}) : property;
  const { options, values } = enumOptions(source);
  return {
    type,
    values,
    item: { id, text, options, multiSelect: type === "array", allowFreeText: options.length === 0 },
  };
}

function formFields(
  question: Extract<McpQuestion, { kind: "elicitation_form" }>,
): [string, JsonObject][] {
  const schema = asJsonObject(question.requestedSchema);
  const properties = asJsonObject(schema?.["properties"]) ?? {};
  const fields: [string, JsonObject][] = [];
  for (const [name, value] of Object.entries(properties)) {
    const property = asJsonObject(value);
    if (property !== undefined) fields.push([name, property]);
  }
  return fields;
}

/** 질문 목록을 `QuestionBody`로 옮긴다. 질문이 너무 많으면 오류다 */
export function planMcpQuestionBody(
  questions: readonly McpQuestion[],
): Result<PlannedMcpQuestions, McpPlanError> {
  const perField = questions.reduce(
    (count, question) =>
      count + (question.kind === "elicitation_form" ? Math.max(1, formFields(question).length) : 1),
    0,
  );
  const collapse = perField > MAX_ITEMS;
  const items: ItemSpec[] = [];
  const targets = new Map<string, ItemTarget>();
  let index = 0;
  const nextId = (): string => {
    index += 1;
    return `q${index}`;
  };
  for (const question of questions) {
    if (question.kind === "elicitation_form") {
      const fields = formFields(question);
      if (collapse || fields.length === 0) {
        const id = nextId();
        items.push({
          id,
          text: `${question.message}\nAnswer with a JSON object that matches the form.`.trim(),
          options: [],
          multiSelect: false,
          allowFreeText: true,
        });
        targets.set(id, { kind: "whole_form", key: question.key });
        continue;
      }
      for (const [name, property] of fields) {
        const id = nextId();
        const built = fieldItem(id, question.message, name, property);
        items.push(built.item);
        targets.set(id, {
          kind: "field",
          key: question.key,
          field: name,
          type: built.type,
          values: built.values,
        });
      }
      continue;
    }
    const id = nextId();
    const label = question.kind === "elicitation_url" ? "Done" : "Allow";
    const text =
      question.kind === "elicitation_url"
        ? `${question.message}\nOpen ${question.url} and finish the steps there.`.trim()
        : question.summary;
    items.push({
      id,
      text,
      options: [{ id: "yes", label }],
      multiSelect: false,
      allowFreeText: false,
    });
    targets.set(id, { kind: "confirm", key: question.key });
  }
  if (items.length < 1 || items.length > MAX_ITEMS) {
    return err({ kind: "too_many_questions", count: items.length });
  }
  return ok({ body: { questions: items }, subject: { questions: items }, targets, questions });
}

function parseNumber(text: string, integer: boolean): number | undefined {
  const value = Number(text);
  if (text.trim().length === 0 || !Number.isFinite(value)) return undefined;
  return integer && !Number.isInteger(value) ? undefined : value;
}

function fieldValue(
  target: Extract<ItemTarget, { kind: "field" }>,
  answer: McpQuestionAnswer[string],
): JsonValue | undefined {
  const picked = answer.selected.map((id) => {
    if (target.type === "boolean") return id === "yes";
    const index = target.values.findIndex(
      (value) => value === id || `o${target.values.indexOf(value)}` === id,
    );
    return index < 0 ? id : target.values[index];
  });
  switch (target.type) {
    case "boolean":
      return picked[0];
    case "array":
      return picked.filter((value): value is JsonValue => value !== undefined);
    case "number":
    case "integer": {
      if (answer.text !== undefined) return parseNumber(answer.text, target.type === "integer");
      const first = picked[0];
      return typeof first === "number" ? first : undefined;
    }
    case "string":
      return answer.text ?? picked[0];
    default:
      return assertNever(target.type, "fieldValue");
  }
}

export type McpDecodeError =
  | McpResponseError
  | { readonly kind: "bad_json"; readonly key: string }
  | { readonly kind: "bad_field"; readonly key: string; readonly field: string };

/** 사용자가 `QuestionAnswer`로 답했을 때 키별 응답으로 되돌린다 */
export function decodeMcpAnswer(
  planned: PlannedMcpQuestions,
  answer: McpQuestionAnswer,
): Result<JsonObject, McpDecodeError> {
  const contents = new Map<string, Record<string, JsonValue>>();
  const confirmed = new Set<string>();
  for (const [id, target] of planned.targets) {
    const given = answer[id];
    if (given === undefined) continue;
    if (target.kind === "confirm") {
      if (given.selected.length > 0) confirmed.add(target.key);
      continue;
    }
    if (target.kind === "whole_form") {
      const text = given.text ?? "";
      const json = text.length === 0 ? ok({}) : parseJson(text);
      const parsed = json.ok ? asJsonObject(json.value) : undefined;
      if (parsed === undefined) return err({ kind: "bad_json", key: target.key });
      contents.set(target.key, { ...parsed });
      continue;
    }
    const value = fieldValue(target, given);
    const content = contents.get(target.key) ?? {};
    if (value === undefined) {
      if (given.selected.length > 0 || (given.text ?? "").length > 0) {
        return err({ kind: "bad_field", key: target.key, field: target.field });
      }
      contents.set(target.key, content);
      continue;
    }
    content[target.field] = value;
    contents.set(target.key, content);
  }
  const keyed: McpKeyedAnswer[] = [];
  for (const question of planned.questions) {
    if (question.kind === "elicitation_form") {
      keyed.push({
        key: question.key,
        action: "accept",
        content: contents.get(question.key) ?? {},
      });
    } else if (confirmed.has(question.key)) {
      keyed.push({ key: question.key, action: "accept" });
    } else {
      keyed.push({ key: question.key, action: "decline" });
    }
  }
  return buildMcpInputResponses(planned.questions, keyed);
}

/** 승인이 거부되거나 취소됐을 때: 모든 질문에 같은 동작으로 답한다 */
export function uniformMcpAnswer(
  questions: readonly McpQuestion[],
  action: "decline" | "cancel",
): Result<JsonObject, McpResponseError> {
  return buildMcpInputResponses(
    questions,
    questions.map((question) => ({ key: question.key, action })),
  );
}
