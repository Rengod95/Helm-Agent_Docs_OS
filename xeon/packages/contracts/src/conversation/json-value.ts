import type { JsonObject, JsonValue } from "./pi.ts";

/**
 * `unknown` 값을 JSON 값으로 좁힌다. JSON으로 표현할 수 없는 값(NaN, 무한대, undefined, 함수 등)이 있으면 `undefined`다.
 * 입력을 바꾸지 않고 새 값을 돌려준다. 단언 대신 쓰는 좁히기 수단이다(eng.typescript.guide TY-23).
 */
export function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const items: JsonValue[] = [];
    const list: readonly unknown[] = value;
    for (const item of list) {
      const converted = toJsonValue(item);
      if (converted === undefined) return undefined;
      items.push(converted);
    }
    return items;
  }
  if (typeof value === "object") {
    const out: JsonObject = {};
    for (const [key, member] of Object.entries(value)) {
      const converted = toJsonValue(member);
      if (converted === undefined) return undefined;
      out[key] = converted;
    }
    return out;
  }
  return undefined;
}
