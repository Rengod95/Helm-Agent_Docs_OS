import { err, ok, type Result } from "@xeon/contracts";
import type { McpQuestion } from "@xeon/contracts/capabilities";
import type { JsonObject, JsonValue } from "@xeon/contracts/conversation";
import { asJsonArray, asJsonObject } from "../json.ts";

// L2.mcp.spec §4.6 3번. 사용자 응답을 입력 요청 키별 `inputResponses`로 바꾼다. 폼 값은 `requestedSchema`로
// 검증한 뒤 넣는다. elicitation 스키마는 평평한 원시 값 객체(문자열, 숫자, 불리언, 열거형, 다중 선택)라 그 부분집합만 검사한다.

export type KeyedAnswer =
  | { readonly key: string; readonly action: "accept"; readonly content?: JsonObject }
  | { readonly key: string; readonly action: "decline" | "cancel" };

export type ResponseError =
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
export function checkFormContent(schema: JsonValue, content: JsonObject): readonly string[] {
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
export function buildInputResponses(
  questions: readonly McpQuestion[],
  answers: readonly KeyedAnswer[],
): Result<JsonObject, ResponseError> {
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
    const issues = checkFormContent(question.requestedSchema, content);
    if (issues.length > 0) return err({ kind: "invalid_content", key: question.key, issues });
    responses[question.key] = { action: "accept", content };
  }
  return ok(responses);
}
