import type { JsonObject, JsonValue } from "@xeon/contracts/conversation";

/** JSON 값이 객체(배열과 null이 아님)인가 */
export function isJsonObject(value: JsonValue | null | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 길이를 넘는 문자열을 자른다. 서로게이트 쌍의 앞 절반만 남기지 않는다 */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? max - 1 : max;
  return text.slice(0, end);
}
