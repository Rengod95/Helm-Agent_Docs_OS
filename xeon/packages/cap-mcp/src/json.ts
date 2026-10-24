import { parse } from "@xeon/contracts";
import {
  JsonObjectSchema,
  JsonValueSchema,
  type JsonObject,
  type JsonValue,
} from "@xeon/contracts/conversation";
import { Type } from "typebox";

const JsonArraySchema = Type.Array(JsonValueSchema);

// 경계에서 받은 unknown을 JSON 값으로 들이는 작은 도구. 단언 없이 스키마 검사로만 좁힌다(TY-10).

export function asJsonValue(value: unknown): JsonValue | undefined {
  const parsed = parse(JsonValueSchema, value);
  return parsed.ok ? parsed.value : undefined;
}

export function asJsonArray(value: unknown): readonly JsonValue[] | undefined {
  const parsed = parse(JsonArraySchema, value);
  return parsed.ok ? parsed.value : undefined;
}

export function asJsonObject(value: unknown): JsonObject | undefined {
  const parsed = parse(JsonObjectSchema, value);
  return parsed.ok ? parsed.value : undefined;
}

export function jsonObjectOr(value: unknown): JsonObject {
  return asJsonObject(value) ?? {};
}

export function stringOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
