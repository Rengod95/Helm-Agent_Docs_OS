/** 키로 읽을 수 있는 객체인가(배열과 null 제외) */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
