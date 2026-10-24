import { err, ok, parse, type Result } from "@xeon/contracts";
import type { AgentToolCall, JsonObject } from "@xeon/contracts/conversation";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { isJsonObject, messageOf } from "./util.ts";

// 도구 호출 인자 검증(adr.0009 §3.4, L1.tools.spec §4.2 4번). pi-ai 1.3.0 `validateToolArguments`(MIT, Copyright (c) 2025 Mario Zechner,
// utils/validation.ts)의 TypeBox 경로를 옮겼다: argumentsError 확인 → 사본 → 선택 null 제거 → Value.Convert → 스키마 검사.
// 옮기지 않은 것: TypeBox 종류 표지가 없는 순수 JSON Schema(MCP 도구)의 coerceWithJsonSchema 경로. M2 cap-mcp 작업에서 더한다.

export interface InvalidArguments {
  readonly kind: "invalid_arguments";
  /** 모델에 돌려줄 영어 문장 */
  readonly message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSchema(value: unknown): value is TSchema {
  return typeof value === "object" && value !== null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** 스키마가 null을 받는가 */
function acceptsNull(schema: unknown): boolean {
  return isSchema(schema) && Value.Check(schema, null);
}

/** 선택 속성이 null이고 스키마가 null을 받지 않으면 속성을 지운다(모델이 "없음"을 null로 보내는 경우) */
function normalizeOptionalNulls(value: unknown, schema: unknown): void {
  if (!isRecord(schema) && !isSchema(schema)) return;
  const shape: Record<string, unknown> = isRecord(schema) ? schema : {};
  if (Array.isArray(value)) {
    const items = shape["items"];
    if (Array.isArray(items)) {
      for (const [index, itemSchema] of items.entries()) {
        normalizeOptionalNulls(value[index], itemSchema);
      }
    } else if (items !== undefined) {
      for (const item of value) normalizeOptionalNulls(item, items);
    }
    return;
  }
  const properties = shape["properties"];
  if (!isRecord(value) || !isRecord(properties)) return;
  const required = new Set(strings(shape["required"]));
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!(key in value)) continue;
    const isRef = isRecord(propertySchema) && typeof propertySchema["$ref"] === "string";
    if (value[key] === null && !required.has(key) && !isRef && !acceptsNull(propertySchema)) {
      Reflect.deleteProperty(value, key);
    } else {
      normalizeOptionalNulls(value[key], propertySchema);
    }
  }
}

function formatPath(instancePath: string): string {
  const path = instancePath.replace(/^\//, "").replaceAll("/", ".");
  return path === "" ? "root" : path;
}

/**
 * 호출 인자를 도구 스키마로 검증하고 변환한 인자를 돌려준다. 던지지 않는다.
 * 사본에서 작업하므로 `call.arguments`는 바뀌지 않는다.
 */
export function validateToolArguments(
  parameters: TSchema,
  call: AgentToolCall,
): Result<JsonObject, InvalidArguments> {
  if (call.argumentsError !== undefined) {
    return err({
      kind: "invalid_arguments",
      message: `Invalid arguments for tool "${call.name}": ${call.argumentsError}`,
    });
  }
  const args: unknown = structuredClone(call.arguments);
  normalizeOptionalNulls(args, parameters);
  let converted: unknown;
  try {
    converted = Value.Convert(parameters, args);
  } catch (error) {
    return err({
      kind: "invalid_arguments",
      message: `Validation failed for tool "${call.name}": the arguments could not be converted to the tool schema (${messageOf(error)}).`,
    });
  }
  let checked: ReturnType<typeof parse>;
  try {
    checked = parse(parameters, converted);
  } catch (error) {
    // 스키마 자체를 컴파일할 수 없다. 도구 등록의 문제이고 호출은 실행할 수 없다
    return err({
      kind: "invalid_arguments",
      message: `Tool "${call.name}" has a parameter schema that cannot be validated (${messageOf(error)}).`,
    });
  }
  if (!checked.ok) {
    const lines = checked.error.issues
      .map((issue) => `  - ${formatPath(issue.path)}: ${issue.message}`)
      .join("\n");
    return err({
      kind: "invalid_arguments",
      message: `Validation failed for tool "${call.name}":\n${lines === "" ? "  - root: invalid arguments" : lines}\n\nReceived arguments:\n${JSON.stringify(call.arguments, null, 2)}`,
    });
  }
  if (!isJsonObject(converted)) {
    return err({
      kind: "invalid_arguments",
      message: `Invalid arguments for tool "${call.name}": the arguments are not a JSON object.`,
    });
  }
  return ok(converted);
}
