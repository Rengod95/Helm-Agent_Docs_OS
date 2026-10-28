import type { JsonObject, JsonValue } from "@xeon/contracts/conversation";

/** JSON 값이 객체(배열과 null이 아님)인가 */
export function isJsonObject(value: JsonValue | null | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
