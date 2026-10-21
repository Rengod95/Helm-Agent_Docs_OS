import { Bug } from "./bug.ts";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown, path: string): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Bug(`canonicalJson: non-finite number at ${path}`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (const [index, item] of (value as readonly unknown[]).entries()) {
      if (item === undefined) {
        throw new Bug(`canonicalJson: undefined array item at ${path}/${index}`);
      }
      items.push(canonicalize(item, `${path}/${index}`));
    }
    return `[${items.join(",")}]`;
  }
  if (isRecord(value)) {
    const parts: string[] = [];
    for (const key of Object.keys(value).toSorted()) {
      const member = value[key];
      if (member === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${canonicalize(member, `${path}/${key}`)}`);
    }
    return `{${parts.join(",")}}`;
  }
  throw new Bug(`canonicalJson: unsupported ${typeof value} at ${path}`);
}

/**
 * 정규화 JSON(RFC 8785 JCS 부분집합, DT-14). 키를 UTF-16 코드 단위 순으로 정렬하고 공백 없이 직렬화한다.
 * undefined 값 키는 지우고, NaN·Infinity·배열 안 undefined·bigint·함수는 Bug다. 순수 함수.
 */
export function canonicalJson(value: unknown): string {
  return canonicalize(value, "");
}
