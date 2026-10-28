import type { JsonObject, JsonValue } from "@xeon/contracts/conversation";

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
